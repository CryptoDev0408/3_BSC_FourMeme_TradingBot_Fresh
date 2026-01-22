# 🎮 Orders UI - Button Callback Reference

Quick reference for all button callbacks in the Orders UI.

---

## 📊 Orders List Screen

| Button Text         | Callback Data          | Action              |
| ------------------- | ---------------------- | ------------------- |
| Order #1 - 0.05 BNB | `order_view_{orderId}` | Show order detail   |
| Order #2 - 0.1 BNB  | `order_view_{orderId}` | Show order detail   |
| ➕ Create New Order | `order_create`         | Create new order    |
| 🏠 Main Menu        | `main_menu`            | Return to main menu |

---

## 📋 Order Detail Screen

| Button Text       | Callback Data              | Action                   |
| ----------------- | -------------------------- | ------------------------ |
| ▶️ Activate Order | `order_toggle_{orderId}`   | Activate order           |
| ⏸ Pause Order     | `order_toggle_{orderId}`   | Pause order              |
| 💼 Change Wallet  | `order_wallet_{orderId}`   | Show wallet selection    |
| 💰 Set Amount     | `order_amount_{orderId}`   | Show amount selection    |
| 🎯 TP/SL Settings | `order_tpsl_{orderId}`     | Show TP/SL settings      |
| ⚡ Gas Settings   | `order_gas_{orderId}`      | Show gas settings        |
| 📊 Slippage       | `order_slippage_{orderId}` | Show slippage selection  |
| 🪙 Manual Buy     | `order_manual_{orderId}`   | Show manual buy prompt   |
| 🗑 Remove Order   | `order_remove_{orderId}`   | Show remove confirmation |
| 💨 Back to Orders | `orders`                   | Return to orders list    |

---

## 💼 Wallet Selection Screen

| Button Text           | Callback Data                          | Action                 |
| --------------------- | -------------------------------------- | ---------------------- |
| ✅ w1 (0x742d...5bEb) | `order_setwallet_{orderId}_{walletId}` | Set wallet for order   |
| ⚪️ w2 (0x8c3a...2f9d) | `order_setwallet_{orderId}_{walletId}` | Set wallet for order   |
| ❌ Cancel             | `order_view_{orderId}`                 | Return to order detail |

---

## 💰 Amount Selection Screen

| Button Text      | Callback Data                    | Action                  |
| ---------------- | -------------------------------- | ----------------------- |
| 0.01 BNB         | `order_setamount_{orderId}_0.01` | Set amount to 0.01      |
| 0.05 BNB         | `order_setamount_{orderId}_0.05` | Set amount to 0.05      |
| 0.1 BNB          | `order_setamount_{orderId}_0.1`  | Set amount to 0.1       |
| 0.5 BNB          | `order_setamount_{orderId}_0.5`  | Set amount to 0.5       |
| 1 BNB            | `order_setamount_{orderId}_1`    | Set amount to 1         |
| 5 BNB            | `order_setamount_{orderId}_5`    | Set amount to 5         |
| ✏️ Custom Amount | `order_customamount_{orderId}`   | Prompt for custom input |
| ❌ Cancel        | `order_view_{orderId}`           | Return to order detail  |

---

## 🎯 TP/SL Settings Screen

| Button Text          | Callback Data              | Action                   |
| -------------------- | -------------------------- | ------------------------ |
| 🎯 Set Take Profit % | `order_tp_{orderId}`       | Prompt for TP percentage |
| 🛑 Set Stop Loss %   | `order_sl_{orderId}`       | Prompt for SL percentage |
| ✅ Toggle TP On/Off  | `order_tptoggle_{orderId}` | Toggle TP enabled        |
| ✅ Toggle SL On/Off  | `order_sltoggle_{orderId}` | Toggle SL enabled        |
| 💨 Back              | `order_view_{orderId}`     | Return to order detail   |

---

## ⚡ Gas Settings Screen

| Button Text        | Callback Data               | Action                 |
| ------------------ | --------------------------- | ---------------------- |
| 🐢 Slow (3 Gwei)   | `order_setgas_{orderId}_3`  | Set gas to 3 Gwei      |
| 🚶 Normal (5 Gwei) | `order_setgas_{orderId}_5`  | Set gas to 5 Gwei      |
| 🏃 Fast (10 Gwei)  | `order_setgas_{orderId}_10` | Set gas to 10 Gwei     |
| 🚀 Turbo (20 Gwei) | `order_setgas_{orderId}_20` | Set gas to 20 Gwei     |
| ✏️ Custom Gas      | `order_customgas_{orderId}` | Prompt for custom gas  |
| 💨 Back            | `order_view_{orderId}`      | Return to order detail |

---

## 📊 Slippage Settings Screen

| Button Text        | Callback Data                    | Action                     |
| ------------------ | -------------------------------- | -------------------------- |
| 1%                 | `order_setslippage_{orderId}_1`  | Set slippage to 1%         |
| 5%                 | `order_setslippage_{orderId}_5`  | Set slippage to 5%         |
| 10%                | `order_setslippage_{orderId}_10` | Set slippage to 10%        |
| 15%                | `order_setslippage_{orderId}_15` | Set slippage to 15%        |
| 20%                | `order_setslippage_{orderId}_20` | Set slippage to 20%        |
| 25%                | `order_setslippage_{orderId}_25` | Set slippage to 25%        |
| ✏️ Custom Slippage | `order_customslippage_{orderId}` | Prompt for custom slippage |
| 💨 Back            | `order_view_{orderId}`           | Return to order detail     |

---

## 🗑 Remove Confirmation Screen

| Button Text    | Callback Data                    | Action                 |
| -------------- | -------------------------------- | ---------------------- |
| ✅ Yes, Remove | `order_remove_confirm_{orderId}` | Delete order from DB   |
| ❌ Cancel      | `order_view_{orderId}`           | Return to order detail |

---

## 🪙 Manual Buy Screen

| Button Text | Callback Data          | Action                 |
| ----------- | ---------------------- | ---------------------- |
| ❌ Cancel   | `order_view_{orderId}` | Return to order detail |

**Text Input:**

- User sends token address as text message
- Handler: `handleOrderTextMessage()`
- State: `{ action: 'manual_buy', orderId: orderId }`

---

## 🔄 Handler Function Mapping

### Main Handlers:

```typescript
// Orders List
'orders' → showOrdersList()

// Order CRUD
'order_create' → handleOrderCreate()
'order_view_{id}' → showOrderDetail()
'order_toggle_{id}' → handleOrderToggle()
'order_remove_{id}' → handleOrderRemove()
'order_remove_confirm_{id}' → confirmOrderRemove()

// Wallet Management
'order_wallet_{id}' → handleOrderWalletSelection()
'order_setwallet_{id}_{walletId}' → handleOrderSetWallet()

// Amount Management
'order_amount_{id}' → showAmountSelection()
'order_setamount_{id}_{amount}' → handleOrderSetAmount()

// TP/SL Management
'order_tpsl_{id}' → showTPSLSettings()
'order_tptoggle_{id}' → toggleTPEnabled()
'order_sltoggle_{id}' → toggleSLEnabled()

// Gas Management
'order_gas_{id}' → showGasSettings()
'order_setgas_{id}_{price}' → handleOrderSetGas()

// Slippage Management
'order_slippage_{id}' → showSlippageSelection()
'order_setslippage_{id}_{percent}' → handleOrderSetSlippage()

// Manual Buy
'order_manual_{id}' → handleManualBuy()
```

---

## 💾 Database Operations by Action

| Action        | Database Operation | Collection              | Fields Updated                   |
| ------------- | ------------------ | ----------------------- | -------------------------------- |
| Create Order  | INSERT             | orders                  | All fields                       |
| Toggle Status | UPDATE             | orders                  | `isActive`, `updatedAt`          |
| Change Wallet | UPDATE             | orders                  | `walletId`, `updatedAt`          |
| Set Amount    | UPDATE             | orders                  | `tradingAmount`, `updatedAt`     |
| Toggle TP     | UPDATE             | orders                  | `takeProfitEnabled`, `updatedAt` |
| Toggle SL     | UPDATE             | orders                  | `stopLossEnabled`, `updatedAt`   |
| Set Gas       | UPDATE             | orders                  | `gasFee.gasPrice`, `updatedAt`   |
| Set Slippage  | UPDATE             | orders                  | `slippage`, `updatedAt`          |
| Remove Order  | DELETE             | orders                  | Entire document                  |
| Manual Buy    | INSERT             | positions, transactions | Creates position and transaction |

---

## 🎯 Validation Rules

### Amount:

- Min: 0.001 BNB
- Max: User configurable (default: 10 BNB)
- Format: Number with up to 8 decimals

### Take Profit:

- Min: 0%
- Max: 10000%
- Format: Integer or decimal

### Stop Loss:

- Min: 0%
- Max: 100%
- Format: Integer or decimal

### Gas Price:

- Min: 1 Gwei
- Max: 100 Gwei
- Format: String representing Gwei

### Slippage:

- Min: 0.1%
- Max: 50%
- Format: Decimal number

### Token Address:

- Format: Valid Ethereum address (0x + 40 hex chars)
- Validation: `ethers.utils.isAddress()`

---

## 🔍 Query Examples

### Get Orders for User:

```javascript
db.orders
  .find({
    userId: ObjectId("user_123"),
  })
  .populate("walletId")
  .sort({ createdAt: -1 });
```

### Get Active Orders:

```javascript
db.orders.find({
  userId: ObjectId("user_123"),
  isActive: true,
});
```

### Get Order by ID:

```javascript
db.orders
  .findOne({
    _id: ObjectId("order_001"),
    userId: ObjectId("user_123"),
  })
  .populate("walletId");
```

### Update Order Amount:

```javascript
db.orders.updateOne(
  {
    _id: ObjectId("order_001"),
    userId: ObjectId("user_123"),
  },
  {
    $set: {
      tradingAmount: 0.25,
      updatedAt: new Date(),
    },
  },
);
```

---

## 🚀 Performance Considerations

### Indexed Fields:

- `userId` - For fast user queries
- `walletId` - For wallet-based lookups
- `isActive` - For active order filtering
- `createdAt` - For sorting

### Pagination:

- Orders list shows all orders (no pagination currently)
- Consider pagination if user has >20 orders

### Caching:

- Order details cached per user
- Wallet list cached (5-minute TTL)
- Balance updates on-demand

---

This reference guide covers all button callbacks and their corresponding actions in the Orders UI!
