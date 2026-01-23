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
				for (const position of activePositions) {
					const pnlEmoji = position.pnlPercent >= 0 ? '📈' : '📉';
					const pnlSign = position.pnlPercent >= 0 ? '+' : '';
					const statusEmoji = '🟢';

					text += `${statusEmoji} <b>${position.tokenSymbol}</b>\n`;
					text += `💵 Value: ${formatBnb(position.buyAmount)} BNB\n`;
					text += `${pnlEmoji} PNL: ${pnlSign}${formatPercent(position.pnlPercent)}% (${pnlSign}${formatBnb(position.pnlBnb)} BNB)\n`;
					text += `📅 Opened: ${position.buyTimestamp.toLocaleDateString()}\n\n`;
				}
			}

			if (closedPositions.length > 0) {
				text += `\n🔴 <b>Closed Positions (${closedPositions.length})</b>\n\n`;
				for (const position of closedPositions.slice(0, 5)) {
					// Show last 5 closed
					const pnlEmoji = position.pnlPercent >= 0 ? '📈' : '📉';
					const pnlSign = position.pnlPercent >= 0 ? '+' : '';
					const statusEmoji = position.status === PositionStatus.CLOSED ? '🔴' : '❌';

					text += `${statusEmoji} <b>${position.tokenSymbol}</b>\n`;
					text += `💵 Value: ${formatBnb(position.buyAmount)} BNB\n`;
					text += `${pnlEmoji} PNL: ${pnlSign}${formatPercent(position.pnlPercent)}% (${pnlSign}${formatBnb(position.pnlBnb)} BNB)\n`;
					text += `📅 Closed: ${position.sellTimestamp?.toLocaleDateString() || 'N/A'}\n\n`;
				}
				if (closedPositions.length > 5) {
					text += `... and ${closedPositions.length - 5} more closed positions\n`;
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

		text += `🎯 <b>Targets</b>\n`;
		text += `✅ Take Profit: ${formatPercent(position.takeProfitTarget)}%\n`;
		text += `🛑 Stop Loss: ${formatPercent(position.stopLossTarget)}%\n\n`;

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

		// Get actual token balance from blockchain (to avoid precision issues)
		let tokenAmountWei: string;
		try {
			tokenAmountWei = await getTokenBalance(position.tokenAddress, wallet.address);

			// Verify we have tokens to sell
			if (tokenAmountWei === '0' || ethers.BigNumber.from(tokenAmountWei).isZero()) {
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
		logger.info(`🎯 Manual sell transaction queued: ${txId}`);

		// Wait for completion
		const sellResult = await waitForTxComplete(transaction, 120000);

		if (!sellResult.success || !sellResult.txHash) {
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

		// Update position as closed
		position.status = PositionStatus.CLOSED;
		position.sellTxHash = sellResult.txHash;
		position.sellAmount = bnbReceived;
		position.sellPrice = bnbReceived / position.tokenAmount; // BNB per token
		position.sellTimestamp = new Date();
		position.pnlBnb = finalPnlBnb;
		position.pnlPercent = finalPnlPercent;
		await position.save();

		// Remove position from PositionManager (in-memory tracking)
		positionManager.removePosition(position._id.toString());
		logger.info(`Position removed from PositionManager: ${position._id}`);

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
		successText += `💰 <b>Sold Amount:</b> ${position.tokenAmount.toFixed(2)} tokens\n`;
		successText += `💵 <b>BNB Received:</b> ${bnbReceived.toFixed(6)} BNB\n`;
		successText += `⛽ <b>Gas Fee:</b> ${(sellResult.gasFee || 0).toFixed(6)} BNB\n\n`;
		successText += `${pnlEmoji} <b>Final PNL:</b> ${pnlSign}${finalPnlPercent.toFixed(2)}% (${pnlSign}${finalPnlBnb.toFixed(6)} BNB)\n\n`;
		successText += `💳 <b>Transaction Hash:</b>\n<code>${sellResult.txHash}</code>\n\n`;
		successText += `🔗 <a href="https://bscscan.com/tx/${sellResult.txHash}">View on BSCScan</a>`;

		await getBot().editMessageText(successText, {
			chat_id: chatId,
			message_id: processingMsg.message_id,
			parse_mode: 'HTML',
			disable_web_page_preview: true,
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
