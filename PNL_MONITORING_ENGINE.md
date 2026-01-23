# PNL Monitoring Engine - Technical Documentation

## Overview

The **High-Performance PNL Monitoring Engine** is designed to monitor thousands of trading positions in real-time with optimal performance and minimal latency. It uses batch processing, AMM formula calculations, and efficient caching to handle 1500+ positions every 2 seconds.

---

## Architecture

### Core Components

1. **PriceService** (`src/services/price.service.ts`)
   - Batch price fetching using multicall pattern
   - AMM formula (x \* y = k) for price calculation from reserves
   - Pair address caching for fast lookups
   - Price caching with configurable TTL

2. **PNLMonitorEngine** (`src/services/pnl.monitor.ts`)
   - Main monitoring loop with batch position processing
   - Parallel execution for price updates and TP/SL checks
   - Console logging with PNL summaries
   - Automatic TP/SL execution

### Performance Optimizations

#### 1. Batch Price Fetching

Instead of fetching prices one by one (1500 RPC calls), the engine:

- Extracts unique token addresses (reduces duplicates)
- Fetches all pair addresses in parallel
- Batch fetches reserves from all pairs
- Calculates prices using AMM formula

**Result**: 1500 positions → ~100 unique tokens → ~300 RPC calls (3 per token)

#### 2. Parallel Processing

- Uses `Promise.all` for batch operations
- Processes positions in chunks of 50
- Executes TP/SL sells in batches of 5

#### 3. Memory-Efficient

- Uses in-memory PositionManager (no DB reads in hot path)
- Caches pair addresses permanently
- Caches prices for 2 seconds

#### 4. Smart Batching

```
Total Positions: 1500
Unique Tokens: ~100 (assuming 15 positions per token on average)
RPC Calls per cycle:
  - 100 getPair calls (cached after first run)
  - 100 getReserves calls
  - 100 token0 calls
Total: ~300 RPC calls vs 1500 with naive approach
```

---

## Configuration

### Environment Variables

Add to `.env` file:

```bash
# PNL Monitor interval in milliseconds (default: 2000ms = 2 seconds)
PNL_MONITOR_INTERVAL=2000
```

### Recommended Settings by Scale

| Positions | Interval | Notes                    |
| --------- | -------- | ------------------------ |
| 1-500     | 1000ms   | Very fast updates        |
| 500-1500  | 2000ms   | ✅ Recommended (default) |
| 1500-3000 | 3000ms   | Heavy load               |
| 3000+     | 5000ms   | Adjust RPC limits        |

---

## Usage

### Starting the Engine

The engine starts automatically with the bot:

```typescript
import { pnlMonitorEngine } from "./services/pnl.monitor";

// Starts on bot initialization (src/index.ts)
pnlMonitorEngine.start();
```

### Runtime Configuration

Change interval without restart:

```typescript
// Set to 5 seconds
pnlMonitorEngine.setInterval(5000);
```

### Getting Status

```typescript
const status = pnlMonitorEngine.getStatus();
console.log(status);
// {
//   isRunning: true,
//   positionCount: 1500,
//   intervalMs: 2000,
//   lastCheckTime: 1706032800000,
//   positionsChecked: 1500,
//   pricesFetched: 98
// }
```

### Stopping the Engine

```typescript
pnlMonitorEngine.stop();
```

---

## Console Output

The engine logs detailed PNL information to the console every cycle:

### Sample Output

```
================================================================================
📊 PNL MONITOR - LIVE SUMMARY
================================================================================
⏰ Time: 1/23/2026, 3:45:30 PM
📈 Total Positions: 1500
🟢 Profitable: 842 (56.1%)
🔴 Losing: 658 (43.9%)
💰 Total PNL: +12.456789 BNB
📊 Average PNL: +3.45%
🎯 Triggered (TP/SL): 5
================================================================================

🚀 TOP GAINERS:
  1. MEME | +156.23% | +0.234567 BNB
  2. DOGE | +89.45% | +0.123456 BNB
  3. PEPE | +67.89% | +0.098765 BNB
  4. SHIB | +45.67% | +0.067890 BNB
  5. FLOKI | +34.56% | +0.045678 BNB

📉 TOP LOSERS:
  1. SCAM | -78.90% | -0.156789 BNB
  2. RUG | -56.78% | -0.123456 BNB
  3. DUMP | -45.67% | -0.098765 BNB
  4. DEAD | -34.56% | -0.067890 BNB
  5. REKT | -23.45% | -0.045678 BNB

🎯 TRIGGERED POSITIONS (TP/SL):
  1. MOON | ✅ TAKE PROFIT | +50.00%
  2. LAMBO | ✅ TAKE PROFIT | +100.00%
  3. NOPE | 🛑 STOP LOSS | -10.00%
  4. OOPS | 🛑 STOP LOSS | -15.00%
  5. YOLO | ✅ TAKE PROFIT | +75.00%
================================================================================

✅ PNL Check completed: 1500 positions, 98 prices, 1245ms
```

---

## How It Works

### 1. Price Calculation (AMM Formula)

PancakeSwap uses the constant product formula:

```
x * y = k

Where:
x = Token reserve
y = WBNB reserve
k = constant

Price = y / x (WBNB per token)
```

Example:

```typescript
Reserve Token: 1,000,000 tokens
Reserve WBNB: 10 BNB

Price = 10 / 1,000,000 = 0.00001 BNB per token
```

### 2. Batch Processing Flow

```
Start Cycle
    ↓
Get All Open Positions (1500)
    ↓
Extract Unique Tokens (100)
    ↓
Batch Fetch Prices
    ├─ Get Pair Addresses (100 calls, cached)
    ├─ Get Reserves (100 calls)
    └─ Get Token0 (100 calls)
    ↓
Calculate Prices (AMM formula)
    ↓
Process Positions in Batches (50 at a time)
    ├─ Update Prices
    ├─ Calculate PNL
    └─ Check TP/SL
    ↓
Log Summary to Console
    ↓
Execute Triggered Positions (5 at a time)
    ↓
End Cycle (Total: ~1.5 seconds for 1500 positions)
```

### 3. TP/SL Execution

When a position triggers TP or SL:

1. Verify position and order still exist
2. Get wallet from database
3. Execute sell on PancakeSwap
4. Close position in database
5. Send Telegram notification to user

---

## Performance Metrics

### Expected Performance

| Metric              | Value            |
| ------------------- | ---------------- |
| Positions monitored | 1500             |
| Unique tokens       | ~100             |
| RPC calls per cycle | ~300             |
| Cycle time          | 1000-2000ms      |
| Price updates       | 100 tokens/cycle |
| Database writes     | 1500 (positions) |

### Bottlenecks

1. **RPC Rate Limits**: Use private RPC for >2000 positions
2. **Database Writes**: Consider batching position updates
3. **Network Latency**: Use local/fast RPC endpoints
4. **Memory Usage**: ~10MB per 1000 positions

---

## Telegram Notifications

When TP/SL triggers, users receive:

```
🟢 🎯 Take Profit Executed!

Order: DEGEN_ORDER
Token: MEME
0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb

Entry Price: 0.0000100000 BNB
Exit Price: 0.0000200000 BNB
Amount: 1,000,000 tokens

P&L: +0.010000 BNB (+100.00%)

TX Hash:
0xabc123...def456
```

---

## Comparison: Old vs New

### Old TP/SL Monitor

- ⏰ **10 seconds** interval
- 🐌 **Sequential** price fetching (1 RPC per position)
- 📊 **1500 RPC calls** per cycle
- ⏱️ **~15 seconds** to check 1500 positions
- 📉 No detailed logging

### New PNL Engine

- ⏰ **2 seconds** interval (5x faster)
- 🚀 **Batch** price fetching (AMM formula)
- 📊 **~300 RPC calls** per cycle (5x fewer)
- ⏱️ **~1.5 seconds** to check 1500 positions (10x faster)
- 📊 Detailed console logging with statistics

**Result**: 25x overall improvement (5x faster \* 5x fewer calls)

---

## Advanced Usage

### Custom Price Service

```typescript
import { getPriceService } from "./services/price.service";
import { getProvider } from "./core/wallet/wallet.service";

const priceService = getPriceService(getProvider());

// Get single price
const price = await priceService.getTokenPrice(tokenAddress);

// Get multiple prices in batch
const prices = await priceService.getTokenPricesBatch([
  "0xToken1...",
  "0xToken2...",
  "0xToken3...",
]);

// Configure cache TTL
priceService.setCacheTTL(5000); // 5 seconds
```

### Monitoring Status

Create an admin command:

```typescript
// In bot handler
async function handleMonitorStatus(chatId: string) {
  const status = pnlMonitorEngine.getStatus();

  const message = `
📊 PNL Monitor Status

Running: ${status.isRunning ? "✅" : "❌"}
Positions: ${status.positionCount}
Interval: ${status.intervalMs}ms
Last Check: ${new Date(status.lastCheckTime).toLocaleString()}
Positions Checked: ${status.positionsChecked}
Prices Fetched: ${status.pricesFetched}
  `;

  await bot.sendMessage(chatId, message);
}
```

---

## Troubleshooting

### High RPC Load

**Problem**: Too many RPC requests
**Solution**:

- Increase `PNL_MONITOR_INTERVAL` to 3000-5000ms
- Use a private RPC endpoint
- Implement RPC load balancing

### Slow Performance

**Problem**: Cycle takes >3 seconds
**Solution**:

- Check RPC latency: `ping bsc-dataseed1.binance.org`
- Reduce batch sizes in code
- Use faster RPC endpoint

### Memory Issues

**Problem**: High memory usage
**Solution**:

- Clear price cache periodically: `priceService.clearCache()`
- Reduce cache TTL
- Close old positions

### Missing Prices

**Problem**: Some tokens have no prices
**Solution**:

- Verify token has liquidity on PancakeSwap
- Check pair exists: `factoryContract.getPair(token, WBNB)`
- Ensure token is not honeypot/scam

---

## Development

### Adding Custom Metrics

```typescript
// In pnl.monitor.ts

private async monitorAllPositions(): Promise<void> {
  const startTime = Date.now();

  // ... existing code ...

  // Add custom metrics
  const metrics = {
    cycleTime: Date.now() - startTime,
    rpcCalls: prices.size * 3,
    avgPnl: allPnlData.reduce((sum, p) => sum + p.pnlPercent, 0) / allPnlData.length,
  };

  logger.info('Metrics:', metrics);
}
```

### Testing

```typescript
// Test price service
const testTokens = [
  "0x...", // Valid token with pair
  "0x...", // Valid token with pair
];

const prices = await priceService.getTokenPricesBatch(testTokens);
console.log("Prices:", prices);

// Test PNL engine
pnlMonitorEngine.setInterval(5000); // 5 seconds for testing
pnlMonitorEngine.start();

// Stop after 1 minute
setTimeout(() => {
  pnlMonitorEngine.stop();
  console.log("Status:", pnlMonitorEngine.getStatus());
}, 60000);
```

---

## Technical Details

### Price Service Architecture

```typescript
interface TokenPrice {
  tokenAddress: string; // Token contract address
  priceInBnb: number; // Calculated price
  reserve0: string; // Pair reserve 0
  reserve1: string; // Pair reserve 1
  pairAddress: string; // PancakeSwap pair address
  isToken0: boolean; // Token position in pair
  timestamp: number; // Cache timestamp
}
```

### PNL Data Structure

```typescript
interface PositionPNL {
  positionId: string; // MongoDB position ID
  tokenAddress: string; // Token contract
  tokenSymbol: string; // Token symbol (e.g., "MEME")
  buyPrice: number; // Entry price in BNB
  currentPrice: number; // Current price in BNB
  pnlPercent: number; // Profit/Loss percentage
  pnlBnb: number; // Profit/Loss in BNB
  shouldTakeProfit: boolean; // TP triggered?
  shouldStopLoss: boolean; // SL triggered?
}
```

---

## Future Enhancements

### Planned Features

1. **WebSocket Price Updates**: Real-time price updates instead of polling
2. **Multi-DEX Support**: Fetch prices from multiple DEXs
3. **Advanced Analytics**: Historical PNL tracking, win rate, etc.
4. **Auto-Scaling**: Dynamic interval based on position count
5. **RPC Failover**: Automatic fallback to backup RPCs
6. **Grafana Integration**: Real-time monitoring dashboard

### Performance Targets

- Support 5000+ positions
- <1 second cycle time for 2000 positions
- <100ms price fetching for 200 tokens
- 99.9% uptime

---

## License

This engine is part of the FourMeme Trading Bot project.

---

## Support

For issues or questions:

- Check logs in `logs/` directory
- Review console output for PNL summaries
- Enable debug logging: `LOG_LEVEL=debug`

---

**Built with ⚡ for high-performance trading on BSC**
