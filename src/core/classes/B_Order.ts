import { Order, IOrder } from '../../database/models';
import { B_Wallet } from './B_Wallet';
import { B_Position } from './B_Position';
import { logger } from '../../utils/logger';

/**
 * B_Order - Trading Order Class
 * Manages order configuration and positions
 */
export class B_Order {
	public id: string;
	public userId: string;
	public walletId: string;
	public name: string;
	public isActive: boolean;
	public autoBuy: boolean;
	public tradingAmount: number;
	public slippage: number;
	public takeProfitPercent: number;
	public takeProfitEnabled: boolean;
	public stopLossPercent: number;
	public stopLossEnabled: boolean;
	public gasFee: {
		gasPrice: string;
		gasLimit: number;
	};
	public createdAt: Date;
	public updatedAt: Date;
	private positions: Map<string, B_Position> = new Map();

	constructor(order: IOrder) {
		this.id = order._id.toString();
		this.userId = order.userId.toString();
		this.walletId = order.walletId.toString();
		this.name = order.name;
		this.isActive = order.isActive;
		this.autoBuy = order.autoBuy;
		this.tradingAmount = order.tradingAmount;
		this.slippage = order.slippage;
		this.takeProfitPercent = order.takeProfitPercent;
		this.takeProfitEnabled = order.takeProfitEnabled;
		this.stopLossPercent = order.stopLossPercent;
		this.stopLossEnabled = order.stopLossEnabled;
		this.gasFee = order.gasFee;
		this.createdAt = order.createdAt;
		this.updatedAt = order.updatedAt;
	}

	/**
	 * Create new order
	 */
	static async create(
		userId: string,
		walletId: string,
		config?: {
			name?: string;
			tradingAmount?: number;
			slippage?: number;
			takeProfitPercent?: number;
			takeProfitEnabled?: boolean;
			stopLossPercent?: number;
			stopLossEnabled?: boolean;
		}
	): Promise<B_Order | null> {
		try {
			// Get order count for auto-naming
			const orderCount = await Order.countDocuments({ userId });
			const name = config?.name || `Order #${orderCount + 1}`;

			const order = await Order.create({
				userId,
				walletId,
				name,
				isActive: false,
				tradingAmount: config?.tradingAmount ?? 0.01,
				slippage: config?.slippage ?? 10,
				takeProfitPercent: config?.takeProfitPercent ?? 50,
				takeProfitEnabled: config?.takeProfitEnabled ?? true,
				stopLossPercent: config?.stopLossPercent ?? 25,
				stopLossEnabled: config?.stopLossEnabled ?? true,
				gasFee: {
					gasPrice: '5',
					gasLimit: 300000,
				},
			});

			logger.success(`Order created: ${name}`);
			return new B_Order(order);
		} catch (error: any) {
			logger.error('Failed to create order:', error.message);
			return null;
		}
	}

	/**
	 * Get order by ID
	 */
	static async getById(orderId: string, userId?: string): Promise<B_Order | null> {
		try {
			const query: any = { _id: orderId };
			if (userId) query.userId = userId;

			const order = await Order.findOne(query);
			if (!order) return null;
			return new B_Order(order);
		} catch (error: any) {
			logger.error('Failed to get order:', error.message);
			return null;
		}
	}

	/**
	 * Get all orders for user
	 */
	static async getByUserId(userId: string): Promise<B_Order[]> {
		try {
			const orders = await Order.find({ userId }).sort({ createdAt: -1 });
			return orders.map(o => new B_Order(o));
		} catch (error: any) {
			logger.error('Failed to get user orders:', error.message);
			return [];
		}
	}

	/**
	 * Count orders by user ID
	 */
	static async countByUserId(userId: string): Promise<number> {
		try {
			return await Order.countDocuments({ userId });
		} catch (error: any) {
			logger.error('Failed to count orders:', error.message);
			return 0;
		}
	}

	/**
	 * Get wallet instance
	 */
	async getWallet(): Promise<B_Wallet | null> {
		return await B_Wallet.getById(this.walletId);
	}

	/**
	 * Update order configuration
	 */
	async updateConfig(config: Partial<{
		tradingAmount: number;
		slippage: number;
		takeProfitPercent: number;
		takeProfitEnabled: boolean;
		stopLossPercent: number;
		stopLossEnabled: boolean;
		gasFee: { gasPrice: string; gasLimit?: number };
	}>): Promise<boolean> {
		try {
			await Order.findByIdAndUpdate(this.id, config);

			// Update local properties
			if (config.tradingAmount !== undefined) this.tradingAmount = config.tradingAmount;
			if (config.slippage !== undefined) this.slippage = config.slippage;
			if (config.takeProfitPercent !== undefined) this.takeProfitPercent = config.takeProfitPercent;
			if (config.takeProfitEnabled !== undefined) this.takeProfitEnabled = config.takeProfitEnabled;
			if (config.stopLossPercent !== undefined) this.stopLossPercent = config.stopLossPercent;
			if (config.stopLossEnabled !== undefined) this.stopLossEnabled = config.stopLossEnabled;
			if (config.gasFee !== undefined) {
				this.gasFee = { ...this.gasFee, ...config.gasFee };
			}

			return true;
		} catch (error: any) {
			logger.error('Failed to update order config:', error.message);
			return false;
		}
	}

	/**
	 * Toggle order active status
	 */
	async toggleStatus(): Promise<boolean> {
		try {
			const newStatus = !this.isActive;
			await Order.findByIdAndUpdate(this.id, { isActive: newStatus });
			this.isActive = newStatus;

			logger.info(`Order ${this.name} ${newStatus ? 'activated' : 'paused'}`);
			return true;
		} catch (error: any) {
			logger.error('Failed to toggle order status:', error.message);
			return false;
		}
	}

	/**
	 * Activate order
	 */
	async activate(): Promise<boolean> {
		if (this.isActive) return true;
		return await this.toggleStatus();
	}

	/**
	 * Pause order
	 */
	async pause(): Promise<boolean> {
		if (!this.isActive) return true;
		return await this.toggleStatus();
	}

	/**
	 * Toggle autoBuy status
	 */
	async toggleAutoBuy(): Promise<boolean> {
		try {
			const newStatus = !this.autoBuy;
			await Order.findByIdAndUpdate(this.id, { autoBuy: newStatus });
			this.autoBuy = newStatus;

			logger.info(`Order ${this.name} autoBuy ${newStatus ? 'enabled' : 'disabled'}`);
			return true;
		} catch (error: any) {
			logger.error('Failed to toggle autoBuy status:', error.message);
			return false;
		}
	}

	/**
	 * Add position to order
	 */
	addPosition(position: B_Position): void {
		this.positions.set(position.id, position);
	}

	/**
	 * Get all positions
	 */
	getPositions(): B_Position[] {
		return Array.from(this.positions.values());
	}

	/**
	 * Get open positions
	 */
	getOpenPositions(): B_Position[] {
		return this.getPositions().filter(p => p.isOpen());
	}

	/**
	 * Get position by ID
	 */
	getPosition(positionId: string): B_Position | undefined {
		return this.positions.get(positionId);
	}

	/**
	 * Remove position
	 */
	removePosition(positionId: string): boolean {
		return this.positions.delete(positionId);
	}

	/**
	 * Remove order
	 */
	async remove(): Promise<boolean> {
		try {
			await Order.findByIdAndDelete(this.id);
			logger.info(`Order removed: ${this.name}`);
			return true;
		} catch (error: any) {
			logger.error('Failed to remove order:', error.message);
			return false;
		}
	}

	/**
	 * Validate if order can execute trade
	 */
	async canExecuteTrade(): Promise<{ valid: boolean; error?: string }> {
		if (!this.isActive) {
			return { valid: false, error: 'Order is not active' };
		}

		const wallet = await this.getWallet();
		if (!wallet) {
			return { valid: false, error: 'Wallet not found' };
		}

		await wallet.updateBalance();
		if (wallet.balance < this.tradingAmount) {
			return {
				valid: false,
				error: `Insufficient balance. Required: ${this.tradingAmount} BNB, Available: ${wallet.balance} BNB`,
			};
		}

		return { valid: true };
	}

	/**
	 * Get order summary
	 */
	getSummary() {
		const openPositions = this.getOpenPositions();
		const totalPnL = openPositions.reduce((sum, p) => sum + p.getPnL(), 0);
		const totalPnLPercent = openPositions.length > 0
			? openPositions.reduce((sum, p) => sum + p.getPnLPercent(), 0) / openPositions.length
			: 0;

		return {
			id: this.id,
			name: this.name,
			isActive: this.isActive,
			tradingAmount: this.tradingAmount,
			slippage: this.slippage,
			takeProfitPercent: this.takeProfitPercent,
			takeProfitEnabled: this.takeProfitEnabled,
			stopLossPercent: this.stopLossPercent,
			stopLossEnabled: this.stopLossEnabled,
			positionCount: this.positions.size,
			openPositionCount: openPositions.length,
			totalPnL,
			totalPnLPercent,
		};
	}
}
