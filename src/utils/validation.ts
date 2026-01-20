import { ethers } from 'ethers';
import { MIN_SLIPPAGE, MAX_SLIPPAGE, MIN_TRADE_AMOUNT } from '../config/constants';

/**
 * Validation Utility
 * Validates addresses, private keys, and user inputs
 */

/**
 * Validate BSC wallet address
 * @param address - Address to validate
 * @returns True if valid
 */
export function isValidAddress(address: string): boolean {
	try {
		return ethers.utils.isAddress(address);
	} catch {
		return false;
	}
}

/**
 * Validate private key
 * @param privateKey - Private key to validate
 * @returns True if valid
 */
export function isValidPrivateKey(privateKey: string): boolean {
	try {
		// Remove 0x prefix if present
		const cleanKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;

		// Check if it's a valid hex string of correct length (64 characters)
		if (!/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
			return false;
		}

		// Try to create a wallet from the private key
		new ethers.Wallet(`0x${cleanKey}`);
		return true;
	} catch {
		return false;
	}
}

/**
 * Validate transaction hash
 * @param txHash - Transaction hash to validate
 * @returns True if valid
 */
export function isValidTxHash(txHash: string): boolean {
	try {
		// Remove 0x prefix if present
		const cleanHash = txHash.startsWith('0x') ? txHash.slice(2) : txHash;

		// Check if it's a valid hex string of correct length (64 characters)
		return /^[0-9a-fA-F]{64}$/.test(cleanHash);
	} catch {
		return false;
	}
}

/**
 * Validate BNB amount
 * @param amount - Amount to validate
 * @param maxAmount - Maximum allowed amount
 * @returns Object with validation result and error message
 */
export function validateBnbAmount(
	amount: number,
	maxAmount?: number
): { valid: boolean; error?: string } {
	if (isNaN(amount) || amount <= 0) {
		return { valid: false, error: 'Amount must be a positive number' };
	}

	if (amount < MIN_TRADE_AMOUNT) {
		return { valid: false, error: `Minimum amount is ${MIN_TRADE_AMOUNT} BNB` };
	}

	if (maxAmount && amount > maxAmount) {
		return { valid: false, error: `Maximum amount is ${maxAmount} BNB` };
	}

	return { valid: true };
}

/**
 * Validate slippage percentage
 * @param slippage - Slippage to validate
 * @returns Object with validation result and error message
 */
export function validateSlippage(slippage: number): { valid: boolean; error?: string } {
	if (isNaN(slippage) || slippage < 0) {
		return { valid: false, error: 'Slippage must be a positive number' };
	}

	if (slippage < MIN_SLIPPAGE) {
		return { valid: false, error: `Minimum slippage is ${MIN_SLIPPAGE}%` };
	}

	if (slippage > MAX_SLIPPAGE) {
		return { valid: false, error: `Maximum slippage is ${MAX_SLIPPAGE}%` };
	}

	return { valid: true };
}

/**
 * Validate percentage (0-10000)
 * @param percent - Percentage to validate
 * @returns Object with validation result and error message
 */
export function validatePercentage(percent: number): { valid: boolean; error?: string } {
	if (isNaN(percent) || percent < 0) {
		return { valid: false, error: 'Percentage must be a positive number' };
	}

	if (percent > 10000) {
		return { valid: false, error: 'Percentage cannot exceed 10000%' };
	}

	return { valid: true };
}

/**
 * Validate gas price (in Gwei)
 * @param gasPrice - Gas price to validate
 * @returns Object with validation result and error message
 */
export function validateGasPrice(gasPrice: string): { valid: boolean; error?: string } {
	try {
		const price = parseFloat(gasPrice);

		if (isNaN(price) || price <= 0) {
			return { valid: false, error: 'Gas price must be a positive number' };
		}

		if (price < 1) {
			return { valid: false, error: 'Gas price too low (min 1 Gwei)' };
		}

		if (price > 100) {
			return { valid: false, error: 'Gas price too high (max 100 Gwei)' };
		}

		return { valid: true };
	} catch {
		return { valid: false, error: 'Invalid gas price format' };
	}
}

/**
 * Validate wallet name
 * @param name - Wallet name to validate
 * @returns Object with validation result and error message
 */
export function validateWalletName(name: string): { valid: boolean; error?: string } {
	if (!name || name.trim().length === 0) {
		return { valid: false, error: 'Wallet name cannot be empty' };
	}

	if (name.length > 20) {
		return { valid: false, error: 'Wallet name too long (max 20 characters)' };
	}

	if (!/^[a-zA-Z0-9\s\-_]+$/.test(name)) {
		return { valid: false, error: 'Wallet name contains invalid characters' };
	}

	return { valid: true };
}

/**
 * Sanitize user input
 * @param input - Input to sanitize
 * @returns Sanitized input
 */
export function sanitizeInput(input: string): string {
	return input
		.trim()
		.replace(/[<>]/g, '') // Remove potential HTML tags
		.slice(0, 1000); // Limit length
}

/**
 * Validate numeric input from user
 * @param input - Input string
 * @returns Parsed number or null if invalid
 */
export function parseNumericInput(input: string): number | null {
	try {
		const sanitized = sanitizeInput(input);
		const num = parseFloat(sanitized);

		if (isNaN(num) || !isFinite(num)) {
			return null;
		}

		return num;
	} catch {
		return null;
	}
}

/**
 * Check if string is a valid number
 * @param str - String to check
 * @returns True if valid number
 */
export function isNumeric(str: string): boolean {
	return !isNaN(parseFloat(str)) && isFinite(parseFloat(str));
}
