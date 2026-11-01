import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach, afterEach, expect, it, vi} from 'vitest'
import CustosFaucetPage from './CustosFaucetPage'
Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
vi.mock('./FaucetTurnstile', () => ({default: () => <div>Human verification</div>}))
let root: ReturnType<typeof createRoot>, container: HTMLDivElement
beforeEach(() => vi.stubEnv('VITE_CHAIN_ID', '91342'))
afterEach(() => {act(() => root?.unmount());container?.remove();sessionStorage.clear();vi.unstubAllGlobals();vi.unstubAllEnvs()})
it('allows address entry without a connected wallet and cannot claim when unconfigured', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true, json: async () => ({chainId: 91342, contract: '', siteKey: '', enabled: false, message: 'Sponsored faucet is not yet configured.'})}))
  container = document.createElement('div');document.body.appendChild(container);root = createRoot(container)
  await act(async () => root.render(<CustosFaucetPage/>))
  expect(container.textContent).toContain('No wallet connection or signature required')
  expect(container.querySelector('input')).not.toBeNull()
  expect(container.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(true)
  expect(container.textContent).toContain('Sponsored faucet is not yet configured')
  expect(container.textContent).not.toContain('Connect wallet')
})
it('restores a pending request after refresh without sending a second claim', async () => {
  const job = {id: 'a'.repeat(32), recipient: '0x2222222222222222222222222222222222222222', state: 'submitted', tx_hash: '0x' + 'ab'.repeat(32)}
  sessionStorage.setItem('custos-faucet-request-v1', JSON.stringify(job))
  const fetchMock = vi.fn().mockResolvedValue({ok: true, json: async () => ({chainId: 91342, contract: '', siteKey: '', enabled: false, message: 'Waiting for activation'})})
  vi.stubGlobal('fetch', fetchMock)
  container = document.createElement('div');document.body.appendChild(container);root = createRoot(container)
  await act(async () => root.render(<CustosFaucetPage/>))
  expect(container.textContent).toContain('Waiting for onchain confirmation')
  expect(container.querySelector<HTMLInputElement>('input')?.value).toBe(job.recipient)
  expect(container.querySelector<HTMLInputElement>('input')?.disabled).toBe(true)
  expect(fetchMock.mock.calls.every(call => call[1].method === 'GET')).toBe(true)
})
it('allows address-only submission when the server explicitly disables CAPTCHA', async () => {
  const recipient = '0x2222222222222222222222222222222222222222'
  const fetchMock = vi.fn().mockImplementation(async (_url, init) => ({ok: true, json: async () => init.method === 'POST'
    ? {id: 'b'.repeat(32), recipient, state: 'queued', tx_hash: null, error: ''}
    : {chainId: 91342, contract: '0x3333333333333333333333333333333333333333', enabled: true, captchaRequired: false, siteKey: '', message: '', amountWei: '1000000000000000'}}))
  vi.stubGlobal('fetch', fetchMock)
  container = document.createElement('div');document.body.appendChild(container);root = createRoot(container)
  await act(async () => root.render(<CustosFaucetPage/>))
  expect(container.textContent).not.toContain('Human verification')
  const input = container.querySelector('input')!
  await act(async () => {Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, recipient);input.dispatchEvent(new Event('input', {bubbles: true}))})
  expect(container.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(false)
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true})))
  const post = fetchMock.mock.calls.find(call => call[1].method === 'POST')!
  expect(JSON.parse(post[1].body)).toEqual({address: recipient})
  expect(container.textContent).toContain('Queued for the official sender')
})
