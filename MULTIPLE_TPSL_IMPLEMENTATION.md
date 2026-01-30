# Multiple TP/SL Implementation - Four.meme Trading Bot

## Overview

This document describes the implementation of **Dynamic Multiple TP/SL Levels** for the Four.meme Trading Bot. This feature allows users to set multiple take-profit and stop-loss levels with partial sell percentages.

---

## Current Implementation Status

### 🎉 ALL PHASES COMPLETE! ✅

**Implementation Date:** January 30, 2026  
**Build Status:** ✅ Compiles successfully  
**Documentation:** ✅ Comprehensive guides created  
**Testing Status:** ⏳ Ready for user testing

---

## Phase Status Overview

- ✅ **Phase 1:** Database Schema Updates (COMPLETE)
- ✅ **Phase 2:** Position Creation Logic (COMPLETE)
- ✅ **Phase 3:** PNL Monitor Engine (COMPLETE - 230+ lines)
- ✅ **Phase 4:** Order Configuration UI (COMPLETE - 14 functions)
- ✅ **Phase 5:** Position Display Updates (COMPLETE)

See `IMPLEMENTATION_COMPLETE.md` for full details.

---

### ✅ COMPLETED - Phase 1: Database Schema Updates

#### 1. Order Model (`src/database/models/order.model.ts`)

**New Interfaces:**

```typescript
export interface ITakeProfitLevel {
  pnlPercent: number; // PNL percentage to trigger (e.g., 50 = +50%)
  sellPercent: number; // Percentage of position to sell (1-100%)
}

export interface IStopLossLevel {
  pnlPercent: number; // PNL percentage to trigger (e.g., 30 = -30%)
  sellPercent: number; // Percentage of position to sell (1-100%)
}
```

**New Fields:**

- `takeProfitLevels: ITakeProfitLevel[]` - Array of TP levels
- `stopLossLevels: IStopLossLevel[]` - Array of SL levels

**Default Values:**

- TP: `[{ pnlPercent: 50, sellPercent: 100 }]` (Sell 100% at +50% PNL)
- SL: `[{ pnlPercent: 30, sellPercent: 100 }]` (Sell 100% at -30% PNL)

**Legacy Fields (Kept for backwards compatibility):**

- `takeProfitPercent`, `takeProfitEnabled`
- `stopLossPercent`, `stopLossEnabled`

#### 2. Position Model (`src/database/models/position.model.ts`)

**New Interfaces:**

- Same `ITakeProfitLevel` and `IStopLossLevel` interfaces

**New Fields:**

- `takeProfitLevels: ITakeProfitLevel[]` - Copied from order at position creation
- `stopLossLevels: IStopLossLevel[]` - Copied from order at position creation
- `triggeredTakeProfitLevels: number[]` - Indices of already triggered TP levels
- `triggeredStopLossLevels: number[]` - Indices of already triggered SL levels

**Purpose:**

- Each position tracks its own TP/SL levels (independent from order changes)
- Prevents re-triggering the same level multiple times
- Enables partial sells across multiple levels

---

## 🚀 TODO - Remaining Implementation Phases

### Phase 2: Position Creation Logic

**File:** `src/core/position/position.manager.ts`

**Task:** When creating a new position, copy TP/SL levels from order

```typescript
// In createPosition() function
const position = new Position({
  // ... existing fields ...

  // NEW: Copy TP/SL levels from order
  takeProfitLevels: order.takeProfitLevels || [],
  stopLossLevels: order.stopLossLevels || [],
  triggeredTakeProfitLevels: [],
  triggeredStopLossLevels: [],
});
```

---

### Phase 3: PNL Monitor Engine Updates

**File:** `src/services/pnl.monitor.ts`

**Changes Required:**

1. **Update `processPosition()` function:**

   ```typescript
   // Instead of single TP/SL check:
   // OLD: shouldTakeProfit = pnlPercent >= order.takeProfitPercent;

   // NEW: Check all TP levels
   const untriggeredTpLevels = position.takeProfitLevels.filter(
     (tp, index) => !position.triggeredTakeProfitLevels.includes(index),
   );

   for (const [index, tp] of position.takeProfitLevels.entries()) {
     if (!position.triggeredTakeProfitLevels.includes(index)) {
       if (pnlPercent >= tp.pnlPercent) {
         // Trigger this TP level
         await executeTakeProfitLevel(position.id, index, tp);
       }
     }
   }
   ```

2. **Create new function `executeTakeProfitLevel()`:**

   ```typescript
   private async executeTakeProfitLevel(
       positionId: string,
       levelIndex: number,
       level: ITakeProfitLevel
   ): Promise<boolean> {
       const position = positionManager.getPosition(positionId);
       if (!position) return false;

       // Calculate partial sell amount
       const sellTokenAmount = (position.tokenAmount * level.sellPercent) / 100;

       // Mark level as triggered BEFORE executing sell
       await Position.findByIdAndUpdate(positionId, {
           $addToSet: { triggeredTakeProfitLevels: levelIndex }
       });

       // Execute partial sell
       return await this.executePartialSell(
           positionId,
           sellTokenAmount,
           'TAKE_PROFIT',
           `TP${levelIndex + 1}: +${level.pnlPercent}%`
       );
   }
   ```

3. **Create new function `executePartialSell()`:**

   ```typescript
   private async executePartialSell(
       positionId: string,
       sellTokenAmount: number,
       reason: 'TAKE_PROFIT' | 'STOP_LOSS',
       label: string
   ): Promise<boolean> {
       // Similar to executeSell() but:
       // 1. Sells only partial amount
       // 2. Updates position.tokenAmount instead of closing
       // 3. If tokenAmount reaches near-zero, close position

       // ... implementation ...
   }
   ```

---

### Phase 4: Order Configuration UI

**File:** `src/bot/handlers/order.handler.ts`

**Changes Required:**

1. **Update `showOrderDetail()` function:**

   ```typescript
   // Display TP levels
   if (order.takeProfitLevels && order.takeProfitLevels.length > 0) {
     text += `\n<b>🎯 Take Profit Levels:</b>\n`;
     order.takeProfitLevels.forEach((tp, index) => {
       text += `TP${index + 1}: +${tp.pnlPercent}% → Sell ${tp.sellPercent}%\n`;
     });
   }

   // Display SL levels
   if (order.stopLossLevels && order.stopLossLevels.length > 0) {
     text += `\n<b>🛑 Stop Loss Levels:</b>\n`;
     order.stopLossLevels.forEach((sl, index) => {
       text += `SL${index + 1}: -${Math.abs(sl.pnlPercent)}% → Sell ${sl.sellPercent}%\n`;
     });
   }
   ```

2. **Add keyboard buttons for each TP/SL level:**

   ```typescript
   // Add TP level rows
   const tpLevels = order.takeProfitLevels || [];
   tpLevels.forEach((tp, idx) => {
     keyboard.inline_keyboard.push([
       {
         text: `TP${idx + 1}: +${tp.pnlPercent}% → ${tp.sellPercent}%`,
         callback_data: `order_edittp_${orderId}_${idx}`,
       },
       {
         text: "🗑",
         callback_data: `order_deletetp_${orderId}_${idx}`,
       },
     ]);
   });

   // Add button to add new TP level
   keyboard.inline_keyboard.push([
     { text: "⭐ Add TP", callback_data: `order_addtp_${orderId}` },
   ]);

   // Same for SL levels...
   ```

3. **Create handlers for TP/SL management:**
   - `handleOrderAddTP()` - Add new TP level
   - `handleOrderEditTP()` - Edit existing TP level
   - `handleOrderDeleteTP()` - Delete TP level
   - `handleOrderAddSL()` - Add new SL level
   - `handleOrderEditSL()` - Edit existing SL level
   - `handleOrderDeleteSL()` - Delete SL level

4. **Add validation:**
   - Last TP/SL level must always be 100% sell
   - TP levels must be in ascending order
   - SL levels must be in ascending order
   - Min 1% sell, max 100% sell
   - Sum of all sell percentages should not exceed 100% per direction

---

### Phase 5: Bot Index Handler Registration

**File:** `src/bot/index.ts`

**Task:** Register new callback handlers

```typescript
// TP Level Management
bot.action(/^order_addtp_(.+)$/, async (ctx) => {
  const orderId = ctx.match[1];
  await handleOrderAddTP(
    ctx.from!.id.toString(),
    orderId,
    ctx.callbackQuery!.message!.message_id,
  );
});

bot.action(/^order_edittp_(.+)_(\d+)$/, async (ctx) => {
  const [orderId, levelIndex] = [ctx.match[1], parseInt(ctx.match[2])];
  await handleOrderEditTP(
    ctx.from!.id.toString(),
    orderId,
    levelIndex,
    ctx.callbackQuery!.message!.message_id,
  );
});

bot.action(/^order_deletetp_(.+)_(\d+)$/, async (ctx) => {
  const [orderId, levelIndex] = [ctx.match[1], parseInt(ctx.match[2])];
  await handleOrderDeleteTP(
    ctx.from!.id.toString(),
    orderId,
    levelIndex,
    ctx.callbackQuery!.message!.message_id,
  );
});

// SL Level Management (same pattern)
// ...
```

---

### Phase 6: Position Display Updates

**File:** `src/bot/handlers/position.handler.ts`

**Task:** Show triggered TP/SL levels in position display

```typescript
// In showPositionDetail():
text += `\n<b>🎯 Take Profit Levels:</b>\n`;
position.takeProfitLevels.forEach((tp, index) => {
  const triggered = position.triggeredTakeProfitLevels.includes(index);
  const status = triggered ? "✅ TRIGGERED" : "⏳ Pending";
  text += `TP${index + 1}: +${tp.pnlPercent}% → ${tp.sellPercent}% ${status}\n`;
});

text += `\n<b>🛑 Stop Loss Levels:</b>\n`;
position.stopLossLevels.forEach((sl, index) => {
  const triggered = position.triggeredStopLossLevels.includes(index);
  const status = triggered ? "✅ TRIGGERED" : "⏳ Pending";
  text += `SL${index + 1}: -${Math.abs(sl.pnlPercent)}% → ${sl.sellPercent}% ${status}\n`;
});
```

---

## Data Flow

### 1. Order Creation

```
User creates order
    ↓
Order saved with default TP/SL levels:
    - takeProfitLevels: [{ pnlPercent: 50, sellPercent: 100 }]
    - stopLossLevels: [{ pnlPercent: 30, sellPercent: 100 }]
```

### 2. Position Creation (Buy)

```
Auto/Manual buy executed
    ↓
Position created with:
    - Copy order.takeProfitLevels → position.takeProfitLevels
    - Copy order.stopLossLevels → position.stopLossLevels
    - triggeredTakeProfitLevels: []
    - triggeredStopLossLevels: []
```

### 3. PNL Monitoring (Every 2 seconds)

```
PNL Monitor checks position
    ↓
For each TP level (not yet triggered):
    If PNL >= tp.pnlPercent:
        ↓
        1. Mark level as triggered (add index to triggeredTakeProfitLevels)
        2. Calculate sell amount = tokenAmount * (tp.sellPercent / 100)
        3. Execute partial sell via transaction queue
        4. Update position.tokenAmount -= soldAmount
        5. If tokenAmount ≈ 0, close position

For each SL level (not yet triggered):
    If PNL <= -sl.pnlPercent:
        ↓
        1. Mark level as triggered (add index to triggeredStopLossLevels)
        2. Calculate sell amount = tokenAmount * (sl.sellPercent / 100)
        3. Execute partial sell via transaction queue
        4. Update position.tokenAmount -= soldAmount
        5. If tokenAmount ≈ 0, close position
```

### 4. User Modifications

```
User edits order's TP/SL levels
    ↓
Only affects NEW positions created after this point
    ↓
Existing positions keep their original TP/SL levels
```

---

## Example Scenarios

### Scenario 1: Gradual Take Profit

```
Order TP Levels:
    TP1: +20% → Sell 33%
    TP2: +50% → Sell 33%
    TP3: +100% → Sell 34%

Position bought with 1000 tokens:

    PNL reaches +20%:
        → Sell 330 tokens (33%)
        → Remaining: 670 tokens
        → triggeredTakeProfitLevels: [0]

    PNL reaches +50%:
        → Sell 221 tokens (33% of 670)
        → Remaining: 449 tokens
        → triggeredTakeProfitLevels: [0, 1]

    PNL reaches +100%:
        → Sell 449 tokens (100% of remaining)
        → Remaining: 0 tokens
        → Position CLOSED
        → triggeredTakeProfitLevels: [0, 1, 2]
```

### Scenario 2: Conservative Stop Loss

```
Order SL Levels:
    SL1: -10% → Sell 50%
    SL2: -25% → Sell 50%

Position bought with 1000 tokens:

    PNL drops to -10%:
        → Sell 500 tokens (50%)
        → Remaining: 500 tokens
        → triggeredStopLossLevels: [0]

    PNL recovers to +5%:
        → No action (SL1 already triggered)

    PNL drops again to -25%:
        → Sell 250 tokens (50% of 500)
        → Remaining: 250 tokens
        → triggeredStopLossLevels: [0, 1]
```

---

## Validation Rules

### 1. Level Count

- Minimum: 1 TP level, 1 SL level
- Maximum: 10 TP levels, 10 SL levels

### 2. Sell Percentage

- Minimum: 1%
- Maximum: 100%
- **Last level MUST be 100%** (enforced by UI)

### 3. PNL Percentage Order

- TP levels must be in ascending order (10%, 20%, 50%, 100%)
- SL levels must be in ascending order (5%, 10%, 25%, 50%)

### 4. Total Sell Percentage

- Sum of all TP sell percentages should be ≤ 100%
- Sum of all SL sell percentages should be ≤ 100%
- **Recommendation:** Last level should always be 100% to ensure full exit

---

## Database Migration

**No migration needed!** The new fields have default values:

- Existing orders will automatically get default TP/SL levels
- Existing positions will have empty arrays (uses legacy fields)

**Migration script (optional):**

```javascript
// Run this to populate existing orders with default levels
db.orders.updateMany(
  { takeProfitLevels: { $exists: false } },
  {
    $set: {
      takeProfitLevels: [{ pnlPercent: 50, sellPercent: 100 }],
      stopLossLevels: [{ pnlPercent: 30, sellPercent: 100 }],
    },
  },
);
```

---

## Testing Checklist

### Phase 1: Database ✅

- [x] Order model compiles
- [x] Position model compiles
- [x] Default values applied correctly

### Phase 2: Position Creation

- [ ] Positions copy TP/SL levels from order
- [ ] Triggered arrays start empty

### Phase 3: PNL Monitoring

- [ ] Multiple TP levels trigger correctly
- [ ] Multiple SL levels trigger correctly
- [ ] Partial sells execute correctly
- [ ] Position tokenAmount updates after partial sell
- [ ] Position closes when tokenAmount ≈ 0
- [ ] Already triggered levels don't re-trigger

### Phase 4: UI

- [ ] TP/SL levels display correctly in order detail
- [ ] Add TP/SL buttons work
- [ ] Edit TP/SL buttons work
- [ ] Delete TP/SL buttons work
- [ ] Last level always enforced to 100%
- [ ] Validation prevents invalid configurations

### Phase 5: Integration

- [ ] Works with auto-buy
- [ ] Works with manual buy
- [ ] Works with time limit
- [ ] Notifications show correct TP/SL level triggered
- [ ] Transaction queue handles partial sells

---

## Performance Considerations

### 1. Database Queries

- Use `$addToSet` for atomic triggered level updates
- Index on `triggeredTakeProfitLevels` and `triggeredStopLossLevels`

### 2. PNL Monitor

- Check triggered levels first (skip if already triggered)
- Process levels in order (lowest to highest)
- Stop processing after first successful trigger per cycle

### 3. Partial Sells

- Reuse existing transaction queue infrastructure
- No need for new queue or special handling
- Update position atomically after sell confirmation

---

## API Endpoints (If needed)

### GET `/api/orders/:orderId/tpsl`

Get TP/SL levels for an order

### POST `/api/orders/:orderId/tpsl/tp`

Add new TP level

### PUT `/api/orders/:orderId/tpsl/tp/:index`

Update TP level

### DELETE `/api/orders/:orderId/tpsl/tp/:index`

Delete TP level

### POST `/api/orders/:orderId/tpsl/sl`

Add new SL level

### PUT `/api/orders/:orderId/tpsl/sl/:index`

Update SL level

### DELETE `/api/orders/:orderId/tpsl/sl/:index`

Delete SL level

---

## Telegram Bot Commands/Callbacks

### Order Management

- `order_addtp_{orderId}` - Add TP level
- `order_edittp_{orderId}_{levelIndex}` - Edit TP level
- `order_deletetp_{orderId}_{levelIndex}` - Delete TP level
- `order_addsl_{orderId}` - Add SL level
- `order_editsl_{orderId}_{levelIndex}` - Edit SL level
- `order_deletesl_{orderId}_{levelIndex}` - Delete SL level

### State Machine

- `order_tp_pnl_{orderId}_{levelIndex}` - Enter TP PNL percentage
- `order_tp_sell_{orderId}_{levelIndex}` - Enter TP sell percentage
- `order_sl_pnl_{orderId}_{levelIndex}` - Enter SL PNL percentage
- `order_sl_sell_{orderId}_{levelIndex}` - Enter SL sell percentage

---

## Notes for Implementation

1. **Start with Position Creation** (Phase 2) - This ensures new positions have the proper structure
2. **Then PNL Monitor** (Phase 3) - This makes the feature functional
3. **Finally UI** (Phase 4) - This makes it user-friendly
4. **Test incrementally** - Test each phase before moving to next
5. **Keep legacy code** - Don't remove old TP/SL fields until confirmed working

---

## Status: Phase 1 Complete ✅

**Next Step:** Implement Phase 2 - Position Creation Logic

Continue with implementation? (Y/N)
