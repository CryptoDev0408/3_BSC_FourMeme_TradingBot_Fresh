import { ethers } from 'ethers';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { ScannedToken, IScannedToken } from '../database/models/scanned-token.model';
import { getProvider } from '../core/wallet';

/**
 * Scanner Service
 * Monitors Four.meme migrations to PancakeSwap
 */
class ScannerService {
	private isRunning = false;
	private provider: ethers.providers.JsonRpcProvider | null = null;
	private scanInterval: NodeJS.Timeout | null = null;
	private lastScannedBlock = 0;
	private onTokenDetectedCallback: ((tokenData: TokenDetectionData) => void) | null = null;

	// Four.Meme Contract on BSC
	private readonly FOUR_MEME_FACTORY_ADDRESS = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';
	private readonly ADD_LIQ_METHOD_ID = '0xe3412e3d'; // addLiquidity(address)
	private readonly SCAN_INTERVAL_MS = 3000; // Check every 3 seconds

	// ERC20 ABI for token details
	private readonly ERC20_ABI = [
		'function name() external view returns (string)',
		'function symbol() external view returns (string)',
		'function decimals() external view returns (uint8)',
		'function totalSupply() external view returns (uint256)',
	];

	/**
	 * Start the scanner
	 */
	async start(): Promise<void> {
		if (this.isRunning) {
			logger.warning('Scanner is already running');
			return;
		}

		try {
			logger.info('🔍 Starting Four.meme Scanner...');

			// Create HTTP provider (more reliable than WebSocket)
			this.provider = new ethers.providers.JsonRpcProvider(config.bsc.rpcHttpUrl);

			// Get current block number
			this.lastScannedBlock = await this.provider.getBlockNumber();
			logger.info(`Starting scan from block ${this.lastScannedBlock}`);

			// Start polling for new blocks
			this.scanInterval = setInterval(() => {
				this.pollNewBlocks().catch((error) => {
					logger.error('Error in poll loop:', error.message);
				});
			}, this.SCAN_INTERVAL_MS);

			this.isRunning = true;
			logger.success('✅ Scanner started successfully (HTTP polling mode)');
		} catch (error: any) {
			logger.error('❌ Failed to start scanner:', error.message);
			throw error;
		}
	}

	/**
	 * Stop the scanner
	 */
	async stop(): Promise<void> {
		if (!this.isRunning) {
			return;
		}

		try {
			logger.info('🛑 Stopping scanner...');

			if (this.scanInterval) {
				clearInterval(this.scanInterval);
				this.scanInterval = null;
			}

			this.provider = null;
			this.isRunning = false;
			logger.success('✅ Scanner stopped');
		} catch (error: any) {
			logger.error('❌ Error stopping scanner:', error.message);
		}
	}

	/**
	 * Set callback for token detection
	 */
	onTokenDetected(callback: (tokenData: TokenDetectionData) => void): void {
		this.onTokenDetectedCallback = callback;
	}

	/**
	 * Poll for new blocks
	 */
	private async pollNewBlocks(): Promise<void> {
		try {
			if (!this.provider) return;

			const currentBlock = await this.provider.getBlockNumber();

			// Check if there are new blocks
			if (currentBlock > this.lastScannedBlock) {
				logger.info(`🔍 Scanning blocks ${this.lastScannedBlock + 1} to ${currentBlock}`);

				// Scan each new block
				for (let blockNum = this.lastScannedBlock + 1; blockNum <= currentBlock; blockNum++) {
					await this.scanBlock(blockNum);
				}

				this.lastScannedBlock = currentBlock;
				logger.info(`✅ Scanned up to block ${currentBlock}`);
			}
		} catch (error: any) {
			logger.error('Error polling new blocks:', error.message);
		}
	}

	/**
	 * Scan a specific block for migrations
	 */
	private async scanBlock(blockNumber: number): Promise<void> {
		try {
			if (!this.provider) {
				return;
			}

			const block = await this.provider.getBlockWithTransactions(blockNumber);
			let fourMemeDetections = 0;

			for (const tx of block.transactions) {
				if (!tx.to) continue;

				// Check if transaction is to Four.Meme factory
				if (tx.to.toLowerCase() === this.FOUR_MEME_FACTORY_ADDRESS.toLowerCase()) {
					fourMemeDetections++;
					const methodId = tx.data.substring(0, 10);
					logger.info(`🔵 Four.Meme TX detected in block ${blockNumber}: ${tx.hash} | Method: ${methodId}`);

					// Check if it's addLiquidity method
					if (methodId === this.ADD_LIQ_METHOD_ID) {
						const tokenAddress = '0x' + tx.data.substring(34, 74);
						logger.info(`🚨 MIGRATION DETECTED: ${tokenAddress} in tx ${tx.hash}`);

						// Process the detected token
						await this.processDetectedToken(tokenAddress, tx.hash, blockNumber);
					}
				}
			}

			if (fourMemeDetections > 0) {
				logger.info(`🔍 Block ${blockNumber}: Found ${fourMemeDetections} Four.Meme transactions`);
			}
		} catch (error: any) {
			logger.error(`Error scanning block ${blockNumber}:`, error.message);
		}
	}

	/**
	 * Process detected token
	 */
	private async processDetectedToken(
		tokenAddress: string,
		transactionHash: string,
		blockNumber: number
	): Promise<void> {
		try {
			// Check if token already exists
			const existingToken = await ScannedToken.findOne({
				address: tokenAddress.toLowerCase(),
			});

			if (existingToken) {
				logger.debug(`Token ${tokenAddress} already scanned`);
				return;
			}

			// Get token information using HTTP provider for reliability
			const httpProvider = getProvider();
			const checksumAddress = ethers.utils.getAddress(tokenAddress);
			const tokenContract = new ethers.Contract(checksumAddress, this.ERC20_ABI, httpProvider);

			// Fetch token details
			const [name, symbol, decimals, totalSupply] = await Promise.all([
				tokenContract.name().catch(() => 'Unknown'),
				tokenContract.symbol().catch(() => 'UNKNOWN'),
				tokenContract.decimals().catch(() => 18),
				tokenContract.totalSupply().catch(() => '0'),
			]);

			logger.info(`Token Details - Name: ${name}, Symbol: ${symbol}`);

			// Save to database
			await ScannedToken.create({
				address: checksumAddress.toLowerCase(),
				name,
				symbol,
				decimals,
				totalSupply: totalSupply.toString(),
				transactionHash,
				blockNumber,
				scannedAt: new Date(),
			});

			logger.success(`✅ Saved token ${symbol} to database`);

			// Trigger callback if set
			if (this.onTokenDetectedCallback) {
				const tokenData: TokenDetectionData = {
					address: checksumAddress,
					name,
					symbol,
					decimals,
					totalSupply: totalSupply.toString(),
					transactionHash,
					blockNumber,
					scannedAt: new Date(),
				};

				this.onTokenDetectedCallback(tokenData);
			}
		} catch (error: any) {
			logger.error(`Error processing token ${tokenAddress}:`, error.message);
		}
	}

	/**
	 * Get latest scanned tokens
	 */
	async getLatestTokens(limit: number = 10): Promise<IScannedToken[]> {
		try {
			const tokens = await ScannedToken.find()
				.sort({ scannedAt: -1 })
				.limit(limit)
				.lean();

			return tokens as any;
		} catch (error: any) {
			logger.error('Error fetching latest tokens:', error.message);
			return [];
		}
	}

	/**
	 * Get scanner status
	 */
	isActive(): boolean {
		return this.isRunning;
	}

	/**
	 * Get total scanned tokens count
	 */
	async getTotalScannedCount(): Promise<number> {
		try {
			return await ScannedToken.countDocuments();
		} catch (error: any) {
			logger.error('Error counting scanned tokens:', error.message);
			return 0;
		}
	}
}

/**
 * Token Detection Data Interface
 */
export interface TokenDetectionData {
	address: string;
	name: string;
	symbol: string;
	decimals: number;
	totalSupply: string;
	transactionHash: string;
	blockNumber: number;
	scannedAt: Date;
}

/**
 * Export singleton instance
 */
export const scannerService = new ScannerService();
