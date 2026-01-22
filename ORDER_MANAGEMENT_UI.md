# 📊 Order Management UI - Complete Documentation

## Overview

The Order Management system provides a comprehensive interface for configuring and executing trading orders through Telegram. Each order is associated with a wallet and contains all trading parameters.

---

## 📋 Main Screens

### 1. **Orders List Screen**

**Trigger**: User clicks "📊 Orders" button from main menu

**Display**:

```
📊 Your Orders

You have 3 order(s):

🟢 Active Order #1
💼 Wallet: w1
💰 Amount: 0.05 BNB
📊 Slippage: 10%

🔴 Inactive Order #2
💼 Wallet: w2
💰 Amount: 0.10 BNB
📊 Slippage: 5%

🟢 Active Order #3
💼 Wallet: w1
💰 Amount: 0.01 BNB
📊 Slippage: 15%
```

**Buttons (2 per row)**:

- `[🟢 Order #1 - 0.05 BNB] [🔴 Order #2 - 0.1 BNB]`
- `[🟢 Order #3 - 0.01 BNB]`
- `[➕ Create New Order]`
- `[🏠 Main Menu]`

**Empty State**:

```
📊 Your Orders

📭 You don't have any orders yet.

Create your first order to start trading!
```

---

### 2. **Order Detail Screen**

**Trigger**: User clicks on an order from the list

**Display**:

```
📊 Order #1

Status: 🟢 Active

Configuration:
💼 Wallet: w1 (0x742d...5bEb)
💰 Trading Amount: 0.05 BNB
📊 Slippage: 10%

Take Profit:
🎯 Target: 50%
Status: ✅ Enabled

Stop Loss:
🛑 Target: 25%
Status: ✅ Enabled

Gas Settings:
⚡ Price: 5 Gwei
⚙️ Limit: 300000
```

**Buttons**:

- `[▶️ Activate Order]` or `[⏸ Pause Order]` (toggles based on status)
- `[💼 Change Wallet] [💰 Set Amount]`
- `[🎯 TP/SL Settings] [⚡ Gas Settings]`
- `[📊 Slippage] [🪙 Manual Buy]`
- `[🗑 Remove Order]`
- `[🛡️ Back to Orders]`

---

### 3. **Wallet Selection Screen**

**Trigger**: User clicks "💼 Change Wallet" in order detail

**Display**:

```
💼 Select Wallet for Order

Choose which wallet to use for this order:
```

**Buttons (1 per row)**:

- `[✅ w1 (0x742d...5bEb)]` - Currently selected
- `[⚪️ w2 (0x8c3a...2f9d)]`
- `[⚪️ w3 (0x9d4b...1e8c)]`
- `[❌ Cancel]`

---

### 4. **Trading Amount Selection**

**Trigger**: User clicks "💰 Set Amount" in order detail

**Display**:

```
💰 Set Trading Amount

Select an amount or enter a custom value:
```

**Buttons**:

- `[0.01 BNB] [0.05 BNB]`
- `[0.1 BNB] [0.5 BNB]`
- `[1 BNB] [5 BNB]`
- `[✏️ Custom Amount]`
- `[❌ Cancel]`

**Custom Flow**:
If user clicks "✏️ Custom Amount", bot prompts:

```
💰 Enter Custom Amount

Please enter the BNB amount you want to trade:

Example: 0.25
```

User enters: `0.25`
Bot validates and updates order.

---

### 5. **TP/SL Settings Screen**

**Trigger**: User clicks "🎯 TP/SL Settings" in order detail

**Display**:

```
🎯 Take Profit / Stop Loss Settings

Take Profit:
Target: 50%
Status: ✅ Enabled

Stop Loss:
Target: 25%
Status: ✅ Enabled
```

**Buttons**:

- `[🎯 Set Take Profit %] [🛑 Set Stop Loss %]`
- `[✅ Toggle TP On/Off] [✅ Toggle SL On/Off]`
- `[🛡️ Back]`

**Custom Percentage Flow**:
When user clicks "Set Take Profit %":

```
🎯 Set Take Profit Percentage

Enter the profit percentage at which to automatically sell:

Example: 100 (for 100% profit)
```

User enters: `100`
Bot validates (0-10000%) and updates.

---

### 6. **Gas Settings Screen**

**Trigger**: User clicks "⚡ Gas Settings" in order detail

**Display**:

```
⚡ Gas Settings

Select gas price for transactions:
```

**Buttons**:

- `[🐢 Slow (3 Gwei)] [🚶 Normal (5 Gwei)]`
- `[🏃 Fast (10 Gwei)] [🚀 Turbo (20 Gwei)]`
- `[✏️ Custom Gas]`
- `[🛡️ Back]`

**Custom Gas Flow**:
If user clicks "✏️ Custom Gas":

```
⚡ Enter Custom Gas Price

Enter gas price in Gwei:

Example: 7
```

User enters: `7`
Bot validates (1-100 Gwei) and updates.

---

### 7. **Slippage Settings Screen**

**Trigger**: User clicks "📊 Slippage" in order detail

**Display**:

```
📊 Slippage Tolerance

Select slippage percentage:
```

**Buttons**:

- `[1%] [5%] [10%]`
- `[15%] [20%] [25%]`
- `[✏️ Custom Slippage]`
- `[🛡️ Back]`

**Custom Slippage Flow**:

```
📊 Enter Custom Slippage

Enter slippage tolerance (0.1-50%):

Example: 12.5
```

User enters: `12.5`
Bot validates (0.1-50%) and updates.

---

### 8. **Manual Buy Screen**

**Trigger**: User clicks "🪙 Manual Buy" in order detail

**Display**:

```
🪙 Manual Token Buy

Enter the token contract address you want to buy:

Example: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
```

**Buttons**:

- `[❌ Cancel]`

**User Flow**:

1. User enters token address: `0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb`
2. Bot validates address
3. Bot checks order status (must be active)
4. Bot checks wallet balance
5. Bot validates order execution parameters
6. Bot executes buy order

**Loading Message**:

```
⏳ Executing buy order...

Please wait...
```

**Success Response**:

```
✅ Buy Successful!

Token: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
TX: 0xabc123...def456

View on BSCScan:
https://bscscan.com/tx/0xabc123...def456
```

**Error Response**:

```
❌ Buy failed:

Insufficient balance. Required: 0.05 BNB, Available: 0.02 BNB
```

---

### 9. **Remove Order Confirmation**

**Trigger**: User clicks "🗑 Remove Order" in order detail

**Display**:

```
🗑 Remove Order

⚠️ Are you sure you want to remove this order?

This action cannot be undone.
```

**Buttons**:

- `[✅ Yes, Remove] [❌ Cancel]`

**After Confirmation**:

```
✅ Order removed successfully!
```

Then shows orders list.

---

## 🔄 Interactive Workflows

### **Complete Order Creation Flow**

1. **User Action**: Clicks "📊 Orders" from main menu
2. **Bot**: Shows orders list
3. **User Action**: Clicks "➕ Create New Order"
4. **Bot**: Creates order with default settings using active wallet
5. **Bot**: Shows success message and order detail screen
6. **User Action**: Configures order parameters (amount, TP/SL, gas, slippage)
7. **User Action**: Clicks "▶️ Activate Order"
8. **Bot**: Order is now active and ready to trade

### **Manual Buy Flow**

1. **User Action**: Opens active order detail
2. **User Action**: Clicks "🪙 Manual Buy"
3. **Bot**: Prompts for token address
4. **User Action**: Sends token address
5. **Bot**: Validates address and order parameters
6. **Bot**: Updates wallet balance from blockchain
7. **Bot**: Executes buy transaction on PancakeSwap
8. **Bot**: Creates position entry in database
9. **Bot**: Creates transaction log
10. **Bot**: Shows success message with TX hash and BSCScan link

### **Toggle Order Status Flow**

1. **User Action**: Opens order detail
2. **Bot**: Shows current status (Active or Inactive)
3. **User Action**: Clicks toggle button
4. **Bot**: Updates order status in database
5. **Bot**: Shows callback notification "Order activated!" or "Order paused!"
6. **Bot**: Refreshes order detail screen with new status

---

## 🎯 Key Features

### **Multi-Step Input Handling**

- Bot maintains user state between messages
- Custom amount/percentage/gas inputs validated before saving
- State cleared on cancel or main menu navigation

### **Real-Time Validation**

- Token addresses validated before buy
- Balance checked before execution
- Order parameters validated against limits
- Gas price validated (1-100 Gwei)
- Slippage validated (0.1-50%)
- Amount validated (min 0.001 BNB)

### **Smart Defaults**

- New orders use active wallet
- Default trading amount: 0.01 BNB
- Default TP: 50%
- Default SL: 25%
- Default slippage: 10%
- Default gas: 5 Gwei

### **Error Handling**

- Clear error messages for all failures
- Validation errors shown before execution
- Transaction errors logged to database
- User-friendly error descriptions

---

## 💡 Usage Tips

### **For New Users**:

1. Create a wallet first (💼 Wallets)
2. Deposit BNB to wallet
3. Create an order (📊 Orders → ➕ Create New Order)
4. Configure settings (amount, TP/SL)
5. Activate order
6. Use Manual Buy or wait for scanner alerts

### **For Active Trading**:

- Keep multiple orders with different wallets
- Adjust slippage based on token liquidity
- Use higher gas for faster execution on new tokens
- Monitor positions regularly
- Adjust TP/SL based on market conditions

---

## 🔐 Security Features

- Private keys never displayed in order screens
- Encrypted storage for all sensitive data
- User-isolated orders (can't access other users' orders)
- Validation before every transaction
- Balance checks prevent overdraft
- Transaction logging for audit trail

---

## 📊 Database Integration

Each order creates/updates:

- **Order Record**: All configuration parameters
- **Position Record**: On successful buy
- **Transaction Record**: For every buy attempt (success or failure)
- **Wallet Balance**: Updated before execution

---

This completes the Order Management UI documentation! The system provides a fully-featured trading interface with comprehensive validation, error handling, and user-friendly workflows.
