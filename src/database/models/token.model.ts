import mongoose, { Document, Schema, Model } from 'mongoose';

/**
 * Token Interface
 */
export interface IToken extends Document {
	address: string;
	name?: string;
	symbol?: string;
	decimals: number;
	totalSupply?: string;
	pairAddress?: string;
	liquidityBnb?: number;
	isPancakeswapV2: boolean;
	isVerified: boolean;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * Token Schema
 */
const TokenSchema = new Schema<IToken>(
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
		pairAddress: {
			type: String,
			default: null,
			lowercase: true,
		},
		liquidityBnb: {
			type: Number,
			default: 0,
		},
		isPancakeswapV2: {
			type: Boolean,
			default: false,
		},
		isVerified: {
			type: Boolean,
			default: false,
		},
	},
	{
		timestamps: true,
		versionKey: false,
	}
);

// Indexes
TokenSchema.index({ symbol: 1 });
TokenSchema.index({ isPancakeswapV2: 1 });

/**
 * Token Model
 */
export const Token: Model<IToken> = mongoose.model<IToken>('Token', TokenSchema);
