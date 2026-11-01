import {POINTS_ENABLED,SYNTHETIC_MARKETS_ENABLED} from './features'
import React, { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Redirect, Route, Switch, useHistory, useLocation } from 'react-router-dom'
import {
  Activity,
  ArrowLeftRight,
  ArrowUpRight,
  Droplets,
  FileCheck2,
  Landmark,
  LayoutDashboard,
  Menu as MenuIcon,
  Network,
  Rocket,
  Search,
  ShieldCheck,
  TrendingUp,
  Trophy,
  Wallet,
  X,
} from 'lucide-react'

import AddLiquidity from '../pages/AddLiquidity'
import Pool from '../pages/Pool'
import PoolFinder from '../pages/PoolFinder'
import RemoveLiquidity from '../pages/RemoveLiquidity'
import Swap from '../pages/Swap'
import { useActiveWeb3React } from '../hooks'
import { useETHBalances } from '../state/wallet/hooks'
import { useWalletModalToggle } from '../state/application/hooks'
import Menu from '../components/Menu'
import Popups from '../components/Popups'
import Web3Status from '../components/Web3Status'
import I18nSwitch from '../components/I18nSwitch'
import {
  SpotLiquidityPage,
  SpotPortfolioPage,
  SpotTradePage,
  SpotTransparencyPage,
} from './SpotPages'
import PublicBetaPage from './PublicBetaPage'
import CustosPerpTerminal from './CustosPerpTerminal'
import { RwaExchangeConsole } from './RwaExchange'
import CustosBridgePage from './CustosBridgePage'
import CustosLaunchpadPage from './CustosLaunchpadPage'

type WorkspaceTab =
  | 'swap'
  | 'overview'
  | 'markets'
  | 'spot'
  | 'liquidity'
  | 'swapLiquidity'
  | 'portfolio'
  | 'season'
  | 'transparency'
  | 'rwa'
  | 'perpetuals'
  | 'launchpad'
  | 'bridge'
  | 'faucet'

type Quote = {
  price?: number
  fresh?: boolean
  source?: string
  session?: string
}

type Market = {
  symbol: string
  name: string
  unit: string
  quote?: Quote | null
}

type NavItem = {
  id: WorkspaceTab
  label: string
  description: string
  icon: typeof LayoutDashboard
}

const NAV_ITEMS: NavItem[] = ([
  { id: 'swap', label: 'Swap', description: 'Trade tokens', icon: ArrowLeftRight },
  { id: 'swapLiquidity', label: 'Swap Liquidity', description: 'Manage Custos V2 pools', icon: Droplets },
  { id: 'spot', label: 'Spot Trade', description: 'Trade synthetic assets', icon: ArrowLeftRight },
  { id: 'liquidity', label: 'Spot Liquidity', description: 'Manage synthetic pools', icon: Droplets },
  { id: 'markets', label: 'Real Markets', description: 'Pyth reference markets', icon: Search },
  { id: 'perpetuals', label: 'Perpetuals', description: 'Leveraged testnet markets', icon: TrendingUp },
  { id: 'launchpad', label: 'Launchpad', description: 'Launch tokens onchain', icon: Rocket },
  { id: 'bridge', label: 'Bridge', description: 'Relay messages cross-chain', icon: Network },
  { id: 'faucet', label: 'Faucet', description: 'Gas-sponsored test ETH', icon: Droplets },
  { id: 'portfolio', label: 'Portfolio', description: 'Wallet, positions and activity', icon: Wallet },
  { id: 'season', label: 'Season 1', description: 'Verified participation', icon: Trophy },
  { id: 'transparency', label: 'Transparency', description: 'Contracts and proof data', icon: ShieldCheck },
  { id: 'rwa', label: 'RWA Exchange', description: 'Proof, assets and RWA pools', icon: Landmark },
] as NavItem[]).filter(item=>(POINTS_ENABLED||item.id!=='season')&&(SYNTHETIC_MARKETS_ENABLED||['swap','swapLiquidity','launchpad','bridge','faucet'].includes(item.id)))

const MARKET_FALLBACKS: Record<string, { name: string; unit: string; image: string; accent: string }> = {
  XAU: { name: 'Gold', unit: 'USD / oz', image: '/assets/markets/gold.png', accent: 'PRECIOUS METAL' },
  XAG: { name: 'Silver', unit: 'USD / oz', image: '/assets/markets/silver.png', accent: 'PRECIOUS METAL' },
  OIL: { name: 'WTI Crude Oil', unit: 'USD / barrel', image: '/assets/markets/oil.png', accent: 'ENERGY' },
}

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:8000')

function formatPrice(price?: number) {
  if (!price || !Number.isFinite(price)) return '—'
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: price < 10 ? 4 : 2,
    minimumFractionDigits: price < 10 ? 2 : 2,
  }).format(price)
}

function tabFromLocation(pathname: string, search: string): WorkspaceTab {
  const queryTab = new URLSearchParams(search).get('tab') as WorkspaceTab | null
  if (pathname === '/defi' || pathname === '/defi/overview') {
    if (queryTab === 'overview' || !queryTab) return 'swap'
    return NAV_ITEMS.some((item) => item.id === queryTab) ? queryTab : 'swap'
  }

  const segment = pathname.split('/')[2] as WorkspaceTab | undefined
  if (segment === 'overview') return 'swap'
  return NAV_ITEMS.some((item) => item.id === segment) ? segment || 'swap' : 'swap'
}

function pathForTab(tab: WorkspaceTab) {
  if (tab === 'swap' || tab === 'overview') return '/defi'
  if (tab === 'swapLiquidity') return '/defi/liquidity/v2'
  return `/defi/${tab}`
}

function LogoMark({ size = 42 }: { size?: number }) {
  return (
    <svg
      className="defi-logo-mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Custos Finance"
    >
      <g fill="none" stroke="currentColor" strokeWidth="5">
        <path d="M49 19.5A21 21 0 1 0 49 44.5" />
        <path d="M41.3 25.1a11.5 11.5 0 1 0 0 13.8" />
      </g>
      <path d="M34 32h16.4" stroke="#35b978" strokeWidth="5" />
    </svg>
  )
}

function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="defi-section-heading">
      <div>
        <div className="defi-eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action ? <div className="defi-heading-action">{action}</div> : null}
    </div>
  )
}

function PageCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`defi-card ${className}`}>{children}</section>
}

function MarketsPage({ go }: { go: (tab: WorkspaceTab) => void }) {
  const [markets, setMarkets] = useState<Market[]>([])
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState('')

  async function refresh() {
    setLoading(true)
    setApiError('')
    try {
      const response = await fetch(`${API_BASE}/api/real-markets`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`Market API returned ${response.status}`)
      const body = await response.json()
      setMarkets(Array.isArray(body.markets) ? body.markets : [])
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Market data is temporarily unavailable.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  const marketRows = ['XAU', 'XAG', 'OIL'].map((symbol) => {
    const configured = markets.find((market) => market.symbol === symbol)
    const fallback = MARKET_FALLBACKS[symbol]
    return {
      symbol,
      name: configured?.name || fallback.name,
      unit: configured?.unit || fallback.unit,
      image: fallback.image,
      accent: fallback.accent,
      quote: configured?.quote,
    }
  })

  return (
    <div className="defi-fade-in">
      <SectionHeading
        eyebrow="REAL-WORLD MARKETS"
        title="Reference prices from the underlying world."
        description="Gold, Silver and WTI market context is sourced from Pyth. Open Spot Trade to interact with the synthetic testnet instruments."
        action={(
          <button type="button" className="defi-secondary-button" onClick={() => void refresh()}>
            <Activity size={15} /> {loading ? 'Refreshing…' : 'Refresh data'}
          </button>
        )}
      />

      <div className="defi-market-status">
        <span className={apiError ? 'defi-status-dot warning' : 'defi-status-dot'} />
        {apiError ? 'PYTH CORE CONNECTING' : loading ? 'LOADING PYTH CORE' : 'PYTH CORE LIVE'}
        {apiError ? <span className="defi-status-detail">{apiError}</span> : <span className="defi-status-detail">Latest quote feed · 15s refresh</span>}
      </div>

      <div className="defi-market-grid">
        {marketRows.map((market) => (
          <article key={market.symbol} className="defi-market-card">
            <div className="defi-market-image">
              <img src={market.image} alt={market.name} />
              <div className="defi-market-image-overlay" />
              <div className="defi-market-image-copy">
                <span>{market.symbol} · {market.accent}</span>
                <h2>{market.name}</h2>
              </div>
            </div>
            <div className="defi-market-card-body">
              <div className="defi-market-price-row">
                <div><span>{market.symbol} / USD</span><strong>${formatPrice(market.quote?.price)}</strong></div>
                <span className={`defi-live-pill ${market.quote?.fresh ? '' : 'muted'}`}>{market.quote?.fresh ? 'LIVE' : 'REFERENCE'}</span>
              </div>
              <p>{market.quote?.source || 'Pyth Core'} · {market.unit}</p>
              <button type="button" className="defi-primary-button full" onClick={() => go('spot')}>
                Trade this reference <ArrowUpRight size={15} />
              </button>
            </div>
          </article>
        ))}
      </div>

      <PageCard className="defi-market-note">
        <FileCheck2 size={19} />
        <p><strong>Data and risk note:</strong> prices are real-world references; Custos synthetic tokens and all GIWA execution are testnet instruments. Nothing here represents custody, redemption or legal ownership of an underlying asset.</p>
      </PageCard>
    </div>
  )
}

function WorkspaceContent({
  tab,
  account,
  onConnect,
  setToast,
  go,
}: {
  tab: WorkspaceTab
  account: string | null | undefined
  onConnect: () => void
  setToast: (value: string) => void
  go: (next: WorkspaceTab) => void
}) {
  if (tab === 'swap' || tab === 'overview') {
    return (
      <div className="defi-core-page">
        <Swap />
      </div>
    )
  }
  if (tab === 'markets') return <MarketsPage go={go} />
  if (tab === 'spot') {
    return (
      <div className="defi-fade-in">
        <SectionHeading
          eyebrow="SPOT TRADE"
          title="Trade synthetic real-market references."
          description="The RWA Spot module uses the shared tUSDC test asset and Pyth reference prices. Custos V2 routing remains available as the core token swap surface."
          action={(
            <button type="button" className="defi-secondary-button" onClick={() => window.location.hash = '/defi/spot/v2'}>
              Open V2 token swap <ArrowLeftRight size={15} />
            </button>
          )}
        />
        <SpotTradePage wallet={account || ''} onConnect={onConnect} setToast={setToast} />
      </div>
    )
  }
  if (tab === 'liquidity') {
    return (
      <div className="defi-fade-in">
        <SectionHeading
          eyebrow="SPOT LIQUIDITY"
          title="Provide liquidity across the market layers."
          description="Use the real-price synthetic pools for tUSDC LP inventory, or open the Custos V2 pool manager for classic pair liquidity, add and remove flows."
          action={(
            <button type="button" className="defi-secondary-button" onClick={() => window.location.hash = '/defi/liquidity/v2'}>
              Open Swap V2 pools <Droplets size={15} />
            </button>
          )}
        />
        <SpotLiquidityPage wallet={account || ''} onConnect={onConnect} setToast={setToast} />
      </div>
    )
  }
  if (tab === 'swapLiquidity') {
    return (
      <div className="defi-core-page">
        <Pool />
      </div>
    )
  }
  if (tab === 'portfolio') return <SpotPortfolioPage wallet={account || ''} onConnect={onConnect} setToast={setToast} />
  if (tab === 'season') return <PublicBetaPage wallet={account || ''} onConnect={onConnect} setToast={setToast} />
  if (tab === 'faucet') return <Redirect to="/reality/faucet" />
  if (tab === 'transparency') return <SpotTransparencyPage />
  if (tab === 'rwa') return <RwaExchangeConsole />
  if (tab === 'launchpad') return <CustosLaunchpadPage wallet={account || ''} onConnect={onConnect} setToast={setToast} />
  if (tab === 'bridge') return <CustosBridgePage wallet={account || ''} onConnect={onConnect} setToast={setToast} />
  return (
    <div className="defi-fade-in">
      <SectionHeading
        eyebrow="PERPETUALS"
        title="Perpetual markets, inside the same workspace."
        description="Open, monitor and close leveraged GIWA testnet positions with live Pyth market context and shared collateral."
      />
      <CustosPerpTerminal externalWallet={account || ''} />
    </div>
  )
}

export default function DefiShell() {
  const history = useHistory()
  const location = useLocation()
  const { account, chainId } = useActiveWeb3React()
  const toggleWalletModal = useWalletModalToggle()
  const ethBalance = useETHBalances(account ? [account] : [])?.[account || '']
  const [navOpen, setNavOpen] = useState(false)
  const [toast, setToast] = useState('')
  const tab = tabFromLocation(location.pathname, location.search)
  const numericChainId = Number(chainId || 0)

  const networkLabel = useMemo(() => {
    if (numericChainId === 99801) return 'ELYSIUM TESTNET'
    if (numericChainId === 47805) return 'LOCAL TESTNET'
    if (numericChainId === 91342) return 'GIWA SEPOLIA'
    if (numericChainId) return `CHAIN ${numericChainId}`
    return 'NETWORK NOT CONNECTED'
  }, [numericChainId])

  const go = (next: WorkspaceTab) => {
    setNavOpen(false)
    history.push(next==='launchpad'?'/reality':pathForTab(next))
  }

  const routePath = location.pathname
  const legacyV2 = routePath === '/defi/spot/v2' || routePath === '/defi/liquidity/v2'
  const activeTab: WorkspaceTab = legacyV2
    ? (routePath === '/defi/liquidity/v2' ? 'swapLiquidity' : 'swap')
    : tab
  if(!SYNTHETIC_MARKETS_ENABLED&&['bridge','launchpad','faucet'].includes(tab))return <Redirect to={tab==='bridge'?'/reality/swap':tab==='faucet'?'/reality/faucet':'/reality'}/>

  return (
    <div className="defi-app">
      <Popups />
      <div className="defi-grid-overlay" />
      <main className="defi-main">
        <header className="defi-topbar">
          <div className="defi-topbar-left">
            <button type="button" className="defi-brand" onClick={() => go('swap')}>
              <LogoMark size={58} />
              <span><strong>Custos Finance</strong><small>LAUNCH · SWAP · STAKE</small></span>
            </button>
          </div>
          <nav className="defi-top-nav" aria-label="Custos DeFi navigation">
            {NAV_ITEMS.map(({ id, label }) => (
              <button
                type="button"
                key={id}
                className={`defi-top-nav-item ${activeTab === id ? 'active' : ''}`}
                onClick={() => go(id)}
                aria-current={activeTab === id ? 'page' : undefined}
              >
                {label}
              </button>
            ))}
            <a className="defi-top-nav-item" href="#/reality/nft" target="_blank" rel="noopener noreferrer">NFT Mint ↗</a>
          </nav>
          <div className="defi-topbar-right">
            <div className="defi-top-network"><span className="defi-status-dot" />{networkLabel}</div>
            {account && ethBalance ? <span className="defi-eth-balance">{ethBalance.toSignificant(4)} {numericChainId===99801?'HYPE':'ETH'}</span> : null}
            <div className="defi-wallet-button"><Web3Status /></div>
            <Menu />
            <I18nSwitch />
            <button
              type="button"
              className="defi-mobile-menu"
              onClick={() => setNavOpen((open) => !open)}
              aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={navOpen}
            >
              {navOpen ? <X size={19} /> : <MenuIcon size={19} />}
            </button>
          </div>
          {navOpen ? (
            <nav className="defi-mobile-nav" aria-label="Custos DeFi mobile navigation">
              {NAV_ITEMS.map(({ id, label, description }) => (
                <button
                  type="button"
                  key={id}
                  className={`defi-mobile-nav-item ${activeTab === id ? 'active' : ''}`}
                  onClick={() => go(id)}
                >
                  <span>{label}</span>
                  <small>{description}</small>
                  {activeTab === id ? <ArrowUpRight size={15} /> : null}
                </button>
              ))}
            </nav>
          ) : null}
        </header>

        <div className="defi-content">
          {legacyV2 ? (
            <div className="defi-core-page">
              <Switch>
                <Route exact path="/defi/spot/v2" render={() => <Swap />} />
                <Route exact path="/defi/liquidity/v2" render={() => <Pool />} />
              </Switch>
            </div>
          ) : (
            <Switch>
              <Route exact path="/swap" render={() => <Redirect to="/defi" />} />
              <Route exact path="/swap/:outputCurrency" render={() => <Redirect to="/defi" />} />
              <Route exact path="/send" render={() => <Redirect to="/defi" />} />
              <Route exact path="/create" render={() => <Redirect to="/defi/liquidity/v2" />} />
              <Route exact path="/remove/:tokens" render={() => <Redirect to="/defi/liquidity/v2" />} />
              <Route exact path="/perp" render={() => <Redirect to="/defi/perpetuals" />} />
              <Route exact path="/pool" render={() => <Redirect to="/defi/liquidity/v2" />} />
              <Route exact path="/find" render={() => <div className="defi-core-page"><PoolFinder /></div>} />
              <Route exact path="/add" component={AddLiquidity} />
              <Route exact path="/add/:currencyIdA" component={AddLiquidity} />
              <Route exact path="/add/:currencyIdA/:currencyIdB" component={AddLiquidity} />
              <Route exact path="/remove/:currencyIdA/:currencyIdB" component={RemoveLiquidity} />
              <Route path="/defi" render={() => <WorkspaceContent tab={tab} account={account} onConnect={toggleWalletModal} setToast={setToast} go={go} />} />
              <Redirect to="/defi" />
            </Switch>
          )}
        </div>
      </main>

      {toast ? <div className="defi-toast" role="status" onClick={() => setToast('')}>{toast}<X size={14} /></div> : null}
    </div>
  )
}
