import React, { useMemo } from 'react'
import styled from 'styled-components'
import { useActiveWeb3React } from '../../hooks'
import { walletAvatar } from '../../utils/walletAvatar'

const Container = styled.div`
  height: 1rem;
  width: 1rem;
  border-radius: 1.125rem;
  overflow: hidden;
  background-color: ${({ theme }) => theme.bg4};
`

// Public-address artwork only; no wallet keys or cryptographic operations.
export default function Identicon() {
  const { account } = useActiveWeb3React()
  const avatar = useMemo(() => walletAvatar(account || ''), [account])
  return <Container><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <rect width="16" height="16" fill={avatar.background}/>
    {avatar.shapes.map((shape, i) => <rect key={i} width="16" height="16" fill={shape.color} transform={shape.transform}/>)}
  </svg></Container>
}
