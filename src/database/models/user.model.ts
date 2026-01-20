import mongoose, { Document, Schema, Model } from 'mongoose';

/**
 * User Interface
 */
export interface IUser extends Document {
	chatId: string;
	username?: string;
	firstName?: string;
	lastName?: string;
	activeWalletId?: mongoose.Types.ObjectId;
	settings: {
		notifications: boolean;
		autoStart: boolean;
	};
	createdAt: Date;
	updatedAt: Date;
}

/**
 * User Schema
 */
const UserSchema = new Schema<IUser>(
	{
		chatId: {
			type: String,
			required: true,
			unique: true,
			index: true,
		},
		username: {
			type: String,
			default: null,
		},
		firstName: {
			type: String,
			default: null,
		},
		lastName: {
			type: String,
			default: null,
		},
		activeWalletId: {
			type: Schema.Types.ObjectId,
			ref: 'Wallet',
			default: null,
		},
		settings: {
			notifications: {
				type: Boolean,
				default: true,
			},
			autoStart: {
				type: Boolean,
				default: false,
			},
		},
	},
	{
		timestamps: true,
		versionKey: false,
	}
);

// Indexes for performance
UserSchema.index({ chatId: 1 }, { unique: true });
UserSchema.index({ createdAt: 1 });

// Virtual for full name
UserSchema.virtual('fullName').get(function (this: IUser) {
	if (this.firstName && this.lastName) {
		return `${this.firstName} ${this.lastName}`;
	}
	return this.firstName || this.lastName || this.username || 'Unknown User';
});

// Instance method to get display name
UserSchema.methods.getDisplayName = function (this: IUser): string {
	return this.username || this.firstName || `User ${this.chatId}`;
};

/**
 * User Model
 */
export const User: Model<IUser> = mongoose.model<IUser>('User', UserSchema);
