# 🚀 Multiple TP/SL - Quick Start Guide

This guide shows you how to use the new Multiple Take Profit and Stop Loss feature.

---

## 📋 What's New?

Instead of one Take Profit and one Stop Loss, you can now set **multiple levels** with **partial sells**.

**Example:**

- **TP1:** Sell 33% at +20% profit
- **TP2:** Sell 50% (of remaining) at +50% profit
- **TP3:** Sell 100% (of remaining) at +100% profit

This lets you lock in profits gradually instead of all-or-nothing!

---

## 🎯 Step-by-Step Usage

### 1. Create an Order

Open bot and create a new order as usual:

```
/start → Orders → New Order → Select Token
```

### 2. Configure TP/SL Levels

In the order configuration menu:

1. Tap **"TP/SL Settings"**
2. You'll see the default setup:

   ```
   Take Profit Levels:
   TP1: +50% → Sell 100%

   Stop Loss Levels:
   SL1: -30% → Sell 100%
   ```

### 3. Add More Levels

**To add Take Profit level:**

1. Tap **"➕ Add TP"**
2. Enter PNL percentage (e.g., `20` for +20%)
3. Enter sell percentage (e.g., `33` to sell 33%)
4. Done! ✅

**To add Stop Loss level:**

1. Tap **"➕ Add SL"**
2. Enter loss percentage (e.g., `20` for -20%)
3. Enter sell percentage (e.g., `50` to sell 50%)
4. Done! ✅

### 4. Edit Existing Levels

1. Tap on any level (e.g., **"✏️ TP1"**)
2. Enter new PNL percentage
3. Enter new sell percentage
4. Done! ✅

### 5. Delete Levels

1. Tap on any level
2. Tap **"🗑 Delete"**
3. Confirm
4. The last level will automatically adjust to 100% ✅

### 6. Execute the Order

1. Configure your TP/SL levels
2. Set other order parameters (slippage, gas, etc.)
3. Execute manual buy as usual
4. Done! Your position now has multiple TP/SL levels 🎉

---

## 📊 Monitoring Your Position

### Position List View

When you open your positions list, you'll see:

```
🟢 Position #1 - $TOKEN
PNL: +35% | ✅TP1/3
```

This means:

- Current profit: +35%
- TP level 1 out of 3 has been triggered

### Position Detail View

Tap on a position to see details:

```
🎯 Take Profit Levels
✅ TP1: +20% → Sell 33%  (TRIGGERED!)
⏳ TP2: +50% → Sell 50%  (Pending...)
⏳ TP3: +100% → Sell 100% (Pending...)

🛡️ Stop Loss Levels
⏳ SL1: -20% → Sell 50%  (Pending...)
⏳ SL2: -40% → Sell 100% (Pending...)
```

- ✅ = Already triggered (sold)
- ⏳ = Waiting for price to reach target

---

## 💡 Pro Tips

### 1. **Gradual Profit Taking**

Instead of selling everything at +50%, spread it out:

```
TP1: +25% → Sell 20%  (take initial profit)
TP2: +50% → Sell 30%  (lock in more)
TP3: +100% → Sell 50% (ride the moon)
```

### 2. **Risk Management**

Set multiple stop losses to limit damage:

```
SL1: -15% → Sell 30%  (warning sign)
SL2: -30% → Sell 70%  (cut losses)
SL3: -50% → Sell 100% (emergency exit)
```

### 3. **Last Level Must Be 100%**

The bot automatically ensures your last level sells everything:

- This prevents "stuck" positions
- You can't leave a position partially open

### 4. **Independent Positions**

Once you execute an order:

- The position copies your TP/SL levels
- Changing the order won't affect existing positions
- Each position tracks its own levels

---

## ❓ FAQs

**Q: What happens if I have 3 TP levels and price hits TP2 directly?**  
A: Only TP2 triggers. The bot checks levels sequentially and won't trigger TP1 if it was skipped.

**Q: Can I edit levels on an existing position?**  
A: No, positions are independent. You'd need to close it and create a new one.

**Q: What if price drops after TP1 triggers?**  
A: Your TP1 sale is complete and locked in. The remaining tokens stay in the position and continue monitoring TP2/TP3.

**Q: Does this work with Stop Loss too?**  
A: Yes! You can set multiple SL levels just like TP levels.

**Q: What happens when all levels trigger?**  
A: The position closes automatically and moves to your history.

**Q: Can I have different numbers of TP and SL levels?**  
A: Yes! You can have 3 TP levels and 2 SL levels, or any combination.

**Q: Will my old positions still work?**  
A: Yes! Old positions use the legacy single TP/SL system and work as before.

---

## 🎓 Example Scenarios

### Scenario 1: Conservative Trader

**Setup:**

```
TP1: +20% → Sell 50%  (secure profits early)
TP2: +40% → Sell 50%  (double up)
SL1: -15% → Sell 100% (tight stop)
```

**What happens:**

- Token pumps +25% → TP1 triggers, sells half
- Token continues to +45% → TP2 triggers, sells rest
- You locked in profits at +20% and +40% ✅

### Scenario 2: Moonshooter

**Setup:**

```
TP1: +50% → Sell 20%  (small trim)
TP2: +100% → Sell 30% (moderate trim)
TP3: +300% → Sell 50% (let it ride!)
SL1: -50% → Sell 100% (wide stop)
```

**What happens:**

- Token moons +150% → TP1 and TP2 trigger
- 50% of tokens sold at good prices
- Still holding 50% for potential +300%
- If it dumps, you already secured profits ✅

### Scenario 3: Scalper

**Setup:**

```
TP1: +5% → Sell 100%   (quick flip)
SL1: -3% → Sell 100%   (tight stop)
```

**What happens:**

- Token moves +6% → TP1 triggers, full exit
- Fast profit, move to next trade ✅

---

## 🆘 Troubleshooting

**Issue:** Can't add more levels  
**Solution:** Check if you have 10+ levels already (system limit)

**Issue:** Level says "triggered" but I didn't get notification  
**Solution:** Check your Telegram notification settings

**Issue:** Position still open after TP3 (100%)  
**Solution:** Small rounding issue - manually close it or wait for next sell

**Issue:** Don't see ✅ icon in position  
**Solution:** Refresh the position detail view

**Issue:** Want to change levels on existing position  
**Solution:** Not possible - positions are independent. Close and recreate.

---

## 📞 Support

If you encounter issues:

1. Check the bot logs in `/logs/` directory
2. Review the technical documentation in `IMPLEMENTATION_COMPLETE.md`
3. Contact support with screenshots of the issue

---

**Happy Trading! 🚀📈**

Remember: Multiple TP/SL levels help you manage risk and maximize profits by taking action at different price points instead of all-or-nothing exits.
