import {afterEach, expect, it, vi} from 'vitest'
import {faucetApi, faucetJobLabel, recipientAddress, restoreFaucetJob, retainFaucetJob} from './faucetClient'
afterEach(() => {sessionStorage.clear();vi.unstubAllGlobals()})
it('rejects zero addresses and bad checksums, and normalizes a valid recipient', () => {
  expect(() => recipientAddress('0x' + '0'.repeat(40))).toThrow()
  expect(() => recipientAddress('0x52908400098527886E0F7030069857D2e4169EE7')).toThrow()
  expect(recipientAddress(' 0x52908400098527886e0f7030069857d2e4169ee7 ')).toBe('0x52908400098527886E0F7030069857D2E4169EE7')
})
it('does not describe a pending or uncertain broadcast as delivered', () => {
  expect(faucetJobLabel({state: 'submitted'} as any)).toContain('Waiting')
  expect(faucetJobLabel({state: 'attention'} as any)).toContain('review')
  expect(faucetJobLabel({state: 'confirmed'} as any)).toBe('Test ETH delivered')
})
it('surfaces structured eligibility failures without raw provider content', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: false, json: async () => ({detail: {code: 'COOLDOWN', message: 'Address is cooling down'}})}))
  await expect(faucetApi('/requests', {address: 'test'})).rejects.toThrow('Address is cooling down')
})
it('submits only the address and captcha token, never a wallet signature', async () => {
  const fetch = vi.fn().mockResolvedValue({ok: true, json: async () => ({id: 'test', state: 'queued'})})
  vi.stubGlobal('fetch', fetch)
  await faucetApi('/requests', {address: 'test', captchaToken: 'proof'})
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({address: 'test', captchaToken: 'proof'})
  expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('Authorization')
})
it('retains only public request metadata, not a CAPTCHA token or error payload', () => {
  const job = {id: 'a'.repeat(32), recipient: '0x2222222222222222222222222222222222222222', state: 'submitted', tx_hash: '0x' + 'ab'.repeat(32), error: 'provider detail', captchaToken: 'secret-proof'} as any
  retainFaucetJob(job)
  const serialized = sessionStorage.getItem('custos-faucet-request-v1')!
  expect(serialized).not.toContain('secret-proof');expect(serialized).not.toContain('provider detail')
  expect(restoreFaucetJob()).toEqual({...JSON.parse(serialized), error: ''})
  retainFaucetJob(null);expect(restoreFaucetJob()).toBeNull()
})
it('ignores corrupt stored requests and malformed transaction identifiers', () => {
  for (const value of ['not JSON', JSON.stringify({id: 'a'.repeat(32), recipient: '0x' + '0'.repeat(40), state: 'submitted', tx_hash: null}), JSON.stringify({id: 'a'.repeat(32), recipient: '0x2222222222222222222222222222222222222222', state: 'submitted', tx_hash: 'bad'})]) {
    sessionStorage.setItem('custos-faucet-request-v1', value);expect(restoreFaucetJob()).toBeNull()
  }
})
