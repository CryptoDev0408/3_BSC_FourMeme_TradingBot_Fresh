# 🚀 FourMeme BSC Trading Bot

A high-performance, multi-wallet BSC trading bot with PancakeSwap V2 integration, automated TP/SL monitoring, and Four.meme migration token scanner.

## ✨ Features

### 💼 Wallet Management

- **Generate Wallets**: Create new BSC wallets instantly
- **Import Wallets**: Import existing wallets via private key
- **Multi-Wallet Support**: Manage multiple wallets per user
- **Balance Tracking**: Real-time BNB balance monitoring
- **Secure Withdrawals**: Transfer BNB to external addresses

### 📊 Order Management

- **Per-Wallet Orders**: Each wallet has configurable trading parameters
- **Trading Amount**: Set BNB amount for each trade
- **Take Profit**: Configurable TP percentage with ON/OFF toggle
- **Stop Loss**: Configurable SL percentage with ON/OFF toggle
- **Gas Configuration**: Customize gas price and limits
- **Manual Trading**: Direct token address input for instant buys
- **Order Toggle**: Activate/deactivate orders per wallet

### 💰 Position Management

- **Position Tracking**: Automatic tracking of all token purchases
- **Real-time PNL**: Live profit/loss calculations in BNB and USD
- **Manual Selling**: Sell positions at 25%, 50%, or 100%
- **TP/SL Monitoring**: Background service monitors and auto-executes
- **Position History**: Track all trades with transaction hashes

### 🔍 Auto Token Scanner

- **Four.meme Integration**: Monitors migration events in real-time
- **Auto-Buy Trigger**: Automatically executes orders on new token detection
- **Token Notifications**: Broadcasts new tokens to all active users
- **WebSocket Monitoring**: Reliable real-time blockchain monitoring

### ⚙️ Advanced Features

- **Multi-User Support**: Handles multiple users concurrently
- **High Performance**: Optimized for speed and reliability
- **Restart Resilience**: Continues TP/SL monitoring after restarts
- **Pretty Logging**: Color-coded console logs for easy debugging
- **Error Handling**: Comprehensive error handling throughout
- **Encrypted Storage**: Private keys encrypted with AES-256-GCM

## 📋 Prerequisites

- **Node.js**: v18.0.0 or higher
- **MongoDB**: v5.0 or higher
- **PM2**: v5.3.0 or higher (for production)
- **BSC RPC Access**: HTTP and WebSocket endpoints
- **Telegram Bot Token**: From [@BotFather](https://t.me/BotFather)

## 🛠️ Installation

### 1. Clone the repository

```bash
cd FourMeme_TradingBot
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

```bash
cp .env.example .env
nano .env
```

**Required Environment Variables:**

- `TELEGRAM_BOT_TOKEN`: Your Telegram bot token
- `TELEGRAM_ADMIN_CHAT_ID`: Your admin Telegram chat ID
- `BSC_RPC_HTTP_URL`: BSC HTTP RPC endpoint
- `BSC_RPC_WSS_URL`: BSC WebSocket RPC endpoint
- `MONGODB_URI`: MongoDB connection string
- `ENCRYPTION_KEY`: 32-character encryption key for private keys

### 4. Build the project

```bash
npm run build
```

## 🚀 Usage

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
# Start with PM2
npm run start:pm2

# View logs
npm run logs:pm2

# Restart bot
npm run restart:pm2

# Stop bot
npm run stop:pm2
```

## 📱 Telegram Bot Commands

### Main Commands

- `/start` - Start the bot and show main menu
- `/help` - Display help information

### Menu Navigation

- **💼 Wallets** - Wallet management interface
- **📊 Orders** - Order configuration interface
- **💰 Positions** - View and manage positions
- **⚙️ Settings** - Bot settings and preferences
- **📈 Scanner Status** - View Four.meme scanner status
- **ℹ️ Help** - Show help and documentation

## 🏗️ Architecture

```
FourMeme_TradingBot/
├── src/
│   ├── bot/                    # Telegram bot layer
│   │   ├── handlers/           # Command handlers
│   │   └── keyboards/          # UI keyboard layouts
│   ├── core/                   # Core business logic
│   │   ├── wallet/             # Wallet management
│   │   ├── order/              # Order execution
│   │   ├── position/           # Position tracking
│   │   └── swap/               # PancakeSwap integration
│   ├── scanner/                # Four.meme scanner
│   ├── database/               # MongoDB models
│   ├── utils/                  # Utilities
│   ├── config/                 # Configuration
│   └── index.ts                # Application entry
├── logs/                       # Application logs
├── .env                        # Environment variables
└── ecosystem.config.js         # PM2 configuration
```

## 🔒 Security

- **Private Key Encryption**: All private keys are encrypted using AES-256-GCM
- **Environment Variables**: Sensitive data stored in `.env` file
- **Input Validation**: All user inputs are validated and sanitized
- **Rate Limiting**: Per-user command rate limits prevent abuse
- **Transaction Verification**: Double confirmation for sensitive operations

## 📊 Database Schema

### User Collection

- Chat ID, username, settings
- Active wallet reference

### Wallet Collection

- Encrypted private keys
- Balance cache
- Wallet metadata

### Order Collection

- Trading parameters per wallet
- TP/SL configuration
- Gas settings

### Position Collection

- Token purchase details
- Real-time PNL tracking
- TP/SL targets

### Transaction Collection

- Complete transaction history
- Status tracking
- Error logging

## 🐛 Troubleshooting

### Bot not responding

1. Check Telegram bot token in `.env`
2. Verify bot is running: `pm2 status`
3. Check logs: `npm run logs:pm2`

### Transactions failing

1. Verify BSC RPC endpoints are working
2. Check wallet has sufficient BNB for gas
3. Increase gas price in settings
4. Check slippage tolerance

### Scanner not detecting tokens

1. Verify WebSocket RPC is connected
2. Check Four.meme factory address
3. Ensure `SCANNER_ENABLED=true` in `.env`
4. Review scanner logs

### Database connection errors

1. Verify MongoDB is running
2. Check `MONGODB_URI` in `.env`
3. Ensure network connectivity

## 📝 Logs

Logs are stored in the `logs/` directory:

- `error.log` - Error logs only
- `output.log` - Standard output
- `combined.log` - All logs combined

View logs in real-time:

```bash
npm run logs:pm2
# or
tail -f logs/combined.log
```

## ⚡ Performance Tips

1. **Use reliable RPC endpoints** for better transaction speed
2. **Enable caching** for price and balance data
3. **Adjust monitoring interval** based on your needs
4. **Use performance mode** for production environments
5. **Monitor memory usage** with PM2 dashboard

## 🤝 Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a pull request

## 📄 License

This project is licensed under the MIT License.

## ⚠️ Disclaimer

This bot is for educational purposes only. Trading cryptocurrencies carries risk. Always do your own research and never invest more than you can afford to lose. The developers are not responsible for any financial losses incurred while using this bot.

## 🆘 Support

For issues, questions, or feature requests:

1. Check existing documentation
2. Review troubleshooting section
3. Search closed issues on GitHub
4. Open a new issue with detailed information

## 🔄 Updates

- **v1.0.0** - Initial release with core features
  - Multi-wallet management
  - PancakeSwap V2 integration
  - TP/SL monitoring
  - Four.meme scanner
  - Telegram bot interface

---

**Built with ❤️ for the BSC trading community**
