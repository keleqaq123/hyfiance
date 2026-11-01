export const ZERO = '0x0000000000000000000000000000000000000000';

export const TEST_USDC_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function faucet()',
  'function nextFaucetAt(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
] as const;

export const SYNTH_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function totalSupply() view returns (uint256)',
  'function symbol() view returns (string)',
] as const;

export const SPOT_POOL_ABI = [
  'function assetToken() view returns (address)',
  'function quoteToken() view returns (address)',
  'function feedId() view returns (bytes32)',
  'function feeBps() view returns (uint32)',
  'function minCollateralBps() view returns (uint32)',
  'function totalFeesQuote() view returns (uint256)',
  'function getUpdateFee(bytes[]) view returns (uint256)',
  'function quoteBuy(uint256) view returns (uint256 assetOut,uint256 feeQuote,uint256 price18)',
  'function quoteSell(uint256) view returns (uint256 quoteOut,uint256 feeQuote,uint256 price18)',
  'function buyExactQuote(uint256,uint256,bytes[]) payable returns (uint256)',
  'function sellExactAsset(uint256,uint256,bytes[]) payable returns (uint256)',
  'function previewAddLiquidity(uint256) view returns (uint256)',
  'function previewRemoveLiquidity(uint256) view returns (uint256)',
  'function addLiquidity(uint256,uint256,bytes[]) payable returns (uint256)',
  'function removeLiquidity(uint256,uint256,bytes[]) payable returns (uint256)',
  'function getPoolState() view returns (uint256 price18,uint256 quoteBalance,uint256 liabilityQuote,uint256 equityQuote,uint256 collateralBps,uint256 syntheticSupply,uint256 lpSupply)',
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
] as const;

export const PERP_VAULT_ABI = [
  'function available(address) view returns (uint256)',
  'function locked(address) view returns (uint256)',
  'function deposit(uint256)',
  'function withdraw(uint256)',
] as const;
