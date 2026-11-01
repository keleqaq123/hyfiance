export const ZERO =
  '0x0000000000000000000000000000000000000000';

export const TEST_USDC_ABI = [
  'function faucet()',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function nextFaucetAt(address) view returns (uint256)',
];

export const VAULT_ABI = [
  'function deposit(uint256)',
  'function withdraw(uint256)',
  'function available(address) view returns (uint256)',
  'function locked(address) view returns (uint256)',
  'function protocolReserve() view returns (uint256)',
];

export const ORACLE_ABI = [
  'function getUpdateFee(bytes[]) view returns (uint256)',
];

export const ENGINE_ABI = [
  'function openPosition(bytes32,bool,uint256,uint256,bytes[]) payable returns (uint256 positionId)',
  'function openPositionWithTriggers(bytes32,bool,uint256,uint256,uint256,uint256,bytes[]) payable returns (uint256 positionId)',
  'function closePosition(uint256,bytes[]) payable',
  'function setTriggerPrices(uint256,uint256,uint256)',
  'function clearTriggerPrices(uint256)',
  'function executeTriggerPosition(uint256,bytes[]) payable',
  'function getActivePositionIds(address,bytes32) view returns (uint256[])',
  'function activePositionCount(address,bytes32) view returns (uint256)',
  'function positions(uint256) view returns (address trader,bytes32 marketId,uint128 sizeUsd,uint128 margin,uint128 entryPrice,bool isLong,uint64 openedAt)',
  'function triggerOrders(uint256) view returns (uint128 takeProfitPrice,uint128 stopLossPrice)',
  'function getLiquidationPrice(uint256) view returns (uint256)',
];

export const GIWA = {
  ...MARKET_NETWORK,
};
import { MARKET_NETWORK } from './marketNetwork';
