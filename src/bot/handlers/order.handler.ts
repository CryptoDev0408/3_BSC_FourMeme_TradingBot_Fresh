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

		let text = `📊 <b>${order.name}</b>\n\n`;
		text += `Status: ${order.isActive ? '🟢 Active' : '🔴 Inactive'}\n\n`;
		text += `<b>Configuration:</b>\n`;
		text += `💼 Wallet: ${walletName} (${formatAddress(walletAddress)})\n`;
		text += `💰 Trading Amount: ${formatBnb(order.tradingAmount)} BNB\n`;
		text += `📊 Slippage: ${order.slippage}%\n\n`;
		text += `<b>Take Profit:</b>\n`;
		text += `🎯 Target: ${order.takeProfitPercent}%\n`;
		text += `${formatToggle(order.takeProfitEnabled)}\n\n`;
		text += `<b>Stop Loss:</b>\n`;
		text += `🛑 Target: ${order.stopLossPercent}%\n`;
		text += `${formatToggle(order.stopLossEnabled)}\n\n`;
		text += `<b>Gas Settings:</b>\n`;
		text += `⚡ Price: ${order.gasFee.gasPrice} Gwei\n`;
		text += `⚙️ Limit: ${order.gasFee.gasLimit}\n`;

		const keyboard = getOrderDetailKeyboard(orderId, order.isActive);

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
 * Handle order creation - show confirmation page
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

		// Show confirmation page
		const text = `➕ <b>Create New Order</b>\n\n` +
			`You are about to create a new order with default settings:\n\n` +
			`💼 <b>Wallet:</b> ${targetWallet.name}\n` +
			`💰 <b>Amount:</b> 0.01 BNB\n` +
			`📊 <b>Slippage:</b> 10%\n` +
			`📈 <b>Take Profit:</b> 50% (Enabled)\n` +
			`📉 <b>Stop Loss:</b> 25% (Enabled)\n` +
			`⚡ <b>Gas Price:</b> 5 Gwei\n\n` +
			`You can customize these settings after creation.\n\n` +
			`Do you want to proceed?`;

		const keyboard = {
			inline_keyboard: [
				[{ text: '✅ Confirm Create', callback_data: 'order_create_confirm' }],
				[{ text: '🔙 Back to Orders', callback_data: 'orders' }],
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
		logger.error('Failed to show order creation:', error.message);
		await getBot().sendMessage(chatId, '❌ Failed to show order creation. Please try again.');
	}
}

/**
 * Confirm order creation
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

		const status = result.order!.isActive ? '✅ activated' : '⏸ paused';
		await getBot().answerCallbackQuery(chatId, { text: `Order ${status}!`, show_alert: false });

		// Refresh order view
		await showOrderDetail(chatId, orderId, messageId);
	} catch (error: any) {
		logger.error('Failed to toggle order:', error.message);
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

		let text = '🎯 <b>Take Profit / Stop Loss Settings</b>\n\n';
		text += `<b>Take Profit:</b>\n`;
		text += `Target: ${order.takeProfitPercent}%\n`;
		text += `Status: ${formatToggle(order.takeProfitEnabled)}\n\n`;
		text += `<b>Stop Loss:</b>\n`;
		text += `Target: ${order.stopLossPercent}%\n`;
		text += `Status: ${formatToggle(order.stopLossEnabled)}`;

		const keyboard = getOrderTPSLKeyboard(orderId);

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
		if (state.action === 'manual_buy') {
			// Validate token address
			if (!isValidAddress(text)) {
				await getBot().sendMessage(chatId, '❌ Invalid token address. Please enter a valid BSC address.');
				return true;
			}

			await getBot().sendMessage(chatId, '⏳ Executing buy order...\n\nPlease wait...');

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
				let successText = '✅ <b>Buy Successful!</b>\n\n';
				successText += `Token: <code>${result.tokenAddress}</code>\n`;
				successText += `TX: <code>${result.txHash}</code>\n\n`;
				successText += `View on BSCScan:\nhttps://bscscan.com/tx/${result.txHash}`;

				await getBot().sendMessage(chatId, successText, { parse_mode: 'HTML' });
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
