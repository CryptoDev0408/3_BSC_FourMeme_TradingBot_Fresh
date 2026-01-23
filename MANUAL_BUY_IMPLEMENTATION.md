# Manual Buy Implementation Guide

## Overview

Implemented Manual Buy functionality that allows users to manually enter a token address, validate it on PancakeSwap V2, execute the buy, and track the position with TP/SL monitoring.

## Components Implemented

### 1. Token Validation (`src/core/token/token.validator.ts`)

**Purpose**: Validate tokens are on PancakeSwap V2 before allowing trades

**Key Features**:

- Validates token address format
- Fetches ERC20 metadata (name, symbol, decimals, totalSupply)
- Checks if pair exists on PancakeSwap V2 Factory
- Validates minimum liquidity (0.1 BNB)
- Caches validated tokens in database for future lookups

**Usage**:

```typescript
import { tokenValidator } from "./core/token/token.validator";

const result = await tokenValidator.validateToken("0x...");
if (result.isValid) {
  // Proceed with buy
  console.log("Token:", result.token.symbol);
  console.log("Pair:", result.pairAddress);
  console.log("Liquidity:", result.liquidityBnb);
}
```

### 2. Position Manager (`src/core/position/position.manager.ts`)

**Purpose**: Manage positions in-memory for fast TP/SL checking

**Key Features**:

- Loads all open positions from database on initialization
- Maintains in-memory Map for fast access
- Provides methods: `addPosition()`, `updatePositionPrice()`, `closePosition()`
- Query methods: `getPosition()`, `getPositionsByOrder()`, `getPositionsByUser()`

**Usage**:

```typescript
import { positionManager } from "./core/position/position.manager";

// Initialize on startup
await positionManager.initialize();

// Add position after buy
positionManager.addPosition(bPosition);

// Get all open positions
const positions = positionManager.getAllOpenPositions();
```

### 3. TP/SL Monitor Service (`src/services/tpsl.monitor.ts`)

**Purpose**: Monitor positions and execute TP/SL automatically

**Key Features**:

- Runs on configurable interval (default: 10 seconds)
- Updates current price for all open positions
- Checks TP/SL triggers (to be implemented)
- Executes sell transactions when triggered
- Sends Telegram notifications for trades

**Configuration**:

```env
POSITION_MONITOR_INTERVAL=10000  # 10 seconds
```

**Usage**:

```typescript
import { tpslMonitor } from "./services/tpsl.monitor";

// Start monitoring
tpslMonitor.start();

// Stop monitoring
tpslMonitor.stop();

// Get status
const status = tpslMonitor.getStatus();
```

### 4. Token Model (`src/database/models/token.model.ts`)

**Purpose**: Store validated tokens with PancakeSwap V2 metadata

**Schema**:

- `address` (unique, lowercase)
- `name`, `symbol`, `decimals`, `totalSupply`
- `pairAddress` - PancakeSwap V2 pair contract
- `liquidityBnb` - Liquidity amount in BNB
- `isPancakeswapV2` - Validation flag
- `isVerified` - Manual verification flag

### 5. Order Executor Updates (`src/core/order/order.executor.ts`)

**Purpose**: Execute buy orders with token validation and position tracking

**Changes**:

- Added TokenValidator to validate tokens before buy
- Creates B_Token and B_Position instances after successful buy
- Adds position to PositionManager for in-memory tracking
- Returns positionId in ExecutionResult

## User Flow

### Manual Buy Process

1. **User clicks "🪙 Manual Buy" button in Order Details**
   - Only visible when autoBuy is OFF

2. **Bot prompts for token address**

   ```
   🪙 Manual Buy
   Enter the token contract address you want to buy:
   Example: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
   ```

3. **User enters token address**

4. **Token Validation**
   - Check address format ✓
   - Fetch ERC20 metadata ✓
   - Check PancakeSwap V2 pair exists ✓
   - Verify liquidity >= 0.1 BNB ✓
   - Cache in database ✓

5. **Execute Buy**
   - Get wallet with private key
   - Execute PancakeSwap V2 swap
   - Create position in database
   - Add to PositionManager

6. **Success Message**

   ```
   ✅ Buy Successful!
   Token: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
   TX: 0xabc123...
   View on BSCScan:
   https://bscscan.com/tx/0xabc123...
   ```

7. **Position Monitoring**
   - TP/SL Monitor checks position every 10 seconds
   - Updates current price
   - Checks TP/SL triggers (to be implemented)
   - Executes sell when triggered

## Next Steps (To Be Implemented)

### 1. TP/SL Logic

Update `tpslMonitor.checkPosition()` in `src/services/tpsl.monitor.ts`:

```typescript
// Check TP
if (position.shouldTakeProfit()) {
  await this.executeSell(positionId, "TAKE_PROFIT");
  return;
}

// Check SL
if (position.shouldStopLoss()) {
  await this.executeSell(positionId, "STOP_LOSS");
  return;
}
```

### 2. Auto Buy from Scanner

When scanner detects new token:

```typescript
import { executeManualBuy } from "./core/order/order.executor";

// For each active order with autoBuy=true
const result = await executeManualBuy(orderId, userId, tokenAddress);
```

### 3. Manual Sell

Add "💰 Manual Sell" button in Position Details view:

- Show position details
- Confirm sell
- Execute B_Trading.sell()
- Close position in PositionManager

### 4. Position List View

Add command `/positions` to list all user positions:

- Open positions
- P&L for each
- Quick actions (sell, view details)

## Testing

### Manual Buy Test Flow

1. Start bot: `npm run dev`
2. Open Telegram bot
3. Create wallet and order
4. Set autoBuy to OFF
5. Click "🪙 Manual Buy"
6. Enter token address (e.g., WBNB: `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c`)
7. Verify buy execution
8. Check position created

### Validation Tests

```bash
# Test invalid address
0x123  # Should reject

# Test non-V2 token
0xRandomToken  # Should reject if not on PancakeSwap V2

# Test low liquidity token
# Should reject if liquidity < 0.1 BNB
```

## Configuration

### Environment Variables

```env
# Position Monitoring
POSITION_MONITOR_INTERVAL=10000  # Interval in ms (10 seconds)

# Trading Settings
DEFAULT_SLIPPAGE=1.0
DEFAULT_GAS_PRICE=5
MIN_BNB_BALANCE=0.001
MAX_BNB_PER_TRADE=10
```

## Architecture Diagram

```
User Input (Token Address)
    ↓
TokenValidator (Validate PancakeSwap V2)
    ↓
executeBuyOrder (Buy on PancakeSwap)
    ↓
Create Position (Database + PositionManager)
    ↓
TP/SL Monitor (Check every 10s)
    ↓
Execute Sell (When TP/SL triggered)
```

## Files Modified/Created

### Created:

- `src/database/models/token.model.ts`
- `src/core/token/token.validator.ts`
- `src/core/position/position.manager.ts`
- `src/services/tpsl.monitor.ts`

### Modified:

- `src/database/models/index.ts` - Added Token export
- `src/core/order/order.executor.ts` - Added TokenValidator, PositionManager integration
- `src/index.ts` - Initialize PositionManager and TPSLMonitor on startup
- `src/bot/index.ts` - Added Manual Buy routing
- `src/bot/handlers/order.handler.ts` - Already has handleManualBuy function

## Contract Addresses (BSC Mainnet)

```typescript
PANCAKESWAP_V2_FACTORY = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73";
PANCAKESWAP_V2_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
```

## Key Concepts

### Why PancakeSwap V2 Only?

- Ensures liquidity exists
- Prevents honeypot/scam tokens
- Standard swap interface
- Predictable gas costs

### Why In-Memory Position Tracking?

- Fast TP/SL checks (no database queries)
- Scales to many positions
- Persisted in database for reliability
- Loaded on startup

### Why Validate Before Buy?

- Prevent buying tokens without liquidity
- Verify token is tradable
- Cache metadata for future reference
- Protect user funds

## Troubleshooting

### "Token validation failed"

- Check if token has PancakeSwap V2 pair
- Verify liquidity >= 0.1 BNB
- Ensure address is valid

### "Position not found"

- Check if PositionManager initialized
- Verify position added after buy
- Check database connection

### "Monitor not running"

- Verify `tpslMonitor.start()` called in index.ts
- Check `POSITION_MONITOR_INTERVAL` env variable
- Look for errors in logs

## Future Enhancements

1. **Multi-DEX Support**: Add Biswap, ApeSwap validation
2. **Token Scoring**: Score tokens based on liquidity, volume, holders
3. **Trail Stop Loss**: Dynamic SL that follows price up
4. **Partial Sells**: Sell percentage instead of all
5. **Position Averaging**: Buy more on dips
6. **PnL Notifications**: Alert on significant gains/losses
7. **Auto-Compound**: Reinvest profits into new positions
