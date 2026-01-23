import { B_Token } from './B_Token';
import { B_Order } from './B_Order';
import { logger } from '../../utils/logger';
import { PositionStatus } from '../../config/constants';

// Export for backward compatibility
export { PositionStatus };

/**
 * B_Position - Position Tracking Class
 * Represents a bought token position from an order
 */
export class B_Position {
	public id: string;
	public orderId: string;
	public userId: string;
	public token: B_Token;
	public tokenAmount: number;
	public bnbSpent: number;
	public buyPrice: number; // BNB per token
	public currentPrice: number;
	public status: PositionStatus;
	public buyTxHash: string;
	public sellTxHash?: string;
	public buyTimestamp: Date;
	public sellTimestamp?: Date;
	public takeProfitPercent: number;
	public stopLossPercent: number;
	public takeProfitEnabled: boolean;
	public stopLossEnabled: boolean;
	public hasPendingSell: boolean = false; // Prevent duplicate sell transactions

	constructor(data: {
		id?: string;
		orderId: string;
		userId: string;
		token: B_Token;
		tokenAmount: number;
		bnbSpent: number;
		buyPrice: number;
		currentPrice?: number;
		status?: PositionStatus;
		buyTxHash: string;
		sellTxHash?: string;
		buyTimestamp?: Date;
		sellTimestamp?: Date;
		takeProfitPercent: number;
		stopLossPercent: number;
		takeProfitEnabled: boolean;
		stopLossEnabled: boolean;
	}) {
		this.id = data.id || `${data.orderId}_${data.token.address}_${Date.now()}`;
		this.orderId = data.orderId;
		this.userId = data.userId;
		this.token = data.token;
		// Ensure tokenAmount is always a number (handle string from DB)
		this.tokenAmount = typeof data.tokenAmount === 'string' ? parseFloat(data.tokenAmount) : data.tokenAmount;
		this.bnbSpent = typeof data.bnbSpent === 'string' ? parseFloat(data.bnbSpent) : data.bnbSpent;
		this.buyPrice = typeof data.buyPrice === 'string' ? parseFloat(data.buyPrice) : data.buyPrice;
		this.currentPrice = data.currentPrice ? (typeof data.currentPrice === 'string' ? parseFloat(data.currentPrice) : data.currentPrice) : this.buyPrice;
		this.status = data.status || PositionStatus.ACTIVE;
		this.buyTxHash = data.buyTxHash;
		this.sellTxHash = data.sellTxHash;
		this.buyTimestamp = data.buyTimestamp || new Date();
		this.sellTimestamp = data.sellTimestamp;
		this.takeProfitPercent = typeof data.takeProfitPercent === 'string' ? parseFloat(data.takeProfitPercent) : data.takeProfitPercent;
		this.stopLossPercent = typeof data.stopLossPercent === 'string' ? parseFloat(data.stopLossPercent) : data.stopLossPercent;
		this.takeProfitEnabled = data.takeProfitEnabled;
		this.stopLossEnabled = data.stopLossEnabled;
	}

	/**
	 * Create position from order buy
	 */
	static async createFromBuy(
		order: B_Order,
		token: B_Token,
		tokenAmount: number,
		bnbSpent: number,
		buyPrice: number,
		txHash: string
	): Promise<B_Position> {
		const position = new B_Position({
			orderId: order.id,
			userId: order.userId,
			token,
			tokenAmount,
			bnbSpent,
			buyPrice,
			buyTxHash: txHash,
			takeProfitPercent: order.takeProfitPercent,
			stopLossPercent: order.stopLossPercent,
			takeProfitEnabled: order.takeProfitEnabled,
			stopLossEnabled: order.stopLossEnabled,
		});

		logger.success(`Position created: ${token.getDisplayName()} - ${tokenAmount} tokens`);
		return position;
	}

	/**
	 * Update current price
	 */
	updatePrice(newPrice: number): void {
		this.currentPrice = newPrice;
	}

	/**
	 * Get current value in BNB
	 */
	getCurrentValue(): number {
		return this.tokenAmount * this.currentPrice;
	}

	/**
	 * Get profit/loss in BNB
	 */
	getPnL(): number {
		return this.getCurrentValue() - this.bnbSpent;
	}

	/**
	 * Get profit/loss percentage
	 */
	getPnLPercent(): number {
		if (this.bnbSpent === 0) return 0;
		return (this.getPnL() / this.bnbSpent) * 100;
	}

	/**
	 * Check if take profit target hit
	 */
	shouldTakeProfit(): boolean {
		if (!this.takeProfitEnabled) return false;
		return this.getPnLPercent() >= this.takeProfitPercent;
	}

	/**
	 * Check if stop loss target hit
	 */
	shouldStopLoss(): boolean {
		if (!this.stopLossEnabled) return false;
		return this.getPnLPercent() <= -this.stopLossPercent;
	}

	/**
	 * Check if should sell (TP or SL triggered)
	 */
	shouldSell(): { should: boolean; reason?: 'TP' | 'SL' } {
		if (this.shouldTakeProfit()) {
			return { should: true, reason: 'TP' };
		}
		if (this.shouldStopLoss()) {
			return { should: true, reason: 'SL' };
		}
		return { should: false };
	}

	/**
	 * Mark position as closed
	 */
	close(sellTxHash: string, bnbReceived: number): void {
		this.status = PositionStatus.CLOSED;
		this.sellTxHash = sellTxHash;
		this.sellTimestamp = new Date();

		const pnl = bnbReceived - this.bnbSpent;
		const pnlPercent = (pnl / this.bnbSpent) * 100;

		logger.success(
			`Position closed: ${this.token.getDisplayName()} - ` +
			`PnL: ${pnl.toFixed(6)} BNB (${pnlPercent.toFixed(2)}%)`
		);
	}

	/**
	 * Get position age in milliseconds
	 */
	getAge(): number {
		return Date.now() - this.buyTimestamp.getTime();
	}

	/**
	 * Get position age in human readable format
	 */
	getAgeFormatted(): string {
		const ageMs = this.getAge();
		const minutes = Math.floor(ageMs / 60000);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (days > 0) return `${days}d ${hours % 24}h`;
		if (hours > 0) return `${hours}h ${minutes % 60}m`;
		return `${minutes}m`;
	}

	/**
	 * Check if position is open/active
	 */
	isOpen(): boolean {
		return this.status === PositionStatus.PENDING ||
			this.status === PositionStatus.ACTIVE ||
			this.status === 'OPEN' as any;
	}

	/**
	 * Serialize to JSON
	 */
	toJSON() {
		return {
			id: this.id,
			orderId: this.orderId,
			userId: this.userId,
			token: this.token.toJSON(),
			tokenAmount: this.tokenAmount,
			bnbSpent: this.bnbSpent,
			buyPrice: this.buyPrice,
			currentPrice: this.currentPrice,
			currentValue: this.getCurrentValue(),
			pnl: this.getPnL(),
			pnlPercent: this.getPnLPercent(),
			status: this.status,
			buyTxHash: this.buyTxHash,
			sellTxHash: this.sellTxHash,
			buyTimestamp: this.buyTimestamp,
			sellTimestamp: this.sellTimestamp,
			age: this.getAgeFormatted(),
			takeProfitPercent: this.takeProfitPercent,
			stopLossPercent: this.stopLossPercent,
			takeProfitEnabled: this.takeProfitEnabled,
			stopLossEnabled: this.stopLossEnabled,
		};
	}
}
