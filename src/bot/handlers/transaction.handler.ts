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
		// Get user
		const user = await User.findOne({ chatId });
		if (!user) {
			await getBot().sendMessage(chatId, '❌ User not found. Please /start the bot first.');
			return;
		}

		// Get recent transactions (last 50)
		const transactions = await Transaction.find({ userId: user._id })
			.sort({ timestamp: -1 })
			.limit(50)
			.populate('walletId');

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

			text += `<b>Recent Transactions (Last 20):</b>\n\n`;

			// Show last 20 transactions
			for (const tx of transactions.slice(0, 20)) {
				const typeEmoji = tx.type === TransactionType.BUY ? '🟢' : '🔴';
				const statusEmoji = tx.status === TransactionStatus.SUCCESS ? '✅' : '❌';
				const walletName = (tx.walletId as any)?.name || 'Unknown';

				text += `${typeEmoji} ${statusEmoji} <b>${tx.type}</b>\n`;

				if (tx.tokenSymbol) {
					text += `🪙 Token: ${tx.tokenSymbol}\n`;
				}

				text += `💵 Amount: ${formatBnb(tx.amountBnb)} BNB\n`;

				if (tx.amountToken) {
					text += `🎯 Tokens: ${tx.amountToken.toFixed(2)}\n`;
				}

				if (tx.gasFee) {
					text += `⛽ Gas: ${formatBnb(tx.gasFee)} BNB\n`;
				}

				text += `💼 Wallet: ${walletName}\n`;
				text += `📅 ${tx.timestamp.toLocaleDateString()} ${tx.timestamp.toLocaleTimeString()}\n`;

				if (tx.status === TransactionStatus.SUCCESS && tx.txHash && !tx.txHash.startsWith('FAILED')) {
					text += `🔗 <code>${tx.txHash.substring(0, 16)}...</code>\n`;
				}

				if (tx.status === TransactionStatus.FAILED && tx.errorMessage) {
					text += `⚠️ ${tx.errorMessage.substring(0, 50)}...\n`;
				}

				text += '\n';
			}

			if (transactions.length > 20) {
				text += `... and ${transactions.length - 20} more transactions\n`;
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
			await getBot().editMessageText(text, {
				chat_id: chatId,
				message_id: messageId,
				parse_mode: 'HTML',
				reply_markup: keyboard,
			});
		} else {
			await getBot().sendMessage(chatId, text, {
				parse_mode: 'HTML',
				reply_markup: keyboard,
			});
		}
	} catch (error: any) {
		logger.error('Failed to show transactions list:', error.message);
		await getBot().sendMessage(chatId, '❌ Failed to load transactions. Please try again.');
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

			for (const tx of transactions.slice(0, 15)) {
				const typeEmoji = tx.type === TransactionType.BUY ? '🟢' : '🔴';
				const statusEmoji = tx.status === TransactionStatus.SUCCESS ? '✅' : '❌';

				text += `${typeEmoji} ${statusEmoji} <b>${tx.type}</b>\n`;

				if (tx.tokenSymbol) {
					text += `🪙 ${tx.tokenSymbol}\n`;
				}

				text += `💵 ${formatBnb(tx.amountBnb)} BNB`;

				if (tx.amountToken) {
					text += ` → ${tx.amountToken.toFixed(2)} tokens`;
				}

				text += `\n📅 ${tx.timestamp.toLocaleDateString()}\n`;

				if (tx.status === TransactionStatus.SUCCESS && tx.txHash && !tx.txHash.startsWith('FAILED')) {
					text += `🔗 <code>${tx.txHash.substring(0, 20)}...</code>\n`;
				}

				if (tx.status === TransactionStatus.FAILED && tx.errorMessage) {
					text += `⚠️ ${tx.errorMessage.substring(0, 40)}...\n`;
				}

				text += '\n';
			}

			if (transactions.length > 15) {
				text += `... and ${transactions.length - 15} more\n`;
			}
		}

		const keyboard: TelegramBot.InlineKeyboardMarkup = {
			inline_keyboard: [
				[{ text: '◀️ Back to All Transactions', callback_data: 'transactions' }],
				[{ text: '🏠 Main Menu', callback_data: 'main_menu' }],
			],
		};

		if (messageId) {
			await getBot().editMessageText(text, {
				chat_id: chatId,
				message_id: messageId,
				parse_mode: 'HTML',
				reply_markup: keyboard,
			});
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
