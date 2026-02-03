import { ethers } from 'ethers';
import { Token } from '../../database/models';
import { B_Token } from '../classes/B_Token';
import { logger } from '../../utils/logger';
import { config } from '../../config/config';

// PancakeSwap Factory ABI (for getPair)
const PANCAKE_FACTORY_ABI = [
	'function getPair(address tokenA, address tokenB) external view returns (address pair)',
];

// PancakeSwap Pair ABI (for getReserves)
const PANCAKE_PAIR_ABI = [
	'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
	'function token0() external view returns (address)',
	'function token1() external view returns (address)',
];

// ERC20 ABI
const ERC20_ABI = [
	'function name() external view returns (string)',
	'function symbol() external view returns (string)',
	'function decimals() external view returns (uint8)',
	'function totalSupply() external view returns (uint256)',
];

const PANCAKE_FACTORY_ADDRESS = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73'; // PancakeSwap V2 Factory
const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

export interface TokenValidationResult {
	isValid: boolean;
	error?: string;
	token?: B_Token;
	pairAddress?: string;
	liquidityBnb?: number;
}

/**
 * Token Validation Service
 * Validates tokens and checks if they're on PancakeSwap V2
 */
export class TokenValidator {
	private provider: ethers.providers.JsonRpcProvider;
	private factoryContract: ethers.Contract;

	constructor() {
		this.provider = new ethers.providers.JsonRpcProvider(config.bsc.rpcHttpUrl);
		this.factoryContract = new ethers.Contract(
			PANCAKE_FACTORY_ADDRESS,
			PANCAKE_FACTORY_ABI,
			this.provider
		);
	}

	/**
	 * Validate token and check if it's on PancakeSwap V2
	 */
	async validateToken(tokenAddress: string): Promise<TokenValidationResult> {
		try {
			// Validate address format
			if (!ethers.utils.isAddress(tokenAddress)) {
				return {
					isValid: false,
					error: 'Invalid token address format',
				};
			}

			const normalizedAddress = tokenAddress.toLowerCase();

			// Check if token already exists in database
			let dbToken = await Token.findOne({ address: normalizedAddress });

			if (dbToken && dbToken.isPancakeswapV2) {
				// Token already validated
				logger.info(`Token ${normalizedAddress} found in database`);
				return {
					isValid: true,
					token: new B_Token({
						address: dbToken.address,
						name: dbToken.name,
						symbol: dbToken.symbol,
						decimals: dbToken.decimals,
						totalSupply: dbToken.totalSupply,
						pairAddress: dbToken.pairAddress,
						liquidityBnb: dbToken.liquidityBnb,
					}),
					pairAddress: dbToken.pairAddress || undefined,
					liquidityBnb: dbToken.liquidityBnb || undefined,
				};
			}

			// Fetch token info from blockchain
			const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);

			let name: string;
			let symbol: string;
			let decimals: number;
			let totalSupply: string;

			try {
				[name, symbol, decimals, totalSupply] = await Promise.all([
					tokenContract.name(),
					tokenContract.symbol(),
					tokenContract.decimals(),
					tokenContract.totalSupply().then((supply: ethers.BigNumber) => supply.toString()),
				]);
			} catch (error: any) {
				logger.error(`Failed to fetch token info: ${error.message}`);
				return {
					isValid: false,
					error: 'Failed to fetch token information. Token may not be a valid ERC20.',
				};
			}

			// Check if pair exists on PancakeSwap V2
			// Use checksummed addresses for getPair call
			const checksummedToken = ethers.utils.getAddress(tokenAddress);
			const checksummedWBNB = ethers.utils.getAddress(WBNB_ADDRESS);

			logger.info(`Checking PancakeSwap V2 pair for ${symbol} (${checksummedToken})...`);

			let pairAddress: string;
			try {
				pairAddress = await this.factoryContract.getPair(checksummedToken, checksummedWBNB);
				logger.info(`getPair() returned: ${pairAddress}`);
			} catch (error: any) {
				logger.error(`getPair() call failed: ${error.message}`);
				return {
					isValid: false,
					error: `Failed to check PancakeSwap pair: ${error.message}`,
				};
			}

			if (pairAddress === ethers.constants.AddressZero) {
				logger.warning(`No V2 pair found for ${symbol}. Checking if token has liquidity on other DEXs...`);
				return {
					isValid: false,
					error: '⚠️ HIGH RISK: No PancakeSwap V2 pair found!\n\n' +
						'⚠️ This token may be:\n' +
						'• A fake token with a fraudulent launcher\n' +
						'• Listed only on PancakeSwap V3 (not V2)\n' +
						'• A honeypot or rug pull scam\n' +
						'• Not yet paired with WBNB\n\n' +
						'⚠️ Even if it appears legitimate, the launcher contract may be malicious.\n' +
						'DO NOT BUY unless you have verified the token contract and liquidity lock.',
				};
			}

			logger.success(`✅ Found PancakeSwap V2 pair: ${pairAddress}`);
			// Get liquidity
			const pairContract = new ethers.Contract(pairAddress, PANCAKE_PAIR_ABI, this.provider);

			let liquidityBnb = 0;
			try {
				const [reserve0, reserve1] = await pairContract.getReserves();
				const token0 = await pairContract.token0();

				// Determine which reserve is BNB
				const bnbReserve =
					token0.toLowerCase() === WBNB_ADDRESS.toLowerCase() ? reserve0 : reserve1;

				liquidityBnb = parseFloat(ethers.utils.formatEther(bnbReserve));
				logger.info(`Liquidity: ${liquidityBnb} BNB`);
			} catch (error: any) {
				logger.error(`Failed to fetch liquidity: ${error.message}`);
			}

			// Check minimum liquidity (optional safety check)
			if (liquidityBnb < 0.1) {
				return {
					isValid: false,
					error: `Insufficient liquidity (${liquidityBnb.toFixed(4)} BNB). Minimum 0.1 BNB required.`,
				};
			}

			// Save token to database
			if (dbToken) {
				// Update existing token
				dbToken.name = name;
				dbToken.symbol = symbol;
				dbToken.decimals = decimals;
				dbToken.totalSupply = totalSupply;
				dbToken.pairAddress = pairAddress.toLowerCase();
				dbToken.liquidityBnb = liquidityBnb;
				dbToken.isPancakeswapV2 = true;
				dbToken.isVerified = true;
				await dbToken.save();
			} else {
				// Create new token
				dbToken = await Token.create({
					address: normalizedAddress,
					name,
					symbol,
					decimals,
					totalSupply,
					pairAddress: pairAddress.toLowerCase(),
					liquidityBnb,
					isPancakeswapV2: true,
					isVerified: true,
				});
			}

			logger.success(`Token validated: ${symbol} (${normalizedAddress})`);

			const bToken = new B_Token({
				address: normalizedAddress,
				name,
				symbol,
				decimals,
				totalSupply,
				pairAddress: pairAddress.toLowerCase(),
				liquidityBnb,
			});

			return {
				isValid: true,
				token: bToken,
				pairAddress: pairAddress.toLowerCase(),
				liquidityBnb,
			};
		} catch (error: any) {
			logger.error(`Token validation error: ${error.message}`);
			return {
				isValid: false,
				error: `Validation failed: ${error.message}`,
			};
		}
	}

	/**
	 * Get token info from database or blockchain
	 */
	async getTokenInfo(tokenAddress: string): Promise<B_Token | null> {
		try {
			const normalizedAddress = tokenAddress.toLowerCase();
			const dbToken = await Token.findOne({ address: normalizedAddress });

			if (dbToken) {
				return new B_Token({
					address: dbToken.address,
					name: dbToken.name,
					symbol: dbToken.symbol,
					decimals: dbToken.decimals,
					totalSupply: dbToken.totalSupply,
					pairAddress: dbToken.pairAddress,
					liquidityBnb: dbToken.liquidityBnb,
				});
			}

			// Not in database, fetch from blockchain
			const validation = await this.validateToken(tokenAddress);
			return validation.isValid ? validation.token! : null;
		} catch (error: any) {
			logger.error(`Failed to get token info: ${error.message}`);
			return null;
		}
	}
}

// Singleton instance
export const tokenValidator = new TokenValidator();
