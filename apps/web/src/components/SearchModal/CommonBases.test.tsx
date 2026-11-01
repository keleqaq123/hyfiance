import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {ThemeProvider} from 'styled-components'
import {ChainId, WETH} from 'custoswap-sdk'
import CommonBases from './CommonBases'
import {theme} from '../../theme'
import {listToTokenMap} from '../../state/lists/hooks'

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('../QuestionHelper', () => ({default: () => null}))
vi.mock('../CurrencyLogo', () => ({default: () => null}))

it('renders GIWA and unsupported-chain token selectors without crashing', () => {
  for (const chainId of [ChainId.GIWA_SEPOLIA, 987654 as ChainId]) {
    const markup = renderToStaticMarkup(<ThemeProvider theme={theme(false)}><CommonBases chainId={chainId} onSelect={() => {}}/></ThemeProvider>)
    expect(markup).toContain('ETH')
  }
  expect(WETH[ChainId.GIWA_SEPOLIA].address).toBe('0x4200000000000000000000000000000000000006')
})

it('loads a GIWA token list without dropping the chain', () => {
  const token = WETH[ChainId.GIWA_SEPOLIA]
  const map = listToTokenMap({name: 'GIWA', timestamp: '2026-10-01T00:00:00Z', version: {major: 1, minor: 0, patch: 0}, tokens: [{chainId: 91342, address: token.address, decimals: 18, name: 'Wrapped Ether', symbol: 'WETH'}]})
  expect(map[ChainId.GIWA_SEPOLIA][token.address].symbol).toBe('WETH')
})
