import { ethers } from 'ethers';
import { B_Wallet } from './B_Wallet';
import { B_Token } from './B_Token';
import { logger } from '../../utils/logger';

// PancakeSwap ABIs
import { PANCAKESWAP_ROUTER_ABI } from '../../abi/pancakeswap-router.abi';

// Import config
import { config } from '../../config/config';

/**
 * B_Trading - Buy/Sell Execution Utility
 * Handles all swap operations on PancakeSwap
 */
export class B_Trading {
	private static provider: ethers.providers.JsonRpcProvider;
	private static routerContract: ethers.Contract;
	private static ROUTER_ADDRESS = '0x10ED43C718714eb63d5aA57B78B54704E256024E'; // PancakeSwap Router V2
	private static WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

	/**
	 * Initialize trading service
	 */
	static initialize() {
		if (!this.provider) {
			this.provider = new ethers.providers.JsonRpcProvider(config.bsc.rpcHttpUrl);
			this.routerContract = new ethers.Contract(
				this.ROUTER_ADDRESS,
				PANCAKESWAP_ROUTER_ABI,
				this.provider
			);
			logger.info('B_Trading initialized');
		}
	}

	/**
	 * Buy tokens with BNB
	 */
	static async buy(params: {
		wallet: B_Wallet;
		token: B_Token;
		bnbAmount: number;
		slippage: number;
		gasPrice: string;
		gasLimit?: number;
	}): Promise<{ success: boolean; txHash?: string; error?: string; tokenAmount?: string }> {
		try {
			this.initialize();

			const { wallet, token, bnbAmount, slippage, gasPrice, gasLimit = 300000 } = params;

			// Get ethers wallet instance
			const ethersWallet = wallet.getEthersWallet();
			const routerWithSigner = this.routerContract.connect(ethersWallet);

			// Calculate amounts
			const amountIn = ethers.utils.parseEther(bnbAmount.toString());

			// Get expected output amount
			const path = [this.WBNB_ADDRESS, token.address];
			const amounts = await this.routerContract.getAmountsOut(amountIn, path);
			const expectedOut = amounts[1];

			// Calculate minimum amount with slippage
			const slippageBps = Math.floor(slippage * 100); // Convert to basis points
			const minAmountOut = expectedOut.mul(10000 - slippageBps).div(10000);

			// Get deadline (10 minutes from now)
			const deadline = Math.floor(Date.now() / 1000) + 600;

			logger.info(`Buying ${token.symbol}...`);
			logger.info(`Amount In: ${bnbAmount} BNB`);
			logger.info(`Expected Out: ${ethers.utils.formatUnits(expectedOut, token.decimals)} ${token.symbol}`);
			logger.info(`Min Amount Out (${slippage}% slippage): ${ethers.utils.formatUnits(minAmountOut, token.decimals)} ${token.symbol}`);

			// Execute swap - USING TAX-COMPATIBLE FUNCTION
			const tx = await routerWithSigner.swapExactETHForTokensSupportingFeeOnTransferTokens(
				minAmountOut,
				path,
				wallet.address,
				deadline,
				{
					value: amountIn,
					gasPrice: ethers.utils.parseUnits(String(gasPrice), 'gwei'),
					gasLimit: ethers.BigNumber.from(gasLimit),
				}
			);

			logger.info(`Transaction sent: ${tx.hash}`);

			// Wait for confirmation
			const receipt = await tx.wait();

			if (receipt.status === 1) {
				// Parse Transfer event to get actual tokens received
				// Transfer event: Transfer(address indexed from, address indexed to, uint256 value)
				const transferTopic = ethers.utils.id('Transfer(address,address,uint256)');

				// Find the Transfer event where tokens are transferred TO our wallet
				const transferLog = receipt.logs.find(
					(log: any) => {
						if (log.topics[0] !== transferTopic) return false;
						if (log.address.toLowerCase() !== token.address.toLowerCase()) return false;
						// Check if the recipient (topics[2]) is our wallet address
						const recipient = ethers.utils.defaultAbiCoder.decode(['address'], log.topics[2])[0];
						return recipient.toLowerCase() === wallet.address.toLowerCase();
					}
				);

				let tokenAmount: string;
				if (transferLog) {
					// Decode the transfer amount from the log data
					const transferAmount = ethers.BigNumber.from(transferLog.data);
					tokenAmount = ethers.utils.formatUnits(transferAmount, token.decimals);
					logger.success(`Buy successful! Got ${tokenAmount} ${token.symbol} (from Transfer event)`);
				} else {
					// Fallback to expected amount if Transfer event not found
					tokenAmount = ethers.utils.formatUnits(expectedOut, token.decimals);
					logger.warning(`Transfer event not found for wallet ${wallet.address}, using expected amount: ${tokenAmount} ${token.symbol}`);
					logger.debug(`Receipt logs count: ${receipt.logs.length}, Token address: ${token.address}`);
				}

				return {
					success: true,
					txHash: tx.hash,
					tokenAmount,
				};
			} else {
				logger.error('Transaction failed');
				return {
					success: false,
					error: 'Transaction reverted',
				};
			}
		} catch (error: any) {
			logger.error('Buy failed:', error.message);
			return {
				success: false,
				error: error.message || 'Unknown error',
			};
		}
	}

	/**
	 * Sell tokens for BNB
	 */
	static async sell(params: {
		wallet: B_Wallet;
		token: B_Token;
		tokenAmount: string;
		slippage: number;
		gasPrice: string;
		gasLimit?: number;
	}): Promise<{ success: boolean; txHash?: string; error?: string; bnbAmount?: string }> {
		try {
			this.initialize();

			const { wallet, token, tokenAmount, slippage, gasPrice, gasLimit = 300000 } = params;

			// Get ethers wallet instance
			const ethersWallet = wallet.getEthersWallet();
			const routerWithSigner = this.routerContract.connect(ethersWallet);

			// Parse token amount
			const amountIn = ethers.utils.parseUnits(tokenAmount, token.decimals);
			logger.info(`Parsed sell amount: ${amountIn.toString()} (${tokenAmount} ${token.symbol})`);

			// Verify token amount is positive
			if (amountIn.lte(0)) {
				throw new Error('Token amount must be greater than 0');
			}

			// Check token approval with comprehensive logging
			const erc20Abi = [
				'function allowance(address owner, address spender) view returns (uint256)',
				'function approve(address spender, uint256 amount) returns (bool)',
				'function balanceOf(address owner) view returns (uint256)',
			];
			const tokenContract = new ethers.Contract(token.address, erc20Abi, ethersWallet);

			// Check actual token balance
			const actualBalance = await tokenContract.balanceOf(wallet.address);
			logger.info(`Token balance: ${ethers.utils.formatUnits(actualBalance, token.decimals)} ${token.symbol}`);

			if (actualBalance.lt(amountIn)) {
				const errorMsg = `Insufficient token balance: have ${ethers.utils.formatUnits(actualBalance, token.decimals)}, need ${tokenAmount}`;
				logger.error(errorMsg);
				throw new Error(errorMsg);
			}

			// Check and handle approval
			const allowance = await tokenContract.allowance(wallet.address, this.ROUTER_ADDRESS);
			logger.info(`Current allowance: ${ethers.utils.formatUnits(allowance, token.decimals)} ${token.symbol}`);
			logger.info(`Required amount: ${ethers.utils.formatUnits(amountIn, token.decimals)} ${token.symbol}`);

			if (allowance.lt(amountIn)) {
				logger.warning(`⚠️  Insufficient allowance! Current: ${ethers.utils.formatUnits(allowance, token.decimals)}, Required: ${ethers.utils.formatUnits(amountIn, token.decimals)}`);
				logger.info('🔐 Approving token for unlimited spending...');

				try {
					// Approve with MaxUint256 for future transactions
					const approveTx = await tokenContract.approve(
						this.ROUTER_ADDRESS,
						ethers.constants.MaxUint256,
						{
							gasPrice: ethers.utils.parseUnits(String(gasPrice), 'gwei'),
							gasLimit: ethers.BigNumber.from(100000),
						}
					);

					logger.info(`Approval TX sent: ${approveTx.hash}`);
					const approveReceipt = await approveTx.wait();

					if (approveReceipt.status !== 1) {
						throw new Error('Approval transaction failed (status = 0)');
					}

					logger.success(`✅ Token approved! TX: ${approveTx.hash}, Block: ${approveReceipt.blockNumber}`);

					// Verify approval was successful
					const newAllowance = await tokenContract.allowance(wallet.address, this.ROUTER_ADDRESS);
					logger.info(`New allowance: ${ethers.utils.formatUnits(newAllowance, token.decimals)} ${token.symbol}`);

					if (newAllowance.lt(amountIn)) {
						throw new Error(`Approval verification failed: allowance still insufficient (${ethers.utils.formatUnits(newAllowance, token.decimals)} < ${tokenAmount})`);
					}
				} catch (approveError: any) {
					logger.error(`Approval failed: ${approveError.message}`);
					throw new Error(`Token approval failed: ${approveError.message}`);
				}
			} else {
				logger.success(`✅ Allowance sufficient (${ethers.utils.formatUnits(allowance, token.decimals)} >= ${tokenAmount})`);
			}

			// Get expected output amount
			const path = [token.address, this.WBNB_ADDRESS];
			const amounts = await this.routerContract.getAmountsOut(amountIn, path);
			const expectedOut = amounts[1];

			// Calculate minimum amount with slippage
			const slippageBps = Math.floor(slippage * 100);
			const minAmountOut = expectedOut.mul(10000 - slippageBps).div(10000);

			// Get deadline
			const deadline = Math.floor(Date.now() / 1000) + 600;

			logger.info(`Selling ${tokenAmount} ${token.symbol}...`);
			logger.info(`Expected Out: ${ethers.utils.formatEther(expectedOut)} BNB`);
			logger.info(`Min Amount Out (${slippage}% slippage): ${ethers.utils.formatEther(minAmountOut)} BNB`);

			// Execute swap - USING TAX-COMPATIBLE FUNCTION
			const tx = await routerWithSigner.swapExactTokensForETHSupportingFeeOnTransferTokens(
				amountIn,
				minAmountOut,
				path,
				wallet.address,
				deadline,
				{
					gasPrice: ethers.utils.parseUnits(String(gasPrice), 'gwei'),
					gasLimit: ethers.BigNumber.from(gasLimit),
				}
			);

			logger.info(`Transaction sent: ${tx.hash}`);

			// Wait for confirmation with retries
			let receipt;
			let confirmAttempts = 0;
			const maxConfirmAttempts = 3;

			while (confirmAttempts < maxConfirmAttempts) {
				try {
					receipt = await tx.wait(1); // Wait for 1 confirmation
					break;
				} catch (confirmError: any) {
					confirmAttempts++;
					logger.warning(`Confirmation attempt ${confirmAttempts}/${maxConfirmAttempts} failed: ${confirmError.message}`);

					if (confirmAttempts < maxConfirmAttempts) {
						// Wait 5 seconds before retry
						await new Promise(resolve => setTimeout(resolve, 5000));

						// Try to get receipt directly
						try {
							const provider = new ethers.providers.JsonRpcProvider(config.bsc.rpcHttpUrl);
							receipt = await provider.getTransactionReceipt(tx.hash);
							if (receipt) {
								logger.info('Got receipt directly from provider');
								break;
							}
						} catch (e) {
							logger.debug('Direct receipt fetch failed');
						}
					} else {
						logger.error('Failed to confirm transaction after multiple attempts');
						return {
							success: false,
							error: `Transaction confirmation failed: ${confirmError.message}`,
							txHash: tx.hash,
						};
					}
				}
			}

			if (!receipt) {
				logger.error('No receipt received');
				return {
					success: false,
					error: 'No transaction receipt',
					txHash: tx.hash,
				};
			}

			if (receipt.status === 1) {
				const bnbAmount = ethers.utils.formatEther(expectedOut);
				logger.success(`Sell successful! Got ${bnbAmount} BNB | Block: ${receipt.blockNumber}`);
				return {
					success: true,
					txHash: tx.hash,
					bnbAmount,
				};
			} else {
				logger.error('Transaction failed (status = 0)');
				return {
					success: false,
					error: 'Transaction reverted',
					txHash: tx.hash,
				};
			}
		} catch (error: any) {
			logger.error('Sell failed:', error.message);
			return {
				success: false,
				error: error.message || 'Unknown error',
			};
		}
	}

	/**
	 * Get token price in BNB
	 */
	static async getTokenPrice(tokenAddress: string, amount: string = '1'): Promise<string | null> {
		try {
			this.initialize();

			const path = [tokenAddress, this.WBNB_ADDRESS];
			const amountIn = ethers.utils.parseEther(amount);
			const amounts = await this.routerContract.getAmountsOut(amountIn, path);
			const bnbOut = amounts[1];

			return ethers.utils.formatEther(bnbOut);
		} catch (error: any) {
			logger.error('Failed to get token price:', error.message);
			return null;
		}
	}

	/**
	 * Get BNB price in USD (using USDT pair)
	 */
	static async getBNBPrice(): Promise<number> {
		try {
			this.initialize();

			const USDT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955'; // BSC-USD
			const path = [this.WBNB_ADDRESS, USDT_ADDRESS];
			const amountIn = ethers.utils.parseEther('1');
			const amounts = await this.routerContract.getAmountsOut(amountIn, path);
			const usdtOut = amounts[1];

			return parseFloat(ethers.utils.formatUnits(usdtOut, 18));
		} catch (error: any) {
			logger.error('Failed to get BNB price:', error.message);
			return 0;
		}
	}

	/**
	 * Estimate gas for buy transaction
	 */
	static async estimateBuyGas(params: {
		wallet: B_Wallet;
		token: B_Token;
		bnbAmount: number;
		slippage: number;
	}): Promise<bigint | null> {
		try {
			this.initialize();

			const { wallet, token, bnbAmount, slippage } = params;
			const ethersWallet = wallet.getEthersWallet();
			const routerWithSigner = this.routerContract.connect(ethersWallet);

			const amountIn = ethers.utils.parseEther(bnbAmount.toString());
			const path = [this.WBNB_ADDRESS, token.address];
			const amounts = await this.routerContract.getAmountsOut(amountIn, path);
			const expectedOut = amounts[1];

			const slippageBps = Math.floor(slippage * 100);
			const minAmountOut = expectedOut.mul(10000 - slippageBps).div(10000);
			const deadline = Math.floor(Date.now() / 1000) + 600;

			const gasEstimate = await routerWithSigner.swapExactETHForTokensSupportingFeeOnTransferTokens.estimateGas(
				{ value: amountIn }
			);

			return gasEstimate;
		} catch (error: any) {
			logger.error('Failed to estimate gas:', error.message);
			return null;
		}
	}

	/**
	 * Estimate gas for sell transaction
	 */
	static async estimateSellGas(params: {
		wallet: B_Wallet;
		token: B_Token;
		tokenAmount: string;
		slippage: number;
	}): Promise<bigint | null> {
		try {
			this.initialize();

			const { wallet, token, tokenAmount, slippage } = params;
			const ethersWallet = wallet.getEthersWallet();
			const routerWithSigner = this.routerContract.connect(ethersWallet);

			const amountIn = ethers.utils.parseUnits(tokenAmount, token.decimals);
			const path = [token.address, this.WBNB_ADDRESS];
			const amounts = await this.routerContract.getAmountsOut(amountIn, path);
			const expectedOut = amounts[1];

			const slippageBps = Math.floor(slippage * 100);
			const minAmountOut = expectedOut.mul(10000 - slippageBps).div(10000);
			const deadline = Math.floor(Date.now() / 1000) + 600;

			const gasEstimate = await routerWithSigner.swapExactTokensForETHSupportingFeeOnTransferTokens.estimateGas(
				deadline
			);

			return gasEstimate;
		} catch (error: any) {
			logger.error('Failed to estimate gas:', error.message);
			return null;
		}
	}
}
