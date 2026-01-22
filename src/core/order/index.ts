/**
 * Order Module
 * Exports all order-related functionality
 */

// Manager exports
export {
	getUserOrders,
	getOrderById,
	getOrderCount,
	createOrder,
	updateOrderConfig,
	toggleOrderStatus,
	setManualToken,
	removeOrder,
	getActiveOrdersCount,
} from './order.manager';

// Executor exports
export {
	executeBuyOrder,
	executeManualBuy,
	validateOrderExecution,
	type ExecutionResult,
} from './order.executor';
