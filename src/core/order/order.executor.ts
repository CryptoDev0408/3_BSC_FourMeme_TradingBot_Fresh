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
		logger.info(`Executing buy order: ${order._id} for token: ${tokenAddress}`);

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

		// Get token metadata
		logger.info('Fetching token metadata...');
		const tokenMetadata = await getTokenMetadata(tokenAddress);

		if (!tokenMetadata) {
			return { success: false, error: 'Failed to fetch token metadata' };
		}

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

		// Execute the swap
		logger.info(
			`Buying ${order.tradingAmount} BNB worth of ${tokenMetadata.symbol} with ${order.slippage}% slippage...`
		);

		// Convert BNB amount to Wei
		const bnbAmountWei = ethers.utils.parseEther(order.tradingAmount.toString());

		const swapResult = await buyToken(
			wallet._id.toString(),
			order.userId.toString(),
			tokenAddress,
			bnbAmountWei.toString(),
			order.slippage,
			ethers.utils.parseUnits(order.gasFee.gasPrice, 'gwei').toString()
		);

		if (!swapResult.success || !swapResult.txHash) {
			// Log failed transaction
			await Transaction.create({
				userId: order.userId,
				walletId: wallet._id,
				orderId: order._id,
				type: TransactionType.BUY,
				status: TransactionStatus.FAILED,
				tokenAddress,
				tokenSymbol: tokenMetadata.symbol || 'UNKNOWN',
				tokenName: tokenMetadata.name || 'Unknown Token',
				bnbAmount: order.tradingAmount,
				txHash: '',
				error: swapResult.error || 'Unknown error',
			});

			return {
				success: false,
				error: swapResult.error || 'Swap failed',
			};
		}

		logger.success(`Swap successful! TX: ${swapResult.txHash}`);

		// Calculate token amount received
		const tokenAmountReceived = swapResult.amountOut ? parseFloat(swapResult.amountOut) : 0;

		// Create position
		const position = await Position.create({
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
			status: PositionStatus.ACTIVE,
			takeProfitTarget: order.takeProfitPercent,
			stopLossTarget: order.stopLossPercent,
		});

		logger.success(`Position created: ${position._id}`);

		// Log successful transaction
		await Transaction.create({
			userId: order.userId,
			walletId: wallet._id,
			orderId: order._id,
			positionId: position._id,
			type: TransactionType.BUY,
			status: TransactionStatus.SUCCESS,
			tokenAddress,
			tokenSymbol: tokenMetadata.symbol || 'UNKNOWN',
			tokenName: tokenMetadata.name || 'Unknown Token',
			bnbAmount: order.tradingAmount,
			tokenAmount: tokenAmountReceived,
			priceInBnb: buyPriceInBnb,
			priceInUsd: buyPriceInUsd,
			txHash: swapResult.txHash,
		});

		return {
			success: true,
			txHash: swapResult.txHash,
			tokenAddress,
			positionId: position._id.toString(),
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
				orderId: order._id,
				type: TransactionType.BUY,
				status: TransactionStatus.FAILED,
				tokenAddress,
				tokenSymbol: 'UNKNOWN',
				tokenName: 'Unknown',
				bnbAmount: order.tradingAmount,
				txHash: '',
				error: error.message,
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
	if (order.slippage < 0.1 || order.slippage > 50) {
		return { valid: false, error: 'Invalid slippage percentage' };
	}

	return { valid: true };
}
