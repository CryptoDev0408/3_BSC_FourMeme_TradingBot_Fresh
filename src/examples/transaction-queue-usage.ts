/**
 * Example: Using Transaction Queue for Manual Buy/Sell Operations
 * 
 * This file demonstrates how to queue buy and sell transactions
 * instead of executing them directly.
 */

import { B_Transaction, TransactionType, transactionQueue } from '../core/classes';
import { B_Wallet } from '../core/classes/B_Wallet';
import { B_Token } from '../core/classes/B_Token';

/**
 * Example 1: Queue a Buy Transaction
 */
export async function queueBuyExample(
	wallet: B_Wallet,
	token: B_Token,
	bnbAmount: number,
	slippage: number
): Promise<string> {
	// Create transaction object
	const buyTransaction = new B_Transaction({
		type: TransactionType.BUY,
		wallet,
		token,
		bnbAmount,
		slippage,
		gasPrice: '5', // 5 gwei
		gasLimit: 300000,
		priority: 10, // Normal priority
	});

	// Queue the transaction
	const txId = transactionQueue.push(buyTransaction);
	console.log(`✅ Buy transaction queued: ${txId}`);

	return txId;
}

/**
 * Example 2: Queue a Sell Transaction with High Priority
 */
export async function queueSellExample(
	wallet: B_Wallet,
	token: B_Token,
	tokenAmount: string,
	slippage: number,
	isStopLoss: boolean = false
): Promise<string> {
	// Create transaction object
	const sellTransaction = new B_Transaction({
		type: TransactionType.SELL,
		wallet,
		token,
		tokenAmount,
		slippage,
		gasPrice: isStopLoss ? '10' : '5', // Higher gas for stop loss
		gasLimit: 300000,
		priority: isStopLoss ? 100 : 50, // Stop loss has highest priority
	});

	// Queue the transaction
	const txId = transactionQueue.push(sellTransaction);
	console.log(`✅ Sell transaction queued: ${txId}`);

	return txId;
}

/**
 * Example 3: Queue Multiple Transactions from an Order
 */
export async function queueOrderTransactions(
	orderId: string,
	userId: string,
	wallet: B_Wallet,
	token: B_Token,
	bnbAmount: number,
	slippage: number,
	gasPrice: string
): Promise<string> {
	// Create buy transaction with order context
	const buyTransaction = new B_Transaction(
		{
			type: TransactionType.BUY,
			wallet,
			token,
			bnbAmount,
			slippage,
			gasPrice,
			gasLimit: 300000,
			orderId, // Associate with order
			userId, // Associate with user
			priority: 10,
		},
		3 // Max 3 retries
	);

	// Queue the transaction
	const txId = transactionQueue.push(buyTransaction);
	console.log(`✅ Order ${orderId} buy transaction queued: ${txId}`);

	return txId;
}

/**
 * Example 4: Wait for Transaction Completion
 */
export async function waitForTransactionCompletion(
	transaction: B_Transaction,
	timeoutMs: number = 60000
): Promise<any> {
	const startTime = Date.now();

	return new Promise((resolve) => {
		const checkInterval = setInterval(() => {
			// Check if completed
			if (transaction.status === 'COMPLETED') {
				clearInterval(checkInterval);
				resolve({
					success: true,
					result: transaction.result,
				});
				return;
			}

			// Check if failed
			if (transaction.status === 'FAILED' || transaction.status === 'CANCELLED') {
				clearInterval(checkInterval);
				resolve({
					success: false,
					error: transaction.error || 'Transaction failed or cancelled',
				});
				return;
			}

			// Check timeout
			if (Date.now() - startTime > timeoutMs) {
				clearInterval(checkInterval);
				resolve({
					success: false,
					error: 'Transaction timeout',
				});
			}
		}, 100); // Check every 100ms
	});
}

/**
 * Example 5: Queue Buy and Wait for Result
 */
export async function buyAndWait(
	wallet: B_Wallet,
	token: B_Token,
	bnbAmount: number,
	slippage: number
): Promise<{ success: boolean; txHash?: string; error?: string }> {
	// Create transaction
	const buyTransaction = new B_Transaction({
		type: TransactionType.BUY,
		wallet,
		token,
		bnbAmount,
		slippage,
		gasPrice: '5',
		gasLimit: 300000,
		priority: 10,
	});

	// Queue it
	transactionQueue.push(buyTransaction);
	console.log(`⏳ Waiting for buy transaction...`);

	// Wait for completion
	const result = await waitForTransactionCompletion(buyTransaction);

	if (result.success) {
		console.log(`✅ Buy successful! TX: ${result.result.txHash}`);
		return {
			success: true,
			txHash: result.result.txHash,
		};
	} else {
		console.log(`❌ Buy failed: ${result.error}`);
		return {
			success: false,
			error: result.error,
		};
	}
}

/**
 * Example 6: Cancel Pending Transactions for a Wallet
 */
export function cancelWalletTransactions(walletAddress: string): number {
	const cancelledCount = transactionQueue.cancelByWallet(
		walletAddress,
		'Manual cancellation'
	);

	console.log(`🚫 Cancelled ${cancelledCount} transactions for wallet ${walletAddress}`);
	return cancelledCount;
}

/**
 * Example 7: Monitor Queue Status
 */
export function logQueueStatus(): void {
	const stats = transactionQueue.getStats();

	console.log('📊 Transaction Queue Status:');
	console.log(`   Pending: ${stats.pending}`);
	console.log(`   Processing: ${stats.processing}`);
	console.log(`   Completed: ${stats.completed}`);
	console.log(`   Failed: ${stats.failed}`);
	console.log(`   Cancelled: ${stats.cancelled}`);
	console.log(`   Avg Wait: ${stats.averageWaitTime.toFixed(0)}ms`);
	console.log(`   Avg Execution: ${stats.averageExecutionTime.toFixed(0)}ms`);
}

/**
 * Example 8: Setup Queue Event Listeners
 */
export function setupQueueListeners(): void {
	// Listen to queue events
	transactionQueue.on('queued', (tx) => {
		console.log(`📥 Queued: ${tx.toLogString()}`);
	});

	transactionQueue.on('processing', (tx) => {
		console.log(`⚡ Processing: ${tx.toLogString()}`);
	});

	transactionQueue.on('completed', (tx, result) => {
		console.log(`✅ Completed: ${tx.toLogString()} | TX: ${result.txHash}`);
	});

	transactionQueue.on('failed', (tx, error) => {
		console.error(`❌ Failed: ${tx.toLogString()} | Error: ${error}`);
	});

	transactionQueue.on('retry', (tx) => {
		console.log(`🔄 Retrying: ${tx.toLogString()} (${tx.retryCount}/${tx.maxRetries})`);
	});

	transactionQueue.on('cancelled', (tx) => {
		console.log(`🚫 Cancelled: ${tx.toLogString()}`);
	});
}

/**
 * Example 9: Batch Queue Multiple Transactions
 */
export async function queueBatchBuys(
	wallet: B_Wallet,
	tokens: B_Token[],
	bnbAmountPerToken: number,
	slippage: number
): Promise<string[]> {
	const transactions: B_Transaction[] = [];

	// Create all transactions
	for (const token of tokens) {
		const tx = new B_Transaction({
			type: TransactionType.BUY,
			wallet,
			token,
			bnbAmount: bnbAmountPerToken,
			slippage,
			gasPrice: '5',
			gasLimit: 300000,
			priority: 10,
		});
		transactions.push(tx);
	}

	// Queue all at once
	const txIds = transactionQueue.pushBatch(transactions);
	console.log(`✅ Queued ${txIds.length} buy transactions`);

	return txIds;
}

/**
 * Example 10: Emergency Stop Loss (Highest Priority)
 */
export async function emergencyStopLoss(
	positionId: string,
	wallet: B_Wallet,
	token: B_Token,
	tokenAmount: string
): Promise<string> {
	// Create stop loss transaction with highest priority
	const stopLossTx = new B_Transaction({
		type: TransactionType.SELL,
		wallet,
		token,
		tokenAmount,
		slippage: 15, // Higher slippage for emergency
		gasPrice: '15', // High gas for fast execution
		gasLimit: 350000,
		positionId,
		priority: 100, // Highest priority
	});

	// Queue immediately
	const txId = transactionQueue.push(stopLossTx);
	console.log(`🚨 Emergency stop loss queued: ${txId} (HIGHEST PRIORITY)`);

	return txId;
}
