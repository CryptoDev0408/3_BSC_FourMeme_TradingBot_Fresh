import { ethers } from 'ethers';
import { getProvider } from '../wallet/wallet.service';
import { isValidAddress } from '../../utils/validation';
import { logger } from '../../utils/logger';
import { ERC20_ABI } from '../../abi/erc20.abi';
import NodeCache from 'node-cache';

/**
 * Token Service
 * Handles token metadata fetching and caching
 */

// Token metadata cache (TTL: 1 hour - metadata rarely changes)
const metadataCache = new NodeCache({ stdTTL: 3600 });

export interface TokenMetadata {
	address: string;
	name: string;
	symbol: string;
	decimals: number;
	totalSupply: string;
}

/**
 * Get ERC20 token contract instance
 */
function getTokenContract(tokenAddress: string): ethers.Contract {
	const provider = getProvider();
	return new ethers.Contract(tokenAddress, ERC20_ABI, provider);
}

/**
 * Get token metadata (name, symbol, decimals, totalSupply)
 * @param tokenAddress - Token contract address
 * @param useCache - Use cached metadata if available (default: true)
 * @returns Token metadata
 */
export async function getTokenMetadata(
	tokenAddress: string,
	useCache: boolean = true
): Promise<TokenMetadata | null> {
	try {
		if (!isValidAddress(tokenAddress)) {
			throw new Error('Invalid token address');
		}

		const cacheKey = `metadata_${tokenAddress.toLowerCase()}`;

		// Check cache first
		if (useCache) {
			const cached = metadataCache.get<TokenMetadata>(cacheKey);
			if (cached) {
				logger.debug(`Token metadata cache hit: ${tokenAddress}`);
				return cached;
			}
		}

		logger.info(`Fetching token metadata: ${tokenAddress}`);

		// Get contract instance
		const tokenContract = getTokenContract(tokenAddress);

		// Fetch all metadata in parallel
		const [name, symbol, decimals, totalSupply] = await Promise.all([
			tokenContract.name().catch(() => 'Unknown'),
			tokenContract.symbol().catch(() => 'UNKNOWN'),
			tokenContract.decimals().catch(() => 18),
			tokenContract.totalSupply().catch(() => '0'),
		]);

		const metadata: TokenMetadata = {
			address: tokenAddress.toLowerCase(),
			name,
			symbol,
			decimals,
			totalSupply: totalSupply.toString(),
		};

		// Cache the metadata
		metadataCache.set(cacheKey, metadata);

		logger.success(`Token metadata fetched: ${symbol} (${name})`);

		return metadata;
	} catch (error: any) {
		logger.error(`Failed to fetch token metadata for ${tokenAddress}:`, error.message);
		return null;
	}
}

/**
 * Get token name
 * @param tokenAddress - Token contract address
 * @returns Token name
 */
export async function getTokenName(tokenAddress: string): Promise<string> {
	try {
		if (!isValidAddress(tokenAddress)) {
			return 'Unknown';
		}

		const tokenContract = getTokenContract(tokenAddress);
		const name = await tokenContract.name();
		return name;
	} catch (error: any) {
		logger.error(`Failed to fetch token name for ${tokenAddress}:`, error.message);
		return 'Unknown';
	}
}

/**
 * Get token symbol
 * @param tokenAddress - Token contract address
 * @returns Token symbol
 */
export async function getTokenSymbol(tokenAddress: string): Promise<string> {
	try {
		if (!isValidAddress(tokenAddress)) {
			return 'UNKNOWN';
		}

		const tokenContract = getTokenContract(tokenAddress);
		const symbol = await tokenContract.symbol();
		return symbol;
	} catch (error: any) {
		logger.error(`Failed to fetch token symbol for ${tokenAddress}:`, error.message);
		return 'UNKNOWN';
	}
}

/**
 * Get token decimals
 * @param tokenAddress - Token contract address
 * @returns Token decimals
 */
export async function getTokenDecimals(tokenAddress: string): Promise<number> {
	try {
		if (!isValidAddress(tokenAddress)) {
			return 18;
		}

		const tokenContract = getTokenContract(tokenAddress);
		const decimals = await tokenContract.decimals();
		return decimals;
	} catch (error: any) {
		logger.error(`Failed to fetch token decimals for ${tokenAddress}:`, error.message);
		return 18;
	}
}

/**
 * Get token total supply
 * @param tokenAddress - Token contract address
 * @returns Total supply in wei
 */
export async function getTokenTotalSupply(tokenAddress: string): Promise<string> {
	try {
		if (!isValidAddress(tokenAddress)) {
			return '0';
		}

		const tokenContract = getTokenContract(tokenAddress);
		const totalSupply = await tokenContract.totalSupply();
		return totalSupply.toString();
	} catch (error: any) {
		logger.error(`Failed to fetch token total supply for ${tokenAddress}:`, error.message);
		return '0';
	}
}

/**
 * Get token balance for an address
 * @param tokenAddress - Token contract address
 * @param walletAddress - Wallet address
 * @returns Token balance in wei
 */
export async function getTokenBalance(
	tokenAddress: string,
	walletAddress: string
): Promise<string> {
	try {
		if (!isValidAddress(tokenAddress)) {
			throw new Error('Invalid token address');
		}
		if (!isValidAddress(walletAddress)) {
			throw new Error('Invalid wallet address');
		}

		const tokenContract = getTokenContract(tokenAddress);
		const balance = await tokenContract.balanceOf(walletAddress);

		return balance.toString();
	} catch (error: any) {
		logger.error(
			`Failed to get token balance for ${tokenAddress} / ${walletAddress}:`,
			error.message
		);
		return '0';
	}
}

/**
 * Get formatted token balance
 * @param tokenAddress - Token contract address
 * @param walletAddress - Wallet address
 * @returns Formatted balance with decimals
 */
export async function getFormattedTokenBalance(
	tokenAddress: string,
	walletAddress: string
): Promise<string> {
	try {
		const [balance, decimals] = await Promise.all([
			getTokenBalance(tokenAddress, walletAddress),
			getTokenDecimals(tokenAddress),
		]);

		return ethers.utils.formatUnits(balance, decimals);
	} catch (error: any) {
		logger.error('Failed to get formatted token balance:', error.message);
		return '0';
	}
}

/**
 * Batch fetch token metadata for multiple tokens
 * @param tokenAddresses - Array of token addresses
 * @param useCache - Use cached metadata if available
 * @returns Array of token metadata (null for failed fetches)
 */
export async function getBatchTokenMetadata(
	tokenAddresses: string[],
	useCache: boolean = true
): Promise<(TokenMetadata | null)[]> {
	try {
		logger.info(`Fetching metadata for ${tokenAddresses.length} tokens`);

		const metadataPromises = tokenAddresses.map((address) =>
			getTokenMetadata(address, useCache)
		);

		const results = await Promise.all(metadataPromises);

		const successCount = results.filter((m) => m !== null).length;
		logger.success(`Fetched metadata for ${successCount}/${tokenAddresses.length} tokens`);

		return results;
	} catch (error: any) {
		logger.error('Failed to batch fetch token metadata:', error.message);
		return tokenAddresses.map(() => null);
	}
}

/**
 * Clear token metadata cache
 * @param tokenAddress - Optional specific token address to clear, or clear all if not provided
 */
export function clearMetadataCache(tokenAddress?: string): void {
	if (tokenAddress) {
		const cacheKey = `metadata_${tokenAddress.toLowerCase()}`;
		metadataCache.del(cacheKey);
		logger.info(`Cleared metadata cache for ${tokenAddress}`);
	} else {
		metadataCache.flushAll();
		logger.info('Cleared all token metadata cache');
	}
}

/**
 * Check if token contract is valid and has required methods
 * @param tokenAddress - Token contract address
 * @returns True if token is valid
 */
export async function isValidToken(tokenAddress: string): Promise<boolean> {
	try {
		if (!isValidAddress(tokenAddress)) {
			return false;
		}

		const tokenContract = getTokenContract(tokenAddress);

		// Try to call basic methods
		await Promise.all([
			tokenContract.decimals(),
			tokenContract.symbol(),
			tokenContract.totalSupply(),
		]);

		return true;
	} catch (error) {
		return false;
	}
}
