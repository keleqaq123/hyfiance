import React from 'react'
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'

const StyledMenu = styled.nav`
  display: flex;
  align-items: center;
  min-width: 0;
`

const MenuItems = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
`

const NavItem = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 14px;
  border-radius: 20px;
  color: ${({ theme }) => theme.text2};
  font-size: 15px;
  font-weight: 500;
  text-decoration: none;
  transition: background-color 160ms ease, color 160ms ease;

  &:hover {
    color: ${({ theme }) => theme.text1};
    text-decoration: none;
  }
`

const InternalNavItem = styled(NavLink).attrs({ activeClassName: 'ACTIVE', exact: true })`
  ${NavItem}

  &.ACTIVE {
    color: ${({ theme }) => theme.text1};
    background: ${({ theme }) => theme.bg3};
  }
`

export default function HeaderLink() {
  const { t } = useTranslation()

  return (
    <StyledMenu aria-label="Primary navigation">
      <MenuItems>
        <InternalNavItem id="header-swap-link" to="/swap">
          {t('swap')}
        </InternalNavItem>
        <InternalNavItem id="header-pool-link" to="/pool">
          {t('liquidity')}
        </InternalNavItem>
      </MenuItems>
    </StyledMenu>
  )
}
