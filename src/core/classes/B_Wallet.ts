import { ethers } from 'ethers';
import { Wallet, IWallet } from '../../database/models';
import { encryptPrivateKey, decryptPrivateKey } from '../../utils/encryption';
import { logger } from '../../utils/logger';
import { getProvider } from '../wallet/wallet.service';

/**
 * B_Wallet - Wallet Management Class
 * Manages wallet operations including balance, transactions
 */
export class B_Wallet {
	public id: string;
	public userId: string;
	public name: string;
	public address: string;
	public balance: number;
	public isActive: boolean;
	private encryptedPrivateKey: string;

	constructor(wallet: IWallet) {
		this.id = wallet._id.toString();
		this.userId = wallet.userId.toString();
		this.name = wallet.name;
		this.address = wallet.address;
		this.balance = typeof wallet.balance === 'object' ? wallet.balance.bnb : wallet.balance;
		this.isActive = wallet.isActive;
		this.encryptedPrivateKey = wallet.encryptedPrivateKey;
	}

	/**
	 * Generate new wallet
	 */
	static async generate(userId: string, name?: string): Promise<B_Wallet | null> {
		try {
			// Generate random wallet
			const ethWallet = ethers.Wallet.createRandom();

			// Encrypt private key
			const encryptedKey = encryptPrivateKey(ethWallet.privateKey);

			// Count existing wallets for naming
			const walletCount = await Wallet.countDocuments({ userId });
			const walletName = name || `Wallet #${walletCount + 1}`;

			// Create wallet in database
			const wallet = await Wallet.create({
				userId,
				name: walletName,
				address: ethWallet.address,
				encryptedPrivateKey: encryptedKey,
				balance: { bnb: 0 },
				isActive: walletCount === 0, // First wallet is active by default
			});

			logger.success(`Wallet generated: ${wallet.address}`);
			return new B_Wallet(wallet);
		} catch (error: any) {
			logger.error('Failed to generate wallet:', error.message);
			return null;
		}
	}

	/**
	 * Import wallet by private key
	 */
	static async import(userId: string, privateKey: string, name?: string): Promise<B_Wallet | null> {
		try {
			// Validate private key
			const ethWallet = new ethers.Wallet(privateKey);

			// Encrypt private key
			const encryptedKey = encryptPrivateKey(privateKey);

			// Count existing wallets for naming
			const walletCount = await Wallet.countDocuments({ userId });
			const walletName = name || `Wallet #${walletCount + 1}`;

			// Create wallet in database
			const wallet = await Wallet.create({
				userId,
				name: walletName,
				address: ethWallet.address,
				encryptedPrivateKey: encryptedKey,
				balance: { bnb: 0 },
				isActive: walletCount === 0,
			});

			logger.success(`Wallet imported: ${wallet.address}`);
			return new B_Wallet(wallet);
		} catch (error: any) {
			logger.error('Failed to import wallet:', error.message);
			return null;
		}
	}

	/**
	 * Get wallet by ID
	 */
	static async getById(walletId: string): Promise<B_Wallet | null> {
		try {
			const wallet = await Wallet.findById(walletId);
			if (!wallet) return null;
			return new B_Wallet(wallet);
		} catch (error: any) {
			logger.error(`Failed to get wallet by ID:`, error.message);
			return null;
		}
	}

	/**
	 * Get all wallets for user
	 */
	static async getByUserId(userId: string): Promise<B_Wallet[]> {
		try {
			const wallets = await Wallet.find({ userId }).sort({ createdAt: 1 });
			return wallets.map(w => new B_Wallet(w));
		} catch (error: any) {
			logger.error('Failed to get user wallets:', error.message);
			return [];
		}
	}

	/**
	 * Get active wallet for user
	 */
	static async getActiveWallet(userId: string): Promise<B_Wallet | null> {
		try {
			const wallet = await Wallet.findOne({ userId, isActive: true });
			if (!wallet) return null;
			return new B_Wallet(wallet);
		} catch (error: any) {
			logger.error('Failed to get active wallet:', error.message);
			return null;
		}
	}

	/**
	 * Update wallet balance from blockchain
	 */
	async updateBalance(): Promise<number> {
		try {
			const provider = getProvider();
			const balanceWei = await provider.getBalance(this.address);
			const balanceBnb = parseFloat(ethers.utils.formatEther(balanceWei));

			// Update in database
			await Wallet.findByIdAndUpdate(this.id, {
				balance: { bnb: balanceBnb },
			});

			this.balance = balanceBnb;
			logger.info(`Wallet balance updated: ${this.address} = ${balanceBnb} BNB`);
			return balanceBnb;
		} catch (error: any) {
			logger.error(`Failed to update wallet balance:`, error.message);
			return this.balance;
		}
	}

	/**
	 * Get decrypted private key
	 */
	getPrivateKey(): string {
		return decryptPrivateKey(this.encryptedPrivateKey);
	}

	/**
	 * Get ethers Wallet instance
	 */
	getEthersWallet(): ethers.Wallet {
		const privateKey = this.getPrivateKey();
		return new ethers.Wallet(privateKey, getProvider());
	}

	/**
	 * Set as active wallet
	 */
	async setActive(): Promise<boolean> {
		try {
			// Deactivate all other wallets for this user
			await Wallet.updateMany(
				{ userId: this.userId },
				{ isActive: false }
			);

			// Activate this wallet
			await Wallet.findByIdAndUpdate(this.id, { isActive: true });
			this.isActive = true;

			logger.info(`Wallet activated: ${this.address}`);
			return true;
		} catch (error: any) {
			logger.error('Failed to activate wallet:', error.message);
			return false;
		}
	}

	/**
	 * Rename wallet
	 */
	async rename(newName: string): Promise<boolean> {
		try {
			await Wallet.findByIdAndUpdate(this.id, { name: newName });
			this.name = newName;
			return true;
		} catch (error: any) {
			logger.error('Failed to rename wallet:', error.message);
			return false;
		}
	}

	/**
	 * Remove wallet
	 */
	async remove(): Promise<boolean> {
		try {
			await Wallet.findByIdAndDelete(this.id);
			logger.info(`Wallet removed: ${this.address}`);
			return true;
		} catch (error: any) {
			logger.error('Failed to remove wallet:', error.message);
			return false;
		}
	}

	/**
	 * Transfer BNB to another address
	 */
	async transfer(toAddress: string, amount: number): Promise<{ success: boolean; txHash?: string; error?: string }> {
		try {
			const wallet = this.getEthersWallet();

			// Create transaction
			const tx = await wallet.sendTransaction({
				to: toAddress,
				value: ethers.utils.parseEther(amount.toString()),
			});

			// Wait for confirmation
			await tx.wait();

			logger.success(`Transfer successful: ${amount} BNB to ${toAddress}`);
			return { success: true, txHash: tx.hash };
		} catch (error: any) {
			logger.error('Transfer failed:', error.message);
			return { success: false, error: error.message };
		}
	}
}
