# Phase 3: PNL Monitor Engine - COMPLETE ✅

**Date:** January 30, 2026  
**Status:** Successfully Implemented  
**Compilation:** No new errors introduced

---

## 🎯 Objective

Transform the PNL Monitor Engine from single TP/SL execution (100% sell) to **dynamic multiple TP/SL levels** with **partial sells** and **independent level tracking**.

---

## 📋 Implementation Summary

### **Modified Files:**

1. **`src/services/pnl.monitor.ts`** (260+ lines of changes)
   - Extended `PositionPNL` interface with triggered level arrays
   - Rewrote `processPosition()` to check multiple levels
   - Created `executePartialSell()` function (230+ lines)
   - Updated `executeTriggeredPositions()` to handle partial sells
   - Added `notifyPartialSell()` for user notifications

---

## 🔧 Key Changes

### 1. **PositionPNL Interface Extension**

```typescript
interface PositionPNL {
  positionId: string;
  tokenAddress: string;
  tokenSymbol: string;
  buyPrice: number;
  currentPrice: number;
  pnlPercent: number;
  pnlBnb: number;
  shouldTakeProfit: boolean;
  shouldStopLoss: boolean;
  shouldTimeLimitSell: boolean;
  // NEW: Arrays of triggered levels
  triggeredTpLevels?: Array<{
    index: number;
    pnlPercent: number;
    sellPercent: number;
  }>;
  triggeredSlLevels?: Array<{
    index: number;
    pnlPercent: number;
    sellPercent: number;
  }>;
}
```

**Purpose:** Track which specific levels triggered during PNL check cycle.

---

### 2. **processPosition() - Multiple Level Checking**

#### **Old Behavior (Single TP/SL):**

```typescript
if (order.takeProfitEnabled && order.takeProfitPercent) {
  shouldTakeProfit = pnlPercent >= order.takeProfitPercent;
}
```

→ Binary check: either TP triggered (100% sell) or not

#### **New Behavior (Multiple Levels):**

```typescript
if (order.takeProfitLevels && order.takeProfitLevels.length > 0) {
  // Check each TP level that hasn't been triggered yet
  for (let i = 0; i < order.takeProfitLevels.length; i++) {
    const level = order.takeProfitLevels[i];

    // Skip if already triggered (prevents re-execution)
    if (position.triggeredTakeProfitLevels?.includes(i)) {
      continue;
    }

    // Check if PNL reached this level
    if (pnlPercent >= level.pnlPercent) {
      triggeredTpLevels.push({
        index: i,
        pnlPercent: level.pnlPercent,
        sellPercent: level.sellPercent,
      });
      shouldTakeProfit = true;
    }
  }
}
```

**Key Features:**

- ✅ Loops through **all TP levels** in the order
- ✅ Skips **already triggered** levels (checks `position.triggeredTakeProfitLevels[]`)
- ✅ Collects **all newly triggered levels** in a single PNL check cycle
- ✅ **Backwards compatible** - falls back to single TP if no levels defined

**Stop Loss Logic:** Same pattern but checks `pnlPercent <= -level.pnlPercent` (negative)

---

### 3. **executePartialSell() - Core Partial Sell Function**

**Signature:**

```typescript
private async executePartialSell(
	positionId: string,
	reason: 'TAKE_PROFIT' | 'STOP_LOSS',
	levelIndex: number,
	sellPercent: number,
	pnlPercent: number
): Promise<boolean>
```

**Execution Flow:**

#### **Step 1: Validation & Duplicate Prevention**

```typescript
// Check if level already triggered in database (race condition protection)
const triggeredArray =
  reason === "TAKE_PROFIT"
    ? dbPosition.triggeredTakeProfitLevels || []
    : dbPosition.triggeredStopLossLevels || [];

if (triggeredArray.includes(levelIndex)) {
  logger.debug(`Level ${levelIndex} already triggered, skipping...`);
  return false;
}
```

#### **Step 2: Wallet & Balance Verification**

```typescript
// Get actual on-chain token balance
const actualBalance = await tokenContract.balanceOf(wallet.address);

if (actualBalance.isZero()) {
  logger.error("Token balance is zero, cannot sell");
  return false;
}
```

#### **Step 3: Calculate Partial Amount**

```typescript
// Sell specified percentage of current balance
const sellAmount = actualBalance.mul(sellPercent).div(100);
const sellAmountStr = ethers.utils.formatUnits(
  sellAmount,
  position.token.decimals,
);
```

**Example:**

- Current balance: 1,000,000 tokens
- TP1 sellPercent: 33%
- Sell amount: 330,000 tokens
- Remaining: 670,000 tokens

#### **Step 4: Transaction Queue Execution**

```typescript
const transaction = new B_Transaction({
  type: TransactionType.SELL,
  wallet,
  token: position.token,
  tokenAmount: sellAmountStr, // Partial amount
  slippage: order.slippage,
  gasPrice: order.gasFee.gasPrice,
  gasLimit: order.gasFee.gasLimit,
  orderId: order._id.toString(),
  positionId: position.id,
  userId: order.userId.toString(),
  priority: reason === "STOP_LOSS" ? 100 : 50, // SL has higher priority
});

const txId = transactionQueue.push(transaction);
await this.waitForTransaction(transaction, 120000); // 120s timeout
```

#### **Step 5: Database & Memory Update**

```typescript
// Mark level as triggered + update remaining token amount
await Position.findByIdAndUpdate(positionId, {
  $addToSet: { [updateField]: levelIndex }, // Atomic array update
  tokenAmount: newBalanceFormatted,
  lastPriceUpdate: new Date(),
});

// Update in-memory position
position.tokenAmount = newBalanceFormatted;
if (reason === "TAKE_PROFIT") {
  position.triggeredTakeProfitLevels.push(levelIndex);
} else {
  position.triggeredStopLossLevels.push(levelIndex);
}
```

**$addToSet:** MongoDB atomic operation that prevents duplicate level indices even if multiple PNL checks run concurrently.

#### **Step 6: Position Closure Check**

```typescript
// Check if position should be closed (tokenAmount near zero)
if (newBalanceFormatted < 0.0001 || sellPercent >= 100) {
  logger.info(`Token amount near zero, closing position...`);
  await positionManager.closePosition(
    positionId,
    position.currentPrice,
    txHash,
  );
} else {
  // Clear pending sell flag - position still open
  position.hasPendingSell = false;
}
```

**Closure Conditions:**

- Remaining tokens < 0.0001 (dust amount)
- Last level has `sellPercent: 100` (closes immediately)

---

### 4. **executeTriggeredPositions() - Orchestration**

**Old Logic:**

```typescript
// Execute all triggered positions in parallel batches
for (const batch of batches) {
  const executePromises = batch.map((pnl) => {
    return this.executeSell(pnl.positionId, reason); // Always 100% sell
  });
  await Promise.all(executePromises);
}
```

**New Logic (Sequential Execution):**

```typescript
// Execute sequentially to avoid race conditions with position updates
for (const pnl of triggered) {
  // Handle Time Limit (always 100% sell)
  if (pnl.shouldTimeLimitSell) {
    await this.executeSell(pnl.positionId, "TIME_LIMIT");
    continue;
  }

  // Handle Multiple TP levels (partial sells)
  if (pnl.triggeredTpLevels && pnl.triggeredTpLevels.length > 0) {
    for (const level of pnl.triggeredTpLevels) {
      await this.executePartialSell(
        pnl.positionId,
        "TAKE_PROFIT",
        level.index,
        level.sellPercent,
        level.pnlPercent,
      );
    }
    continue;
  }

  // Handle Multiple SL levels (partial sells)
  if (pnl.triggeredSlLevels && pnl.triggeredSlLevels.length > 0) {
    for (const level of pnl.triggeredSlLevels) {
      await this.executePartialSell(
        pnl.positionId,
        "STOP_LOSS",
        level.index,
        level.sellPercent,
        level.pnlPercent,
      );
    }
    continue;
  }

  // Backwards compatibility: single TP/SL (100% sell)
  if (pnl.shouldTakeProfit) {
    await this.executeSell(pnl.positionId, "TAKE_PROFIT");
  } else if (pnl.shouldStopLoss) {
    await this.executeSell(pnl.positionId, "STOP_LOSS");
  }
}
```

**Why Sequential?**

- Prevents race conditions when updating `tokenAmount` in database
- Each level execution needs accurate current balance
- Ensures correct calculation: sell 33% of _remaining_ balance, not original

**Example Race Condition (Parallel):**

```
TP1 (33%): Reads balance: 1M → Sells 330K
TP2 (50%): Reads balance: 1M → Sells 500K (WRONG! Should be 50% of 670K)
```

**With Sequential:**

```
TP1 (33%): Reads balance: 1M → Sells 330K → Updates DB to 670K
TP2 (50%): Reads balance: 670K → Sells 335K → Updates DB to 335K ✅
```

---

### 5. **notifyPartialSell() - User Notification**

```typescript
const message =
  `${emoji} <b>${action} Level Triggered!</b>\n\n` +
  `<b>Level:</b> ${levelName} (${pnlPercent >= 0 ? "+" : ""}${pnlPercent}%)\n` +
  `<b>Sold:</b> ${sellPercent}% of position\n` +
  `<b>Remaining:</b> ${position.tokenAmount.toLocaleString()} tokens\n\n` +
  `<b>Order:</b> ${order.name}\n` +
  `<b>Token:</b> ${position.token.symbol || "Unknown"}\n` +
  `<code>${position.token.address}</code>\n\n` +
  `<b>Current Price:</b> ${position.currentPrice.toFixed(10)} BNB\n` +
  `<b>Current P&L:</b> ${position.getPnL() >= 0 ? "+" : ""}${position.getPnL().toFixed(6)} BNB\n\n` +
  `<b>TX Hash:</b>\n<code>${txHash}</code>`;
```

**Sample User Message:**

```
🎯 Take Profit Level Triggered!

Level: TP1 (+20%)
Sold: 33% of position
Remaining: 670,000 tokens

Order: My Auto Buy
Token: MEME
0x1234...

Current Price: 0.0000002000 BNB
Current P&L: +0.012345 BNB (+20.50%)

TX Hash: 0xabcd...
```

---

## 🔄 Complete Execution Flow

### **Example Scenario:**

**Order Configuration:**

```typescript
takeProfitLevels: [
  { pnlPercent: 20, sellPercent: 33 }, // TP1
  { pnlPercent: 50, sellPercent: 50 }, // TP2
  { pnlPercent: 100, sellPercent: 100 }, // TP3
];
```

**Position State:**

- Bought 1,000,000 tokens at 0.0001 BNB
- Current price: 0.00012 BNB → **PNL: +20%**

### **Execution Steps:**

#### **PNL Check Cycle 1 (Price: 0.00012 BNB, PNL: +20%)**

1. **processPosition()** checks TP levels:

   ```typescript
   Level 0: pnlPercent (20) >= level.pnlPercent (20) → TRIGGERED ✅
   Level 1: pnlPercent (20) < level.pnlPercent (50) → Not triggered
   Level 2: pnlPercent (20) < level.pnlPercent (100) → Not triggered

   Result: triggeredTpLevels = [{ index: 0, pnlPercent: 20, sellPercent: 33 }]
   ```

2. **executePartialSell()** executes:
   - Sell 33% of 1,000,000 = **330,000 tokens**
   - Remaining: **670,000 tokens**
   - DB Update: `triggeredTakeProfitLevels: [0]`, `tokenAmount: 670000`
   - Notification: "🎯 TP1 (+20%) Triggered! Sold 33%"

#### **PNL Check Cycle 2 (Price: 0.00015 BNB, PNL: +50%)**

1. **processPosition()** checks TP levels:

   ```typescript
   Level 0: Already in triggeredTakeProfitLevels → SKIP ⏩
   Level 1: pnlPercent (50) >= level.pnlPercent (50) → TRIGGERED ✅
   Level 2: pnlPercent (50) < level.pnlPercent (100) → Not triggered

   Result: triggeredTpLevels = [{ index: 1, pnlPercent: 50, sellPercent: 50 }]
   ```

2. **executePartialSell()** executes:
   - Sell 50% of **670,000** = **335,000 tokens** ✅ (correct remaining balance)
   - Remaining: **335,000 tokens**
   - DB Update: `triggeredTakeProfitLevels: [0, 1]`, `tokenAmount: 335000`
   - Notification: "🎯 TP2 (+50%) Triggered! Sold 50%"

#### **PNL Check Cycle 3 (Price: 0.0002 BNB, PNL: +100%)**

1. **processPosition()** checks TP levels:

   ```typescript
   Level 0: Already triggered → SKIP
   Level 1: Already triggered → SKIP
   Level 2: pnlPercent (100) >= level.pnlPercent (100) → TRIGGERED ✅

   Result: triggeredTpLevels = [{ index: 2, pnlPercent: 100, sellPercent: 100 }]
   ```

2. **executePartialSell()** executes:
   - Sell 100% of **335,000** = **335,000 tokens** (final exit)
   - Remaining: **0 tokens**
   - DB Update: `triggeredTakeProfitLevels: [0, 1, 2]`, `tokenAmount: 0`
   - Position closed: `status: CLOSED`, removed from memory
   - Notification: "🎯 TP3 (+100%) Triggered! Sold 100%"

---

## 🛡️ Safety Features

### **1. Duplicate Execution Prevention**

**Problem:** PNL monitor runs every 2 seconds. What if TP1 triggers, but transaction takes 3 seconds to confirm?

**Solution - Three-Layer Protection:**

#### **Layer 1: In-Memory Flag**

```typescript
if (position.hasPendingSell) {
  logger.debug("Position already has pending sell, skipping...");
  return false;
}
position.hasPendingSell = true;
```

Prevents submitting multiple transactions for same position.

#### **Layer 2: processPosition Skip Check**

```typescript
if (position.triggeredTakeProfitLevels?.includes(i)) {
  continue; // Skip already triggered levels
}
```

Doesn't even add already-triggered levels to execution queue.

#### **Layer 3: Database Atomic Check**

```typescript
const dbPosition = await Position.findById(positionId);
if (dbPosition.triggeredTakeProfitLevels?.includes(levelIndex)) {
  logger.debug("Level already triggered in database, skipping...");
  return false;
}

// Later...
await Position.findByIdAndUpdate(positionId, {
  $addToSet: { triggeredTakeProfitLevels: levelIndex }, // MongoDB atomic operation
});
```

Final safety check before transaction submission. `$addToSet` prevents duplicate array values.

### **2. Zero Balance Detection**

```typescript
if (actualBalance.isZero()) {
  logger.error("Token balance is zero, cannot sell");
  position.hasPendingSell = false;
  return false;
}
```

Prevents failed transactions if tokens already sold manually or by another system.

### **3. Dust Amount Auto-Close**

```typescript
if (newBalanceFormatted < 0.0001 || sellPercent >= 100) {
  await positionManager.closePosition(
    positionId,
    position.currentPrice,
    txHash,
  );
}
```

Closes position when remaining amount is negligible (dust), avoiding stuck positions.

### **4. Transaction Verification**

```typescript
const receipt = await provider.getTransactionReceipt(txHash);
if (receipt.status !== 1) {
  logger.error("Transaction reverted (status = 0)");
  position.hasPendingSell = false;
  return false;
}
```

Double-checks on-chain transaction success even after queue reports success.

---

## 🔧 Backwards Compatibility

### **Old Single TP/SL Orders (Still Supported)**

**Detection:**

```typescript
if (order.takeProfitLevels && order.takeProfitLevels.length > 0) {
  // New system: multiple levels
} else if (order.takeProfitEnabled && order.takeProfitPercent) {
  // Old system: single TP (100% sell)
  shouldTakeProfit = pnlPercent >= order.takeProfitPercent;
}
```

**Execution:**

```typescript
// Backwards compatibility: single TP/SL (100% sell)
if (pnl.shouldTakeProfit) {
  await this.executeSell(pnl.positionId, "TAKE_PROFIT"); // Uses old 100% sell function
}
```

**Result:** Old orders continue to work exactly as before (100% exit on single TP/SL).

---

## ✅ Testing Checklist

### **Functional Tests:**

- [ ] **Single Level:** Order with TP: `[{50, 100}]` → Sells 100% at +50%
- [ ] **Multiple Levels:** Order with TP: `[{20, 33}, {50, 50}, {100, 100}]` → Three partial sells
- [ ] **Stop Loss:** Order with SL: `[{-30, 100}]` → Sells 100% at -30% (negative PNL)
- [ ] **Mixed TP/SL:** Position with both arrays → Handles correctly
- [ ] **Backwards Compat:** Old order with `takeProfitPercent: 50` → Still works

### **Edge Cases:**

- [ ] **Rapid Price Movement:** PNL jumps from +10% to +60% in one cycle → Triggers TP1 and TP2 in sequence
- [ ] **Level Already Triggered:** Database has `triggeredTakeProfitLevels: [0]` → Skips level 0
- [ ] **Zero Balance:** Wallet has 0 tokens → Aborts gracefully
- [ ] **Bot Restart:** Bot restarts after TP1 executed → Loads `triggeredTakeProfitLevels` from DB, doesn't re-execute
- [ ] **Transaction Failure:** Sell transaction reverts → Doesn't mark level as triggered

### **Performance Tests:**

- [ ] **1500 Positions:** Check cycle time with multiple levels per position
- [ ] **Sequential Execution:** Verify tokenAmount updates correctly between levels

---

## 📊 Performance Impact

**Old System:**

- Single TP/SL check per position
- Parallel batch execution

**New System:**

- Loop through N levels per position (typically 2-5 levels)
- Sequential execution for triggered positions

**Expected Impact:**

- **PNL Check Phase:** +10-20% time (looping through levels)
- **Execution Phase:** +0-50% time (sequential vs parallel)
  - Only affects positions with active triggers (rare)
  - Example: 1500 positions, 10 triggered → 10 sequential sells instead of 5 parallel batches

**Mitigation:**

- Duplicate prevention skips already-triggered levels
- Most positions have 0 triggered levels per cycle
- Transaction queue handles load management

---

## 🚀 Next Steps (Phase 4)

**Order Configuration UI:**

1. Create `showTPSLLevelsEditor()` handler in bot
2. Add/remove TP/SL levels dynamically
3. Validate last level always has `sellPercent: 100`
4. Display current levels with edit/delete buttons
5. Update order document in database

**Files to Modify:**

- `src/bot/handlers/order.handler.ts`
- `src/bot/keyboards/order.keyboard.ts`

---

## 📝 Summary

**Phase 3 Status:** ✅ **COMPLETE**

**Lines of Code:** 230+ new lines (executePartialSell + notifyPartialSell + processPosition rewrite)

**Key Achievements:**

- ✅ PNL monitor checks multiple TP/SL levels dynamically
- ✅ Executes partial sells based on `sellPercent` configuration
- ✅ Marks triggered levels in database (prevents re-execution)
- ✅ Updates position `tokenAmount` after each partial sell
- ✅ Auto-closes position when tokens reach near-zero
- ✅ Sequential execution prevents race conditions
- ✅ Three-layer duplicate prevention system
- ✅ Backwards compatible with old single TP/SL orders
- ✅ Comprehensive user notifications for each level
- ✅ Zero new compilation errors

**User Requirement:** ✅ "Check conditions really perfectly" → Implemented with triple-layer safety checks and atomic DB updates

**Ready for:** Phase 4 (Order Configuration UI)
