# Business Logic Classes - OOP Architecture

## Overview

This document describes the object-oriented architecture for the FourMeme Trading Bot, designed for high performance with multiple concurrent users.

## Class Hierarchy

```
B_User
├── has many B_Orders
    └── each B_Order
        ├── has one B_Wallet
        └── has many B_Positions
            └── each B_Position tracks one B_Token

B_Trading (Static Utility)
└── handles all buy/sell operations for any wallet
```

## Core Classes

### 1. B_User

**Purpose:** User management and order relationships

**Key Methods:**

- `static getOrCreate(chatId, username, firstName, lastName)` - Get existing or create new user
- `static getByChatId(chatId)` - Get user by Telegram chat ID
- `getOrders()` - Get all user's orders
- `getActiveOrders()` - Get only active orders
- `setActive(isActive)` - Enable/disable user account

**Usage:**

```typescript
const user = await B_User.getOrCreate(chatId, username, firstName, lastName);
const orders = await user.getOrders();
```

---

### 2. B_Wallet

**Purpose:** Wallet operations with ethers.js integration

**Key Methods:**

- `static generate()` - Generate new random wallet
- `static import(privateKey)` - Import existing wallet
- `static getById(walletId)` - Get wallet by ID
- `updateBalance()` - Fetch current BNB balance from blockchain
- `getEthersWallet(provider)` - Get ethers.js Wallet instance
- `transfer(toAddress, amount)` - Send BNB to address
- `rename(newName)` - Change wallet name
- `remove()` - Delete wallet from database

**Properties:**

- `address` - Wallet public address
- `privateKey` - Encrypted private key
- `balance` - Current BNB balance
- `name` - User-friendly wallet name

**Usage:**

```typescript
const wallet = await B_Wallet.generate();
await wallet.updateBalance();
console.log(`Balance: ${wallet.balance} BNB`);

const ethersWallet = wallet.getEthersWallet(provider);
// Use ethersWallet for transactions
```

---

### 3. B_Order

**Purpose:** Trading order configuration and position management

**Key Methods:**

- `static create(userId, walletId, config)` - Create new order
- `static getById(orderId, userId?)` - Get order by ID
- `static getByUserId(userId)` - Get all user orders
- `updateConfig(config)` - Update order settings
- `activate()` / `pause()` - Control order status
- `getWallet()` - Get associated wallet
- `addPosition(position)` - Add position to tracking
- `getOpenPositions()` - Get all open positions
- `canExecuteTrade()` - Validate if order can execute

**Properties:**

- `tradingAmount` - BNB amount per trade
- `slippage` - Slippage tolerance percentage
- `takeProfitPercent` - TP percentage
- `takeProfitEnabled` - TP toggle
- `stopLossPercent` - SL percentage
- `stopLossEnabled` - SL toggle
- `gasFee` - Gas price and limit
- `isActive` - Order status

**Usage:**

```typescript
const order = await B_Order.create(userId, walletId, {
  tradingAmount: 0.01,
  slippage: 10,
  takeProfitPercent: 50,
  stopLossPercent: 25,
});

await order.updateConfig({ tradingAmount: 0.02 });
await order.activate();

const validation = await order.canExecuteTrade();
if (!validation.valid) {
  console.error(validation.error);
}
```

---

### 4. B_Token

**Purpose:** Token metadata and display formatting

**Key Methods:**

- `formatAmount(amount)` - Format token amount with decimals
- `getDisplayName()` - Get symbol or shortened address
- `toJSON()` - Serialize to JSON

**Properties:**

- `address` - Token contract address
- `name` - Token name
- `symbol` - Token symbol
- `decimals` - Token decimals
- `totalSupply` - Total supply
- `pairAddress` - PancakeSwap pair address
- `liquidityBnb` - Liquidity in BNB

**Usage:**

```typescript
const token = new B_Token({
  address: "0x...",
  name: "My Token",
  symbol: "MTK",
  decimals: 18,
});

console.log(token.formatAmount("1000000000000000000")); // "1.00"
console.log(token.getDisplayName()); // "MTK"
```

---

### 5. B_Position

**Purpose:** Position tracking with P&L and TP/SL logic

**Key Methods:**

- `static createFromBuy(orderId, token, buyPrice, amount, txHash)` - Create from buy
- `updatePrice(currentPrice)` - Update current price
- `getPnL()` - Get profit/loss in BNB
- `getPnLPercent()` - Get profit/loss percentage
- `shouldTakeProfit(tpPercent)` - Check if TP hit
- `shouldStopLoss(slPercent)` - Check if SL hit
- `close(sellPrice, txHash)` - Close position
- `isOpen()` - Check if position is open

**Properties:**

- `orderId` - Parent order ID
- `token` - B_Token instance
- `buyPrice` - Entry price in BNB
- `currentPrice` - Current price in BNB
- `amount` - Token amount
- `buyTxHash` - Buy transaction hash
- `sellTxHash` - Sell transaction hash (if closed)
- `status` - OPEN | CLOSED | PARTIAL

**Usage:**

```typescript
const position = B_Position.createFromBuy(
  orderId,
  token,
  0.00001, // buy price
  1000, // token amount
  "0x...", // tx hash
);

position.updatePrice(0.000015);
console.log(`P&L: ${position.getPnL()} BNB (${position.getPnLPercent()}%)`);

if (position.shouldTakeProfit(50)) {
  console.log("Take profit target hit!");
}
```

---

### 6. B_Trading (Static Utility)

**Purpose:** Buy/sell execution on PancakeSwap

**Key Methods:**

- `static buy(params)` - Buy tokens with BNB
- `static sell(params)` - Sell tokens for BNB
- `static getTokenPrice(tokenAddress, amount?)` - Get token price in BNB
- `static getBNBPrice()` - Get BNB price in USD
- `static estimateBuyGas(params)` - Estimate gas for buy
- `static estimateSellGas(params)` - Estimate gas for sell

**Buy Parameters:**

- `wallet` - B_Wallet instance
- `token` - B_Token instance
- `bnbAmount` - Amount of BNB to spend
- `slippage` - Slippage tolerance
- `gasPrice` - Gas price in gwei
- `gasLimit` - Gas limit (optional)

**Sell Parameters:**

- `wallet` - B_Wallet instance
- `token` - B_Token instance
- `tokenAmount` - Amount of tokens to sell
- `slippage` - Slippage tolerance
- `gasPrice` - Gas price in gwei
- `gasLimit` - Gas limit (optional)

**Usage:**

```typescript
// Buy tokens
const buyResult = await B_Trading.buy({
  wallet,
  token,
  bnbAmount: 0.01,
  slippage: 10,
  gasPrice: "5",
  gasLimit: 300000,
});

if (buyResult.success) {
  console.log(`Bought ${buyResult.tokenAmount} tokens`);
  console.log(`TX: ${buyResult.txHash}`);
}

// Sell tokens
const sellResult = await B_Trading.sell({
  wallet,
  token,
  tokenAmount: "1000",
  slippage: 10,
  gasPrice: "5",
});

if (sellResult.success) {
  console.log(`Got ${sellResult.bnbAmount} BNB`);
}
```

---

## Complete Trading Flow Example

```typescript
import {
  B_User,
  B_Wallet,
  B_Order,
  B_Token,
  B_Position,
  B_Trading,
} from "./core/classes";

// 1. Get or create user
const user = await B_User.getOrCreate(chatId, username, firstName, lastName);

// 2. Create wallet
const wallet = await B_Wallet.generate();
await wallet.updateBalance();

// 3. Create order
const order = await B_Order.create(user.id, wallet.id, {
  tradingAmount: 0.01,
  slippage: 10,
  takeProfitPercent: 50,
  stopLossPercent: 25,
});

// 4. Activate order
await order.activate();

// 5. Define token to buy
const token = new B_Token({
  address: "0x...",
  symbol: "TOKEN",
  decimals: 18,
});

// 6. Execute buy
const buyResult = await B_Trading.buy({
  wallet,
  token,
  bnbAmount: order.tradingAmount,
  slippage: order.slippage,
  gasPrice: order.gasFee.gasPrice,
});

if (buyResult.success) {
  // 7. Create position
  const position = B_Position.createFromBuy(
    order.id,
    token,
    parseFloat((await B_Trading.getTokenPrice(token.address)) || "0"),
    parseFloat(buyResult.tokenAmount || "0"),
    buyResult.txHash!,
  );

  // 8. Add position to order
  order.addPosition(position);

  // 9. Monitor position
  setInterval(async () => {
    const currentPrice = parseFloat(
      (await B_Trading.getTokenPrice(token.address)) || "0",
    );
    position.updatePrice(currentPrice);

    // Check TP
    if (
      order.takeProfitEnabled &&
      position.shouldTakeProfit(order.takeProfitPercent)
    ) {
      const sellResult = await B_Trading.sell({
        wallet,
        token,
        tokenAmount: position.amount.toString(),
        slippage: order.slippage,
        gasPrice: order.gasFee.gasPrice,
      });

      if (sellResult.success) {
        position.close(currentPrice, sellResult.txHash!);
        console.log("Take profit executed!");
      }
    }

    // Check SL
    if (
      order.stopLossEnabled &&
      position.shouldStopLoss(order.stopLossPercent)
    ) {
      const sellResult = await B_Trading.sell({
        wallet,
        token,
        tokenAmount: position.amount.toString(),
        slippage: order.slippage,
        gasPrice: order.gasFee.gasPrice,
      });

      if (sellResult.success) {
        position.close(currentPrice, sellResult.txHash!);
        console.log("Stop loss executed!");
      }
    }
  }, 5000); // Check every 5 seconds
}
```

---

## Benefits of OOP Architecture

1. **Separation of Concerns**
   - Business logic separated from database models
   - Handlers focus on UI, classes handle operations

2. **Performance**
   - In-memory position tracking (Map)
   - Efficient object reuse
   - Reduced database queries

3. **Maintainability**
   - Clear class responsibilities
   - Easy to extend functionality
   - Type-safe with TypeScript

4. **Testability**
   - Easy to unit test each class
   - Mock dependencies
   - Isolated business logic

5. **Scalability**
   - Supports multiple concurrent users
   - Efficient memory management
   - Clear data flow

---

## Next Steps for Integration

1. **Refactor Handlers**
   - Update `order.handler.ts` to use B_Order, B_Wallet
   - Update `wallet.handler.ts` to use B_Wallet
   - Replace direct database calls with class methods

2. **Create Position Storage**
   - Implement position persistence (database + in-memory)
   - Add position UI screens
   - Show P&L in real-time

3. **Build TP/SL Monitor**
   - Background service checking all open positions
   - Execute TP/SL trades automatically
   - Send Telegram notifications

4. **Token Scanner Integration**
   - Detect new pairs on PancakeSwap
   - Auto-buy with active orders
   - Position tracking for scanned tokens

5. **Performance Optimization**
   - Cache frequently accessed data
   - Batch database operations
   - Optimize blockchain queries

---

## File Structure

```
src/
├── core/
│   └── classes/
│       ├── index.ts              # Export all classes
│       ├── B_User.ts             # User management
│       ├── B_Wallet.ts           # Wallet operations
│       ├── B_Order.ts            # Order configuration
│       ├── B_Token.ts            # Token metadata
│       ├── B_Position.ts         # Position tracking
│       └── B_Trading.ts          # Buy/sell execution
├── bot/
│   └── handlers/
│       ├── order.handler.ts      # TO REFACTOR: Use B_Order, B_Position
│       └── wallet.handler.ts     # TO REFACTOR: Use B_Wallet
└── database/
    └── models/                   # Keep as database layer only
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│              Telegram Bot Handler               │
│         (order.handler.ts, wallet.handler.ts)   │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│          Business Logic Classes (OOP)           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ B_User   │  │ B_Wallet │  │ B_Order  │      │
│  └──────────┘  └──────────┘  └──────────┘      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ B_Token  │  │B_Position│  │B_Trading │      │
│  └──────────┘  └──────────┘  └──────────┘      │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│         Database Layer (MongoDB Models)          │
│    (User, Wallet, Order models remain same)     │
└─────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│        External Services (Blockchain)            │
│    (ethers.js, PancakeSwap, BSC RPC)           │
└─────────────────────────────────────────────────┘
```

---

## Conclusion

This OOP architecture provides:

- ✅ Clean separation of concerns
- ✅ High performance with multiple users
- ✅ Easy to maintain and extend
- ✅ Type-safe TypeScript implementation
- ✅ Professional code structure
- ✅ Ready for production scaling
