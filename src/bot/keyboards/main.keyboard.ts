import { InlineKeyboardMarkup } from 'node-telegram-bot-api';

/**
 * Main Menu Keyboard
 */
export function getMainMenuKeyboard(): InlineKeyboardMarkup {
	return {
		inline_keyboard: [
			[
				{ text: '💼 Wallets', callback_data: 'wallets' },
				{ text: '📊 Orders', callback_data: 'orders' },
			],
			[
				{ text: '💰 Positions', callback_data: 'positions' },
				{ text: '🔍 Scanner', callback_data: 'scanner' },
			],
			[
				{ text: 'ℹ️ Help', callback_data: 'help' },
			],
		],
	};
}
