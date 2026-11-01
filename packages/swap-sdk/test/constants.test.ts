import { INIT_CODE_HASH } from '../src/constants'

describe('constants', () => {
  describe('INIT_CODE_HASH', () => {
    it('is a valid pair creation bytecode hash', () => {
      expect(INIT_CODE_HASH).toMatch(/^0x[0-9a-fA-F]{64}$/)
    })
  })
})
