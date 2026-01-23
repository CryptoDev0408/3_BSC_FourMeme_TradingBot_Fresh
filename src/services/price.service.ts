import { ethers } from 'ethers';
import { logger } from '../utils/logger';
import { PANCAKE_FACTORY_ADDRESS, WBNB_ADDRESS } from '../config/constants';
import { PANCAKESWAP_FACTORY_ABI } from '../abi/pancakeswap-factory.abi';
import { PANCAKESWAP_PAIR_ABI } from '../abi/pancakeswap-pair.abi';

interface TokenPrice {
	tokenAddress: string;
	priceInBnb: number;
	reserve0: string;
	reserve1: string;
	pairAddress: string;
	isToken0: boolean;
	timestamp: number;
}

interface PairReserves {
	reserve0: ethers.BigNumber;
	reserve1: ethers.BigNumber;
	blockTimestampLast: number;
}

/**
 * Optimized Price Service
 * Uses AMM formula and batch processing for high-performance price updates
 */
export class PriceService {
	private provider: ethers.providers.JsonRpcProvider;
	private factoryContract: ethers.Contract;
	private priceCache: Map<string, TokenPrice>;
	private pairCache: Map<string, string>; // tokenAddress => pairAddress
	private cacheTTL: number = 2000; // 2 seconds cache

	constructor(provider: ethers.providers.JsonRpcProvider) {
		this.provider = provider;
		this.factoryContract = new ethers.Contract(
			PANCAKE_FACTORY_ADDRESS,
			PANCAKESWAP_FACTORY_ABI,
			provider
		);
		this.priceCache = new Map();
		this.pairCache = new Map();
	}

	/**
	 * Get pair address for token-WBNB
	 */
	private async getPairAddress(tokenAddress: string): Promise<string | null> {
		try {
			// Check cache first
			if (this.pairCache.has(tokenAddress)) {
				return this.pairCache.get(tokenAddress)!;
			}

			// Get from factory
			const pairAddress = await this.factoryContract.getPair(tokenAddress, WBNB_ADDRESS);

			if (pairAddress === ethers.constants.AddressZero) {
				logger.warning(`No pair found for token ${tokenAddress}`);
				return null;
			}

			// Cache the pair address (permanent cache)
			this.pairCache.set(tokenAddress, pairAddress);
			return pairAddress;
		} catch (error: any) {
			logger.error(`Failed to get pair address for ${tokenAddress}: ${error.message}`);
			return null;
		}
	}

	/**
	 * Get reserves from pair contract
	 */
	private async getReserves(pairAddress: string): Promise<PairReserves | null> {
		try {
			const pairContract = new ethers.Contract(
				pairAddress,
				PANCAKESWAP_PAIR_ABI,
				this.provider
			);

			const reserves = await pairContract.getReserves();
			return {
				reserve0: reserves[0],
				reserve1: reserves[1],
				blockTimestampLast: reserves[2],
			};
		} catch (error: any) {
			logger.error(`Failed to get reserves for pair ${pairAddress}: ${error.message}`);
			return null;
		}
	}

	/**
	 * Calculate price using AMM formula (x * y = k)
	 * Price = reserveWBNB / reserveToken
	 */
	private calculatePrice(
		reserve0: ethers.BigNumber,
		reserve1: ethers.BigNumber,
		isToken0: boolean
	): number {
		try {
			// If token is token0, price = reserve1 / reserve0
			// If token is token1, price = reserve0 / reserve1
			const reserveToken = isToken0 ? reserve0 : reserve1;
			const reserveWBNB = isToken0 ? reserve1 : reserve0;

			if (reserveToken.isZero()) {
				return 0;
			}

			// Calculate price in BNB
			// Price = (reserveWBNB / reserveToken)
			const priceInBnb = parseFloat(ethers.utils.formatEther(reserveWBNB)) /
				parseFloat(ethers.utils.formatEther(reserveToken));

			return priceInBnb;
		} catch (error: any) {
			logger.error(`Failed to calculate price: ${error.message}`);
			return 0;
		}
	}

	/**
	 * Get token price in BNB (single token)
	 */
	async getTokenPrice(tokenAddress: string, useCache: boolean = true): Promise<number | null> {
		try {
			// Check cache
			if (useCache && this.priceCache.has(tokenAddress)) {
				const cached = this.priceCache.get(tokenAddress)!;
				if (Date.now() - cached.timestamp < this.cacheTTL) {
					return cached.priceInBnb;
				}
			}

			// Get pair address
			const pairAddress = await this.getPairAddress(tokenAddress);
			if (!pairAddress) {
				return null;
			}

			// Get reserves
			const reserves = await this.getReserves(pairAddress);
			if (!reserves) {
				return null;
			}

			// Check which token is token0
			const pairContract = new ethers.Contract(
				pairAddress,
				PANCAKESWAP_PAIR_ABI,
				this.provider
			);
			const token0 = await pairContract.token0();
			const isToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();

			// Calculate price
			const priceInBnb = this.calculatePrice(
				reserves.reserve0,
				reserves.reserve1,
				isToken0
			);

			// Cache the price
			const priceData: TokenPrice = {
				tokenAddress,
				priceInBnb,
				reserve0: reserves.reserve0.toString(),
				reserve1: reserves.reserve1.toString(),
				pairAddress,
				isToken0,
				timestamp: Date.now(),
			};
			this.priceCache.set(tokenAddress, priceData);

			return priceInBnb;
		} catch (error: any) {
			logger.error(`Failed to get token price for ${tokenAddress}: ${error.message}`);
			return null;
		}
	}

	/**
	 * Get multiple token prices in batch (OPTIMIZED)
	 * This is the key method for high-performance monitoring
	 */
	async getTokenPricesBatch(tokenAddresses: string[]): Promise<Map<string, number>> {
		const prices = new Map<string, number>();

		try {
			if (tokenAddresses.length === 0) {
				return prices;
			}

			// Step 1: Get all pair addresses in parallel
			const pairPromises = tokenAddresses.map(async (tokenAddress) => {
				const pairAddress = await this.getPairAddress(tokenAddress);
				return { tokenAddress, pairAddress };
			});

			const pairResults = await Promise.all(pairPromises);

			// Filter out tokens without pairs
			const validPairs = pairResults.filter((result) => result.pairAddress !== null);

			if (validPairs.length === 0) {
				return prices;
			}

			// Step 2: Create multicall for reserves (batch RPC call)
			// Get reserves and token0 for all pairs in parallel
			const dataPromises = validPairs.map(async ({ tokenAddress, pairAddress }) => {
				const pairContract = new ethers.Contract(
					pairAddress!,
					PANCAKESWAP_PAIR_ABI,
					this.provider
				);

				// Fetch reserves and token0 in parallel for each pair
				const [reserves, token0] = await Promise.all([
					pairContract.getReserves(),
					pairContract.token0(),
				]);

				return {
					tokenAddress,
					pairAddress: pairAddress!,
					reserves: {
						reserve0: reserves[0],
						reserve1: reserves[1],
						blockTimestampLast: reserves[2],
					},
					token0,
				};
			});

			const dataResults = await Promise.all(dataPromises);

			// Step 3: Calculate prices from reserves
			for (const data of dataResults) {
				const isToken0 = data.token0.toLowerCase() === data.tokenAddress.toLowerCase();
				const priceInBnb = this.calculatePrice(
					data.reserves.reserve0,
					data.reserves.reserve1,
					isToken0
				);

				if (priceInBnb > 0) {
					prices.set(data.tokenAddress, priceInBnb);

					// Update cache
					const priceData: TokenPrice = {
						tokenAddress: data.tokenAddress,
						priceInBnb,
						reserve0: data.reserves.reserve0.toString(),
						reserve1: data.reserves.reserve1.toString(),
						pairAddress: data.pairAddress,
						isToken0,
						timestamp: Date.now(),
					};
					this.priceCache.set(data.tokenAddress, priceData);
				}
			}

			logger.debug(`Batch price update: ${prices.size}/${tokenAddresses.length} tokens`);
		} catch (error: any) {
			logger.error(`Batch price fetch error: ${error.message}`);
		}

		return prices;
	}

	/**
	 * Clear price cache
	 */
	clearCache(): void {
		this.priceCache.clear();
	}

	/**
	 * Get cache size
	 */
	getCacheSize(): number {
		return this.priceCache.size;
	}

	/**
	 * Set cache TTL
	 */
	setCacheTTL(ttlMs: number): void {
		this.cacheTTL = ttlMs;
	}
}

// Singleton instance
let priceServiceInstance: PriceService | null = null;

export function getPriceService(provider: ethers.providers.JsonRpcProvider): PriceService {
	if (!priceServiceInstance) {
		priceServiceInstance = new PriceService(provider);
	}
	return priceServiceInstance;
}
