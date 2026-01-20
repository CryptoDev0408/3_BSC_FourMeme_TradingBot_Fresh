import mongoose from 'mongoose';
import { logger } from '../utils/logger';

/**
 * MongoDB Connection Handler
 * Manages database connection with auto-reconnection and error handling
 */
class DatabaseConnection {
	private isConnected = false;
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 5;
	private reconnectInterval = 5000; // 5 seconds

	/**
	 * Connect to MongoDB
	 */
	async connect(uri: string): Promise<void> {
		if (this.isConnected) {
			logger.info('📦 Database already connected');
			return;
		}

		try {
			await mongoose.connect(uri, {
				maxPoolSize: 10,
				minPoolSize: 2,
				socketTimeoutMS: 45000,
				serverSelectionTimeoutMS: 10000,
				family: 4, // Use IPv4, skip trying IPv6
			});

			this.isConnected = true;
			this.reconnectAttempts = 0;

			logger.success('✅ MongoDB connected successfully');

			// Setup event listeners
			this.setupEventListeners();
		} catch (error: any) {
			logger.error('❌ MongoDB connection error:', error.message);

			// Retry connection
			if (this.reconnectAttempts < this.maxReconnectAttempts) {
				this.reconnectAttempts++;
				logger.warning(
					`⚠️ Retrying connection (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${this.reconnectInterval / 1000}s...`
				);
				setTimeout(() => this.connect(uri), this.reconnectInterval);
			} else {
				logger.error('❌ Max reconnection attempts reached. Exiting...');
				process.exit(1);
			}
		}
	}

	/**
	 * Disconnect from MongoDB
	 */
	async disconnect(): Promise<void> {
		if (!this.isConnected) {
			return;
		}

		try {
			await mongoose.disconnect();
			this.isConnected = false;
			logger.info('📦 MongoDB disconnected');
		} catch (error: any) {
			logger.error('❌ Error disconnecting from MongoDB:', error.message);
		}
	}

	/**
	 * Check if database is connected
	 */
	getConnectionStatus(): boolean {
		return this.isConnected;
	}

	/**
	 * Get Mongoose connection instance
	 */
	getConnection(): typeof mongoose {
		return mongoose;
	}

	/**
	 * Setup event listeners for connection monitoring
	 */
	private setupEventListeners(): void {
		mongoose.connection.on('connected', () => {
			this.isConnected = true;
			logger.info('🔗 Mongoose connected to MongoDB');
		});

		mongoose.connection.on('disconnected', () => {
			this.isConnected = false;
			logger.warning('⚠️ Mongoose disconnected from MongoDB');
		});

		mongoose.connection.on('error', (error) => {
			logger.error('❌ Mongoose connection error:', error);
			this.isConnected = false;
		});

		mongoose.connection.on('reconnected', () => {
			this.isConnected = true;
			this.reconnectAttempts = 0;
			logger.success('✅ Mongoose reconnected to MongoDB');
		});

		// Handle process termination
		process.on('SIGINT', async () => {
			await this.gracefulShutdown('SIGINT');
		});

		process.on('SIGTERM', async () => {
			await this.gracefulShutdown('SIGTERM');
		});
	}

	/**
	 * Graceful shutdown handler
	 */
	private async gracefulShutdown(signal: string): Promise<void> {
		logger.info(`📦 ${signal} received. Closing MongoDB connection...`);
		await this.disconnect();
		process.exit(0);
	}
}

// Export singleton instance
export const database = new DatabaseConnection();
