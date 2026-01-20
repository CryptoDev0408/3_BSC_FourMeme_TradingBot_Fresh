import { ethers, BigNumber } from 'ethers';
import axios from 'axios';
import { getProvider } from '../wallet/wallet.service';
import { getAmountsOut } from '../trading/pancakeswap.service';
import { getTokenDecimals } from '../token/token.service';
import { isValidAddress } from '../../utils/validation';
import { logger } from '../../utils/logger';
import {
	PANCAKE_FACTORY_ADDRESS,
	WBNB_ADDRESS,
	PRICE_CACHE_TTL,
	DEXSCREENER_API_URL,
	API_TIMEOUT,
} from '../../config/constants';
import { PANCAKESWAP_FACTORY_ABI } from '../../abi/pancakeswap-factory.abi';
import { PANCAKESWAP_PAIR_ABI } from '../../abi/pancakeswap-pair.abi';
import NodeCache from 'node-cache';

/**
 * Price Service
 * Handles token price fetching from PancakeSwap with DEXScreener backup
 */

// Price cache (TTL: 5 minutes)
const priceCache = new NodeCache({ stdTTL: PRICE_CACHE_TTL });

export interface TokenPrice {
	tokenAddress: string;
	priceInBnb: string;
	priceInUsd: string;
	source: 'pancakeswap' | 'dexscreener';
	timestamp: number;
}

export interface PairReserves {
	reserve0: string;
	reserve1: string;
	token0: string;
	token1: string;
	pairAddress: string;
}

/**
 * Get PancakeSwap factory contract instance
 */
function getFactoryContract(): ethers.Contract {
	const provider = getProvider();
	return new ethers.Contract(PANCAKE_FACTORY_ADDRESS, PANCAKESWAP_FACTORY_ABI, provider);
}

/**
 * Get PancakeSwap pair contract instance
 */
function getPairContract(pairAddress: string): ethers.Contract {
	const provider = getProvider();
	return new ethers.Contract(pairAddress, PANCAKESWAP_PAIR_ABI, provider);
}

/**
 * Get pair address for two tokens
 * @param tokenA - First token address
 * @param tokenB - Second token address
 * @returns Pair address or null if doesn't exist
 */
export async function getPairAddress(tokenA: string, tokenB: string): Promise<string | null> {
	try {
		if (!isValidAddress(tokenA) || !isValidAddress(tokenB)) {
			throw new Error('Invalid token addresses');
		}

		const factory = getFactoryContract();
		const pairAddress = await factory.getPair(tokenA, tokenB);

		// Check if pair exists (non-zero address)
		if (pairAddress === ethers.constants.AddressZero) {
			return null;
		}

		return pairAddress.toLowerCase();
	} catch (error: any) {
		logger.error(`Failed to get pair address for ${tokenA}/${tokenB}:`, error.message);
		return null;
	}
}

/**
 * Get pair reserves
 * @param pairAddress - Pair contract address
 * @returns Pair reserves data
 */
export async function getPairReserves(pairAddress: string): Promise<PairReserves | null> {
	try {
		if (!isValidAddress(pairAddress)) {
			throw new Error('Invalid pair address');
		}

		const pairContract = getPairContract(pairAddress);

		// Fetch token addresses and reserves in parallel
		const [token0, token1, reserves] = await Promise.all([
			pairContract.token0(),
			pairContract.token1(),
			pairContract.getReserves(),
		]);

		return {
			reserve0: reserves.reserve0.toString(),
			reserve1: reserves.reserve1.toString(),
			token0: token0.toLowerCase(),
			token1: token1.toLowerCase(),
			pairAddress: pairAddress.toLowerCase(),
		};
	} catch (error: any) {
		logger.error(`Failed to get pair reserves for ${pairAddress}:`, error.message);
		return null;
	}
}

/**
 * Calculate token price from pair reserves
 * @param tokenAddress - Token to get price for
 * @param reserves - Pair reserves data
 * @returns Price in BNB (as string)
 */
function calculatePriceFromReserves(tokenAddress: string, reserves: PairReserves): string {
	const token = tokenAddress.toLowerCase();
	const { reserve0, reserve1, token0, token1 } = reserves;

	let tokenReserve: string;
	let bnbReserve: string;

	if (token === token0) {
		tokenReserve = reserve0;
		bnbReserve = reserve1;
	} else if (token === token1) {
		tokenReserve = reserve1;
		bnbReserve = reserve0;
	} else {
		throw new Error('Token not in pair');
	}

	// Price = BNB Reserve / Token Reserve
	const price = BigNumber.from(bnbReserve)
		.mul(ethers.utils.parseEther('1'))
		.div(tokenReserve);

	return ethers.utils.formatEther(price);
}

/**
 * Get token price in BNB from PancakeSwap
 * @param tokenAddress - Token contract address
 * @param useCache - Use cached price if available
 * @returns Price in BNB or null if pair doesn't exist
 */
export async function getTokenPriceInBnb(
	tokenAddress: string,
	useCache: boolean = true
): Promise<string | null> {
	try {
		if (!isValidAddress(tokenAddress)) {
			throw new Error('Invalid token address');
		}

		// Return 1 if asking for WBNB price
		if (tokenAddress.toLowerCase() === WBNB_ADDRESS.toLowerCase()) {
			return '1.0';
		}

		const cacheKey = `price_bnb_${tokenAddress.toLowerCase()}`;

		// Check cache first
		if (useCache) {
			const cached = priceCache.get<string>(cacheKey);
			if (cached) {
				logger.debug(`Price cache hit: ${tokenAddress}`);
				return cached;
			}
		}

		logger.info(`Fetching price for ${tokenAddress}`);

		// Get pair address
		const pairAddress = await getPairAddress(tokenAddress, WBNB_ADDRESS);
		if (!pairAddress) {
			logger.warning(`No PancakeSwap pair found for ${tokenAddress}`);
			return null;
		}

		// Get reserves
		const reserves = await getPairReserves(pairAddress);
		if (!reserves) {
			return null;
		}

		// Calculate price
		const price = calculatePriceFromReserves(tokenAddress, reserves);

		// Cache the price
		priceCache.set(cacheKey, price);

		logger.success(`Price fetched: ${price} BNB`);

		return price;
	} catch (error: any) {
		logger.error(`Failed to get token price in BNB for ${tokenAddress}:`, error.message);
		return null;
	}
}

/**
 * Get BNB price in USD from DEXScreener
 * @returns BNB price in USD
 */
export async function getBnbPriceInUsd(): Promise<number> {
	try {
		const cacheKey = 'bnb_usd_price';

		// Check cache first
		const cached = priceCache.get<number>(cacheKey);
		if (cached) {
			return cached;
		}

		// Fetch from DEXScreener
		const response = await axios.get(`${DEXSCREENER_API_URL}/tokens/${WBNB_ADDRESS}`, {
			timeout: API_TIMEOUT,
		});

		if (response.data && response.data.pairs && response.data.pairs.length > 0) {
			// Get the first pair's price (usually WBNB/USDT)
			const pair = response.data.pairs[0];
			const bnbPrice = parseFloat(pair.priceUsd || '0');

			if (bnbPrice > 0) {
				// Cache for 5 minutes
				priceCache.set(cacheKey, bnbPrice);
				logger.success(`BNB price: $${bnbPrice}`);
				return bnbPrice;
			}
		}

		// Fallback to default price if API fails
		logger.warning('Failed to fetch BNB price from DEXScreener, using fallback');
		return 300; // Fallback price
	} catch (error: any) {
		logger.error('Failed to get BNB price in USD:', error.message);
		return 300; // Fallback price
	}
}

/**
 * Get token price in USD
 * @param tokenAddress - Token contract address
 * @param useCache - Use cached price if available
 * @returns Price in USD or null if unavailable
 */
export async function getTokenPriceInUsd(
	tokenAddress: string,
	useCache: boolean = true
): Promise<string | null> {
	try {
		// Get price in BNB
		const priceInBnb = await getTokenPriceInBnb(tokenAddress, useCache);
		if (!priceInBnb) {
			return null;
		}

		// Get BNB price in USD
		const bnbUsdPrice = await getBnbPriceInUsd();

		// Calculate token price in USD
		const priceInUsd = parseFloat(priceInBnb) * bnbUsdPrice;

		return priceInUsd.toString();
	} catch (error: any) {
		logger.error(`Failed to get token price in USD for ${tokenAddress}:`, error.message);
		return null;
	}
}

/**
 * Get comprehensive token price from PancakeSwap
 * @param tokenAddress - Token contract address
 * @param useCache - Use cached price if available
 * @returns Token price data
 */
export async function getTokenPrice(
	tokenAddress: string,
	useCache: boolean = true
): Promise<TokenPrice | null> {
	try {
		if (!isValidAddress(tokenAddress)) {
			throw new Error('Invalid token address');
		}

		// Try PancakeSwap first
		const priceInBnb = await getTokenPriceInBnb(tokenAddress, useCache);

		if (priceInBnb) {
			const bnbUsdPrice = await getBnbPriceInUsd();
			const priceInUsd = (parseFloat(priceInBnb) * bnbUsdPrice).toString();

			return {
				tokenAddress: tokenAddress.toLowerCase(),
				priceInBnb,
				priceInUsd,
				source: 'pancakeswap',
				timestamp: Date.now(),
			};
		}

		// Fallback to DEXScreener
		logger.info('PancakeSwap price not available, trying DEXScreener');
		const dexPrice = await getTokenPriceFromDexScreener(tokenAddress);

		if (dexPrice) {
			return dexPrice;
		}

		logger.warning(`No price available for ${tokenAddress}`);
		return null;
	} catch (error: any) {
		logger.error(`Failed to get token price for ${tokenAddress}:`, error.message);
		return null;
	}
}

/**
 * Get token price from DEXScreener API (backup method)
 * @param tokenAddress - Token contract address
 * @returns Token price data or null
 */
export async function getTokenPriceFromDexScreener(
	tokenAddress: string
): Promise<TokenPrice | null> {
	try {
		if (!isValidAddress(tokenAddress)) {
			throw new Error('Invalid token address');
		}

		logger.info(`Fetching price from DEXScreener: ${tokenAddress}`);

		// Make API request
		const response = await axios.get(`${DEXSCREENER_API_URL}/tokens/${tokenAddress}`, {
			timeout: API_TIMEOUT,
		});

		if (!response.data || !response.data.pairs || response.data.pairs.length === 0) {
			logger.warning(`No DEXScreener data for ${tokenAddress}`);
			return null;
		}

		// Find BSC pair
		const bscPairs = response.data.pairs.filter((pair: any) => pair.chainId === 'bsc');
		if (bscPairs.length === 0) {
			logger.warning(`No BSC pairs found on DEXScreener for ${tokenAddress}`);
			return null;
		}

		// Get the pair with highest liquidity
		const bestPair = bscPairs.reduce((best: any, current: any) => {
			const bestLiq = parseFloat(best.liquidity?.usd || '0');
			const currentLiq = parseFloat(current.liquidity?.usd || '0');
			return currentLiq > bestLiq ? current : best;
		});

		const priceInUsd = bestPair.priceUsd || '0';
		const bnbUsdPrice = await getBnbPriceInUsd();
		const priceInBnb = (parseFloat(priceInUsd) / bnbUsdPrice).toString();

		logger.success(`DEXScreener price: $${priceInUsd}`);

		return {
			tokenAddress: tokenAddress.toLowerCase(),
			priceInBnb,
			priceInUsd,
			source: 'dexscreener',
			timestamp: Date.now(),
		};
	} catch (error: any) {
		logger.error(`Failed to get price from DEXScreener for ${tokenAddress}:`, error.message);
		return null;
	}
}

/**
 * Get token value in BNB for a given amount
 * @param tokenAddress - Token contract address
 * @param tokenAmount - Token amount (in human-readable format)
 * @param decimals - Token decimals (optional, will fetch if not provided)
 * @returns Value in BNB
 */
export async function getTokenValueInBnb(
	tokenAddress: string,
	tokenAmount: string,
	decimals?: number
): Promise<string | null> {
	try {
		const priceInBnb = await getTokenPriceInBnb(tokenAddress);
		if (!priceInBnb) {
			return null;
		}

		// Get decimals if not provided
		if (decimals === undefined) {
			decimals = await getTokenDecimals(tokenAddress);
		}

		// Parse token amount with decimals
		const amountBN = ethers.utils.parseUnits(tokenAmount, decimals);

		// Calculate value: (amount * price)
		const value = amountBN.mul(ethers.utils.parseEther(priceInBnb)).div(ethers.utils.parseEther('1'));

		return ethers.utils.formatEther(value);
	} catch (error: any) {
		logger.error('Failed to get token value in BNB:', error.message);
		return null;
	}
}

/**
 * Get token value in USD for a given amount
 * @param tokenAddress - Token contract address
 * @param tokenAmount - Token amount (in human-readable format)
 * @param decimals - Token decimals (optional)
 * @returns Value in USD
 */
export async function getTokenValueInUsd(
	tokenAddress: string,
	tokenAmount: string,
	decimals?: number
): Promise<string | null> {
	try {
		const valueInBnb = await getTokenValueInBnb(tokenAddress, tokenAmount, decimals);
		if (!valueInBnb) {
			return null;
		}

		const bnbUsdPrice = await getBnbPriceInUsd();
		const valueInUsd = parseFloat(valueInBnb) * bnbUsdPrice;

		return valueInUsd.toString();
	} catch (error: any) {
		logger.error('Failed to get token value in USD:', error.message);
		return null;
	}
}

/**
 * Batch fetch token prices
 * @param tokenAddresses - Array of token addresses
 * @param useCache - Use cached prices if available
 * @returns Array of token prices (null for failed fetches)
 */
export async function getBatchTokenPrices(
	tokenAddresses: string[],
	useCache: boolean = true
): Promise<(TokenPrice | null)[]> {
	try {
		logger.info(`Fetching prices for ${tokenAddresses.length} tokens`);

		const pricePromises = tokenAddresses.map((address) => getTokenPrice(address, useCache));

		const results = await Promise.all(pricePromises);

		const successCount = results.filter((p) => p !== null).length;
		logger.success(`Fetched prices for ${successCount}/${tokenAddresses.length} tokens`);

		return results;
	} catch (error: any) {
		logger.error('Failed to batch fetch token prices:', error.message);
		return tokenAddresses.map(() => null);
	}
}

/**
 * Get expected output amount for a swap (using router)
 * @param amountIn - Input amount in wei
 * @param tokenIn - Input token address (use WBNB_ADDRESS for BNB)
 * @param tokenOut - Output token address
 * @returns Expected output amount in wei
 */
export async function getExpectedOutputAmount(
	amountIn: string,
	tokenIn: string,
	tokenOut: string
): Promise<string | null> {
	try {
		const path = [tokenIn, tokenOut];
		const amounts = await getAmountsOut(amountIn, path);

		if (amounts && amounts.length >= 2) {
			return amounts[1];
		}

		return null;
	} catch (error: any) {
		logger.error('Failed to get expected output amount:', error.message);
		return null;
	}
}

/**
 * Clear price cache
 * @param tokenAddress - Optional specific token address to clear, or clear all if not provided
 */
export function clearPriceCache(tokenAddress?: string): void {
	if (tokenAddress) {
		const cacheKey = `price_bnb_${tokenAddress.toLowerCase()}`;
		priceCache.del(cacheKey);
		logger.info(`Cleared price cache for ${tokenAddress}`);
	} else {
		priceCache.flushAll();
		logger.info('Cleared all price cache');
	}
}

/**
 * Check if pair has sufficient liquidity
 * @param tokenAddress - Token contract address
 * @param minLiquidityBnb - Minimum liquidity in BNB
 * @returns True if liquidity is sufficient
 */
export async function hasSufficientLiquidity(
	tokenAddress: string,
	minLiquidityBnb: number = 1
): Promise<boolean> {
	try {
		const pairAddress = await getPairAddress(tokenAddress, WBNB_ADDRESS);
		if (!pairAddress) {
			return false;
		}

		const reserves = await getPairReserves(pairAddress);
		if (!reserves) {
			return false;
		}

		const token = tokenAddress.toLowerCase();
		const bnbReserve =
			token === reserves.token0.toLowerCase() ? reserves.reserve1 : reserves.reserve0;

		const bnbLiquidity = parseFloat(ethers.utils.formatEther(bnbReserve));

		return bnbLiquidity >= minLiquidityBnb;
	} catch (error: any) {
		logger.error('Failed to check liquidity:', error.message);
		return false;
	}
}
