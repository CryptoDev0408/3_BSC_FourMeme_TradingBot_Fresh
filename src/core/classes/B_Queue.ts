import { EventEmitter } from 'events';
import { B_Transaction, TransactionType } from './B_Transaction';
import { B_Trading } from './B_Trading';
import { logger } from '../../utils/logger';

/**
 * Queue Statistics
 */
export interface QueueStats {
	pending: number;
	processing: number;
	completed: number;
	failed: number;
	cancelled: number;
	totalProcessed: number;
	averageWaitTime: number;
	averageExecutionTime: number;
}

/**
 * B_Queue - Transaction Queue Manager
 * Manages sequential execution of blockchain transactions to prevent conflicts
 * 
 * CRITICAL FOR PERFORMANCE:
 * - Prevents transaction nonce conflicts
 * - Ensures proper transaction ordering
 * - Handles retries automatically
 * - Provides transaction status tracking
 */
export class B_Queue extends EventEmitter {
	private queue: B_Transaction[] = [];
	private processing: B_Transaction | null = null;
	private isRunning: boolean = false;
	private isPaused: boolean = false;
	private maxConcurrent: number = 1; // Process one at a time to avoid nonce conflicts
	private processInterval: NodeJS.Timeout | null = null;

	// Statistics
	private stats = {
		totalProcessed: 0,
		totalWaitTime: 0,
		totalExecutionTime: 0,
		completed: 0,
		failed: 0,
		cancelled: 0,
	};

	constructor() {
		super();
	}

	/**
	 * Start the queue processing loop
	 */
	start(): void {
		if (this.isRunning) {
			logger.warning('Transaction queue is already running');
			return;
		}

		this.isRunning = true;
		this.isPaused = false;
		logger.info('🚀 Transaction queue started');

		// Process queue continuously
		this.processLoop();
	}

	/**
	 * Stop the queue (waits for current transaction to finish)
	 */
	async stop(): Promise<void> {
		logger.info('Stopping transaction queue...');
		this.isRunning = false;

		if (this.processInterval) {
			clearTimeout(this.processInterval);
			this.processInterval = null;
		}

		// Wait for current transaction to finish
		while (this.processing) {
			await new Promise(resolve => setTimeout(resolve, 100));
		}

		logger.info('✅ Transaction queue stopped');
	}

	/**
	 * Pause queue processing (current transaction will complete)
	 */
	pause(): void {
		this.isPaused = true;
		logger.info('⏸️  Transaction queue paused');
	}

	/**
	 * Resume queue processing
	 */
	resume(): void {
		this.isPaused = false;
		logger.info('▶️  Transaction queue resumed');
		this.processLoop();
	}

	/**
	 * Add transaction to queue
	 */
	push(transaction: B_Transaction): string {
		// Validate transaction
		const validation = transaction.validate();
		if (!validation.valid) {
			logger.error(`Invalid transaction: ${validation.error}`);
			throw new Error(validation.error);
		}

		// Add to queue with priority sorting
		this.queue.push(transaction);
		this.sortQueue();

		logger.info(`📥 Transaction queued: ${transaction.toLogString()} (Queue: ${this.queue.length})`);
		this.emit('queued', transaction);

		// Trigger processing if not running
		if (this.isRunning && !this.processing && !this.isPaused) {
			this.processLoop();
		}

		return transaction.id;
	}

	/**
	 * Add multiple transactions at once
	 */
	pushBatch(transactions: B_Transaction[]): string[] {
		const ids: string[] = [];
		for (const tx of transactions) {
			ids.push(this.push(tx));
		}
		return ids;
	}

	/**
	 * Process queue in a loop
	 */
	private async processLoop(): Promise<void> {
		// Don't start new loop if already processing or paused
		if (this.processing || this.isPaused || !this.isRunning) {
			return;
		}

		// Get next transaction
		const transaction = this.getNext();
		if (!transaction) {
			// Queue is empty, check again in 1 second
			this.processInterval = setTimeout(() => this.processLoop(), 1000);
			return;
		}

		// Process the transaction
		this.processing = transaction;
		await this.executeTransaction(transaction);
		this.processing = null;

		// Process next transaction immediately
		setImmediate(() => this.processLoop());
	}

	/**
	 * Get next transaction from queue (priority-based)
	 */
	private getNext(): B_Transaction | null {
		if (this.queue.length === 0) {
			return null;
		}

		// Already sorted by priority, take first
		const transaction = this.queue.shift()!;
		return transaction;
	}

	/**
	 * Sort queue by priority (descending)
	 */
	private sortQueue(): void {
		this.queue.sort((a, b) => b.getPriority() - a.getPriority());
	}

	/**
	 * Execute a single transaction
	 */
	private async executeTransaction(transaction: B_Transaction): Promise<void> {
		try {
			transaction.markAsProcessing();
			logger.info(`⚡ Executing: ${transaction.toLogString()}`);
			this.emit('processing', transaction);

			let result;

			// Execute based on type
			switch (transaction.type) {
				case TransactionType.BUY:
					result = await B_Trading.buy({
						wallet: transaction.params.wallet,
						token: transaction.params.token!,
						bnbAmount: transaction.params.bnbAmount!,
						slippage: transaction.params.slippage!,
						gasPrice: transaction.params.gasPrice,
						gasLimit: transaction.params.gasLimit,
					});
					break;

				case TransactionType.SELL:
					result = await B_Trading.sell({
						wallet: transaction.params.wallet,
						token: transaction.params.token!,
						tokenAmount: transaction.params.tokenAmount!,
						slippage: transaction.params.slippage!,
						gasPrice: transaction.params.gasPrice,
						gasLimit: transaction.params.gasLimit,
					});
					break;

				case TransactionType.APPROVE:
					// TODO: Implement approve if needed
					throw new Error('APPROVE transaction type not yet implemented');

				default:
					throw new Error(`Unknown transaction type: ${transaction.type}`);
			}

			// Handle result
			if (result.success) {
				transaction.markAsCompleted(result);
				this.stats.completed++;
				this.stats.totalProcessed++;
				this.stats.totalWaitTime += transaction.getWaitTime();
				this.stats.totalExecutionTime += transaction.getExecutionTime() || 0;

				logger.success(`✅ Completed: ${transaction.toLogString()} | TX: ${result.txHash}`);
				this.emit('completed', transaction, result);
			} else {
				transaction.markAsFailed(result.error || 'Unknown error');

				// Retry if possible
				if (transaction.canRetry()) {
					logger.warning(`⚠️  Failed (retry ${transaction.retryCount}/${transaction.maxRetries}): ${transaction.toLogString()}`);
					transaction.resetForRetry();
					this.queue.unshift(transaction); // Add to front for immediate retry
					this.emit('retry', transaction);
				} else {
					this.stats.failed++;
					this.stats.totalProcessed++;
					logger.error(`❌ Failed permanently: ${transaction.toLogString()} | Error: ${result.error}`);
					this.emit('failed', transaction, result.error);
				}
			}
		} catch (error: any) {
			transaction.markAsFailed(error.message);

			// Retry if possible
			if (transaction.canRetry()) {
				logger.warning(`⚠️  Error (retry ${transaction.retryCount}/${transaction.maxRetries}): ${transaction.toLogString()}`);
				transaction.resetForRetry();
				this.queue.unshift(transaction);
				this.emit('retry', transaction);
			} else {
				this.stats.failed++;
				this.stats.totalProcessed++;
				logger.error(`❌ Error permanently: ${transaction.toLogString()} | ${error.message}`);
				this.emit('failed', transaction, error.message);
			}
		}
	}

	/**
	 * Get transaction by ID
	 */
	getTransaction(id: string): B_Transaction | null {
		// Check if processing
		if (this.processing && this.processing.id === id) {
			return this.processing;
		}

		// Check queue
		return this.queue.find(tx => tx.id === id) || null;
	}

	/**
	 * Cancel a pending transaction
	 */
	cancel(id: string, reason: string = 'Cancelled by user'): boolean {
		const index = this.queue.findIndex(tx => tx.id === id);
		if (index === -1) {
			return false;
		}

		const transaction = this.queue[index];
		transaction.markAsCancelled(reason);
		this.queue.splice(index, 1);
		this.stats.cancelled++;

		logger.info(`🚫 Cancelled: ${transaction.toLogString()}`);
		this.emit('cancelled', transaction);
		return true;
	}

	/**
	 * Cancel all pending transactions for a wallet
	 */
	cancelByWallet(walletAddress: string, reason: string = 'Cancelled by wallet'): number {
		let cancelledCount = 0;
		const toCancel = this.queue.filter(
			tx => tx.params.wallet.address.toLowerCase() === walletAddress.toLowerCase()
		);

		for (const tx of toCancel) {
			if (this.cancel(tx.id, reason)) {
				cancelledCount++;
			}
		}

		return cancelledCount;
	}

	/**
	 * Cancel all pending transactions for an order
	 */
	cancelByOrder(orderId: string, reason: string = 'Order cancelled'): number {
		let cancelledCount = 0;
		const toCancel = this.queue.filter(tx => tx.params.orderId === orderId);

		for (const tx of toCancel) {
			if (this.cancel(tx.id, reason)) {
				cancelledCount++;
			}
		}

		return cancelledCount;
	}

	/**
	 * Clear all pending transactions
	 */
	clear(): number {
		const count = this.queue.length;
		for (const tx of this.queue) {
			tx.markAsCancelled('Queue cleared');
			this.stats.cancelled++;
			this.emit('cancelled', tx);
		}
		this.queue = [];
		logger.info(`🗑️  Cleared ${count} pending transactions`);
		return count;
	}

	/**
	 * Get queue statistics
	 */
	getStats(): QueueStats {
		const avgWaitTime = this.stats.totalProcessed > 0
			? this.stats.totalWaitTime / this.stats.totalProcessed
			: 0;
		const avgExecutionTime = this.stats.totalProcessed > 0
			? this.stats.totalExecutionTime / this.stats.totalProcessed
			: 0;

		return {
			pending: this.queue.length,
			processing: this.processing ? 1 : 0,
			completed: this.stats.completed,
			failed: this.stats.failed,
			cancelled: this.stats.cancelled,
			totalProcessed: this.stats.totalProcessed,
			averageWaitTime: avgWaitTime,
			averageExecutionTime: avgExecutionTime,
		};
	}

	/**
	 * Get current queue size
	 */
	size(): number {
		return this.queue.length;
	}

	/**
	 * Check if queue is empty
	 */
	isEmpty(): boolean {
		return this.queue.length === 0 && !this.processing;
	}

	/**
	 * Check if queue is running
	 */
	isActive(): boolean {
		return this.isRunning;
	}

	/**
	 * Get all pending transactions
	 */
	getPendingTransactions(): B_Transaction[] {
		return [...this.queue];
	}

	/**
	 * Get currently processing transaction
	 */
	getCurrentTransaction(): B_Transaction | null {
		return this.processing;
	}

	/**
	 * Log queue status
	 */
	logStatus(): void {
		const stats = this.getStats();
		logger.info('📊 Transaction Queue Status:');
		logger.info(`   Pending: ${stats.pending}`);
		logger.info(`   Processing: ${stats.processing}`);
		logger.info(`   Completed: ${stats.completed}`);
		logger.info(`   Failed: ${stats.failed}`);
		logger.info(`   Cancelled: ${stats.cancelled}`);
		logger.info(`   Avg Wait: ${stats.averageWaitTime.toFixed(0)}ms`);
		logger.info(`   Avg Execution: ${stats.averageExecutionTime.toFixed(0)}ms`);
	}
}

// Export singleton instance
export const transactionQueue = new B_Queue();
