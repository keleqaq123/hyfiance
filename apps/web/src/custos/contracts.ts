export const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function allowance(address owner,address spender) view returns (uint256)',
  'function approve(address spender,uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
] as const;

export const POOL_ABI = [
  ...ERC20_ABI,
  'function assetToken() view returns (address)',
  'function quoteToken() view returns (address)',
  'function getReserves() view returns (uint112 assetReserve,uint112 quoteReserve)',
  'function getAmountOut(address tokenIn,uint256 amountIn) view returns (uint256)',
  'function swapExactInput(address tokenIn,uint256 amountIn,uint256 minAmountOut,address to) returns (uint256)',
  'function addLiquidity(uint256 assetDesired,uint256 quoteDesired,uint256 assetMin,uint256 quoteMin,address to) returns (uint256 assetAmount,uint256 quoteAmount,uint256 liquidity)',
  'function removeLiquidity(uint256 liquidity,uint256 assetMin,uint256 quoteMin,address to) returns (uint256 assetAmount,uint256 quoteAmount)',
] as const;

export const REGISTRY_ABI = [
  'function registerAsset(bytes32 assetId,bytes32 documentHash,string metadataURI,uint64 maturityDate,uint8 riskScore)',
  'function setAssetStatus(bytes32 assetId,uint8 status)',
  'function getAsset(bytes32 assetId) view returns (tuple(bytes32 documentHash,address issuer,address verifier,uint64 maturityDate,uint8 riskScore,uint8 status,string metadataURI))',
  'function isVerified(bytes32 assetId) view returns (bool)',
] as const;

export const ASSET_FACTORY_ABI = [
  'function createAssetToken(bytes32 assetId,string name,string symbol,uint256 initialSupply) returns (address token)',
  'function assetToken(bytes32 assetId) view returns (address)',
] as const;

export const POOL_FACTORY_ABI = [
  'function createPool(address assetToken,address quoteToken) returns (address pool)',
  'function getPool(address assetToken,address quoteToken) view returns (address)',
] as const;
