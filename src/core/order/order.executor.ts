import { IOrder, IWallet, Position, Transaction } from '../../database/models';
import { logger } from '../../utils/logger';
import { getWalletWithPrivateKey } from '../wallet/wallet.manager';
import { buyToken } from '../trading/pancakeswap.service';
import { getTokenMetadata } from '../token/token.service';
import { getTokenPrice } from '../price/price.service';
import { isValidAddress } from '../../utils/validation';
import { PositionStatus, TransactionStatus, TransactionType } from '../../config/constants';
import { ethers } from 'ethers';
import mongoose from 'mongoose';
import { tokenValidator } from '../token/token.validator';
import { positionManager } from '../position/position.manager';
import { B_Position } from '../classes/B_Position';
import { B_Token } from '../classes/B_Token';
import { B_Wallet } from '../classes/B_Wallet';
import { B_Transaction, TransactionType as TxType, transactionQueue } from '../classes';

/**
 * Order Executor
 * Handles execution of buy orders
 */

export interface ExecutionResult {
	success: boolean;
	txHash?: string;
	tokenAddress?: string;
	error?: string;
	positionId?: string;
}

/**
 * Execute a buy order for a specific token
 * @param order - Order configuration
 * @param wallet - Wallet to execute from
 * @param tokenAddress - Token contract address to buy
 * @returns Execution result
 */
export async function executeBuyOrder(
	order: IOrder,
	wallet: IWallet,
	tokenAddress: string
): Promise<ExecutionResult> {
	try {
		logger.info(`🛍️ Buy: ${order.tradingAmount} BNB -> ${tokenAddress}`);

		// Validate token address
		if (!isValidAddress(tokenAddress)) {
			return { success: false, error: 'Invalid token address' };
		}

		// Check if order is active
		if (!order.isActive) {
			return { success: false, error: 'Order is not active' };
		}

		// Check wallet balance
		if (wallet.balance.bnb < order.tradingAmount) {
			return {
				success: false,
				error: `Insufficient balance. Required: ${order.tradingAmount} BNB, Available: ${wallet.balance.bnb} BNB`,
			};
		}

		// Validate token is on PancakeSwap V2
		const validation = await tokenValidator.validateToken(tokenAddress);

		if (!validation.isValid) {
			return { success: false, error: validation.error || 'Token validation failed' };
		}

		if (!validation.token || !validation.pairAddress) {
			return { success: false, error: 'Token validation incomplete' };
		}

		logger.success(`Token validated: ${validation.token.symbol} on PancakeSwap V2`);

		// Get token metadata
		const tokenMetadata = validation.token; // Use validated token metadata

		// Get wallet with private key for signing
		const walletWithKey = await getWalletWithPrivateKey(wallet._id.toString(), order.userId.toString());
		if (!walletWithKey) {
			return { success: false, error: 'Failed to decrypt wallet' };
		}

		// Get current token price (for tracking)
		let buyPriceInBnb = 0;
		let buyPriceInUsd = 0;
		try {
			const priceData = await getTokenPrice(tokenAddress);
			if (priceData) {
				buyPriceInBnb = parseFloat(priceData.priceInBnb);
				buyPriceInUsd = parseFloat(priceData.priceInUsd);
			}
		} catch (error: any) {
			logger.warning('Failed to fetch price, will continue without it:', error.message);
		}

		// Execute the swap via transaction queue
		logger.info(`💰 ${order.tradingAmount} BNB -> ${tokenMetadata.symbol} (${order.slippage}% slippage)`);

		// Create B_Wallet instance
		const bWallet = await B_Wallet.getById(wallet._id.toString());
		if (!bWallet) {
			return { success: false, error: 'Failed to load wallet' };
		}

		// Create B_Token instance
		const bToken = new B_Token({
			address: tokenAddress,
			symbol: tokenMetadata.symbol || 'UNKNOWN',
			name: tokenMetadata.name || 'Unknown Token',
			decimals: tokenMetadata.decimals || 18,
		});

		// Create transaction for queue
		const transaction = new B_Transaction({
			type: TxType.BUY,
			wallet: bWallet,
			token: bToken,
			bnbAmount: order.tradingAmount,
			slippage: order.slippage,
			gasPrice: order.gasFee.gasPrice,
			gasLimit: order.gasFee.gasLimit,
			orderId: order._id.toString(),
			userId: order.userId.toString(),
			priority: 10, // Normal priority for buys
		});

		// Queue the transaction
		const txId = transactionQueue.push(transaction);
		logger.info(`🎯 Queued: ${txId}`);

		// Wait for transaction to complete (with timeout)
		const swapResult = await waitForTransactionComplete(transaction, 120000); // 120 second timeout

		if (!swapResult.success || !swapResult.txHash) {
			// Log failed transaction
			await Transaction.create({
				userId: order.userId,
				walletId: wallet._id,
				type: TransactionType.BUY,
				status: TransactionStatus.FAILED,
				tokenAddress,
				tokenSymbol: tokenMetadata.symbol || 'UNKNOWN',
				amountBnb: order.tradingAmount,
				gasFee: 0,
				txHash: 'FAILED',
				errorMessage: swapResult.error || 'Unknown error',
			});

			return {
				success: false,
				error: swapResult.error || 'Swap failed',
			};
		}

		logger.success(`Swap successful! TX: ${swapResult.txHash}`);

		// Calculate token amount received (B_Trading returns 'tokenAmount' field)
		const tokenAmountReceived = swapResult.tokenAmount ? parseFloat(swapResult.tokenAmount) : 0;

		if (tokenAmountReceived === 0) {
			logger.error(`❌ TOKEN AMOUNT IS ZERO! swapResult: ${JSON.stringify(swapResult)}`);
		} else {
			logger.success(`✅ Token amount received: ${tokenAmountReceived}`);
		}

		// Create position in database
		const positionDoc = await Position.create({
			userId: order.userId,
			walletId: wallet._id,
			orderId: order._id,
			tokenAddress,
			tokenSymbol: tokenMetadata.symbol || 'UNKNOWN',
			tokenName: tokenMetadata.name || 'Unknown Token',
			tokenDecimals: tokenMetadata.decimals || 18,
			buyTxHash: swapResult.txHash,
			buyPrice: buyPriceInBnb,
			buyPriceUsd: buyPriceInUsd,
			buyAmount: order.tradingAmount,
			tokenAmount: tokenAmountReceived,
			buyTimestamp: new Date(),
			currentPrice: buyPriceInBnb,
			currentPriceUsd: buyPriceInUsd,
			lastPriceUpdate: new Date(),
			pnlPercent: 0,
			pnlBnb: 0,
			pnlUsd: 0,
			status: PositionStatus.PENDING,
			takeProfitTarget: order.takeProfitPercent,
			stopLossTarget: order.stopLossPercent,
		});

		logger.success(`Position created in DB: ${positionDoc._id}`);

		// Note: tokenAmountReceived is already formatted (not in wei)
		// No need to normalize again - swapResult.amountOut is already human-readable

		// Create B_Position instance and add to PositionManager
		const bPosition = new B_Position({
			id: positionDoc._id.toString(),
			orderId: order._id.toString(),
			userId: order.userId.toString(),
			token: bToken,
			tokenAmount: tokenAmountReceived,  // Already normalized from swapResult
			bnbSpent: order.tradingAmount,
			buyPrice: buyPriceInBnb,
			currentPrice: buyPriceInBnb,
			status: PositionStatus.PENDING,
			buyTxHash: swapResult.txHash,
			buyTimestamp: new Date(),
			takeProfitPercent: order.takeProfitPercent,
			stopLossPercent: order.stopLossPercent,
			takeProfitEnabled: order.takeProfitEnabled,
			stopLossEnabled: order.stopLossEnabled,
		});

		// Add to PositionManager (in-memory tracking)
		positionManager.addPosition(bPosition);
		logger.success(`Position added to PositionManager: ${bPosition.id}`);

		// Log successful transaction
		await Transaction.create({
			userId: order.userId,
			walletId: wallet._id,
			positionId: positionDoc._id,
			type: TransactionType.BUY,
			status: TransactionStatus.SUCCESS,
			tokenAddress,
			tokenSymbol: tokenMetadata.symbol || 'UNKNOWN',
			amountBnb: order.tradingAmount,
			amountToken: tokenAmountReceived,
			gasFee: swapResult.gasFee || 0,
			txHash: swapResult.txHash,
		});

		return {
			success: true,
			txHash: swapResult.txHash,
			tokenAddress,
			positionId: positionDoc._id.toString(),
		};
	} catch (error: any) {
		logger.error('Failed to execute buy order:', error.message);
		if (error.stack) {
			logger.debug(error.stack);
		}

		// Log failed transaction
		try {
			await Transaction.create({
				userId: order.userId,
				walletId: wallet._id,
				type: TransactionType.BUY,
				status: TransactionStatus.FAILED,
				tokenAddress,
				tokenSymbol: 'UNKNOWN',
				amountBnb: order.tradingAmount,
				gasFee: 0,
				txHash: 'FAILED_' + Date.now(),
				errorMessage: error.message,
			});
		} catch (logError) {
			logger.error('Failed to log failed transaction:', logError);
		}

		return {
			success: false,
			error: error.message || 'An unexpected error occurred',
		};
	}
}

/**
 * Execute manual buy for a specific order
 * @param orderId - Order ID
 * @param userId - User ID
 * @param tokenAddress - Token address to buy
 * @returns Execution result
 */
export async function executeManualBuy(
	orderId: string,
	userId: string,
	tokenAddress: string
): Promise<ExecutionResult> {
	try {
		// Get order
		const order = (await mongoose.model('Order').findOne({ _id: orderId, userId }).populate('walletId')) as any;

		if (!order) {
			return { success: false, error: 'Order not found' };
		}

		if (!order.walletId) {
			return { success: false, error: 'Wallet not found for this order' };
		}

		// Execute buy
		return await executeBuyOrder(order, order.walletId, tokenAddress);
	} catch (error: any) {
		logger.error('Failed to execute manual buy:', error.message);
		return { success: false, error: error.message };
	}
}

/**
 * Wait for a transaction to complete
 */
async function waitForTransactionComplete(transaction: B_Transaction, timeoutMs: number): Promise<any> {
	const startTime = Date.now();

	return new Promise((resolve) => {
		const checkInterval = setInterval(() => {
			// Check if completed
			if (transaction.status === 'COMPLETED') {
				clearInterval(checkInterval);
				resolve(transaction.result);
				return;
			}

			// Check if failed
			if (transaction.status === 'FAILED' || transaction.status === 'CANCELLED') {
				clearInterval(checkInterval);
				resolve({
					success: false,
					error: transaction.error || 'Transaction failed or cancelled',
				});
				return;
			}

			// Check timeout
			if (Date.now() - startTime > timeoutMs) {
				clearInterval(checkInterval);
				resolve({
					success: false,
					error: 'Transaction timeout',
				});
			}
		}, 100); // Check every 100ms
	});
}

/**
 * Validate order before execution
 * @param order - Order to validate
 * @param wallet - Wallet to validate
 * @returns Validation result
 */
export function validateOrderExecution(order: IOrder, wallet: IWallet): { valid: boolean; error?: string } {
	// Check if order is active
	if (!order.isActive) {
		return { valid: false, error: 'Order is not active' };
	}

	// Check wallet balance
	if (wallet.balance.bnb < order.tradingAmount) {
		return {
			valid: false,
			error: `Insufficient balance. Required: ${order.tradingAmount} BNB, Available: ${wallet.balance.bnb} BNB`,
		};
	}

	// Check if trading amount is valid
	if (order.tradingAmount <= 0) {
		return { valid: false, error: 'Invalid trading amount' };
	}

	// Check slippage
	if (order.slippage < 0.1 || order.slippage > 99) {
		return { valid: false, error: 'Invalid slippage percentage' };
	}

	return { valid: true };
}
