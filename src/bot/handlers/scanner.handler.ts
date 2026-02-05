import TelegramBot from 'node-telegram-bot-api';
import { scannerService } from '../../services/scanner.service';
import { logger } from '../../utils/logger';

/**
 * Bot instance for scanner handler
 */
let botInstance: TelegramBot;

/**
 * Set bot instance (to avoid circular dependency)
 */
export function setBotInstance(bot: TelegramBot): void {
	botInstance = bot;
}

/**
 * Get bot instance
 */
function getBot(): TelegramBot {
	if (!botInstance) {
		throw new Error('Bot instance not initialized in scanner handler');
	}
	return botInstance;
}

/**
 * Show scanner menu with latest tokens
 */
export async function showScannerMenu(chatId: string, messageId?: number): Promise<void> {
	try {
		logger.info(`[Scanner Handler] Fetching scanner data for chat ${chatId}...`);

		// Get scanner status
		const isActive = scannerService.isActive();
		logger.info(`[Scanner Handler] Scanner active: ${isActive}`);

		const totalCount = await scannerService.getTotalScannedCount();
		logger.info(`[Scanner Handler] Total count: ${totalCount}`);

		const latestTokens = await scannerService.getLatestTokens(10);
		logger.info(`[Scanner Handler] Latest tokens count: ${latestTokens.length}`);

		// Build message
		let message = `🔍 <b>Four.meme Token Scanner</b>\n\n`;
		message += `Status: ${isActive ? '🟢 Active' : '🔴 Inactive'}\n`;
		message += `Total Scanned: ${totalCount} tokens\n\n`;

		if (latestTokens.length === 0) {
			message += `<i>No tokens detected yet. Scanner is monitoring for new Four.meme migrations...</i>`;
		} else {
			message += `<b>📋 Latest 10 Tokens:</b>\n\n`;

			for (let i = 0; i < latestTokens.length; i++) {
				const token = latestTokens[i];
				const num = i + 1;
				const symbol = token.symbol || 'UNKNOWN';
				const name = token.name || 'Unknown Token';
				const address = token.address || 'N/A';
				message += `${num}. <code>${symbol}</code> - ${name}\n`;
				message += `   <code>${address}</code>\n`;
				message += `   Detected: ${formatTimestamp(token.scannedAt)}\n\n`;
			}
		}

		// Build keyboard
		const keyboard: any = {
			inline_keyboard: [
				[
					{ text: '🔄 Refresh', callback_data: 'scanner_refresh' },
					{ text: '📊 Stats', callback_data: 'scanner_stats' },
				],
			],
		};

		// Add token buttons if available
		if (latestTokens.length > 0) {
			const tokenButtons = latestTokens.slice(0, 5).map((token, index) => ({
				text: `${index + 1}. ${token.symbol || 'UNKNOWN'}`,
				callback_data: `scanner_token_${token.address}`,
			}));

			// Split into rows of 2
			for (let i = 0; i < tokenButtons.length; i += 2) {
				keyboard.inline_keyboard.push(tokenButtons.slice(i, i + 2));
			}
		}

		// Add back button
		keyboard.inline_keyboard.push([{ text: '🏠 Main Menu', callback_data: 'main_menu' }]);

		// Send or edit message
		if (messageId) {
			try {
				await getBot().editMessageText(message, {
					chat_id: chatId,
					message_id: messageId,
					parse_mode: 'HTML',
					reply_markup: keyboard,
				});
			} catch (editError: any) {
				// If edit fails (e.g., message has no text), delete and send new message
				logger.warning(`Failed to edit message: ${editError.message}, sending new message instead`);
				try {
					await getBot().deleteMessage(chatId, messageId);
				} catch (delError) {
					logger.warning(`Failed to delete message: ${delError}`);
				}
				await getBot().sendMessage(chatId, message, {
					parse_mode: 'HTML',
					reply_markup: keyboard,
				});
			}
		} else {
			await getBot().sendMessage(chatId, message, {
				parse_mode: 'HTML',
				reply_markup: keyboard,
			});
		}
	} catch (error: any) {
		logger.error('Error showing scanner menu:', error.message);
		logger.error('Error stack:', error.stack);
		try {
			await getBot().sendMessage(chatId, `❌ Error loading scanner data: ${error.message}\n\nPlease try again.`);
		} catch (e) {
			logger.error('Failed to send error message:', e);
		}
	}
}

/**
 * Show token detail
 */
export async function showTokenDetail(chatId: string, tokenAddress: string, messageId?: number): Promise<void> {
	try {
		const token = await scannerService.getLatestTokens(100);
		const selectedToken = token.find((t) => t.address.toLowerCase() === tokenAddress.toLowerCase());

		if (!selectedToken) {
			await getBot().sendMessage(chatId, '❌ Token not found.');
			return;
		}

		// Build detailed message
		let message = `💊 <b>${selectedToken.name}</b> (<code>${selectedToken.symbol}</code>)\n\n`;
		message += `📍 <b>Address:</b>\n<code>${selectedToken.address}</code>\n\n`;
		message += `🔢 <b>Decimals:</b> ${selectedToken.decimals}\n`;
		message += `📦 <b>Total Supply:</b> ${formatSupply(selectedToken.totalSupply)}\n`;
		message += `🔗 <b>Transaction:</b> <code>${selectedToken.transactionHash}</code>\n`;
		message += `📊 <b>Block:</b> ${selectedToken.blockNumber}\n`;
		message += `⏰ <b>Detected:</b> ${formatTimestamp(selectedToken.scannedAt)}\n\n`;

		// Build keyboard with links
		const keyboard = {
			inline_keyboard: [
				[
					{ text: '🔍 GMGN', url: `https://gmgn.ai/bsc/token/${selectedToken.address}` },
					{ text: '📊 DexScreener', url: `https://dexscreener.com/bsc/${selectedToken.address}` },
				],
				[{ text: '💎 Axiom', url: `https://axiom.trade/meme/${selectedToken.address}?chain=bnb` }],
				[{ text: '⬅️ Back', callback_data: 'scanner' }],
			],
		};

		// Send or edit message
		if (messageId) {
			try {
				await getBot().editMessageText(message, {
					chat_id: chatId,
					message_id: messageId,
					parse_mode: 'HTML',
					reply_markup: keyboard,
					disable_web_page_preview: true,
				});
			} catch (editError: any) {
				logger.warning(`Failed to edit message: ${editError.message}, sending new message instead`);
				try {
					await getBot().deleteMessage(chatId, messageId);
				} catch (delError) {
					logger.warning(`Failed to delete message: ${delError}`);
				}
				await getBot().sendMessage(chatId, message, {
					parse_mode: 'HTML',
					reply_markup: keyboard,
					disable_web_page_preview: true,
				});
			}
		} else {
			await getBot().sendMessage(chatId, message, {
				parse_mode: 'HTML',
				reply_markup: keyboard,
				disable_web_page_preview: true,
			});
		}
	} catch (error: any) {
		logger.error('Error showing token detail:', error.message);
		try {
			await getBot().sendMessage(chatId, '❌ Error loading token details. Please try again.');
		} catch (e) {
			logger.error('Failed to send error message:', e);
		}
	}
}

/**
 * Show scanner statistics
 */
export async function showScannerStats(chatId: string, messageId?: number): Promise<void> {
	try {
		const totalCount = await scannerService.getTotalScannedCount();
		const latestTokens = await scannerService.getLatestTokens(1);
		const isActive = scannerService.isActive();

		let message = `📊 <b>Scanner Statistics</b>\n\n`;
		message += `Status: ${isActive ? '🟢 Active' : '🔴 Inactive'}\n`;
		message += `Total Tokens Scanned: ${totalCount}\n\n`;

		if (latestTokens.length > 0) {
			message += `<b>Latest Detection:</b>\n`;
			message += `${latestTokens[0].symbol} - ${latestTokens[0].name}\n`;
			message += `${formatTimestamp(latestTokens[0].scannedAt)}\n`;
		}

		const keyboard = {
			inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'scanner' }]],
		};

		if (messageId) {
			try {
				await getBot().editMessageText(message, {
					chat_id: chatId,
					message_id: messageId,
					parse_mode: 'HTML',
					reply_markup: keyboard,
				});
			} catch (editError: any) {
				logger.warning(`Failed to edit message: ${editError.message}, sending new message instead`);
				try {
					await getBot().deleteMessage(chatId, messageId);
				} catch (delError) {
					logger.warning(`Failed to delete message: ${delError}`);
				}
				await getBot().sendMessage(chatId, message, {
					parse_mode: 'HTML',
					reply_markup: keyboard,
				});
			}
		} else {
			await getBot().sendMessage(chatId, message, {
				parse_mode: 'HTML',
				reply_markup: keyboard,
			});
		}
	} catch (error: any) {
		logger.error('Error showing scanner stats:', error.message);
		try {
			await getBot().sendMessage(chatId, '❌ Error loading statistics. Please try again.');
		} catch (e) {
			logger.error('Failed to send error message:', e);
		}
	}
}

/**
 * Send token alert notification
 */
export async function sendTokenAlert(chatId: string, tokenData: any): Promise<void> {
	try {
		// Simple alert format
		let message = `🚨 <b>New Token Detected!</b>\n\n`;
		message += `💊 <code>${tokenData.name}</code> (<code>${tokenData.symbol}</code>)\n`;
		message += `📍 <code>${tokenData.address}</code>\n`;
		message += `⏰ ${formatTimestamp(tokenData.scannedAt)}\n`;

		const keyboard = {
			inline_keyboard: [
				[
					{ text: '🔍 View Details', callback_data: `scanner_token_${tokenData.address}` },
					{ text: '💎 Buy on GMGN', url: `https://gmgn.ai/bsc/token/${tokenData.address}` },
				],
			],
		};

		await getBot().sendMessage(chatId, message, {
			parse_mode: 'HTML',
			reply_markup: keyboard,
		});
	} catch (error: any) {
		logger.error('Error sending token alert:', error.message);
	}
}

/**
 * Format timestamp
 */
function formatTimestamp(date: Date | string | undefined): string {
	try {
		if (!date) return 'Unknown';
		const now = new Date();
		const dateObj = typeof date === 'string' ? new Date(date) : date;
		const diff = now.getTime() - dateObj.getTime();
		const seconds = Math.floor(diff / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (days > 0) return `${days}d ago`;
		if (hours > 0) return `${hours}h ago`;
		if (minutes > 0) return `${minutes}m ago`;
		return `${seconds}s ago`;
	} catch (error) {
		return 'Unknown';
	}
}

/**
 * Format supply with commas
 */
function formatSupply(supply?: string): string {
	if (!supply) return 'Unknown';

	try {
		const num = parseInt(supply);
		if (isNaN(num)) return supply;
		return num.toLocaleString();
	} catch {
		return supply;
	}
}
