import { ethers } from 'ethers';
import { Wallet, IWallet, User } from '../../database/models';
import { encryptPrivateKey, decryptPrivateKey } from '../../utils/encryption';
import { isValidPrivateKey, isValidAddress, validateWalletName } from '../../utils/validation';
import { logger } from '../../utils/logger';
import { ERROR_MESSAGES, SUCCESS_MESSAGES, MAX_WALLET_NAME_LENGTH } from '../../config/constants';
import mongoose from 'mongoose';

/**
 * Wallet Manager
 * Handles wallet CRUD operations
 */

/**
 * Generate a new wallet for a user
 * @param userId - User's MongoDB ID
 * @param walletName - Optional custom name for the wallet
 * @returns Created wallet
 */
export async function generateWallet(
	userId: string,
	walletName?: string
): Promise<{ success: boolean; wallet?: IWallet; error?: string }> {
	try {
		// Generate new wallet using ethers
		const newWallet = ethers.Wallet.createRandom();

		// Get wallet count to determine next wallet number
		const walletCount = await getWalletCount(userId);
		const name = walletName || `w${walletCount + 1}`;

		// Validate name if provided
		if (walletName) {
			const nameValidation = validateWalletName(walletName);
			if (!nameValidation.valid) {
				return { success: false, error: nameValidation.error };
			}
		}

		// Encrypt private key
		const encryptedKey = encryptPrivateKey(newWallet.privateKey);

		// Create wallet in database
		const wallet = await Wallet.create({
			userId: new mongoose.Types.ObjectId(userId),
			name,
			address: newWallet.address.toLowerCase(),
			encryptedPrivateKey: encryptedKey,
			isActive: true,
			balance: {
				bnb: 0,
				lastUpdated: new Date(),
			},
		});

		// Set as active wallet if user has none
		const user = await User.findById(userId);
		if (user && !user.activeWalletId) {
			user.activeWalletId = wallet._id as mongoose.Types.ObjectId;
			await user.save();
		}

		logger.success(`Wallet generated: ${wallet.address}`);

		return { success: true, wallet };
	} catch (error: any) {
		logger.error('Failed to generate wallet:', error.message);
		return { success: false, error: ERROR_MESSAGES.DATABASE_ERROR };
	}
}

/**
 * Import an existing wallet
 * @param userId - User's MongoDB ID
 * @param privateKey - Private key to import
 * @param walletName - Optional custom name
 * @returns Imported wallet
 */
export async function importWallet(
	userId: string,
	privateKey: string,
	walletName?: string
): Promise<{ success: boolean; wallet?: IWallet; error?: string }> {
	try {
		// Validate private key
		if (!isValidPrivateKey(privateKey)) {
			return { success: false, error: ERROR_MESSAGES.INVALID_PRIVATE_KEY };
		}

		// Create wallet from private key
		const ethWallet = new ethers.Wallet(privateKey);
		const address = ethWallet.address.toLowerCase();

		// Check if wallet already exists
		const existingWallet = await Wallet.findOne({ address });
		if (existingWallet) {
			return { success: false, error: ERROR_MESSAGES.ALREADY_EXISTS };
		}

		// Get wallet count to determine next wallet number
		const walletCount = await getWalletCount(userId);
		const name = walletName || `w${walletCount + 1}`;

		// Validate name if provided
		if (walletName) {
			const nameValidation = validateWalletName(walletName);
			if (!nameValidation.valid) {
				return { success: false, error: nameValidation.error };
			}
		}

		// Encrypt private key
		const encryptedKey = encryptPrivateKey(privateKey);

		// Create wallet in database
		const wallet = await Wallet.create({
			userId: new mongoose.Types.ObjectId(userId),
			name,
			address,
			encryptedPrivateKey: encryptedKey,
			isActive: true,
			balance: {
				bnb: 0,
				lastUpdated: new Date(),
			},
		});

		// Set as active wallet if user has none
		const user = await User.findById(userId);
		if (user && !user.activeWalletId) {
			user.activeWalletId = wallet._id as mongoose.Types.ObjectId;
			await user.save();
		}

		logger.success(`Wallet imported: ${wallet.address}`);

		return { success: true, wallet };
	} catch (error: any) {
		logger.error('Failed to import wallet:', error.message);
		return { success: false, error: ERROR_MESSAGES.DATABASE_ERROR };
	}
}

/**
 * Remove a wallet
 * @param walletId - Wallet's MongoDB ID
 * @param userId - User's MongoDB ID (for verification)
 * @returns Success status
 */
export async function removeWallet(
	walletId: string,
	userId: string
): Promise<{ success: boolean; error?: string }> {
	try {
		// Find wallet
		const wallet = await Wallet.findOne({
			_id: walletId,
			userId: new mongoose.Types.ObjectId(userId),
		});

		if (!wallet) {
			return { success: false, error: ERROR_MESSAGES.NOT_FOUND };
		}

		// Check if it's the active wallet
		const user = await User.findById(userId);
		if (user && user.activeWalletId?.toString() === walletId) {
			// Find another active wallet to set as active
			const otherWallet = await Wallet.findOne({
				userId: new mongoose.Types.ObjectId(userId),
				_id: { $ne: walletId },
				isActive: true,
			});

			user.activeWalletId = otherWallet?._id as mongoose.Types.ObjectId || undefined;
			await user.save();
		}

		// Soft delete: set isActive to false instead of deleting
		wallet.isActive = false;
		await wallet.save();

		logger.success(`Wallet deactivated: ${wallet.address}`);

		return { success: true };
	} catch (error: any) {
		logger.error('Failed to remove wallet:', error.message);
		return { success: false, error: ERROR_MESSAGES.DATABASE_ERROR };
	}
}

/**
 * Get all wallets for a user
 * @param userId - User's MongoDB ID
 * @returns Array of wallets
 */
export async function getUserWallets(userId: string): Promise<IWallet[]> {
	try {
		const wallets = await Wallet.find({
			userId: new mongoose.Types.ObjectId(userId),
			isActive: true, // Only show active wallets
		}).sort({ createdAt: -1 });

		return wallets;
	} catch (error: any) {
		logger.error('Failed to get user wallets:', error.message);
		return [];
	}
}

/**
 * Get active wallet for a user
 * @param userId - User's MongoDB ID
 * @returns Active wallet or null
 */
export async function getActiveWallet(userId: string): Promise<IWallet | null> {
	try {
		const user = await User.findById(userId);

		if (!user || !user.activeWalletId) {
			return null;
		}

		const wallet = await Wallet.findById(user.activeWalletId);
		return wallet;
	} catch (error: any) {
		logger.error('Failed to get active wallet:', error.message);
		return null;
	}
}

/**
 * Set active wallet for a user
 * @param userId - User's MongoDB ID
 * @param walletId - Wallet's MongoDB ID
 * @returns Success status
 */
export async function setActiveWallet(
	userId: string,
	walletId: string
): Promise<{ success: boolean; error?: string }> {
	try {
		// Verify wallet belongs to user
		const wallet = await Wallet.findOne({
			_id: walletId,
			userId: new mongoose.Types.ObjectId(userId),
		});

		if (!wallet) {
			return { success: false, error: ERROR_MESSAGES.NOT_FOUND };
		}

		// Update user's active wallet
		await User.findByIdAndUpdate(userId, {
			activeWalletId: new mongoose.Types.ObjectId(walletId),
		});

		logger.success(`Active wallet set: ${wallet.address}`);

		return { success: true };
	} catch (error: any) {
		logger.error('Failed to set active wallet:', error.message);
		return { success: false, error: ERROR_MESSAGES.DATABASE_ERROR };
	}
}

/**
 * Update wallet name
 * @param walletId - Wallet's MongoDB ID
 * @param userId - User's MongoDB ID (for verification)
 * @param newName - New wallet name
 * @returns Success status
 */
export async function updateWalletName(
	walletId: string,
	userId: string,
	newName: string
): Promise<{ success: boolean; error?: string }> {
	try {
		// Validate name
		const nameValidation = validateWalletName(newName);
		if (!nameValidation.valid) {
			return { success: false, error: nameValidation.error };
		}

		// Update wallet
		const wallet = await Wallet.findOneAndUpdate(
			{
				_id: walletId,
				userId: new mongoose.Types.ObjectId(userId),
			},
			{ name: newName },
			{ new: true }
		);

		if (!wallet) {
			return { success: false, error: ERROR_MESSAGES.NOT_FOUND };
		}

		logger.success(`Wallet name updated: ${wallet.address}`);

		return { success: true };
	} catch (error: any) {
		logger.error('Failed to update wallet name:', error.message);
		return { success: false, error: ERROR_MESSAGES.DATABASE_ERROR };
	}
}

/**
 * Get wallet by ID with decrypted private key
 * @param walletId - Wallet's MongoDB ID
 * @param userId - User's MongoDB ID (for verification)
 * @returns Wallet with decrypted private key
 */
export async function getWalletWithPrivateKey(
	walletId: string,
	userId: string
): Promise<{ success: boolean; wallet?: IWallet; privateKey?: string; error?: string }> {
	try {
		// Find wallet with private key field
		const wallet = await Wallet.findOne({
			_id: walletId,
			userId: new mongoose.Types.ObjectId(userId),
		}).select('+encryptedPrivateKey');

		if (!wallet) {
			return { success: false, error: ERROR_MESSAGES.NOT_FOUND };
		}

		// Decrypt private key
		const privateKey = decryptPrivateKey(wallet.encryptedPrivateKey);

		return { success: true, wallet, privateKey };
	} catch (error: any) {
		logger.error('Failed to get wallet with private key:', error.message);
		return { success: false, error: ERROR_MESSAGES.DATABASE_ERROR };
	}
}

/**
 * Get wallet count for a user
 * @param userId - User's MongoDB ID
 * @returns Wallet count
 */
export async function getWalletCount(userId: string): Promise<number> {
	try {
		const count = await Wallet.countDocuments({
			userId: new mongoose.Types.ObjectId(userId),
		});
		return count;
	} catch (error: any) {
		logger.error('Failed to get wallet count:', error.message);
		return 0;
	}
}
