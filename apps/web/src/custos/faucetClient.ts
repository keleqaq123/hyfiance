import {utils} from 'ethers'

export type FaucetConfig = {
  chainId: number; contract: string; siteKey: string; enabled: boolean; message: string
  captchaRequired?: boolean
  amountWei?: string; cooldownSeconds?: number; reserveWei?: string
  dailyLimitWei?: string; distributedTodayWei?: string
}
export type FaucetJob = {id: string; recipient: string; state: 'queued' | 'signed' | 'submitted' | 'confirmed' | 'failed' | 'attention'; tx_hash: string | null; error: string}
const jobStorageKey = 'custos-faucet-request-v1'
export function restoreFaucetJob(): FaucetJob | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(jobStorageKey) || 'null')
    if (!value || !/^[a-f0-9]{32}$/.test(value.id) || !['queued', 'signed', 'submitted', 'confirmed', 'failed', 'attention'].includes(value.state)) return null
    const recipient = recipientAddress(value.recipient)
    if (value.tx_hash !== null && !/^0x[a-fA-F0-9]{64}$/.test(value.tx_hash)) return null
    return {id: value.id, recipient, state: value.state, tx_hash: value.tx_hash, error: ''}
  } catch {return null}
}
export function retainFaucetJob(job: FaucetJob | null) {
  try {
    if (job) sessionStorage.setItem(jobStorageKey, JSON.stringify({id: job.id, recipient: job.recipient, state: job.state, tx_hash: job.tx_hash}))
    else sessionStorage.removeItem(jobStorageKey)
  } catch { /* Private browsing/storage restrictions must not break delivery. */ }
}
const base = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')

export function recipientAddress(input: string): string {
  const value = input.trim()
  if (!utils.isAddress(value) || value.toLowerCase() === '0x0000000000000000000000000000000000000000') throw new Error('Enter a valid, nonzero Ethereum address.')
  return utils.getAddress(value)
}
export async function faucetApi<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(base + '/api/faucet' + path, {
    method: body ? 'POST' : 'GET', signal, cache: 'no-store',
    headers: body ? {'Content-Type': 'application/json'} : {},
    ...(body ? {body: JSON.stringify(body)} : {}),
  })
  let value: any
  try {value = await response.json()} catch {throw new Error('Faucet service is temporarily unavailable.')}
  if (!response.ok) throw new Error(typeof value.detail === 'string' ? value.detail : value.detail?.message || 'Faucet request could not be completed.')
  return value as T
}
export function faucetJobLabel(job: FaucetJob): string {
  return {queued: 'Queued for the official sender', signed: 'Preparing delivery', submitted: 'Waiting for onchain confirmation', confirmed: 'Test ETH delivered', failed: 'Delivery failed', attention: 'Official sender review required'}[job.state]
}
