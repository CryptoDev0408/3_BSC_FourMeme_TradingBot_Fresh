import { B_Wallet } from './B_Wallet';
import { B_Token } from './B_Token';

/**
 * Transaction Type - defines the operation type
 */
export enum TransactionType {
	BUY = 'BUY',
	SELL = 'SELL',
	APPROVE = 'APPROVE',
}

/**
 * Transaction Status - tracks execution state
 */
export enum TransactionStatus {
	PENDING = 'PENDING',
	PROCESSING = 'PROCESSING',
	COMPLETED = 'COMPLETED',
	FAILED = 'FAILED',
	CANCELLED = 'CANCELLED',
}

/**
 * Transaction Parameters - defines all data needed for execution
 */
export interface TransactionParams {
	// Common params
	type: TransactionType;
	wallet: B_Wallet;
	gasPrice: string;
	gasLimit?: number;

	// Buy params
	token?: B_Token;
	bnbAmount?: number;
	slippage?: number;

	// Sell params
	tokenAmount?: string;

	// Approve params
	spenderAddress?: string;
	approveAmount?: string;

	// Metadata
	orderId?: string;
	positionId?: string;
	userId?: string;
	priority?: number; // Higher = more urgent
}

/**
 * Transaction Result - returned after execution
 */
export interface TransactionResult {
	success: boolean;
	txHash?: string;
	error?: string;
	tokenAmount?: string;
	bnbAmount?: string;
	gasUsed?: string;
	effectiveGasPrice?: string;
}

/**
 * B_Transaction - Represents a single blockchain transaction
 * Each buy/sell operation is one instance of this class
 */
export class B_Transaction {
	public id: string;
	public type: TransactionType;
	public status: TransactionStatus;
	public params: TransactionParams;
	public result?: TransactionResult;
	public createdAt: Date;
	public startedAt?: Date;
	public completedAt?: Date;
	public retryCount: number;
	public maxRetries: number;
	public error?: string;

	constructor(params: TransactionParams, maxRetries: number = 3) {
		this.id = `tx_${Date.now()}_${Math.random().toString(36).substring(7)}`;
		this.type = params.type;
		this.status = TransactionStatus.PENDING;
		this.params = params;
		this.createdAt = new Date();
		this.retryCount = 0;
		this.maxRetries = maxRetries;
	}

	/**
	 * Get transaction priority (higher = more urgent)
	 */
	getPriority(): number {
		return this.params.priority || 0;
	}

	/**
	 * Check if transaction can be retried
	 */
	canRetry(): boolean {
		return this.retryCount < this.maxRetries && this.status === TransactionStatus.FAILED;
	}

	/**
	 * Mark as processing
	 */
	markAsProcessing(): void {
		this.status = TransactionStatus.PROCESSING;
		this.startedAt = new Date();
	}

	/**
	 * Mark as completed
	 */
	markAsCompleted(result: TransactionResult): void {
		this.status = TransactionStatus.COMPLETED;
		this.result = result;
		this.completedAt = new Date();
	}

	/**
	 * Mark as failed
	 */
	markAsFailed(error: string): void {
		this.status = TransactionStatus.FAILED;
		this.error = error;
		this.retryCount++;
		this.completedAt = new Date();
	}

	/**
	 * Mark as cancelled
	 */
	markAsCancelled(reason: string): void {
		this.status = TransactionStatus.CANCELLED;
		this.error = reason;
		this.completedAt = new Date();
	}

	/**
	 * Reset for retry
	 */
	resetForRetry(): void {
		this.status = TransactionStatus.PENDING;
		this.startedAt = undefined;
		this.completedAt = undefined;
	}

	/**
	 * Get execution time in milliseconds
	 */
	getExecutionTime(): number | null {
		if (this.startedAt && this.completedAt) {
			return this.completedAt.getTime() - this.startedAt.getTime();
		}
		return null;
	}

	/**
	 * Get wait time in milliseconds (time in queue)
	 */
	getWaitTime(): number {
		const endTime = this.startedAt || new Date();
		return endTime.getTime() - this.createdAt.getTime();
	}

	/**
	 * Convert to log-friendly format
	 */
	toLogString(): string {
		const wallet = this.params.wallet.address.substring(0, 10);
		const token = this.params.token?.symbol || 'N/A';
		const amount = this.type === TransactionType.BUY
			? `${this.params.bnbAmount} BNB`
			: `${this.params.tokenAmount} tokens`;

		return `[${this.type}] ${wallet}... -> ${token} (${amount}) [${this.status}]`;
	}

	/**
	 * Validate transaction parameters
	 */
	validate(): { valid: boolean; error?: string } {
		// Validate common params
		if (!this.params.wallet) {
			return { valid: false, error: 'Wallet is required' };
		}
		if (!this.params.gasPrice) {
			return { valid: false, error: 'Gas price is required' };
		}

		// Validate type-specific params
		switch (this.type) {
			case TransactionType.BUY:
				if (!this.params.token) {
					return { valid: false, error: 'Token is required for BUY' };
				}
				if (!this.params.bnbAmount || this.params.bnbAmount <= 0) {
					return { valid: false, error: 'Valid BNB amount is required for BUY' };
				}
				if (!this.params.slippage || this.params.slippage < 0) {
					return { valid: false, error: 'Valid slippage is required for BUY' };
				}
				break;

			case TransactionType.SELL:
				if (!this.params.token) {
					return { valid: false, error: 'Token is required for SELL' };
				}
				if (!this.params.tokenAmount) {
					return { valid: false, error: 'Token amount is required for SELL' };
				}
				if (!this.params.slippage || this.params.slippage < 0) {
					return { valid: false, error: 'Valid slippage is required for SELL' };
				}
				break;

			case TransactionType.APPROVE:
				if (!this.params.token) {
					return { valid: false, error: 'Token is required for APPROVE' };
				}
				if (!this.params.spenderAddress) {
					return { valid: false, error: 'Spender address is required for APPROVE' };
				}
				break;
		}

		return { valid: true };
	}
}
