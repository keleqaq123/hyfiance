import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { formatUnits, parseUnits } from '@ethersproject/units'
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  Clipboard,
  Copy,
  ExternalLink,
  Loader2,
  LockKeyhole,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  UnlockKeyhole,
} from 'lucide-react'

import { useActiveWeb3React } from '../hooks'
import {
  BRIDGE_ABI,
  BRIDGE_TOKEN_ABI,
  protocolContract,
  protocolDeployment,
  protocolDeployments,
  protocolReadProvider,
} from './protocolContracts'

type Props = {
  wallet: string
  onConnect: () => void
  setToast: (value: string) => void
}

type RelayMessage = {
  messageId: string
  sourceChainId: number
  targetChainId: number
  sourceBridge: string
  sourceToken: string
  recipient: string
  amount: string
  nonce: string
  payload: string
  createdAt: number
}

type RelayerHealth = {
  ok: boolean
  wallet: string
  networks: Array<{
    chainId: number
    lastError: string | null
    lastScannedBlock: number | null
  }>
  messages: {
    total: number
    counts: Record<string, number>
  }
}

type RelayerMessageState = {
  messageId: string
  status: string
  targetTxHash?: string
}

const STORAGE_KEY = 'custos.bridge.pending.v1'
const RELAYER_API_BASE =
  import.meta.env.VITE_RELAYER_API_BASE ||
  (typeof window !== 'undefined' && !['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? '/relayer'
    : 'http://127.0.0.1:8090')
const DEFAULT_BRIDGE_CHAIN_ID = 91342

function short(value: string) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—'
}

function readPending(): RelayMessage[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const value = raw ? JSON.parse(raw) : []
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function writePending(value: RelayMessage[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value.slice(0, 12)))
}

function networkParams(deployment: ReturnType<typeof protocolDeployment>) {
  if (!deployment) return null
  const explorer =
    deployment.chainId === 11155111
      ? 'https://sepolia.etherscan.io'
      : deployment.chainId === DEFAULT_BRIDGE_CHAIN_ID
        ? import.meta.env.VITE_GIWA_EXPLORER || 'https://sepolia-explorer.giwa.io'
        : import.meta.env.VITE_LOCAL_EXPLORER || ''
  return {
    chainId: `0x${deployment.chainId.toString(16)}`,
    chainName: deployment.network,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: [deployment.rpc],
    ...(explorer ? { blockExplorerUrls: [explorer] } : {}),
  }
}

export default function CustosBridgePage({ wallet, onConnect, setToast }: Props) {
  const { account, chainId, library } = useActiveWeb3React()
  const activeWallet = wallet || account || ''
  const walletChainId = Number(chainId || 0)
  const activeChainId = walletChainId || DEFAULT_BRIDGE_CHAIN_ID
  const deployment = protocolDeployment(activeChainId)
  const targetChainId = deployment?.counterparty?.chainId || 0
  const targetDeployment = protocolDeployment(targetChainId)
  const walletOnDeploymentNetwork = Boolean(walletChainId && deployment?.chainId === walletChainId)
  const readProvider = protocolReadProvider(deployment)
  const bridgeProvider = walletOnDeploymentNetwork ? library : readProvider
  const bridgeAccount = walletOnDeploymentNetwork ? activeWallet : undefined
  const bridge = useMemo(
    () => protocolContract(deployment?.contracts.bridge, BRIDGE_ABI, bridgeProvider as any, bridgeAccount),
    [bridgeAccount, bridgeProvider, deployment?.contracts.bridge],
  )
  const token = useMemo(
    () => protocolContract(deployment?.contracts.bridgeToken, BRIDGE_TOKEN_ABI, bridgeProvider as any),
    [bridgeProvider, deployment?.contracts.bridgeToken],
  )

  const [amount, setAmount] = useState('10')
  const [balance, setBalance] = useState('0')
  const [isRelayer, setIsRelayer] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<RelayMessage[]>([])
  const [selected, setSelected] = useState<RelayMessage | null>(null)
  const [relayerHealth, setRelayerHealth] = useState<RelayerHealth | null>(null)
  const [sourceChain, setSourceChain] = useState('')
  const [sourceBridge, setSourceBridge] = useState('')
  const [sourceToken, setSourceToken] = useState('')
  const [recipient, setRecipient] = useState('')
  const [rawAmount, setRawAmount] = useState('')
  const [nonce, setNonce] = useState('')
  const [payload, setPayload] = useState('0x')
  const configuredNetworks = protocolDeployments()

  const refreshRelayer = useCallback(async () => {
    try {
      const healthResponse = await fetch(`${RELAYER_API_BASE}/health`, { cache: 'no-store' })
      if (!healthResponse.ok) throw new Error(`Relayer returned ${healthResponse.status}`)
      setRelayerHealth((await healthResponse.json()) as RelayerHealth)

      const localMessages = readPending()
      if (localMessages.length > 0) {
        const states = await Promise.all(
          localMessages.map(async (message): Promise<RelayerMessageState | null> => {
            const response = await fetch(`${RELAYER_API_BASE}/messages/${message.messageId}`, { cache: 'no-store' })
            if (!response.ok) return null
            return (await response.json()) as RelayerMessageState
          }),
        )
        const next = localMessages.filter((message, index) => states[index]?.status !== 'executed')
        if (next.length !== localMessages.length) {
          writePending(next)
          setPending(next)
          setSelected((current) => (current && !next.some((item) => item.messageId === current.messageId) ? null : current))
        }
      }
    } catch {
      setRelayerHealth(null)
    }
  }, [])

  const refresh = useCallback(async () => {
    setPending(readPending())
    if (!token || !activeWallet || !walletOnDeploymentNetwork) {
      setBalance('0')
      setIsRelayer(false)
      return
    }
    try {
      const [rawBalance, relayer] = await Promise.all([
        token.balanceOf(activeWallet),
        bridge ? bridge.isRelayer(activeWallet) : Promise.resolve(false),
      ])
      setBalance(formatUnits(rawBalance, 18))
      setIsRelayer(Boolean(relayer))
    } catch (error) {
      console.warn('[Custos bridge]', error)
    }
  }, [activeWallet, bridge, token, walletOnDeploymentNetwork])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 8_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    void refreshRelayer()
    const timer = window.setInterval(() => void refreshRelayer(), 8_000)
    return () => window.clearInterval(timer)
  }, [refreshRelayer])

  function selectMessage(message: RelayMessage) {
    setSelected(message)
    setSourceChain(String(message.sourceChainId))
    setSourceBridge(message.sourceBridge)
    setSourceToken(message.sourceToken)
    setRecipient(message.recipient)
    setRawAmount(message.amount)
    setNonce(message.nonce)
    setPayload(message.payload || '0x')
  }

  async function switchTo(deploymentToUse: ReturnType<typeof protocolDeployment>) {
    if (!deploymentToUse || !window.ethereum) {
      setToast('An injected wallet is required to switch networks.')
      return
    }
    const params = networkParams(deploymentToUse)
    if (!params) return
    try {
      await (window.ethereum as any).request({ method: 'wallet_switchEthereumChain', params: [{ chainId: params.chainId }] })
    } catch (error: any) {
      if (error?.code !== 4902) {
        setToast(error?.message || 'Network switch was rejected.')
        return
      }
      try {
        await (window.ethereum as any).request({ method: 'wallet_addEthereumChain', params: [params] })
      } catch (addError: any) {
        setToast(addError?.message || 'Adding the network was rejected.')
      }
    }
  }

  async function bridgeOut() {
    if (!activeWallet) {
      onConnect()
      return
    }
    if (!deployment || walletChainId !== deployment.chainId) {
      if (deployment) {
        setToast(`Switch wallet to ${deployment.network} before creating a bridge message.`)
        await switchTo(deployment)
      } else {
        setToast('Connect the wallet to a supported bridge network first.')
      }
      return
    }
    if (!bridge || !deployment || !targetDeployment) {
      setToast('Bridge contracts are not configured for this network pair.')
      return
    }
    try {
      const amountRawValue = parseUnits(amount, 18)
      if (amountRawValue.lte(0)) throw new Error('Enter an amount greater than zero.')
      if (amountRawValue.gt(parseUnits(balance || '0', 18))) throw new Error('Insufficient cUSD balance.')
      setBusy(true)
      setToast(`Confirm burn and bridge message on ${deployment.network}…`)
      const tx = await bridge.bridgeOut(
        deployment.contracts.bridgeToken,
        targetDeployment.chainId,
        targetDeployment.contracts.bridge,
        activeWallet,
        amountRawValue,
        '0x',
      )
      const receipt = await tx.wait()
      const event = (receipt.events || []).find((item: any) => item.event === 'MessageSent')
      if (!event?.args) throw new Error('MessageSent event was not found.')
      const message: RelayMessage = {
        messageId: event.args.messageId,
        sourceChainId: Number(event.args.sourceChainId),
        targetChainId: Number(event.args.targetChainId),
        sourceBridge: event.args.sourceBridge,
        sourceToken: event.args.sourceToken,
        recipient: event.args.recipient,
        amount: event.args.amount.toString(),
        nonce: event.args.nonce.toString(),
        payload: event.args.payload || '0x',
        createdAt: Date.now(),
      }
      const next = [message, ...readPending().filter((item) => item.messageId !== message.messageId)]
      writePending(next)
      setPending(next)
      selectMessage(message)
      setToast(`Message ${short(message.messageId)} submitted. The automatic relayer will execute it after confirmation.`)
      await refresh()
    } catch (error: any) {
      setToast(error?.reason || error?.data?.message || error?.message || 'Bridge request failed.')
    } finally {
      setBusy(false)
    }
  }

  async function executeMessage() {
    if (!activeWallet) {
      onConnect()
      return
    }
    if (!selected) {
      setToast('Select a pending source-chain message first.')
      return
    }
    if (!isRelayer) {
      setToast('The connected wallet is not the configured bridge admin/relayer.')
      return
    }
    if (!deployment || walletChainId !== selected.targetChainId || !walletOnDeploymentNetwork) {
      const target = protocolDeployment(selected.targetChainId)
      if (target) {
        setToast(`Switch wallet to ${target.network}, then execute the destination message.`)
        await switchTo(target)
      }
      return
    }
    if (!bridge) {
      setToast('Bridge contracts are not configured for the destination network.')
      return
    }
    try {
      setBusy(true)
      setToast(`Confirm destination mint on ${deployment?.network || 'target chain'}…`)
      const tx = await bridge.executeMessage(
        selected.messageId,
        Number(sourceChain),
        sourceBridge,
        sourceToken,
        recipient,
        rawAmount,
        nonce,
        payload || '0x',
      )
      await tx.wait()
      const next = readPending().filter((item) => item.messageId !== selected.messageId)
      writePending(next)
      setPending(next)
      setSelected(null)
      setToast(`Message ${short(selected.messageId)} executed and destination cUSD minted.`)
      await refresh()
    } catch (error: any) {
      setToast(error?.reason || error?.data?.message || error?.message || 'Message execution failed.')
    } finally {
      setBusy(false)
    }
  }

  const sourceNetwork = deployment?.network || 'SOURCE CHAIN'
  const targetNetwork = targetDeployment?.network || 'TARGET CHAIN'
  const configured = Boolean(deployment && targetDeployment)
  const relayerOnline = Boolean(
    relayerHealth?.ok &&
      relayerHealth.networks.length >= 2 &&
      relayerHealth.networks.every((network) => !network.lastError),
  )
  const relayedCount = relayerHealth?.messages.counts.executed || 0

  return (
    <div className="defi-fade-in protocol-page bridge-page">
      <div className="protocol-hero bridge-hero">
        <div className="protocol-hero-copy">
          <div className="defi-eyebrow">TRUSTED MESSAGE BRIDGE</div>
          <h1>Move a message. Let the chain mint the proof.</h1>
          <p>Custos keeps the bridge intentionally legible: source-chain burn, finalized message, automatic relayer execution, destination-chain mint. Every step has an onchain receipt.</p>
          <div className="protocol-hero-actions"><button type="button" className="defi-primary-button" onClick={() => document.getElementById('bridge-console')?.scrollIntoView({ behavior: 'smooth' })}><ArrowLeftRight size={15} /> Open bridge console</button><div className={`bridge-admin-pill ${relayerOnline ? 'online' : ''}`}><span className="defi-status-dot" />{relayerOnline ? 'AUTO RELAYER ONLINE' : 'AUTO RELAYER OFFLINE'}</div></div>
        </div>
        <div className="bridge-visual"><div className="bridge-visual-chain source"><span className="bridge-visual-dot" /><strong>{sourceNetwork}</strong><small>LOCK / BURN</small></div><div className="bridge-visual-line"><span /><span /><span /></div><div className="bridge-visual-chain target"><span className="bridge-visual-dot" /><strong>{targetNetwork}</strong><small>MINT / RELEASE</small></div><div className="bridge-visual-relayer"><Radio size={14} /> RELAYER MESSAGE</div></div>
      </div>

      <div className="bridge-flow-strip"><div className="bridge-flow-step active"><span>01</span><LockKeyhole size={16} /><strong>Source burn</strong><small>user signs</small></div><ArrowRight className="bridge-flow-arrow" size={18} /><div className="bridge-flow-step"><span>02</span><Send size={16} /><strong>Automatic relay</strong><small>service submits</small></div><ArrowRight className="bridge-flow-arrow" size={18} /><div className="bridge-flow-step"><span>03</span><UnlockKeyhole size={16} /><strong>Destination mint</strong><small>contract executes</small></div></div>

      {!configured ? <section className="defi-card protocol-empty-state"><ArrowLeftRight size={23} /><h3>Two configured protocol networks are required.</h3><p>Deploy the local pair first. The deployment script writes both bridge addresses and token pairs into the frontend protocol registry.</p></section> : null}

      <section id="bridge-console" className="bridge-console-grid">
        <div className="defi-card bridge-transfer-card">
          <div className="protocol-form-heading"><div className="protocol-icon"><ArrowLeftRight size={17} /></div><div><div className="defi-eyebrow">USER TRANSFER</div><h3>Bridge cUSD to {targetNetwork}.</h3></div></div>
          <div className="bridge-network-row"><div><span>FROM</span><strong>{sourceNetwork}</strong><small>{short(deployment?.contracts.bridge || '')}</small></div><ArrowRight size={18} /><div><span>TO</span><strong>{targetNetwork}</strong><small>{short(targetDeployment?.contracts.bridge || '')}</small></div></div>
          <label className="bridge-amount-label">Amount <span>Balance {Number(balance).toLocaleString(undefined, { maximumFractionDigits: 4 })} cUSD</span><div className="bridge-amount-input"><input aria-label="Bridge amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /><span>cUSD</span></div></label>
          <div className="bridge-recipient-box"><span>RECIPIENT</span><strong>{activeWallet ? activeWallet : 'Connect wallet to populate recipient'}</strong></div>
          <button type="button" className="defi-primary-button full" disabled={busy || !configured} onClick={() => void bridgeOut()}>{busy ? <Loader2 className="protocol-spin" size={15} /> : <Send size={15} />} Burn and create relay message</button>
          <p className="protocol-inline-note"><ShieldCheck size={13} /> The source token is burned by the bridge contract; no admin can redirect the recipient.</p>
          {!activeWallet ? <button type="button" className="defi-secondary-button full" onClick={onConnect}>Connect wallet</button> : null}
        </div>

        <div className="defi-card bridge-config-card"><div className="protocol-form-heading"><div className="protocol-icon"><Clipboard size={17} /></div><div><div className="defi-eyebrow">ONCHAIN CONFIGURATION</div><h3>Verify the trusted pair.</h3></div></div><div className="bridge-config-list"><div><span>SOURCE BRIDGE</span><strong>{short(deployment?.contracts.bridge || '')}</strong><small>admin + relayer controlled</small></div><div><span>DESTINATION BRIDGE</span><strong>{short(targetDeployment?.contracts.bridge || '')}</strong><small>trusted remote registered</small></div><div><span>SOURCE ASSET</span><strong>{short(deployment?.contracts.bridgeToken || '')}</strong><small>burnable cUSD</small></div><div><span>DESTINATION ASSET</span><strong>{short(targetDeployment?.contracts.bridgeToken || '')}</strong><small>mintable paired cUSD</small></div></div><button type="button" className="defi-secondary-button" onClick={() => void refresh()}><RefreshCw size={14} /> Refresh balance and role</button></div>
      </section>

      <section className="bridge-relayer-section">
        <div className="protocol-section-heading"><div><div className="defi-eyebrow">AUTOMATIC RELAYER SERVICE</div><h2>Messages move between chains automatically.</h2><p>The relayer watches finalized source events, persists each payload, submits the destination transaction and retries interrupted executions. This admin workbench remains available as a manual fallback.</p></div><div className={`protocol-chain-chip ${relayerOnline ? 'success' : ''}`}><span className="defi-status-dot" />{relayerOnline ? `ONLINE · ${relayedCount} EXECUTED` : 'SERVICE OFFLINE'}</div></div>
        <div className="bridge-relayer-grid">
          <div className="defi-card bridge-inbox-card"><div className="bridge-card-heading"><div><span>MANUAL FALLBACK INBOX</span><h3>{pending.length} local message{pending.length === 1 ? '' : 's'}</h3></div><button type="button" className="icon-button" aria-label="Refresh pending messages" onClick={() => { void refresh(); void refreshRelayer() }}><RefreshCw size={15} /></button></div>{pending.length === 0 ? <div className="bridge-inbox-empty"><Radio size={18} /><p>Automatic relay is handled by the service. Messages created in this browser remain available here for manual fallback.</p></div> : <div className="bridge-message-list">{pending.map((message) => <button type="button" key={message.messageId} className={`bridge-message-row ${selected?.messageId === message.messageId ? 'active' : ''}`} onClick={() => selectMessage(message)}><span className="bridge-message-status" /><div><strong>{short(message.messageId)}</strong><small>{message.sourceChainId} → {message.targetChainId} · {formatUnits(message.amount, 18)} cUSD</small></div><ArrowRight size={14} /></button>)}</div>}</div>
          <div className="defi-card bridge-execute-card"><div className="bridge-card-heading"><div><span>DESTINATION EXECUTION</span><h3>Admin message payload</h3></div>{isRelayer ? <span className="protocol-state live"><Check size={12} /> AUTHORIZED</span> : null}</div><div className="bridge-relay-form"><label>Message ID<input value={selected?.messageId || ''} onChange={(event) => setSelected((value) => value ? { ...value, messageId: event.target.value } : { messageId: event.target.value, sourceChainId: Number(sourceChain) || 0, targetChainId, sourceBridge, sourceToken, recipient, amount: rawAmount, nonce, payload, createdAt: Date.now() })} placeholder="0x message id" /></label><div className="bridge-two-fields"><label>Source chain<input value={sourceChain} onChange={(event) => setSourceChain(event.target.value)} /></label><label>Nonce<input value={nonce} onChange={(event) => setNonce(event.target.value)} placeholder="uint256" /></label></div><div className="bridge-two-fields"><label>Raw amount<input value={rawAmount} onChange={(event) => setRawAmount(event.target.value)} placeholder="uint256" /></label><label>Payload bytes<input value={payload} onChange={(event) => setPayload(event.target.value)} /></label></div><label>Source bridge<input value={sourceBridge} onChange={(event) => setSourceBridge(event.target.value)} placeholder="0x source bridge" /></label><label>Source token<input value={sourceToken} onChange={(event) => setSourceToken(event.target.value)} placeholder="0x source token" /></label><label>Recipient<input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="0x recipient" /></label></div><div className="bridge-execute-actions"><button type="button" className="defi-secondary-button" onClick={() => selected && void navigator.clipboard?.writeText(JSON.stringify(selected))}><Copy size={14} /> Copy payload</button><button type="button" className="defi-primary-button" disabled={busy || !selected} onClick={() => void executeMessage()}>{busy ? <Loader2 className="protocol-spin" size={15} /> : <UnlockKeyhole size={15} />} {activeChainId === selected?.targetChainId ? 'Execute destination mint' : 'Switch and execute'}</button></div></div>
        </div>
      </section>

      <section className="defi-card bridge-network-table"><div className="bridge-card-heading"><div><span>PROTOCOL REGISTRY</span><h3>Configured chain endpoints</h3></div><ExternalLink size={15} /></div><div className="bridge-network-list">{configuredNetworks.map((item) => <div key={item.chainId}><div className="bridge-network-name"><span className="defi-status-dot" /><strong>{item.network}</strong><small>{item.chainId}</small></div><span>{short(item.contracts.bridge)}</span><button type="button" className="icon-button" aria-label={`Switch to ${item.network}`} onClick={() => void switchTo(item)}><ArrowRight size={14} /></button></div>)}</div></section>

      <div className="protocol-disclaimer"><ShieldCheck size={15} /><span>Bridge assets are testnet representations. The current automatic relayer is centralized for this phase; production would require threshold signing, fraud proofs or a finalized messaging protocol.</span><button type="button" aria-label="Copy bridge address" onClick={() => deployment && void navigator.clipboard?.writeText(deployment.contracts.bridge)}><Copy size={13} /></button></div>
    </div>
  )
}
