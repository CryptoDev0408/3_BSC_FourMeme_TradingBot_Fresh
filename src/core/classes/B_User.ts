import { User, IUser } from '../../database/models';
import { B_Order } from './B_Order';
import { logger } from '../../utils/logger';

/**
 * B_User - User Management Class
 * Manages user operations and their orders
 */
export class B_User {
	public id: string;
	public chatId: string;
	public username?: string;
	private dbUser: IUser;

	constructor(user: IUser) {
		this.id = user._id.toString();
		this.chatId = user.chatId;
		this.username = user.username;
		this.dbUser = user;
	}

	/**
	 * Get user by chatId
	 */
	static async getByChatId(chatId: string): Promise<B_User | null> {
		try {
			const user = await User.findOne({ chatId });
			if (!user) return null;
			return new B_User(user);
		} catch (error: any) {
			logger.error(`Failed to get user by chatId ${chatId}:`, error.message);
			return null;
		}
	}

	/**
	 * Get user by ID
	 */
	static async getById(userId: string): Promise<B_User | null> {
		try {
			const user = await User.findById(userId);
			if (!user) return null;
			return new B_User(user);
		} catch (error: any) {
			logger.error(`Failed to get user by ID ${userId}:`, error.message);
			return null;
		}
	}

	/**
	 * Create a new user
	 */
	static async create(chatId: string, username?: string): Promise<B_User | null> {
		try {
			const user = await User.create({
				chatId,
				username,
				isActive: true,
			});
			logger.success(`User created: ${chatId}`);
			return new B_User(user);
		} catch (error: any) {
			logger.error(`Failed to create user:`, error.message);
			return null;
		}
	}

	/**
	 * Get or create user
	 */
	static async getOrCreate(chatId: string, username?: string): Promise<B_User | null> {
		let user = await B_User.getByChatId(chatId);
		if (!user) {
			user = await B_User.create(chatId, username);
		}
		return user;
	}

	/**
	 * Get all orders for this user
	 */
	async getOrders(): Promise<B_Order[]> {
		return await B_Order.getByUserId(this.id);
	}

	/**
	 * Get active orders
	 */
	async getActiveOrders(): Promise<B_Order[]> {
		const orders = await this.getOrders();
		return orders.filter(order => order.isActive);
	}

	/**
	 * Get order count
	 */
	async getOrderCount(): Promise<number> {
		return await B_Order.countByUserId(this.id);
	}

	/**
	 * Get database user object
	 */
	getDbUser(): IUser {
		return this.dbUser;
	}
}
