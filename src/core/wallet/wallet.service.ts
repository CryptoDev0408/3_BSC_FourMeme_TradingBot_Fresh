import { ethers } from 'ethers';
import { Wallet, IWallet } from '../../database/models';
import { decryptPrivateKey } from '../../utils/encryption';
import { isValidAddress, validateBnbAmount } from '../../utils/validation';
import { logger } from '../../utils/logger';
import { config } from '../../config/config';
import { ERROR_MESSAGES, BALANCE_CACHE_TTL } from '../../config/constants';
import NodeCache from 'node-cache';

/**
 * Wallet Service
 * Handles balance fetching and BNB transfers
 */

// Balance cache (TTL: 60 seconds)
const balanceCache = new NodeCache({ stdTTL: BALANCE_CACHE_TTL });

// BSC Provider
let provider: ethers.providers.JsonRpcProvider;

/**
 * Initialize provider
 */
export function initializeProvider(): void {
	try {
		provider = new ethers.providers.JsonRpcProvider(config.bsc.rpcHttpUrl);
		logger.success('BSC provider initialized');
	} catch (error: any) {
		logger.error('Failed to initialize BSC provider:', error.message);
		throw error;
	}
}

/**
 * Get provider instance
 */
export function getProvider(): ethers.providers.JsonRpcProvider {
	if (!provider) {
		initializeProvider();
	}
	return provider;
}

/**
 * Get BNB balance for an address
 * @param address - Wallet address
 * @param useCache - Use cached balance if available
 * @returns Balance in BNB
 */
export async function getBnbBalance(
	address: string,
	useCache: boolean = true
): Promise<{ success: boolean; balance?: number; error?: string }> {
	try {
		// Validate address
		if (!isValidAddress(address)) {
			return { success: false, error: ERROR_MESSAGES.INVALID_ADDRESS };
		}

		const addressLower = address.toLowerCase();

		// Check cache
		if (useCache) {
			const cached = balanceCache.get<number>(addressLower);
			if (cached !== undefined) {
				return { success: true, balance: cached };
			}
		}

		// Fetch balance from blockchain
		const balanceWei = await getProvider().getBalance(address);
		const balanceBnb = parseFloat(ethers.utils.formatEther(balanceWei));

		// Cache the balance
		balanceCache.set(addressLower, balanceBnb);

		return { success: true, balance: balanceBnb };
	} catch (error: any) {
		logger.error(`Failed to get BNB balance for ${address}:`, error.message);
		return { success: false, error: ERROR_MESSAGES.NETWORK_ERROR };
	}
}

/**
 * Update wallet balance in database
 * @param walletId - Wallet's MongoDB ID
 * @returns Updated balance
 */
export async function updateWalletBalance(
	walletId: string
): Promise<{ success: boolean; balance?: number; error?: string }> {
	try {
		// Find wallet
		const wallet = await Wallet.findById(walletId);
		if (!wallet) {
			return { success: false, error: ERROR_MESSAGES.NOT_FOUND };
		}

		// Get fresh balance (skip cache)
		const balanceResult = await getBnbBalance(wallet.address, false);

		if (!balanceResult.success || balanceResult.balance === undefined) {
			return { success: false, error: balanceResult.error };
		}

		// Update wallet in database
		wallet.balance.bnb = balanceResult.balance;
		wallet.balance.lastUpdated = new Date();
		await wallet.save();

		return { success: true, balance: balanceResult.balance };
	} catch (error: any) {
		logger.error('Failed to update wallet balance:', error.message);
		return { success: false, error: ERROR_MESSAGES.DATABASE_ERROR };
	}
}

/**
 * Transfer BNB from wallet to another address
 * @param walletId - Source wallet's MongoDB ID
 * @param toAddress - Destination address
 * @param amount - Amount in BNB
 * @param userId - User's MongoDB ID (for verification)
 * @returns Transaction details
 */
export async function transferBnb(
	walletId: string,
	toAddress: string,
	amount: number,
	userId: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
	try {
		// Validate destination address
		if (!isValidAddress(toAddress)) {
			return { success: false, error: ERROR_MESSAGES.INVALID_ADDRESS };
		}

		// Validate amount
		const amountValidation = validateBnbAmount(amount, config.trading.maxBnbPerTrade);
		if (!amountValidation.valid) {
			return { success: false, error: amountValidation.error };
		}

		// Get wallet with private key
		const wallet = await Wallet.findById(walletId).select('+encryptedPrivateKey');
		if (!wallet) {
			return { success: false, error: ERROR_MESSAGES.NOT_FOUND };
		}

		// Verify ownership
		if (wallet.userId.toString() !== userId) {
			return { success: false, error: 'Unauthorized' };
		}

		// Decrypt private key
		const privateKey = decryptPrivateKey(wallet.encryptedPrivateKey);

		// Create wallet instance
		const ethWallet = new ethers.Wallet(privateKey, getProvider());

		// Check balance
		const balanceResult = await getBnbBalance(wallet.address, false);
		if (!balanceResult.success || !balanceResult.balance) {
			return { success: false, error: ERROR_MESSAGES.NETWORK_ERROR };
		}

		// Estimate gas
		const gasPrice = await getProvider().getGasPrice();
		const gasLimit = 21000; // Standard transfer gas limit
		const gasCost = parseFloat(ethers.utils.formatEther(gasPrice.mul(gasLimit)));

		// Check if sufficient balance
		if (balanceResult.balance < amount + gasCost) {
			return { success: false, error: ERROR_MESSAGES.INSUFFICIENT_BALANCE };
		}

		// Build transaction
		const tx = {
			to: toAddress,
			value: ethers.utils.parseEther(amount.toString()),
			gasLimit,
			gasPrice,
		};

		// Send transaction
		logger.info(`Transferring ${amount} BNB from ${wallet.address} to ${toAddress}`);
		const txResponse = await ethWallet.sendTransaction(tx);

		// Wait for confirmation
		logger.info(`Transaction sent: ${txResponse.hash}`);
		await txResponse.wait(1);

		logger.success(`Transfer successful: ${txResponse.hash}`);

		// Update balance cache
		balanceCache.del(wallet.address.toLowerCase());

		return { success: true, txHash: txResponse.hash };
	} catch (error: any) {
		logger.error('Failed to transfer BNB:', error.message);

		if (error.message.includes('insufficient funds')) {
			return { success: false, error: ERROR_MESSAGES.INSUFFICIENT_BALANCE };
		}

		return { success: false, error: ERROR_MESSAGES.TX_FAILED };
	}
}

/**
 * Estimate gas cost for a transfer
 * @param amount - Amount in BNB
 * @returns Estimated gas cost in BNB
 */
export async function estimateTransferGas(
	amount: number
): Promise<{ success: boolean; gasCost?: number; error?: string }> {
	try {
		const gasPrice = await getProvider().getGasPrice();
		const gasLimit = 21000;
		const gasCost = parseFloat(ethers.utils.formatEther(gasPrice.mul(gasLimit)));

		return { success: true, gasCost };
	} catch (error: any) {
		logger.error('Failed to estimate gas:', error.message);
		return { success: false, error: ERROR_MESSAGES.NETWORK_ERROR };
	}
}

/**
 * Get current gas price in Gwei
 * @returns Gas price in Gwei
 */
export async function getCurrentGasPrice(): Promise<{ success: boolean; gasPrice?: string; error?: string }> {
	try {
		const gasPrice = await getProvider().getGasPrice();
		const gasPriceGwei = ethers.utils.formatUnits(gasPrice, 'gwei');

		return { success: true, gasPrice: gasPriceGwei };
	} catch (error: any) {
		logger.error('Failed to get gas price:', error.message);
		return { success: false, error: ERROR_MESSAGES.NETWORK_ERROR };
	}
}

/**
 * Check if address has sufficient balance
 * @param address - Wallet address
 * @param requiredAmount - Required amount in BNB
 * @returns True if sufficient
 */
export async function hasSufficientBalance(
	address: string,
	requiredAmount: number
): Promise<boolean> {
	try {
		const balanceResult = await getBnbBalance(address, true);

		if (!balanceResult.success || balanceResult.balance === undefined) {
			return false;
		}

		return balanceResult.balance >= requiredAmount;
	} catch {
		return false;
	}
}

/**
 * Clear balance cache for an address
 * @param address - Wallet address
 */
export function clearBalanceCache(address: string): void {
	balanceCache.del(address.toLowerCase());
}

/**
 * Clear all balance caches
 */
export function clearAllBalanceCaches(): void {
	balanceCache.flushAll();
}

/**
 * Get multiple wallet balances (batch)
 * @param addresses - Array of wallet addresses
 * @returns Map of address to balance
 */
export async function getBatchBalances(
	addresses: string[]
): Promise<Map<string, number>> {
	const balances = new Map<string, number>();

	// Fetch balances in parallel
	const results = await Promise.allSettled(
		addresses.map((addr) => getBnbBalance(addr, true))
	);

	results.forEach((result, index) => {
		if (result.status === 'fulfilled' && result.value.success && result.value.balance !== undefined) {
			balances.set(addresses[index].toLowerCase(), result.value.balance);
		}
	});

	return balances;
}
