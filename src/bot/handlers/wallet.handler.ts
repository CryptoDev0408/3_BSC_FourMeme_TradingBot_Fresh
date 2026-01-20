import TelegramBot from 'node-telegram-bot-api';
import { bot } from '../index';
import { logger } from '../../utils/logger';
import { formatBnb, formatTimeAgo } from '../../utils/formatter';
import {
	generateWallet,
	importWallet,
	getUserWallets,
	removeWallet,
	setActiveWallet,
	getWalletWithPrivateKey,
} from '../../core/wallet/wallet.manager';
import {
	getBnbBalance,
	updateWalletBalance,
	transferBnb,
} from '../../core/wallet/wallet.service';
import {
	getWalletListKeyboard,
	getWalletDetailKeyboard,
	getWalletGenerateKeyboard,
	getWalletRemoveConfirmKeyboard,
	getWithdrawAmountKeyboard,
} from '../keyboards/wallet.keyboard';
import { WALLETS_PER_PAGE } from '../../config/constants';
import { User } from '../../database/models';

/**
 * Wallet Handler
 * Handles all wallet-related Telegram interactions
 */

// Store user states for multi-step interactions
const userStates: Map<
	string,
	{
		action: string;
		data?: any;
		messageId?: number;
	}
> = new Map();

/**
 * Get user ID from chat ID
 */
async function getUserId(chatId: string): Promise<string | null> {
	try {
		console.log('[WALLET] getUserId called with chatId:', chatId);
		const user = await User.findOne({ chatId });
		console.log('[WALLET] User found:', user ? `ID: ${user._id}` : 'null');
		return user?._id.toString() || null;
	} catch (error: any) {
		console.error('[WALLET] Failed to get user ID:', error);
		logger.error('Failed to get user ID:', error.message);
		return null;
	}
}

/**
 * Show wallets list
 */
export async function showWalletsList(chatId: string, messageId?: number, page: number = 0): Promise<void> {
	try {
		console.log('[WALLET] showWalletsList called - chatId:', chatId, 'messageId:', messageId, 'page:', page);

		const userId = await getUserId(chatId);
		console.log('[WALLET] Got userId:', userId);

		if (!userId) {
			console.log('[WALLET] User not found, sending error message');
			await bot.sendMessage(chatId, '❌ User not found. Please use /start first.');
			return;
		}

		console.log('[WALLET] Fetching wallets for userId:', userId);
		const wallets = await getUserWallets(userId);
		console.log('[WALLET] Wallets fetched, count:', wallets.length);

		let text = '💼 <b>Your Wallets</b>\n\n';

		if (wallets.length === 0) {
			text += '📭 You don\'t have any wallets yet.\n\n';
			text += 'Click "➕ Generate Wallet" to create a new wallet or "📥 Import Wallet" to import an existing one.';
		} else {
			text += `📊 Total Wallets: <b>${wallets.length}</b>\n\n`;
			text += '✅ = Active Wallet\n';
			text += '⚪️ = Inactive Wallet\n\n';
			text += '<i>Click on a wallet to view details</i>';
		}

		// Convert wallets for keyboard (ObjectId to string)
		console.log('[WALLET] Converting wallets for keyboard');
		const walletsFormatted = wallets.map((w) => ({
			_id: w._id.toString(),
			name: w.name,
			address: w.address,
			isActive: w.isActive,
			balance: { bnb: w.balance.bnb },
		}));
		console.log('[WALLET] Wallets formatted:', walletsFormatted.length);

		const keyboard = getWalletListKeyboard(walletsFormatted, page, WALLETS_PER_PAGE);
		console.log('[WALLET] Keyboard created');

		if (messageId) {
			console.log('[WALLET] Editing existing message:', messageId);
			await bot.editMessageText(text, {
				chat_id: chatId,
				message_id: messageId,
				parse_mode: 'HTML',
				reply_markup: keyboard,
			});
			console.log('[WALLET] Message edited successfully');
		} else {
			console.log('[WALLET] Sending new message');
			await bot.sendMessage(chatId, text, {
				parse_mode: 'HTML',
				reply_markup: keyboard,
			});
			console.log('[WALLET] Message sent successfully');
		}
	} catch (error: any) {
		console.error('[WALLET] Error showing wallets list:', error);
		logger.error('Error showing wallets list:', error.message);
		await bot.sendMessage(chatId, '❌ Failed to load wallets. Please try again.');
	}
}

/**
 * Show wallet details
 */
export async function showWalletDetail(
	chatId: string,
	walletId: string,
	messageId?: number
): Promise<void> {
	try {
		const userId = await getUserId(chatId);
		if (!userId) {
			await bot.sendMessage(chatId, '❌ User not found. Please use /start first.');
			return;
		}

		const wallets = await getUserWallets(userId);
		const wallet = wallets.find((w) => w._id.toString() === walletId);

		if (!wallet) {
			await bot.sendMessage(chatId, '❌ Wallet not found.');
			return;
		}

		// Refresh balance
		const balanceResult = await getBnbBalance(wallet.address, false);
		await updateWalletBalance(walletId);

		const balance = balanceResult.success && balanceResult.balance !== undefined ? balanceResult.balance : 0;

		const text = `
💼 <b>Wallet Details</b>

📝 Name: <b>${wallet.name}</b>
${wallet.isActive ? '✅ <b>Active Wallet</b>' : '⚪️ Inactive'}

📍 Address:
<code>${wallet.address}</code>

💰 Balance: <b>${formatBnb(balance)} BNB</b>

🕐 Created: ${formatTimeAgo(wallet.createdAt)}
🔄 Last Updated: ${formatTimeAgo(wallet.balance.lastUpdated)}

<i>Tap to copy address</i>
        `.trim();

		const keyboard = getWalletDetailKeyboard(walletId, wallet.isActive);

		if (messageId) {
			await bot.editMessageText(text, {
				chat_id: chatId,
				message_id: messageId,
				parse_mode: 'HTML',
				reply_markup: keyboard,
			});
		} else {
			await bot.sendMessage(chatId, text, {
				parse_mode: 'HTML',
				reply_markup: keyboard,
			});
		}
	} catch (error: any) {
		logger.error('Error showing wallet detail:', error.message);
		await bot.sendMessage(chatId, '❌ Failed to load wallet details.');
	}
}

/**
 * Handle wallet generation
 */
export async function handleWalletGenerate(chatId: string, messageId?: number): Promise<void> {
	try {
		// Send generating message
		if (messageId) {
			await bot.editMessageText('⏳ Generating wallet...', {
				chat_id: chatId,
				message_id: messageId,
			});
		}

		// Get user ID
		const userId = await getUserId(chatId);
		if (!userId) {
			await bot.sendMessage(chatId, '❌ User not found. Please use /start first.');
			return;
		}

		// Generate wallet (will auto-name as w1, w2, etc.)
		const result = await generateWallet(userId);

		if (!result.success || !result.wallet) {
			await bot.sendMessage(chatId, `❌ Failed to generate wallet: ${result.error || 'Unknown error'}`);
			return;
		}

		const wallet = result.wallet;

		const text = `
✅ <b>Wallet Generated!</b>

📝 Name: <b>${wallet.name}</b>
📍 Address:
<code>${wallet.address}</code>

${wallet.isActive ? '✅ Set as active wallet' : ''}

⚠️ <b>Important:</b> Save your private key securely!
Use "🔑 Show Private Key" from wallet details to view it.
        `.trim();

		await bot.sendMessage(chatId, text, {
			parse_mode: 'HTML',
		});

		// Show wallets list
		await showWalletsList(chatId);
	} catch (error: any) {
		logger.error('Error in wallet generate:', error.message);
		await bot.sendMessage(chatId, '❌ Failed to generate wallet. Please try again.');
	}
}



/**
 * Handle wallet import
 */
export async function handleWalletImport(chatId: string, messageId?: number): Promise<void> {
	try {
		const text = `
📥 <b>Import Existing Wallet</b>

Send your private key to import an existing BSC wallet.

<b>⚠️ Security:</b>
• Your private key will be encrypted before storage
• Message will be deleted automatically
• Never share private keys in public groups

<b>Format:</b>
Send your 64-character private key (with or without 0x prefix)

Example:
<code>0x1234567890abcdef...</code>

<i>Send the private key now or click Cancel</i>
        `.trim();

		// Set user state
		userStates.set(chatId, {
			action: 'import_wallet',
			messageId,
		});

		if (messageId) {
			await bot.editMessageText(text, {
				chat_id: chatId,
				message_id: messageId,
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'wallets' }]],
				},
			});
		} else {
			await bot.sendMessage(chatId, text, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'wallets' }]],
				},
			});
		}
	} catch (error: any) {
		logger.error('Error in wallet import:', error.message);
	}
}

/**
 * Process private key for import
 */
export async function processPrivateKeyImport(chatId: string, privateKey: string, msgId: number): Promise<void> {
	try {
		// Delete the message with private key for security
		try {
			await bot.deleteMessage(chatId, msgId);
		} catch (e) {
			// Ignore if can't delete
		}

		// Clear user state
		userStates.delete(chatId);

		// Send processing message
		const processingMsg = await bot.sendMessage(chatId, '⏳ Importing wallet...');

		// Get user ID
		const userId = await getUserId(chatId);
		if (!userId) {
			await bot.deleteMessage(chatId, processingMsg.message_id);
			await bot.sendMessage(chatId, '❌ User not found. Please use /start first.');
			return;
		}

		// Validate and import
		const result = await importWallet(userId, privateKey.trim());

		// Delete processing message
		await bot.deleteMessage(chatId, processingMsg.message_id);

		if (!result.success || !result.wallet) {
			await bot.sendMessage(chatId, `❌ Failed to import wallet: ${result.error || 'Unknown error'}`);
			return;
		}

		const wallet = result.wallet;

		const text = `
✅ <b>Wallet Imported Successfully!</b>

📝 Name: <b>${wallet.name}</b>
📍 Address:
<code>${wallet.address}</code>
💰 Balance: <b>${formatBnb(wallet.balance.bnb)} BNB</b>

${wallet.isActive ? '✅ Set as active wallet' : ''}

Your private key is encrypted and stored securely.
        `.trim();

		await bot.sendMessage(chatId, text, {
			parse_mode: 'HTML',
		});

		// Show wallets list
		await showWalletsList(chatId);
	} catch (error: any) {
		logger.error('Error processing private key import:', error.message);
		await bot.sendMessage(chatId, '❌ Failed to import wallet. Please check the private key and try again.');
	}
}

/**
 * Handle wallet removal
 */
export async function handleWalletRemove(
	chatId: string,
	walletId: string,
	messageId?: number
): Promise<void> {
	try {
		const text = `
🗑 <b>Remove Wallet</b>

⚠️ <b>Warning:</b> This action cannot be undone!

Are you sure you want to remove this wallet?

<b>Important:</b>
• Make sure you have backed up your private key
• Withdraw all funds before removing
• If this is your active wallet, another will be set as active

Do you want to proceed?
        `.trim();

		const keyboard = getWalletRemoveConfirmKeyboard(walletId);

		if (messageId) {
			await bot.editMessageText(text, {
				chat_id: chatId,
				message_id: messageId,
				parse_mode: 'HTML',
				reply_markup: keyboard,
			});
		} else {
			await bot.sendMessage(chatId, text, {
				parse_mode: 'HTML',
				reply_markup: keyboard,
			});
		}
	} catch (error: any) {
		logger.error('Error in wallet remove:', error.message);
	}
}

/**
 * Confirm wallet removal
 */
export async function confirmWalletRemove(
	chatId: string,
	walletId: string,
	messageId?: number
): Promise<void> {
	try {
		if (messageId) {
			await bot.editMessageText('⏳ Removing wallet...', {
				chat_id: chatId,
				message_id: messageId,
			});
		}

		const userId = await getUserId(chatId);
		if (!userId) {
			await bot.sendMessage(chatId, '❌ User not found. Please use /start first.');
			return;
		}

		const result = await removeWallet(walletId, userId);

		if (!result.success) {
			await bot.sendMessage(chatId, `❌ Failed to remove wallet: ${result.error || 'Unknown error'}`);
			return;
		}

		await bot.sendMessage(chatId, '✅ Wallet removed successfully!');

		// Show wallets list
		await showWalletsList(chatId);
	} catch (error: any) {
		logger.error('Error confirming wallet removal:', error.message);
		await bot.sendMessage(chatId, '❌ Failed to remove wallet.');
	}
}

/**
 * Show private key
 */
export async function showPrivateKey(chatId: string, walletId: string): Promise<void> {
	try {
		const userId = await getUserId(chatId);
		if (!userId) {
			await bot.sendMessage(chatId, '❌ User not found. Please use /start first.');
			return;
		}

		const result = await getWalletWithPrivateKey(walletId, userId);

		if (!result.success || !result.wallet || !result.privateKey) {
			await bot.sendMessage(chatId, `❌ Failed to retrieve private key: ${result.error || 'Unknown error'}`);
			return;
		}

		const text = `
🔑 <b>Private Key</b>

⚠️ <b>KEEP THIS SECRET!</b>

<code>${result.privateKey}</code>

<b>Security Tips:</b>
• Never share this with anyone
• Store it in a secure location
• Anyone with this key can access your funds

<i>This message will be automatically deleted in 60 seconds</i>
        `.trim();

		const msg = await bot.sendMessage(chatId, text, {
			parse_mode: 'HTML',
		});

		// Auto-delete after 60 seconds
		setTimeout(async () => {
			try {
				await bot.deleteMessage(chatId, msg.message_id);
			} catch (e) {
				// Ignore if already deleted
			}
		}, 60000);
	} catch (error: any) {
		logger.error('Error showing private key:', error.message);
		await bot.sendMessage(chatId, '❌ Failed to retrieve private key.');
	}
}

/**
 * Handle wallet activation
 */
export async function handleWalletActivate(
	chatId: string,
	walletId: string,
	messageId?: number
): Promise<void> {
	try {
		const userId = await getUserId(chatId);
		if (!userId) {
			return;
		}

		const result = await setActiveWallet(userId, walletId);

		if (!result.success) {
			await bot.sendMessage(chatId, `❌ Failed to activate wallet: ${result.error || 'Unknown error'}`);
			return;
		}

		await bot.answerCallbackQuery(chatId, { text: '✅ Wallet activated!' });

		// Refresh wallet detail
		await showWalletDetail(chatId, walletId, messageId);
	} catch (error: any) {
		logger.error('Error activating wallet:', error.message);
	}
}

/**
 * Handle withdraw initiation
 */
export async function handleWithdrawInitiate(
	chatId: string,
	walletId: string,
	messageId?: number
): Promise<void> {
	try {
		const userId = await getUserId(chatId);
		if (!userId) {
			await bot.sendMessage(chatId, '❌ User not found. Please use /start first.');
			return;
		}

		const wallets = await getUserWallets(userId);
		const wallet = wallets.find((w) => w._id.toString() === walletId);

		if (!wallet) {
			await bot.sendMessage(chatId, '❌ Wallet not found.');
			return;
		}

		const balanceResult = await getBnbBalance(wallet.address);
		const balance = balanceResult.success && balanceResult.balance !== undefined ? balanceResult.balance : 0;

		const text = `
💸 <b>Withdraw BNB</b>

Current Balance: <b>${formatBnb(balance)} BNB</b>

Select amount to withdraw or enter custom amount:
        `.trim();

		const keyboard = getWithdrawAmountKeyboard(walletId);

		if (messageId) {
			await bot.editMessageText(text, {
				chat_id: chatId,
				message_id: messageId,
				parse_mode: 'HTML',
				reply_markup: keyboard,
			});
		} else {
			await bot.sendMessage(chatId, text, {
				parse_mode: 'HTML',
				reply_markup: keyboard,
			});
		}
	} catch (error: any) {
		logger.error('Error in withdraw initiate:', error.message);
	}
}

/**
 * Handle withdraw with percentage
 */
export async function handleWithdrawPercent(
	chatId: string,
	walletId: string,
	percent: number,
	messageId?: number
): Promise<void> {
	try {
		const userId = await getUserId(chatId);
		if (!userId) {
			await bot.sendMessage(chatId, '❌ User not found. Please use /start first.');
			return;
		}

		// Get wallet balance
		const wallets = await getUserWallets(userId);
		const wallet = wallets.find((w) => w._id.toString() === walletId);

		if (!wallet) {
			await bot.sendMessage(chatId, '❌ Wallet not found.');
			return;
		}

		const balanceResult = await getBnbBalance(wallet.address);
		const balance = balanceResult.success && balanceResult.balance !== undefined ? balanceResult.balance : 0;
		const amount = (balance * percent) / 100;

		// Ask for destination address
		userStates.set(chatId, {
			action: 'withdraw_address',
			data: { walletId, amount: amount.toString() },
			messageId,
		});

		const text = `
💸 <b>Withdraw ${percent}% (${formatBnb(amount)} BNB)</b>

Send the destination BSC address:

Example:
<code>0x1234567890abcdef...</code>

<i>Send the address now or click Cancel</i>
        `.trim();

		await bot.sendMessage(chatId, text, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [[{ text: '❌ Cancel', callback_data: `wallet_view_${walletId}` }]],
			},
		});
	} catch (error: any) {
		logger.error('Error in withdraw percent:', error.message);
	}
}

/**
 * Process withdraw address
 */
export async function processWithdrawAddress(
	chatId: string,
	toAddress: string,
	msgId: number
): Promise<void> {
	try {
		const state = userStates.get(chatId);
		if (!state || state.action !== 'withdraw_address') {
			return;
		}

		const { walletId, amount } = state.data;

		// Delete message
		try {
			await bot.deleteMessage(chatId, msgId);
		} catch (e) {
			// Ignore
		}

		// Clear state
		userStates.delete(chatId);

		// Send processing message
		const processingMsg = await bot.sendMessage(chatId, '⏳ Processing withdrawal...');

		// Get user ID
		const userId = await getUserId(chatId);
		if (!userId) {
			await bot.deleteMessage(chatId, processingMsg.message_id);
			await bot.sendMessage(chatId, '❌ User not found. Please use /start first.');
			return;
		}

		// Execute transfer
		const result = await transferBnb(walletId, toAddress, amount, userId);

		// Delete processing message
		await bot.deleteMessage(chatId, processingMsg.message_id);

		if (!result.success) {
			await bot.sendMessage(chatId, `❌ Withdrawal failed: ${result.error || 'Unknown error'}`);
			return;
		}

		const text = `
✅ <b>Withdrawal Successful!</b>

Amount: <b>${formatBnb(amount)} BNB</b>
To: <code>${toAddress}</code>

Transaction Hash:
<code>${result.txHash}</code>

View on BscScan:
https://bscscan.com/tx/${result.txHash}
        `.trim();

		await bot.sendMessage(chatId, text, {
			parse_mode: 'HTML',
		});
	} catch (error: any) {
		logger.error('Error processing withdraw address:', error.message);
		await bot.sendMessage(chatId, '❌ Failed to process withdrawal.');
	}
}

/**
 * Handle text messages (for multi-step interactions)
 */
export async function handleWalletTextMessage(msg: TelegramBot.Message): Promise<boolean> {
	const chatId = msg.chat.id.toString();
	const text = msg.text?.trim() || '';
	const state = userStates.get(chatId);

	if (!state) {
		return false;
	}

	// Handle import wallet
	if (state.action === 'import_wallet') {
		await processPrivateKeyImport(chatId, text, msg.message_id);
		return true;
	}

	// Handle withdraw address
	if (state.action === 'withdraw_address') {
		await processWithdrawAddress(chatId, text, msg.message_id);
		return true;
	}

	return false;
}

/**
 * Clear user state
 */
export function clearWalletState(chatId: string): void {
	userStates.delete(chatId);
}
