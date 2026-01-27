import mongoose, { Document, Schema, Model } from 'mongoose';

/**
 * Scanned Token Interface
 */
export interface IScannedToken extends Document {
	address: string;
	name?: string;
	symbol?: string;
	decimals: number;
	totalSupply?: string;
	transactionHash: string;
	blockNumber: number;
	scannedAt: Date;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * Scanned Token Schema
 */
const ScannedTokenSchema = new Schema<IScannedToken>(
	{
		address: {
			type: String,
			required: true,
			unique: true,
			lowercase: true,
			index: true,
		},
		name: {
			type: String,
			default: null,
		},
		symbol: {
			type: String,
			default: null,
		},
		decimals: {
			type: Number,
			required: true,
			default: 18,
		},
		totalSupply: {
			type: String,
			default: null,
		},
		transactionHash: {
			type: String,
			required: true,
		},
		blockNumber: {
			type: Number,
			required: true,
			index: true,
		},
		scannedAt: {
			type: Date,
			required: true,
			default: Date.now,
			index: true,
		},
	},
	{
		timestamps: true,
		versionKey: false,
	}
);

// Indexes
ScannedTokenSchema.index({ scannedAt: -1 });
ScannedTokenSchema.index({ symbol: 1 });

/**
 * Scanned Token Model
 */
export const ScannedToken: Model<IScannedToken> = mongoose.model<IScannedToken>('ScannedToken', ScannedTokenSchema);
