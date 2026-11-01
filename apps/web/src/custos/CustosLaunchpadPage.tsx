import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { BigNumber } from '@ethersproject/bignumber'
import { formatEther, formatUnits, parseEther, parseUnits } from '@ethersproject/units'
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Copy,
  FileCheck2,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'

import { useActiveWeb3React } from '../hooks'
import {
  LAUNCHPAD_ABI,
  LaunchRecord,
  launchFromTuple,
  protocolContract,
  protocolDeployment,
  protocolReadProvider,
} from './protocolContracts'
import { MARKET_NETWORK } from './marketNetwork'

type Props = {
  wallet: string
  onConnect: () => void
  setToast: (value: string) => void
}

type LaunchMode = 'open' | 'curated'

const EXPLORER_BASE = import.meta.env.VITE_GIWA_EXPLORER || 'https://sepolia-explorer.giwa.io'
const READ_CHAIN_ID = Number(import.meta.env.VITE_GIWA_CHAIN_ID || MARKET_NETWORK.chainId || 91342)

function shortAddress(value: string) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—'
}

function formatAmount(raw: string, decimals = 18, digits = 2) {
  try {
    const value = Number(formatUnits(raw, decimals))
    if (!Number.isFinite(value)) return '—'
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value)
  } catch {
    return '—'
  }
}

function launchState(launch: LaunchRecord, now: number) {
  if (launch.finalized) return { label: 'FINALIZED', tone: 'muted' }
  if (now < launch.startAt) return { label: 'UPCOMING', tone: 'amber' }
  if (now > launch.endAt || launch.tokenReserve === '0') return { label: 'ENDED', tone: 'muted' }
  return { label: 'LIVE', tone: 'live' }
}

function readableError(error: any) {
  return (
    error?.reason ||
    error?.error?.message ||
    error?.data?.message ||
    error?.message ||
    'The GIWA Sepolia RPC did not return a valid Launchpad response.'
  )
}

export default function CustosLaunchpadPage({ wallet, onConnect, setToast }: Props) {
  const { account, chainId, library } = useActiveWeb3React()
  const activeWallet = wallet || account || ''
  const preferredReadChainId = Number(chainId || 0) === 47805 ? 47805 : READ_CHAIN_ID
  const deployment = protocolDeployment(preferredReadChainId) || protocolDeployment(READ_CHAIN_ID)
  const walletDeployment = protocolDeployment(Number(chainId || 0))
  const readProvider = useMemo(() => protocolReadProvider(deployment), [deployment?.chainId, deployment?.rpc])
  const readLaunchpad = useMemo(
    () => protocolContract(deployment?.contracts.launchpad, LAUNCHPAD_ABI, readProvider),
    [deployment?.contracts.launchpad, readProvider],
  )
  const launchpad = useMemo(
    () =>
      walletDeployment && walletDeployment.chainId === deployment?.chainId
        ? protocolContract(walletDeployment.contracts.launchpad, LAUNCHPAD_ABI, library, activeWallet)
        : null,
    [activeWallet, deployment?.chainId, library, walletDeployment?.chainId, walletDeployment?.contracts.launchpad],
  )
  const [mode, setMode] = useState<LaunchMode>('open')
  const [launches, setLaunches] = useState<LaunchRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [now, setNow] = useState(Math.floor(Date.now() / 1000))
  const [buyAmounts, setBuyAmounts] = useState<Record<number, string>>({})
  const [whitelistAddress, setWhitelistAddress] = useState('')
  const [whitelistLaunchId, setWhitelistLaunchId] = useState<number | null>(null)
  const [form, setForm] = useState({
    name: '',
    symbol: '',
    supply: '1000000',
    reserve: '1',
    duration: '30',
    metadataURI: 'custos://launch/',
  })

  const refresh = useCallback(async () => {
    if (!readLaunchpad) {
      setLaunches([])
      setLoadError('Launchpad is not configured for GIWA Sepolia.')
      return
    }
    setLoading(true)
    setLoadError('')
    try {
      const count = Math.min((await readLaunchpad.launchCount()).toNumber(), 50)
      const values = await Promise.all(
        Array.from({ length: count }, (_, index) => {
          const id = index + 1
          return readLaunchpad.getLaunch(id).then((value: any) => launchFromTuple(id, value))
        }),
      )
      setLaunches(values.reverse())
    } catch (error) {
      console.warn('[Custos launchpad]', error)
      setLoadError(readableError(error))
    } finally {
      setLoading(false)
    }
  }, [readLaunchpad])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 12_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function checkAdmin() {
      if (!launchpad || !activeWallet) {
        setIsAdmin(false)
        return
      }
      try {
        const admin = await launchpad.admin()
        if (!cancelled) setIsAdmin(admin.toLowerCase() === activeWallet.toLowerCase())
      } catch {
        if (!cancelled) setIsAdmin(false)
      }
    }
    void checkAdmin()
    return () => {
      cancelled = true
    }
  }, [activeWallet, launchpad])

  const visibleLaunches = useMemo(
    () => launches.filter((launch) => (mode === 'curated' ? launch.curated : !launch.curated)),
    [launches, mode],
  )

  async function createLaunch() {
    if (!activeWallet) {
      onConnect()
      return
    }
    if (!launchpad) {
      setToast('Launchpad is not deployed on this network yet.')
      return
    }
    if (!form.name.trim() || !form.symbol.trim()) {
      setToast('Enter a token name and symbol.')
      return
    }
    if (mode === 'curated' && !isAdmin) {
      setToast('The curated RWA lane is created by the Custos admin after review.')
      return
    }
    try {
      setBusy(true)
      const totalSupply = parseUnits(form.supply, 18)
      const virtualReserve = parseEther(form.reserve)
      const duration = Math.max(1, Number(form.duration || '30')) * 24 * 60 * 60
      const startAt = Math.floor(Date.now() / 1000) + 60
      const endAt = startAt + duration
      const method = mode === 'curated' ? 'createCuratedLaunch' : 'createLaunch'
      setToast(`Confirm ${mode === 'curated' ? 'curated RWA' : 'public'} launch in your wallet…`)
      const tx = await (launchpad as any)[method](
        form.name.trim(),
        form.symbol.trim().toUpperCase(),
        form.metadataURI.trim() || 'custos://launch/',
        totalSupply,
        virtualReserve,
        startAt,
        endAt,
      )
      await tx.wait()
      setToast(`${form.symbol.toUpperCase()} launch created onchain.`)
      setForm((value) => ({ ...value, name: '', symbol: '' }))
      await refresh()
    } catch (error: any) {
      setToast(error?.reason || error?.data?.message || error?.message || 'Launch creation failed.')
    } finally {
      setBusy(false)
    }
  }

  async function buy(launch: LaunchRecord) {
    if (!activeWallet) {
      onConnect()
      return
    }
    if (!launchpad) return
    const amount = buyAmounts[launch.id] || '0.05'
    try {
      const quote = parseEther(amount)
      if (quote.lte(0)) throw new Error('Enter a native quote amount greater than zero.')
      setBusy(true)
      const expected = (await launchpad.quoteFor(launch.id, quote)) as BigNumber
      const minimum = expected.mul(9_900).div(10_000)
      setToast(`Confirm ${launch.symbol} purchase in your wallet…`)
      const tx = await launchpad.buy(launch.id, minimum, { value: quote })
      await tx.wait()
      setToast(`Bought approximately ${formatAmount(expected.toString())} ${launch.symbol}.`)
      await refresh()
    } catch (error: any) {
      setToast(error?.reason || error?.data?.message || error?.message || 'Purchase failed.')
    } finally {
      setBusy(false)
    }
  }

  async function setWhitelist() {
    if (!launchpad || !isAdmin || !whitelistLaunchId) return
    if (!/^0x[a-fA-F0-9]{40}$/.test(whitelistAddress)) {
      setToast('Enter a valid wallet address for the curated whitelist.')
      return
    }
    try {
      setBusy(true)
      const tx = await launchpad.setWhitelist(whitelistLaunchId, whitelistAddress, true)
      await tx.wait()
      setToast(`${shortAddress(whitelistAddress)} can now participate in curated launch #${whitelistLaunchId}.`)
      setWhitelistAddress('')
    } catch (error: any) {
      setToast(error?.reason || error?.message || 'Whitelist update failed.')
    } finally {
      setBusy(false)
    }
  }

  const activeCount = launches.filter((launch) => launchState(launch, now).label === 'LIVE').length
  const raised = launches.reduce((sum, launch) => sum + Number(formatEther(launch.raised)), 0)

  return (
    <div className="defi-fade-in protocol-page launchpad-page">
      <div className="protocol-hero">
        <div className="protocol-hero-copy">
          <div className="defi-eyebrow">ONCHAIN LAUNCHPAD</div>
          <h1>Launch a market people can verify.</h1>
          <p>
            A fair-launch surface inspired by the best permissionless token launch products, with a second curated lane for reviewed RWA issuers. Supply, curve state and participation all settle onchain.
          </p>
          <div className="protocol-hero-actions">
            <button type="button" className="defi-primary-button" onClick={() => document.getElementById('launch-create')?.scrollIntoView({ behavior: 'smooth' })}>
              <Rocket size={15} /> Start a launch
            </button>
            <a className="defi-secondary-button" href={`${EXPLORER_BASE}/address/${deployment?.contracts.launchpad || ''}`} target="_blank" rel="noreferrer">
              View contract <ArrowUpRight size={15} />
            </a>
          </div>
        </div>
        <div className="protocol-hero-orbit">
          <div className="protocol-orbit-ring" />
          <div className="protocol-orbit-core"><Sparkles size={23} /><strong>FAIR<br />BY DEFAULT</strong></div>
          <span className="protocol-orbit-label protocol-orbit-label-a">PUBLIC</span>
          <span className="protocol-orbit-label protocol-orbit-label-b">RWA</span>
        </div>
      </div>

      <div className="protocol-stats-grid">
        <div><span>LIVE LAUNCHES</span><strong>{activeCount}</strong><small>settled by the curve</small></div>
        <div><span>PROJECTS INDEXED</span><strong>{launches.length}</strong><small>read directly from chain</small></div>
        <div><span>QUOTE RAISED</span><strong>{raised.toFixed(3)} ETH</strong><small>testnet value only</small></div>
        <div><span>ADMIN GATE</span><strong>{isAdmin ? 'CONNECTED' : 'REVIEWED'}</strong><small>curated lane is allowlisted</small></div>
      </div>

      <div className="protocol-lane-tabs" role="tablist" aria-label="Launchpad lanes">
        <button type="button" className={mode === 'open' ? 'active' : ''} onClick={() => setMode('open')} role="tab" aria-selected={mode === 'open'}>
          <Users size={16} /><span>Open launches</span><small>Anyone can create</small>
        </button>
        <button type="button" className={mode === 'curated' ? 'active curated' : 'curated'} onClick={() => setMode('curated')} role="tab" aria-selected={mode === 'curated'}>
          <ShieldCheck size={16} /><span>Curated RWA</span><small>Reviewed issuers only</small>
        </button>
      </div>

      <section className="protocol-section-heading">
        <div>
          <div className="defi-eyebrow">{mode === 'open' ? 'PERMISSIONLESS LANE' : 'CURATED RWA LANE'}</div>
          <h2>{mode === 'open' ? 'Discover launches before the crowd.' : 'Real-world assets need a higher bar.'}</h2>
          <p>{mode === 'open' ? 'Every launch uses the same transparent constant-product curve. There is no offchain allocation or hidden mint switch.' : 'This lane is reserved for selected RWA projects. The admin controls creation and wallet eligibility; purchases and token delivery remain onchain.'}</p>
        </div>
        <div className="protocol-chain-chip"><span className="defi-status-dot" />{deployment?.network || 'CONTRACT NOT DEPLOYED'}</div>
      </section>

      {!deployment ? (
        <section className="defi-card protocol-empty-state">
          <FileCheck2 size={23} />
          <h3>Launchpad contracts are not on this chain yet.</h3>
          <p>Start the local dual-chain deployment or switch your wallet to a configured protocol network.</p>
        </section>
      ) : loadError ? (
        <section className="defi-card protocol-empty-state">
          <FileCheck2 size={23} />
          <h3>Could not read Launchpad projects.</h3>
          <p>{loadError}</p>
          <button type="button" className="defi-secondary-button" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'protocol-spin' : undefined} /> Retry reading GIWA Sepolia
          </button>
        </section>
      ) : loading && launches.length === 0 ? (
        <section className="defi-card protocol-empty-state"><Loader2 className="protocol-spin" size={23} /><p>Reading launches from the chain…</p></section>
      ) : visibleLaunches.length === 0 ? (
        <section className="defi-card protocol-empty-state"><Rocket size={23} /><h3>No {mode === 'open' ? 'open' : 'curated'} launches yet.</h3><p>{mode === 'open' ? 'Be the first creator. Your project will appear here after the transaction confirms.' : 'Curated RWA launches are created by the admin after project review.'}</p></section>
      ) : (
        <div className="launch-card-grid">
          {visibleLaunches.map((launch) => {
            const state = launchState(launch, now)
            const sold = 1 - Number(launch.tokenReserve) / Math.max(1, Number(launch.totalSupply))
            const progress = Math.max(0, Math.min(100, sold * 100))
            return (
              <article key={launch.id} className={`launch-card ${launch.curated ? 'curated' : ''}`}>
                <div className="launch-card-topline"><span className={`protocol-state ${state.tone}`}>{state.label}</span><span>#{launch.id.toString().padStart(3, '0')}</span></div>
                <div className="launch-token-mark">{launch.symbol.slice(0, 2)}</div>
                <div className="launch-card-title"><div><h3>{launch.name}</h3><p>${launch.symbol} · {shortAddress(launch.token)}</p></div>{launch.curated ? <ShieldCheck size={18} /> : <Rocket size={18} />}</div>
                <p className="launch-card-copy">{launch.metadataURI || 'Transparent onchain token launch.'}</p>
                <div className="launch-progress"><div><span>CURVE SOLD</span><strong>{progress.toFixed(1)}%</strong></div><div className="launch-progress-track"><span style={{ width: `${progress}%` }} /></div></div>
                <div className="launch-card-metrics"><div><span>SUPPLY</span><strong>{formatAmount(launch.totalSupply, 18, 0)}</strong></div><div><span>RAISED</span><strong>{formatAmount(launch.raised, 18, 3)} ETH</strong></div><div><span>ENDS</span><strong>{new Date(launch.endAt * 1000).toLocaleDateString()}</strong></div></div>
                {state.label === 'LIVE' ? (
                  <div className="launch-buy-row"><input aria-label={`ETH amount for ${launch.symbol}`} inputMode="decimal" value={buyAmounts[launch.id] || '0.05'} onChange={(event) => setBuyAmounts((values) => ({ ...values, [launch.id]: event.target.value }))} /><button type="button" className="defi-primary-button" disabled={busy} onClick={() => void buy(launch)}>Buy ${launch.symbol} <ArrowUpRight size={14} /></button></div>
                ) : <div className="launch-ended-note"><Clock3 size={14} /> This launch is {state.label.toLowerCase()}.</div>}
              </article>
            )
          })}
        </div>
      )}

      <section id="launch-create" className="protocol-create-grid">
        <div className="defi-card protocol-form-card">
          <div className="protocol-form-heading"><div className="protocol-icon"><Plus size={17} /></div><div><div className="defi-eyebrow">CREATOR CONSOLE</div><h3>{mode === 'curated' ? 'Submit a curated RWA launch' : 'Create an open launch'}</h3></div></div>
          <p className="protocol-form-note">{mode === 'curated' ? 'Only the configured admin can publish this lane. Set wallet eligibility after the project is created.' : 'Your wallet deploys the token and initializes the virtual quote reserve in one transaction.'}</p>
          <div className="protocol-form-grid"><label>Project name<input value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} placeholder="Atlas Gold" /></label><label>Symbol<input value={form.symbol} onChange={(event) => setForm((value) => ({ ...value, symbol: event.target.value }))} placeholder="ATG" /></label><label>Total supply<input inputMode="decimal" value={form.supply} onChange={(event) => setForm((value) => ({ ...value, supply: event.target.value }))} /></label><label>Virtual reserve (ETH)<input inputMode="decimal" value={form.reserve} onChange={(event) => setForm((value) => ({ ...value, reserve: event.target.value }))} /></label><label>Sale duration (days)<input inputMode="numeric" value={form.duration} onChange={(event) => setForm((value) => ({ ...value, duration: event.target.value }))} /></label><label>Metadata URI<input value={form.metadataURI} onChange={(event) => setForm((value) => ({ ...value, metadataURI: event.target.value }))} /></label></div>
          <button type="button" className="defi-primary-button" disabled={busy} onClick={() => void createLaunch()}>{busy ? <Loader2 className="protocol-spin" size={15} /> : <Rocket size={15} />} {mode === 'curated' ? 'Publish curated launch' : 'Deploy open launch'}</button>
          {!activeWallet ? <p className="protocol-inline-note">Connect a wallet to create a launch.</p> : null}
        </div>

        <div className="defi-card protocol-trust-card"><div className="protocol-icon"><CheckCircle2 size={17} /></div><div className="defi-eyebrow">HOW IT WORKS</div><h3>One curve. Two lanes. Zero mystery.</h3><div className="protocol-step"><b>01</b><div><strong>Token deploys once</strong><p>Initial supply is held by the launchpad contract.</p></div></div><div className="protocol-step"><b>02</b><div><strong>Buy moves the curve</strong><p>Native quote enters the virtual reserve and tokens leave it.</p></div></div><div className="protocol-step"><b>03</b><div><strong>Finalization is public</strong><p>Creator can finalize after the window and withdraw proceeds.</p></div></div></div>
      </section>

      {mode === 'curated' && isAdmin ? (
        <section className="defi-card protocol-admin-card"><div><div className="defi-eyebrow">ADMIN REVIEW DESK</div><h3>Allow a wallet into the selected RWA sale.</h3><p>Whitelist writes are explicit onchain actions. There is no hidden backend gate.</p></div><div className="protocol-admin-form"><select aria-label="Curated launch" value={whitelistLaunchId || ''} onChange={(event) => setWhitelistLaunchId(Number(event.target.value) || null)}><option value="">Select launch</option>{launches.filter((launch) => launch.curated).map((launch) => <option key={launch.id} value={launch.id}>#{launch.id} · {launch.symbol}</option>)}</select><input aria-label="Wallet to whitelist" value={whitelistAddress} onChange={(event) => setWhitelistAddress(event.target.value)} placeholder="0x wallet address" /><button type="button" className="defi-secondary-button" disabled={busy} onClick={() => void setWhitelist()}><ShieldCheck size={15} /> Whitelist</button></div></section>
      ) : null}

      <div className="protocol-disclaimer"><FileCheck2 size={15} /><span>Testnet only. Launch tokens are experimental assets; a launch does not represent an investment offering, RWA ownership, or guaranteed liquidity migration.</span><button type="button" aria-label="Copy launchpad address" onClick={() => deployment && void navigator.clipboard?.writeText(deployment.contracts.launchpad)}><Copy size={13} /></button></div>
    </div>
  )
}
