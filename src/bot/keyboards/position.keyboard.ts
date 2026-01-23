import { InlineKeyboardMarkup } from 'node-telegram-bot-api';
import { PositionStatus } from '../../config/constants';

/**
 * Positions list keyboard
 */
export function getPositionsListKeyboard(positionIds: string[]): InlineKeyboardMarkup {
	const keyboard: InlineKeyboardMarkup = {
		inline_keyboard: [],
	};

	// Add position buttons (max 10 for UI readability)
	const displayPositions = positionIds.slice(0, 10);
	for (let i = 0; i < displayPositions.length; i += 2) {
		const row = [];
		row.push({
			text: `Position ${i + 1}`,
			callback_data: `position_view_${displayPositions[i]}`,
		});
		if (i + 1 < displayPositions.length) {
			row.push({
				text: `Position ${i + 2}`,
				callback_data: `position_view_${displayPositions[i + 1]}`,
			});
		}
		keyboard.inline_keyboard.push(row);
	}

	// Back to main menu
	keyboard.inline_keyboard.push([{ text: '🏠 Main Menu', callback_data: 'main_menu' }]);

	return keyboard;
}

/**
 * Position detail keyboard
 */
export function getPositionDetailKeyboard(positionId: string, status: PositionStatus): InlineKeyboardMarkup {
	const keyboard: InlineKeyboardMarkup = {
		inline_keyboard: [],
	};

	// Only show action buttons for active positions
	if (status === PositionStatus.ACTIVE) {
		keyboard.inline_keyboard.push([
			{ text: '🔄 Refresh Price', callback_data: `position_refresh_${positionId}` },
		]);
		keyboard.inline_keyboard.push([
			{ text: '🔴 Sell Position', callback_data: `position_sell_${positionId}` },
		]);
	}

	// Navigation buttons
	keyboard.inline_keyboard.push([
		{ text: '◀️ Back to Positions', callback_data: 'positions' },
		{ text: '🏠 Main Menu', callback_data: 'main_menu' },
	]);

	return keyboard;
}
