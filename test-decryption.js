// Test decryption with current setup
require('dotenv').config();
const CryptoJS = require('crypto-js');
const mongoose = require('mongoose');

async function testDecryption() {
	try {
		console.log('Testing wallet decryption...\n');

		// Connect to database
		await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/fourmeme_trading_bot');
		console.log('✓ Connected to database');

		// Get encryption key
		const encryptionKey = process.env.ENCRYPTION_KEY;
		if (!encryptionKey) {
			console.error('✗ ENCRYPTION_KEY not found in .env');
			process.exit(1);
		}
		console.log('✓ Encryption key loaded:', encryptionKey.substring(0, 10) + '...');

		// Get a wallet
		const Wallet = mongoose.model('Wallet', new mongoose.Schema({
			encryptedPrivateKey: String,
			address: String,
		}), 'wallets');

		const wallet = await Wallet.findOne({});
		if (!wallet) {
			console.error('✗ No wallet found in database');
			process.exit(1);
		}
		console.log('✓ Wallet found:', wallet.address);
		console.log('  Encrypted key length:', wallet.encryptedPrivateKey?.length || 0);

		// Try to decrypt
		console.log('\nAttempting decryption...');
		const decrypted = CryptoJS.AES.decrypt(
			wallet.encryptedPrivateKey,
			encryptionKey
		).toString(CryptoJS.enc.Utf8);

		if (!decrypted || decrypted.length === 0) {
			console.error('✗ Decryption failed - result is empty');
			console.error('  This usually means:');
			console.error('  1. Wrong encryption key (key changed since wallet was created)');
			console.error('  2. Corrupted encrypted data');
			console.error('  3. Database was moved/restored with different key');
			process.exit(1);
		}

		console.log('✓ Decryption successful!');
		console.log('  Decrypted key length:', decrypted.length);
		console.log('  Starts with 0x:', decrypted.startsWith('0x'));

		// Try to create ethers wallet
		const {
			ethers
		} = require('ethers');
		const privateKey = decrypted.startsWith('0x') ? decrypted : `0x${decrypted}`;
		const ethWallet = new ethers.Wallet(privateKey);

		console.log('✓ Ethers wallet created successfully');
		console.log('  Address matches:', ethWallet.address.toLowerCase() === wallet.address.toLowerCase());

		if (ethWallet.address.toLowerCase() !== wallet.address.toLowerCase()) {
			console.error('✗ WARNING: Address mismatch!');
			console.error('  Expected:', wallet.address);
			console.error('  Got:', ethWallet.address);
		}

		console.log('\n✅ All tests passed!');

	} catch (error) {
		console.error('\n✗ Test failed:', error.message);
		console.error('\nFull error:', error);
	} finally {
		await mongoose.disconnect();
		process.exit(0);
	}
}

testDecryption();