import mongoose, { Document, Schema, Model } from 'mongoose';
import { TransactionType, TransactionStatus } from '../../config/constants';

/**
 * Transaction Interface
 */
export interface ITransaction extends Document {
	userId: mongoose.Types.ObjectId;
	walletId: mongoose.Types.ObjectId;
	positionId?: mongoose.Types.ObjectId;

	type: TransactionType;
	txHash: string;

	tokenAddress?: string;
	tokenSymbol?: string;

	amountBnb: number;
	amountToken?: number;
	gasFee: number;

	status: TransactionStatus;
	errorMessage?: string;

	timestamp: Date;
	createdAt: Date;
}

/**
 * Transaction Schema
 */
const TransactionSchema = new Schema<ITransaction>(
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
		positionId: {
			type: Schema.Types.ObjectId,
			ref: 'Position',
			default: null,
		},
		type: {
			type: String,
			enum: Object.values(TransactionType),
			required: true,
			index: true,
		},
		txHash: {
			type: String,
			required: true,
			unique: true,
			index: true,
		},
		tokenAddress: {
			type: String,
			default: null,
			lowercase: true,
		},
		tokenSymbol: {
			type: String,
			default: null,
		},
		amountBnb: {
			type: Number,
			required: true,
		},
		amountToken: {
			type: Number,
			default: null,
		},
		gasFee: {
			type: Number,
			required: true,
			default: 0,
		},
		status: {
			type: String,
			enum: Object.values(TransactionStatus),
			default: TransactionStatus.PENDING,
			index: true,
		},
		errorMessage: {
			type: String,
			default: null,
		},
		timestamp: {
			type: Date,
			required: true,
			index: true,
			default: Date.now,
		},
	},
	{
		timestamps: { createdAt: true, updatedAt: false },
		versionKey: false,
	}
);

// Indexes for performance
TransactionSchema.index({ userId: 1, timestamp: -1 });
TransactionSchema.index({ walletId: 1, timestamp: -1 });
TransactionSchema.index({ txHash: 1 }, { unique: true });
TransactionSchema.index({ type: 1, status: 1 });
TransactionSchema.index({ positionId: 1 });

// Instance method to get BSCScan URL
TransactionSchema.methods.getBscScanUrl = function (this: ITransaction): string {
	return `https://bscscan.com/tx/${this.txHash}`;
};

// Instance method to get formatted transaction info
TransactionSchema.methods.getFormattedInfo = function (this: ITransaction): string {
	const typeEmoji = {
		[TransactionType.BUY]: '🟢',
		[TransactionType.SELL]: '🔴',
		[TransactionType.TRANSFER]: '↔️',
		[TransactionType.WITHDRAW]: '💸',
	};

	const statusEmoji = {
		[TransactionStatus.PENDING]: '⏳',
		[TransactionStatus.SUCCESS]: '✅',
		[TransactionStatus.FAILED]: '❌',
	};

	let info = `
${typeEmoji[this.type]} <b>${this.type}</b> ${statusEmoji[this.status]}
💵 Amount: ${this.amountBnb.toFixed(4)} BNB
⛽ Gas Fee: ${this.gasFee.toFixed(6)} BNB
🔗 TX: <code>${this.txHash}</code>
`;

	if (this.tokenAddress) {
		info += `\n🪙 Token: ${this.tokenSymbol || 'Unknown'}`;
		info += `\n📍 <code>${this.tokenAddress}</code>`;
	}

	if (this.amountToken) {
		info += `\n🎯 Amount: ${this.amountToken.toFixed(2)} tokens`;
	}

	if (this.errorMessage) {
		info += `\n❌ Error: ${this.errorMessage}`;
	}

	return info.trim();
};

/**
 * Transaction Model
 */
export const Transaction: Model<ITransaction> = mongoose.model<ITransaction>('Transaction', TransactionSchema);
