import { ChainId, CurrencyAmount, ETHER, Pair, Percent, Route, Router, Token, TokenAmount, Trade, V2_WETH, WETH, getFactoryAddress } from '../src'

const a = new Token(ChainId.GIWA_SEPOLIA, '0x32AF40B25CB5842f91E2B790563e5F0e51A70832', 18)
const b = new Token(ChainId.GIWA_SEPOLIA, '0x5ea3096fA9366e136605A73269B38900529dfD5A', 18)

it('resolves the verified GIWA pair, independent of chain cache order', () => {
  const oldA = new Token(ChainId.REI, a.address, 18), oldB = new Token(ChainId.REI, b.address, 18)
  const oldPair = Pair.getAddress(oldA, oldB)
  expect(Pair.getAddress(a, b)).toBe('0x1A649Eb1D48D7962D3f72A54311CA4048590B25A')
  expect(Pair.getAddress(b, a)).toBe(Pair.getAddress(a, b))
  expect(Pair.getAddress(oldA, oldB)).toBe(oldPair)
  expect(oldPair).not.toBe(Pair.getAddress(a, b))
  expect(getFactoryAddress(ChainId.GIWA_SEPOLIA)).toBe('0x349a1CBB28C6267B4B567A06b2661Af8d6A1a1f5')
})

it('keeps native WETH unchanged and encodes V2 ETH routes with router WETH', () => {
  const wrapped = V2_WETH[ChainId.GIWA_SEPOLIA]
  expect(WETH[ChainId.GIWA_SEPOLIA].address).toBe('0x4200000000000000000000000000000000000006')
  expect(wrapped.address).toBe('0xeDBc87C8c03af5eB8Ff2C97ae9708719Ed050b66')
  const pair = new Pair(new TokenAmount(wrapped, '100000000000000000000'), new TokenAmount(a, '100000000000000000000'))
  const trade = Trade.exactIn(new Route([pair], ETHER, a), CurrencyAmount.ether('1000000000000000000'))
  const call = Router.swapCallParameters(trade, {ttl: 60, recipient: a.address, allowedSlippage: new Percent('1', '100')})
  expect(call.methodName).toBe('swapExactETHForTokens')
  expect(call.args[1]).toEqual([wrapped.address, a.address])
  const reverse = Trade.exactOut(new Route([pair], a, ETHER), CurrencyAmount.ether('1000000000000000000'))
  expect(reverse.route.path).toEqual([a, wrapped])
  const nativePair = new Pair(new TokenAmount(WETH[ChainId.GIWA_SEPOLIA], '1000'), new TokenAmount(a, '1000'))
  expect(() => new Route([nativePair], ETHER, a)).toThrow('INPUT')
})
