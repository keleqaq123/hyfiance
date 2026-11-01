import { ChainId } from 'custoswap-sdk'
import React from 'react'
import { isMobile } from 'react-device-detect'
import { Text } from 'rebass'

import styled from 'styled-components'

import CustosIcon from '../../assets/images/custos-icon.png'
// import Wordmark from '../../assets/svg/wordmark.svg'
// import WordmarkDark from '../../assets/svg/wordmark_white.svg'
import { useActiveWeb3React } from '../../hooks'
import { useETHBalances } from '../../state/wallet/hooks'

import Menu from '../Menu'

import { RowBetween } from '../Row'
import Web3Status from '../Web3Status'
import I18nSwitch from '../I18nSwitch'
import HeaderLink from '../HeaderLink'

const HeaderFrame = styled.div`
  display: flex;
  align-items: center;
  width: 100%;
  top: 0;
  left: 0;
  position: fixed;
  z-index: 20;
  min-height: 76px;
  background: ${({ theme }) => theme.bg1};
  border-bottom: 1px solid ${({ theme }) => theme.bg3};
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
`

const HeaderInner = styled(RowBetween)`
  max-width: 1440px;
  min-height: 76px;
  margin: 0 auto;
  padding: 0 28px;

  ${({ theme }) => theme.mediaWidth.upToSmall`
    min-height: 68px;
    padding: 0 16px;
  `};
`

const HeaderElement = styled.div`
  display: flex;
  align-items: center;
  min-width: 0;
`

const HeaderElementWrap = styled.div`
  display: flex;
  align-items: center;

  ${({ theme }) => theme.mediaWidth.upToSmall`
    margin-top: 0;
    gap: 0;

    > :last-child {
      display: none;
    }
`};
`

const Title = styled.a`
  display: flex;
  align-items: center;
  pointer-events: auto;
  color: ${({ theme }) => theme.text1};
  text-decoration: none;

  :hover {
    cursor: pointer;
  }
`

const BrandName = styled.span`
  margin-left: 12px;
  color: ${({ theme }) => theme.text1};
  font-size: 20px;
  font-weight: 650;
  letter-spacing: -0.035em;
  white-space: nowrap;

  ${({ theme }) => theme.mediaWidth.upToExtraSmall`
    display: none;
  `};
`

const Title1 = styled.div`
  display: flex;
  align-items: center;
  pointer-events: auto;
  margin-left: 34px;

  :hover {
    cursor: pointer;
  }

  ${({ theme }) => theme.mediaWidth.upToMedium`
    margin-left: 18px;
  `};

  ${({ theme }) => theme.mediaWidth.upToSmall`
    display: none;
  `};
`

// const TitleText = styled(Row)`
//   width: fit-content;
//   white-space: nowrap;
//   ${({ theme }) => theme.mediaWidth.upToExtraSmall`
//     display: none;
//   `};
// `

const AccountElement = styled.div<{ active: boolean }>`
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: transparent;
  border-radius: 16px;
  white-space: nowrap;
  width: fit-content;

  :focus {
    outline: none;
  }
`

const TestnetWrapper = styled.div`
  white-space: nowrap;
  width: fit-content;
  margin-left: 10px;
  pointer-events: auto;
`

const NetworkCard = styled.div`
  display: flex;
  align-items: center;
  gap: 9px;
  width: fit-content;
  margin-right: 10px;
  border: 1px solid ${({ theme }) => theme.bg3};
  border-radius: 18px;
  background: ${({ theme }) => theme.bg2};
  color: ${({ theme }) => theme.text1};
  font-size: 15px;
  font-weight: 500;
  padding: 11px 15px;
`

const NetworkDot = styled.span`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ theme }) => theme.green1};
  box-shadow: 0 0 0 3px rgba(69, 201, 130, 0.12);
`

const UniIcon = styled.div`
  transition: transform 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  overflow: hidden;
  border: 1px solid ${({ theme }) => theme.bg3};
  border-radius: 12px;
  background: ${({ theme }) => theme.black};
  :hover {
    transform: rotate(-5deg);
  }
  ${({ theme }) => theme.mediaWidth.upToSmall`
    width: 38px;
    height: 38px;
  `};
`

const HeaderControls = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-shrink: 0;
  gap: 8px;

  ${({ theme }) => theme.mediaWidth.upToSmall`
    flex-direction: row;
    align-items: center;
    gap: 4px;
  `};
`

const HeaderWallet = styled(AccountElement)`
  ${({ theme }) => theme.mediaWidth.upToSmall`
    button {
      min-width: 118px;
      padding-left: 0.7rem;
      padding-right: 0.7rem;
    }
  `};
`

const BalanceText = styled(Text)`
  ${({ theme }) => theme.mediaWidth.upToExtraSmall`
    display: none;
  `};
`

const NETWORK_LABELS: { [chainId in ChainId]: string | null } = {
  [ChainId.GIWA_SEPOLIA]: 'GIWA Sepolia',
  [ChainId.MAINNET]: 'Ethereum',
  [ChainId.RINKEBY]: 'Rinkeby',
  [ChainId.ROPSTEN]: 'Ropsten',
  [ChainId.GÖRLI]: 'Görli',
  [ChainId.KOVAN]: 'Kovan',
  [ChainId.REI]: 'ETH',
  [ChainId.REITEST]: 'ETH',
}

export default function Header() {
  const { account, chainId } = useActiveWeb3React()

  const userEthBalance = useETHBalances(account ? [account] : [])?.[account ?? '']
  return (
    <HeaderFrame>
      <HeaderInner>
        <HeaderElement>
          <Title href="#/swap">
            <UniIcon>
              <img style={{ height: '42px', width: '42px' }} src={CustosIcon} alt="Custos Finance" />
            </UniIcon>
              <BrandName>Custos Finance</BrandName>
          </Title>
          <Title1>
            <HeaderLink />
          </Title1>
        </HeaderElement>
        <HeaderControls>
          <HeaderElement>
            <TestnetWrapper>
              {!isMobile && chainId && NETWORK_LABELS[chainId] && (
                <NetworkCard>
                  <NetworkDot />
                  {NETWORK_LABELS[chainId]}
                </NetworkCard>
              )}
            </TestnetWrapper>
            <HeaderWallet active={!!account} style={{ pointerEvents: 'auto' }}>
              {account && userEthBalance ? (
                <BalanceText style={{ flexShrink: 0 }} pl="0.75rem" pr="0.5rem" fontWeight={500}>
                  {userEthBalance?.toSignificant(4)} ETH
                </BalanceText>
              ) : null}
              <Web3Status />
            </HeaderWallet>
          </HeaderElement>
          <HeaderElementWrap>
            <Menu />
            <I18nSwitch />
          </HeaderElementWrap>
        </HeaderControls>
      </HeaderInner>
    </HeaderFrame>
  )
}
