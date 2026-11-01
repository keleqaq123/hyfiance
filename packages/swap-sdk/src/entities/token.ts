import invariant from 'tiny-invariant'
import { ELYSIUM_V2 } from '../elysium'
import { ChainId } from '../constants'
import { validateAndParseAddress } from '../utils'
import { Currency } from './currency'

/**
 * Represents an ERC20 token with a unique address and some metadata.
 */
export class Token extends Currency {
  public readonly chainId: ChainId
  public readonly address: string

  public constructor(chainId: ChainId, address: string, decimals: number, symbol?: string, name?: string) {
    super(decimals, symbol, name)
    this.chainId = chainId
    this.address = validateAndParseAddress(address)
  }

  /**
   * Returns true if the two tokens are equivalent, i.e. have the same chainId and address.
   * @param other other token to compare
   */
  public equals(other: Token): boolean {
    // short circuit on reference equality
    if (this === other) {
      return true
    }
    return this.chainId === other.chainId && this.address === other.address
  }

  /**
   * Returns true if the address of this token sorts before the address of the other token
   * @param other other token to compare
   * @throws if the tokens have the same address
   * @throws if the tokens are on different chains
   */
  public sortsBefore(other: Token): boolean {
    invariant(this.chainId === other.chainId, 'CHAIN_IDS')
    invariant(this.address !== other.address, 'ADDRESSES')
    return this.address.toLowerCase() < other.address.toLowerCase()
  }
}

/**
 * Compares two currencies for equality
 */
export function currencyEquals(currencyA: Currency, currencyB: Currency): boolean {
  if (currencyA instanceof Token && currencyB instanceof Token) {
    return currencyA.equals(currencyB)
  } else if (currencyA instanceof Token) {
    return false
  } else if (currencyB instanceof Token) {
    return false
  } else {
    return currencyA === currencyB
  }
}

export const WETH = {
  [ChainId.ELYSIUM_TESTNET]: new Token(ChainId.ELYSIUM_TESTNET, ELYSIUM_V2.weth || '0x0000000000000000000000000000000000000000', 18, 'WHYPE', 'Wrapped HYPE'),
  [ChainId.GIWA_SEPOLIA]: new Token(ChainId.GIWA_SEPOLIA, '0x4200000000000000000000000000000000000006', 18, 'WETH', 'Wrapped Ether'),
  [ChainId.MAINNET]: new Token(
    ChainId.MAINNET,
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    18,
    'WETH',
    'Wrapped Ether'
  ),
  [ChainId.ROPSTEN]: new Token(
    ChainId.ROPSTEN,
    '0xc778417E063141139Fce010982780140Aa0cD5Ab',
    18,
    'WETH',
    'Wrapped Ether'
  ),
  [ChainId.RINKEBY]: new Token(
    ChainId.RINKEBY,
    '0xc778417E063141139Fce010982780140Aa0cD5Ab',
    18,
    'WETH',
    'Wrapped Ether'
  ),
  [ChainId.GÖRLI]: new Token(ChainId.GÖRLI, '0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6', 18, 'WETH', 'Wrapped Ether'),
  [ChainId.KOVAN]: new Token(ChainId.KOVAN, '0xd0A1E359811322d97991E03f863a0C30C2cF029C', 18, 'WETH', 'Wrapped Ether'),
  [ChainId.REI]: new Token(ChainId.REI, '0x286B8DecD5ED79c962b2d8F4346CD97FF0E2C352', 18, 'WETH', 'Wrapped Ether'),
  [ChainId.REITEST]: new Token(ChainId.REITEST, '0x286B8DecD5ED79c962b2d8F4346CD97FF0E2C352', 18, 'WETH', 'Wrapped Ether')
}

// GIWA's legacy V2 router wraps ETH into its own WETH, not the OP predeploy.
// Keep WETH unchanged for native bridge and chain consumers.
export const V2_WETH = {
  ...WETH,
  [ChainId.GIWA_SEPOLIA]: new Token(
    ChainId.GIWA_SEPOLIA,
    '0xeDBc87C8c03af5eB8Ff2C97ae9708719Ed050b66',
    18,
    'V2-WETH',
    'Custos V2 Wrapped Ether'
  )
}
