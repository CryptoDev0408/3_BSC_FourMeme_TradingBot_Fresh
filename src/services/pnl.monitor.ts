import { positionManager } from '../core/position/position.manager';
import { B_Wallet } from '../core/classes/B_Wallet';
import { Order, User } from '../database/models';
import { logger } from '../utils/logger';
import { config } from '../config/config';
import { bot } from '../bot';
import { getPriceService } from './price.service';
import { getProvider } from '../core/wallet/wallet.service';
import { B_Trading } from '../core/classes/B_Trading';

interface PositionPNL {
	positionId: string;
	tokenAddress: string;
	tokenSymbol: string;
	buyPrice: number;
	currentPrice: number;
	pnlPercent: number;
	pnlBnb: number;
	shouldTakeProfit: boolean;
	shouldStopLoss: boolean;
}

/**
 * High-Performance PNL Monitoring Engine
 * Optimized for 1500+ positions with batch processing and AMM formula
 */
export class PNLMonitorEngine {
	private intervalMs: number;
	private isRunning: boolean = false;
	private intervalHandle: NodeJS.Timeout | null = null;
	private priceService: any = null;
	private lastCheckTime: number = 0;
	private positionsChecked: number = 0;
	private pricesFetched: number = 0;

	constructor() {
		// Default 2 seconds, customizable via env
		this.intervalMs = config.monitoring.pnlMonitorInterval || 2000;
	}

	/**
	 * Initialize price service
	 */
	private initializePriceService(): void {
		if (!this.priceService) {
			const provider = getProvider();
			this.priceService = getPriceService(provider);
			logger.info('PNL Monitor: Price service initialized');
		}
	}

	/**
	 * Start PNL monitoring engine
	 */
	start(): void {
		if (this.isRunning) {
			logger.warning('PNL Monitor already running');
			return;
		}

		this.initializePriceService();
		this.isRunning = true;
		logger.info(`🚀 PNL Monitor Engine started (interval: ${this.intervalMs}ms)`);
		console.log('\n' + '='.repeat(80));
		console.log('⚡ PNL MONITORING ENGINE STARTED');
		console.log(`⏰ Check Interval: ${this.intervalMs}ms (${this.intervalMs / 1000} seconds)`);
		console.log('📊 Will display PNL updates every cycle...');
		console.log('='.repeat(80) + '\n');

		// Run immediately
		this.monitorAllPositions();

		// Then run on interval
		this.intervalHandle = setInterval(() => {
			this.monitorAllPositions();
		}, this.intervalMs);
	}

	/**
	 * Stop PNL monitoring engine
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

		logger.info('PNL Monitor Engine stopped');
	}

	/**
	 * Main monitoring loop - OPTIMIZED for 1500+ positions
	 */
	private async monitorAllPositions(): Promise<void> {
		const startTime = Date.now();

		try {
			// Get all open positions from memory (fast)
			const positions = positionManager.getAllOpenPositions();

			if (positions.length === 0) {
				console.log(`[${new Date().toLocaleTimeString()}] 📊 PNL Check: No open positions to monitor`); return;
			}

			// Step 1: Extract unique token addresses
			const tokenAddresses = [...new Set(positions.map((p) => p.token.address))];

			// Silently check positions

			// Step 2: Batch fetch all prices (SINGLE OPTIMIZED CALL)
			const prices = await this.priceService.getTokenPricesBatch(tokenAddresses);

			if (prices.size === 0) {
				logger.warning('No prices fetched, skipping this cycle');
				return;
			}

			this.pricesFetched = prices.size;

			// Step 3: Process positions in batches (parallel)
			const batchSize = 50; // Process 50 positions at a time
			const batches = this.chunkArray(positions, batchSize);

			const allPnlData: PositionPNL[] = [];

			for (const batch of batches) {
				const batchPromises = batch.map((position) =>
					this.processPosition(position, prices)
				);
				const batchResults = await Promise.all(batchPromises);
				allPnlData.push(...batchResults.filter((r) => r !== null) as PositionPNL[]);
			}

			// Step 4: Log PNL summary
			this.logPNLSummary(allPnlData);

			// Step 5: Execute TP/SL for triggered positions
			// DISABLED: Sell execution commented out for now
			// await this.executeTriggeredPositions(allPnlData);

			// Stats
			const elapsed = Date.now() - startTime;
			this.positionsChecked = positions.length;
			this.lastCheckTime = Date.now();

			// Completed silently
		} catch (error: any) {
			logger.error(`PNL Monitor error: ${error.message}`);
		}
	}

	/**
	 * Process individual position
	 */
	private async processPosition(
		position: any,
		prices: Map<string, number>
	): Promise<PositionPNL | null> {
		try {
			const tokenAddress = position.token.address;
			const currentPrice = prices.get(tokenAddress);

			if (!currentPrice || currentPrice === 0) {
				return null;
			}

			// Update position price in memory and database
			await positionManager.updatePositionPrice(position.id, currentPrice);

			// Calculate PNL
			const pnlPercent = position.getPnLPercent();
			const pnlBnb = position.getPnL();

			// Check TP/SL triggers
			const shouldTakeProfit = position.shouldTakeProfit();
			const shouldStopLoss = position.shouldStopLoss();

			return {
				positionId: position.id,
				tokenAddress,
				tokenSymbol: position.token.symbol || 'Unknown',
				buyPrice: position.buyPrice,
				currentPrice,
				pnlPercent,
				pnlBnb,
				shouldTakeProfit,
				shouldStopLoss,
			};
		} catch (error: any) {
			logger.error(`Failed to process position ${position.id}: ${error.message}`);
			return null;
		}
	}

	/**
	 * Log PNL summary to console (enhanced format)
	 */
	private async logPNLSummary(pnlData: PositionPNL[]): Promise<void> {
		if (pnlData.length === 0) {
			return;
		}

		try {
			// Count unique active orders
			const orderIds = new Set<string>();
			for (const p of pnlData) {
				const position = positionManager.getPosition(p.positionId);
				if (position) {
					orderIds.add(position.orderId);
				}
			}

			// Header
			console.log(`\nActive Orders: ${orderIds.size}, Total Positions: ${pnlData.length}`);

			// Display each position
			for (const p of pnlData) {
				try {
					const position = positionManager.getPosition(p.positionId);
					if (!position) continue;

					const order = await Order.findById(position.orderId).populate('walletId').populate('userId');
					if (!order) continue;

					const user = order.userId as any;
					const wallet = order.walletId as any;

					const username = user?.username || user?.chatId || 'Unknown';
					const walletAddr = wallet?.address || 'Unknown';
					const orderId = order._id.toString().substring(0, 8);
					const pnlSign = p.pnlPercent >= 0 ? '+' : '';

					console.log(
						`[${username}] -> ${orderId}... -> ${walletAddr} -> ${p.tokenSymbol} (${position.token.address}) -> ` +
						`TP: ${position.takeProfitPercent}%, SL: ${position.stopLossPercent}% -> ` +
						`PNL: ${pnlSign}${p.pnlPercent.toFixed(2)}%`
					);
				} catch (error) {
					// Skip on error
				}
			}
		} catch (error: any) {
			logger.error(`Failed to log PNL summary: ${error.message}`);
		}
	}

	/**
	 * Execute TP/SL for triggered positions
	 */
	private async executeTriggeredPositions(pnlData: PositionPNL[]): Promise<void> {
		const triggered = pnlData.filter((p) => p.shouldTakeProfit || p.shouldStopLoss);

		if (triggered.length === 0) {
			return;
		}

		logger.info(`🎯 Executing ${triggered.length} triggered positions...`);

		// Execute in parallel (max 5 at a time to avoid overload)
		const batchSize = 5;
		const batches = this.chunkArray(triggered, batchSize);

		for (const batch of batches) {
			const executePromises = batch.map((pnl) =>
				this.executeSell(
					pnl.positionId,
					pnl.shouldTakeProfit ? 'TAKE_PROFIT' : 'STOP_LOSS'
				)
			);
			await Promise.all(executePromises);
		}
	}

	/**
	 * Execute sell for TP/SL
	 */
	private async executeSell(
		positionId: string,
		reason: 'TAKE_PROFIT' | 'STOP_LOSS'
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
			logger.debug(`Wallet address: ${wallet.address}, Order: ${order._id}`);

			// Test wallet access before selling
			try {
				const ethersWallet = wallet.getEthersWallet();
				logger.debug(`Wallet ethers instance created successfully for ${ethersWallet.address}`);
			} catch (walletError: any) {
				logger.error(`Failed to access wallet: ${walletError.message}`);
				await this.notifyError(order, position, `Wallet access failed: ${walletError.message}`);
				return false;
			}

			// Execute sell on PancakeSwap
			// Use toFixed(0) to avoid scientific notation for large numbers
			const tokenAmountStr = typeof position.tokenAmount === 'number'
				? position.tokenAmount.toFixed(0)
				: position.tokenAmount.toString();

			const sellResult = await B_Trading.sell({
				wallet,
				token: position.token,
				tokenAmount: tokenAmountStr,
				slippage: order.slippage,
				gasPrice: order.gasFee.gasPrice,
				gasLimit: order.gasFee.gasLimit,
			});

			if (!sellResult.success) {
				const errorMsg = sellResult.error || 'Unknown error';
				logger.error(`❌ Sell failed: ${errorMsg}`);
				await this.notifyError(order, position, `Sell failed: ${errorMsg}`);
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
				`<b>P&L:</b> ${pnl >= 0 ? '+' : ''}${pnl.toFixed(6)} BNB (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)\n\n` +
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
	 * Utility: Split array into chunks
	 */
	private chunkArray<T>(array: T[], size: number): T[][] {
		const chunks: T[][] = [];
		for (let i = 0; i < array.length; i += size) {
			chunks.push(array.slice(i, i + size));
		}
		return chunks;
	}

	/**
	 * Get monitor status
	 */
	getStatus(): {
		isRunning: boolean;
		positionCount: number;
		intervalMs: number;
		lastCheckTime: number;
		positionsChecked: number;
		pricesFetched: number;
	} {
		return {
			isRunning: this.isRunning,
			positionCount: positionManager.getOpenPositionCount(),
			intervalMs: this.intervalMs,
			lastCheckTime: this.lastCheckTime,
			positionsChecked: this.positionsChecked,
			pricesFetched: this.pricesFetched,
		};
	}

	/**
	 * Update monitoring interval (runtime configuration)
	 */
	setInterval(intervalMs: number): void {
		if (intervalMs < 1000) {
			logger.warning('Interval too low, minimum is 1000ms');
			intervalMs = 1000;
		}

		this.intervalMs = intervalMs;
		logger.info(`PNL Monitor interval updated to ${intervalMs}ms`);

		// Restart if running
		if (this.isRunning) {
			this.stop();
			this.start();
		}
	}
}

// Singleton instance
export const pnlMonitorEngine = new PNLMonitorEngine();
