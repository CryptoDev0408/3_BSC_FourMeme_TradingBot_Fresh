import TelegramBot from 'node-telegram-bot-api';

/**
 * Get orders list keyboard
 */
export function getOrdersListKeyboard(
	orders: Array<{
		_id: string;
		name: string;
		isActive: boolean;
		tradingAmount: number;
		walletName?: string;
	}>
): TelegramBot.InlineKeyboardMarkup {
	const buttons: TelegramBot.InlineKeyboardButton[][] = [];

	// Add order buttons (2 per row)
	for (let i = 0; i < orders.length; i += 2) {
		const row: TelegramBot.InlineKeyboardButton[] = [];

		const order1 = orders[i];
		const status1 = order1.isActive ? '🟢' : '🔴';
		row.push({
			text: `${status1} ${order1.name} - ${order1.tradingAmount} BNB`,
			callback_data: `order_view_${order1._id}`,
		});

		if (i + 1 < orders.length) {
			const order2 = orders[i + 1];
			const status2 = order2.isActive ? '🟢' : '🔴';
			row.push({
				text: `${status2} ${order2.name} - ${order2.tradingAmount} BNB`,
				callback_data: `order_view_${order2._id}`,
			});
		}

		buttons.push(row);
	}

	// Add action buttons
	buttons.push([{ text: '➕ Create New Order', callback_data: 'order_create' }]);

	buttons.push([{ text: '🏠 Main Menu', callback_data: 'main_menu' }]);

	return { inline_keyboard: buttons };
}

/**
 * Get order detail keyboard
 */
export function getOrderDetailKeyboard(orderId: string, isActive: boolean): TelegramBot.InlineKeyboardMarkup {
	const buttons: TelegramBot.InlineKeyboardButton[][] = [];

	// Status toggle button
	if (isActive) {
		buttons.push([{ text: '⏸ Pause Order', callback_data: `order_toggle_${orderId}` }]);
	} else {
		buttons.push([{ text: '▶️ Activate Order', callback_data: `order_toggle_${orderId}` }]);
	}

	// Configuration buttons
	buttons.push([
		{ text: '💼 Change Wallet', callback_data: `order_wallet_${orderId}` },
		{ text: '💰 Set Amount', callback_data: `order_amount_${orderId}` },
	]);

	buttons.push([
		{ text: '🎯 TP/SL Settings', callback_data: `order_tpsl_${orderId}` },
		{ text: '⚡ Gas Settings', callback_data: `order_gas_${orderId}` },
	]);

	buttons.push([
		{ text: '📊 Slippage', callback_data: `order_slippage_${orderId}` },
		{ text: '🪙 Manual Buy', callback_data: `order_manual_${orderId}` },
	]);

	// Danger zone
	buttons.push([{ text: '🗑 Remove Order', callback_data: `order_remove_${orderId}` }]);

	buttons.push([{ text: '⬅️ Back to Orders', callback_data: 'orders' }]);

	return { inline_keyboard: buttons };
}

/**
 * Get wallet selection keyboard for order
 */
export function getOrderWalletSelectionKeyboard(
	orderId: string,
	wallets: Array<{
		_id: string;
		name: string;
		address: string;
		isActive: boolean;
	}>
): TelegramBot.InlineKeyboardMarkup {
	const buttons: TelegramBot.InlineKeyboardButton[][] = [];

	// Add wallet buttons
	for (const wallet of wallets) {
		const statusIcon = wallet.isActive ? '✅' : '⚪️';
		buttons.push([
			{
				text: `${statusIcon} ${wallet.name} (${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)})`,
				callback_data: `order_setwallet_${orderId}_${wallet._id}`,
			},
		]);
	}

	buttons.push([{ text: '❌ Cancel', callback_data: `order_view_${orderId}` }]);

	return { inline_keyboard: buttons };
}

/**
 * Get trading amount keyboard
 */
export function getOrderAmountKeyboard(orderId: string): TelegramBot.InlineKeyboardMarkup {
	const buttons: TelegramBot.InlineKeyboardButton[][] = [];

	// Quick amount buttons
	buttons.push([
		{ text: '0.01 BNB', callback_data: `order_setamount_${orderId}_0.01` },
		{ text: '0.05 BNB', callback_data: `order_setamount_${orderId}_0.05` },
	]);

	buttons.push([
		{ text: '0.1 BNB', callback_data: `order_setamount_${orderId}_0.1` },
		{ text: '0.5 BNB', callback_data: `order_setamount_${orderId}_0.5` },
	]);

	buttons.push([
		{ text: '1 BNB', callback_data: `order_setamount_${orderId}_1` },
		{ text: '5 BNB', callback_data: `order_setamount_${orderId}_5` },
	]);

	buttons.push([{ text: '✏️ Custom Amount', callback_data: `order_customamount_${orderId}` }]);

	buttons.push([{ text: '❌ Cancel', callback_data: `order_view_${orderId}` }]);

	return { inline_keyboard: buttons };
}

/**
 * Get TP/SL settings keyboard
 */
export function getOrderTPSLKeyboard(orderId: string): TelegramBot.InlineKeyboardMarkup {
	const buttons: TelegramBot.InlineKeyboardButton[][] = [];

	buttons.push([
		{ text: '🎯 Set Take Profit %', callback_data: `order_tp_${orderId}` },
		{ text: '🛑 Set Stop Loss %', callback_data: `order_sl_${orderId}` },
	]);

	buttons.push([
		{ text: '✅ Toggle TP On/Off', callback_data: `order_tptoggle_${orderId}` },
		{ text: '✅ Toggle SL On/Off', callback_data: `order_sltoggle_${orderId}` },
	]);

	buttons.push([{ text: '⬅️ Back', callback_data: `order_view_${orderId}` }]);

	return { inline_keyboard: buttons };
}

/**
 * Get gas settings keyboard
 */
export function getOrderGasKeyboard(orderId: string): TelegramBot.InlineKeyboardMarkup {
	const buttons: TelegramBot.InlineKeyboardButton[][] = [];

	buttons.push([
		{ text: '🐢 Slow (3 Gwei)', callback_data: `order_setgas_${orderId}_3` },
		{ text: '🚶 Normal (5 Gwei)', callback_data: `order_setgas_${orderId}_5` },
	]);

	buttons.push([
		{ text: '🏃 Fast (10 Gwei)', callback_data: `order_setgas_${orderId}_10` },
		{ text: '🚀 Turbo (20 Gwei)', callback_data: `order_setgas_${orderId}_20` },
	]);

	buttons.push([{ text: '✏️ Custom Gas', callback_data: `order_customgas_${orderId}` }]);

	buttons.push([{ text: '⬅️ Back', callback_data: `order_view_${orderId}` }]);

	return { inline_keyboard: buttons };
}

/**
 * Get slippage settings keyboard
 */
export function getOrderSlippageKeyboard(orderId: string): TelegramBot.InlineKeyboardMarkup {
	const buttons: TelegramBot.InlineKeyboardButton[][] = [];

	buttons.push([
		{ text: '1%', callback_data: `order_setslippage_${orderId}_1` },
		{ text: '5%', callback_data: `order_setslippage_${orderId}_5` },
		{ text: '10%', callback_data: `order_setslippage_${orderId}_10` },
	]);

	buttons.push([
		{ text: '15%', callback_data: `order_setslippage_${orderId}_15` },
		{ text: '20%', callback_data: `order_setslippage_${orderId}_20` },
		{ text: '25%', callback_data: `order_setslippage_${orderId}_25` },
	]);

	buttons.push([{ text: '✏️ Custom Slippage', callback_data: `order_customslippage_${orderId}` }]);

	buttons.push([{ text: '⬅️ Back', callback_data: `order_view_${orderId}` }]);

	return { inline_keyboard: buttons };
}

/**
 * Get order removal confirmation keyboard
 */
export function getOrderRemoveConfirmKeyboard(orderId: string): TelegramBot.InlineKeyboardMarkup {
	return {
		inline_keyboard: [
			[
				{ text: '✅ Yes, Remove', callback_data: `order_remove_confirm_${orderId}` },
				{ text: '❌ Cancel', callback_data: `order_view_${orderId}` },
			],
		],
	};
}

/**
 * Get manual buy keyboard
 */
export function getManualBuyKeyboard(orderId: string): TelegramBot.InlineKeyboardMarkup {
	return {
		inline_keyboard: [
			[{ text: '🪙 Enter Token Address', callback_data: `order_entertoken_${orderId}` }],
			[{ text: '❌ Cancel', callback_data: `order_view_${orderId}` }],
		],
	};
}
