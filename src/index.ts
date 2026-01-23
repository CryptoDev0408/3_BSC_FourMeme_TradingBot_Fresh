import { config, validateConfig } from './config/config';
import { database } from './database/connection';
import { logger } from './utils/logger';
import { initializeBot, stopBot } from './bot';
import { initializeProvider } from './core/wallet';
import { positionManager } from './core/position/position.manager';
import { tpslMonitor } from './services/tpsl.monitor';

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

		// Start TP/SL Monitor
		logger.info('🎯 Starting TP/SL Monitor...');
		tpslMonitor.start();
		logger.success('✅ TP/SL Monitor started');

		// Initialize Telegram Bot
		await initializeBot();

		logger.success('🎉 Bot started successfully!');
		logger.info('📱 Bot ready to receive commands');
		logger.info('🔗 BSC RPC: ' + config.bsc.rpcHttpUrl);
		logger.info('📊 Position Monitor: ' + (config.monitoring.positionMonitorInterval / 1000) + 's interval');
		logger.info('🔍 Scanner Status: ' + (config.monitoring.scannerEnabled ? 'Enabled' : 'Disabled'));
		logger.info('');
		logger.info('✨ Try /start in Telegram to begin!');

		// Graceful shutdown
		process.on('SIGINT', async () => {
			logger.info('📦 Shutting down gracefully...');
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
