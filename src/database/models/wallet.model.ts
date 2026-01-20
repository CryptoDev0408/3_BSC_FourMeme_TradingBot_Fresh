import mongoose, { Document, Schema, Model } from 'mongoose';

/**
 * Wallet Interface
 */
export interface IWallet extends Document {
	userId: mongoose.Types.ObjectId;
	name: string;
	address: string;
	encryptedPrivateKey: string;
	isActive: boolean;
	balance: {
		bnb: number;
		lastUpdated: Date;
	};
	createdAt: Date;
	updatedAt: Date;
}

/**
 * Wallet Schema
 */
const WalletSchema = new Schema<IWallet>(
	{
		userId: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
			index: true,
		},
		name: {
			type: String,
			required: true,
			maxlength: 20,
			default: function (this: IWallet) {
				return `Wallet #${Date.now().toString().slice(-6)}`;
			},
		},
		address: {
			type: String,
			required: true,
			unique: true,
			index: true,
			lowercase: true,
		},
		encryptedPrivateKey: {
			type: String,
			required: true,
			select: false, // Don't include in queries by default for security
		},
		isActive: {
			type: Boolean,
			default: true,
		},
		balance: {
			bnb: {
				type: Number,
				default: 0,
			},
			lastUpdated: {
				type: Date,
				default: Date.now,
			},
		},
	},
	{
		timestamps: true,
		versionKey: false,
	}
);

// Compound indexes for performance
WalletSchema.index({ userId: 1, isActive: 1 });
WalletSchema.index({ address: 1 }, { unique: true });
WalletSchema.index({ userId: 1, createdAt: -1 });

// Instance method to format address
WalletSchema.methods.getShortAddress = function (this: IWallet): string {
	return `${this.address.slice(0, 6)}...${this.address.slice(-4)}`;
};

// Instance method to check if balance needs update
WalletSchema.methods.needsBalanceUpdate = function (this: IWallet, cacheTtl: number = 60000): boolean {
	const now = Date.now();
	const lastUpdate = this.balance.lastUpdated.getTime();
	return now - lastUpdate > cacheTtl;
};

/**
 * Wallet Model
 */
export const Wallet: Model<IWallet> = mongoose.model<IWallet>('Wallet', WalletSchema);
