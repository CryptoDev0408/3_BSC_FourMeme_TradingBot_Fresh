/**
 * Application-wide constants
 * These are static values that don't change per deployment
 */

// ==============================================
// BSC NETWORK CONSTANTS
// ==============================================
export const BSC_CHAIN_ID = 56;
export const BSC_CHAIN_NAME = 'BSC';

// ==============================================
// PANCAKESWAP V2 CONSTANTS
// ==============================================
export const PANCAKE_ROUTER_ADDRESS = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
export const PANCAKE_FACTORY_ADDRESS = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';

// ==============================================
// TOKEN ADDRESSES
// ==============================================
export const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

// ==============================================
// FOUR.MEME CONSTANTS
// ==============================================
export const FOUR_MEME_FACTORY_ADDRESS = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';
export const FOUR_MEME_ADD_LIQUIDITY_METHOD_ID = '0xe3412e3d';

// ==============================================
// GAS CONFIGURATION
// ==============================================
export const DEFAULT_GAS_LIMIT = 300000;
export const APPROVAL_GAS_LIMIT = 100000;
export const TRANSFER_GAS_LIMIT = 50000;

// ==============================================
// TRADING LIMITS
// ==============================================
export const MIN_SLIPPAGE = 0.1;
export const MAX_SLIPPAGE = 50;
export const MIN_TRADE_AMOUNT = 0.001; // BNB
export const MAX_POSITIONS_PER_USER = 50;

// ==============================================
// MONITORING INTERVALS
// ==============================================
export const PRICE_CACHE_TTL = 300; // 5 minutes in seconds
export const BALANCE_CACHE_TTL = 60; // 1 minute in seconds
export const MAX_CONCURRENT_TX = 3;
export const TX_RETRY_ATTEMPTS = 3;
export const TX_RETRY_DELAY = 5000; // milliseconds
export const TX_TIMEOUT = 60000; // 60 seconds

// ==============================================
// API ENDPOINTS
// ==============================================
export const DEXSCREENER_API_URL = 'https://api.dexscreener.com/latest/dex';
export const API_TIMEOUT = 5000; // milliseconds

// ==============================================
// UI CONSTANTS
// ==============================================
export const POSITIONS_PER_PAGE = 5;
export const WALLETS_PER_PAGE = 5;
export const MAX_WALLET_NAME_LENGTH = 20;

// ==============================================
// POSITION STATUS
// ==============================================
export enum PositionStatus {
	ACTIVE = 'ACTIVE',
	SOLD = 'SOLD',
	FAILED = 'FAILED',
}

// ==============================================
// TRANSACTION TYPES
// ==============================================
export enum TransactionType {
	BUY = 'BUY',
	SELL = 'SELL',
	TRANSFER = 'TRANSFER',
	WITHDRAW = 'WITHDRAW',
}

// ==============================================
// TRANSACTION STATUS
// ==============================================
export enum TransactionStatus {
	PENDING = 'PENDING',
	SUCCESS = 'SUCCESS',
	FAILED = 'FAILED',
}

// ==============================================
// BOT MESSAGES
// ==============================================
export const WELCOME_MESSAGE = `
🚀 <b>Welcome to FourMeme Trading Bot!</b>

Your professional BSC trading assistant for PancakeSwap V2. Trade smarter with multi-wallet management, automated TP/SL, and Four.meme token scanner. Get started by creating or importing a wallet!

<i>⚡ Choose an option below to begin trading!</i>
`;

export const HELP_MESSAGE = `
📚 <b>Bot Commands & Features</b>

<b>💼 Wallet Management:</b>
• Generate new wallets
• Import existing wallets
• View balances
• Withdraw BNB

<b>📊 Order Configuration:</b>
• Set trading amount per wallet
• Configure Take Profit %
• Configure Stop Loss %
• Manual token buying

<b>💰 Position Tracking:</b>
• View all active positions
• Real-time PNL updates
• Manual selling (25%/50%/100%)
• Auto TP/SL execution

<b>🔍 Token Scanner:</b>
• Monitors Four.meme migrations
• Auto-buy on new tokens
• Token alerts

Need help? Contact admin!
`;

// ==============================================
// ERROR MESSAGES
// ==============================================
export const ERROR_MESSAGES = {
	INVALID_ADDRESS: '❌ Invalid wallet address',
	INVALID_PRIVATE_KEY: '❌ Invalid private key',
	INSUFFICIENT_BALANCE: '❌ Insufficient BNB balance',
	INSUFFICIENT_GAS: '❌ Insufficient BNB for gas fees',
	TX_FAILED: '❌ Transaction failed',
	TOKEN_NOT_FOUND: '❌ Token not found',
	NO_LIQUIDITY: '❌ No liquidity available',
	SLIPPAGE_TOO_HIGH: '❌ Price slippage too high',
	NO_ACTIVE_WALLET: '❌ No active wallet. Please create or import one first',
	NO_POSITIONS: '📊 No positions found',
	DATABASE_ERROR: '❌ Database error occurred',
	NETWORK_ERROR: '❌ Network error. Please try again',
	ALREADY_EXISTS: '❌ Already exists',
	NOT_FOUND: '❌ Not found',
	INVALID_INPUT: '❌ Invalid input',
};

// ==============================================
// SUCCESS MESSAGES
// ==============================================
export const SUCCESS_MESSAGES = {
	WALLET_CREATED: '✅ Wallet created successfully',
	WALLET_IMPORTED: '✅ Wallet imported successfully',
	WALLET_REMOVED: '✅ Wallet removed successfully',
	ORDER_UPDATED: '✅ Order settings updated',
	ORDER_ACTIVATED: '✅ Order activated',
	ORDER_DEACTIVATED: '✅ Order deactivated',
	POSITION_SOLD: '✅ Position sold successfully',
	TX_CONFIRMED: '✅ Transaction confirmed',
	WITHDRAW_SUCCESS: '✅ Withdrawal successful',
};

// ==============================================
// EMOJIS
// ==============================================
export const EMOJIS = {
	WALLET: '💼',
	ORDER: '📊',
	POSITION: '💰',
	SETTINGS: '⚙️',
	SCANNER: '🔍',
	HELP: 'ℹ️',
	HOME: '🏠',
	SUCCESS: '✅',
	ERROR: '❌',
	WARNING: '⚠️',
	INFO: 'ℹ️',
	LOADING: '⏳',
	FIRE: '🔥',
	ROCKET: '🚀',
	CHART_UP: '📈',
	CHART_DOWN: '📉',
	MONEY: '💵',
	COIN: '🪙',
	LOCK: '🔒',
	UNLOCK: '🔓',
	REFRESH: '🔄',
	BELL: '🔔',
	PARTY: '🎉',
};
