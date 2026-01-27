# Auto-Buy Feature Documentation

## Overview

When the scanner detects a new Four.meme token migrating to PancakeSwap, it automatically executes buy orders for all active orders with **AutoBuy enabled**.

## How It Works

### 1. Token Detection

- Scanner monitors BSC blockchain in real-time via WebSocket
- Detects Four.meme migrations (method ID: `0xe3412e3d`)
- Extracts token address and fetches token metadata

### 2. Auto-Buy Execution

When a new token is detected, the scanner:

1. **Queries active orders** with `isActive: true` and `autoBuy: true`
2. **Sorts orders** by:
   - `gasFee.gasPrice` (descending) - Highest gas executes first (fastest confirmation)
   - `tradingAmount` (descending) - Larger orders execute before smaller ones
3. **Executes buys sequentially** with 250ms delay between each order

### 3. Execution Flow

```
New Token Detected
       ↓
Save to Database
       ↓
Find Active AutoBuy Orders
       ↓
Sort by Gas & Amount
       ↓
Execute Order #1 (Highest Gas, Largest Amount) → IMMEDIATE
       ↓
Wait 250ms
       ↓
Execute Order #2 → 250ms delay
       ↓
Wait 250ms
       ↓
Execute Order #3 → 500ms delay
       ↓
...and so on
```

### 4. Order Priority Example

Given these orders:

- **Order A**: Gas = 10 Gwei, Amount = 0.5 BNB
- **Order B**: Gas = 15 Gwei, Amount = 0.3 BNB
- **Order C**: Gas = 10 Gwei, Amount = 1.0 BNB

**Execution Order:**

1. Order B (15 Gwei) - Executes immediately
2. Order C (10 Gwei, 1.0 BNB) - Executes after 250ms
3. Order A (10 Gwei, 0.5 BNB) - Executes after 500ms

## Configuration

### Enable AutoBuy on Order

Users can enable AutoBuy in their order settings:

- Navigate to Orders menu
- Select an order
- Toggle **AutoBuy ON**
- Set gas price and trading amount

### Order Settings Used

Each auto-buy uses the order's configured:

- `tradingAmount` - BNB amount to spend
- `gasFee.gasPrice` - Gas price for transaction
- `gasFee.gasLimit` - Gas limit (default: 300000)
- `slippage` - Slippage tolerance (default: 10%)
- `takeProfitPercent` - Automatic take profit target
- `stopLossPercent` - Automatic stop loss level

## Logging

The scanner logs detailed information during auto-buy execution:

```
🤖 Checking for auto-buy orders...
✅ Found 3 auto-buy order(s)
🚀 [1/3] Executing auto-buy for Order: My Order | Wallet: 0x1234567... | Amount: 0.5 BNB | Gas: 10 Gwei
✅ [1/3] Auto-buy successful! TX: 0xabc123...
⏳ Waiting 250ms before next order...
🚀 [2/3] Executing auto-buy for Order: Quick Order | Wallet: 0x9876543... | Amount: 0.3 BNB | Gas: 15 Gwei
✅ [2/3] Auto-buy successful! TX: 0xdef456...
⏳ Waiting 250ms before next order...
🚀 [3/3] Executing auto-buy for Order: Large Order | Wallet: 0xabcdef... | Amount: 1.0 BNB | Gas: 12 Gwei
✅ [3/3] Auto-buy successful! TX: 0x789xyz...
✅ Completed 3 auto-buy order(s) for TOKEN
```

## Position Management

After successful auto-buy:

- Position is created in database
- TP/SL monitoring starts automatically
- User receives Telegram notification
- Position appears in Positions menu

## Error Handling

If an order fails:

- Error is logged but doesn't stop other orders
- Failed transaction is recorded in database
- User can check transaction history
- Other orders continue with 250ms delay

## Technical Details

### File Modified

- `src/services/scanner.service.ts`
  - Added `executeAutoBuys()` method
  - Integrated with token detection flow
  - Implements sequential execution with delays

### Dependencies

- `Order.find()` - Query active auto-buy orders
- `executeBuyOrder()` - Execute buy transaction via queue
- Transaction queue system - Ensures proper order execution
- TP/SL Monitor - Automatic monitoring after buy

### Performance

- **250ms delay** prevents network congestion
- Orders execute in priority order (gas + amount)
- First order gets fastest execution (no delay)
- WebSocket ensures minimal detection latency

## Best Practices

1. **Set appropriate gas prices**
   - Higher gas = faster execution
   - Consider current network conditions
   - Default: 5 Gwei

2. **Configure reasonable amounts**
   - Ensure wallet has sufficient BNB balance
   - Account for gas fees (≈0.002 BNB per tx)
   - Larger amounts execute after smaller ones with same gas

3. **Enable TP/SL**
   - Protect profits with take profit
   - Limit losses with stop loss
   - Both trigger automatically

4. **Monitor wallet balances**
   - Auto-buy fails if insufficient BNB
   - Check balances regularly
   - Top up wallets before expected launches

## Safety Features

- Orders only execute if wallet has sufficient balance
- Invalid wallets are skipped
- Failed orders don't block subsequent orders
- All transactions logged for audit trail
- Position tracking for each successful buy
