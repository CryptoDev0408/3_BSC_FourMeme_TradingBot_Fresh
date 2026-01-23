import { ethers, BigNumber } from 'ethers';
import { getProvider } from '../wallet/wallet.service';
import { getWalletWithPrivateKey } from '../wallet/wallet.manager';
import { isValidAddress } from '../../utils/validation';
import { logger } from '../../utils/logger';
import {
	PANCAKE_ROUTER_ADDRESS,
	WBNB_ADDRESS,
	DEFAULT_GAS_LIMIT,
	APPROVAL_GAS_LIMIT,
	MIN_SLIPPAGE,
	MAX_SLIPPAGE,
} from '../../config/constants';
import { PANCAKESWAP_ROUTER_ABI } from '../../abi/pancakeswap-router.abi';
import { ERC20_ABI } from '../../abi/erc20.abi';

/**
 * PancakeSwap Service
 * Handles token swaps on PancakeSwap V2
 */

export interface SwapResult {
	success: boolean;
	txHash?: string;
	amountOut?: string;
	gasFee?: number;
	error?: string;
}

export interface SwapEstimate {
	amountOut: string;
	amountOutMin: string;
	priceImpact: number;
	gasEstimate: string;
	gasCost: string;
}

/**
 * Get PancakeSwap router contract instance
 */
function getRouterContract(signer?: ethers.Signer): ethers.Contract {
	const provider = getProvider();
	return new ethers.Contract(
		PANCAKE_ROUTER_ADDRESS,
		PANCAKESWAP_ROUTER_ABI,
		signer || provider
	);
}

/**
 * Get ERC20 token contract instance
 */
function getTokenContract(tokenAddress: string, signer?: ethers.Signer): ethers.Contract {
	const provider = getProvider();
	return new ethers.Contract(tokenAddress, ERC20_ABI, signer || provider);
}

/**
 * Calculate minimum amount out with slippage
 * @param amountOut - Expected output amount
 * @param slippagePercent - Slippage tolerance percentage (0.1 - 99)
 * @returns Minimum amount out after slippage
 */
export function calculateMinAmountOut(amountOut: BigNumber, slippagePercent: number): BigNumber {
	if (slippagePercent < MIN_SLIPPAGE || slippagePercent > MAX_SLIPPAGE) {
		throw new Error(`Slippage must be between ${MIN_SLIPPAGE}% and ${MAX_SLIPPAGE}%`);
	}

	// Calculate: amountOut * (100 - slippage) / 100
	const slippageFactor = BigNumber.from(10000 - Math.floor(slippagePercent * 100));
	return amountOut.mul(slippageFactor).div(10000);
}

/**
 * Calculate price impact
 * @param amountIn - Input amount
 * @param amountOut - Output amount
 * @param reserves - [reserveIn, reserveOut]
 * @returns Price impact percentage
 */
export function calculatePriceImpact(
	amountIn: BigNumber,
	amountOut: BigNumber,
	reserves: [BigNumber, BigNumber]
): number {
	const [reserveIn, reserveOut] = reserves;

	// Calculate expected price without impact: reserveOut / reserveIn
	// Calculate actual price: amountOut / amountIn
	// Price impact = (1 - actualPrice / expectedPrice) * 100

	const expectedPrice = reserveOut.mul(ethers.utils.parseEther('1')).div(reserveIn);
	const actualPrice = amountOut.mul(ethers.utils.parseEther('1')).div(amountIn);

	if (expectedPrice.isZero()) return 0;

	const impact = expectedPrice.sub(actualPrice).mul(10000).div(expectedPrice);
	return impact.toNumber() / 100;
}

/**
 * Get expected output amount for a swap
 * @param amountIn - Input amount in wei
 * @param path - Token path [tokenIn, tokenOut]
 * @returns Expected output amount in wei
 */
export async function getAmountsOut(amountIn: string, path: string[]): Promise<string[]> {
	try {
		if (path.length < 2) {
			throw new Error('Path must contain at least 2 addresses');
		}

		for (const addr of path) {
			if (!isValidAddress(addr)) {
				throw new Error(`Invalid address in path: ${addr}`);
			}
		}

		const router = getRouterContract();
		const amounts = await router.getAmountsOut(amountIn, path);

		return amounts.map((amount: BigNumber) => amount.toString());
	} catch (error: any) {
		logger.error('Failed to get amounts out:', error.message);
		throw error;
	}
}

/**
 * Check token allowance for router
 * @param tokenAddress - Token contract address
 * @param ownerAddress - Owner wallet address
 * @returns Current allowance in wei
 */
export async function getTokenAllowance(
	tokenAddress: string,
	ownerAddress: string
): Promise<string> {
	try {
		if (!isValidAddress(tokenAddress)) {
			throw new Error('Invalid token address');
		}
		if (!isValidAddress(ownerAddress)) {
			throw new Error('Invalid owner address');
		}

		const tokenContract = getTokenContract(tokenAddress);
		const allowance = await tokenContract.allowance(ownerAddress, PANCAKE_ROUTER_ADDRESS);

		return allowance.toString();
	} catch (error: any) {
		logger.error('Failed to get token allowance:', error.message);
		throw error;
	}
}

/**
 * Approve token spending for PancakeSwap router
 * @param walletId - Wallet database ID
 * @param userId - User ID for verification
 * @param tokenAddress - Token to approve
 * @param amount - Amount to approve (default: max uint256)
 * @returns Transaction hash
 */
export async function approveToken(
	walletId: string,
	userId: string,
	tokenAddress: string,
	amount?: string
): Promise<string> {
	try {
		if (!isValidAddress(tokenAddress)) {
			throw new Error('Invalid token address');
		}

		logger.info(`Approving token ${tokenAddress} for wallet ${walletId}`);

		// Get wallet with private key
		const walletResult = await getWalletWithPrivateKey(walletId, userId);
		if (!walletResult.success || !walletResult.wallet || !walletResult.privateKey) {
			throw new Error(walletResult.error || 'Wallet not found');
		}

		// Create signer with decrypted private key
		const privateKey = walletResult.privateKey;
		const provider = getProvider();
		const signer = new ethers.Wallet(privateKey, provider);

		// Create token contract with signer
		const tokenContract = getTokenContract(tokenAddress, signer);

		// Use max uint256 if no amount specified
		const approvalAmount = amount || ethers.constants.MaxUint256.toString();

		// Estimate gas
		const gasEstimate = await tokenContract.estimateGas.approve(
			PANCAKE_ROUTER_ADDRESS,
			approvalAmount
		);

		// Add 20% buffer to gas estimate
		const gasLimit = gasEstimate.mul(120).div(100);

		// Get current gas price
		const gasPrice = await provider.getGasPrice();

		// Send approval transaction
		const tx = await tokenContract.approve(PANCAKE_ROUTER_ADDRESS, approvalAmount, {
			gasLimit: gasLimit.gt(APPROVAL_GAS_LIMIT) ? gasLimit : APPROVAL_GAS_LIMIT,
			gasPrice: gasPrice,
		});

		logger.success(`Token approval sent: ${tx.hash}`);

		// Wait for confirmation
		await tx.wait();

		logger.success(`Token approval confirmed: ${tx.hash}`);

		return tx.hash;
	} catch (error: any) {
		logger.error('Failed to approve token:', error.message);
		throw error;
	}
}

/**
 * Estimate gas for buy transaction
 * @param walletAddress - Buyer wallet address
 * @param tokenAddress - Token to buy
 * @param bnbAmount - BNB amount in wei
 * @param slippagePercent - Slippage tolerance
 * @returns Gas estimate in wei
 */
export async function estimateBuyGas(
	walletAddress: string,
	tokenAddress: string,
	bnbAmount: string,
	slippagePercent: number
): Promise<string> {
	try {
		const router = getRouterContract();
		const path = [WBNB_ADDRESS, tokenAddress];

		// Get expected output
		const amounts = await router.getAmountsOut(bnbAmount, path);
		const amountOutMin = calculateMinAmountOut(amounts[1], slippagePercent);

		// Calculate deadline (10 minutes from now)
		const deadline = Math.floor(Date.now() / 1000) + 600;

		// Estimate gas
		const gasEstimate = await router.estimateGas.swapExactETHForTokensSupportingFeeOnTransferTokens(
			amountOutMin,
			path,
			walletAddress,
			deadline,
			{ value: bnbAmount }
		);

		return gasEstimate.toString();
	} catch (error: any) {
		logger.error('Failed to estimate buy gas:', error.message);
		// Return default gas limit if estimation fails
		return DEFAULT_GAS_LIMIT.toString();
	}
}

/**
 * Estimate gas for sell transaction
 * @param walletAddress - Seller wallet address
 * @param tokenAddress - Token to sell
 * @param tokenAmount - Token amount in wei
 * @param slippagePercent - Slippage tolerance
 * @returns Gas estimate in wei
 */
export async function estimateSellGas(
	walletAddress: string,
	tokenAddress: string,
	tokenAmount: string,
	slippagePercent: number
): Promise<string> {
	try {
		const router = getRouterContract();
		const path = [tokenAddress, WBNB_ADDRESS];

		// Get expected output
		const amounts = await router.getAmountsOut(tokenAmount, path);
		const amountOutMin = calculateMinAmountOut(amounts[1], slippagePercent);

		// Calculate deadline
		const deadline = Math.floor(Date.now() / 1000) + 600;

		// Estimate gas
		const gasEstimate = await router.estimateGas.swapExactTokensForETHSupportingFeeOnTransferTokens(
			tokenAmount,
			amountOutMin,
			path,
			walletAddress,
			deadline
		);

		return gasEstimate.toString();
	} catch (error: any) {
		logger.error('Failed to estimate sell gas:', error.message);
		// Return default gas limit if estimation fails
		return DEFAULT_GAS_LIMIT.toString();
	}
}

/**
 * Get swap estimate for buying tokens
 * @param bnbAmount - BNB amount in wei
 * @param tokenAddress - Token to buy
 * @param slippagePercent - Slippage tolerance
 * @returns Swap estimate details
 */
export async function estimateBuy(
	bnbAmount: string,
	tokenAddress: string,
	slippagePercent: number
): Promise<SwapEstimate> {
	try {
		const router = getRouterContract();
		const path = [WBNB_ADDRESS, tokenAddress];

		// Get expected amounts
		const amounts = await router.getAmountsOut(bnbAmount, path);
		const amountOut = amounts[1];
		const amountOutMin = calculateMinAmountOut(amountOut, slippagePercent);

		// Get gas price
		const provider = getProvider();
		const gasPrice = await provider.getGasPrice();

		// Estimate gas (use default if fails)
		let gasEstimate = BigNumber.from(DEFAULT_GAS_LIMIT);
		try {
			const deadline = Math.floor(Date.now() / 1000) + 600;
			gasEstimate = await router.estimateGas.swapExactETHForTokensSupportingFeeOnTransferTokens(
				amountOutMin,
				path,
				PANCAKE_ROUTER_ADDRESS, // Dummy address for estimation
				deadline,
				{ value: bnbAmount }
			);
			// Add 20% buffer
			gasEstimate = gasEstimate.mul(120).div(100);
		} catch (error) {
			// Use default
		}

		// Calculate gas cost
		const gasCost = gasEstimate.mul(gasPrice);

		// Calculate price impact (simplified, would need reserves for accurate calculation)
		const priceImpact = 0; // Placeholder

		return {
			amountOut: amountOut.toString(),
			amountOutMin: amountOutMin.toString(),
			priceImpact,
			gasEstimate: gasEstimate.toString(),
			gasCost: gasCost.toString(),
		};
	} catch (error: any) {
		logger.error('Failed to estimate buy:', error.message);
		throw error;
	}
}

/**
 * Get swap estimate for selling tokens
 * @param tokenAmount - Token amount in wei
 * @param tokenAddress - Token to sell
 * @param slippagePercent - Slippage tolerance
 * @returns Swap estimate details
 */
export async function estimateSell(
	tokenAmount: string,
	tokenAddress: string,
	slippagePercent: number
): Promise<SwapEstimate> {
	try {
		const router = getRouterContract();
		const path = [tokenAddress, WBNB_ADDRESS];

		// Get expected amounts
		const amounts = await router.getAmountsOut(tokenAmount, path);
		const amountOut = amounts[1];
		const amountOutMin = calculateMinAmountOut(amountOut, slippagePercent);

		// Get gas price
		const provider = getProvider();
		const gasPrice = await provider.getGasPrice();

		// Estimate gas
		let gasEstimate = BigNumber.from(DEFAULT_GAS_LIMIT);
		try {
			const deadline = Math.floor(Date.now() / 1000) + 600;
			gasEstimate = await router.estimateGas.swapExactTokensForETHSupportingFeeOnTransferTokens(
				tokenAmount,
				amountOutMin,
				path,
				PANCAKE_ROUTER_ADDRESS, // Dummy address
				deadline
			);
			// Add 20% buffer
			gasEstimate = gasEstimate.mul(120).div(100);
		} catch (error) {
			// Use default
		}

		// Calculate gas cost
		const gasCost = gasEstimate.mul(gasPrice);

		return {
			amountOut: amountOut.toString(),
			amountOutMin: amountOutMin.toString(),
			priceImpact: 0, // Placeholder
			gasEstimate: gasEstimate.toString(),
			gasCost: gasCost.toString(),
		};
	} catch (error: any) {
		logger.error('Failed to estimate sell:', error.message);
		throw error;
	}
}

/**
 * Buy tokens with BNB (swapExactETHForTokens)
 * @param walletId - Wallet database ID
 * @param userId - User ID for verification
 * @param tokenAddress - Token to buy
 * @param bnbAmount - BNB amount in wei
 * @param slippagePercent - Slippage tolerance (0.1 - 99)
 * @param gasPrice - Custom gas price (optional, uses network price if not provided)
 * @returns Swap result with transaction hash
 */
export async function buyToken(
	walletId: string,
	userId: string,
	tokenAddress: string,
	bnbAmount: string,
	slippagePercent: number,
	gasPrice?: string
): Promise<SwapResult> {
	try {
		if (!isValidAddress(tokenAddress)) {
			throw new Error('Invalid token address');
		}

		logger.trade(`Buying token ${tokenAddress} with ${ethers.utils.formatEther(bnbAmount)} BNB`);

		// Get wallet with private key
		const walletResult = await getWalletWithPrivateKey(walletId, userId);
		if (!walletResult.success || !walletResult.wallet || !walletResult.privateKey) {
			throw new Error(walletResult.error || 'Wallet not found');
		}

		// Create signer with decrypted private key
		const privateKey = walletResult.privateKey;
		const wallet = walletResult.wallet;
		const provider = getProvider();
		const signer = new ethers.Wallet(privateKey, provider);

		// Get router contract with signer
		const router = getRouterContract(signer);

		// Setup swap parameters
		const path = [WBNB_ADDRESS, tokenAddress];
		const deadline = Math.floor(Date.now() / 1000) + 600; // 10 minutes

		// Get token decimals
		const tokenContract = new ethers.Contract(
			tokenAddress,
			['function decimals() view returns (uint8)'],
			provider
		);
		let tokenDecimals = 18; // Default to 18
		try {
			tokenDecimals = await tokenContract.decimals();
		} catch (error) {
			logger.warning('Failed to get token decimals, using default 18');
		}

		// Get expected output amount
		const amounts = await router.getAmountsOut(bnbAmount, path);
		const amountOut = amounts[1];
		const amountOutMin = calculateMinAmountOut(amountOut, slippagePercent);

		logger.info(
			`Expected output: ${ethers.utils.formatUnits(amountOut, tokenDecimals)} tokens (min: ${ethers.utils.formatUnits(amountOutMin, tokenDecimals)})`
		);

		// Estimate gas
		let gasLimit: BigNumber;
		try {
			const gasEstimate = await router.estimateGas.swapExactETHForTokensSupportingFeeOnTransferTokens(
				amountOutMin,
				path,
				wallet.address,
				deadline,
				{ value: bnbAmount }
			);
			// Add 20% buffer
			gasLimit = gasEstimate.mul(120).div(100);
		} catch (error) {
			logger.warning('Gas estimation failed, using default gas limit');
			gasLimit = BigNumber.from(DEFAULT_GAS_LIMIT);
		}

		// Get gas price
		let txGasPrice: BigNumber;
		if (gasPrice) {
			txGasPrice = BigNumber.from(gasPrice);
		} else {
			txGasPrice = await provider.getGasPrice();
			// Add 10% to network gas price for faster confirmation
			txGasPrice = txGasPrice.mul(110).div(100);
		}

		logger.info(
			`Gas: ${gasLimit.toString()} units at ${ethers.utils.formatUnits(txGasPrice, 'gwei')} Gwei`
		);

		// Execute swap
		const tx = await router.swapExactETHForTokensSupportingFeeOnTransferTokens(
			amountOutMin,
			path,
			wallet.address,
			deadline,
			{
				value: bnbAmount,
				gasLimit: gasLimit,
				gasPrice: txGasPrice,
			}
		);

		logger.success(`Buy transaction sent: ${tx.hash}`);

		// Wait for confirmation
		const receipt = await tx.wait();

		logger.success(`Buy transaction confirmed in block ${receipt.blockNumber}`);

		// Calculate gas fee: gasUsed * gasPrice
		const gasFeeWei = receipt.gasUsed.mul(receipt.effectiveGasPrice || txGasPrice);
		const gasFeeInBnb = parseFloat(ethers.utils.formatEther(gasFeeWei));

		// Format token amount with proper decimals
		const tokenAmountFormatted = ethers.utils.formatUnits(amountOut, tokenDecimals);

		return {
			success: true,
			txHash: tx.hash,
			amountOut: tokenAmountFormatted, // Now properly formatted with token decimals
			gasFee: gasFeeInBnb,
		};
	} catch (error: any) {
		logger.error('Failed to buy token:', error.message);
		return {
			success: false,
			error: error.message,
		};
	}
}

/**
 * Sell tokens for BNB (swapExactTokensForETH)
 * @param walletId - Wallet database ID
 * @param userId - User ID for verification
 * @param tokenAddress - Token to sell
 * @param tokenAmount - Token amount in wei
 * @param slippagePercent - Slippage tolerance (0.1 - 99)
 * @param gasPrice - Custom gas price (optional)
 * @returns Swap result with transaction hash
 */
export async function sellToken(
	walletId: string,
	userId: string,
	tokenAddress: string,
	tokenAmount: string,
	slippagePercent: number,
	gasPrice?: string
): Promise<SwapResult> {
	try {
		if (!isValidAddress(tokenAddress)) {
			throw new Error('Invalid token address');
		}

		logger.trade(`Selling ${tokenAmount} of token ${tokenAddress}`);

		// Get wallet with private key
		const walletResult = await getWalletWithPrivateKey(walletId, userId);
		if (!walletResult.success || !walletResult.wallet || !walletResult.privateKey) {
			throw new Error(walletResult.error || 'Wallet not found');
		}

		// Create signer with decrypted private key
		const privateKey = walletResult.privateKey;
		const wallet = walletResult.wallet;
		const provider = getProvider();
		const signer = new ethers.Wallet(privateKey, provider);

		// Check allowance
		const currentAllowance = await getTokenAllowance(tokenAddress, wallet.address);
		const requiredAmount = BigNumber.from(tokenAmount);

		if (BigNumber.from(currentAllowance).lt(requiredAmount)) {
			logger.info('Token allowance insufficient, approving...');
			await approveToken(walletId, userId, tokenAddress);
			logger.success('Token approved');
		}

		// Get router contract with signer
		const router = getRouterContract(signer);

		// Setup swap parameters
		const path = [tokenAddress, WBNB_ADDRESS];
		const deadline = Math.floor(Date.now() / 1000) + 600; // 10 minutes

		// Get expected output amount
		const amounts = await router.getAmountsOut(tokenAmount, path);
		const amountOut = amounts[1];
		const amountOutMin = calculateMinAmountOut(amountOut, slippagePercent);

		logger.info(
			`Expected output: ${ethers.utils.formatEther(amountOut)} BNB (min: ${ethers.utils.formatEther(amountOutMin)})`
		);

		// Estimate gas
		let gasLimit: BigNumber;
		try {
			const gasEstimate = await router.estimateGas.swapExactTokensForETHSupportingFeeOnTransferTokens(
				tokenAmount,
				amountOutMin,
				path,
				wallet.address,
				deadline
			);
			// Add 20% buffer
			gasLimit = gasEstimate.mul(120).div(100);
		} catch (error) {
			logger.warning('Gas estimation failed, using default gas limit');
			gasLimit = BigNumber.from(DEFAULT_GAS_LIMIT);
		}

		// Get gas price
		let txGasPrice: BigNumber;
		if (gasPrice) {
			txGasPrice = BigNumber.from(gasPrice);
		} else {
			txGasPrice = await provider.getGasPrice();
			// Add 10% for faster confirmation
			txGasPrice = txGasPrice.mul(110).div(100);
		}

		logger.info(
			`Gas: ${gasLimit.toString()} units at ${ethers.utils.formatUnits(txGasPrice, 'gwei')} Gwei`
		);

		// Execute swap
		const tx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
			tokenAmount,
			amountOutMin,
			path,
			wallet.address,
			deadline,
			{
				gasLimit: gasLimit,
				gasPrice: txGasPrice,
			}
		);

		logger.success(`Sell transaction sent: ${tx.hash}`);

		// Wait for confirmation
		const receipt = await tx.wait();

		logger.success(`Sell transaction confirmed in block ${receipt.blockNumber}`);

		// Calculate gas fee: gasUsed * gasPrice
		const gasFeeWei = receipt.gasUsed.mul(receipt.effectiveGasPrice || txGasPrice);
		const gasFeeInBnb = parseFloat(ethers.utils.formatEther(gasFeeWei));

		return {
			success: true,
			txHash: tx.hash,
			amountOut: amountOut.toString(),
			gasFee: gasFeeInBnb,
		};
	} catch (error: any) {
		logger.error('Failed to sell token:', error.message);
		return {
			success: false,
			error: error.message,
		};
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
		logger.error('Failed to get token balance:', error.message);
		throw error;
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
			throw new Error('Invalid token address');
		}

		const tokenContract = getTokenContract(tokenAddress);
		const decimals = await tokenContract.decimals();

		return decimals;
	} catch (error: any) {
		logger.error('Failed to get token decimals:', error.message);
		throw error;
	}
}
