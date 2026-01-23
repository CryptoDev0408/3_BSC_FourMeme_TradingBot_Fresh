# Transaction Queue System Documentation

## Overview

The Transaction Queue System is a critical component designed to prevent transaction conflicts, manage execution order, and ensure reliable buy/sell operations in the FourMeme Trading Bot.

## Why This System is Essential

### Problems Solved

1. **Nonce Conflicts**: Without a queue, simultaneous transactions from the same wallet can use the same nonce, causing failures
2. **Race Conditions**: Multiple buy/sell operations executing at once can interfere with each other
3. **Gas Price Competition**: Sequential execution prevents internal competition for block space
4. **Error Recovery**: Automatic retry mechanism with configurable attempts
5. **Transaction Tracking**: Full lifecycle tracking from creation to completion

### Performance Impact

- ✅ **Prevents Failed Transactions**: Saves gas fees from failed transactions
- ✅ **Reliable Execution**: Ensures every transaction is processed in order
- ✅ **Automatic Retries**: Recovers from temporary failures (RPC issues, gas spikes)
- ✅ **Priority System**: Critical transactions (stop loss) execute first
- ✅ **Statistics Tracking**: Monitor queue performance in real-time

## Architecture

### B_Transaction Class

Represents a single blockchain transaction with complete state management.

```typescript
import { B_Transaction, TransactionType } from "./core/classes";

// Create a BUY transaction
const buyTx = new B_Transaction({
  type: TransactionType.BUY,
  wallet: myWallet,
  token: myToken,
  bnbAmount: 0.1,
  slippage: 5,
  gasPrice: "5",
  gasLimit: 300000,
  orderId: "order123",
  userId: "user456",
  priority: 10, // Higher = more urgent
});
```

#### Transaction States

- `PENDING`: Waiting in queue
- `PROCESSING`: Currently executing
- `COMPLETED`: Successfully executed
- `FAILED`: Failed after all retries
- `CANCELLED`: Manually cancelled

#### Transaction Types

- `BUY`: Buy tokens with BNB
- `SELL`: Sell tokens for BNB
- `APPROVE`: Approve token spending (future)

### B_Queue Class

Manages the transaction queue with FIFO + priority ordering.

```typescript
import { transactionQueue } from "./core/classes";

// Queue is automatically started on bot initialization
// No manual start needed

// Push a transaction
const txId = transactionQueue.push(buyTx);

// Get queue statistics
const stats = transactionQueue.getStats();
console.log(`Pending: ${stats.pending}`);
console.log(`Processing: ${stats.processing}`);
console.log(`Completed: ${stats.completed}`);
console.log(`Failed: ${stats.failed}`);

// Cancel a transaction
transactionQueue.cancel(txId, "User cancelled");

// Cancel all transactions for a wallet
transactionQueue.cancelByWallet("0x123...", "Wallet deactivated");
```

## Usage Examples

### Example 1: Queue a Buy Transaction

```typescript
import {
  B_Transaction,
  TransactionType,
  transactionQueue,
} from "./core/classes";

async function buyToken(wallet, token, bnbAmount) {
  // Create transaction
  const tx = new B_Transaction({
    type: TransactionType.BUY,
    wallet,
    token,
    bnbAmount,
    slippage: 5,
    gasPrice: "5",
    gasLimit: 300000,
    priority: 50, // Normal priority
  });

  // Queue it
  const txId = transactionQueue.push(tx);
  console.log(`Transaction queued: ${txId}`);

  // Wait for completion (optional)
  const result = await waitForTransaction(tx);
  if (result.success) {
    console.log(`Buy successful! TX: ${result.txHash}`);
  } else {
    console.log(`Buy failed: ${result.error}`);
  }
}
```

### Example 2: Queue a Sell Transaction with High Priority

```typescript
async function emergencySell(wallet, token, amount) {
  const tx = new B_Transaction({
    type: TransactionType.SELL,
    wallet,
    token,
    tokenAmount: amount,
    slippage: 10, // Higher slippage for emergency
    gasPrice: "10", // Higher gas for faster execution
    priority: 100, // Highest priority (stop loss)
  });

  return transactionQueue.push(tx);
}
```

### Example 3: Monitor Queue Status

```typescript
// Log status every 10 seconds
setInterval(() => {
  transactionQueue.logStatus();
}, 10000);

// Or get programmatic access
const stats = transactionQueue.getStats();
if (stats.pending > 20) {
  console.warn("Queue is backing up!");
}
```

### Example 4: Listen to Queue Events

```typescript
import { transactionQueue } from "./core/classes";

// Transaction queued
transactionQueue.on("queued", (tx) => {
  console.log(`Queued: ${tx.toLogString()}`);
});

// Transaction processing
transactionQueue.on("processing", (tx) => {
  console.log(`Processing: ${tx.toLogString()}`);
});

// Transaction completed
transactionQueue.on("completed", (tx, result) => {
  console.log(`Completed: ${tx.toLogString()} | TX: ${result.txHash}`);
});

// Transaction failed
transactionQueue.on("failed", (tx, error) => {
  console.error(`Failed: ${tx.toLogString()} | Error: ${error}`);
});

// Transaction retry
transactionQueue.on("retry", (tx) => {
  console.log(
    `Retrying: ${tx.toLogString()} (${tx.retryCount}/${tx.maxRetries})`,
  );
});
```

## Integration with Existing Code

### Before (Direct Execution)

```typescript
// OLD WAY - Direct execution (prone to conflicts)
const result = await B_Trading.buy({
  wallet,
  token,
  bnbAmount,
  slippage,
  gasPrice,
});
```

### After (Queue-Based Execution)

```typescript
// NEW WAY - Queue-based execution (safe and reliable)
const tx = new B_Transaction({
  type: TransactionType.BUY,
  wallet,
  token,
  bnbAmount,
  slippage,
  gasPrice,
});

const txId = transactionQueue.push(tx);
const result = await waitForTransaction(tx);
```

## Queue Management

### Start/Stop Queue

```typescript
// Start queue (done automatically in index.ts)
transactionQueue.start();

// Stop queue (waits for current transaction)
await transactionQueue.stop();

// Pause queue (keeps current transaction)
transactionQueue.pause();

// Resume queue
transactionQueue.resume();
```

### Cancel Transactions

```typescript
// Cancel by transaction ID
transactionQueue.cancel("tx_123abc", "User cancelled");

// Cancel by wallet address
const count = transactionQueue.cancelByWallet("0x123...", "Wallet locked");

// Cancel by order ID
const count = transactionQueue.cancelByOrder("order_456", "Order cancelled");

// Clear entire queue
const count = transactionQueue.clear();
```

## Priority System

Transactions are processed by priority (higher = more urgent):

- **100**: Emergency stop loss
- **50**: Normal take profit
- **10**: Regular buys
- **0**: Low priority operations

```typescript
// High priority (stop loss)
const stopLossTx = new B_Transaction({
  ...params,
  priority: 100,
});

// Normal priority (regular buy)
const buyTx = new B_Transaction({
  ...params,
  priority: 10,
});
```

## Retry Mechanism

Transactions automatically retry on failure (default: 3 attempts):

```typescript
// Custom retry count
const tx = new B_Transaction(params, 5); // 5 retries

// Check if can retry
if (tx.canRetry()) {
  console.log(`Retries left: ${tx.maxRetries - tx.retryCount}`);
}
```

## Statistics and Monitoring

### Get Queue Statistics

```typescript
const stats = transactionQueue.getStats();

console.log("Queue Statistics:");
console.log(`- Pending: ${stats.pending}`);
console.log(`- Processing: ${stats.processing}`);
console.log(`- Completed: ${stats.completed}`);
console.log(`- Failed: ${stats.failed}`);
console.log(`- Cancelled: ${stats.cancelled}`);
console.log(`- Avg Wait Time: ${stats.averageWaitTime.toFixed(0)}ms`);
console.log(`- Avg Execution Time: ${stats.averageExecutionTime.toFixed(0)}ms`);
```

### Get Individual Transaction

```typescript
const tx = transactionQueue.getTransaction("tx_123abc");
if (tx) {
  console.log(`Status: ${tx.status}`);
  console.log(`Wait Time: ${tx.getWaitTime()}ms`);
  console.log(`Execution Time: ${tx.getExecutionTime()}ms`);
}
```

## Best Practices

### 1. Always Use Queue for Wallet Operations

```typescript
// ✅ GOOD - Use queue
const tx = new B_Transaction({ ... });
transactionQueue.push(tx);

// ❌ BAD - Direct execution
await B_Trading.buy({ ... });
```

### 2. Set Appropriate Priorities

```typescript
// Stop loss = highest priority
priority: 100;

// Take profit = medium priority
priority: 50;

// Regular buy = low priority
priority: 10;
```

### 3. Handle Transaction Results

```typescript
const tx = new B_Transaction({ ... });
const txId = transactionQueue.push(tx);

// Wait for result
const result = await waitForTransaction(tx);
if (!result.success) {
  // Handle failure
  logger.error(`Transaction failed: ${result.error}`);
  // Notify user, retry, etc.
}
```

### 4. Monitor Queue Health

```typescript
// Regular monitoring
setInterval(() => {
  const stats = transactionQueue.getStats();

  // Alert if queue is backing up
  if (stats.pending > 50) {
    logger.warn("Transaction queue is backed up!");
  }

  // Alert on high failure rate
  const failureRate = stats.failed / stats.totalProcessed;
  if (failureRate > 0.1) {
    // More than 10% failures
    logger.error("High transaction failure rate!");
  }
}, 30000); // Every 30 seconds
```

### 5. Cancel Stale Transactions

```typescript
// Cancel old pending transactions
const pending = transactionQueue.getPendingTransactions();
const now = Date.now();

for (const tx of pending) {
  const age = now - tx.createdAt.getTime();
  if (age > 300000) {
    // 5 minutes
    transactionQueue.cancel(tx.id, "Transaction too old");
  }
}
```

## Error Handling

### Common Errors

1. **Invalid Parameters**: Transaction validation fails
   - Solution: Ensure all required parameters are provided

2. **Wallet Access Failed**: Can't decrypt wallet or get private key
   - Solution: Check wallet encryption and database

3. **Insufficient Balance**: Not enough BNB for transaction
   - Solution: Check wallet balance before queueing

4. **Gas Too High**: Gas price too high for network
   - Solution: Reduce gas price or wait

5. **Slippage Exceeded**: Price moved too much
   - Solution: Increase slippage tolerance

### Handling Failed Transactions

```typescript
transactionQueue.on("failed", (tx, error) => {
  logger.error(`Transaction failed: ${tx.toLogString()}`);
  logger.error(`Error: ${error}`);

  // Notify user
  notifyUser(tx.params.userId, `Transaction failed: ${error}`);

  // Log to database for analysis
  logFailedTransaction(tx, error);

  // Take corrective action based on error
  if (error.includes("insufficient funds")) {
    // Disable wallet or notify to add funds
  } else if (error.includes("slippage")) {
    // Suggest higher slippage
  }
});
```

## Performance Considerations

### Queue Throughput

- **Sequential Processing**: One transaction at a time to avoid nonce conflicts
- **Average Time**: ~5-15 seconds per transaction (including confirmation)
- **Max Throughput**: ~240 transactions/hour (4 per minute)

### Scaling Recommendations

If you need higher throughput:

1. **Use Multiple Wallets**: Each wallet can have its own queue
2. **Batch Operations**: Combine multiple small operations into larger ones
3. **Off-Chain Coordination**: Use centralized coordination for wallet selection

## Lifecycle Flow

```
1. Transaction Created
   ↓
2. Validation (parameters check)
   ↓
3. Queued (PENDING status)
   ↓
4. Sorted by Priority
   ↓
5. Processing (PROCESSING status)
   ↓
6. Execution (B_Trading.buy/sell)
   ↓
7. Confirmation Wait
   ↓
8. Result Analysis
   ↓
9a. Success → COMPLETED
9b. Failure → Retry or FAILED
9c. Cancelled → CANCELLED
```

## Testing

### Unit Tests

```typescript
describe('B_Transaction', () => {
  it('should validate BUY parameters', () => {
    const tx = new B_Transaction({ ... });
    const result = tx.validate();
    expect(result.valid).toBe(true);
  });
});

describe('B_Queue', () => {
  it('should process transactions in priority order', async () => {
    const lowPriority = new B_Transaction({ ...params, priority: 10 });
    const highPriority = new B_Transaction({ ...params, priority: 100 });

    queue.push(lowPriority);
    queue.push(highPriority);

    const next = queue.getNext();
    expect(next.id).toBe(highPriority.id);
  });
});
```

## Troubleshooting

### Queue Not Processing

1. Check if queue is running: `transactionQueue.isActive()`
2. Check if paused: Look for pause state
3. Check for stuck transaction: `transactionQueue.getCurrentTransaction()`

### High Failure Rate

1. Check RPC connection
2. Verify gas prices are reasonable
3. Check wallet balances
4. Review slippage settings

### Transactions Taking Too Long

1. Check BSC network congestion
2. Increase gas price
3. Reduce batch size in parallel operations

## Future Enhancements

- [ ] Multi-wallet queues (separate queue per wallet)
- [ ] Transaction batching (combine multiple operations)
- [ ] Dynamic gas price optimization
- [ ] Advanced retry strategies (exponential backoff)
- [ ] Transaction prioritization based on profit potential
- [ ] Dead letter queue for permanently failed transactions
