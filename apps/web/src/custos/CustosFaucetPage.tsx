import React, {useCallback, useEffect, useState} from 'react'
import {utils} from 'ethers'
import {Droplets, ExternalLink, Loader2, RefreshCw, ShieldCheck} from 'lucide-react'
import FaucetTurnstile from './FaucetTurnstile'
import {faucetApi, FaucetConfig, FaucetJob, faucetJobLabel, recipientAddress, restoreFaucetJob, retainFaucetJob} from './faucetClient'

const explorer = 'https://sepolia-explorer.giwa.io'
function LegacyFaucetPage() {
  const [restored] = useState(restoreFaucetJob)
  const [config, setConfig] = useState<FaucetConfig | null>(null), [input, setInput] = useState(restored?.recipient || ''), [token, setToken] = useState('')
  const [error, setError] = useState(''), [pollError, setPollError] = useState(''), [busy, setBusy] = useState(false), [job, setJob] = useState<FaucetJob | null>(restored)
  const [refresh, setRefresh] = useState(0), [captchaRound, setCaptchaRound] = useState(0)
  const pending = Boolean(job && !['confirmed', 'failed'].includes(job.state))
  const captchaRequired = config?.captchaRequired !== false
  useEffect(() => retainFaucetJob(job), [job])
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    setError('');setConfig(null)
    void faucetApi<FaucetConfig>('/config', undefined, controller.signal).then(value => {
      if (!active || controller.signal.aborted) return
      if (value.chainId !== 91342) throw new Error('This faucet must use GIWA Sepolia.')
      setConfig(value)
    }).catch(reason => {if (active) setError(reason.name === 'AbortError' ? 'Faucet service is taking too long. Refresh to retry.' : reason.message)}).finally(() => clearTimeout(timer))
    return () => {active = false;clearTimeout(timer);controller.abort()}
  }, [refresh])
  useEffect(() => {
    if (!job || ['confirmed', 'failed', 'attention'].includes(job.state)) return
    let active = true, controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      controller = new AbortController();const timeout = setTimeout(() => controller?.abort(), 10000)
      try {const next = await faucetApi<FaucetJob>('/requests/' + job.id, undefined, controller.signal);if (active) {setJob(next);setPollError('')}}
      catch {if (active) setPollError('Status connection interrupted. Your request is retained; checking again.')}
      finally {clearTimeout(timeout);if (active) timer = setTimeout(() => void poll(), 4000)}
    }
    timer = setTimeout(() => void poll(), 1500)
    return () => {active = false;controller?.abort();if (timer) clearTimeout(timer)}
  }, [job?.id, job?.state])
  const onToken = useCallback((value: string) => setToken(value), [])
  async function submit(event: React.FormEvent) {
    event.preventDefault();if (busy || pending || !config?.enabled || (captchaRequired && !token)) return
    let recipient: string
    try {recipient = recipientAddress(input)} catch (reason: any) {setError(reason.message);return}
    if (recipient.toLowerCase() === config.contract.toLowerCase()) {setError('Enter your receiving wallet, not the faucet contract.');return}
    setBusy(true);setError('');setPollError('');setJob(null)
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000)
    try {const result = await faucetApi<FaucetJob>('/requests', {address: recipient, ...(captchaRequired ? {captchaToken: token} : {})}, controller.signal);setInput(recipient);setJob(result)}
    catch (reason: any) {setError(reason.name === 'AbortError' ? 'Submission timed out. Retry with the same address; an existing request will be reused.' : reason.message)}
    finally {clearTimeout(timer);setBusy(false);setToken('');setCaptchaRound(round => round + 1)}
  }
  const amount = config?.amountWei ? utils.formatEther(config.amountWei) : '—'
  const cooldown = typeof config?.cooldownSeconds === 'number'
    ? config.cooldownSeconds === 0 ? 'Cooldown: none · Enforced onchain' : 'Cooldown: ' + config.cooldownSeconds / 3600 + ' hours · Enforced onchain'
    : 'Amount and cooldown are read from the deployed contract'
  return <section className="rl-faucet-page">
    <div className="rl-heading"><div><p className="rl-eyebrow">GAS-SPONSORED · GIWA SEPOLIA</p><h1>GIWA test ETH faucet</h1><p>Paste your address. We pay the gas. No wallet connection or signature required.</p></div><Droplets size={36}/></div>
    <div className="rl-faucet-layout">
      <form className="rl-panel rl-inset rl-faucet-form" onSubmit={event => void submit(event)}>
        <div className="rl-panel-heading"><h2>Receive test ETH</h2><ShieldCheck size={22}/></div>
        <div className="rl-faucet-amount"><span>Per eligible address</span><strong>{amount} ETH</strong><small>{cooldown}</small></div>
        <label className="rl-field">Receiving wallet address<input value={input} onChange={event => {setInput(event.target.value);setError('')}} disabled={busy || pending} placeholder="0x…" autoComplete="off" spellCheck={false} maxLength={42} required/></label>
        <p className="rl-footnote">Double-check the address. Test ETH is sent on GIWA Sepolia (chain 91342), not Ethereum mainnet.</p>
        {config?.enabled && captchaRequired && config.siteKey && !pending ? <FaucetTurnstile key={captchaRound} siteKey={config.siteKey} onToken={onToken}/> : null}
        {!config?.enabled ? <p className="rl-inline-note" role="status">{config?.message || (error ? 'Faucet service unavailable.' : 'Checking faucet service…')}</p> : null}
        {error ? <p className="rl-alert" role="alert">{error}</p> : null}
        <button className="rl-button rl-full" disabled={busy || pending || !config?.enabled || (captchaRequired && !token)} type="submit">{busy ? <Loader2 className="spin" size={16}/> : <Droplets size={16}/>}<span>{busy ? 'Submitting request…' : pending ? 'Delivery in progress' : 'Request test ETH'}</span></button>
        {job ? <div className="rl-faucet-result" role="status"><strong>{faucetJobLabel(job)}</strong><p>Receiver: <code>{job.recipient}</code></p>{job.error ? <p>{job.error}</p> : null}{pollError ? <p>{pollError}</p> : null}{job.tx_hash ? <a href={explorer + '/tx/' + job.tx_hash} target="_blank" rel="noreferrer">View transaction <ExternalLink size={14}/></a> : null}<small>Request {job.id}</small></div> : null}
        <button type="button" className="rl-outline rl-full" disabled={busy || pending} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14}/><span>Refresh faucet status</span></button>
      </form>
      <aside className="rl-panel rl-inset rl-faucet-info"><h2>Zero ETH to get started</h2><p>You do not send a transaction. Our official operator calls the faucet contract for your address and covers the transaction fee.</p><ol><li>Enter an Ethereum-compatible receiving address.</li><li>{captchaRequired ? 'Complete human verification and request test ETH.' : 'Click Request test ETH. No human verification is currently required.'}</li><li>Follow the transaction until it confirms on GIWA Sepolia.</li></ol><dl><div><dt>Faucet reserve</dt><dd>{config?.reserveWei ? utils.formatEther(config.reserveWei) + ' ETH' : '—'}</dd></div><div><dt>Daily contract limit</dt><dd>{config?.dailyLimitWei ? utils.formatEther(config.dailyLimitWei) + ' ETH' : '—'}</dd></div></dl><p className="rl-inline-note">Testnet only. Test ETH has no monetary value. Address cooldowns, IP request limits{captchaRequired ? ', human verification' : ''} and daily budgets limit abuse; they do not guarantee one claim per person.</p>{config?.contract ? <a className="rl-chain-link" href={explorer + '/address/' + config.contract} target="_blank" rel="noreferrer">Faucet contract <ExternalLink size={14}/></a> : null}<a className="rl-chain-link" href="https://faucet.giwa.io/" target="_blank" rel="noreferrer">Official GIWA faucet <ExternalLink size={14}/></a></aside>
    </div>
  </section>
}

export default function CustosFaucetPage(){
 if(Number(import.meta.env.VITE_CHAIN_ID)!==99801)return <LegacyFaucetPage/>
 return <section className="rl-panel rl-inset"><h1>Elysium test HYPE faucet</h1><p>Receive native test HYPE on Elysium Testnet (99801) from the official faucet. These tokens are only for testing.</p><a className="rl-button" href="https://elysium.kinetiq.xyz/testnet-faucet" target="_blank" rel="noreferrer">Open Elysium faucet ↗</a></section>
}
