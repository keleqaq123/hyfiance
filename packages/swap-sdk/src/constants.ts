import JSBI from 'jsbi'
import { ELYSIUM_V2 } from './elysium'

// exports for external consumption
export type BigintIsh = JSBI | bigint | string

export enum ChainId {
  MAINNET = 1,
  ROPSTEN = 3,
  RINKEBY = 4,
  GÖRLI = 5,
  KOVAN = 42,
  REI = 47805,
  REITEST = 12357,
  ELYSIUM_TESTNET = 99801,
  GIWA_SEPOLIA = 91342
}

export enum TradeType {
  EXACT_INPUT,
  EXACT_OUTPUT
}

export enum Rounding {
  ROUND_DOWN,
  ROUND_HALF_UP,
  ROUND_UP
}

export const FACTORY_ADDRESS = '0xb868Cc77A95a65F42611724AF05Aa2d3B6Ec05F2'

// Deployments for the supported Custos V2 networks. Keep FACTORY_ADDRESS as
// the legacy fallback for consumers that use the old SDK constants directly.
export const FACTORY_ADDRESSES: Partial<Record<ChainId, string>> = {
  [ChainId.REI]: FACTORY_ADDRESS,
  [ChainId.REITEST]: FACTORY_ADDRESS,
  [ChainId.GIWA_SEPOLIA]: '0x349a1CBB28C6267B4B567A06b2661Af8d6A1a1f5'
}

export const INIT_CODE_HASH = '0x557a766008a8cd8e924285f8112de27cababa9ac28e813698860a4342ed3f647'

export const INIT_CODE_HASHES: Partial<Record<ChainId, string>> = {
  [ChainId.REI]: INIT_CODE_HASH,
  [ChainId.REITEST]: INIT_CODE_HASH,
  [ChainId.GIWA_SEPOLIA]: INIT_CODE_HASH
}

export function getFactoryAddress(chainId: ChainId): string {
  if (chainId === ChainId.ELYSIUM_TESTNET) {
    if (!ELYSIUM_V2.factory) throw new Error('Elysium V2 is not deployed')
    return ELYSIUM_V2.factory
  }
  return FACTORY_ADDRESSES[chainId] ?? FACTORY_ADDRESS
}

export function getInitCodeHash(chainId: ChainId): string {
  if (chainId === ChainId.ELYSIUM_TESTNET) {
    if (!ELYSIUM_V2.initCodeHash) throw new Error('Elysium V2 is not deployed')
    return ELYSIUM_V2.initCodeHash
  }
  return INIT_CODE_HASHES[chainId] ?? INIT_CODE_HASH
}

export const MINIMUM_LIQUIDITY = JSBI.BigInt(1000)

// exports for internal consumption
export const ZERO = JSBI.BigInt(0)
export const ONE = JSBI.BigInt(1)
export const TWO = JSBI.BigInt(2)
export const THREE = JSBI.BigInt(3)
export const FIVE = JSBI.BigInt(5)
export const TEN = JSBI.BigInt(10)
export const _100 = JSBI.BigInt(100)
export const _997 = JSBI.BigInt(997)
export const _1000 = JSBI.BigInt(1000)

export enum SolidityType {
  uint8 = 'uint8',
  uint256 = 'uint256'
}

export const SOLIDITY_TYPE_MAXIMA = {
  [SolidityType.uint8]: JSBI.BigInt('0xff'),
  [SolidityType.uint256]: JSBI.BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
}
