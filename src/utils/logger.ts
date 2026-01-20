import winston from 'winston';
import path from 'path';
import fs from 'fs';

/**
 * Create logs directory if it doesn't exist
 */
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
	fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Custom log format
 */
const logFormat = winston.format.combine(
	winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
	winston.format.errors({ stack: true }),
	winston.format.printf(({ timestamp, level, message, stack }) => {
		let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
		if (stack) {
			log += `\n${stack}`;
		}
		return log;
	})
);

/**
 * Console format with colors
 */
const consoleFormat = winston.format.combine(
	winston.format.colorize(),
	winston.format.timestamp({ format: 'HH:mm:ss' }),
	winston.format.printf(({ timestamp, level, message }) => {
		return `${timestamp} ${level}: ${message}`;
	})
);

/**
 * Winston logger instance
 */
const winstonLogger = winston.createLogger({
	level: process.env.LOG_LEVEL || 'info',
	format: logFormat,
	transports: [
		// Console transport
		new winston.transports.Console({
			format: consoleFormat,
		}),
		// File transports
		new winston.transports.File({
			filename: path.join(logsDir, 'error.log'),
			level: 'error',
			maxsize: 5242880, // 5MB
			maxFiles: 5,
		}),
		new winston.transports.File({
			filename: path.join(logsDir, 'combined.log'),
			maxsize: 5242880, // 5MB
			maxFiles: 5,
		}),
	],
});

/**
 * Custom logger with emoji support
 */
export const logger = {
	info: (message: string, ...args: any[]) => {
		winstonLogger.info(message, ...args);
	},

	success: (message: string, ...args: any[]) => {
		winstonLogger.info(`✅ ${message}`, ...args);
	},

	warning: (message: string, ...args: any[]) => {
		winstonLogger.warn(`⚠️ ${message}`, ...args);
	},

	error: (message: string, ...args: any[]) => {
		winstonLogger.error(`❌ ${message}`, ...args);
	},

	debug: (message: string, ...args: any[]) => {
		winstonLogger.debug(`🔍 ${message}`, ...args);
	},

	trade: (message: string, ...args: any[]) => {
		winstonLogger.info(`💰 ${message}`, ...args);
	},

	scanner: (message: string, ...args: any[]) => {
		winstonLogger.info(`🔍 ${message}`, ...args);
	},

	bot: (message: string, ...args: any[]) => {
		winstonLogger.info(`🤖 ${message}`, ...args);
	},
};
