import mongoose, { Document, Schema, Model } from 'mongoose';

/**
 * Order Interface
 */
export interface IOrder extends Document {
	userId: mongoose.Types.ObjectId;
	walletId: mongoose.Types.ObjectId;
	name: string;
	isActive: boolean;
	tradingAmount: number;
	takeProfitPercent: number;
	takeProfitEnabled: boolean;
	stopLossPercent: number;
	stopLossEnabled: boolean;
	gasFee: {
		gasPrice: string;
		gasLimit: number;
	};
	slippage: number;
	manualTokenAddress?: string;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * Order Schema
 */
const OrderSchema = new Schema<IOrder>(
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
		name: {
			type: String,
			required: true,
			default: 'Order',
		},
		isActive: {
			type: Boolean,
			default: false,
		},
		tradingAmount: {
			type: Number,
			required: true,
			min: 0.001,
			default: 0.01,
		},
		takeProfitPercent: {
			type: Number,
			min: 0,
			max: 10000,
			default: 50,
		},
		takeProfitEnabled: {
			type: Boolean,
			default: true,
		},
		stopLossPercent: {
			type: Number,
			min: 0,
			max: 100,
			default: 25,
		},
		stopLossEnabled: {
			type: Boolean,
			default: true,
		},
		gasFee: {
			gasPrice: {
				type: String,
				default: '5',
			},
			gasLimit: {
				type: Number,
				default: 300000,
			},
		},
		slippage: {
			type: Number,
			min: 0.1,
			max: 50,
			default: 10,
		},
		manualTokenAddress: {
			type: String,
			default: null,
			lowercase: true,
		},
	},
	{
		timestamps: true,
		versionKey: false,
	}
);

// Compound indexes for performance
OrderSchema.index({ userId: 1, isActive: 1 });
OrderSchema.index({ walletId: 1, isActive: 1 });

// Instance method to format order summary
OrderSchema.methods.getSummary = function (this: IOrder): string {
	const tpStatus = this.takeProfitEnabled ? `✅ ${this.takeProfitPercent}%` : '❌ OFF';
	const slStatus = this.stopLossEnabled ? `✅ ${this.stopLossPercent}%` : '❌ OFF';
	const status = this.isActive ? '🟢 ACTIVE' : '🔴 INACTIVE';

	return `
Status: ${status}
Trading Amount: ${this.tradingAmount} BNB
Take Profit: ${tpStatus}
Stop Loss: ${slStatus}
Gas Price: ${this.gasFee.gasPrice} Gwei
  `.trim();
};

/**
 * Order Model
 */
export const Order: Model<IOrder> = mongoose.model<IOrder>('Order', OrderSchema);
