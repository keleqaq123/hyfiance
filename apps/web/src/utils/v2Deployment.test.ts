import { ChainId, ETHER, V2_WETH, WETH } from 'custoswap-sdk'
import { getRouterAddress } from '../constants'
import { unwrappedToken, wrappedCurrency } from './wrappedCurrency'
import { protocolDeployment, protocolReadProvider } from '../custos/protocolContracts'
import tokens from '../../public/tokenlist.json'

it('uses GIWA V2 router and wrapped token without replacing native WETH', () => {
  expect(getRouterAddress(91342)).toBe('0x4F1F5E8DE722e2773e7794af41ca0863457943C5')
  expect(wrappedCurrency(ETHER, ChainId.GIWA_SEPOLIA)).toBe(V2_WETH[ChainId.GIWA_SEPOLIA])
  expect(unwrappedToken(V2_WETH[ChainId.GIWA_SEPOLIA])).toBe(ETHER)
  expect(unwrappedToken(WETH[ChainId.GIWA_SEPOLIA])).toBe(WETH[ChainId.GIWA_SEPOLIA])
  for (const address of [WETH[ChainId.GIWA_SEPOLIA].address, V2_WETH[ChainId.GIWA_SEPOLIA].address, '0x32AF40B25CB5842f91E2B790563e5F0e51A70832', '0x5ea3096fA9366e136605A73269B38900529dfD5A']) {
    expect(tokens.tokens.some(t => t.chainId === 91342 && t.address.toLowerCase() === address.toLowerCase())).toBe(true)
  }
  expect(new Set(tokens.tokens.map(t => `${t.chainId}:${t.address.toLowerCase()}`)).size).toBe(tokens.tokens.length)
})

it('retains local networks and pairs public cUSD bridges with cached public reads', () => {
  for (const chain of [47805, 47806, 91342, 11155111]) expect(protocolDeployment(chain)).not.toBeNull()
  const giwa = protocolDeployment(91342)!, sepolia = protocolDeployment(11155111)!
  expect(giwa.counterparty?.bridge).toBe(sepolia.contracts.bridge)
  expect(sepolia.counterparty?.bridge).toBe(giwa.contracts.bridge)
  expect(protocolReadProvider(giwa)).toBe(protocolReadProvider(giwa))
  expect(protocolReadProvider(giwa)).not.toBe(protocolReadProvider(sepolia))
})
