import useLiquidityPath from '../../hooks/useLiquidityPath'
import React from 'react'
import styled from 'styled-components'
import { useTranslation } from 'react-i18next'
import { NavLink, useLocation, Link as HistoryLink } from 'react-router-dom'

import { ArrowLeft } from 'react-feather'
import { RowBetween } from '../Row'
import QuestionHelper from '../QuestionHelper'

const Tabs = styled.div`
  ${({ theme }) => theme.flexRowNoWrap}
  align-items: center;
  border-radius: 1rem;
  justify-content: space-between;
  gap: 4px;
  width: 100%;
`

const TabGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const activeClassName = 'ACTIVE'

const StyledNavLink = styled(NavLink).attrs({
  activeClassName
})`
  ${({ theme }) => theme.flexRowNoWrap}
  align-items: center;
  justify-content: center;
  min-height: 2.5rem;
  padding: 0 15px;
  border-radius: 1.25rem;
  outline: none;
  cursor: pointer;
  text-decoration: none;
  color: ${({ theme }) => theme.text3};
  font-size: 16px;

  &.${activeClassName} {
    border-radius: 1.25rem;
    font-weight: 500;
    color: ${({ theme }) => theme.text1};
    background: ${({ theme }) => theme.bg3};
  }

  :hover,
  :focus {
    color: ${({ theme }) => theme.text1};
    text-decoration: none;
  }
`

const ActiveText = styled.div`
  font-weight: 500;
  font-size: 18px;
`

const StyledArrowLeft = styled(ArrowLeft)`
  color: ${({ theme }) => theme.text1};
`

export function SwapPoolTabs({ active, settings }: { active: 'swap' | 'pool'; settings?: React.ReactNode }) {
  const { t } = useTranslation()
  const reality=useLocation().pathname.startsWith('/reality')
  return (
    <Tabs style={{ marginBottom: '20px' }}>
      <TabGroup>
        <StyledNavLink id={`swap-nav-link`} to={reality?'/reality/swap':'/swap'} isActive={() => active === 'swap'}>
          {t('swap')}
        </StyledNavLink>
        <StyledNavLink id={`pool-nav-link`} to={reality?'/reality/pool':'/pool'} isActive={() => active === 'pool'}>
          {t('pool')}
        </StyledNavLink>
      </TabGroup>
      {settings}
    </Tabs>
  )
}

export function FindPoolTabs() {
  const liquidityPath = useLiquidityPath()
  const { t } = useTranslation()
  return (
    <Tabs>
      <RowBetween style={{ padding: '1rem' }}>
        <HistoryLink to={liquidityPath("/pool")}>
          <StyledArrowLeft />
        </HistoryLink>
        <ActiveText>{t('ImportPool')}</ActiveText>
        <QuestionHelper text={t('findPoolHelp')} />
      </RowBetween>
    </Tabs>
  )
}

export function AddRemoveTabs({ adding }: { adding: boolean }) {
  const liquidityPath = useLiquidityPath()
  const { t } = useTranslation()
  return (
    <Tabs>
      <RowBetween style={{ padding: '1rem' }}>
        <HistoryLink to={liquidityPath("/pool")}>
          <StyledArrowLeft />
        </HistoryLink>
        <ActiveText>{adding ? t('addLiquidity') : t('removeLiquidity')}</ActiveText>
        <QuestionHelper
          text={
            adding
              ? t('addtip')
              : t('remtip')
          }
        />
      </RowBetween>
    </Tabs>
  )
}
