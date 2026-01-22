import TelegramBot from 'node-telegram-bot-api';

/**
 * Wallet Management Keyboards
 */

/**
 * Get wallet list keyboard
 */
export function getWalletListKeyboard(
	wallets: Array<{ _id: string; name: string; address: string; isActive: boolean; balance: { bnb: number } }>,
	page: number = 0,
	walletsPerPage: number = 5
): TelegramBot.InlineKeyboardMarkup {
	const buttons: TelegramBot.InlineKeyboardButton[][] = [];

	// Paginate wallets
	const start = page * walletsPerPage;
	const end = start + walletsPerPage;
	const paginatedWallets = wallets.slice(start, end);

	// Wallet buttons - show all wallet info
	paginatedWallets.forEach((wallet) => {
		const balance = wallet.balance.bnb.toFixed(4);
		const shortAddr = `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`;

		buttons.push([
			{
				text: `👛 ${wallet.name} | ${shortAddr} | ${balance} BNB`,
				callback_data: `wallet_view_${wallet._id}`,
			},
		]);
	});

	// Pagination buttons
	const paginationRow: TelegramBot.InlineKeyboardButton[] = [];
	if (page > 0) {
		paginationRow.push({ text: '🛡️ Previous', callback_data: `wallets_page_${page - 1}` });
	}
	if (end < wallets.length) {
		paginationRow.push({ text: 'Next ➡️', callback_data: `wallets_page_${page + 1}` });
	}
	if (paginationRow.length > 0) {
		buttons.push(paginationRow);
	}

	// Action buttons
	buttons.push([
		{ text: '⭐ Generate Wallet', callback_data: 'wallet_generate' },
		{ text: '📥 Import Wallet', callback_data: 'wallet_import' },
	]);

	buttons.push([{ text: '🏠 Main Menu', callback_data: 'main_menu' }]);

	return { inline_keyboard: buttons };
}

/**
 * Get wallet detail keyboard
 */
export function getWalletDetailKeyboard(walletId: string, isActive: boolean): TelegramBot.InlineKeyboardMarkup {
	const buttons: TelegramBot.InlineKeyboardButton[][] = [
		[
			{ text: '🔄 Refresh Balance', callback_data: `wallet_refresh_${walletId}` },
			{ text: '✏️ Rename Wallet', callback_data: `wallet_rename_${walletId}` },
		],
		[
			{ text: '💸 Withdraw BNB', callback_data: `wallet_withdraw_${walletId}` },
			{ text: '🗑 Remove Wallet', callback_data: `wallet_remove_${walletId}` },
		],
		[
			{ text: '🔑 Show Private Key', callback_data: `wallet_showkey_${walletId}` },
		],
		[{ text: '🛡️ Back to Wallets', callback_data: 'wallets' }],
	];

	return { inline_keyboard: buttons };
}

/**
 * Get wallet generation confirmation keyboard
 */
export function getWalletGenerateKeyboard(): TelegramBot.InlineKeyboardMarkup {
	return {
		inline_keyboard: [
			[
				{ text: '✅ Generate with Default Name', callback_data: 'wallet_generate_confirm' },
			],
			[
				{ text: '✏️ Generate with Custom Name', callback_data: 'wallet_generate_custom' },
			],
			[{ text: '❌ Cancel', callback_data: 'wallets' }],
		],
	};
}

/**
 * Get wallet import keyboard
 */
export function getWalletImportKeyboard(): TelegramBot.InlineKeyboardMarkup {
	return {
		inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'wallets' }]],
	};
}

/**
 * Get wallet remove confirmation keyboard
 */
export function getWalletRemoveConfirmKeyboard(walletId: string): TelegramBot.InlineKeyboardMarkup {
	return {
		inline_keyboard: [
			[
				{ text: '✅ Yes, Remove', callback_data: `wallet_remove_confirm_${walletId}` },
				{ text: '❌ Cancel', callback_data: `wallet_view_${walletId}` },
			],
		],
	};
}

/**
 * Get withdraw amount keyboard
 */
export function getWithdrawAmountKeyboard(walletId: string): TelegramBot.InlineKeyboardMarkup {
	return {
		inline_keyboard: [
			[
				{ text: '25%', callback_data: `wallet_withdraw_percent_${walletId}_25` },
				{ text: '50%', callback_data: `wallet_withdraw_percent_${walletId}_50` },
			],
			[
				{ text: '75%', callback_data: `wallet_withdraw_percent_${walletId}_75` },
				{ text: '100%', callback_data: `wallet_withdraw_percent_${walletId}_100` },
			],
			[{ text: '✏️ Custom Amount', callback_data: `wallet_withdraw_custom_${walletId}` }],
			[{ text: '❌ Cancel', callback_data: `wallet_view_${walletId}` }],
		],
	};
}
