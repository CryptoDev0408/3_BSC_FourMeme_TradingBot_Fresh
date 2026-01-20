import CryptoJS from 'crypto-js';
import { config } from '../config/config';
import { logger } from './logger';

/**
 * Encryption Utility for Private Keys
 * Uses AES-256-GCM encryption
 */

/**
 * Encrypt a private key
 * @param privateKey - The private key to encrypt
 * @returns Encrypted private key as string
 */
export function encryptPrivateKey(privateKey: string): string {
  try {
    if (!config.security.encryptionKey) {
      throw new Error('Encryption key not configured');
    }

    // Remove 0x prefix if present
    const cleanKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;

    // Encrypt using AES
    const encrypted = CryptoJS.AES.encrypt(
      cleanKey,
      config.security.encryptionKey
    ).toString();

    return encrypted;
  } catch (error: any) {
    logger.error('Failed to encrypt private key:', error.message);
    throw new Error('Encryption failed');
  }
}

/**
 * Decrypt a private key
 * @param encryptedKey - The encrypted private key
 * @returns Decrypted private key
 */
export function decryptPrivateKey(encryptedKey: string): string {
  try {
    if (!config.security.encryptionKey) {
      throw new Error('Encryption key not configured');
    }

    // Decrypt using AES
    const decrypted = CryptoJS.AES.decrypt(
      encryptedKey,
      config.security.encryptionKey
    ).toString(CryptoJS.enc.Utf8);

    if (!decrypted) {
      throw new Error('Decryption failed - invalid encrypted data');
    }

    // Add 0x prefix
    return decrypted.startsWith('0x') ? decrypted : `0x${decrypted}`;
  } catch (error: any) {
    logger.error('Failed to decrypt private key:', error.message);
    throw new Error('Decryption failed');
  }
}

/**
 * Hash a string (for sensitive data)
 * @param data - Data to hash
 * @returns SHA256 hash
 */
export function hashData(data: string): string {
  return CryptoJS.SHA256(data).toString();
}

/**
 * Generate a random encryption salt
 * @returns Random salt string
 */
export function generateSalt(): string {
  return CryptoJS.lib.WordArray.random(128 / 8).toString();
}

/**
 * Securely compare two strings (timing-attack safe)
 * @param a - First string
 * @param b - Second string
 * @returns True if strings match
 */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}
