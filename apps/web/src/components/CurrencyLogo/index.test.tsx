import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {ChainId, Token, V2_WETH} from 'custoswap-sdk'
import CurrencyLogo from '.'
vi.mock('../Logo', () => ({default: ({srcs}: {srcs: string[]}) => <span>{srcs.join(',')}</span>}))
vi.mock('../../hooks/useHttpLocations', () => ({default: () => []}))

it('uses bundled Custos logos instead of nonexistent mainnet artwork', () => {
  const token = new Token(ChainId.GIWA_SEPOLIA, '0x32AF40B25CB5842f91E2B790563e5F0e51A70832', 18, 'CUSTOS-A')
  const html = renderToStaticMarkup(<CurrencyLogo currency={token}/>)
  expect(html).toContain('custos-icon.png')
  expect(html).not.toContain('trustwallet')
})

it('renders V2 wrapped ether and unknown-chain tokens safely', () => {
  expect(renderToStaticMarkup(<CurrencyLogo currency={V2_WETH[ChainId.GIWA_SEPOLIA]}/>)).toContain('ethereum-logo')
  const token = new Token(987654 as ChainId, '0x0000000000000000000000000000000000000001', 18)
  expect(() => renderToStaticMarkup(<CurrencyLogo currency={token}/>)).not.toThrow()
})
