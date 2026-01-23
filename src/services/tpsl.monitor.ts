import { positionManager } from '../core/position/position.manager';
import { B_Trading } from '../core/classes/B_Trading';
import { B_Wallet } from '../core/classes/B_Wallet';
import { B_Token } from '../core/classes/B_Token';
import { B_Transaction } from '../core/classes/B_Transaction';
import { transactionQueue } from '../core/classes/B_Queue';
import { Order, User } from '../database/models';
import { logger } from '../utils/logger';
import { config } from '../config/config';
import { bot } from '../bot';
import { ethers } from 'ethers';
import { TransactionType } from '../config/constants';
import { getTokenBalance } from '../core/trading/pancakeswap.service';

/**
 * TP/SL Monitor Service
 * Monitors open positions and executes TP/SL automatically
 */
export class TPSLMonitor {
	private intervalMs: number;
	private isRunning: boolean = false;
	private intervalHandle: NodeJS.Timeout | null = null;

	constructor() {
		this.intervalMs = config.monitoring.positionMonitorInterval || 10000; // Default 10 seconds
	}

	/**
	 * Start monitoring service
	 */
	start(): void {
		if (this.isRunning) {
			logger.warning('TP/SL Monitor already running');
			return;
		}

		this.isRunning = true;
		logger.info(`TP/SL Monitor started (interval: ${this.intervalMs}ms)`);

		// Run immediately
		this.checkAllPositions();

		// Then run on interval
		this.intervalHandle = setInterval(() => {
			this.checkAllPositions();
		}, this.intervalMs);
	}

	/**
	 * Stop monitoring service
	 */
	stop(): void {
		if (!this.isRunning) {
			return;
		}

		this.isRunning = false;

		if (this.intervalHandle) {
			clearInterval(this.intervalHandle);
			this.intervalHandle = null;
		}

		logger.info('TP/SL Monitor stopped');
	}

	/**
	 * Check all open positions
	 */
	private async checkAllPositions(): Promise<void> {
		try {
			// Get all open positions from memory
			const positions = positionManager.getAllOpenPositions();

			if (positions.length === 0) {
				return;
			}

			logger.info(`Checking ${positions.length} open positions...`);

			for (const position of positions) {
				try {
					await this.checkPosition(position.id);
				} catch (error: any) {
					logger.error(`Position check error (${position.id}): ${error.message}`);
				}
			}
		} catch (error: any) {
			logger.error(`TP/SL Monitor error: ${error.message}`);
		}
	}

	/**
	 * Check individual position
	 * NOTE: PNL checking logic will be implemented later
	 * For now, this sets up the architecture
	 */
	private async checkPosition(positionId: string): Promise<void> {
		try {
			const position = positionManager.getPosition(positionId);
			if (!position) {
				logger.warning(`Position not found: ${positionId}`);
				return;
			}

			// Update current price from blockchain
			const currentPrice = await B_Trading.getTokenPrice(position.token.address);
			if (!currentPrice || parseFloat(currentPrice) === 0) {
				logger.warning(`Failed to get price for ${position.token.symbol || position.token.address}`);
				return;
			}

			const priceInBnb = parseFloat(currentPrice);

			// Update position price
			await positionManager.updatePositionPrice(positionId, priceInBnb);

			// Get order for TP/SL settings
			const order = await Order.findById(position.orderId);
			if (!order) {
				logger.warning(`Order not found for position: ${positionId}`);
				return;
			}

			// TODO: Implement TP/SL checking logic here later
			// For now, we just update the price
			// The actual buy/sell execution will trigger TP/SL checks

			logger.debug(`Position ${positionId} price updated: ${priceInBnb} BNB`);
		} catch (error: any) {
			logger.error(`Failed to check position ${positionId}: ${error.message}`);
		}
	}

	/**
	 * Execute sell for TP/SL
	 * NOTE: This will be implemented later with full logic
	 */
	async executeSell(
		positionId: string,
		reason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'MANUAL'
	): Promise<boolean> {
		try {
			const position = positionManager.getPosition(positionId);
			if (!position) {
				logger.error(`Position not found: ${positionId}`);
				return false;
			}

			// Get order
			const order = await Order.findById(position.orderId);
			if (!order) {
				logger.error(`Order not found for position: ${positionId}`);
				return false;
			}

			// Get wallet
			const wallet = await B_Wallet.getById(order.walletId.toString());
			if (!wallet) {
				logger.error(`Wallet not found for position: ${positionId}`);
				return false;
			}

			logger.info(`Executing ${reason} sell for position ${positionId}...`);

			// Get actual token balance from blockchain
			let tokenAmountWei: string;
			try {
				tokenAmountWei = await getTokenBalance(position.token.address, wallet.address);

				// Verify we have tokens to sell
				if (tokenAmountWei === '0' || ethers.BigNumber.from(tokenAmountWei).isZero()) {
					logger.error(`No tokens found in wallet for position ${positionId}`);
					await this.notifyError(order, position, 'No tokens found in wallet');
					return false;
				}
			} catch (error: any) {
				logger.warning(`Failed to get token balance, using stored amount: ${error.message}`);
				// Fallback: use stored amount with proper decimal handling
				const tokenAmountFixed = position.tokenAmount.toFixed(position.token.decimals);
				tokenAmountWei = ethers.utils.parseUnits(tokenAmountFixed, position.token.decimals).toString();
			}

			const tokenAmountStr = ethers.utils.formatUnits(tokenAmountWei, position.token.decimals);

			// Create transaction for queue
			const transaction = new B_Transaction({
				type: TransactionType.SELL,
				wallet,
				token: position.token,
				tokenAmount: tokenAmountStr,
				slippage: order.slippage,
				gasPrice: order.gasFee.gasPrice,
				gasLimit: order.gasFee.gasLimit,
				orderId: order._id.toString(),
				positionId: position._id,
				userId: order.userId.toString(),
				priority: reason === 'STOP_LOSS' ? 100 : 50, // Stop loss has highest priority
			});

			// Queue the transaction
			const txId = transactionQueue.push(transaction);
			logger.info(`🎯 ${reason} transaction queued: ${txId}`);

			// Wait for completion
			const sellResult = await this.waitForTxComplete(transaction, 120000);

			if (!sellResult.success) {
				logger.error(`Sell failed: ${sellResult.error}`);
				await this.notifyError(order, position, `Sell failed: ${sellResult.error}`);
				return false;
			}

			// Close position
			await positionManager.closePosition(
				positionId,
				position.currentPrice,
				sellResult.txHash!
			);

			// Send notification
			await this.notifySell(order, position, reason, sellResult.txHash!);

			logger.success(`${reason} executed for position ${positionId}`);
			return true;
		} catch (error: any) {
			logger.error(`Sell execution failed: ${error.message}`);
			return false;
		}
	}

	/**
	 * Send sell notification to user
	 */
	private async notifySell(
		order: any,
		position: any,
		reason: string,
		txHash: string
	): Promise<void> {
		try {
			const user = await User.findById(order.userId);
			if (!user) return;

			const pnl = position.getPnL();
			const pnlPercent = position.getPnLPercent();
			const emoji = pnl >= 0 ? '🟢' : '🔴';
			const action =
				reason === 'TAKE_PROFIT'
					? '🎯 Take Profit'
					: reason === 'STOP_LOSS'
						? '🛑 Stop Loss'
						: '👤 Manual Sell';

			const message =
				`${emoji} <b>${action} Executed!</b>\n\n` +
				`<b>Order:</b> ${order.name}\n` +
				`<b>Token:</b> ${position.token.symbol || 'Unknown'}\n` +
				`<code>${position.token.address}</code>\n\n` +
				`<b>Entry Price:</b> ${position.buyPrice.toFixed(10)} BNB\n` +
				`<b>Exit Price:</b> ${position.currentPrice.toFixed(10)} BNB\n` +
				`<b>Amount:</b> ${position.tokenAmount.toLocaleString()} tokens\n\n` +
				`<b>P&L:</b> ${pnl >= 0 ? '+' : ''}${pnl.toFixed(6)} BNB (${pnlPercent >= 0 ? '+' : ''
				}${pnlPercent.toFixed(2)}%)\n\n` +
				`<b>TX Hash:</b>\n<code>${txHash}</code>`;

			await bot.sendMessage(user.chatId, message, {
				parse_mode: 'HTML',
			});
		} catch (error: any) {
			logger.error(`Failed to send notification: ${error.message}`);
		}
	}

	/**
	 * Wait for transaction to complete
	 */
	private async waitForTxComplete(transaction: B_Transaction, timeoutMs: number): Promise<any> {
		const startTime = Date.now();

		return new Promise((resolve, reject) => {
			const checkInterval = setInterval(() => {
				const elapsed = Date.now() - startTime;

				if (transaction.status === 'completed') {
					clearInterval(checkInterval);
					resolve({
						success: true,
						txHash: transaction.txHash,
						tokenAmount: transaction.tokenAmount,
					});
				} else if (transaction.status === 'failed') {
					clearInterval(checkInterval);
					reject(new Error(transaction.error || 'Transaction failed'));
				} else if (elapsed >= timeoutMs) {
					clearInterval(checkInterval);
					reject(new Error('Transaction timeout'));
				}
			}, 100); // Check every 100ms
		});
	}

	/**
	 * Send error notification
	 */
	private async notifyError(order: any, position: any, errorMsg: string): Promise<void> {
		try {
			const user = await User.findById(order.userId);
			if (!user) return;

			const message =
				`⚠️ <b>Position Alert</b>\n\n` +
				`<b>Order:</b> ${order.name}\n` +
				`<b>Token:</b> ${position.token.symbol || 'Unknown'}\n` +
				`<code>${position.token.address}</code>\n\n` +
				`<b>Error:</b> ${errorMsg}`;

			await bot.sendMessage(user.chatId, message, {
				parse_mode: 'HTML',
			});
		} catch (error: any) {
			logger.error(`Failed to send error notification: ${error.message}`);
		}
	}

	/**
	 * Get monitor status
	 */
	getStatus(): { isRunning: boolean; positionCount: number; intervalMs: number } {
		return {
			isRunning: this.isRunning,
			positionCount: positionManager.getOpenPositionCount(),
			intervalMs: this.intervalMs,
		};
	}
}

// Singleton instance
export const tpslMonitor = new TPSLMonitor();
