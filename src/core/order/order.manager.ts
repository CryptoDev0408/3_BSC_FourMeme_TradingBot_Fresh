import { Order, IOrder, Wallet } from '../../database/models';
import { logger } from '../../utils/logger';
import mongoose from 'mongoose';

/**
 * Result interface for order operations
 */
interface OrderResult {
	success: boolean;
	order?: IOrder;
	error?: string;
}

/**
 * Get all orders for a user
 */
export async function getUserOrders(userId: string): Promise<IOrder[]> {
	try {
		console.log('[ORDER_MANAGER] getUserOrders called with userId:', userId);
		const orders = await Order.find({ userId }).populate('walletId').sort({ createdAt: -1 });
		console.log('[ORDER_MANAGER] Found orders:', orders.length);
		return orders;
	} catch (error: any) {
		console.error('[ORDER_MANAGER] Error getting orders:', error);
		logger.error('Failed to get user orders:', error.message);
		return [];
	}
}

/**
 * Get order by ID
 */
export async function getOrderById(orderId: string, userId: string): Promise<IOrder | null> {
	try {
		const order = await Order.findOne({ _id: orderId, userId }).populate('walletId');
		return order;
	} catch (error: any) {
		logger.error('Failed to get order:', error.message);
		return null;
	}
}

/**
 * Get order count for user
 */
export async function getOrderCount(userId: string): Promise<number> {
	try {
		return await Order.countDocuments({ userId });
	} catch (error: any) {
		logger.error('Failed to count orders:', error.message);
		return 0;
	}
}

/**
 * Create new order
 */
export async function createOrder(
	userId: string,
	walletId: string,
	customConfig?: {
		tradingAmount?: number;
		slippage?: number;
		takeProfitPercent?: number;
		takeProfitEnabled?: boolean;
		stopLossPercent?: number;
		stopLossEnabled?: boolean;
		orderName?: string;
	}
): Promise<OrderResult> {
	try {
		// Verify wallet exists and belongs to user
		const wallet = await Wallet.findOne({ _id: walletId, userId });
		if (!wallet) {
			return { success: false, error: 'Wallet not found or does not belong to you' };
		}

		// Get order count for auto-naming
		const orderCount = await getOrderCount(userId);
		const name = customConfig?.orderName || `Order #${orderCount + 1}`;

		// Create order with custom or default settings
		const order = await Order.create({
			userId,
			walletId,
			name,
			isActive: false,
			tradingAmount: customConfig?.tradingAmount ?? 0.01,
			takeProfitPercent: customConfig?.takeProfitPercent ?? 50,
			takeProfitEnabled: customConfig?.takeProfitEnabled ?? true,
			stopLossPercent: customConfig?.stopLossPercent ?? 25,
			stopLossEnabled: customConfig?.stopLossEnabled ?? true,
			slippage: customConfig?.slippage ?? 10,
			gasFee: {
				gasPrice: '5',
				gasLimit: 300000,
			},
		});

		logger.info(`Order created: ${order._id} for user ${userId}`);
		return { success: true, order };
	} catch (error: any) {
		logger.error('Failed to create order:', error.message);
		return { success: false, error: error.message };
	}
}

/**
 * Update order configuration
 */
export async function updateOrderConfig(
	orderId: string,
	userId: string,
	config: {
		name?: string;
		walletId?: string;
		tradingAmount?: number;
		takeProfitPercent?: number;
		takeProfitEnabled?: boolean;
		stopLossPercent?: number;
		stopLossEnabled?: boolean;
		slippage?: number;
		gasFee?: {
			gasPrice?: string;
			gasLimit?: number;
		};
	}
): Promise<OrderResult> {
	try {
		const order = await Order.findOne({ _id: orderId, userId });
		if (!order) {
			return { success: false, error: 'Order not found' };
		}

		// If changing wallet, verify it exists
		if (config.walletId) {
			const wallet = await Wallet.findOne({ _id: config.walletId, userId });
			if (!wallet) {
				return { success: false, error: 'Wallet not found' };
			}
		}

		// Update fields
		if (config.name !== undefined) order.name = config.name;
		if (config.walletId !== undefined) order.walletId = new mongoose.Types.ObjectId(config.walletId);
		if (config.tradingAmount !== undefined) order.tradingAmount = config.tradingAmount;
		if (config.takeProfitPercent !== undefined) order.takeProfitPercent = config.takeProfitPercent;
		if (config.takeProfitEnabled !== undefined) order.takeProfitEnabled = config.takeProfitEnabled;
		if (config.stopLossPercent !== undefined) order.stopLossPercent = config.stopLossPercent;
		if (config.stopLossEnabled !== undefined) order.stopLossEnabled = config.stopLossEnabled;
		if (config.slippage !== undefined) order.slippage = config.slippage;
		if (config.gasFee?.gasPrice !== undefined) order.gasFee.gasPrice = config.gasFee.gasPrice;
		if (config.gasFee?.gasLimit !== undefined) order.gasFee.gasLimit = config.gasFee.gasLimit;

		await order.save();

		logger.info(`Order updated: ${orderId}`);
		return { success: true, order };
	} catch (error: any) {
		logger.error('Failed to update order:', error.message);
		return { success: false, error: error.message };
	}
}

/**
 * Toggle order active status
 */
export async function toggleOrderStatus(orderId: string, userId: string): Promise<OrderResult> {
	try {
		const order = await Order.findOne({ _id: orderId, userId });
		if (!order) {
			return { success: false, error: 'Order not found' };
		}

		order.isActive = !order.isActive;
		await order.save();

		logger.info(`Order ${orderId} status toggled to: ${order.isActive}`);
		return { success: true, order };
	} catch (error: any) {
		logger.error('Failed to toggle order status:', error.message);
		return { success: false, error: error.message };
	}
}

/**
 * Set manual token for order
 */
export async function setManualToken(
	orderId: string,
	userId: string,
	tokenAddress: string | null
): Promise<OrderResult> {
	try {
		const order = await Order.findOne({ _id: orderId, userId });
		if (!order) {
			return { success: false, error: 'Order not found' };
		}

		order.manualTokenAddress = tokenAddress || undefined;
		await order.save();

		logger.info(`Order ${orderId} manual token set to: ${tokenAddress || 'none'}`);
		return { success: true, order };
	} catch (error: any) {
		logger.error('Failed to set manual token:', error.message);
		return { success: false, error: error.message };
	}
}

/**
 * Remove order
 */
export async function removeOrder(orderId: string, userId: string): Promise<OrderResult> {
	try {
		const order = await Order.findOneAndDelete({ _id: orderId, userId });
		if (!order) {
			return { success: false, error: 'Order not found' };
		}

		logger.info(`Order removed: ${orderId}`);
		return { success: true, order };
	} catch (error: any) {
		logger.error('Failed to remove order:', error.message);
		return { success: false, error: error.message };
	}
}

/**
 * Get active orders count
 */
export async function getActiveOrdersCount(userId: string): Promise<number> {
	try {
		return await Order.countDocuments({ userId, isActive: true });
	} catch (error: any) {
		logger.error('Failed to count active orders:', error.message);
		return 0;
	}
}
