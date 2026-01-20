import { EMOJIS } from '../config/constants';

/**
 * Formatter Utility
 * Format numbers, addresses, and UI text for display
 */

/**
 * Format BNB amount for display
 * @param amount - Amount to format
 * @param decimals - Number of decimal places (default: 4)
 * @returns Formatted amount string
 */
export function formatBnb(amount: number, decimals: number = 4): string {
	if (amount === 0) return '0';
	if (amount < 0.0001 && amount > 0) return '< 0.0001';
	return amount.toFixed(decimals);
}

/**
 * Format USD amount for display
 * @param amount - Amount to format
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted USD string
 */
export function formatUsd(amount: number, decimals: number = 2): string {
	if (amount === 0) return '$0';
	if (amount < 0.01 && amount > 0) return '< $0.01';
	return `$${amount.toFixed(decimals)}`;
}

/**
 * Format token amount for display
 * @param amount - Amount to format
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted amount string
 */
export function formatTokenAmount(amount: number, decimals: number = 2): string {
	if (amount === 0) return '0';

	// For very large numbers, use scientific notation
	if (amount >= 1e9) {
		return (amount / 1e9).toFixed(2) + 'B';
	}
	if (amount >= 1e6) {
		return (amount / 1e6).toFixed(2) + 'M';
	}
	if (amount >= 1e3) {
		return (amount / 1e3).toFixed(2) + 'K';
	}

	return amount.toFixed(decimals);
}

/**
 * Format wallet address for display (shortened)
 * @param address - Full address
 * @param startChars - Characters to show at start (default: 6)
 * @param endChars - Characters to show at end (default: 4)
 * @returns Shortened address
 */
export function formatAddress(address: string, startChars: number = 6, endChars: number = 4): string {
	if (!address || address.length < startChars + endChars) {
		return address;
	}
	return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

/**
 * Format percentage for display
 * @param percent - Percentage value
 * @param decimals - Number of decimal places (default: 2)
 * @param includeSign - Include +/- sign (default: true)
 * @returns Formatted percentage string
 */
export function formatPercent(
	percent: number,
	decimals: number = 2,
	includeSign: boolean = true
): string {
	const sign = includeSign && percent > 0 ? '+' : '';
	return `${sign}${percent.toFixed(decimals)}%`;
}

/**
 * Format PNL with emoji
 * @param pnlPercent - PNL percentage
 * @param pnlAmount - PNL amount
 * @param currency - Currency symbol (default: BNB)
 * @returns Formatted PNL string with emoji
 */
export function formatPnl(pnlPercent: number, pnlAmount: number, currency: string = 'BNB'): string {
	const emoji = pnlPercent >= 0 ? EMOJIS.CHART_UP : EMOJIS.CHART_DOWN;
	const sign = pnlPercent >= 0 ? '+' : '';
	return `${emoji} ${sign}${pnlPercent.toFixed(2)}% (${sign}${pnlAmount.toFixed(4)} ${currency})`;
}

/**
 * Format timestamp to readable date/time
 * @param timestamp - Date object or timestamp
 * @param includeTime - Include time (default: true)
 * @returns Formatted date string
 */
export function formatDate(timestamp: Date | number, includeTime: boolean = true): string {
	const date = typeof timestamp === 'number' ? new Date(timestamp) : timestamp;

	const dateStr = date.toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	});

	if (!includeTime) {
		return dateStr;
	}

	const timeStr = date.toLocaleTimeString('en-US', {
		hour: '2-digit',
		minute: '2-digit',
	});

	return `${dateStr} ${timeStr}`;
}

/**
 * Format time ago (e.g., "5 minutes ago")
 * @param timestamp - Date object or timestamp
 * @returns Time ago string
 */
export function formatTimeAgo(timestamp: Date | number): string {
	const date = typeof timestamp === 'number' ? new Date(timestamp) : timestamp;
	const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

	if (seconds < 60) return 'just now';
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
	if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

	return formatDate(date, false);
}

/**
 * Format transaction hash with BSCScan link
 * @param txHash - Transaction hash
 * @returns Formatted HTML link
 */
export function formatTxLink(txHash: string): string {
	const short = formatAddress(txHash, 10, 8);
	return `<a href="https://bscscan.com/tx/${txHash}">${short}</a>`;
}

/**
 * Format token address with BSCScan link
 * @param address - Token address
 * @param symbol - Token symbol (optional)
 * @returns Formatted HTML link
 */
export function formatTokenLink(address: string, symbol?: string): string {
	const display = symbol || formatAddress(address);
	return `<a href="https://bscscan.com/token/${address}">${display}</a>`;
}

/**
 * Format number with commas (thousands separator)
 * @param num - Number to format
 * @returns Formatted number string
 */
export function formatWithCommas(num: number): string {
	return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format gas price
 * @param gasPrice - Gas price in Gwei
 * @returns Formatted gas price string
 */
export function formatGasPrice(gasPrice: string | number): string {
	const price = typeof gasPrice === 'string' ? parseFloat(gasPrice) : gasPrice;
	return `${price} Gwei`;
}

/**
 * Create progress bar
 * @param current - Current value
 * @param total - Total value
 * @param length - Bar length (default: 10)
 * @returns Progress bar string
 */
export function createProgressBar(current: number, total: number, length: number = 10): string {
	const percent = Math.min((current / total) * 100, 100);
	const filled = Math.floor((percent / 100) * length);
	const empty = length - filled;

	return '█'.repeat(filled) + '░'.repeat(empty) + ` ${percent.toFixed(0)}%`;
}

/**
 * Truncate text with ellipsis
 * @param text - Text to truncate
 * @param maxLength - Maximum length
 * @returns Truncated text
 */
export function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return text.slice(0, maxLength - 3) + '...';
}

/**
 * Format boolean as ON/OFF with emoji
 * @param value - Boolean value
 * @returns Formatted string
 */
export function formatToggle(value: boolean): string {
	return value ? '✅ ON' : '❌ OFF';
}

/**
 * Format status with emoji
 * @param status - Status string
 * @returns Status with emoji
 */
export function formatStatus(status: string): string {
	const statusMap: Record<string, string> = {
		ACTIVE: '🟢 ACTIVE',
		INACTIVE: '🔴 INACTIVE',
		PENDING: '🟡 PENDING',
		SUCCESS: '✅ SUCCESS',
		FAILED: '❌ FAILED',
		SOLD: '💰 SOLD',
	};

	return statusMap[status.toUpperCase()] || status;
}
