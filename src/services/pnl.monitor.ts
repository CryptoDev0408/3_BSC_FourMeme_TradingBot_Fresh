import { positionManager } from '../core/position/position.manager';
import { B_Wallet } from '../core/classes/B_Wallet';
import { Order, User, Position } from '../database/models';
import { logger } from '../utils/logger';
import { config } from '../config/config';
import { bot } from '../bot';
import { getPriceService } from './price.service';
import { getProvider } from '../core/wallet/wallet.service';
import { B_Transaction, TransactionType, transactionQueue } from '../core/classes';

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
	shouldTimeLimitSell: boolean;
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
			// Get all open positions from DATABASE (always fresh)
			// Note: We load ALL positions (including manual) to activate PENDING ones
			const dbPositions = await Position.find({
				status: { $in: ['PENDING', 'OPEN', 'ACTIVE'] }
			}).populate('orderId');

			if (dbPositions.length === 0) {
				console.log(`[${new Date().toLocaleTimeString()}] 📊 PNL Check: No open positions to monitor`);
				return;
			}

			// Get memory positions and filter to only those that exist in DB
			const dbPositionIds = new Set(dbPositions.map(p => p._id.toString()));
			const memoryPositions = positionManager.getAllOpenPositions();
			const allPositions = memoryPositions.filter(p => dbPositionIds.has(p.id));

			if (allPositions.length === 0) {
				console.log(`[${new Date().toLocaleTimeString()}] 📊 PNL Check: No positions in memory matching database`);
				return;
			}

			console.log(`[${new Date().toLocaleTimeString()}] 📊 Checking ${allPositions.length} position(s)...`);

			// Separate PENDING and ACTIVE positions
			const pendingPositions = allPositions.filter(p => p.status === 'PENDING');
			// EXCLUDE manual positions from ACTIVE monitoring (for TP/SL auto-sell)
			const activePositions = allPositions.filter(p => (p.status === 'ACTIVE' || p.status === 'OPEN'));

			// Step 1: Process PENDING positions - check token balance
			if (pendingPositions.length > 0) {
				await this.processPendingPositions(pendingPositions);
			}

			// Step 2: Filter out manual positions from TP/SL auto-sell
			const dbPositionMap = new Map(dbPositions.map(p => [p._id.toString(), p]));
			const nonManualActivePositions = activePositions.filter(p => {
				const dbPos = dbPositionMap.get(p.id);
				return dbPos && !dbPos.isManual;
			});

			// Step 3: Filter positions to only those with ACTIVE orders
			const positionOrderIds = new Set(nonManualActivePositions.map(p => p.orderId));
			const activeOrders = await Order.find({
				_id: { $in: Array.from(positionOrderIds) },
				isActive: true
			}).select('_id');

			const activeOrderIds = new Set(activeOrders.map(o => o._id.toString()));
			const positions = nonManualActivePositions.filter(p => activeOrderIds.has(p.orderId));

			if (positions.length === 0) {
				console.log(`[${new Date().toLocaleTimeString()}] 📊 PNL Check: No non-manual positions with active orders`);
				return;
			}

			// Step 4: Extract unique token addresses for price fetching
			const tokenAddresses = [...new Set(positions.map((p) => p.token.address))];

			// Silently check positions

			// Step 5: Batch fetch all prices (SINGLE OPTIMIZED CALL)
			const prices = await this.priceService.getTokenPricesBatch(tokenAddresses);

			if (prices.size === 0) {
				logger.warning('No prices fetched, skipping this cycle');
				return;
			}

			this.pricesFetched = prices.size;

			// Step 6: Process positions in batches (parallel)
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

			// Step 7: Log PNL summary
			this.logPNLSummary(allPnlData);

			// Step 8: Execute TP/SL for triggered positions (AUTO-SELL)
			await this.executeTriggeredPositions(allPnlData);

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
	 * Process PENDING positions - check token balance and activate when balance confirmed
	 */
	private async processPendingPositions(pendingPositions: any[]): Promise<void> {
		const provider = getProvider();

		for (const position of pendingPositions) {
			try {
				const tokenContract = new (await import('ethers')).ethers.Contract(
					position.token.address,
					['function balanceOf(address) view returns (uint256)'],
					provider
				);

				// Get wallet from database position (has walletId)
				const dbPosition = await Position.findById(position.id).populate('walletId');
				if (!dbPosition || !dbPosition.walletId) {
					logger.warning(`Wallet not found for PENDING position ${position.id}`);
					continue;
				}

				const walletDoc = dbPosition.walletId as any;
				const walletAddress = walletDoc.address;

				// Check token balance
				const balance = await tokenContract.balanceOf(walletAddress);
				const balanceFormatted = (await import('ethers')).ethers.utils.formatUnits(balance, position.token.decimals);
				const balanceNumber = parseFloat(balanceFormatted);

				if (balanceNumber > 0) {
					logger.success(`✅ ${position.token.symbol}: ${balanceFormatted} tokens confirmed`);

					// Update position in database
					await Position.findByIdAndUpdate(position.id, {
						tokenAmount: balanceNumber,
						status: 'ACTIVE',
						lastPriceUpdate: new Date(),
					});

					// Update in memory
					position.tokenAmount = balanceNumber;
					position.status = 'ACTIVE';

					logger.info(`🎯 Position ${position.id} activated with ${balanceNumber} tokens`);
				} else {
					// Still waiting for balance
					logger.debug(`⏳ PENDING position ${position.id} still waiting for balance...`);
				}
			} catch (error: any) {
				logger.error(`Failed to check balance for PENDING position ${position.id}: ${error.message}`);
			}
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

			// Get current order to check TP/SL and Time Limit settings (dynamic values)
			const order = await Order.findById(position.orderId);
			let shouldTakeProfit = false;
			let shouldStopLoss = false;
			let shouldTimeLimitSell = false;

			if (order) {
				// Check TP/SL with current order values
				if (order.takeProfitEnabled && order.takeProfitPercent) {
					shouldTakeProfit = pnlPercent >= order.takeProfitPercent;
				}
				if (order.stopLossEnabled && order.stopLossPercent) {
					shouldStopLoss = pnlPercent <= -order.stopLossPercent;
				}

				// Check Time Limit (only for non-manual positions)
				// Get position from database to check isManual flag
				const dbPosition = await Position.findById(position.id);
				if (order.timeLimitEnabled && dbPosition && !dbPosition.isManual) {
					const timeElapsedMs = Date.now() - position.buyTimestamp.getTime();
					const timeElapsedSec = timeElapsedMs / 1000;
					shouldTimeLimitSell = timeElapsedSec >= order.timeLimitSeconds;
				}
			}

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
				shouldTimeLimitSell,
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

					// Get current TP/SL from order (dynamic values)
					const currentTP = order.takeProfitPercent || 0;
					const currentSL = order.stopLossPercent || 0;
					const tpStatus = order.takeProfitEnabled ? 'ON' : 'OFF';
					const slStatus = order.stopLossEnabled ? 'ON' : 'OFF';

					console.log(
						`[${username}] -> ${orderId}... -> ${walletAddr} -> ${p.tokenSymbol} (${position.token.address}) -> ` +
						`TP: ${currentTP}% (${tpStatus}), SL: ${currentSL}% (${slStatus}) -> ` +
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
	 * Wait for a transaction to complete
	 */
	private async waitForTransaction(transaction: B_Transaction, timeoutMs: number): Promise<any> {
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
	 * Execute TP/SL/Time Limit for triggered positions
	 */
	private async executeTriggeredPositions(pnlData: PositionPNL[]): Promise<void> {
		const triggered = pnlData.filter((p) => p.shouldTakeProfit || p.shouldStopLoss || p.shouldTimeLimitSell);

		if (triggered.length === 0) {
			return;
		}

		logger.info(`🎯 Executing ${triggered.length} triggered positions...`);

		// Execute in parallel (max 5 at a time to avoid overload)
		const batchSize = 5;
		const batches = this.chunkArray(triggered, batchSize);

		for (const batch of batches) {
			const executePromises = batch.map((pnl) => {
				let reason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TIME_LIMIT';
				if (pnl.shouldTakeProfit) {
					reason = 'TAKE_PROFIT';
				} else if (pnl.shouldStopLoss) {
					reason = 'STOP_LOSS';
				} else {
					reason = 'TIME_LIMIT';
				}
				return this.executeSell(pnl.positionId, reason);
			});
			await Promise.all(executePromises);
		}
	}

	/**
	 * Execute sell for TP/SL/Time Limit
	 */
	private async executeSell(
		positionId: string,
		reason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TIME_LIMIT'
	): Promise<boolean> {
		try {
			const position = positionManager.getPosition(positionId);
			if (!position) {
				logger.error(`Position not found: ${positionId}`);
				return false;
			}

			// Check if already has pending sell transaction
			if (position.hasPendingSell) {
				logger.debug(`Position ${positionId} already has pending sell, skipping...`);
				return false;
			}

			// Mark as having pending sell to prevent duplicate transactions
			position.hasPendingSell = true;

			// Get order
			const order = await Order.findById(position.orderId);
			if (!order) {
				logger.error(`Order not found for position: ${positionId}`);
				position.hasPendingSell = false; // Clear flag on error
				return false;
			}

			// Get wallet
			const wallet = await B_Wallet.getById(order.walletId.toString());
			if (!wallet) {
				logger.error(`Wallet not found for position: ${positionId}`);
				position.hasPendingSell = false; // Clear flag on error
				return false;
			}

			logger.info(`Executing ${reason} sell for position ${positionId}...`);
			logger.debug(`Wallet address: ${wallet.address}, Order: ${order._id}`);

			// Test wallet access before selling
			let ethersWallet;
			try {
				ethersWallet = wallet.getEthersWallet();
				logger.debug(`Wallet ethers instance created successfully for ${ethersWallet.address}`);
			} catch (walletError: any) {
				logger.error(`Failed to access wallet: ${walletError.message}`);
				position.hasPendingSell = false; // Clear flag on error
				await this.notifyError(order, position, `Wallet access failed: ${walletError.message}`);
				return false;
			}

			// Get actual token balance from wallet (sell 100%)
			const ethers = require('ethers');
			const tokenContract = new ethers.Contract(
				position.token.address,
				['function balanceOf(address) view returns (uint256)'],
				ethersWallet
			);

			let actualBalance;
			try {
				actualBalance = await tokenContract.balanceOf(wallet.address);
				logger.info(`Actual token balance: ${ethers.utils.formatUnits(actualBalance, position.token.decimals)} ${position.token.symbol}`);

				if (actualBalance.isZero()) {
					logger.error('Token balance is zero, cannot sell');
					position.hasPendingSell = false; // Clear flag - nothing to sell
					await this.notifyError(order, position, 'Token balance is zero');
					return false;
				}
			} catch (balanceError: any) {
				logger.error(`Failed to get token balance: ${balanceError.message}`);
				position.hasPendingSell = false; // Clear flag on error
				await this.notifyError(order, position, `Failed to get token balance: ${balanceError.message}`);
				return false;
			}

			// Sell 100% of actual balance
			const tokenAmountStr = ethers.utils.formatUnits(actualBalance, position.token.decimals);

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
				positionId: position.id,
				userId: order.userId.toString(),
				priority: reason === 'STOP_LOSS' ? 100 : 50, // Stop loss has higher priority
			});

			// Queue the transaction
			const txId = transactionQueue.push(transaction);
			logger.info(`🎯 Sell transaction queued: ${txId}`);

			// Wait for transaction to complete (with timeout)
			const sellResult = await this.waitForTransaction(transaction, 120000); // 120 second timeout

			if (!sellResult.success) {
				const errorMsg = sellResult.error || 'Unknown error';
				logger.error(`❌ Sell failed: ${errorMsg}`);
				position.hasPendingSell = false; // Clear flag on failure
				await this.notifyError(order, position, `Sell failed: ${errorMsg}`);
				return false;
			}

			// Verify transaction was actually executed
			if (!sellResult.txHash) {
				logger.error('❌ No transaction hash returned');
				position.hasPendingSell = false; // Clear flag on failure
				await this.notifyError(order, position, 'No transaction hash returned');
				return false;
			}

			// Double-check transaction receipt
			try {
				const provider = getProvider();
				const receipt = await provider.getTransactionReceipt(sellResult.txHash);

				if (!receipt) {
					logger.error('❌ Transaction receipt not found');
					position.hasPendingSell = false; // Clear flag on failure
					await this.notifyError(order, position, 'Transaction receipt not found');
					return false;
				}

				if (receipt.status !== 1) {
					logger.error('❌ Transaction reverted (status = 0)');
					position.hasPendingSell = false; // Clear flag on failure
					await this.notifyError(order, position, 'Transaction reverted');
					return false;
				}

				logger.success(`✅ TX confirmed: Block #${receipt.blockNumber}`);
			} catch (receiptError: any) {
				logger.error(`Failed to verify transaction receipt: ${receiptError.message}`);
				// Continue anyway since transaction queue reported success
			}

			// Close position and remove from memory
			logger.info(`Closing position ${positionId}...`);
			await positionManager.closePosition(
				positionId,
				position.currentPrice,
				sellResult.txHash!
			);

			// Verify position was removed from memory
			const stillExists = positionManager.getPosition(positionId);
			if (stillExists) {
				logger.error(`⚠️ Position ${positionId} still exists in memory after close!`);
			} else {
				logger.success(`✅ Position closed: ${positionId}`);
			}

			// Send notification
			await this.notifySell(order, position, reason, sellResult.txHash!);

			logger.success(`✅ ${reason} executed: ${positionId}`);
			// Note: hasPendingSell flag is cleared when position is removed from memory
			return true;
		} catch (error: any) {
			logger.error(`Sell execution failed: ${error.message}`);
			// Clear flag on error
			const position = positionManager.getPosition(positionId);
			if (position) {
				position.hasPendingSell = false;
			}
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
						: reason === 'TIME_LIMIT'
							? '⏱ Time Limit'
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
