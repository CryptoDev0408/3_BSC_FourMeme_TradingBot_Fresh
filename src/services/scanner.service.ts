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
	private wsProvider: ethers.providers.WebSocketProvider | null = null;
	private httpProvider: ethers.providers.JsonRpcProvider | null = null;
	private onTokenDetectedCallback: ((tokenData: TokenDetectionData) => void) | null = null;

	// Four.Meme Contract on BSC
	private readonly FOUR_MEME_FACTORY_ADDRESS = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';
	private readonly ADD_LIQ_METHOD_ID = '0xe3412e3d'; // addLiquidity(address)

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

			// Create WebSocket provider for REAL-TIME block events
			const wsUrl = config.bsc.rpcWssUrl;
			logger.info(`Connecting to WebSocket: ${wsUrl}`);

			this.wsProvider = new ethers.providers.WebSocketProvider(wsUrl);

			// Create HTTP provider as backup for token data fetching
			this.httpProvider = new ethers.providers.JsonRpcProvider(config.bsc.rpcHttpUrl);

			// Setup WebSocket error handlers
			this.wsProvider._websocket.on('error', (error: any) => {
				logger.error('🔴 WebSocket error:', error.message);
			});

			this.wsProvider._websocket.on('close', () => {
				logger.warning('⚠️ WebSocket connection closed');
			});

			// Listen for new blocks in REAL-TIME (like Alert Engine)
			this.wsProvider.on('block', async (blockNumber) => {
				logger.info(`🔍 NEW BLOCK: ${blockNumber} - Scanning...`);
				await this.scanBlock(blockNumber);
			});

			this.isRunning = true;
			logger.success('✅ Scanner started successfully (WebSocket real-time mode)');
			logger.success('⚡ Real-time block detection active!');
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

			if (this.wsProvider) {
				this.wsProvider.removeAllListeners();
				await this.wsProvider.destroy();
				this.wsProvider = null;
			}

			this.httpProvider = null;
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
	 * Scan a specific block for migrations
	 */
	private async scanBlock(blockNumber: number): Promise<void> {
		try {
			if (!this.wsProvider) {
				return;
			}

			const block = await this.wsProvider.getBlockWithTransactions(blockNumber);
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

			// Use HTTP provider for token data (more reliable than WebSocket for contract calls)
			const provider = this.httpProvider || getProvider();
			const checksumAddress = ethers.utils.getAddress(tokenAddress);
			const tokenContract = new ethers.Contract(checksumAddress, this.ERC20_ABI, provider);

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
