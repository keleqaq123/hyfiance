import React from 'react'
import styled from 'styled-components'

export const BodyWrapper = styled.div`
  position: relative;
  max-width: 520px;
  width: 100%;
  background: ${({ theme }) => theme.bg1};
  border: 1px solid ${({ theme }) => theme.bg3};
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.32), 0 0 0 1px rgba(255, 255, 255, 0.01);
  border-radius: 26px;
  padding: 20px;

  ${({ theme }) => theme.mediaWidth.upToSmall`
    border-radius: 22px;
    padding: 14px;
  `};
`

/**
 * The styled container element that wraps the content of most pages and the tabs.
 */
export default function AppBody({ children }: { children: React.ReactNode }) {
  return <BodyWrapper>{children}</BodyWrapper>
}
