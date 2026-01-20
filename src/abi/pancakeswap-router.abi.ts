/**
 * PancakeSwap V2 Router ABI
 */
export const PANCAKESWAP_ROUTER_ABI = [
	{
		inputs: [
			{ internalType: 'address', name: '_factory', type: 'address' },
			{ internalType: 'address', name: '_WETH', type: 'address' },
		],
		stateMutability: 'nonpayable',
		type: 'constructor',
	},
	{
		inputs: [],
		name: 'WETH',
		outputs: [{ internalType: 'address', name: '', type: 'address' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'factory',
		outputs: [{ internalType: 'address', name: '', type: 'address' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{ internalType: 'uint256', name: 'amountIn', type: 'uint256' },
			{ internalType: 'address[]', name: 'path', type: 'address[]' },
		],
		name: 'getAmountsOut',
		outputs: [{ internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{ internalType: 'uint256', name: 'amountOutMin', type: 'uint256' },
			{ internalType: 'address[]', name: 'path', type: 'address[]' },
			{ internalType: 'address', name: 'to', type: 'address' },
			{ internalType: 'uint256', name: 'deadline', type: 'uint256' },
		],
		name: 'swapExactETHForTokens',
		outputs: [{ internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' }],
		stateMutability: 'payable',
		type: 'function',
	},
	{
		inputs: [
			{ internalType: 'uint256', name: 'amountOutMin', type: 'uint256' },
			{ internalType: 'address[]', name: 'path', type: 'address[]' },
			{ internalType: 'address', name: 'to', type: 'address' },
			{ internalType: 'uint256', name: 'deadline', type: 'uint256' },
		],
		name: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
		outputs: [],
		stateMutability: 'payable',
		type: 'function',
	},
	{
		inputs: [
			{ internalType: 'uint256', name: 'amountIn', type: 'uint256' },
			{ internalType: 'uint256', name: 'amountOutMin', type: 'uint256' },
			{ internalType: 'address[]', name: 'path', type: 'address[]' },
			{ internalType: 'address', name: 'to', type: 'address' },
			{ internalType: 'uint256', name: 'deadline', type: 'uint256' },
		],
		name: 'swapExactTokensForETH',
		outputs: [{ internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' }],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [
			{ internalType: 'uint256', name: 'amountIn', type: 'uint256' },
			{ internalType: 'uint256', name: 'amountOutMin', type: 'uint256' },
			{ internalType: 'address[]', name: 'path', type: 'address[]' },
			{ internalType: 'address', name: 'to', type: 'address' },
			{ internalType: 'uint256', name: 'deadline', type: 'uint256' },
		],
		name: 'swapExactTokensForETHSupportingFeeOnTransferTokens',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
] as const;
