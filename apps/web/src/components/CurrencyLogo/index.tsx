import { Currency, ETHER, Token, WETH, V2_WETH } from 'custoswap-sdk'
import React, { useMemo } from 'react'
import styled from 'styled-components'

import EthereumLogo from '../../assets/images/ethereum-logo.png'
import useHttpLocations from '../../hooks/useHttpLocations'
import { WrappedTokenInfo } from '../../state/lists/hooks'
import Logo from '../Logo'
import bundledTokens from '../../../public/tokenlist.json'

const getTokenLogoURL = (address: string) =>
  `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/${address}/logo.png`

const StyledEthereumLogo = styled.img<{ size: string }>`
  width: ${({ size }) => size};
  height: ${({ size }) => size};
  box-shadow: 0px 6px 10px rgba(0, 0, 0, 0.075);
  border-radius: 24px;
`

const StyledLogo = styled(Logo)<{ size: string }>`
  width: ${({ size }) => size};
  height: ${({ size }) => size};
`

export default function CurrencyLogo({
  currency,
  size = '24px',
  style
}: {
  currency?: Currency
  size?: string
  style?: React.CSSProperties
}) {
  const isWrappedEther = currency instanceof Token && Boolean(
    (WETH[currency.chainId] && currency.equals(WETH[currency.chainId])) ||
    (V2_WETH[currency.chainId] && currency.equals(V2_WETH[currency.chainId]))
  )
  const uriLocations = useHttpLocations(
    currency instanceof WrappedTokenInfo && !isWrappedEther ? currency.logoURI : undefined
  )

  const srcs: string[] = useMemo(() => {
    if (currency === ETHER || isWrappedEther) return []

    if (currency instanceof Token) {
      const bundled = bundledTokens.tokens.find(token => token.chainId === currency.chainId && token.address.toLowerCase() === currency.address.toLowerCase())
      if (bundled?.logoURI) return [bundled.logoURI]
      // Testnet tokens do not have Ethereum-mainnet Trust Wallet artwork.
      if (currency.chainId !== 1) return uriLocations
      if (currency instanceof WrappedTokenInfo) {
        return [...uriLocations, getTokenLogoURL(currency.address)]
      }

      return [getTokenLogoURL(currency.address)]
    }
    return []
  }, [currency, isWrappedEther, uriLocations])

  if (currency === ETHER || isWrappedEther) {
    return <StyledEthereumLogo src={EthereumLogo} size={size} style={style} />
  }

  return <StyledLogo size={size} srcs={srcs} alt={`${currency?.symbol ?? 'token'} logo`} style={style} />
}
