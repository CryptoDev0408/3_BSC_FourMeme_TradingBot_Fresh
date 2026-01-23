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

			// Load all open positions from database
			const openPositions = await Position.find({ status: 'OPEN' })
				.populate('orderId')
				.populate('userId')
				.populate('walletId');

			for (const pos of openPositions) {
				try {
					const bPosition = new B_Position({
						id: pos._id.toString(),
						orderId: pos.orderId.toString(),
						userId: pos.userId.toString(),
						token: new B_Token({
							address: pos.tokenAddress,
							symbol: pos.tokenSymbol,
							decimals: pos.tokenDecimals,
						}),
						tokenAmount: pos.tokenAmount,
						bnbSpent: pos.buyAmount,
						buyPrice: pos.buyPrice,
						currentPrice: pos.currentPrice || pos.buyPrice,
						status: PositionStatus.OPEN,
						buyTxHash: pos.buyTxHash,
						buyTimestamp: pos.buyTimestamp,
						takeProfitPercent: pos.takeProfitTarget,
						stopLossPercent: pos.stopLossTarget,
						takeProfitEnabled: true,
						stopLossEnabled: true,
					});

					this.positions.set(pos._id.toString(), bPosition);
				} catch (error: any) {
					logger.error(`Failed to load position ${pos._id}: ${error.message}`);
				}
			}

			this.initialized = true;
			logger.success(`Position Manager initialized with ${this.positions.size} open positions`);
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

		// Update in database
		await Position.findByIdAndUpdate(positionId, {
			status: 'CLOSED',
			sellPrice,
			sellTxHash,
			currentPrice: sellPrice,
			pnlPercent: position.getPnLPercent(),
			pnlBnb: position.getPnL(),
			sellTimestamp: new Date(),
		});

		// Remove from memory
		this.positions.delete(positionId);
		logger.info(`Position closed: ${positionId}`);
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
