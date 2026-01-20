import mongoose, { Document, Schema, Model } from 'mongoose';
import { PositionStatus } from '../../config/constants';

/**
 * Position Interface
 */
export interface IPosition extends Document {
	userId: mongoose.Types.ObjectId;
	walletId: mongoose.Types.ObjectId;
	orderId: mongoose.Types.ObjectId;
	tokenAddress: string;
	tokenSymbol: string;
	tokenName: string;
	tokenDecimals: number;

	buyTxHash: string;
	buyPrice: number;
	buyPriceUsd: number;
	buyAmount: number;
	tokenAmount: number;
	buyTimestamp: Date;

	currentPrice: number;
	currentPriceUsd: number;
	lastPriceUpdate: Date;

	pnlPercent: number;
	pnlBnb: number;
	pnlUsd: number;

	sellTxHash?: string;
	sellPrice?: number;
	sellAmount?: number;
	sellTimestamp?: Date;

	status: PositionStatus;

	takeProfitTarget: number;
	stopLossTarget: number;

	createdAt: Date;
	updatedAt: Date;
}

/**
 * Position Schema
 */
const PositionSchema = new Schema<IPosition>(
	{
		userId: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
			index: true,
		},
		walletId: {
			type: Schema.Types.ObjectId,
			ref: 'Wallet',
			required: true,
			index: true,
		},
		orderId: {
			type: Schema.Types.ObjectId,
			ref: 'Order',
			required: true,
		},
		tokenAddress: {
			type: String,
			required: true,
			index: true,
			lowercase: true,
		},
		tokenSymbol: {
			type: String,
			required: true,
		},
		tokenName: {
			type: String,
			required: true,
		},
		tokenDecimals: {
			type: Number,
			required: true,
		},
		buyTxHash: {
			type: String,
			required: true,
		},
		buyPrice: {
			type: Number,
			required: true,
		},
		buyPriceUsd: {
			type: Number,
			default: 0,
		},
		buyAmount: {
			type: Number,
			required: true,
		},
		tokenAmount: {
			type: Number,
			required: true,
		},
		buyTimestamp: {
			type: Date,
			required: true,
			index: true,
		},
		currentPrice: {
			type: Number,
			default: 0,
		},
		currentPriceUsd: {
			type: Number,
			default: 0,
		},
		lastPriceUpdate: {
			type: Date,
			default: Date.now,
		},
		pnlPercent: {
			type: Number,
			default: 0,
		},
		pnlBnb: {
			type: Number,
			default: 0,
		},
		pnlUsd: {
			type: Number,
			default: 0,
		},
		sellTxHash: {
			type: String,
			default: null,
		},
		sellPrice: {
			type: Number,
			default: null,
		},
		sellAmount: {
			type: Number,
			default: null,
		},
		sellTimestamp: {
			type: Date,
			default: null,
		},
		status: {
			type: String,
			enum: Object.values(PositionStatus),
			default: PositionStatus.ACTIVE,
			index: true,
		},
		takeProfitTarget: {
			type: Number,
			default: 0,
		},
		stopLossTarget: {
			type: Number,
			default: 0,
		},
	},
	{
		timestamps: true,
		versionKey: false,
	}
);

// Compound indexes for performance
PositionSchema.index({ userId: 1, status: 1 });
PositionSchema.index({ walletId: 1, status: 1 });
PositionSchema.index({ tokenAddress: 1, status: 1 });
PositionSchema.index({ userId: 1, createdAt: -1 });

// Instance method to calculate PNL
PositionSchema.methods.calculatePnl = function (this: IPosition): void {
	if (this.currentPrice > 0 && this.buyPrice > 0) {
		this.pnlPercent = ((this.currentPrice - this.buyPrice) / this.buyPrice) * 100;
		this.pnlBnb = (this.currentPrice - this.buyPrice) * this.tokenAmount;
		this.pnlUsd = this.pnlBnb * this.currentPriceUsd;
	}
};

// Instance method to check if TP/SL triggered
PositionSchema.methods.shouldTriggerTakeProfit = function (this: IPosition): boolean {
	return this.takeProfitTarget > 0 && this.pnlPercent >= this.takeProfitTarget;
};

PositionSchema.methods.shouldTriggerStopLoss = function (this: IPosition): boolean {
	return this.stopLossTarget > 0 && this.pnlPercent <= -this.stopLossTarget;
};

// Instance method to get formatted position info
PositionSchema.methods.getFormattedInfo = function (this: IPosition): string {
	const pnlEmoji = this.pnlPercent >= 0 ? '📈' : '📉';
	const pnlSign = this.pnlPercent >= 0 ? '+' : '';

	return `
💰 <b>${this.tokenSymbol}</b> (${this.tokenName})
📍 Address: <code>${this.tokenAddress}</code>

💵 Bought: ${this.buyAmount.toFixed(4)} BNB @ ${this.buyPrice.toFixed(10)}
🪙 Tokens: ${this.tokenAmount.toFixed(2)}
📊 Current: ${this.currentPrice.toFixed(10)} BNB

${pnlEmoji} PNL: ${pnlSign}${this.pnlPercent.toFixed(2)}% (${pnlSign}${this.pnlBnb.toFixed(4)} BNB)
${pnlEmoji} USD PNL: $${pnlSign}${this.pnlUsd.toFixed(2)}

🎯 TP Target: ${this.takeProfitTarget}%
🛑 SL Target: ${this.stopLossTarget}%
  `.trim();
};

/**
 * Position Model
 */
export const Position: Model<IPosition> = mongoose.model<IPosition>('Position', PositionSchema);
