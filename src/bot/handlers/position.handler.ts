import TelegramBot from 'node-telegram-bot-api';
import { logger } from '../../utils/logger';
import { User, Position } from '../../database/models';
import { PositionStatus } from '../../config/constants';
import { formatBnb, formatAddress, formatPercent } from '../../utils/formatter';
import { getPositionsListKeyboard, getPositionDetailKeyboard } from '../keyboards/position.keyboard';
import { B_Transaction, TransactionType, transactionQueue, B_Wallet, B_Token } from '../../core/classes';

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
 * Show positions list
 */
export async function showPositionsList(chatId: string, messageId?: number): Promise<void> {
	try {
		// Get user
		const user = await User.findOne({ chatId });
		if (!user) {
			await getBot().sendMessage(chatId, '❌ User not found. Please /start the bot first.');
			return;
		}

		// Get all positions (active and closed)
		const positions = await Position.find({ userId: user._id })
			.sort({ createdAt: -1 })
			.populate('walletId')
			.populate('orderId');

		let text = '💰 <b>Your Positions</b>\n\n';

		if (positions.length === 0) {
			text += '📭 You don\'t have any positions yet.\n\n';
			text += 'Create an order and execute Manual Buy to open a position!';
		} else {
			const activePositions = positions.filter((p) => p.status === PositionStatus.ACTIVE);
			const closedPositions = positions.filter((p) => p.status !== PositionStatus.ACTIVE);

			if (activePositions.length > 0) {
				text += `🟢 <b>Active Positions (${activePositions.length})</b>\n\n`;
				// Limit to 10 active positions for display
				const displayedActive = activePositions.slice(0, 10);
				for (const position of displayedActive) {
					const pnlEmoji = position.pnlPercent >= 0 ? '📈' : '📉';
					const pnlSign = position.pnlPercent >= 0 ? '+' : '';

					// Check for triggered levels
					const triggeredTP = position.triggeredTakeProfitLevels?.length || 0;
					const triggeredSL = position.triggeredStopLossLevels?.length || 0;
					const totalTP = position.takeProfitLevels?.length || 0;
					const totalSL = position.stopLossLevels?.length || 0;

					let levelsInfo = '';
					if (triggeredTP > 0) {
						levelsInfo += ` | ✅TP${triggeredTP}/${totalTP}`;
					}
					if (triggeredSL > 0) {
						levelsInfo += ` | ✅SL${triggeredSL}/${totalSL}`;
					}

					// Compact format
					text += `🟢 <b>${position.tokenSymbol}</b> | ${formatBnb(position.buyAmount)} BNB${levelsInfo}\n`;
					text += `${pnlEmoji} ${pnlSign}${formatPercent(position.pnlPercent)}% (${pnlSign}${formatBnb(position.pnlBnb)})\n\n`;
				}
				if (activePositions.length > 10) {
					text += `... and ${activePositions.length - 10} more active positions\n\n`;
				}
			}

			if (closedPositions.length > 0) {
				text += `\n🔴 <b>Closed Positions (${closedPositions.length})</b>\n\n`;
				// Show only last 3 closed positions with compact format
				for (const position of closedPositions.slice(0, 3)) {
					const pnlEmoji = position.pnlPercent >= 0 ? '📈' : '📉';
					const pnlSign = position.pnlPercent >= 0 ? '+' : '';
					// Ultra compact format
					text += `🔴 <b>${position.tokenSymbol}</b> | ${pnlEmoji} ${pnlSign}${formatPercent(position.pnlPercent)}%\n`;
				}
				if (closedPositions.length > 3) {
					text += `... +${closedPositions.length - 3} more closed\n`;
				}
			}
		}

		const keyboard = getPositionsListKeyboard(positions.map((p) => p._id.toString()));

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
		logger.error('Failed to show positions list:', error.message);
		await getBot().sendMessage(chatId, '❌ Failed to load positions. Please try again.');
	}
}

/**
 * Show position details
 */
export async function showPositionDetail(chatId: string, positionId: string, messageId?: number): Promise<void> {
	try {
		// Get user
		const user = await User.findOne({ chatId });
		if (!user) {
			await getBot().sendMessage(chatId, '❌ User not found.');
			return;
		}

		// Get position
		const position = await Position.findOne({ _id: positionId, userId: user._id })
			.populate('walletId')
			.populate('orderId');

		if (!position) {
			await getBot().sendMessage(chatId, '❌ Position not found.');
			return;
		}

		// Calculate current PNL (update from price service if needed)
		position.calculatePnl();

		const pnlEmoji = position.pnlPercent >= 0 ? '📈' : '📉';
		const pnlSign = position.pnlPercent >= 0 ? '+' : '';
		const statusEmoji = position.status === PositionStatus.ACTIVE ? '🟢' : '🔴';

		let text = `${statusEmoji} <b>Position Details</b>\n\n`;
		text += `🪙 <b>Token:</b> ${position.tokenSymbol} (${position.tokenName})\n`;
		text += `📍 <b>Address:</b>\n<code>${position.tokenAddress}</code>\n\n`;

		text += `📊 <b>Buy Information</b>\n`;
		text += `💵 Amount: ${formatBnb(position.buyAmount)} BNB\n`;
		text += `💰 Price: ${position.buyPrice.toFixed(10)} BNB\n`;
		text += `💲 USD Price: $${position.buyPriceUsd.toFixed(6)}\n`;
		text += `🪙 Tokens: ${position.tokenAmount.toFixed(2)}\n`;
		text += `📅 Date: ${position.buyTimestamp.toLocaleString()}\n`;
		text += `🔗 TX: <code>${position.buyTxHash}</code>\n\n`;

		text += `📈 <b>Current Status</b>\n`;
		text += `💰 Current Price: ${position.currentPrice.toFixed(10)} BNB\n`;
		text += `💲 Current USD: $${position.currentPriceUsd.toFixed(6)}\n`;
		text += `🕐 Last Update: ${position.lastPriceUpdate.toLocaleString()}\n\n`;

		text += `${pnlEmoji} <b>Profit/Loss</b>\n`;
		text += `📊 PNL %: ${pnlSign}${formatPercent(position.pnlPercent)}%\n`;
		text += `💵 PNL BNB: ${pnlSign}${formatBnb(position.pnlBnb)} BNB\n`;
		text += `💲 PNL USD: $${pnlSign}${position.pnlUsd.toFixed(2)}\n\n`;

		// Display Multiple TP/SL Levels with triggered status
		if (position.takeProfitLevels && position.takeProfitLevels.length > 0) {
			text += `🎯 <b>Take Profit Levels</b>\n`;
			for (let i = 0; i < position.takeProfitLevels.length; i++) {
				const level = position.takeProfitLevels[i];
				const isTriggered = position.triggeredTakeProfitLevels?.includes(i);
				const statusIcon = isTriggered ? '✅' : '⏳';
				text += `${statusIcon} TP${i + 1}: +${level.pnlPercent}% → Sell ${level.sellPercent}%\n`;
			}
			text += '\n';
		} else if (position.takeProfitTarget) {
			// Legacy single TP display
			text += `🎯 <b>Targets</b>\n`;
			text += `✅ Take Profit: ${formatPercent(position.takeProfitTarget)}%\n`;
		}

		if (position.stopLossLevels && position.stopLossLevels.length > 0) {
			text += `🛑 <b>Stop Loss Levels</b>\n`;
			for (let i = 0; i < position.stopLossLevels.length; i++) {
				const level = position.stopLossLevels[i];
				const isTriggered = position.triggeredStopLossLevels?.includes(i);
				const statusIcon = isTriggered ? '✅' : '⏳';
				text += `${statusIcon} SL${i + 1}: -${level.pnlPercent}% → Sell ${level.sellPercent}%\n`;
			}
			text += '\n';
		} else if (position.stopLossTarget) {
			// Legacy single SL display (only if not already shown above)
			if (!position.takeProfitLevels || position.takeProfitLevels.length === 0) {
				text += `🎯 <b>Targets</b>\n`;
			}
			text += `🛑 Stop Loss: ${formatPercent(position.stopLossTarget)}%\n\n`;
		}

		if (position.status !== PositionStatus.ACTIVE) {
			text += `🔴 <b>Sell Information</b>\n`;
			if (position.sellPrice) {
				text += `💰 Sell Price: ${position.sellPrice.toFixed(10)} BNB\n`;
			}
			if (position.sellAmount) {
				text += `💵 Sell Amount: ${formatBnb(position.sellAmount)} BNB\n`;
			}
			if (position.sellTimestamp) {
				text += `📅 Sell Date: ${position.sellTimestamp.toLocaleString()}\n`;
			}
			if (position.sellTxHash) {
				text += `🔗 Sell TX: <code>${position.sellTxHash}</code>\n`;
			}
			text += `📊 Status: ${position.status}\n\n`;
		}

		const walletName = (position.walletId as any)?.name || 'Unknown';
		const orderName = (position.orderId as any)?.name || 'Unknown';
		text += `💼 Wallet: ${walletName}\n`;
		text += `📋 Order: ${orderName}\n`;

		const keyboard = getPositionDetailKeyboard(positionId, position.status);

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
		logger.error('Failed to show position detail:', error.message);
		await getBot().sendMessage(chatId, '❌ Failed to load position details. Please try again.');
	}
}

/**
 * Handle position sell
 */
export async function handlePositionSell(chatId: string, positionId: string, messageId?: number): Promise<void> {
	try {
		// Get user
		const user = await User.findOne({ chatId });
		if (!user) {
			await getBot().sendMessage(chatId, '❌ User not found.');
			return;
		}

		// Get position with populated refs
		const position = await Position.findOne({ _id: positionId, userId: user._id })
			.populate('walletId')
			.populate('orderId');

		if (!position) {
			await getBot().sendMessage(chatId, '❌ Position not found.');
			return;
		}

		// Check if position is already closed
		if (position.status !== PositionStatus.ACTIVE) {
			await getBot().sendMessage(chatId, '❌ This position is already closed.');
			return;
		}

		const wallet = position.walletId as any;
		const order = position.orderId as any;

		if (!wallet || !order) {
			await getBot().sendMessage(chatId, '❌ Position data incomplete.');
			return;
		}

		// Send processing message
		const processingMsg = await getBot().sendMessage(
			chatId,
			`⏳ <b>Selling ${position.tokenSymbol}...</b>\n\n` +
			`Token: <code>${position.tokenAddress}</code>\n` +
			`Amount: ${position.tokenAmount.toFixed(2)} tokens\n\n` +
			`Please wait...`,
			{ parse_mode: 'HTML' }
		);

		// Import sell function
		const { sellToken, getTokenBalance } = await import('../../core/trading/pancakeswap.service');
		const { ethers } = await import('ethers');
		const { Transaction } = await import('../../database/models');
		const { TransactionType, TransactionStatus } = await import('../../config/constants');
		const { positionManager } = await import('../../core/position/position.manager');

		// Get position from memory
		const bPosition = positionManager.getPosition(position._id.toString());
		if (!bPosition) {
			await getBot().editMessageText(
				`❌ <b>Sell Failed</b>\n\n` +
				`Token: ${position.tokenSymbol}\n` +
				`Error: Position not found in memory`,
				{
					chat_id: chatId,
					message_id: processingMsg.message_id,
					parse_mode: 'HTML',
				}
			);
			return;
		}

		// Check if sell already in progress
		if (bPosition.hasPendingSell) {
			await getBot().editMessageText(
				`⏳ <b>Sell Already in Progress</b>\n\n` +
				`Token: ${position.tokenSymbol}\n` +
				`Please wait for the current sell transaction to complete.`,
				{
					chat_id: chatId,
					message_id: processingMsg.message_id,
					parse_mode: 'HTML',
				}
			);
			return;
		}

		// Set pending sell flag to prevent duplicate sells
		bPosition.hasPendingSell = true;

		// Check BNB balance for gas
		const { getBnbBalance } = await import('../../core/wallet/wallet.service');
		const bnbBalanceResult = await getBnbBalance(wallet.address, false);

		if (!bnbBalanceResult.success || !bnbBalanceResult.balance) {
			bPosition.hasPendingSell = false;
			await getBot().editMessageText(
				`❌ <b>Sell Failed</b>\n\n` +
				`Token: ${position.tokenSymbol}\n` +
				`Error: Failed to check BNB balance`,
				{
					chat_id: chatId,
					message_id: processingMsg.message_id,
					parse_mode: 'HTML',
				}
			);
			return;
		}

		// Estimate gas cost (gasLimit * gasPrice)
		const estimatedGasCost = parseFloat(ethers.utils.formatEther(
			ethers.BigNumber.from(order.gasFee.gasLimit).mul(order.gasFee.gasPrice)
		));

		// Require at least 1.5x the estimated gas for safety margin
		const requiredBnb = estimatedGasCost * 1.5;

		if (bnbBalanceResult.balance < requiredBnb) {
			bPosition.hasPendingSell = false;
			await getBot().editMessageText(
				`❌ <b>Insufficient BNB for Gas</b>\n\n` +
				`Token: ${position.tokenSymbol}\n` +
				`Wallet: <code>${wallet.address}</code>\n\n` +
				`💰 Current Balance: ${bnbBalanceResult.balance.toFixed(6)} BNB\n` +
				`⛽ Required for Gas: ${requiredBnb.toFixed(6)} BNB\n` +
				`📉 Shortfall: ${(requiredBnb - bnbBalanceResult.balance).toFixed(6)} BNB\n\n` +
				`Please deposit more BNB to this wallet before selling.`,
				{
					chat_id: chatId,
					message_id: processingMsg.message_id,
					parse_mode: 'HTML',
				}
			);
			return;
		}

		// Get actual token balance from blockchain (to avoid precision issues)
		let tokenAmountWei: string;
		try {
			tokenAmountWei = await getTokenBalance(position.tokenAddress, wallet.address);

			// Verify we have tokens to sell
			if (tokenAmountWei === '0' || ethers.BigNumber.from(tokenAmountWei).isZero()) {
				bPosition.hasPendingSell = false; // Clear flag on error
				await getBot().editMessageText(
					`❌ <b>Sell Failed</b>\n\n` +
					`Token: ${position.tokenSymbol}\n` +
					`Error: No tokens found in wallet`,
					{
						chat_id: chatId,
						message_id: processingMsg.message_id,
						parse_mode: 'HTML',
					}
				);
				return;
			}
		} catch (error: any) {
			// Fallback: use stored amount with proper decimal handling
			const tokenAmountFixed = position.tokenAmount.toFixed(position.tokenDecimals);
			tokenAmountWei = ethers.utils.parseUnits(tokenAmountFixed, position.tokenDecimals).toString();
		}

		// Load wallet and token for queue
		const bWallet = await B_Wallet.getById(wallet._id.toString());
		if (!bWallet) {
			bPosition.hasPendingSell = false; // Clear flag on error
			await getBot().editMessageText(
				`❌ <b>Sell Failed</b>\n\nFailed to load wallet`,
				{
					chat_id: chatId,
					message_id: processingMsg.message_id,
					parse_mode: 'HTML',
				}
			);
			return;
		}

		const bToken = new B_Token({
			address: position.tokenAddress,
			symbol: position.tokenSymbol,
			decimals: position.tokenDecimals,
		});

		const tokenAmountStr = ethers.utils.formatUnits(tokenAmountWei, position.tokenDecimals);

		// Create transaction for queue
		const transaction = new B_Transaction({
			type: TransactionType.SELL,
			wallet: bWallet,
			token: bToken,
			tokenAmount: tokenAmountStr,
			slippage: order.slippage,
			gasPrice: order.gasFee.gasPrice,
			gasLimit: order.gasFee.gasLimit,
			orderId: order._id.toString(),
			positionId: position._id.toString(),
			userId: user._id.toString(),
			priority: 50, // Normal priority for manual sells
		});

		// Queue the transaction
		const txId = transactionQueue.push(transaction);
		logger.info(`🎯 Queued: ${txId}`);

		// Wait for completion
		const sellResult = await waitForTxComplete(transaction, 120000);

		if (!sellResult.success || !sellResult.txHash) {
			bPosition.hasPendingSell = false; // Clear flag on failure
			await getBot().editMessageText(
				`❌ <b>Sell Failed</b>\n\n` +
				`Token: ${position.tokenSymbol}\n` +
				`Error: ${sellResult.error || 'Unknown error'}`,
				{
					chat_id: chatId,
					message_id: processingMsg.message_id,
					parse_mode: 'HTML',
				}
			);

			// Log failed transaction
			await Transaction.create({
				userId: user._id,
				walletId: wallet._id,
				positionId: position._id,
				type: TransactionType.SELL,
				status: TransactionStatus.FAILED,
				tokenAddress: position.tokenAddress,
				tokenSymbol: position.tokenSymbol,
				amountBnb: 0,
				amountToken: position.tokenAmount,
				gasFee: 0,
				txHash: 'FAILED_' + Date.now(),
				errorMessage: sellResult.error || 'Unknown error',
			});

			return;
		}

		// Calculate BNB received
		const bnbReceived = parseFloat(ethers.utils.formatEther(sellResult.amountOut || '0'));

		// Calculate final PNL
		const finalPnlBnb = bnbReceived - position.buyAmount;
		const finalPnlPercent = (finalPnlBnb / position.buyAmount) * 100;
		const sellPrice = bnbReceived / position.tokenAmount; // BNB per token

		// Close position - this will delete from DB and remove from memory
		await positionManager.closePosition(
			position._id.toString(),
			sellPrice,
			sellResult.txHash
		);
		logger.info(`✅ Position closed: ${position._id}`);

		// Log successful transaction
		await Transaction.create({
			userId: user._id,
			walletId: wallet._id,
			positionId: position._id,
			type: TransactionType.SELL,
			status: TransactionStatus.SUCCESS,
			tokenAddress: position.tokenAddress,
			tokenSymbol: position.tokenSymbol,
			amountBnb: bnbReceived,
			amountToken: position.tokenAmount,
			gasFee: sellResult.gasFee || 0,
			txHash: sellResult.txHash,
		});

		// Update wallet balance
		const { updateWalletBalance } = await import('../../core/wallet/wallet.service');
		await updateWalletBalance(wallet._id.toString());

		// Send success message
		const pnlEmoji = finalPnlBnb >= 0 ? '📈' : '📉';
		const pnlSign = finalPnlBnb >= 0 ? '+' : '';

		let successText = `✅ <b>Sell Successful!</b>\n\n`;
		successText += `🪙 <b>Token:</b> ${position.tokenSymbol}\n`;
		successText += `📍 <code>${position.tokenAddress}</code>\n\n`;
		successText += `💰 <b>Sold:</b> ${position.tokenAmount.toFixed(2)} tokens\n`;
		successText += `💵 <b>Received:</b> ${bnbReceived.toFixed(6)} BNB\n`;
		successText += `⛽ <b>Gas:</b> ${(sellResult.gasFee || 0).toFixed(6)} BNB\n\n`;
		successText += `${pnlEmoji} <b>PNL:</b> ${pnlSign}${finalPnlPercent.toFixed(2)}% (${pnlSign}${finalPnlBnb.toFixed(6)} BNB)\n\n`;
		successText += `💳 <b>TX:</b> <code>${sellResult.txHash}</code>`;

		const keyboard = {
			inline_keyboard: [
				[
					{ text: '📊 Dexscreener', url: `https://dexscreener.com/bsc/${position.tokenAddress}?maker=${wallet.address}` },
					{ text: '🔍 BSCScan', url: `https://bscscan.com/tx/${sellResult.txHash}` },
				],
				[{ text: '🔙 Back to Order', callback_data: `order_view_${order._id}` }],
			],
		};

		await getBot().editMessageText(successText, {
			chat_id: chatId,
			message_id: processingMsg.message_id,
			parse_mode: 'HTML',
			disable_web_page_preview: true,
			reply_markup: keyboard,
		});

		logger.success(`Position sold successfully: ${position.tokenSymbol} - PNL: ${pnlSign}${finalPnlPercent.toFixed(2)}%`);

	} catch (error: any) {
		logger.error('Failed to sell position:', error.message);
		await getBot().sendMessage(chatId, `❌ Failed to sell position: ${error.message}`);
	}
}

/**
 * Wait for transaction to complete
 */
async function waitForTxComplete(transaction: any, timeoutMs: number): Promise<any> {
	const startTime = Date.now();

	return new Promise((resolve) => {
		const checkInterval = setInterval(() => {
			if (transaction.status === 'COMPLETED') {
				clearInterval(checkInterval);
				resolve(transaction.result);
				return;
			}

			if (transaction.status === 'FAILED' || transaction.status === 'CANCELLED') {
				clearInterval(checkInterval);
				resolve({
					success: false,
					error: transaction.error || 'Transaction failed or cancelled',
				});
				return;
			}

			if (Date.now() - startTime > timeoutMs) {
				clearInterval(checkInterval);
				resolve({
					success: false,
					error: 'Transaction timeout',
				});
			}
		}, 100);
	});
}
