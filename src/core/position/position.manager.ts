import { Position } from '../../database/models';
import { B_Position, PositionStatus } from '../classes/B_Position';
import { B_Token } from '../classes/B_Token';
import { logger } from '../../utils/logger';

/**
 * Position Manager
 * Manages positions in memory and database
 */
export class PositionManager {
	// In-memory cache for fast access
	private positions: Map<string, B_Position> = new Map();
	private initialized: boolean = false;

	/**
	 * Initialize position manager - load open positions from database
	 */
	async initialize(): Promise<void> {
		try {
			if (this.initialized) {
				logger.warning('Position manager already initialized');
			}

			logger.info('Initializing Position Manager...');

			// Load all open/active positions from database
			const openPositions = await Position.find({ status: { $in: ['PENDING', 'OPEN', 'ACTIVE'] } })
				.populate('walletId')
				.populate('orderId'); // Populate order to get TP/SL enabled flags

			for (const pos of openPositions) {
				try {
					// Note: Database already stores normalized token amount (not wei)
					// The amount comes from swapResult which is already formatted by ethers.formatUnits()

					// MIGRATION FIX: Old positions may have been double-normalized (very small values)
					// If tokenAmount is suspiciously small (< 0.001), it's likely from old buggy code
					// Multiply by 10^decimals to fix it
					let tokenAmount = pos.tokenAmount;
					if (tokenAmount < 0.001 && tokenAmount > 0) {
						logger.warning(`⚠️ Position ${pos._id} has suspiciously small tokenAmount (${tokenAmount}), applying migration fix...`);
						tokenAmount = tokenAmount * Math.pow(10, pos.tokenDecimals);
						logger.info(`✅ Fixed tokenAmount: ${tokenAmount}`);
					}

					// Get order to read TP/SL enabled flags
					const order = pos.orderId as any;
					const takeProfitEnabled = order?.takeProfitEnabled !== undefined ? order.takeProfitEnabled : true;
					const stopLossEnabled = order?.stopLossEnabled !== undefined ? order.stopLossEnabled : true;

					const bPosition = new B_Position({
						id: pos._id.toString(),
						orderId: order?._id?.toString() || pos.orderId.toString(), // Extract _id from populated order
						userId: pos.userId.toString(),
						token: new B_Token({
							address: pos.tokenAddress,
							symbol: pos.tokenSymbol,
							decimals: pos.tokenDecimals,
						}),
						tokenAmount: tokenAmount,  // Use potentially fixed amount
						bnbSpent: pos.buyAmount,
						buyPrice: pos.buyPrice,
						currentPrice: pos.currentPrice || pos.buyPrice,
						status: pos.status as PositionStatus,
						buyTxHash: pos.buyTxHash,
						buyTimestamp: pos.buyTimestamp,
						takeProfitPercent: pos.takeProfitTarget,
						stopLossPercent: pos.stopLossTarget,
						takeProfitEnabled: takeProfitEnabled,  // Read from order
						stopLossEnabled: stopLossEnabled,      // Read from order
						// NEW: Load multiple TP/SL levels from position
						takeProfitLevels: pos.takeProfitLevels || [],
						stopLossLevels: pos.stopLossLevels || [],
						triggeredTakeProfitLevels: pos.triggeredTakeProfitLevels || [],
						triggeredStopLossLevels: pos.triggeredStopLossLevels || [],
					});

					this.positions.set(bPosition.id, bPosition);
				} catch (error: any) {
					logger.error(`Failed to load position ${pos._id}: ${error.message}`);
				}
			}

			this.initialized = true;
			logger.success(`✅ Position Manager initialized with ${this.positions.size} open positions`);
		} catch (error: any) {
			logger.error(`Failed to initialize Position Manager: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Add new position
	 */
	async addPosition(position: B_Position): Promise<void> {
		if (!this.initialized) {
			await this.initialize();
		}

		this.positions.set(position.id, position);
		logger.info(`Position added to memory: ${position.id}`);
	}

	/**
	 * Get position by ID
	 */
	getPosition(positionId: string): B_Position | undefined {
		return this.positions.get(positionId);
	}

	/**
	 * Get all positions for an order
	 */
	getPositionsByOrder(orderId: string): B_Position[] {
		const positions: B_Position[] = [];
		for (const position of this.positions.values()) {
			if (position.orderId === orderId) {
				positions.push(position);
			}
		}
		return positions;
	}

	/**
	 * Get all positions for a user
	 */
	getPositionsByUser(userId: string): B_Position[] {
		const positions: B_Position[] = [];
		for (const position of this.positions.values()) {
			if (position.userId === userId) {
				positions.push(position);
			}
		}
		return positions;
	}

	/**
	 * Get all open positions
	 */
	getAllOpenPositions(): B_Position[] {
		return Array.from(this.positions.values()).filter(p => p.isOpen());
	}

	/**
	 * Get count of open positions
	 */
	getOpenPositionCount(): number {
		return this.positions.size;
	}

	/**
	 * Update position price
	 */
	async updatePositionPrice(positionId: string, newPrice: number): Promise<void> {
		const position = this.positions.get(positionId);
		if (!position) {
			logger.warning(`Position not found in memory: ${positionId}`);
			return;
		}

		position.updatePrice(newPrice);

		// Update in database
		await Position.findByIdAndUpdate(positionId, {
			currentPrice: newPrice,
			pnlPercent: position.getPnLPercent(),
			pnlBnb: position.getPnL(),
			lastPriceUpdate: new Date(),
		});
	}

	/**
	 * Close position
	 */
	async closePosition(positionId: string, sellPrice: number, sellTxHash: string): Promise<void> {
		const position = this.positions.get(positionId);
		if (!position) {
			logger.warning(`Position not found in memory: ${positionId}`);
			return;
		}

		position.close(sellTxHash, sellPrice);

		// Delete position from database completely
		await Position.findByIdAndDelete(positionId);

		// Remove from memory immediately
		this.positions.delete(positionId);
		logger.success(`Position closed and deleted: ${positionId}`);
	}

	/**
	 * Get all positions (for debugging)
	 */
	getAllPositions(): B_Position[] {
		return Array.from(this.positions.values());
	}
}

// Singleton instance
export const positionManager = new PositionManager();
