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
	triggeredTpLevels?: Array<{ index: number; pnlPercent: number; sellPercent: number }>;
	triggeredSlLevels?: Array<{ index: number; pnlPercent: number; sellPercent: number }>;
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

			// Step 2: Include ALL positions (manual positions now monitored for PNL)
			// NOTE: Manual buy positions are now set as isManual: false for testing
			const dbPositionMap = new Map(dbPositions.map(p => [p._id.toString(), p]));
			const nonManualActivePositions = activePositions.filter(p => {
				const dbPos = dbPositionMap.get(p.id);
				// Including all positions - manual flag is now false for testing
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
			const triggeredTpLevels: Array<{ index: number; pnlPercent: number; sellPercent: number }> = [];
			const triggeredSlLevels: Array<{ index: number; pnlPercent: number; sellPercent: number }> = [];

			if (order) {
				// CRITICAL FIX #1: Check in-memory triggered levels FIRST, then database
				// This prevents checking the same level twice in one PNL cycle
				const memoryTriggeredTpLevels = position.triggeredTakeProfitLevels || [];
				const memoryTriggeredSlLevels = position.triggeredStopLossLevels || [];

				// Also get database state to ensure consistency across cycles
				const dbPosition = await Position.findById(position.id);
				const dbTriggeredTpLevels = dbPosition?.triggeredTakeProfitLevels || [];
				const dbTriggeredSlLevels = dbPosition?.triggeredStopLossLevels || [];

				// Merge both sources (union of memory and DB)
				const allTriggeredTpLevels = [...new Set([...memoryTriggeredTpLevels, ...dbTriggeredTpLevels])];
				const allTriggeredSlLevels = [...new Set([...memoryTriggeredSlLevels, ...dbTriggeredSlLevels])];

				// Check MULTIPLE TP/SL levels (new system)
				if (order.takeProfitLevels && order.takeProfitLevels.length > 0) {
					// Check each TP level that hasn't been triggered yet
					for (let i = 0; i < order.takeProfitLevels.length; i++) {
						const level = order.takeProfitLevels[i];
						// Skip if already triggered (check BOTH memory and DB)
						if (allTriggeredTpLevels.includes(i)) {
							continue;
						}
						// Check if PNL reached this level
						if (pnlPercent >= level.pnlPercent) {
							triggeredTpLevels.push({ index: i, pnlPercent: level.pnlPercent, sellPercent: level.sellPercent });
							shouldTakeProfit = true;
						}
					}
				} else if (order.takeProfitEnabled && order.takeProfitPercent) {
					// Backwards compatibility: old single TP system
					shouldTakeProfit = pnlPercent >= order.takeProfitPercent;
				}

				if (order.stopLossLevels && order.stopLossLevels.length > 0) {
					// Check each SL level that hasn't been triggered yet
					for (let i = 0; i < order.stopLossLevels.length; i++) {
						const level = order.stopLossLevels[i];
						// Skip if already triggered (check BOTH memory and DB)
						if (allTriggeredSlLevels.includes(i)) {
							continue;
						}
						// Check if PNL dropped to this level (negative)
						if (pnlPercent <= -level.pnlPercent) {
							triggeredSlLevels.push({ index: i, pnlPercent: level.pnlPercent, sellPercent: level.sellPercent });
							shouldStopLoss = true;
						}
					}
				} else if (order.stopLossEnabled && order.stopLossPercent) {
					// Backwards compatibility: old single SL system
					shouldStopLoss = pnlPercent <= -order.stopLossPercent;
				}

				// Check Time Limit (only for non-manual positions)
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
				triggeredTpLevels,
				triggeredSlLevels,
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

					// FIX BUG #2: Build TP/SL status string showing ALL levels with triggered flags
					let tpStatusStr = '';
					let slStatusStr = '';

					// Get triggered levels from database
					const dbPosition = await Position.findById(position.id);
					const triggeredTPs = dbPosition?.triggeredTakeProfitLevels || [];
					const triggeredSLs = dbPosition?.triggeredStopLossLevels || [];

					// Build TP status string
					if (order.takeProfitLevels && order.takeProfitLevels.length > 0) {
						const tpParts = order.takeProfitLevels.map((level, idx) => {
							const emoji = triggeredTPs.includes(idx) ? '✅' : '⬜';
							return `TP${idx + 1}:${emoji}${level.pnlPercent}%/${level.sellPercent}%`;
						});
						tpStatusStr = tpParts.join(', ');
					} else if (order.takeProfitEnabled) {
						tpStatusStr = `TP: ${order.takeProfitPercent}% (ON)`;
					} else {
						tpStatusStr = 'TP: OFF';
					}

					// Build SL status string
					if (order.stopLossLevels && order.stopLossLevels.length > 0) {
						const slParts = order.stopLossLevels.map((level, idx) => {
							const emoji = triggeredSLs.includes(idx) ? '✅' : '⬜';
							return `SL${idx + 1}:${emoji}-${level.pnlPercent}%/${level.sellPercent}%`;
						});
						slStatusStr = slParts.join(', ');
					} else if (order.stopLossEnabled) {
						slStatusStr = `SL: ${order.stopLossPercent}% (ON)`;
					} else {
						slStatusStr = 'SL: OFF';
					}

					console.log(
						`[${username}] -> ${orderId}... -> ${walletAddr} -> ${p.tokenSymbol} (${position.token.address}) -> ` +
						`${tpStatusStr} | ${slStatusStr} -> ` +
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
	 * Execute TP/SL/Time Limit for triggered positions (supports multiple levels)
	 */
	private async executeTriggeredPositions(pnlData: PositionPNL[]): Promise<void> {
		const triggered = pnlData.filter((p) => p.shouldTakeProfit || p.shouldStopLoss || p.shouldTimeLimitSell);

		if (triggered.length === 0) {
			return;
		}

		logger.info(`🎯 Executing ${triggered.length} triggered positions...`);

		// Execute sequentially to avoid race conditions with position updates
		for (const pnl of triggered) {
			try {
				// Handle Time Limit (always 100% sell)
				if (pnl.shouldTimeLimitSell) {
					await this.executeSell(pnl.positionId, 'TIME_LIMIT');
					continue;
				}

				// Handle Multiple TP levels (partial sells)
				if (pnl.triggeredTpLevels && pnl.triggeredTpLevels.length > 0) {
					for (const level of pnl.triggeredTpLevels) {
						await this.executePartialSell(
							pnl.positionId,
							'TAKE_PROFIT',
							level.index,
							level.sellPercent,
							level.pnlPercent
						);
					}
					continue;
				}

				// Handle Multiple SL levels (partial sells)
				if (pnl.triggeredSlLevels && pnl.triggeredSlLevels.length > 0) {
					for (const level of pnl.triggeredSlLevels) {
						await this.executePartialSell(
							pnl.positionId,
							'STOP_LOSS',
							level.index,
							level.sellPercent,
							level.pnlPercent
						);
					}
					continue;
				}

				// Backwards compatibility: single TP/SL (100% sell)
				if (pnl.shouldTakeProfit) {
					await this.executeSell(pnl.positionId, 'TAKE_PROFIT');
				} else if (pnl.shouldStopLoss) {
					await this.executeSell(pnl.positionId, 'STOP_LOSS');
				}
			} catch (error: any) {
				logger.error(`Failed to execute triggered position ${pnl.positionId}: ${error.message}`);
			}
		}
	}

	/**
	 * Execute partial sell for specific TP/SL level
	 */
	private async executePartialSell(
		positionId: string,
		reason: 'TAKE_PROFIT' | 'STOP_LOSS',
		levelIndex: number,
		sellPercent: number,
		pnlPercent: number
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

			// Mark as having pending sell
			position.hasPendingSell = true;

			// CRITICAL: Mark level as triggered IMMEDIATELY in database (atomic operation)
			// This prevents race conditions where multiple cycles detect the same level
			const updateField = reason === 'TAKE_PROFIT'
				? 'triggeredTakeProfitLevels'
				: 'triggeredStopLossLevels';

			try {
				const updateResult = await Position.findByIdAndUpdate(
					positionId,
					{
						$addToSet: { [updateField]: levelIndex }
					},
					{ new: true }
				);

				if (!updateResult) {
					logger.error(`Database position not found: ${positionId}`);
					position.hasPendingSell = false;
					return false;
				}

				// Check if level was already in the array (means another process beat us to it)
				const triggeredArray = reason === 'TAKE_PROFIT'
					? updateResult.triggeredTakeProfitLevels || []
					: updateResult.triggeredStopLossLevels || [];

				// Count how many times this level appears (should be 1 after $addToSet)
				const occurrences = triggeredArray.filter(idx => idx === levelIndex).length;
				if (occurrences > 1) {
					// This shouldn't happen with $addToSet, but just in case
					logger.warning(`Level ${levelIndex} found ${occurrences} times, possible race condition detected`);
				}

				// Update in-memory position immediately
				if (reason === 'TAKE_PROFIT') {
					if (!position.triggeredTakeProfitLevels) position.triggeredTakeProfitLevels = [];
					if (!position.triggeredTakeProfitLevels.includes(levelIndex)) {
						position.triggeredTakeProfitLevels.push(levelIndex);
					}
				} else {
					if (!position.triggeredStopLossLevels) position.triggeredStopLossLevels = [];
					if (!position.triggeredStopLossLevels.includes(levelIndex)) {
						position.triggeredStopLossLevels.push(levelIndex);
					}
				}

				logger.info(`✅ Level ${levelIndex} marked as triggered in database`);
			} catch (dbError: any) {
				logger.error(`Failed to mark level as triggered: ${dbError.message}`);
				position.hasPendingSell = false;
				return false;
			}

			// Get order
			const order = await Order.findById(position.orderId);
			if (!order) {
				logger.error(`Order not found for position: ${positionId}`);
				position.hasPendingSell = false;
				return false;
			}

			// Get wallet
			const wallet = await B_Wallet.getById(order.walletId.toString());
			if (!wallet) {
				logger.error(`Wallet not found for position: ${positionId}`);
				position.hasPendingSell = false;
				return false;
			}

			const levelName = reason === 'TAKE_PROFIT' ? `TP${levelIndex + 1}` : `SL${levelIndex + 1}`;
			logger.info(`Executing ${levelName} (${sellPercent}% at ${pnlPercent >= 0 ? '+' : ''}${pnlPercent}%) for position ${positionId}...`);

			// Get ethers wallet
			let ethersWallet;
			try {
				ethersWallet = wallet.getEthersWallet();
			} catch (walletError: any) {
				logger.error(`Failed to access wallet: ${walletError.message}`);
				position.hasPendingSell = false;
				await this.notifyError(order, position, `Wallet access failed: ${walletError.message}`);
				return false;
			}

			// Check BNB balance for gas
			try {
				const bnbBalance = await ethersWallet.getBalance();
				const ethers = require('ethers');
				const bnbBalanceFormatted = parseFloat(ethers.utils.formatEther(bnbBalance));

				// Calculate estimated gas cost from order settings
				// gasPrice is in gwei (string), convert to wei (BigNumber)
				const gasPriceWei = ethers.utils.parseUnits(String(order.gasFee.gasPrice || '5'), 'gwei');
				const estimatedGasCost = parseFloat(ethers.utils.formatEther(
					ethers.BigNumber.from(order.gasFee.gasLimit).mul(gasPriceWei)
				));

				// Require 1.5x the estimated gas for safety margin
				const requiredBnb = estimatedGasCost * 1.5;

				if (bnbBalanceFormatted < requiredBnb) {
					const errorMsg = `Insufficient BNB for gas: ${bnbBalanceFormatted.toFixed(6)} BNB (need ${requiredBnb.toFixed(6)} BNB, shortfall: ${(requiredBnb - bnbBalanceFormatted).toFixed(6)} BNB)`;
					logger.error(errorMsg);
					position.hasPendingSell = false;
					await this.notifyError(order, position, errorMsg);
					return false;
				}
				logger.info(`BNB balance: ${bnbBalanceFormatted.toFixed(6)} BNB (required: ${requiredBnb.toFixed(6)} BNB, sufficient ✓)`);
			} catch (balanceError: any) {
				logger.warning(`Failed to check BNB balance: ${balanceError.message}, proceeding anyway...`);
			}

			// Get actual token balance
			const ethers = require('ethers');
			const tokenContract = new ethers.Contract(
				position.token.address,
				['function balanceOf(address) view returns (uint256)'],
				ethersWallet
			);

			let actualBalance;
			try {
				actualBalance = await tokenContract.balanceOf(wallet.address);
				const balanceFormatted = ethers.utils.formatUnits(actualBalance, position.token.decimals);
				logger.info(`Current token balance: ${balanceFormatted} ${position.token.symbol}`);

				if (actualBalance.isZero()) {
					logger.error('Token balance is zero, cannot sell');
					position.hasPendingSell = false;
					await this.notifyError(order, position, 'Token balance is zero');
					return false;
				}
			} catch (balanceError: any) {
				logger.error(`Failed to get token balance: ${balanceError.message}`);
				position.hasPendingSell = false;
				await this.notifyError(order, position, `Failed to get token balance: ${balanceError.message}`);
				return false;
			}

			// Calculate partial sell amount
			const sellAmount = actualBalance.mul(sellPercent).div(100);
			const sellAmountStr = ethers.utils.formatUnits(sellAmount, position.token.decimals);
			logger.info(`Selling ${sellPercent}% = ${sellAmountStr} ${position.token.symbol}`);

			// PRE-CHECK: Verify token approval before queueing partial sell
			logger.info('🔍 Pre-checking token approval for partial sell...');
			try {
				const ROUTER_ADDRESS = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
				const tokenContractPreCheck = new ethers.Contract(
					position.token.address,
					['function allowance(address owner, address spender) view returns (uint256)'],
					ethersWallet
				);

				const currentAllowance = await tokenContractPreCheck.allowance(wallet.address, ROUTER_ADDRESS);
				logger.info(`Current allowance: ${ethers.utils.formatUnits(currentAllowance, position.token.decimals)} ${position.token.symbol}`);
				logger.info(`Amount to sell: ${sellAmountStr} ${position.token.symbol}`);

				if (currentAllowance.lt(sellAmount)) {
					logger.warning(`⚠️  Pre-approval check: Allowance insufficient (${ethers.utils.formatUnits(currentAllowance, position.token.decimals)} < ${sellAmountStr}), approval will be needed`);
				} else {
					logger.success(`✅ Pre-approval check: Allowance sufficient (${ethers.utils.formatUnits(currentAllowance, position.token.decimals)} >= ${sellAmountStr})`);
				}
			} catch (preCheckError: any) {
				logger.warning(`Pre-approval check failed: ${preCheckError.message}, will check again during execution`);
			}

			// Create transaction for queue
			const transaction = new B_Transaction({
				type: TransactionType.SELL,
				wallet,
				token: position.token,
				tokenAmount: sellAmountStr,
				slippage: order.slippage,
				gasPrice: order.gasFee.gasPrice,
				gasLimit: order.gasFee.gasLimit,
				orderId: order._id.toString(),
				positionId: position.id,
				userId: order.userId.toString(),
				priority: reason === 'STOP_LOSS' ? 100 : 50,
			});

			// Queue the transaction
			const txId = transactionQueue.push(transaction);
			logger.info(`🎯 Partial sell transaction queued: ${txId}`);

			// Wait for transaction to complete
			const sellResult = await this.waitForTransaction(transaction, 120000);

			if (!sellResult.success) {
				const errorMsg = sellResult.error || 'Unknown error';
				logger.error(`❌ Partial sell failed: ${errorMsg}`);
				position.hasPendingSell = false;
				await this.notifyError(order, position, `${levelName} sell failed: ${errorMsg}`);
				return false;
			}

			if (!sellResult.txHash) {
				logger.error('❌ No transaction hash returned');
				position.hasPendingSell = false;
				await this.notifyError(order, position, 'No transaction hash returned');
				return false;
			}

			// Verify transaction receipt
			try {
				const provider = getProvider();
				const receipt = await provider.getTransactionReceipt(sellResult.txHash);

				if (!receipt) {
					logger.error('❌ Transaction receipt not found');
					position.hasPendingSell = false;
					await this.notifyError(order, position, 'Transaction receipt not found');
					return false;
				}

				if (receipt.status !== 1) {
					logger.error('❌ Transaction reverted (status = 0)');
					position.hasPendingSell = false;
					await this.notifyError(order, position, 'Transaction reverted');
					return false;
				}

				logger.success(`✅ TX confirmed: Block #${receipt.blockNumber}`);
			} catch (receiptError: any) {
				logger.error(`Failed to verify transaction receipt: ${receiptError.message}`);
			}

			// Update database: update token amount only (level already marked as triggered earlier)
			const newBalance = await tokenContract.balanceOf(wallet.address);
			const newBalanceFormatted = parseFloat(ethers.utils.formatUnits(newBalance, position.token.decimals));

			// CRITICAL FIX: Calculate new cost basis (buyAmount) proportionally
			// When selling X%, the remaining position's cost basis should be (100-X)% of original
			const percentRemaining = 100 - sellPercent; // e.g., if sold 40%, remaining is 60%
			const newBuyAmount = position.buyAmount * (percentRemaining / 100);

			logger.info(`💰 Cost basis adjustment: ${position.buyAmount.toFixed(6)} BNB → ${newBuyAmount.toFixed(6)} BNB (${percentRemaining}% remaining)`);

			await Position.findByIdAndUpdate(positionId, {
				tokenAmount: newBalanceFormatted,
				buyAmount: newBuyAmount, // Update cost basis proportionally
				lastPriceUpdate: new Date(),
			});

			// Update in-memory position (CRITICAL for PNL calculation)
			position.tokenAmount = newBalanceFormatted;
			position.buyAmount = newBuyAmount;
			position.bnbSpent = newBuyAmount; // Keep bnbSpent in sync with buyAmount
			logger.info(`💾 Position updated in memory: ${newBalanceFormatted} ${position.token.symbol}, Cost: ${newBuyAmount.toFixed(6)} BNB`);

			logger.success(`✅ ${levelName} executed: Sold ${sellPercent}%, Remaining: ${newBalanceFormatted} tokens`);

			// Check if position should be closed (tokenAmount near zero)
			if (newBalanceFormatted < 0.0001 || sellPercent >= 100) {
				logger.info(`Token amount near zero (${newBalanceFormatted}), closing position...`);
				await positionManager.closePosition(positionId, position.currentPrice, sellResult.txHash!);
				logger.success(`✅ Position closed: ${positionId}`);
			} else {
				// Clear pending sell flag
				position.hasPendingSell = false;
			}

			// Send notification
			await this.notifyPartialSell(order, position, reason, levelName, sellPercent, pnlPercent, sellResult.txHash!);

			return true;
		} catch (error: any) {
			logger.error(`Partial sell execution failed: ${error.message}`);
			const position = positionManager.getPosition(positionId);
			if (position) {
				position.hasPendingSell = false;
			}
			return false;
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

			// PRE-CHECK: Verify token approval before queueing
			logger.info('🔍 Pre-checking token approval...');
			try {
				const ROUTER_ADDRESS = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
				const tokenContractPreCheck = new ethers.Contract(
					position.token.address,
					['function allowance(address owner, address spender) view returns (uint256)'],
					ethersWallet
				);

				const currentAllowance = await tokenContractPreCheck.allowance(wallet.address, ROUTER_ADDRESS);
				logger.info(`Current allowance: ${ethers.utils.formatUnits(currentAllowance, position.token.decimals)} ${position.token.symbol}`);
				logger.info(`Amount to sell: ${tokenAmountStr} ${position.token.symbol}`);

				if (currentAllowance.lt(actualBalance)) {
					logger.warning('⚠️  Pre-approval check: Allowance insufficient, approval will be needed');
				} else {
					logger.success('✅ Pre-approval check: Allowance sufficient');
				}
			} catch (preCheckError: any) {
				logger.warning(`Pre-approval check failed: ${preCheckError.message}, will check again during execution`);
			}

			// Ensure gas parameters are properly formatted
			const gasPriceStr = String(order.gasFee.gasPrice || '5');
			const gasLimitNum = Number(order.gasFee.gasLimit || 300000);

			// Create transaction for queue
			const transaction = new B_Transaction({
				type: TransactionType.SELL,
				wallet,
				token: position.token,
				tokenAmount: tokenAmountStr,
				slippage: order.slippage,
				gasPrice: gasPriceStr,
				gasLimit: gasLimitNum,
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
	 * Send partial sell notification to user
	 */
	private async notifyPartialSell(
		order: any,
		position: any,
		reason: 'TAKE_PROFIT' | 'STOP_LOSS',
		levelName: string,
		sellPercent: number,
		pnlPercent: number,
		txHash: string
	): Promise<void> {
		try {
			const user = await User.findById(order.userId);
			if (!user) return;

			const emoji = reason === 'TAKE_PROFIT' ? '🎯' : '🛑';
			const action = reason === 'TAKE_PROFIT' ? 'Take Profit' : 'Stop Loss';

			const message =
				`${emoji} <b>${action} Level Triggered!</b>\n\n` +
				`<b>Level:</b> ${levelName} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent}%)\n` +
				`<b>Sold:</b> ${sellPercent}% of position\n` +
				`<b>Remaining:</b> ${position.tokenAmount.toLocaleString()} tokens\n\n` +
				`<b>Order:</b> ${order.name}\n` +
				`<b>Token:</b> ${position.token.symbol || 'Unknown'}\n` +
				`<code>${position.token.address}</code>\n\n` +
				`<b>Current Price:</b> ${position.currentPrice.toFixed(10)} BNB\n` +
				`<b>Current P&L:</b> ${position.getPnL() >= 0 ? '+' : ''}${position.getPnL().toFixed(6)} BNB (${position.getPnLPercent() >= 0 ? '+' : ''}${position.getPnLPercent().toFixed(2)}%)\n\n` +
				`<b>TX Hash:</b>\n<code>${txHash}</code>`;

			await bot.sendMessage(user.chatId, message, {
				parse_mode: 'HTML',
			});
		} catch (error: any) {
			logger.error(`Failed to send partial sell notification: ${error.message}`);
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
