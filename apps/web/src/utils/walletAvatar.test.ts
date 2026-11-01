import { expect, it } from 'vitest'
import { walletAvatar } from './walletAvatar'
it('renders deterministic public-address artwork without legacy color parsers', () => {
  const a = '0xee379A4fC908F03Cd886197945bf964806709D97'
  expect(walletAvatar(a)).toEqual(walletAvatar(a.toLowerCase()))
  expect(walletAvatar(a).shapes).toHaveLength(3)
  expect(walletAvatar(a)).not.toEqual(walletAvatar('0x32AF40B25CB5842f91E2B790563e5F0e51A70832'))
  expect(JSON.stringify(walletAvatar('invalid'))).not.toContain('NaN')
})
