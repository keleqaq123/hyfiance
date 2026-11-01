import { ChainId, Currency, CurrencyAmount, ETHER, Token, TokenAmount, V2_WETH as WETH } from 'custoswap-sdk'

export function displayCurrencySymbol(currency:Currency|undefined|null,chainId:number|undefined){
  return currency===ETHER&&chainId===99801?'HYPE':currency?.symbol
}

export function wrappedCurrency(currency: Currency | undefined, chainId: ChainId | undefined): Token | undefined {
  return chainId && currency === ETHER ? WETH[chainId] : currency instanceof Token ? currency : undefined
}

export function wrappedCurrencyAmount(
  currencyAmount: CurrencyAmount | undefined,
  chainId: ChainId | undefined
): TokenAmount | undefined {
  const token = currencyAmount && chainId ? wrappedCurrency(currencyAmount.currency, chainId) : undefined
  return token && currencyAmount ? new TokenAmount(token, currencyAmount.raw) : undefined
}

export function unwrappedToken(token: Token): Currency {
  const weth = WETH[token.chainId]
  if (weth && token.equals(weth)) return ETHER
  return token
}
