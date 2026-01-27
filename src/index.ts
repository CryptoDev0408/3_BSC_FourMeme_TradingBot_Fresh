import { config, validateConfig } from './config/config';
import { database } from './database/connection';
import { logger } from './utils/logger';
import { initializeBot, stopBot, bot } from './bot';
import { initializeProvider } from './core/wallet';
import { positionManager } from './core/position/position.manager';
import { tpslMonitor } from './services/tpsl.monitor';
import { pnlMonitorEngine } from './services/pnl.monitor';
import { transactionQueue } from './core/classes';
import { scannerService } from './services/scanner.service';
import { sendTokenAlert } from './bot/handlers/scanner.handler';
import { User } from './database/models';

/**
 * Main application entry point
 */
async function main() {
	try {
		// Print banner
		console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║        🚀 FourMeme BSC Trading Bot                       ║
║                                                           ║
║        💼 Multi-Wallet Management                        ║
║        📊 PancakeSwap V2 Integration                     ║
║        💰 Automated TP/SL Monitoring                     ║
║        🔍 Four.meme Token Scanner                        ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);

		logger.info('🚀 Starting FourMeme Trading Bot...');

		// Validate configuration
		logger.info('📋 Validating configuration...');
		const validation = validateConfig();

		if (!validation.valid) {
			logger.error('❌ Configuration validation failed:');
			validation.errors.forEach((error) => logger.error(`   - ${error}`));
			process.exit(1);
		}

		logger.success('✅ Configuration validated');

		// Connect to database
		logger.info('📦 Connecting to MongoDB...');
		await database.connect(config.database.uri);

		// Initialize BSC Provider
		logger.info('🔗 Connecting to BSC network...');
		initializeProvider();

		// Initialize Position Manager
		logger.info('📊 Initializing Position Manager...');
		await positionManager.initialize();
		logger.success(`✅ Position Manager initialized (${positionManager.getOpenPositionCount()} open positions)`);

		// Start Transaction Queue
		logger.info('🔄 Starting Transaction Queue...');
		transactionQueue.start();
		logger.success('✅ Transaction Queue started');

		// Start PNL Monitor Engine (High-Performance)
		logger.info('⚡ Starting PNL Monitor Engine...');
		pnlMonitorEngine.start();
		logger.success('✅ PNL Monitor Engine started');

		// Start TP/SL Monitor (Legacy, can be disabled if using PNL engine)
		// Keeping it for backward compatibility
		logger.info('🎯 Starting Legacy TP/SL Monitor...');
		tpslMonitor.start();
		logger.success('✅ Legacy TP/SL Monitor started');

		// Initialize Telegram Bot
		await initializeBot();

		// Start Scanner Service (runs in background)
		if (config.monitoring.scannerEnabled) {
			logger.info('🔍 Starting Four.meme Scanner Service...');
			await scannerService.start();

			// Setup token detection callback
			scannerService.onTokenDetected(async (tokenData) => {
				logger.success(`🚨 New token detected: ${tokenData.symbol} (${tokenData.name})`);

				// Send alert to all users
				try {
					const users = await User.find();
					for (const user of users) {
						await sendTokenAlert(user.chatId, tokenData);
					}
				} catch (error: any) {
					logger.error('Error sending token alerts:', error.message);
				}
			});

			logger.success('✅ Scanner Service started');
		} else {
			logger.info('⏸️  Scanner Service disabled in config');
		}

		logger.success('🎉 Bot started successfully!');
		logger.info('📱 Bot ready to receive commands');
		logger.info('🔗 BSC RPC: ' + config.bsc.rpcHttpUrl);
		logger.info('⚡ PNL Monitor: ' + (config.monitoring.pnlMonitorInterval / 1000) + 's interval (High-Performance)');
		logger.info('📊 Position Monitor: ' + (config.monitoring.positionMonitorInterval / 1000) + 's interval (Legacy)');
		logger.info('🔍 Scanner Status: ' + (config.monitoring.scannerEnabled ? 'Enabled' : 'Disabled'));
		logger.info('✨ Try /start in Telegram to begin!');
		logger.info('');

		// Graceful shutdown
		process.on('SIGINT', async () => {
			logger.info('📦 Shutting down gracefully...');
			if (config.monitoring.scannerEnabled) {
				await scannerService.stop();
			}
			await transactionQueue.stop();
			pnlMonitorEngine.stop();
			tpslMonitor.stop();
			await stopBot();
			await database.disconnect();
			process.exit(0);
		});

	} catch (error: any) {
		logger.error('❌ Failed to start bot:', error.message);
		if (error.stack) {
			logger.debug(error.stack);
		}
		process.exit(1);
	}
}

// Start the application
main();
