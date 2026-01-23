import TelegramBot from 'node-telegram-bot-api';
import { logger } from '../../utils/logger';
import { User } from '../../database/models';
import {
	getUserOrders,
	getOrderById,
	createOrder,
	updateOrderConfig,
	toggleOrderStatus,
	removeOrder,
} from '../../core/order/order.manager';
import { executeManualBuy, validateOrderExecution } from '../../core/order/order.executor';
import { getUserWallets } from '../../core/wallet/wallet.manager';
import { Wallet } from '../../database/models/wallet.model';
import { updateWalletBalance } from '../../core/wallet/wallet.service';
import { isValidAddress, validateBnbAmount, validateSlippage } from '../../utils/validation';
import { formatBnb, formatAddress, formatToggle } from '../../utils/formatter';
import {
	getOrdersListKeyboard,
	getOrderDetailKeyboard,
	getOrderWalletSelectionKeyboard,
	getOrderAmountKeyboard,
	getOrderTPSLKeyboard,
	getOrderGasKeyboard,
	getOrderSlippageKeyboard,
	getOrderRemoveConfirmKeyboard,
} from '../keyboards/order.keyboard';

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
 * User state management for multi-step flows
 */
interface UserState {
	action: string;
	orderId?: string;
	step?: string;
	data?: any;
	lastMessageId?: number;
	orderConfig?: {
		tradingAmount: number;
		slippage: number;
		takeProfitPercent: number;
		takeProfitEnabled: boolean;
		stopLossPercent: number;
		stopLossEnabled: boolean;
	};
}

const userStates = new Map<string, UserState>();

/**
 * Show orders list
 */
export async function showOrdersList(chatId: string, messageId?: number): Promise<void> {
	try {
		console.log('[ORDER_HANDLER] showOrdersList called for chatId:', chatId);

		// Get user
		const user = await User.findOne({ chatId });
		console.log('[ORDER_HANDLER] User found:', user ? user._id : 'null');

		if (!user) {
			await getBot().sendMessage(chatId, '❌ User not found. Please /start the bot first.');
			return;
		}

		// Get orders
		console.log('[ORDER_HANDLER] Fetching orders for userId:', user._id.toString());
		const orders = await getUserOrders(user._id.toString());
		console.log('[ORDER_HANDLER] Orders fetched:', orders.length);

		let text = '📊 <b>Your Orders</b>\n\n';

		if (orders.length === 0) {
			text += '📭 You don\'t have any orders yet.\n\n';
			text += 'Create your first order to start trading!';
		} else {
			text += `You have <b>${orders.length}</b> order(s):\n\n`;
			for (const order of orders) {
				const status = order.isActive ? '🟢 Active' : '🔴 Inactive';
				const walletName = (order.walletId as any)?.name || 'Unknown';
				text += `${status} <b>${order.name}</b>\n`;
				text += `💼 Wallet: ${walletName}\n`;
				text += `💰 Amount: ${formatBnb(order.tradingAmount)} BNB\n`;
				text += `📊 Slippage: ${order.slippage}%\n\n`;
			}
		}

		const keyboard = getOrdersListKeyboard(
			orders.map((o: any) => ({
				_id: o._id.toString(),
				name: o.name,
				isActive: o.isActive,
				tradingAmount: o.tradingAmount,
				walletName: o.walletId?.name,
			}))
		);

		console.log('[ORDER_HANDLER] Sending message...');
		if (messageId) {
			// Try to edit, but if it fails (e.g., message is a photo), delete and send new
			try {
				await getBot().editMessageText(text, {
					chat_id: chatId,
					message_id: messageId,
					parse_mode: 'HTML',
					reply_markup: keyboard,
				});
			} catch (editError: any) {
				// If edit fails, delete old message and send new one
				try {
					await getBot().deleteMessage(chatId, messageId);
				} catch (deleteError) {
					// Ignore delete errors
				}
				await getBot().sendMessage(chatId, text, {
					parse_mode: 'HTML',
					reply_markup: keyboard,
				});
			}
		} else {
			await getBot().sendMessage(chatId, text, {
				parse_mode: 'HTML',
				reply_markup: keyboard,
			});
		}
		console.log('[ORDER_HANDLER] Message sent successfully');
	} catch (error: any) {
		console.error('[ORDER_HANDLER] Error in showOrdersList:', error);
		logger.error('Failed to show orders list:', error.message);
		if (error.stack) {
			logger.debug(error.stack);
		}
		await getBot().sendMessage(chatId, '❌ Failed to load orders. Please try again.');
	}
}

/**
 * Show order detail
 */
export async function showOrderDetail(chatId: string, orderId: string, messageId?: number): Promise<void> {
	try {
		// Get user
		const user = await User.findOne({ chatId });
		if (!user) return;

		// Get order
		const order = await getOrderById(orderId, user._id.toString());
		if (!order) {
			await getBot().sendMessage(chatId, '❌ Order not found.');
			return;
		}

		const wallet = order.walletId as any;
		const walletName = wallet?.name || 'Unknown';
		const walletAddress = wallet?.address || 'Unknown';

		// Get wallet balance
		let walletBalance = 0;
		if (wallet?._id) {
			const balanceResult = await updateWalletBalance(wallet._id.toString());
			if (balanceResult.success && balanceResult.balance !== undefined) {
				walletBalance = balanceResult.balance;
			}
		}

		let text = `📊 <b>${order.name}</b>\n\n`;
		text += `<b>Status:</b> ${order.isActive ? '🟢 Active' : '🔴 Inactive'}\n\n`;

		text += `<b>💼 Wallet Information:</b>\n`;
		text += `📛 Name: ${walletName}\n`;
		text += `📍 Address: <code>${walletAddress}</code>\n`;
		text += `💰 Balance: ${formatBnb(walletBalance)} BNB\n\n`;

		text += `<b>⚙️ Order Configuration:</b>\n`;
		text += `💵 Trading Amount: ${formatBnb(order.tradingAmount)} BNB\n`;
		text += `🎯 Take Profit: ${order.takeProfitPercent}% ${formatToggle(order.takeProfitEnabled)}\n`;
		text += `🛑 Stop Loss: ${order.stopLossPercent}% ${formatToggle(order.stopLossEnabled)}\n`;
		text += `⚡ Gas Price: ${order.gasFee.gasPrice} Gwei\n`;
		text += `📊 Slippage: ${order.slippage}%\n\n`;

		if (order.isActive) {
			text += `<i>Order is active and monitoring for opportunities</i>`;
		} else {
			text += `<i>Configure and activate your order to start trading</i>`;
		}

		const keyboard = {
			inline_keyboard: [
				// Row 1: Active/Pause
				[{
					text: order.isActive ? '⏸ Pause Order' : '▶️ Activate Order',
					callback_data: `order_toggle_${orderId}`
				}],
			],
		};

		// Only show configuration options when order is inactive
		if (!order.isActive) {
			keyboard.inline_keyboard.push(
				// Row 2: Set Trading Amount
				[
					{ text: '💰 Set Trading Amount', callback_data: `order_amount_label_${orderId}` },
					{ text: `${formatBnb(order.tradingAmount)} BNB`, callback_data: `order_amount_input_${orderId}` },
				],
				// Row 3: TP Settings
				[
					{
						text: order.takeProfitEnabled ? '✅ TP Enabled' : '❌ TP Disabled',
						callback_data: `order_tptoggle_${orderId}`
					},
					{ text: `${order.takeProfitPercent}%`, callback_data: `order_tp_input_${orderId}` },
				],
				// Row 4: SL Settings
				[
					{
						text: order.stopLossEnabled ? '✅ SL Enabled' : '❌ SL Disabled',
						callback_data: `order_sltoggle_${orderId}`
					},
					{ text: `${order.stopLossPercent}%`, callback_data: `order_sl_input_${orderId}` },
				],
				// Row 5: Gas Settings
				[
					{ text: '⚡ Gas Settings', callback_data: `order_gas_label_${orderId}` },
					{ text: `${order.gasFee.gasPrice} Gwei`, callback_data: `order_gas_input_${orderId}` },
				],
				// Row 6: Slippage
				[
					{ text: '📊 Slippage', callback_data: `order_slippage_label_${orderId}` },
					{ text: `${order.slippage}%`, callback_data: `order_slippage_input_${orderId}` },
				]
			);
		}

		// Positions row (only show if order has positions)
		const { Position } = await import('../../database/models');
		const positionsCount = await Position.countDocuments({ orderId, userId: user._id });
		if (positionsCount > 0) {
			keyboard.inline_keyboard.push(
				[{ text: '💰 Positions', callback_data: `order_positions_${orderId}` }]
			);
		}

		// Auto Buy Toggle & Manual Buy (always shown regardless of order status)
		keyboard.inline_keyboard.push(
			[
				{
					text: order.autoBuy ? '✅ AutoBuy: ON' : '❌ AutoBuy: OFF',
					callback_data: `order_autobuy_toggle_${orderId}`
				},
				...(order.autoBuy ? [] : [{ text: '🪙 Manual Buy', callback_data: `order_manual_buy_${orderId}` }])
			]
		);

		// Back & Remove buttons (always last row)
		keyboard.inline_keyboard.push(
			[
				{ text: '🛡️ Back to Orders', callback_data: 'orders' },
				{ text: '🗑 Remove Order', callback_data: `order_remove_${orderId}` },
			]
		);

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
		logger.error('Failed to show order detail:', error.message);
		await getBot().sendMessage(chatId, '❌ Failed to load order details.');
	}
}

/**
 * Show positions for a specific order
 */
export async function showOrderPositions(chatId: string, orderId: string, messageId?: number): Promise<void> {
	try {
		// Get user
		const user = await User.findOne({ chatId });
		if (!user) {
			await getBot().sendMessage(chatId, '❌ User not found.');
			return;
		}

		// Get order
		const order = await getOrderById(orderId, user._id.toString());
		if (!order) {
			await getBot().sendMessage(chatId, '❌ Order not found.');
			return;
		}

		// Get positions for this order
		const { Position } = await import('../../database/models');
		const { PositionStatus } = await import('../../config/constants');
		const { formatBnb, formatPercent } = await import('../../utils/formatter');

		const positions = await Position.find({ orderId, userId: user._id })
			.sort({ createdAt: -1 })
			.exec();

		const activePositions = positions.filter((p) => p.status === PositionStatus.ACTIVE);
		const closedPositions = positions.filter((p) => p.status !== PositionStatus.ACTIVE);

		let text = `💰 <b>Positions for Order: ${order.name}</b>\n\n`;

		if (positions.length === 0) {
			text += '📭 No positions yet.\n\n';
			text += 'Use "🪙 Manual Buy" to open positions with this order.';
		} else {
			text += `🟢 Active: ${activePositions.length} | 🔴 Closed: ${closedPositions.length}\n\n`;
			text += 'Click a token to view details or sell:';
		}

		// Create keyboard with token buttons
		const keyboard: TelegramBot.InlineKeyboardMarkup = {
			inline_keyboard: [],
		};

		// Add row for each active position: [Token Name] [Sell]
		if (activePositions.length > 0) {
			for (const pos of activePositions) {
				const pnlEmoji = pos.pnlPercent >= 0 ? '📈' : '📉';
				const pnlSign = pos.pnlPercent >= 0 ? '+' : '';
				keyboard.inline_keyboard.push([
					{
						text: `${pnlEmoji} ${pos.tokenSymbol} (${pnlSign}${formatPercent(pos.pnlPercent)}%)`,
						callback_data: `position_view_${pos._id}`,
					},
					{
						text: `🔴 Sell`,
						callback_data: `position_sell_${pos._id}`,
					},
				]);
			}
		}

		// Add closed positions (view only)
		if (closedPositions.length > 0) {
			for (const pos of closedPositions) {
				const pnlEmoji = pos.pnlPercent >= 0 ? '📈' : '📉';
				const pnlSign = pos.pnlPercent >= 0 ? '+' : '';
				keyboard.inline_keyboard.push([
					{
						text: `${pnlEmoji} ${pos.tokenSymbol} (${pnlSign}${formatPercent(pos.pnlPercent)}%) - CLOSED`,
						callback_data: `position_view_${pos._id}`,
					},
				]);
			}
		}

		// Back button
		keyboard.inline_keyboard.push([
			{ text: '◀️ Back to Order', callback_data: `order_view_${orderId}` },
		]);

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
		logger.error('Failed to show order positions:', error.message);
		await getBot().sendMessage(chatId, '❌ Failed to load positions.');
	}
}

/**
 * Handle order creation - show configuration page
 */
export async function handleOrderCreate(chatId: string, messageId?: number): Promise<void> {
	try {
		// Get user
		const user = await User.findOne({ chatId });
		if (!user) return;

		// Get user's wallets
		const wallets = await getUserWallets(user._id.toString());

		if (wallets.length === 0) {
			await getBot().sendMessage(chatId, '❌ You need to create a wallet first!\n\nGo to 💼 Wallets to create one.');
			return;
		}

		// Use active wallet or first wallet
		const targetWallet = wallets.find((w) => w.isActive) || wallets[0];

		// Initialize order configuration with defaults
		userStates.set(chatId, {
			action: 'order_create',
			data: { walletId: targetWallet._id.toString() },
			orderConfig: {
				tradingAmount: 0.01,
				slippage: 10,
				takeProfitPercent: 50,
				takeProfitEnabled: true,
				stopLossPercent: 25,
				stopLossEnabled: true,
			},
		});

		// Show configuration screen
		await showOrderCreateConfig(chatId, messageId);
	} catch (error: any) {
		logger.error('Failed to show order creation:', error.message);
		await getBot().sendMessage(chatId, '❌ Failed to show order creation. Please try again.');
	}
}

/**
 * Show order creation configuration screen
 */
async function showOrderCreateConfig(chatId: string, messageId?: number): Promise<void> {
	try {
		const state = userStates.get(chatId);
		if (!state || !state.orderConfig) return;

		const config = state.orderConfig;
		const walletId = state.data?.walletId;

		// Get user
		const user = await User.findOne({ chatId });
		if (!user) return;

		// Get wallet info if selected
		let walletInfo = '';
		let walletName = 'Not selected';
		if (walletId) {
			const wallet = await Wallet.findById(walletId);
			if (wallet) {
				const balanceBnb = typeof wallet.balance === 'object' ? wallet.balance.bnb : wallet.balance;
				walletName = `${wallet.name} (${formatBnb(balanceBnb)} BNB)`;
				walletInfo = `💼 Wallet: <b>${wallet.name}</b>\n📍 <code>${wallet.address}</code>\n💰 Balance: <b>${balanceBnb} BNB</b>\n\n`;
			}
		} else {
			walletInfo = '💼 Wallet: <b>Not selected</b>\n\n';
		}

		const text = `
⚙️ <b>Configure New Order</b>

${walletInfo}<b>Trading Settings:</b>
💰 Buy Amount: <b>${config.tradingAmount} BNB</b>
📊 Slippage: <b>${config.slippage}%</b>

<b>Take Profit:</b>
${config.takeProfitEnabled ? '✅ Enabled' : '❌ Disabled'}
📈 Target: <b>${config.takeProfitPercent}%</b>

<b>Stop Loss:</b>
${config.stopLossEnabled ? '✅ Enabled' : '❌ Disabled'}
📉 Target: <b>${config.stopLossPercent}%</b>

<i>Configure each setting then click Create</i>
		`.trim();

		const keyboard = {
			inline_keyboard: [
				// Row 1: Wallet selection
				[
					{ text: '💼 Change Wallet', callback_data: 'order_config_wallet' },
					{ text: walletName, callback_data: 'order_config_wallet' },
				],
				// Row 2: Amount
				[
					{ text: '💰 Amount', callback_data: 'order_config_amount_label' },
					{ text: `${config.tradingAmount} BNB`, callback_data: 'order_config_amount' },
				],
				// Row 3: Slippage
				[
					{ text: '📊 Slippage', callback_data: 'order_config_slippage_label' },
					{ text: `${config.slippage}%`, callback_data: 'order_config_slippage' },
				],
				// Row 4: TP Settings
				[
					{
						text: config.takeProfitEnabled ? '✅ TP Enabled' : '❌ TP Disabled',
						callback_data: 'order_config_tp_toggle'
					},
					{
						text: `📈 ${config.takeProfitPercent}%`,
						callback_data: config.takeProfitEnabled ? 'order_config_tp' : 'order_config_tp_disabled'
					},
				],
				// Row 5: SL Settings
				[
					{
						text: config.stopLossEnabled ? '✅ SL Enabled' : '❌ SL Disabled',
						callback_data: 'order_config_sl_toggle'
					},
					{
						text: `📉 ${config.stopLossPercent}%`,
						callback_data: config.stopLossEnabled ? 'order_config_sl' : 'order_config_sl_disabled'
					},
				],
				// Row 6: Create
				[{ text: '✅ Create Order', callback_data: 'order_config_create' }],
				// Row 7: Back
				[{ text: '🛡️ Back to Orders', callback_data: 'order_config_cancel' }],
			],
		};

		if (messageId) {
			try {
				await getBot().editMessageText(text, {
					chat_id: chatId,
					message_id: messageId,
					parse_mode: 'HTML',
					reply_markup: keyboard,
				});
			} catch (editError) {
				try {
					await getBot().deleteMessage(chatId, messageId);
				} catch { }
				await getBot().sendMessage(chatId, text, {
					parse_mode: 'HTML',
					reply_markup: keyboard,
				});
			}
		} else {
			await getBot().sendMessage(chatId, text, {
				parse_mode: 'HTML',
				reply_markup: keyboard,
			});
		}
	} catch (error: any) {
		logger.error('Failed to show order config:', error.message);
	}
}

/**
 * Handle configuration - Wallet Selection
 */
export async function handleOrderConfigWallet(chatId: string, messageId?: number): Promise<void> {
	try {
		const state = userStates.get(chatId);
		if (!state) return;

		// Get user
		const user = await User.findOne({ chatId });
		if (!user) return;

		// Get user's active wallets
		const wallets = await getUserWallets(user._id.toString());

		if (wallets.length === 0) {
			await getBot().sendMessage(chatId, '❌ You have no active wallets. Please create one first.');
			return;
		}

		const text = `
💼 <b>Select Wallet for Order</b>

Choose which wallet to use for this order:
		`.trim();

		const buttons = wallets.map(wallet => {
			const balanceBnb = typeof wallet.balance === 'object' ? wallet.balance.bnb : wallet.balance;
			return [{
				text: `${wallet._id.toString() === state.data?.walletId ? '✅' : '⚪'} ${wallet.name} | ${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)} | ${balanceBnb} BNB`,
				callback_data: `order_config_setwallet_${wallet._id.toString()}`
			}];
		});

		const keyboard = {
			inline_keyboard: [
				...buttons,
				[{ text: '🛡️ Back', callback_data: 'order_config_back' }],
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
		logger.error('Failed to show wallet selection:', error.message);
	}
}

/**
 * Handle wallet selection for order config
 */
export async function handleOrderSetConfigWallet(chatId: string, walletId: string, messageId?: number): Promise<void> {
	const state = userStates.get(chatId);
	if (!state) return;

	// Update wallet in state
	if (!state.data) state.data = {};
	state.data.walletId = walletId;
	userStates.set(chatId, state);

	// Return to main config screen
	await showOrderCreateConfig(chatId, messageId);
}

/**
 * Handle configuration - Amount
 */
export async function handleOrderConfigAmount(chatId: string, messageId?: number): Promise<void> {
	const state = userStates.get(chatId);
	if (!state) return;

	const text = `
💰 <b>Set Trading Amount</b>

Current: <b>${state.orderConfig?.tradingAmount} BNB</b>

Choose an amount or send custom value:
	`.trim();

	const amounts = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5];
	const keyboard = {
		inline_keyboard: [
			...amounts.map(amt => ([{ text: `${amt} BNB`, callback_data: `order_config_amount_${amt}` }])),
			[{ text: '✏️ Custom BNB', callback_data: 'order_config_amount_custom' }],
			[{ text: '🛡️ Back', callback_data: 'order_config_back' }],
		],
	};

	try {
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
		logger.error('Failed to show amount config:', error.message);
	}
}

/**
 * Set amount value
 */
export async function handleOrderSetConfigAmount(chatId: string, amount: number, messageId?: number): Promise<void> {
	const state = userStates.get(chatId);
	if (!state || !state.orderConfig) return;

	state.orderConfig.tradingAmount = amount;
	userStates.set(chatId, state);

	await showOrderCreateConfig(chatId, messageId);
}

/**
 * Handle custom amount input
 */
export async function handleOrderConfigAmountCustom(chatId: string, messageId?: number): Promise<void> {
	try {
		const state = userStates.get(chatId);
		if (!state || !state.orderConfig) {
			await getBot().sendMessage(chatId, '❌ Configuration lost. Please try again.');
			return;
		}

		// Delete config message
		if (messageId) {
			try {
				await getBot().deleteMessage(chatId, messageId);
			} catch (error) {
				// Ignore delete errors
			}
		}

		// Prompt for custom amount
		const msg = await getBot().sendMessage(
			chatId,
			'✏️ <b>Custom Trading Amount</b>\n\n' +
			'Send the BNB amount (min 0.001).\n\n' +
			'Examples:\n• 0.025\n• 0.15\n• 1.5\n\n' +
			'Type /cancel to abort.',
			{ parse_mode: 'HTML' }
		);

		// Update state to expect custom amount input
		state.action = 'order_config_amount_custom';
		state.lastMessageId = msg.message_id;
	} catch (error: any) {
		logger.error('Failed to handle custom amount input:', error.message);
		await getBot().sendMessage(chatId, '❌ An error occurred. Please try again.');
	}
}

/**
 * Handle configuration - Slippage
 */
export async function handleOrderConfigSlippage(chatId: string, messageId?: number): Promise<void> {
	const state = userStates.get(chatId);
	if (!state) return;

	const text = `
📊 <b>Set Slippage Tolerance</b>

Current: <b>${state.orderConfig?.slippage}%</b>

Choose slippage percentage:
	`.trim();

	const slippages = [1, 5, 10, 15, 20, 30];
	const keyboard = {
		inline_keyboard: [
			...slippages.map(slip => ([{ text: `${slip}%`, callback_data: `order_config_slippage_${slip}` }])),
			[{ text: '🛡️ Back', callback_data: 'order_config_back' }],
		],
	};

	try {
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
		logger.error('Failed to show slippage config:', error.message);
	}
}

/**
 * Set slippage value
 */
export async function handleOrderSetConfigSlippage(chatId: string, slippage: number, messageId?: number): Promise<void> {
	const state = userStates.get(chatId);
	if (!state || !state.orderConfig) return;

	state.orderConfig.slippage = slippage;
	userStates.set(chatId, state);

	await showOrderCreateConfig(chatId, messageId);
}

/**
 * Handle configuration - Take Profit
 */
export async function handleOrderConfigTP(chatId: string, messageId?: number): Promise<void> {
	const state = userStates.get(chatId);
	if (!state || !state.orderConfig) return;

	const config = state.orderConfig;

	const text = `
📈 <b>Configure Take Profit</b>

Status: ${config.takeProfitEnabled ? '✅ Enabled' : '❌ Disabled'}
Target: <b>${config.takeProfitPercent}%</b>

Choose percentage:
	`.trim();

	const percents = [10, 25, 50, 100, 200, 500];
	const keyboard = {
		inline_keyboard: [
			...percents.map(pct => ([{ text: `${pct}%`, callback_data: `order_config_tp_${pct}` }])),
			[{ text: '✏️ Custom %', callback_data: 'order_config_tp_custom' }],
			[{ text: '🛡️ Back', callback_data: 'order_config_back' }],
		],
	};

	try {
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
		logger.error('Failed to show TP config:', error.message);
	}
}

/**
 * Toggle TP or set percentage
 */
export async function handleOrderSetConfigTP(chatId: string, value: number | 'toggle', messageId?: number): Promise<void> {
	const state = userStates.get(chatId);
	if (!state || !state.orderConfig) return;

	if (value === 'toggle') {
		state.orderConfig.takeProfitEnabled = !state.orderConfig.takeProfitEnabled;
		userStates.set(chatId, state);
		// Return to main config screen after toggle
		await showOrderCreateConfig(chatId, messageId);
	} else {
		state.orderConfig.takeProfitPercent = value;
		userStates.set(chatId, state);
		// Return to main config screen after changing percentage
		await showOrderCreateConfig(chatId, messageId);
	}
}

/**
 * Handle configuration - Stop Loss
 */
export async function handleOrderConfigSL(chatId: string, messageId?: number): Promise<void> {
	const state = userStates.get(chatId);
	if (!state || !state.orderConfig) return;

	const config = state.orderConfig;

	const text = `
📉 <b>Configure Stop Loss</b>

Status: ${config.stopLossEnabled ? '✅ Enabled' : '❌ Disabled'}
Target: <b>${config.stopLossPercent}%</b>

Choose percentage:
	`.trim();

	const percents = [5, 10, 25, 50, 75];
	const keyboard = {
		inline_keyboard: [
			...percents.map(pct => ([{ text: `${pct}%`, callback_data: `order_config_sl_${pct}` }])),
			[{ text: '✏️ Custom %', callback_data: 'order_config_sl_custom' }],
			[{ text: '🛡️ Back', callback_data: 'order_config_back' }],
		],
	};

	try {
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
		logger.error('Failed to show SL config:', error.message);
	}
}

/**
 * Toggle SL or set percentage
 */
export async function handleOrderSetConfigSL(chatId: string, value: number | 'toggle', messageId?: number): Promise<void> {
	const state = userStates.get(chatId);
	if (!state || !state.orderConfig) return;

	if (value === 'toggle') {
		state.orderConfig.stopLossEnabled = !state.orderConfig.stopLossEnabled;
		userStates.set(chatId, state);
		// Return to main config screen after toggle
		await showOrderCreateConfig(chatId, messageId);
	} else {
		state.orderConfig.stopLossPercent = value;
		userStates.set(chatId, state);
		// Return to main config screen after changing percentage
		await showOrderCreateConfig(chatId, messageId);
	}
}

/**
 * Handle custom TP percentage input
 */
export async function handleOrderConfigTPCustom(chatId: string, messageId?: number): Promise<void> {
	try {
		const state = userStates.get(chatId);
		if (!state || !state.orderConfig) {
			await getBot().sendMessage(chatId, '❌ Configuration lost. Please try again.');
			return;
		}

		// Delete config message
		if (messageId) {
			try {
				await getBot().deleteMessage(chatId, messageId);
			} catch (error) {
				// Ignore delete errors
			}
		}

		// Prompt for custom percentage
		const msg = await getBot().sendMessage(
			chatId,
			'✏️ <b>Custom Take Profit Percentage</b>\n\n' +
			'Send any positive number (min 0.1).\n\n' +
			'Examples:\n• 75 = +75%\n• 500 = +500%\n• 10000 = +10000%\n\n' +
			'Type /cancel to abort.',
			{ parse_mode: 'HTML' }
		);

		// Update state to expect custom TP input
		state.action = 'order_config_tp_custom';
		state.lastMessageId = msg.message_id;
	} catch (error: any) {
		logger.error('Failed to handle custom TP input:', error.message);
		await getBot().sendMessage(chatId, '❌ An error occurred. Please try again.');
	}
}

/**
 * Handle custom SL percentage input
 */
export async function handleOrderConfigSLCustom(chatId: string, messageId?: number): Promise<void> {
	try {
		const state = userStates.get(chatId);
		if (!state || !state.orderConfig) {
			await getBot().sendMessage(chatId, '❌ Configuration lost. Please try again.');
			return;
		}

		// Delete config message
		if (messageId) {
			try {
				await getBot().deleteMessage(chatId, messageId);
			} catch (error) {
				// Ignore delete errors
			}
		}

		// Prompt for custom percentage
		const msg = await getBot().sendMessage(
			chatId,
			'✏️ <b>Custom Stop Loss Percentage</b>\n\n' +
			'Send any positive number (min 0.1).\n\n' +
			'Examples:\n• 15 = -15%\n• 50 = -50%\n• 90 = -90%\n\n' +
			'Type /cancel to abort.',
			{ parse_mode: 'HTML' }
		);

		// Update state to expect custom SL input
		state.action = 'order_config_sl_custom';
		state.lastMessageId = msg.message_id;
	} catch (error: any) {
		logger.error('Failed to handle custom SL input:', error.message);
		await getBot().sendMessage(chatId, '❌ An error occurred. Please try again.');
	}
}

/**
 * Cancel order configuration
 */
export async function handleOrderConfigCancel(chatId: string, messageId?: number): Promise<void> {
	userStates.delete(chatId);
	await showOrdersList(chatId, messageId);
}

/**
 * Create order with configured settings
 */
export async function handleOrderConfigCreate(chatId: string, messageId?: number): Promise<void> {
	try {
		const state = userStates.get(chatId);
		if (!state || !state.orderConfig || !state.data?.walletId) {
			await getBot().sendMessage(chatId, '❌ Configuration lost. Please try again.');
			return;
		}

		const user = await User.findOne({ chatId });
		if (!user) return;

		const config = state.orderConfig;

		// Check if wallet already has an order
		const existingOrders = await getUserOrders(user._id.toString());
		const walletHasOrder = existingOrders.some(
			(order: any) => order.walletId?._id?.toString() === state.data.walletId
		);

		if (walletHasOrder) {
			const wallet = await Wallet.findById(state.data.walletId);
			const walletName = wallet?.name || 'this wallet';

			await getBot().sendMessage(
				chatId,
				`⚠️ <b>Wallet Already Has an Order</b>\n\n` +
				`The wallet <b>${walletName}</b> already has an order.\n\n` +
				`Each wallet can only have one order at a time. Please select a different wallet or remove the existing order first.`,
				{ parse_mode: 'HTML' }
			);

			// Return to config screen
			await showOrderCreateConfig(chatId, messageId);
			return;
		}

		// Create order with custom settings
		const result = await createOrder(user._id.toString(), state.data.walletId, {
			tradingAmount: config.tradingAmount,
			slippage: config.slippage,
			takeProfitPercent: config.takeProfitPercent,
			takeProfitEnabled: config.takeProfitEnabled,
			stopLossPercent: config.stopLossPercent,
			stopLossEnabled: config.stopLossEnabled,
		});

		// Clear state
		userStates.delete(chatId);

		if (!result.success) {
			await getBot().sendMessage(chatId, `❌ Failed to create order: ${result.error}`);
			return;
		}

		// Delete config message
		if (messageId) {
			try {
				await getBot().deleteMessage(chatId, messageId);
			} catch { }
		}

		await getBot().sendMessage(chatId, `✅ Order created successfully!\n\n📊 <b>${result.order!.name}</b>`, {
			parse_mode: 'HTML',
		});

		// Show order detail
		await showOrderDetail(chatId, result.order!._id.toString());
	} catch (error: any) {
		logger.error('Failed to create order:', error.message);
		await getBot().sendMessage(chatId, '❌ Failed to create order. Please try again.');
	}
}

/**
 * Confirm order creation (legacy - keeping for compatibility)
 */
export async function confirmOrderCreate(chatId: string, messageId?: number): Promise<void> {
	try {
		// Get user
		const user = await User.findOne({ chatId });
		if (!user) return;

		// Get user's wallets
		const wallets = await getUserWallets(user._id.toString());

		if (wallets.length === 0) {
			await getBot().sendMessage(chatId, '❌ You need to create a wallet first!');
			return;
		}

		// Use active wallet or first wallet
		const targetWallet = wallets.find((w) => w.isActive) || wallets[0];

		// Create order
		const result = await createOrder(user._id.toString(), targetWallet._id.toString());

		if (!result.success) {
			await getBot().sendMessage(chatId, `❌ Failed to create order: ${result.error}`);
			return;
		}

		// Delete confirmation message
		if (messageId) {
			try {
				await getBot().deleteMessage(chatId, messageId);
			} catch { }
		}

		await getBot().sendMessage(chatId, `✅ Order created successfully!\n\n📊 <b>${result.order!.name}</b>`, {
			parse_mode: 'HTML',
		});

		// Show order detail
		await showOrderDetail(chatId, result.order!._id.toString());
	} catch (error: any) {
		logger.error('Failed to create order:', error.message);
		await getBot().sendMessage(chatId, '❌ Failed to create order. Please try again.');
	}
}

/**
 * Handle order toggle
 */
export async function handleOrderToggle(chatId: string, orderId: string, messageId?: number): Promise<void> {
	try {
		// Get user
		const user = await User.findOne({ chatId });
		if (!user) return;

		// Toggle order
		const result = await toggleOrderStatus(orderId, user._id.toString());

		if (!result.success) {
			await getBot().sendMessage(chatId, `❌ ${result.error}`);
			return;
		}

		// Show success message
		const status = result.order!.isActive ? '🟢 Active' : '🔴 Inactive';
		const action = result.order!.isActive ? 'activated' : 'paused';

		// Delete old message and send new one with updated status
		if (messageId) {
			try {
				await getBot().deleteMessage(chatId, messageId);
			} catch (error) {
				// Ignore delete errors
			}
		}

		await getBot().sendMessage(
			chatId,
			`✅ Order ${action} successfully!\n\nStatus: ${status}`,
			{ parse_mode: 'HTML' }
		);

		// Show refreshed order view
		await showOrderDetail(chatId, orderId);
	} catch (error: any) {
		logger.error('Failed to toggle order:', error.message);
		await getBot().sendMessage(chatId, '❌ Failed to toggle order status. Please try again.');
	}
}

/**
 * Handle autoBuy toggle
 */
export async function handleAutoBuyToggle(chatId: string, orderId: string, messageId?: number): Promise<void> {
	try {
		// Get user
		const user = await User.findOne({ chatId });
		if (!user) return;

		// Get order
		const order = await getOrderById(orderId, user._id.toString());
		if (!order) {
			await getBot().sendMessage(chatId, '❌ Order not found.');
			return;
		}

		// Toggle autoBuy
		const newAutoBuyStatus = !order.autoBuy;
		await updateOrderConfig(orderId, user._id.toString(), { autoBuy: newAutoBuyStatus });

		// Show success message
		const status = newAutoBuyStatus ? '✅ ON' : '❌ OFF';
		const action = newAutoBuyStatus ? 'enabled' : 'disabled';

		// Delete old message and send new one
		if (messageId) {
			try {
				await getBot().deleteMessage(chatId, messageId);
			} catch (error) {
				// Ignore delete errors
			}
		}

		await getBot().sendMessage(
			chatId,
			`✅ AutoBuy ${action} successfully!\n\nAutoBuy Status: ${status}`,
			{ parse_mode: 'HTML' }
		);

		// Show refreshed order view
		await showOrderDetail(chatId, orderId);
	} catch (error: any) {
		logger.error('Failed to toggle autoBuy:', error.message);
		await getBot().sendMessage(chatId, '❌ Failed to toggle autoBuy. Please try again.');
	}
}

/**
 * Handle wallet selection for order
 */
export async function handleOrderWalletSelection(chatId: string, orderId: string, messageId?: number): Promise<void> {
	try {
		// Get user
		const user = await User.findOne({ chatId });
		if (!user) return;

		// Get wallets
		const wallets = await getUserWallets(user._id.toString());

		if (wallets.length === 0) {
			await getBot().sendMessage(chatId, '❌ No wallets found. Please create a wallet first.');
			return;
		}

		const text = '💼 <b>Select Wallet for Order</b>\n\nChoose which wallet to use for this order:';

		const keyboard = getOrderWalletSelectionKeyboard(
			orderId,
			wallets.map((w) => ({
				_id: w._id.toString(),
				name: w.name,
				address: w.address,
				isActive: w.isActive,
			}))
		);

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
		logger.error('Failed to show wallet selection:', error.message);
	}
}

/**
 * Handle wallet set for order
 */
export async function handleOrderSetWallet(
	chatId: string,
	orderId: string,
	walletId: string,
	messageId?: number
): Promise<void> {
	try {
		// Get user
		const user = await User.findOne({ chatId });
		if (!user) return;

		// Update order
		const result = await updateOrderConfig(orderId, user._id.toString(), { walletId });

		if (!result.success) {
			await getBot().sendMessage(chatId, `❌ ${result.error}`);
			return;
		}

		await getBot().answerCallbackQuery(chatId, { text: '✅ Wallet updated!', show_alert: false });

		// Refresh order view
		await showOrderDetail(chatId, orderId, messageId);
	} catch (error: any) {
		logger.error('Failed to set wallet:', error.message);
	}
}

/**
 * Show amount selection keyboard
 */
export async function showAmountSelection(chatId: string, orderId: string, messageId?: number): Promise<void> {
	const text = '💰 <b>Set Trading Amount</b>\n\nSelect an amount or enter a custom value:';

	const keyboard = getOrderAmountKeyboard(orderId);

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
}

/**
 * Handle amount set
 */
export async function handleOrderSetAmount(
	chatId: string,
	orderId: string,
	amount: number,
	messageId?: number
): Promise<void> {
	try {
		// Get user
		const user = await User.findOne({ chatId });
		if (!user) return;

		// Validate amount
		const validation = validateBnbAmount(amount);
		if (!validation.valid) {
			await getBot().sendMessage(chatId, `❌ ${validation.error}`);
			return;
		}

		// Update order
		const result = await updateOrderConfig(orderId, user._id.toString(), { tradingAmount: amount });

		if (!result.success) {
			await getBot().sendMessage(chatId, `❌ ${result.error}`);
			return;
		}

		await getBot().answerCallbackQuery(chatId, { text: '✅ Amount updated!', show_alert: false });

		// Refresh order view
		await showOrderDetail(chatId, orderId, messageId);
	} catch (error: any) {
		logger.error('Failed to set amount:', error.message);
	}
}

/**
 * Show TP/SL settings
 */
export async function showTPSLSettings(chatId: string, orderId: string, messageId?: number): Promise<void> {
	try {
		// Get user
		const user = await User.findOne({ chatId });
		if (!user) return;

		// Get order
		const order = await getOrderById(orderId, user._id.toString());
		if (!order) return;

		const text = `
🎯 <b>Take Profit / Stop Loss Settings</b>

<b>Take Profit:</b>
${order.takeProfitEnabled ? '✅ Enabled' : '❌ Disabled'}
📈 Target: <b>${order.takeProfitPercent}%</b>

<b>Stop Loss:</b>
${order.stopLossEnabled ? '✅ Enabled' : '❌ Disabled'}
📉 Target: <b>${order.stopLossPercent}%</b>

<i>Configure when to take profit or stop losses on your trades</i>
		`.trim();

		const keyboard = {
			inline_keyboard: [
				[
					{
						text: order.takeProfitEnabled ? '✅ TP Enabled' : '❌ TP Disabled',
						callback_data: `order_tptoggle_${orderId}`
					},
					{
						text: `📈 ${order.takeProfitPercent}%`,
						callback_data: `order_tp_${orderId}`
					},
				],
				[
					{
						text: order.stopLossEnabled ? '✅ SL Enabled' : '❌ SL Disabled',
						callback_data: `order_sltoggle_${orderId}`
					},
					{
						text: `📉 ${order.stopLossPercent}%`,
						callback_data: `order_sl_${orderId}`
					},
				],
				[{ text: '🛡️ Back', callback_data: `order_view_${orderId}` }],
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
		logger.error('Failed to show TP/SL settings:', error.message);
	}
}

/**
 * Show gas settings
 */
export async function showGasSettings(chatId: string, orderId: string, messageId?: number): Promise<void> {
	const text = '⚡ <b>Gas Settings</b>\n\nSelect gas price for transactions:';

	const keyboard = getOrderGasKeyboard(orderId);

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
}

/**
 * Handle gas set
 */
export async function handleOrderSetGas(
	chatId: string,
	orderId: string,
	gasPrice: string,
	messageId?: number
): Promise<void> {
	try {
		// Get user
		const user = await User.findOne({ chatId });
		if (!user) return;

		// Update order
		const result = await updateOrderConfig(orderId, user._id.toString(), {
			gasFee: { gasPrice },
		});

		if (!result.success) {
			await getBot().sendMessage(chatId, `❌ ${result.error}`);
			return;
		}

		await getBot().answerCallbackQuery(chatId, { text: '✅ Gas price updated!', show_alert: false });

		// Refresh order view
		await showOrderDetail(chatId, orderId, messageId);
	} catch (error: any) {
		logger.error('Failed to set gas:', error.message);
	}
}

/**
 * Show slippage selection
 */
export async function showSlippageSelection(chatId: string, orderId: string, messageId?: number): Promise<void> {
	const text = '📊 <b>Slippage Tolerance</b>\n\nSelect slippage percentage:';

	const keyboard = getOrderSlippageKeyboard(orderId);

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
}

/**
 * Handle slippage set
 */
export async function handleOrderSetSlippage(
	chatId: string,
	orderId: string,
	slippage: number,
	messageId?: number
): Promise<void> {
	try {
		// Get user
		const user = await User.findOne({ chatId });
		if (!user) return;

		// Validate slippage
		const validation = validateSlippage(slippage);
		if (!validation.valid) {
			await getBot().sendMessage(chatId, `❌ ${validation.error}`);
			return;
		}

		// Update order
		const result = await updateOrderConfig(orderId, user._id.toString(), { slippage });

		if (!result.success) {
			await getBot().sendMessage(chatId, `❌ ${result.error}`);
			return;
		}

		await getBot().answerCallbackQuery(chatId, { text: '✅ Slippage updated!', show_alert: false });

		// Refresh order view
		await showOrderDetail(chatId, orderId, messageId);
	} catch (error: any) {
		logger.error('Failed to set slippage:', error.message);
	}
}

/**
 * Handle direct amount input
 */
export async function handleAmountInput(chatId: string, orderId: string, messageId?: number): Promise<void> {
	try {
		const text = '💰 <b>Set Trading Amount</b>\n\nEnter the amount of BNB you want to trade:\n\n<i>Example: 0.1</i>';

		userStates.set(chatId, {
			action: 'order_amount_input',
			orderId,
		});

		if (messageId) {
			await getBot().editMessageText(text, {
				chat_id: chatId,
				message_id: messageId,
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [[{ text: '❌ Cancel', callback_data: `order_view_${orderId}` }]],
				},
			});
		} else {
			await getBot().sendMessage(chatId, text, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [[{ text: '❌ Cancel', callback_data: `order_view_${orderId}` }]],
				},
			});
		}
	} catch (error: any) {
		logger.error('Failed to show amount input:', error.message);
	}
}

/**
 * Handle direct TP input
 */
export async function handleTPInput(chatId: string, orderId: string, messageId?: number): Promise<void> {
	try {
		const text = '🎯 <b>Set Take Profit %</b>\n\nEnter the take profit percentage:\n\n<i>Example: 50</i>';

		userStates.set(chatId, {
			action: 'order_tp_input',
			orderId,
		});

		if (messageId) {
			await getBot().editMessageText(text, {
				chat_id: chatId,
				message_id: messageId,
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [[{ text: '❌ Cancel', callback_data: `order_view_${orderId}` }]],
				},
			});
		} else {
			await getBot().sendMessage(chatId, text, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [[{ text: '❌ Cancel', callback_data: `order_view_${orderId}` }]],
				},
			});
		}
	} catch (error: any) {
		logger.error('Failed to show TP input:', error.message);
	}
}

/**
 * Handle direct SL input
 */
export async function handleSLInput(chatId: string, orderId: string, messageId?: number): Promise<void> {
	try {
		const text = '🛑 <b>Set Stop Loss %</b>\n\nEnter the stop loss percentage:\n\n<i>Example: 25</i>';

		userStates.set(chatId, {
			action: 'order_sl_input',
			orderId,
		});

		if (messageId) {
			await getBot().editMessageText(text, {
				chat_id: chatId,
				message_id: messageId,
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [[{ text: '❌ Cancel', callback_data: `order_view_${orderId}` }]],
				},
			});
		} else {
			await getBot().sendMessage(chatId, text, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [[{ text: '❌ Cancel', callback_data: `order_view_${orderId}` }]],
				},
			});
		}
	} catch (error: any) {
		logger.error('Failed to show SL input:', error.message);
	}
}

/**
 * Handle direct gas input
 */
export async function handleGasInput(chatId: string, orderId: string, messageId?: number): Promise<void> {
	try {
		const text = '⚡ <b>Set Gas Price</b>\n\nEnter the gas price in Gwei:\n\n<i>Example: 5</i>';

		userStates.set(chatId, {
			action: 'order_gas_input',
			orderId,
		});

		if (messageId) {
			await getBot().editMessageText(text, {
				chat_id: chatId,
				message_id: messageId,
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [[{ text: '❌ Cancel', callback_data: `order_view_${orderId}` }]],
				},
			});
		} else {
			await getBot().sendMessage(chatId, text, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [[{ text: '❌ Cancel', callback_data: `order_view_${orderId}` }]],
				},
			});
		}
	} catch (error: any) {
		logger.error('Failed to show gas input:', error.message);
	}
}

/**
 * Handle direct slippage input
 */
export async function handleSlippageInput(chatId: string, orderId: string, messageId?: number): Promise<void> {
	try {
		const text = '📊 <b>Set Slippage</b>\n\nEnter the slippage percentage:\n\n<i>Example: 10</i>';

		userStates.set(chatId, {
			action: 'order_slippage_input',
			orderId,
		});

		if (messageId) {
			await getBot().editMessageText(text, {
				chat_id: chatId,
				message_id: messageId,
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [[{ text: '❌ Cancel', callback_data: `order_view_${orderId}` }]],
				},
			});
		} else {
			await getBot().sendMessage(chatId, text, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [[{ text: '❌ Cancel', callback_data: `order_view_${orderId}` }]],
				},
			});
		}
	} catch (error: any) {
		logger.error('Failed to show slippage input:', error.message);
	}
}

/**
 * Handle order removal confirmation
 */
export async function handleOrderRemove(chatId: string, orderId: string, messageId?: number): Promise<void> {
	const text = '🗑 <b>Remove Order</b>\n\n⚠️ Are you sure you want to remove this order?\n\nThis action cannot be undone.';

	const keyboard = getOrderRemoveConfirmKeyboard(orderId);

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
}

/**
 * Confirm order removal
 */
export async function confirmOrderRemove(chatId: string, orderId: string, messageId?: number): Promise<void> {
	try {
		// Get user
		const user = await User.findOne({ chatId });
		if (!user) return;

		// Remove order
		const result = await removeOrder(orderId, user._id.toString());

		if (!result.success) {
			await getBot().sendMessage(chatId, `❌ ${result.error}`);
			return;
		}

		if (messageId) {
			await getBot().deleteMessage(chatId, messageId);
		}

		await getBot().sendMessage(chatId, '✅ Order removed successfully!');

		// Show orders list
		await showOrdersList(chatId);
	} catch (error: any) {
		logger.error('Failed to remove order:', error.message);
		await getBot().sendMessage(chatId, '❌ Failed to remove order.');
	}
}

/**
 * Handle manual buy initiation
 */
export async function handleManualBuy(chatId: string, orderId: string, messageId?: number): Promise<void> {
	const text =
		'🪙 <b>Manual Token Buy</b>\n\nEnter the token contract address you want to buy:\n\n<i>Example: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb</i>';

	// Set user state
	userStates.set(chatId, {
		action: 'manual_buy',
		orderId,
	});

	if (messageId) {
		await getBot().editMessageText(text, {
			chat_id: chatId,
			message_id: messageId,
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [[{ text: '❌ Cancel', callback_data: `order_view_${orderId}` }]],
			},
		});
	} else {
		await getBot().sendMessage(chatId, text, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [[{ text: '❌ Cancel', callback_data: `order_view_${orderId}` }]],
			},
		});
	}
}

/**
 * Handle text input for order operations
 */
export async function handleOrderTextMessage(msg: any): Promise<boolean> {
	const chatId = msg.chat.id.toString();
	const text = msg.text?.trim();

	if (!text) return false;

	const state = userStates.get(chatId);
	if (!state) return false;

	try {
		// Handle custom amount input
		if (state.action === 'order_config_amount_custom') {
			// Delete prompt message
			if (state.lastMessageId) {
				try {
					await getBot().deleteMessage(chatId, state.lastMessageId);
				} catch (error) {
					// Ignore delete errors
				}
			}

			// Delete user's message
			try {
				await getBot().deleteMessage(chatId, msg.message_id);
			} catch (error) {
				// Ignore delete errors
			}

			// Parse amount
			const amount = parseFloat(text);

			// Validate
			if (isNaN(amount) || amount < 0.001) {
				await getBot().sendMessage(
					chatId,
					'❌ Invalid amount. Please enter a number greater than or equal to 0.001 BNB.',
				);
				// Don't clear state, let user try again
				return true;
			}

			// Update config
			if (state.orderConfig) {
				state.orderConfig.tradingAmount = amount;
			}

			// Show main config screen
			await showOrderCreateConfig(chatId);
			return true;
		}

		// Handle custom Take Profit percentage input
		if (state.action === 'order_config_tp_custom') {
			// Delete prompt message
			if (state.lastMessageId) {
				try {
					await getBot().deleteMessage(chatId, state.lastMessageId);
				} catch (error) {
					// Ignore delete errors
				}
			}

			// Delete user's message
			try {
				await getBot().deleteMessage(chatId, msg.message_id);
			} catch (error) {
				// Ignore delete errors
			}

			// Parse percentage
			const percentage = parseFloat(text);

			// Validate
			if (isNaN(percentage) || percentage < 0.1) {
				await getBot().sendMessage(
					chatId,
					'❌ Invalid percentage. Please enter a number greater than 0.1.',
				);
				// Don't clear state, let user try again
				return true;
			}

			// Update config
			if (state.orderConfig) {
				state.orderConfig.takeProfitPercent = percentage;
			}

			// Show main config screen
			await showOrderCreateConfig(chatId);
			return true;
		}

		// Handle custom Stop Loss percentage input
		if (state.action === 'order_config_sl_custom') {
			// Delete prompt message
			if (state.lastMessageId) {
				try {
					await getBot().deleteMessage(chatId, state.lastMessageId);
				} catch (error) {
					// Ignore delete errors
				}
			}

			// Delete user's message
			try {
				await getBot().deleteMessage(chatId, msg.message_id);
			} catch (error) {
				// Ignore delete errors
			}

			// Parse percentage
			const percentage = parseFloat(text);

			// Validate
			if (isNaN(percentage) || percentage < 0.1) {
				await getBot().sendMessage(
					chatId,
					'❌ Invalid percentage. Please enter a number greater than 0.1.',
				);
				// Don't clear state, let user try again
				return true;
			}

			// Update config
			if (state.orderConfig) {
				state.orderConfig.stopLossPercent = percentage;
			}

			// Show main config screen
			await showOrderCreateConfig(chatId);
			return true;
		}

		// Handle custom TP input for existing order
		if (state.action === 'order_tp_custom') {
			// Parse percentage
			const percentage = parseFloat(text);

			// Validate
			if (isNaN(percentage) || percentage < 0.1) {
				await getBot().sendMessage(
					chatId,
					'❌ Invalid percentage. Please enter a number greater than 0.1.',
				);
				return true;
			}

			// Get user
			const user = await User.findOne({ chatId });
			if (!user || !state.orderId) {
				await getBot().sendMessage(chatId, '❌ Order not found.');
				userStates.delete(chatId);
				return true;
			}

			// Update order
			const result = await updateOrderConfig(state.orderId, user._id.toString(), {
				takeProfitPercent: percentage,
			});

			if (!result.success) {
				await getBot().sendMessage(chatId, `❌ ${result.error}`);
			} else {
				await getBot().sendMessage(chatId, '✅ Take Profit updated!');
				await showOrderDetail(chatId, state.orderId);
			}

			userStates.delete(chatId);
			return true;
		}

		// Handle direct amount input
		if (state.action === 'order_amount_input') {
			const amount = parseFloat(text);
			if (isNaN(amount) || amount < 0.00001) {
				await getBot().sendMessage(chatId, '❌ Invalid amount. Minimum is 0.00001 BNB.');
				return true;
			}

			const user = await User.findOne({ chatId });
			if (!user || !state.orderId) {
				await getBot().sendMessage(chatId, '❌ Order not found.');
				userStates.delete(chatId);
				return true;
			}

			const result = await updateOrderConfig(state.orderId, user._id.toString(), { tradingAmount: amount });
			if (!result.success) {
				await getBot().sendMessage(chatId, `❌ ${result.error}`);
			} else {
				await getBot().sendMessage(chatId, '✅ Amount updated!');
				await showOrderDetail(chatId, state.orderId);
			}

			userStates.delete(chatId);
			return true;
		}

		// Handle direct TP input
		if (state.action === 'order_tp_input') {
			const percentage = parseFloat(text);
			if (isNaN(percentage) || percentage < 0.1) {
				await getBot().sendMessage(chatId, '❌ Invalid percentage. Minimum is 0.1%.');
				return true;
			}

			const user = await User.findOne({ chatId });
			if (!user || !state.orderId) {
				await getBot().sendMessage(chatId, '❌ Order not found.');
				userStates.delete(chatId);
				return true;
			}

			const result = await updateOrderConfig(state.orderId, user._id.toString(), { takeProfitPercent: percentage });
			if (!result.success) {
				await getBot().sendMessage(chatId, `❌ ${result.error}`);
			} else {
				await getBot().sendMessage(chatId, '✅ Take Profit updated!');
				await showOrderDetail(chatId, state.orderId);
			}

			userStates.delete(chatId);
			return true;
		}

		// Handle direct SL input
		if (state.action === 'order_sl_input') {
			const percentage = parseFloat(text);
			if (isNaN(percentage) || percentage < 0.1) {
				await getBot().sendMessage(chatId, '❌ Invalid percentage. Minimum is 0.1%.');
				return true;
			}

			const user = await User.findOne({ chatId });
			if (!user || !state.orderId) {
				await getBot().sendMessage(chatId, '❌ Order not found.');
				userStates.delete(chatId);
				return true;
			}

			const result = await updateOrderConfig(state.orderId, user._id.toString(), { stopLossPercent: percentage });
			if (!result.success) {
				await getBot().sendMessage(chatId, `❌ ${result.error}`);
			} else {
				await getBot().sendMessage(chatId, '✅ Stop Loss updated!');
				await showOrderDetail(chatId, state.orderId);
			}

			userStates.delete(chatId);
			return true;
		}

		// Handle direct gas input
		if (state.action === 'order_gas_input') {
			const gasPrice = parseFloat(text);
			if (isNaN(gasPrice) || gasPrice < 1) {
				await getBot().sendMessage(chatId, '❌ Invalid gas price. Minimum is 1 Gwei.');
				return true;
			}

			const user = await User.findOne({ chatId });
			if (!user || !state.orderId) {
				await getBot().sendMessage(chatId, '❌ Order not found.');
				userStates.delete(chatId);
				return true;
			}

			const result = await updateOrderConfig(state.orderId, user._id.toString(), { gasFee: { gasPrice: gasPrice.toString() } });
			if (!result.success) {
				await getBot().sendMessage(chatId, `❌ ${result.error}`);
			} else {
				await getBot().sendMessage(chatId, '✅ Gas price updated!');
				await showOrderDetail(chatId, state.orderId);
			}

			userStates.delete(chatId);
			return true;
		}

		// Handle direct slippage input
		if (state.action === 'order_slippage_input') {
			const slippage = parseFloat(text);
			if (isNaN(slippage) || slippage < 0.1 || slippage > 100) {
				await getBot().sendMessage(chatId, '❌ Invalid slippage. Must be between 0.1% and 100%.');
				return true;
			}

			const user = await User.findOne({ chatId });
			if (!user || !state.orderId) {
				await getBot().sendMessage(chatId, '❌ Order not found.');
				userStates.delete(chatId);
				return true;
			}

			const result = await updateOrderConfig(state.orderId, user._id.toString(), { slippage });
			if (!result.success) {
				await getBot().sendMessage(chatId, `❌ ${result.error}`);
			} else {
				await getBot().sendMessage(chatId, '✅ Slippage updated!');
				await showOrderDetail(chatId, state.orderId);
			}

			userStates.delete(chatId);
			return true;
		}

		// Handle custom SL input for existing order
		if (state.action === 'order_sl_custom') {
			// Parse percentage
			const percentage = parseFloat(text);

			// Validate
			if (isNaN(percentage) || percentage < 0.1) {
				await getBot().sendMessage(
					chatId,
					'❌ Invalid percentage. Please enter a number greater than 0.1.',
				);
				return true;
			}

			// Get user
			const user = await User.findOne({ chatId });
			if (!user || !state.orderId) {
				await getBot().sendMessage(chatId, '❌ Order not found.');
				userStates.delete(chatId);
				return true;
			}

			// Update order
			const result = await updateOrderConfig(state.orderId, user._id.toString(), {
				takeProfitPercent: percentage,
			});

			if (!result.success) {
				await getBot().sendMessage(chatId, `❌ ${result.error}`);
			} else {
				await getBot().sendMessage(chatId, '✅ Take Profit updated!');
				await showTPSLSettings(chatId, state.orderId);
			}

			userStates.delete(chatId);
			return true;
		}

		// Handle custom SL input for existing order
		if (state.action === 'order_sl_custom') {
			// Parse percentage
			const percentage = parseFloat(text);

			// Validate
			if (isNaN(percentage) || percentage < 0.1) {
				await getBot().sendMessage(
					chatId,
					'❌ Invalid percentage. Please enter a number greater than 0.1.',
				);
				return true;
			}

			// Get user
			const user = await User.findOne({ chatId });
			if (!user || !state.orderId) {
				await getBot().sendMessage(chatId, '❌ Order not found.');
				userStates.delete(chatId);
				return true;
			}

			// Update order
			const result = await updateOrderConfig(state.orderId, user._id.toString(), {
				stopLossPercent: percentage,
			});

			if (!result.success) {
				await getBot().sendMessage(chatId, `❌ ${result.error}`);
			} else {
				await getBot().sendMessage(chatId, '✅ Stop Loss updated!');
				await showTPSLSettings(chatId, state.orderId);
			}

			userStates.delete(chatId);
			return true;
		}

		if (state.action === 'manual_buy') {
			// Validate token address
			if (!isValidAddress(text)) {
				await getBot().sendMessage(chatId, '❌ Invalid token address. Please enter a valid BSC address.');
				return true;
			}

			// Show validating message
			const validatingMsg = await getBot().sendMessage(chatId, '⏳ Validating token...\n\nChecking PancakeSwap V2 pair...');

			// Import token validator
			const { tokenValidator } = await import('../../core/token/token.validator');

			// Validate token first to get pair address
			const tokenValidation = await tokenValidator.validateToken(text);

			if (!tokenValidation.isValid) {
				await getBot().editMessageText(
					`❌ Token validation failed:\n\n${tokenValidation.error}`,
					{ chat_id: chatId, message_id: validatingMsg.message_id }
				);
				userStates.delete(chatId);
				return true;
			}

			// Show pair info
			let pairInfoText = '✅ <b>Token Validated!</b>\n\n';
			pairInfoText += `Token: <code>${text}</code>\n`;
			if (tokenValidation.token) {
				pairInfoText += `Name: ${tokenValidation.token.name}\n`;
				pairInfoText += `Symbol: ${tokenValidation.token.symbol}\n`;
			}
			if (tokenValidation.pairAddress) {
				pairInfoText += `\n📊 <b>PancakeSwap V2 Pair:</b>\n<code>${tokenValidation.pairAddress}</code>\n`;
			}
			if (tokenValidation.liquidityBnb !== undefined) {
				pairInfoText += `💧 Liquidity: ${tokenValidation.liquidityBnb.toFixed(4)} BNB\n`;
			}
			pairInfoText += '\n⏳ Executing buy order...';

			await getBot().editMessageText(pairInfoText, {
				chat_id: chatId,
				message_id: validatingMsg.message_id,
				parse_mode: 'HTML'
			});

			// Get user
			const user = await User.findOne({ chatId });
			if (!user) {
				await getBot().sendMessage(chatId, '❌ User not found.');
				return true;
			}

			// Get order with wallet
			const order = await getOrderById(state.orderId!, user._id.toString());
			if (!order) {
				await getBot().sendMessage(chatId, '❌ Order not found.');
				return true;
			}

			const wallet = order.walletId as any;
			if (!wallet) {
				await getBot().sendMessage(chatId, '❌ Wallet not found.');
				return true;
			}

			// Update wallet balance
			await updateWalletBalance(wallet._id.toString());

			// Validate execution
			const validation = validateOrderExecution(order, wallet);
			if (!validation.valid) {
				await getBot().sendMessage(chatId, `❌ ${validation.error}`);
				return true;
			}

			// Execute buy
			const result = await executeManualBuy(state.orderId!, user._id.toString(), text);

			if (!result.success) {
				await getBot().sendMessage(chatId, `❌ Buy failed:\n\n${result.error}`);
			} else {
				// Fetch transaction details from database
				const { Transaction } = await import('../../database/models');
				const transaction = await Transaction.findOne({ txHash: result.txHash }).sort({ createdAt: -1 });

				let successText = '✅ <b>Buy Successful!</b>\n\n';
				successText += `🪙 <b>Token:</b> <code>${result.tokenAddress}</code>\n`;
				if (tokenValidation.token) {
					successText += `📛 <b>Symbol:</b> ${tokenValidation.token.symbol}\n`;
					successText += `📝 <b>Name:</b> ${tokenValidation.token.name}\n`;
				}

				if (tokenValidation.pairAddress) {
					successText += `\n📊 <b>Pair Address:</b>\n<code>${tokenValidation.pairAddress}</code>\n`;
				}

				if (tokenValidation.liquidityBnb !== undefined) {
					successText += `💧 <b>Liquidity:</b> ${tokenValidation.liquidityBnb.toFixed(4)} BNB\n`;
				}

				// Add transaction details if found
				if (transaction) {
					successText += `\n💰 <b>Amount Spent:</b> ${transaction.amountBnb.toFixed(4)} BNB\n`;
					if (transaction.amountToken) {
						successText += `🎯 <b>Tokens Received:</b> ${transaction.amountToken.toFixed(2)}\n`;
					}
					if (transaction.gasFee) {
						successText += `⛽ <b>Gas Fee:</b> ${transaction.gasFee.toFixed(6)} BNB\n`;
					}
				}

				successText += `\n💳 <b>Transaction Hash:</b>\n<code>${result.txHash}</code>\n\n`;
				successText += `🔗 <a href="https://bscscan.com/tx/${result.txHash}">View on BSCScan</a>`;

				await getBot().sendMessage(chatId, successText, { parse_mode: 'HTML', disable_web_page_preview: true });
			}

			// Clear state
			userStates.delete(chatId);
			return true;
		}
	} catch (error: any) {
		logger.error('Failed to handle order text message:', error.message);
		await getBot().sendMessage(chatId, '❌ An error occurred. Please try again.');
		userStates.delete(chatId);
	}

	return false;
}

/**
 * Clear user state
 */
export function clearOrderState(chatId: string): void {
	userStates.delete(chatId);
}

/**
 * Toggle TP enabled
 */
export async function toggleTPEnabled(chatId: string, orderId: string, messageId?: number): Promise<void> {
	try {
		const user = await User.findOne({ chatId });
		if (!user) return;

		const order = await getOrderById(orderId, user._id.toString());
		if (!order) return;

		await updateOrderConfig(orderId, user._id.toString(), {
			takeProfitEnabled: !order.takeProfitEnabled,
		});

		await showTPSLSettings(chatId, orderId, messageId);
	} catch (error: any) {
		logger.error('Failed to toggle TP:', error.message);
	}
}

/**
 * Toggle SL enabled
 */
export async function toggleSLEnabled(chatId: string, orderId: string, messageId?: number): Promise<void> {
	try {
		const user = await User.findOne({ chatId });
		if (!user) return;

		const order = await getOrderById(orderId, user._id.toString());
		if (!order) return;

		await updateOrderConfig(orderId, user._id.toString(), {
			stopLossEnabled: !order.stopLossEnabled,
		});

		await showTPSLSettings(chatId, orderId, messageId);
	} catch (error: any) {
		logger.error('Failed to toggle SL:', error.message);
	}
}

/**
 * Show Take Profit percentage selection
 */
export async function showTPSelection(chatId: string, orderId: string, messageId?: number): Promise<void> {
	try {
		const text = '📈 <b>Take Profit Percentage</b>\n\nSelect or enter a custom percentage for taking profits:';

		const keyboard = {
			inline_keyboard: [
				[
					{ text: '10%', callback_data: `order_settp_${orderId}_10` },
					{ text: '25%', callback_data: `order_settp_${orderId}_25` },
					{ text: '50%', callback_data: `order_settp_${orderId}_50` },
				],
				[
					{ text: '75%', callback_data: `order_settp_${orderId}_75` },
					{ text: '100%', callback_data: `order_settp_${orderId}_100` },
					{ text: '150%', callback_data: `order_settp_${orderId}_150` },
				],
				[
					{ text: '200%', callback_data: `order_settp_${orderId}_200` },
					{ text: '300%', callback_data: `order_settp_${orderId}_300` },
					{ text: '500%', callback_data: `order_settp_${orderId}_500` },
				],
				[{ text: '✏️ Custom %', callback_data: `order_customtp_${orderId}` }],
				[{ text: '🛡️ Back', callback_data: `order_tpsl_${orderId}` }],
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
		logger.error('Failed to show TP selection:', error.message);
	}
}

/**
 * Show Stop Loss percentage selection
 */
export async function showSLSelection(chatId: string, orderId: string, messageId?: number): Promise<void> {
	try {
		const text = '📉 <b>Stop Loss Percentage</b>\n\nSelect or enter a custom percentage for stop losses:';

		const keyboard = {
			inline_keyboard: [
				[
					{ text: '5%', callback_data: `order_setsl_${orderId}_5` },
					{ text: '10%', callback_data: `order_setsl_${orderId}_10` },
					{ text: '15%', callback_data: `order_setsl_${orderId}_15` },
				],
				[
					{ text: '20%', callback_data: `order_setsl_${orderId}_20` },
					{ text: '25%', callback_data: `order_setsl_${orderId}_25` },
					{ text: '30%', callback_data: `order_setsl_${orderId}_30` },
				],
				[
					{ text: '40%', callback_data: `order_setsl_${orderId}_40` },
					{ text: '50%', callback_data: `order_setsl_${orderId}_50` },
					{ text: '75%', callback_data: `order_setsl_${orderId}_75` },
				],
				[{ text: '✏️ Custom %', callback_data: `order_customsl_${orderId}` }],
				[{ text: '🛡️ Back', callback_data: `order_tpsl_${orderId}` }],
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
		logger.error('Failed to show SL selection:', error.message);
	}
}

/**
 * Handle Take Profit percentage set
 */
export async function handleSetTP(
	chatId: string,
	orderId: string,
	percentage: number,
	queryId: string,
	messageId?: number
): Promise<void> {
	try {
		const user = await User.findOne({ chatId });
		if (!user) return;

		// Validate percentage
		if (percentage < 0.1) {
			await getBot().answerCallbackQuery(queryId, { text: '❌ Invalid percentage!', show_alert: true });
			return;
		}

		// Update order
		const result = await updateOrderConfig(orderId, user._id.toString(), {
			takeProfitPercent: percentage,
		});

		if (!result.success) {
			await getBot().answerCallbackQuery(queryId, { text: `❌ ${result.error}`, show_alert: true });
			return;
		}

		await getBot().answerCallbackQuery(queryId, { text: '✅ Take Profit updated!', show_alert: false });

		// Refresh TP/SL settings view
		await showTPSLSettings(chatId, orderId, messageId);
	} catch (error: any) {
		logger.error('Failed to set TP:', error.message);
	}
}

/**
 * Handle Stop Loss percentage set
 */
export async function handleSetSL(
	chatId: string,
	orderId: string,
	percentage: number,
	queryId: string,
	messageId?: number
): Promise<void> {
	try {
		const user = await User.findOne({ chatId });
		if (!user) return;

		// Validate percentage
		if (percentage < 0.1) {
			await getBot().answerCallbackQuery(queryId, { text: '❌ Invalid percentage!', show_alert: true });
			return;
		}

		// Update order
		const result = await updateOrderConfig(orderId, user._id.toString(), {
			stopLossPercent: percentage,
		});

		if (!result.success) {
			await getBot().answerCallbackQuery(queryId, { text: `❌ ${result.error}`, show_alert: true });
			return;
		}

		await getBot().answerCallbackQuery(queryId, { text: '✅ Stop Loss updated!', show_alert: false });

		// Refresh TP/SL settings view
		await showTPSLSettings(chatId, orderId, messageId);
	} catch (error: any) {
		logger.error('Failed to set SL:', error.message);
	}
}

/**
 * Handle custom Take Profit input
 */
export async function handleCustomTPInput(chatId: string, orderId: string, messageId?: number): Promise<void> {
	try {
		const text = '✏️ <b>Custom Take Profit</b>\n\nEnter your desired take profit percentage:\n\n<i>Example: 250</i>';

		// Set user state
		userStates.set(chatId, {
			action: 'order_tp_custom',
			orderId,
		});

		if (messageId) {
			await getBot().editMessageText(text, {
				chat_id: chatId,
				message_id: messageId,
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [[{ text: '❌ Cancel', callback_data: `order_tpsl_${orderId}` }]],
				},
			});
		} else {
			await getBot().sendMessage(chatId, text, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [[{ text: '❌ Cancel', callback_data: `order_tpsl_${orderId}` }]],
				},
			});
		}
	} catch (error: any) {
		logger.error('Failed to show custom TP input:', error.message);
	}
}

/**
 * Handle custom Stop Loss input
 */
export async function handleCustomSLInput(chatId: string, orderId: string, messageId?: number): Promise<void> {
	try {
		const text = '✏️ <b>Custom Stop Loss</b>\n\nEnter your desired stop loss percentage:\n\n<i>Example: 35</i>';

		// Set user state
		userStates.set(chatId, {
			action: 'order_sl_custom',
			orderId,
		});

		if (messageId) {
			await getBot().editMessageText(text, {
				chat_id: chatId,
				message_id: messageId,
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [[{ text: '❌ Cancel', callback_data: `order_tpsl_${orderId}` }]],
				},
			});
		} else {
			await getBot().sendMessage(chatId, text, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [[{ text: '❌ Cancel', callback_data: `order_tpsl_${orderId}` }]],
				},
			});
		}
	} catch (error: any) {
		logger.error('Failed to show custom SL input:', error.message);
	}
}
