/**
 * B_Token - Token Information Class
 * Represents a token on BSC with its metadata
 */
export class B_Token {
	public address: string;
	public name?: string;
	public symbol?: string;
	public decimals: number;
	public totalSupply?: string;
	public pairAddress?: string;
	public liquidityBnb?: number;

	constructor(data: {
		address: string;
		name?: string;
		symbol?: string;
		decimals?: number;
		totalSupply?: string;
		pairAddress?: string;
		liquidityBnb?: number;
	}) {
		this.address = data.address.toLowerCase();
		this.name = data.name;
		this.symbol = data.symbol;
		this.decimals = data.decimals || 18;
		this.totalSupply = data.totalSupply;
		this.pairAddress = data.pairAddress;
		this.liquidityBnb = data.liquidityBnb;
	}

	/**
	 * Create token from address
	 */
	static fromAddress(address: string): B_Token {
		return new B_Token({ address });
	}

	/**
	 * Get token identifier
	 */
	getId(): string {
		return this.address;
	}

	/**
	 * Check if token has metadata
	 */
	hasMetadata(): boolean {
		return !!(this.name && this.symbol);
	}

	/**
	 * Get display name
	 */
	getDisplayName(): string {
		if (this.symbol) return this.symbol;
		if (this.name) return this.name;
		return `${this.address.slice(0, 6)}...${this.address.slice(-4)}`;
	}

	/**
	 * Format token amount
	 */
	formatAmount(amount: string | number): string {
		const num = typeof amount === 'string' ? parseFloat(amount) : amount;
		if (isNaN(num)) return '0';

		// Format with appropriate decimals
		if (num >= 1000000) {
			return `${(num / 1000000).toFixed(2)}M`;
		} else if (num >= 1000) {
			return `${(num / 1000).toFixed(2)}K`;
		} else if (num >= 1) {
			return num.toFixed(4);
		} else {
			return num.toFixed(8);
		}
	}

	/**
	 * Serialize to JSON
	 */
	toJSON() {
		return {
			address: this.address,
			name: this.name,
			symbol: this.symbol,
			decimals: this.decimals,
			totalSupply: this.totalSupply,
			pairAddress: this.pairAddress,
			liquidityBnb: this.liquidityBnb,
		};
	}
}
