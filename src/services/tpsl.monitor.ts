import { positionManager } from '../core/position/position.manager';
import { B_Trading } from '../core/classes/B_Trading';
import { B_Wallet } from '../core/classes/B_Wallet';
import { Order, User } from '../database/models';
import { logger } from '../utils/logger';
import { config } from '../config/config';
import { bot } from '../bot';

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

			// Execute sell on PancakeSwap
			const sellResult = await B_Trading.sell({
				wallet,
				token: position.token,
				tokenAmount: position.tokenAmount.toString(),
				slippage: order.slippage,
				gasPrice: order.gasFee.gasPrice,
				gasLimit: order.gasFee.gasLimit,
			});

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
