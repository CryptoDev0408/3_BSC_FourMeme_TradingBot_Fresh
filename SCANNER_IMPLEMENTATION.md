# Token Scanner Implementation

## Overview

The Token Scanner feature has been successfully integrated into the FourMeme Trading Bot. It monitors Four.meme token migrations to PancakeSwap and displays them in real-time through the Telegram bot interface.

## Features

### 1. **Automatic Token Detection**

- Monitors BSC blockchain for Four.meme migration transactions
- Detects when tokens are migrated from Four.meme to PancakeSwap
- Runs asynchronously in the background without blocking other bot operations

### 2. **Real-time Alerts**

- Sends instant notifications to all bot users when a new token is detected
- Simple, clean alert format with essential token information
- Direct links to GMGN, DexScreener, and Axiom for quick analysis

### 3. **Token Menu Interface**

- Accessible via **🪙 Tokens** button on the main menu
- Displays the latest 10 scanned tokens
- Shows token details: name, symbol, contract address, and detection time
- Quick access to individual token details

### 4. **Separate Storage**

- Scanned tokens are stored independently in `ScannedToken` collection
- Does NOT mix with user trading positions or orders
- Maintains complete history of all detected tokens

## Architecture

### Files Created/Modified

#### New Files:

1. **`src/services/scanner.service.ts`**
   - Core scanner service
   - Monitors blockchain for migrations
   - Handles token detection and storage
   - Manages WebSocket connection to BSC

2. **`src/bot/handlers/scanner.handler.ts`**
   - Telegram bot interface handlers
   - Displays scanner menu and token details
   - Sends real-time alerts to users
   - Token statistics and formatting

3. **`src/database/models/scanned-token.model.ts`**
   - Database schema for scanned tokens
   - Stores token metadata and detection info
   - Indexed for fast queries

#### Modified Files:

1. **`src/index.ts`**
   - Added scanner service initialization
   - Token detection callback setup
   - Graceful shutdown handling

2. **`src/bot/index.ts`**
   - Integrated scanner handlers
   - Added callback query routing

3. **`src/bot/keyboards/main.keyboard.ts`**
   - Changed "🔍 Scanner" to "🪙 Tokens"

4. **`src/database/models/index.ts`**
   - Exported ScannedToken model

## How It Works

### 1. **Scanner Service Startup**

```typescript
// Starts when bot initializes (if SCANNER_ENABLED=true)
await scannerService.start();
```

### 2. **Block Monitoring**

- Connects to BSC via WebSocket
- Listens for new blocks
- Scans each transaction in the block

### 3. **Migration Detection**

- Checks if transaction is to Four.meme factory: `0x5c952063c7fc8610FFDB798152D69F0B9550762b`
- Verifies method ID matches `addLiquidity`: `0xe3412e3d`
- Extracts token address from transaction data

### 4. **Token Processing**

- Fetches token details (name, symbol, decimals)
- Saves to database
- Triggers alert callback

### 5. **User Notification**

- Sends alert to all registered users
- Shows token info with action buttons
- Links to external tools (GMGN, DexScreener, Axiom)

## Configuration

### Environment Variables

```env
# Enable/Disable scanner (default: false)
SCANNER_ENABLED=true

# BSC WebSocket URL (required for scanner)
BSC_RPC_WSS_URL=wss://bsc-ws-node.nariox.org:443

# HTTP URL for token data fetching
BSC_RPC_HTTP_URL=https://bsc-dataseed1.binance.org
```

## Usage

### For Users

1. **Access Token Menu**
   - Click **🪙 Tokens** from main menu
   - View scanner status and latest tokens

2. **View Token Details**
   - Click on any token from the list
   - See complete token information
   - Quick links to trading platforms

3. **Receive Alerts**
   - Automatically notified when new tokens detected
   - No configuration needed
   - Can immediately view details or buy

### For Developers

#### Get Latest Tokens

```typescript
const tokens = await scannerService.getLatestTokens(10);
```

#### Check Scanner Status

```typescript
const isActive = scannerService.isActive();
```

#### Get Total Scanned Count

```typescript
const count = await scannerService.getTotalScannedCount();
```

#### Register Token Detection Callback

```typescript
scannerService.onTokenDetected((tokenData) => {
  console.log("New token:", tokenData.symbol);
  // Your custom logic here
});
```

## Data Model

### ScannedToken Schema

```typescript
{
  address: string; // Token contract address
  name: string; // Token name
  symbol: string; // Token symbol
  decimals: number; // Token decimals
  totalSupply: string; // Total supply
  transactionHash: string; // Migration tx hash
  blockNumber: number; // Block number
  scannedAt: Date; // Detection timestamp
  createdAt: Date; // DB creation time
  updatedAt: Date; // DB update time
}
```

## Alert Format

```
🚨 New Token Detected!

💊 Token Name (SYMBOL)
📍 0x1234...5678
⏰ 2m ago

[🔍 View Details] [💎 Buy on GMGN]
```

## Token Menu Format

```
🔍 Four.meme Token Scanner

Status: 🟢 Active
Total Scanned: 42 tokens

📋 Latest 10 Tokens:

1. MEME - Meme Token
   0x1234...5678
   Detected: 5m ago

2. DOGE - Doge Coin
   0xabcd...efgh
   Detected: 15m ago

[🔄 Refresh] [📊 Stats]
[1. MEME] [2. DOGE]
[🏠 Main Menu]
```

## Performance

- **Async Operation**: Runs independently without blocking bot
- **Efficient Scanning**: Only checks Four.meme factory transactions
- **Database Indexing**: Fast queries on address and timestamp
- **Duplicate Prevention**: Checks existing tokens before saving

## Error Handling

- Graceful failure on WebSocket disconnection
- Automatic retry on token fetch errors
- Fallback error messages to users
- Detailed logging for debugging

## Testing

### Manual Testing Steps

1. **Enable Scanner**

   ```bash
   # Edit .env
   SCANNER_ENABLED=true
   ```

2. **Start Bot**

   ```bash
   npm run dev
   ```

3. **Verify Scanner Started**
   - Check logs for "Scanner Service started"
   - Should show "Status: 🟢 Active" in Tokens menu

4. **Test Token Menu**
   - Send `/start` to bot
   - Click **🪙 Tokens**
   - Verify menu displays correctly

5. **Test Alert (when migration occurs)**
   - Wait for real migration or use test transaction
   - Verify alert is sent to all users
   - Check token details display correctly

## Troubleshooting

### Scanner Not Starting

- Check `SCANNER_ENABLED=true` in .env
- Verify `BSC_RPC_WSS_URL` is valid
- Check logs for error messages

### No Tokens Showing

- Verify scanner is active (green status)
- Check database connection
- Look for "MIGRATION DETECTED" in logs

### Alerts Not Received

- Verify user is registered (sent `/start`)
- Check Telegram bot permissions
- Review error logs

## Future Enhancements

Possible improvements:

- Filter tokens by market cap
- Add buy directly from alert
- Token analytics integration
- Price tracking
- Volume monitoring
- Rug pull detection

## Conclusion

The Token Scanner is now fully integrated and operational. It provides real-time monitoring of Four.meme migrations with a clean user interface, keeping scanned tokens separate from trading data as requested.
