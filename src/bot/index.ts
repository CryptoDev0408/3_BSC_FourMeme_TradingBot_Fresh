import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { WELCOME_MESSAGE, HELP_MESSAGE } from '../config/constants';
import { getMainMenuKeyboard } from './keyboards/main.keyboard';
import { User } from '../database/models';
import {
	showWalletsList,
	showWalletDetail,
	handleWalletGenerate,
	handleWalletImport,
	handleWalletRemove,
	confirmWalletRemove,
	showPrivateKey,
	handleWalletActivate,
	handleWithdrawInitiate,
	handleWithdrawPercent,
	handleWalletTextMessage,
	clearWalletState,
} from './handlers/wallet.handler';

/**
 * Telegram Bot Instance
 */
export let bot: TelegramBot;

/**
 * Initialize Telegram Bot
 */
export async function initializeBot(): Promise<void> {
	try {
		logger.info('🤖 Initializing Telegram Bot...');

		bot = new TelegramBot(config.telegram.botToken, {
			polling: true,
		});

		// Setup handlers
		setupCommandHandlers();
		setupMessageHandlers();
		setupCallbackHandlers(); // <-- THIS WAS MISSING!
		setupErrorHandlers();

		logger.success('✅ Telegram Bot initialized successfully');
		logger.info(`📱 Bot: @fourmeme_123_bot`);
	} catch (error: any) {
		logger.error('❌ Failed to initialize Telegram Bot:', error.message);
		throw error;
	}
}

/**
 * Setup command handlers
 */
function setupCommandHandlers(): void {
	// /start command
	bot.onText(/\/start/, async (msg) => {
		const chatId = msg.chat.id.toString();
		const username = msg.from?.username || '';
		const firstName = msg.from?.first_name || '';
		const lastName = msg.from?.last_name || '';

		try {
			// Create or update user
			let user = await User.findOne({ chatId });

			if (!user) {
				user = await User.create({
					chatId,
					username,
					firstName,
					lastName,
				});
				logger.bot(`New user registered: ${username || chatId}`);
			} else {
				// Update user info
				user.username = username;
				user.firstName = firstName;
				user.lastName = lastName;
				await user.save();
			}

			// Send welcome message with main menu
			await bot.sendPhoto(
				chatId,
				'https://ipfs.io/ipfs/bafkreiebl7hx5sieh6obulfjpl76dl7zq5cgfp62n4tk3rnyjclvipcbby',
				{
					caption: WELCOME_MESSAGE,
					parse_mode: 'HTML',
					reply_markup: getMainMenuKeyboard(),
				}
			);

			logger.bot(`User ${username || chatId} started the bot`);
		} catch (error: any) {
			logger.error('Error handling /start command:', error.message);
			logger.error('Full error:', error);
			// Fallback to text message if photo fails
			try {
				await bot.sendMessage(chatId, WELCOME_MESSAGE, {
					parse_mode: 'HTML',
					reply_markup: getMainMenuKeyboard(),
				});
			} catch (fallbackError: any) {
				logger.error('Fallback error:', fallbackError.message);
				await bot.sendMessage(chatId, '❌ An error occurred. Please try again.');
			}
		}
	});

	// /help command
	bot.onText(/\/help/, async (msg) => {
		const chatId = msg.chat.id.toString();
		const helpText = `
📚 <b>FourMeme Trading Bot - Help</b>

<b>💼 Wallet Management:</b>
• Generate new BSC wallets
• Import existing wallets with private key
• View wallet balances
• Withdraw BNB to external addresses
• Switch between multiple wallets

<b>📊 Order Management:</b>
• Configure trading amount per wallet
• Set Take Profit percentage
• Set Stop Loss percentage
• Customize gas fees
• Enable/disable orders
• Manual token buying

<b>💰 Position Tracking:</b>
• View all active positions
• Real-time PNL updates
• Manual selling (25%, 50%, 100%)
• Automatic TP/SL execution

<b>🔍 Token Scanner:</b>
• Monitors Four.meme token migrations
• Auto-buy new tokens (if order active)
• Real-time notifications

<b>🎯 Quick Start:</b>
1. Click "💼 Wallets" to create/import a wallet
2. Click "📊 Orders" to configure trading settings
3. Activate your order to start trading
4. Monitor positions in "💰 Positions"

Need more help? Contact admin!
    `.trim();

		await bot.sendMessage(chatId, helpText, {
			parse_mode: 'HTML',
			reply_markup: getMainMenuKeyboard(),
		});
	});
}

/**
 * Setup message handlers
 */
function setupMessageHandlers(): void {
	// Handle text messages (for multi-step interactions)
	bot.on('message', async (msg) => {
		// Skip commands
		if (msg.text?.startsWith('/')) {
			return;
		}

		const chatId = msg.chat.id.toString();

		try {
			// Try wallet handler first
			const handled = await handleWalletTextMessage(msg);
			if (handled) {
				return;
			}

			// Add other handlers here in future steps
		} catch (error: any) {
			logger.error('Error handling message:', error.message);
		}
	});
}

/**
 * Setup callback query handlers
 */
function setupCallbackHandlers(): void {
	bot.on('callback_query', async (query) => {
		const chatId = query.message?.chat.id.toString();
		const data = query.data;

		console.log('[BOT] Callback query received - chatId:', chatId, 'data:', data);

		if (!chatId || !data) return;

		try {
			// Answer callback query to remove loading state
			await bot.answerCallbackQuery(query.id);

			// Route to appropriate handler
			if (data === 'main_menu') {
				console.log('[BOT] Routing to main_menu');
				clearWalletState(chatId);
				await bot.sendPhoto(
					chatId,
					'https://ipfs.io/ipfs/bafkreiebl7hx5sieh6obulfjpl76dl7zq5cgfp62n4tk3rnyjclvipcbby',
					{
						caption: WELCOME_MESSAGE,
						parse_mode: 'HTML',
						reply_markup: getMainMenuKeyboard(),
					}
				);
			} else if (data === 'wallets') {
				console.log('[BOT] Routing to wallets handler');
				await showWalletsList(chatId, query.message?.message_id);
			} else if (data.startsWith('wallets_page_')) {
				const page = parseInt(data.split('_')[2]);
				await showWalletsList(chatId, query.message?.message_id, page);
			} else if (data.startsWith('wallet_view_')) {
				const walletId = data.replace('wallet_view_', '');
				await showWalletDetail(chatId, walletId, query.message?.message_id);
			} else if (data === 'wallet_generate') {
				await handleWalletGenerate(chatId, query.message?.message_id);
			} else if (data === 'wallet_import') {
				await handleWalletImport(chatId, query.message?.message_id);
			} else if (data.startsWith('wallet_remove_')) {
				if (data.startsWith('wallet_remove_confirm_')) {
					const walletId = data.replace('wallet_remove_confirm_', '');
					await confirmWalletRemove(chatId, walletId, query.message?.message_id);
				} else {
					const walletId = data.replace('wallet_remove_', '');
					await handleWalletRemove(chatId, walletId, query.message?.message_id);
				}
			} else if (data.startsWith('wallet_showkey_')) {
				const walletId = data.replace('wallet_showkey_', '');
				await showPrivateKey(chatId, walletId);
			} else if (data.startsWith('wallet_activate_')) {
				const walletId = data.replace('wallet_activate_', '');
				await handleWalletActivate(chatId, walletId, query.message?.message_id);
			} else if (data.startsWith('wallet_refresh_')) {
				const walletId = data.replace('wallet_refresh_', '');
				await showWalletDetail(chatId, walletId, query.message?.message_id);
			} else if (data.startsWith('wallet_withdraw_')) {
				if (data.startsWith('wallet_withdraw_percent_')) {
					const parts = data.split('_');
					const walletId = parts[3];
					const percent = parseInt(parts[4]);
					await handleWithdrawPercent(chatId, walletId, percent, query.message?.message_id);
				} else {
					const walletId = data.replace('wallet_withdraw_', '');
					await handleWithdrawInitiate(chatId, walletId, query.message?.message_id);
				}
			} else if (data === 'orders') {
				if (query.message?.message_id) {
					await bot.deleteMessage(chatId, query.message.message_id);
				}
				await bot.sendMessage(chatId, '📊 <b>Order Management</b>\n\n⏳ Coming soon in next steps...', {
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'main_menu' }]],
					},
				});
			} else if (data === 'positions') {
				if (query.message?.message_id) {
					await bot.deleteMessage(chatId, query.message.message_id);
				}
				await bot.sendMessage(chatId, '💰 <b>Position Management</b>\n\n⏳ Coming soon in next steps...', {
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'main_menu' }]],
					},
				});
			} else if (data === 'scanner') {
				if (query.message?.message_id) {
					await bot.deleteMessage(chatId, query.message.message_id);
				}
				const scannerStatus = config.monitoring.scannerEnabled ? '🟢 Active' : '🔴 Inactive';
				await bot.sendMessage(
					chatId,
					`🔍 <b>Four.meme Scanner Status</b>\n\nStatus: ${scannerStatus}\n\n⏳ Scanner coming soon in next steps...`,
					{
						parse_mode: 'HTML',
						reply_markup: {
							inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'main_menu' }]],
						},
					}
				);
			} else if (data === 'help') {
				if (query.message?.message_id) {
					await bot.deleteMessage(chatId, query.message.message_id);
				}
				await bot.sendMessage(chatId, HELP_MESSAGE, {
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'main_menu' }]],
					},
				});
			}
		} catch (error: any) {
			logger.error('Error handling callback query:', error.message);
		}
	});
}

/**
 * Setup error handlers
 */
function setupErrorHandlers(): void {
	bot.on('polling_error', (error) => {
		logger.error('Polling error:', error.message);
	});

	bot.on('error', (error) => {
		logger.error('Bot error:', error.message);
	});
}

/**
 * Stop the bot
 */
export async function stopBot(): Promise<void> {
	if (bot) {
		await bot.stopPolling();
		logger.info('🤖 Telegram Bot stopped');
	}
}
