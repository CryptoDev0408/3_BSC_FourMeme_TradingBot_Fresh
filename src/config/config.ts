import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Application Configuration
 */
export const config = {
	// Telegram
	telegram: {
		botToken: process.env.TELEGRAM_BOT_TOKEN || '',
		adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID || '',
	},

	// BSC Network
	bsc: {
		rpcHttpUrl: process.env.BSC_RPC_HTTP_URL || 'https://bsc-dataseed1.binance.org',
		rpcWssUrl: process.env.BSC_RPC_WSS_URL || 'wss://bsc-ws-node.nariox.org:443',
	},

	// Database
	database: {
		uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/fourmeme_trading_bot',
	},

	// Security
	security: {
		encryptionKey: process.env.ENCRYPTION_KEY || '',
	},

	// Trading
	trading: {
		defaultSlippage: parseFloat(process.env.DEFAULT_SLIPPAGE || '1.0'),
		defaultGasPrice: process.env.DEFAULT_GAS_PRICE || '5',
		minBnbBalance: parseFloat(process.env.MIN_BNB_BALANCE || '0.001'),
		maxBnbPerTrade: parseFloat(process.env.MAX_BNB_PER_TRADE || '10'),
	},

	// Monitoring
	monitoring: {
		positionMonitorInterval: parseInt(process.env.POSITION_MONITOR_INTERVAL || '10000', 10), // Legacy TP/SL monitor
		pnlMonitorInterval: parseInt(process.env.PNL_MONITOR_INTERVAL || '2000', 10), // New PNL engine (default 2 seconds)
		scannerEnabled: process.env.SCANNER_ENABLED === 'true',
	},

	// Logging
	logging: {
		level: process.env.LOG_LEVEL || 'info',
		toFile: process.env.LOG_TO_FILE === 'true',
	},

	// Performance
	performance: {
		mode: process.env.PERFORMANCE_MODE === 'true',
	},
};

/**
 * Validate required environment variables
 */
export function validateConfig(): { valid: boolean; errors: string[] } {
	const errors: string[] = [];

	if (!config.telegram.botToken) {
		errors.push('TELEGRAM_BOT_TOKEN is required');
	}

	if (!config.security.encryptionKey || config.security.encryptionKey.length < 32) {
		errors.push('ENCRYPTION_KEY must be at least 32 characters');
	}

	if (!config.database.uri) {
		errors.push('MONGODB_URI is required');
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}
