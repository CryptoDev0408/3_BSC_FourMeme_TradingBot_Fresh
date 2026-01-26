import TelegramBot from 'node-telegram-bot-api';
import { logger } from '../../utils/logger';
import { User, Transaction } from '../../database/models';
import { TransactionType, TransactionStatus } from '../../config/constants';
import { formatBnb } from '../../utils/formatter';

/**
 * Bot instance getter - resolves circular dependency
 */
let botInstance: TelegramBot;

export function setBotInstance(bot: TelegramBot): void {
	botInstance = bot;
}
function getBot(): TelegramBot {
	if (!botInstance) {
		throw new Error('Bot instance not initialized');
	}
	return botInstance;
}

/**
 * Show transactions list
 */
export async function showTransactionsList(chatId: string, messageId?: number): Promise<void> {
	try {
		logger.info(`[TRANSACTIONS] Showing transactions list for chatId: ${chatId}, messageId: ${messageId}`);

		// Get user
		const user = await User.findOne({ chatId });
		logger.info(`[TRANSACTIONS] User found: ${user ? user._id : 'null'}`);

		if (!user) {
			await getBot().sendMessage(chatId, '❌ User not found. Please /start the bot first.');
			return;
		}

		// Get recent transactions (last 50)
		const transactions = await Transaction.find({ userId: user._id })
			.sort({ timestamp: -1 })
			.limit(50)
			.populate('walletId');

		logger.info(`[TRANSACTIONS] Found ${transactions.length} transactions`);

		let text = '📜 <b>Transaction History</b>\n\n';

		if (transactions.length === 0) {
			text += '📭 No transactions yet.\n\n';
			text += 'Start trading to see your transaction history!';
		} else {
			// Group by type
			const buyTxs = transactions.filter((t) => t.type === TransactionType.BUY);
			const sellTxs = transactions.filter((t) => t.type === TransactionType.SELL);
			const successTxs = transactions.filter((t) => t.status === TransactionStatus.SUCCESS);
			const failedTxs = transactions.filter((t) => t.status === TransactionStatus.FAILED);

			text += `📊 <b>Summary</b>\n`;
			text += `Total: ${transactions.length} | ✅ Success: ${successTxs.length} | ❌ Failed: ${failedTxs.length}\n`;
			text += `🟢 Buys: ${buyTxs.length} | 🔴 Sells: ${sellTxs.length}\n\n`;

			text += `<b>Recent Transactions (Last 10):</b>\n\n`;

			// Show last 10 transactions with compact format
			for (const tx of transactions.slice(0, 10)) {
				try {
					const typeEmoji = tx.type === TransactionType.BUY ? '🟢' : '🔴';
					const statusEmoji = tx.status === TransactionStatus.SUCCESS ? '✅' : '❌';
					const walletName = (tx.walletId as any)?.name || 'Unknown';

					// Compact single-line format
					text += `${typeEmoji}${statusEmoji} <b>${tx.type}</b> | `;
					
					if (tx.tokenSymbol) {
						text += `${tx.tokenSymbol} | `;
					}

					text += `${formatBnb(tx.amountBnb)} BNB`;

					if (tx.gasFee) {
						text += ` (⛽${formatBnb(tx.gasFee)})`;
					}

					text += `\n💼 ${walletName} | ${tx.timestamp.toLocaleDateString()}\n`;

					if (tx.status === TransactionStatus.FAILED && tx.errorMessage) {
						text += `⚠️ ${tx.errorMessage.substring(0, 40)}...\n`;
					}

					text += '\n';
				} catch (txError: any) {
					logger.error(`[TRANSACTIONS] Error formatting transaction ${tx._id}:`, txError.message);
					// Continue with next transaction
				}
			}

			if (transactions.length > 10) {
				text += `... +${transactions.length - 10} more transactions\n`;
			}
		}

		const keyboard: TelegramBot.InlineKeyboardMarkup = {
			inline_keyboard: [
				[
					{ text: '🟢 Buy Txs', callback_data: 'txs_filter_buy' },
					{ text: '🔴 Sell Txs', callback_data: 'txs_filter_sell' },
				],
				[
					{ text: '✅ Success', callback_data: 'txs_filter_success' },
					{ text: '❌ Failed', callback_data: 'txs_filter_failed' },
				],
				[{ text: '🏠 Main Menu', callback_data: 'main_menu' }],
			],
		};

		if (messageId) {
			try {
				// Try to edit the message
				await getBot().editMessageText(text, {
					chat_id: chatId,
					message_id: messageId,
					parse_mode: 'HTML',
					reply_markup: keyboard,
				});
			} catch (editError: any) {
				// If editing fails (e.g., message is a photo), delete and send new
				if (editError.message?.includes('there is no text in the message to edit')) {
					await getBot().deleteMessage(chatId, messageId);
					await getBot().sendMessage(chatId, text, {
						parse_mode: 'HTML',
						reply_markup: keyboard,
					});
				} else {
					throw editError;
				}
			}
		} else {
			await getBot().sendMessage(chatId, text, {
				parse_mode: 'HTML',
				reply_markup: keyboard,
			});
		}
	} catch (error: any) {
		logger.error('Failed to show transactions list:', error.message);
		logger.error('Error stack:', error.stack);
		console.error('Transaction list error:', error);
		try {
			await getBot().sendMessage(chatId, `❌ Failed to load transactions.\n\nError: ${error.message}`);
		} catch (sendError) {
			logger.error('Failed to send error message:', sendError);
		}
	}
}

/**
 * Show filtered transactions
 */
export async function showFilteredTransactions(
	chatId: string,
	filter: 'buy' | 'sell' | 'success' | 'failed',
	messageId?: number
): Promise<void> {
	try {
		// Get user
		const user = await User.findOne({ chatId });
		if (!user) {
			await getBot().sendMessage(chatId, '❌ User not found.');
			return;
		}

		// Build filter query
		const query: any = { userId: user._id };
		let filterTitle = '';

		switch (filter) {
			case 'buy':
				query.type = TransactionType.BUY;
				filterTitle = '🟢 Buy Transactions';
				break;
			case 'sell':
				query.type = TransactionType.SELL;
				filterTitle = '🔴 Sell Transactions';
				break;
			case 'success':
				query.status = TransactionStatus.SUCCESS;
				filterTitle = '✅ Successful Transactions';
				break;
			case 'failed':
				query.status = TransactionStatus.FAILED;
				filterTitle = '❌ Failed Transactions';
				break;
		}

		// Get filtered transactions
		const transactions = await Transaction.find(query)
			.sort({ timestamp: -1 })
			.limit(30)
			.populate('walletId');

		let text = `📜 <b>${filterTitle}</b>\n\n`;

		if (transactions.length === 0) {
			text += '📭 No transactions found with this filter.\n';
		} else {
			text += `Found ${transactions.length} transaction(s)\n\n`;

			// Show only 10 transactions with compact format
			for (const tx of transactions.slice(0, 10)) {
				const typeEmoji = tx.type === TransactionType.BUY ? '🟢' : '🔴';
				const statusEmoji = tx.status === TransactionStatus.SUCCESS ? '✅' : '❌';
				const walletName = (tx.walletId as any)?.name || 'Unknown';

				// Ultra compact format
				text += `${typeEmoji}${statusEmoji} <b>${tx.type}</b> | `;

				if (tx.tokenSymbol) {
					text += `${tx.tokenSymbol} | `;
				}

				text += `${formatBnb(tx.amountBnb)} BNB\n`;
				text += `💼 ${walletName} | ${tx.timestamp.toLocaleDateString()}\n`;

				if (tx.status === TransactionStatus.FAILED && tx.errorMessage) {
					text += `⚠️ ${tx.errorMessage.substring(0, 35)}...\n`;
				}

				text += '\n';
			}

			if (transactions.length > 10) {
				text += `... +${transactions.length - 10} more\n`;
			}
		}

		const keyboard: TelegramBot.InlineKeyboardMarkup = {
			inline_keyboard: [
				[{ text: '◀️ Back to All Transactions', callback_data: 'transactions' }],
				[{ text: '🏠 Main Menu', callback_data: 'main_menu' }],
			],
		};

		if (messageId) {
			try {
				// Try to edit the message
				await getBot().editMessageText(text, {
					chat_id: chatId,
					message_id: messageId,
					parse_mode: 'HTML',
					reply_markup: keyboard,
				});
			} catch (editError: any) {
				// If editing fails (e.g., message is a photo), delete and send new
				if (editError.message?.includes('there is no text in the message to edit')) {
					await getBot().deleteMessage(chatId, messageId);
					await getBot().sendMessage(chatId, text, {
						parse_mode: 'HTML',
						reply_markup: keyboard,
					});
				} else {
					throw editError;
				}
			}
		} else {
			await getBot().sendMessage(chatId, text, {
				parse_mode: 'HTML',
				reply_markup: keyboard,
			});
		}
	} catch (error: any) {
		logger.error('Failed to show filtered transactions:', error.message);
		await getBot().sendMessage(chatId, '❌ Failed to load transactions.');
	}
}
