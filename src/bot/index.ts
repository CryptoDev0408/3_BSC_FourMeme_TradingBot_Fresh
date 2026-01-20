import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { WELCOME_MESSAGE } from '../config/constants';
import { getMainMenuKeyboard } from './keyboards/main.keyboard';
import { User } from '../database/models';

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
		setupCallbackHandlers();
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
			await bot.sendMessage(chatId, WELCOME_MESSAGE, {
				parse_mode: 'HTML',
				reply_markup: getMainMenuKeyboard(),
			});

			logger.bot(`User ${username || chatId} started the bot`);
		} catch (error: any) {
			logger.error('Error handling /start command:', error.message);
			await bot.sendMessage(chatId, '❌ An error occurred. Please try again.');
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
 * Setup callback query handlers
 */
function setupCallbackHandlers(): void {
	bot.on('callback_query', async (query) => {
		const chatId = query.message?.chat.id.toString();
		const data = query.data;

		if (!chatId || !data) return;

		try {
			// Answer callback query to remove loading state
			await bot.answerCallbackQuery(query.id);

			// Route to appropriate handler
			if (data === 'main_menu') {
				await bot.editMessageText(WELCOME_MESSAGE, {
					chat_id: chatId,
					message_id: query.message?.message_id,
					parse_mode: 'HTML',
					reply_markup: getMainMenuKeyboard(),
				});
			} else if (data === 'wallets') {
				await bot.editMessageText('💼 <b>Wallet Management</b>\n\n⏳ Coming soon in next steps...', {
					chat_id: chatId,
					message_id: query.message?.message_id,
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'main_menu' }]],
					},
				});
			} else if (data === 'orders') {
				await bot.editMessageText('📊 <b>Order Management</b>\n\n⏳ Coming soon in next steps...', {
					chat_id: chatId,
					message_id: query.message?.message_id,
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'main_menu' }]],
					},
				});
			} else if (data === 'positions') {
				await bot.editMessageText('💰 <b>Position Management</b>\n\n⏳ Coming soon in next steps...', {
					chat_id: chatId,
					message_id: query.message?.message_id,
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'main_menu' }]],
					},
				});
			} else if (data === 'scanner') {
				const scannerStatus = config.monitoring.scannerEnabled ? '🟢 Active' : '🔴 Inactive';
				await bot.editMessageText(
					`🔍 <b>Four.meme Scanner Status</b>\n\nStatus: ${scannerStatus}\n\n⏳ Scanner coming soon in next steps...`,
					{
						chat_id: chatId,
						message_id: query.message?.message_id,
						parse_mode: 'HTML',
						reply_markup: {
							inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'main_menu' }]],
						},
					}
				);
			} else if (data === 'help') {
				await bot.sendMessage(chatId, 'Use /help command for detailed instructions.');
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
