import React, { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import PublicBetaPage from './PublicBetaPage';
import {
  SpotPortfolioPage,
} from './SpotPages';
import {
  BrowserProvider,
  Contract,
  formatUnits,
  parseUnits,
} from 'ethers-v6';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUpRight,
  CircleDollarSign,
  Droplets,
  ExternalLink,
  FileText,
  Landmark,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  Menu,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
  Trophy,
  Wallet,
  X,
} from 'lucide-react';
import { ERC20_ABI, POOL_ABI } from './contracts';
import {
  CUSTOS_API_BASE,
  MARKET_NETWORK,
  WALLET_NETWORK,
  ensureMarketNetwork,
} from './marketNetwork';

const API_BASE = CUSTOS_API_BASE;
const CHAIN_ID = MARKET_NETWORK.chainId;
const PLAYGROUND_URL = 'https://sepolia-playground.giwa.io/';
const GIWA_NETWORK = WALLET_NETWORK;
const NETWORK_NAME = MARKET_NETWORK.name;

type Tab = 'overview' | 'markets' | 'trade' | 'liquidity' | 'portfolio' | 'season' | 'proof' | 'perp';
type TradeSide = 'buy' | 'sell';

type ChainMarket = {
  name: string;
  symbol: string;
  maturity: string;
  risk: number;
  supply: string;
  assetLiquidity: string;
  quoteLiquidity: string;
  assetId: string;
  tokenAddress: string;
  poolAddress: string;
  documentHash: string;
  metadataURI: string;
};

type SettlementToken = {
  name?: string;
  symbol?: string;
  address?: string;
  decimals?: number;
  official?: boolean;
  faucetAddress?: string;
  claimUrl?: string;
  claimFlow?: string;
  disclaimer?: string;
};

type ChainConfig = {
  network?: { name?: string; chainId?: number };
  contracts?: { verifiedToken?: string; verifiedTokenFaucet?: string; registry?: string; assetFactory?: string; poolFactory?: string };
  settlementToken?: SettlementToken;
  markets?: ChainMarket[];
  demoMode?: boolean;
  warning?: string;
};

type Reserves = { asset: bigint; quote: bigint };
type AssetMeta = { image: string; category: string; issuer: string; description: string };

const META: Record<string, AssetMeta> = {
  rKINV26: {
    image: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=1600&q=88',
    category: 'Trade invoice',
    issuer: 'Busan Supply Co.',
    description: 'A test market with a visible proof record and AMM liquidity.',
  },
  rSOLAR27: {
    image: 'https://images.unsplash.com/photo-1509391366360-2e959784a276?auto=format&fit=crop&w=1600&q=88',
    category: 'Equipment lease',
    issuer: 'Green Grid Lab',
    description: 'A test-only equipment-lease market for exercising onchain swaps and LP positions.',
  },
  rCOFFEE26: {
    image: 'https://images.unsplash.com/photo-1447933601403-0c6688de566e?auto=format&fit=crop&w=1600&q=88',
    category: 'Supply-chain receivable',
    issuer: 'Origin Trade Desk',
    description: 'A short-duration test market that demonstrates visible proof metadata and tokenized liquidity.',
  },
};

const DEFAULT_META: AssetMeta = {
  image: 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1600&q=88',
  category: 'Verified RWA',
  issuer: 'GIWA Test Issuer',
  description: 'A test RWA market. It has no legal claim, redemption right, or cash value.',
};

const NAV: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'markets', label: 'Real Markets', icon: Search },
  { id: 'trade', label: 'Spot Trade', icon: ArrowLeftRight },
  { id: 'liquidity', label: 'Liquidity', icon: Droplets },
  { id: 'portfolio', label: 'Portfolio', icon: Wallet },
  { id: 'season', label: 'Season 1', icon: Trophy },
  { id: 'proof', label: 'Transparency', icon: ShieldCheck },
  { id: 'perp', label: 'Perpetuals', icon: TrendingUp },
];


type RealAssetSymbol = 'XAU' | 'XAG' | 'OIL';

type RealAsset = {
  symbol: RealAssetSymbol;
  name: string;
  marketLabel: string;
  assetClass: string;
  unit: string;
  image: string;
  description: string;
};

type RealQuote = {
  symbol: RealAssetSymbol;
  price: number;
  session: string;
  fresh: boolean;
  source: string;
  updatedAtUs: number;
};

type HistoryCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
};

type RealResolution = '1m' | '5m' | '30m' | '2h' | '6h' | '1d';

const REAL_ASSETS: RealAsset[] = [
  {
    symbol: 'XAU',
    name: 'Gold',
    marketLabel: 'XAU / USD',
    assetClass: 'Precious metal',
    unit: 'USD / oz',
    image: '/assets/gold-market.svg',
    description:
      'Global gold reference price sourced from the Pyth Metal.XAU/USD market feed.',
  },
  {
    symbol: 'XAG',
    name: 'Silver',
    marketLabel: 'XAG / USD',
    assetClass: 'Precious metal',
    unit: 'USD / oz',
    image: '/assets/silver-market.svg',
    description:
      'Global silver reference price sourced from the Pyth Metal.XAG/USD market feed.',
  },
  {
    symbol: 'OIL',
    name: 'WTI Crude Oil',
    marketLabel: 'WTI / USD',
    assetClass: 'Energy',
    unit: 'USD / barrel',
    image: '/assets/oil-market.svg',
    description:
      'WTI crude-oil reference price using the current Pyth WTI futures reference feed.',
  },
];

const REAL_ASSET_BY_SYMBOL = Object.fromEntries(
  REAL_ASSETS.map((asset) => [asset.symbol, asset]),
) as Record<RealAssetSymbol, RealAsset>;

function useRealMarketData() {
  const [quotes, setQuotes] = useState<
    Partial<Record<RealAssetSymbol, RealQuote>>
  >({});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let disposed = false;

    async function load() {
      try {
        const response = await fetch(
          `${API_BASE}/api/real-markets`,
          { cache: 'no-store' },
        );

        if (!response.ok) {
          throw new Error(`Real market API ${response.status}`);
        }

        const body = await response.json();
        if (disposed) return;

        const next: Partial<Record<RealAssetSymbol, RealQuote>> = {};

        for (const row of body.markets || []) {
          const symbol = String(row.symbol || '').toUpperCase() as RealAssetSymbol;

          if (!REAL_ASSET_BY_SYMBOL[symbol] || !row.quote) continue;

          const price = Number(row.quote.price);
          if (!Number.isFinite(price) || price <= 0) continue;

          next[symbol] = {
            symbol,
            price,
            session: String(row.quote.session || 'unknown'),
            fresh: Boolean(row.quote.fresh),
            source: String(row.quote.source || 'Pyth'),
            updatedAtUs: Number(
              row.quote.feedUpdateTimestampUs ||
                Date.now() * 1000,
            ),
          };
        }

        setQuotes(next);
        setConnected(
          Object.values(next).some((quote) => quote?.fresh),
        );
      } catch (error) {
        if (!disposed) {
          console.warn('[Custos real markets]', error);
          setConnected(false);
        }
      }
    }

    void load();
    const timer = window.setInterval(load, 2_000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  return { quotes, connected };
}

function realPrice(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return '—';

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value >= 1000 ? 2 : 2,
    maximumFractionDigits: value < 10 ? 4 : 2,
  }).format(value);
}

function sessionLabel(quote?: RealQuote) {
  if (!quote) return 'CONNECTING';

  const session = quote.session.toLowerCase();

  if (session === 'closed') return 'MARKET CLOSED';
  if (session.includes('pre')) return 'PRE-MARKET';
  if (session.includes('post')) return 'AFTER HOURS';
  return quote.fresh ? 'LIVE' : 'REFERENCE';
}

function short(value = '') {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function trim(value: string | number, places = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: places }).format(number);
}

function ratio(value: bigint, decimals: number) {
  return Number(formatUnits(value, decimals));
}

function explorer(address: string) {
  return MARKET_NETWORK.explorer
    ? `${MARKET_NETWORK.explorer}/address/${address}`
    : '#';
}

function GiwaMark({ size = 44 }: { size?: number }) {
  return (
    <div
      className="grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
      aria-label="Custos Finance"
    >
      <img
        src="/assets/custos-logo.png"
        alt="Custos Finance"
        className="h-full w-full object-contain drop-shadow-[0_0_16px_rgba(70,220,145,.18)]"
      />
    </div>
  );
}

function Spinner() {
  return <Loader2 size={16} className="animate-spin" />;
}

function StatusPill({ label, good = true }: { label: string; good?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[.12em] ${good ? 'border-emerald-300/22 bg-emerald-300/[.08] text-emerald-100' : 'border-amber-300/22 bg-amber-300/[.08] text-amber-100'}`}>
      <span className={`size-1.5 rounded-full ${good ? 'bg-emerald-300 shadow-[0_0_10px_rgba(134,255,165,.95)]' : 'bg-amber-300'}`} />
      {label}
    </span>
  );
}

function TerminalApp() {
  const initial = (new URLSearchParams(window.location.hash.split('?')[1] || window.location.search.slice(1)).get('tab') as Tab) || 'overview';
  const [tab, setTab] = useState<Tab>(NAV.some((item) => item.id === initial) ? initial : 'overview');
  const [config, setConfig] = useState<ChainConfig | null>(null);
  const [apiStatus, setApiStatus] = useState<'connecting' | 'retrying' | 'ready' | 'offline'>('connecting');
  const [apiAttempt, setApiAttempt] = useState(0);
  const [wallet, setWallet] = useState('');
  const [verifiedTokenBalance, setVerifiedTokenBalance] = useState('0');
  const [assetBalances, setAssetBalances] = useState<Record<string, string>>({});
  const [lpBalances, setLpBalances] = useState<Record<string, string>>({});
  const [reserves, setReserves] = useState<Record<string, Reserves>>({});
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [side, setSide] = useState<TradeSide>('buy');
  const [tradeInput, setTradeInput] = useState('10');
  const [tradeOut, setTradeOut] = useState('0');
  const [slippage, setSlippage] = useState('0.50');
  const [liquidityInput, setLiquidityInput] = useState('10');
  const [removeInput, setRemoveInput] = useState('0');
  const [toast, setToast] = useState(`Connect a wallet to use real-price Spot, tUSDC liquidity and Perpetuals on ${NETWORK_NAME}.`);
  const [busy, setBusy] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const markets = config?.markets || [];
  const contracts = config?.contracts || {};
  const settlement = config?.settlementToken || {};
  const quoteSymbol = settlement.symbol || 'VerifiedToken';
  const quoteDecimals = Number(settlement.decimals ?? 18);
  const isOnchain = Boolean(!config?.demoMode && contracts.verifiedToken && contracts.registry && contracts.poolFactory && markets.length);
  const selected = markets.find((market) => market.symbol === selectedSymbol) || markets[0];
  const selectedMeta = selected ? META[selected.symbol] || DEFAULT_META : DEFAULT_META;
  const selectedReserve = selected ? reserves[selected.symbol] : undefined;
  const selectedAssetBalance = selected ? assetBalances[selected.symbol] || '0' : '0';
  const selectedLpBalance = selected ? lpBalances[selected.symbol] || '0' : '0';

  const changeTab = (next: Tab) => {
    setTab(next);
    setSidebarOpen(false);
  };

  const getProvider = () => {
    if (!window.ethereum) throw new Error('No wallet detected. Install MetaMask or another EVM wallet.');
    return new BrowserProvider(window.ethereum as never);
  };

  const getSigner = async () => {
    if (window.ethereum) await ensureMarketNetwork(window.ethereum);
    const provider = getProvider();
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== CHAIN_ID) throw new Error(`Switch your wallet to ${NETWORK_NAME} first.`);
    return provider.getSigner();
  };

  const addNetwork = async () => {
    try {
      if (!window.ethereum) throw new Error('No wallet detected.');
      await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [GIWA_NETWORK] });
      setToast(`${NETWORK_NAME} was added to your wallet.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : `Unable to add ${NETWORK_NAME}.`);
    }
  };

  const connect = async () => {
    try {
      if (!window.ethereum) throw new Error('No wallet detected. Install MetaMask or another EVM wallet.');
      await ensureMarketNetwork(window.ethereum);
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[];
      const address = accounts?.[0] || '';
      setWallet(address);
      setToast(`Wallet connected: ${short(address)}.`);
      await refreshOnchain(address);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Wallet connection did not complete.');
    }
  };

  const refreshConfig = async () => {
    const maxAttempts = 8;
    const wait = (milliseconds: number) =>
      new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

    setApiStatus('connecting');
    setApiAttempt(0);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      setApiAttempt(attempt);
      setApiStatus(attempt === 1 ? 'connecting' : 'retrying');

      try {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 15000);

        const response = await fetch(`${API_BASE}/api/config`, {
          cache: 'no-store',
          signal: controller.signal,
        });

        window.clearTimeout(timer);

        if (!response.ok) {
          throw new Error(`Configuration endpoint returned ${response.status}.`);
        }

        const next = await response.json() as ChainConfig;

        setConfig(next);
        setApiStatus('ready');

        const first = next.markets?.[0]?.symbol || '';
        setSelectedSymbol((current) => current || first);

        if (next.demoMode) {
          setToast('Contracts are not configured. Deploy the exchange contracts and refresh this page.');
        } else {
          setToast(`${NETWORK_NAME} configuration loaded. Spot, RWA and Perpetuals share the ${next.settlementToken?.symbol || 'test'} quote asset.`);
        }

        return;
      } catch {
        if (attempt < maxAttempts) {
          const delaySeconds = Math.min(3 + attempt, 9);
          setToast(`Waking up GIWA API… retrying ${attempt}/${maxAttempts} in ${delaySeconds}s.`);
          await wait(delaySeconds * 1000);
        }
      }
    }

    setApiStatus('offline');
    setToast('GIWA API is still starting. Keep this page open or use Retry now.');
  };

  const refreshOnchain = async (address = wallet) => {
    if (!address || !isOnchain || !contracts.verifiedToken) return;
    try {
      const provider = getProvider();
      const quote = new Contract(contracts.verifiedToken, ERC20_ABI, provider);
      const quoteRaw = await quote.balanceOf(address) as bigint;
      const nextAssets: Record<string, string> = {};
      const nextLPs: Record<string, string> = {};
      const nextReserves: Record<string, Reserves> = {};
      await Promise.all(markets.map(async (market) => {
        const [assetRaw, lpRaw, poolReserves] = await Promise.all([
          new Contract(market.tokenAddress, ERC20_ABI, provider).balanceOf(address) as Promise<bigint>,
          new Contract(market.poolAddress, POOL_ABI, provider).balanceOf(address) as Promise<bigint>,
          new Contract(market.poolAddress, POOL_ABI, provider).getReserves() as Promise<[bigint, bigint]>,
        ]);
        nextAssets[market.symbol] = formatUnits(assetRaw, 18);
        nextLPs[market.symbol] = formatUnits(lpRaw, 18);
        nextReserves[market.symbol] = { asset: poolReserves[0], quote: poolReserves[1] };
      }));
      setVerifiedTokenBalance(formatUnits(quoteRaw, quoteDecimals));
      setAssetBalances(nextAssets);
      setLpBalances(nextLPs);
      setReserves(nextReserves);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not refresh wallet balances.');
    }
  };

  useEffect(() => { void refreshConfig(); }, []);

  useEffect(() => {
    if (!window.ethereum) return undefined;
    const accountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? args[0] as string[] : [];
      const account = accounts[0] || '';
      setWallet(account);
      if (account) void refreshOnchain(account);
    };
    const chainChanged = () => { if (wallet) void refreshOnchain(wallet); };
    window.ethereum.on?.('accountsChanged', accountsChanged);
    window.ethereum.on?.('chainChanged', chainChanged);
    return () => {
      window.ethereum?.removeListener?.('accountsChanged', accountsChanged);
      window.ethereum?.removeListener?.('chainChanged', chainChanged);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, isOnchain, contracts.verifiedToken, markets.length]);

  useEffect(() => {
    if (wallet && isOnchain) void refreshOnchain(wallet);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, isOnchain, selectedSymbol, quoteDecimals]);

  useEffect(() => {
    const quoteTrade = async () => {
      if (!selected || !isOnchain || !tradeInput || Number(tradeInput) <= 0 || !contracts.verifiedToken) {
        setTradeOut('0');
        return;
      }
      try {
        const provider = getProvider();
        const amount = parseUnits(tradeInput, side === 'buy' ? quoteDecimals : 18);
        const inputToken = side === 'buy' ? contracts.verifiedToken : selected.tokenAddress;
        const output = await new Contract(selected.poolAddress, POOL_ABI, provider).getAmountOut(inputToken, amount) as bigint;
        setTradeOut(formatUnits(output, side === 'buy' ? 18 : quoteDecimals));
      } catch {
        setTradeOut('0');
      }
    };
    const handle = window.setTimeout(() => { void quoteTrade(); }, 240);
    return () => window.clearTimeout(handle);
  }, [selected, side, tradeInput, isOnchain, contracts.verifiedToken, quoteDecimals]);

  const ensureApproval = async (token: string, spender: string, amount: bigint, signer: Awaited<ReturnType<typeof getSigner>>) => {
    const owner = await signer.getAddress();
    const erc20 = new Contract(token, ERC20_ABI, signer);
    const allowance = await erc20.allowance(owner, spender) as bigint;
    if (allowance < amount) {
      const approval = await erc20.approve(spender, amount);
      setToast('Approval submitted. Waiting for confirmation…');
      await approval.wait();
    }
  };

  const writeActivity = async (action: string, summary: string, txHash: string) => {
    try {
      await fetch(`${API_BASE}/api/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, action, summary, tx_hash: txHash, execution_mode: 'onchain' }),
      });
    } catch {
      // The chain remains the source of truth; the optional activity log may be offline.
    }
  };

  const executeSwap = async () => {
    if (!selected || !isOnchain || !contracts.verifiedToken) {
      setToast('Select a deployed onchain market first.');
      return;
    }
    if (!tradeInput || Number(tradeInput) <= 0) {
      setToast(`Enter a ${side === 'buy' ? quoteSymbol : selected.symbol} amount greater than zero.`);
      return;
    }
    try {
      setBusy('swap');
      const signer = await getSigner();
      const inputToken = side === 'buy' ? contracts.verifiedToken : selected.tokenAddress;
      const inputDecimals = side === 'buy' ? quoteDecimals : 18;
      const amountIn = parseUnits(tradeInput, inputDecimals);
      const pool = new Contract(selected.poolAddress, POOL_ABI, signer);
      const quoted = await pool.getAmountOut(inputToken, amountIn) as bigint;
      const bps = Math.max(1, Math.min(2000, Math.round(Number(slippage || '0.5') * 100)));
      const minimum = quoted * BigInt(10_000 - bps) / 10_000n;
      await ensureApproval(inputToken, selected.poolAddress, amountIn, signer);
      const transaction = await pool.swapExactInput(inputToken, amountIn, minimum, await signer.getAddress());
      setToast('Swap submitted to GIWA Sepolia. Waiting for confirmation…');
      await transaction.wait();
      setToast(`Swap confirmed: ${tradeInput} ${side === 'buy' ? quoteSymbol : selected.symbol} → ${trim(tradeOut, 6)} ${side === 'buy' ? selected.symbol : quoteSymbol}.`);
      await refreshOnchain(await signer.getAddress());
      void writeActivity('swap', `Swapped ${tradeInput} ${side === 'buy' ? quoteSymbol : selected.symbol}.`, transaction.hash);
    } catch (error) {
      setToast(error instanceof Error ? error.message.replace('execution reverted: ', '') : 'Swap failed.');
    } finally {
      setBusy(null);
    }
  };

  const liquidityAssetAmount = useMemo(() => {
    if (!selectedReserve || !liquidityInput || Number(liquidityInput) <= 0 || selectedReserve.quote === 0n) return '0';
    try {
      const quoteAmount = parseUnits(liquidityInput, quoteDecimals);
      const assetAmount = quoteAmount * selectedReserve.asset / selectedReserve.quote;
      return formatUnits(assetAmount, 18);
    } catch {
      return '0';
    }
  }, [selectedReserve, liquidityInput, quoteDecimals]);

  const addLiquidity = async () => {
    if (!selected || !isOnchain || !contracts.verifiedToken || !selectedReserve) {
      setToast('Select a deployed market first.');
      return;
    }
    if (!liquidityInput || Number(liquidityInput) <= 0) {
      setToast(`Enter a ${quoteSymbol} amount.`);
      return;
    }
    try {
      setBusy('add-liquidity');
      const signer = await getSigner();
      const quoteDesired = parseUnits(liquidityInput, quoteDecimals);
      const assetDesired = quoteDesired * selectedReserve.asset / selectedReserve.quote;
      const assetMin = assetDesired * 9950n / 10_000n;
      const quoteMin = quoteDesired * 9950n / 10_000n;
      await ensureApproval(selected.tokenAddress, selected.poolAddress, assetDesired, signer);
      await ensureApproval(contracts.verifiedToken, selected.poolAddress, quoteDesired, signer);
      const pool = new Contract(selected.poolAddress, POOL_ABI, signer);
      const transaction = await pool.addLiquidity(assetDesired, quoteDesired, assetMin, quoteMin, await signer.getAddress());
      setToast('Liquidity transaction submitted. Waiting for confirmation…');
      await transaction.wait();
      setToast(`Liquidity added to ${selected.symbol} / ${quoteSymbol}. LP tokens are now in your wallet.`);
      await refreshOnchain(await signer.getAddress());
      void writeActivity('add_liquidity', `Added ${liquidityInput} ${quoteSymbol} and ${trim(liquidityAssetAmount, 6)} ${selected.symbol}.`, transaction.hash);
    } catch (error) {
      setToast(error instanceof Error ? error.message.replace('execution reverted: ', '') : 'Could not add liquidity.');
    } finally {
      setBusy(null);
    }
  };

  const removeLiquidity = async () => {
    if (!selected || !isOnchain || !selectedReserve) {
      setToast('Select a deployed market first.');
      return;
    }
    if (!removeInput || Number(removeInput) <= 0) {
      setToast('Enter an LP amount.');
      return;
    }
    try {
      setBusy('remove-liquidity');
      const signer = await getSigner();
      const liquidity = parseUnits(removeInput, 18);
      const pool = new Contract(selected.poolAddress, POOL_ABI, signer);
      const lpSupply = await pool.totalSupply() as bigint;
      if (lpSupply === 0n) throw new Error('Pool has no LP supply.');
      const assetMin = liquidity * selectedReserve.asset / lpSupply * 9950n / 10_000n;
      const quoteMin = liquidity * selectedReserve.quote / lpSupply * 9950n / 10_000n;
      const transaction = await pool.removeLiquidity(liquidity, assetMin, quoteMin, await signer.getAddress());
      setToast('Remove-liquidity transaction submitted. Waiting for confirmation…');
      await transaction.wait();
      setToast(`LP position reduced by ${trim(removeInput, 6)} LP tokens.`);
      await refreshOnchain(await signer.getAddress());
      void writeActivity('remove_liquidity', `Removed ${trim(removeInput, 6)} LP tokens.`, transaction.hash);
    } catch (error) {
      setToast(error instanceof Error ? error.message.replace('execution reverted: ', '') : 'Could not remove liquidity.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="giwa-shell relative min-h-screen overflow-x-hidden text-white">
      <div className="pointer-events-none fixed inset-0 soft-grid opacity-[.14] [mask-image:linear-gradient(to_bottom,black,transparent_68%)]" />
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[254px] flex-col border-r border-white/[.09] bg-[#030c15]/95 px-4 py-6 backdrop-blur-2xl transition-transform duration-300 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <button onClick={() => changeTab('overview')} className="flex items-center gap-3 px-2 text-left">
          <GiwaMark size={43} />
          <div><p className="text-[17px] font-semibold tracking-[-.04em]">CUSTOS FINANCE</p><p className="mt-0.5 text-[10px] font-medium tracking-[.12em] text-emerald-100/58">RWA + PERPETUALS ON GIWA</p></div>
        </button>
        <div className="mt-8 rounded-xl border border-emerald-200/[.14] bg-emerald-300/[.055] px-3 py-2.5 text-[11px] text-emerald-100/80">
          <span className="mr-2 inline-block size-1.5 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(134,255,165,.95)]" />
          {config === null ? 'CONNECTING TO GIWA API' : isOnchain ? 'GIWA ONCHAIN MODE' : 'CONTRACTS NOT DEPLOYED'}
        </div>
        <nav className="mt-7 space-y-1.5">
          {NAV.map((item) => {
            const Icon = item.icon;

            if (item.id === 'perp') {
              return (
                <a
                  key={item.id}
                  href="/#/perp"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-3 text-left text-[14px] text-white/62 transition hover:border-emerald-200/20 hover:bg-[linear-gradient(90deg,rgba(150,255,181,.11),rgba(150,255,181,.025))] hover:text-white"
                >
                  <Icon
                    size={17}
                    strokeWidth={1.55}
                    className="text-white/54"
                  />
                  <span>{item.label}</span>
                  <ArrowUpRight
                    size={14}
                    className="ml-auto text-emerald-100/70"
                  />
                </a>
              );
            }

            const active = item.id === tab;

            return (
              <button
                key={item.id}
                onClick={() => changeTab(item.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[14px] transition ${
                  active
                    ? 'border border-emerald-200/20 bg-[linear-gradient(90deg,rgba(150,255,181,.11),rgba(150,255,181,.025))] text-white'
                    : 'border border-transparent text-white/62 hover:bg-white/[.035] hover:text-white'
                }`}
              >
                <Icon
                  size={17}
                  strokeWidth={active ? 1.9 : 1.55}
                  className={active ? 'text-emerald-200' : 'text-white/54'}
                />
                <span>{item.label}</span>
                {active && (
                  <ArrowUpRight
                    size={14}
                    className="ml-auto text-emerald-100/70"
                  />
                )}
              </button>
            );
          })}
        </nav>
        <div className="giwa-panel mt-auto rounded-2xl p-4">
          <p className="text-[11px] font-semibold tracking-[.12em] text-emerald-200">
            REAL MARKET DATA
          </p>
          <p className="mt-2 text-[13px] font-medium leading-snug text-white">
            Gold, silver and WTI crude oil powered by Pyth.
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-white/43">
            Real prices and OHLC candles come from Pyth. Spot and Perpetuals share
            the same tUSDC test token; synthetic assets remain testnet-only.
          </p>
          <a
            className="mt-3 inline-flex items-center gap-1 text-[11px] text-emerald-200"
            href="https://www.pyth.network/price-feeds"
            target="_blank"
            rel="noreferrer"
          >
            Open Pyth Markets <ArrowUpRight size={13} />
          </a>
        </div>
      </aside>

      {sidebarOpen && <button aria-label="Close menu" onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-40 bg-black/55 lg:hidden" />}

      <main className="relative min-h-screen lg:ml-[254px]">
        <header className="sticky top-0 z-30 border-b border-white/[.08] bg-[#06121c]/[.88] px-5 py-4 backdrop-blur-xl md:px-8">
          <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4">
          <div className="flex items-center gap-3"><button onClick={() => setSidebarOpen(true)} className="grid size-10 place-items-center rounded-xl border border-white/[.1] text-white/75 lg:hidden"><Menu size={18} /></button><p className="text-[11px] font-medium tracking-[.14em] text-sky-100/70">{NETWORK_NAME.toUpperCase()} <span className="mx-2 text-emerald-300">•</span> {isOnchain ? 'ONCHAIN READY' : 'DEPLOYMENT REQUIRED'}</p></div>
            <div className="flex items-center gap-2">
              <button onClick={() => { void refreshConfig(); if (wallet) void refreshOnchain(wallet); }} className="secondary-button hidden items-center gap-2 rounded-xl px-4 py-2.5 text-[12px] font-medium sm:flex"><RefreshCw size={14} />Refresh</button>
              <button onClick={addNetwork} className="secondary-button hidden rounded-xl px-4 py-2.5 text-[12px] font-medium sm:block">Add GIWA</button>
              <button onClick={connect} className="primary-button rounded-xl px-4 py-2.5 text-[12px] font-semibold sm:px-5">{wallet ? short(wallet) : 'Connect wallet'}</button>
            </div>
          </div>
        </header>

        <section className="mx-auto max-w-[1500px] px-5 pb-10 pt-6 md:px-8">
          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-emerald-200/[.16] bg-emerald-300/[.055] px-4 py-3 text-[12px] text-emerald-50/80">
            <TrendingUp
              size={16}
              className="mt-0.5 shrink-0 text-emerald-300"
            />
            <div>
              <span className="mr-2 rounded-md bg-emerald-300/15 px-2 py-1 text-[10px] font-semibold tracking-[.1em] text-emerald-200">
                REAL MARKET MODE
              </span>
              <span>
                XAU, XAG and WTI use Pyth market data. Trade synthetic spot markets
                against tUSDC, provide tUSDC liquidity, or open the dedicated Perpetuals
                terminal using the same tUSDC collateral token.
              </span>
            </div>
          </div>

          {config === null ? (


            <BackendWakeCard


              status={apiStatus}


              attempt={apiAttempt}


              onRetry={() => { void refreshConfig(); }}


            />


          ) : (


            <>


          {tab === 'overview' && (
            <OverviewPage
              onMarkets={() => changeTab('markets')}
              onTrade={() => changeTab('trade')}
              onLiquidity={() => changeTab('liquidity')}
              onPortfolio={() => changeTab('portfolio')}
            />
          )}
          {tab === 'markets' && <MarketsPage />}
          {tab === 'trade' && (
            <TradePage
              isOnchain={isOnchain}
              market={selected}
              meta={selectedMeta}
              wallet={wallet}
              quoteBalance={verifiedTokenBalance}
              quoteSymbol={quoteSymbol}
              assetBalance={selectedAssetBalance}
              side={side}
              setSide={setSide}
              amount={tradeInput}
              setAmount={setTradeInput}
              output={tradeOut}
              slippage={slippage}
              setSlippage={setSlippage}
              onConnect={() => { void connect(); }}
              onSwap={() => { void executeSwap(); }}
              swapBusy={busy === 'swap'}
            />
          )}
          {tab === 'liquidity' && (
            <LiquidityPage
              isOnchain={isOnchain}
              markets={markets}
              selected={selected}
              setSelectedSymbol={setSelectedSymbol}
              reserves={reserves}
              quoteBalance={verifiedTokenBalance}
              quoteSymbol={quoteSymbol}
              quoteDecimals={quoteDecimals}
              assetBalance={selectedAssetBalance}
              lpBalance={selectedLpBalance}
              quoteAmount={liquidityInput}
              setQuoteAmount={setLiquidityInput}
              assetAmount={liquidityAssetAmount}
              removeAmount={removeInput}
              setRemoveAmount={setRemoveInput}
              onAdd={() => { void addLiquidity(); }}
              onRemove={() => { void removeLiquidity(); }}
              busy={busy}
              onTrade={() => changeTab('trade')}
            />
          )}
          {tab === 'portfolio' && (
            <SpotPortfolioPage
              wallet={wallet}
              onConnect={connect}
              setToast={setToast}
            />
          )}
          {tab === 'season' && (
            <PublicBetaPage
              wallet={wallet}
              onConnect={connect}
              setToast={setToast}
            />
          )}
          {tab === 'proof' && (
            <ProofPage
              markets={markets}
              quoteSymbol={quoteSymbol}
              settlement={settlement}
            />
          )}
          {tab === 'perp' && (
            <div className="giwa-panel rounded-[26px] p-8 text-center">
              <TrendingUp
                size={28}
                className="mx-auto text-emerald-300"
              />
              <h2 className="mt-4 text-[28px] font-medium tracking-[-.04em]">
                Perpetuals now runs in a dedicated full-screen terminal.
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-[13px] leading-relaxed text-white/50">
                Open the standalone terminal for more chart space, clearer order controls,
                and independent wallet interaction.
              </p>
              <a
                href="/#/perp"
                target="_blank"
                rel="noopener noreferrer"
                className="primary-button mt-6 inline-flex items-center gap-2 rounded-xl px-5 py-3 text-[13px] font-semibold"
              >
                Open Perpetuals
                <ArrowUpRight size={15} />
              </a>
            </div>
          )}



            </>


          )}

          {toast && <div className="fixed bottom-5 left-5 right-5 z-40 mx-auto max-w-[760px] rounded-2xl border border-emerald-200/[.16] bg-[#082119]/95 px-4 py-3 text-[12px] text-emerald-50 shadow-[0_14px_60px_rgba(0,0,0,.36)] backdrop-blur-xl lg:left-[280px]">{toast}</div>}
        </section>
      </main>
    </div>
  );
}

/** Embedded RWA console used by the unified Custos workspace. */
export function RwaExchangeConsole() {
  return <TerminalApp />;
}

function OverviewPage({
  onMarkets,
  onTrade,
  onLiquidity,
  onPortfolio,
}: {
  onMarkets: () => void;
  onTrade: () => void;
  onLiquidity: () => void;
  onPortfolio: () => void;
}) {
  const { quotes, connected } = useRealMarketData();
  const [selectedAsset, setSelectedAsset] =
    useState<RealAssetSymbol | null>(null);

  return (
    <div className="fade-up">
      <section className="relative min-h-[360px] overflow-hidden rounded-[28px] border border-white/[.1] bg-[#06141f] px-6 py-10 md:px-10 md:py-11">
        {/* User-provided real-world commodity market board */}
        <div className="pointer-events-none absolute inset-y-0 right-0 w-full md:w-[62%]">
          <img
            src="/assets/market-board.webp"
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover object-center opacity-[.78]"
          />

          {/* Fade the photo smoothly into the left text area */}
          <div className="absolute inset-0 bg-[linear-gradient(90deg,#06141f_0%,rgba(6,20,31,.96)_12%,rgba(6,20,31,.78)_31%,rgba(6,20,31,.34)_63%,rgba(6,20,31,.12)_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,14,22,.12)_0%,rgba(4,14,22,.18)_58%,rgba(4,14,22,.58)_100%)]" />
        </div>

        {/* A very subtle market-line layer keeps the existing terminal language */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[.12]"
          style={{
            backgroundImage: "url('/assets/market-hero.svg')",
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />

        <div className="relative z-10 max-w-[720px]">
          <p className="text-[11px] font-semibold tracking-[.16em] text-emerald-300">
            REAL-WORLD MARKET DATA
          </p>

          <h1 className="mt-4 text-[clamp(42px,5vw,70px)] font-semibold leading-[.94] tracking-[-.07em]">
            Real markets,
            <span className="block brand-serif text-[#b5ffc6]">
              connected onchain.
            </span>
          </h1>

          <p className="mt-5 max-w-[625px] text-[14px] leading-relaxed text-white/78">
            Follow live reference prices for gold, silver and WTI crude oil with
            Pyth-powered market data. Open any asset to inspect real OHLC candles,
            then move into the full-screen Perpetuals terminal when you want to trade.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <button
              onClick={onMarkets}
              className="primary-button inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-[13px] font-semibold"
            >
              Explore real markets
              <ArrowUpRight size={16} />
            </button>

            <a
              href="/#/perp"
              target="_blank"
              rel="noopener noreferrer"
              className="secondary-button inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-[13px] font-medium"
            >
              Open Perpetuals
              <TrendingUp size={15} />
            </a>
          </div>
        </div>
      </section>

      <section className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {REAL_ASSETS.map((asset) => {
          const quote = quotes[asset.symbol];

          return (
            <Metric
              key={asset.symbol}
              title={asset.marketLabel}
              value={realPrice(quote?.price)}
              note={`${sessionLabel(quote)} · ${asset.unit}`}
              icon={<TrendingUp size={17} />}
            />
          );
        })}

        <Metric
          title="Market data"
          value={connected ? 'LIVE' : 'CORE'}
          note="Pyth Core latest + Pyth Pro history"
          icon={<ShieldCheck size={17} />}
        />
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        <button
          type="button"
          onClick={onTrade}
          className="giwa-panel group rounded-[22px] p-5 transition hover:-translate-y-1 hover:border-emerald-300/25"
        >
          <div className="flex items-center gap-2 text-emerald-300">
            <ArrowLeftRight size={16} />
            <span className="text-[10px] font-semibold tracking-[.12em]">
              SPOT
            </span>
          </div>
          <h3 className="mt-4 text-[23px] font-medium tracking-[-.04em]">
            Trade rXAU / rXAG / rWTI
          </h3>
          <p className="mt-2 text-[11px] leading-relaxed text-white/40">
            Buy and sell synthetic real-asset references against the same tUSDC used for Perpetuals.
          </p>
        </button>

        <button
          type="button"
          onClick={onLiquidity}
          className="giwa-panel group rounded-[22px] p-5 transition hover:-translate-y-1 hover:border-emerald-300/25"
        >
          <div className="flex items-center gap-2 text-emerald-300">
            <Droplets size={16} />
            <span className="text-[10px] font-semibold tracking-[.12em]">
              LIQUIDITY
            </span>
          </div>
          <h3 className="mt-4 text-[23px] font-medium tracking-[-.04em]">
            One-sided tUSDC LP
          </h3>
          <p className="mt-2 text-[11px] leading-relaxed text-white/40">
            Provide tUSDC liquidity, receive LP shares and accumulate Spot trading-fee value.
          </p>
        </button>

        <button
          type="button"
          onClick={onPortfolio}
          className="giwa-panel group rounded-[22px] p-5 transition hover:-translate-y-1 hover:border-emerald-300/25"
        >
          <div className="flex items-center gap-2 text-emerald-300">
            <Wallet size={16} />
            <span className="text-[10px] font-semibold tracking-[.12em]">
              PORTFOLIO
            </span>
          </div>
          <h3 className="mt-4 text-[23px] font-medium tracking-[-.04em]">
            One wallet, one test equity view
          </h3>
          <p className="mt-2 text-[11px] leading-relaxed text-white/40">
            See wallet tUSDC, Spot holdings, LP equity and Perpetuals collateral together.
          </p>
        </button>
      </section>

      <section className="giwa-panel mt-4 rounded-[24px] p-5 md:p-6">
        <div className="flex flex-col gap-5">
          <div>
            <div className="flex items-center gap-2 text-emerald-300">
              <TrendingUp size={17} />
              <span className="text-[11px] font-semibold tracking-[.13em]">
                REAL ASSET REFERENCES
              </span>
            </div>

            <h2 className="mt-2 text-[30px] font-medium tracking-[-.055em]">
              Click an asset. Inspect the real market.
            </h2>

            <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-white/45">
              These cards use real underlying market references. They are not claims
              that a GIWA testnet synthetic token represents legal ownership of the underlying asset.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {REAL_ASSETS.map((asset) => {
              const quote = quotes[asset.symbol];

              return (
                <button
                  key={asset.symbol}
                  type="button"
                  onClick={() => setSelectedAsset(asset.symbol)}
                  className="group overflow-hidden rounded-2xl border border-white/[.1] bg-black/[.16] text-left transition hover:-translate-y-1 hover:border-emerald-300/28"
                >
                  <div className="relative h-[150px]">
                    <img
                      src={asset.image}
                      alt={asset.name}
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#07131e] via-[#07131e]/20 to-transparent" />

                    <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between">
                      <div>
                        <p className="text-[10px] font-semibold tracking-[.13em] text-emerald-200">
                          {asset.assetClass.toUpperCase()}
                        </p>
                        <h3 className="mt-1 text-[20px] font-medium">
                          {asset.name}
                        </h3>
                      </div>

                      <span className="rounded-full border border-emerald-300/20 bg-[#07131e]/80 px-2.5 py-1 text-[9px] font-semibold text-emerald-200 backdrop-blur">
                        {sessionLabel(quote)}
                      </span>
                    </div>
                  </div>

                  <div className="p-4">
                    <p className="text-[11px] text-white/42">
                      {asset.marketLabel}
                    </p>
                    <p className="mt-1 text-[23px] font-semibold tracking-[-.04em] text-white">
                      {realPrice(quote?.price)}
                    </p>
                    <p className="mt-3 text-[11px] font-semibold text-emerald-200">
                      View real K-line
                      <ArrowUpRight size={13} className="ml-1 inline" />
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {selectedAsset && (
        <RealMarketModal
          asset={REAL_ASSET_BY_SYMBOL[selectedAsset]}
          quote={quotes[selectedAsset]}
          onClose={() => setSelectedAsset(null)}
        />
      )}
    </div>
  );
}

function Metric({
  title,
  value,
  note,
  icon,
}: {
  title: string;
  value: string;
  note: string;
  icon: ReactNode;
}) {
  return (
    <article className="giwa-panel min-h-[158px] rounded-[22px] p-5">
      <div className="flex items-center gap-2 text-[11px] tracking-[.1em] text-white/50">
        <span className="text-emerald-300">{icon}</span>
        {title}
      </div>
      <p className="mt-5 text-[31px] font-semibold tracking-[-.06em]">
        {value}
      </p>
      <p className="mt-3 text-[11px] text-white/42">{note}</p>
    </article>
  );
}

function MarketsPage() {
  const { quotes, connected } = useRealMarketData();
  const [selectedAsset, setSelectedAsset] =
    useState<RealAssetSymbol | null>(null);

  return (
    <div className="fade-up">
      <section className="flex flex-col gap-5 rounded-[26px] border border-white/[.1] bg-white/[.025] px-6 py-7 md:flex-row md:items-end md:justify-between md:px-8">
        <div>
          <p className="text-[11px] font-semibold tracking-[.15em] text-emerald-300">
            REAL-WORLD MARKETS
          </p>
          <h1 className="mt-3 text-[46px] font-semibold tracking-[-.07em]">
            Market prices that match the underlying world.
          </h1>
          <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-white/48">
            Gold, silver and WTI crude oil are sourced from Pyth market feeds. Open a card
            for historical OHLC candles or continue into the dedicated perpetual
            terminal.
          </p>
        </div>

        <div className="rounded-full border border-emerald-300/18 bg-emerald-300/[.06] px-4 py-2.5 text-[11px] text-emerald-100">
          <span className="mr-2 inline-block size-1.5 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(134,255,165,.85)]" />
          {connected ? 'PYTH CORE LIVE' : 'PYTH CORE CONNECTING'}
        </div>
      </section>

      <section className="mt-5 grid gap-4 xl:grid-cols-3">
        {REAL_ASSETS.map((asset) => (
          <RealMarketCard
            key={asset.symbol}
            asset={asset}
            quote={quotes[asset.symbol]}
            onChart={() => setSelectedAsset(asset.symbol)}
          />
        ))}
      </section>

      <section className="mt-5 rounded-2xl border border-sky-200/[.1] bg-sky-200/[.035] px-5 py-4 text-[11px] leading-relaxed text-white/46">
        <strong className="text-white/78">Market-data note:</strong>{' '}
        prices and candles reference real underlying markets. The GIWA Sepolia
        perpetual contracts are synthetic testnet instruments and do not represent
        custody, redemption, or legal ownership of the underlying asset.
      </section>

      {selectedAsset && (
        <RealMarketModal
          asset={REAL_ASSET_BY_SYMBOL[selectedAsset]}
          quote={quotes[selectedAsset]}
          onClose={() => setSelectedAsset(null)}
        />
      )}
    </div>
  );
}

function RealMarketCard({
  asset,
  quote,
  onChart,
}: {
  asset: RealAsset;
  quote?: RealQuote;
  onChart: () => void;
}) {
  return (
    <article className="giwa-panel overflow-hidden rounded-[24px]">
      <button
        type="button"
        onClick={onChart}
        className="group relative block h-[205px] w-full overflow-hidden text-left"
      >
        <img
          src={asset.image}
          alt={asset.name}
          referrerPolicy="no-referrer"
          loading="lazy"
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#07131e] via-[#07131e]/34 to-black/5" />

        <div className="absolute bottom-5 left-5 right-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold tracking-[.14em] text-emerald-200">
                {asset.symbol} · {asset.assetClass.toUpperCase()}
              </p>
              <h2 className="mt-1 text-[26px] font-medium tracking-[-.05em]">
                {asset.name}
              </h2>
            </div>

            <span className="rounded-full border border-emerald-300/20 bg-[#06120d]/85 px-2.5 py-1 text-[9px] font-semibold text-emerald-200 backdrop-blur">
              {sessionLabel(quote)}
            </span>
          </div>
        </div>
      </button>

      <div className="p-5">
        <p className="text-[11px] text-white/42">
          {asset.marketLabel} · {asset.unit}
        </p>

        <p className="mt-2 text-[31px] font-semibold tracking-[-.055em]">
          {realPrice(quote?.price)}
        </p>

        <p className="mt-4 min-h-[40px] text-[12px] leading-relaxed text-white/48">
          {asset.description}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3 border-y border-white/[.08] py-4">
          <Stat
            label="Price source"
            value={quote?.source || 'Pyth'}
          />
          <Stat
            label="Session"
            value={sessionLabel(quote)}
          />
        </div>

        <div className="mt-5">
          <button
            type="button"
            onClick={onChart}
            className="primary-button w-full rounded-full px-4 py-3 text-[12px] font-semibold"
          >
            View real K-line
          </button>
        </div>
      </div>
    </article>
  );
}

function RealMarketModal({
  asset,
  quote,
  onClose,
}: {
  asset: RealAsset;
  quote?: RealQuote;
  onClose: () => void;
}) {
  const [resolution, setResolution] =
    useState<RealResolution>('5m');
  const [candles, setCandles] = useState<HistoryCandle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError('');

      try {
        const response = await fetch(
          `${API_BASE}/api/real-market/history/${asset.symbol}?resolution=${resolution}&bars=300`,
          {
            cache: 'no-store',
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `History request failed (${response.status})`);
        }

        const body = await response.json();
        const rows = Array.isArray(body?.candles) ? body.candles : [];

        setCandles(
          rows
            .map((row: any) => ({
              time: Number(row.time),
              open: Number(row.open),
              high: Number(row.high),
              low: Number(row.low),
              close: Number(row.close),
              volume:
                row.volume == null ? null : Number(row.volume),
            }))
            .filter(
              (row: HistoryCandle) =>
                Number.isFinite(row.time) &&
                Number.isFinite(row.open) &&
                Number.isFinite(row.high) &&
                Number.isFinite(row.low) &&
                Number.isFinite(row.close),
            ),
        );
      } catch (requestError: any) {
        if (requestError?.name !== 'AbortError') {
          setError(
            requestError?.message ||
              'Historical market data is unavailable.',
          );
        }
      } finally {
        setLoading(false);
      }
    }

    void load();

    return () => controller.abort();
  }, [asset.symbol, resolution]);

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/75 p-3 backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div
        className="notranslate w-full max-w-[1120px] overflow-hidden rounded-[26px] border border-white/[.12] bg-[#04110c] shadow-[0_32px_100px_rgba(0,0,0,.62)]"
        translate="no"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/[.08] px-5 py-5 md:px-7">
          <div>
            <p className="text-[10px] font-semibold tracking-[.15em] text-emerald-300">
              REAL UNDERLYING MARKET
            </p>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 className="text-[29px] font-semibold tracking-[-.05em]">
                {asset.name}
              </h2>
              <span className="font-mono text-[12px] text-white/45">
                {asset.marketLabel}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <strong className="text-[25px] text-emerald-200">
                {realPrice(quote?.price)}
              </strong>
              <span className="rounded-full border border-emerald-300/18 bg-emerald-300/[.07] px-2.5 py-1 text-[9px] font-semibold text-emerald-100">
                {sessionLabel(quote)}
              </span>
              <span className="text-[10px] text-white/36">
                {quote?.source || 'Pyth'}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/[.1] text-white/55 hover:bg-white/[.05] hover:text-white"
          >
            <X size={17} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-white/[.08] px-5 py-3 md:px-7">
          {(['1m', '5m', '30m', '2h', '6h', '1d'] as RealResolution[]).map(
            (value) => (
              <button
                key={value}
                type="button"
                onClick={() => setResolution(value)}
                className={`rounded-lg border px-3 py-2 font-mono text-[10px] ${
                  value === resolution
                    ? 'border-emerald-300/35 bg-emerald-300/[.1] text-emerald-200'
                    : 'border-white/[.08] text-white/40 hover:text-white/75'
                }`}
              >
                {value}
              </button>
            ),
          )}

          <div className="ml-auto text-[10px] text-white/34">
            PYTH OHLC · {asset.unit}
          </div>
        </div>

        <div className="relative h-[520px]">
          <RealCandlestickChart
            candles={candles}
            livePrice={quote?.price ?? null}
          />

          {loading && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#04110c]/55 text-[11px] text-emerald-100/70 backdrop-blur-[1px]">
              Loading real market history…
            </div>
          )}

          {!loading && error && (
            <div className="absolute inset-0 grid place-items-center p-8 text-center">
              <div>
                <p className="text-[13px] font-medium text-amber-100">
                  K-line history unavailable
                </p>
                <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/42">
                  {error}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-white/[.08] px-5 py-4 text-[10px] text-white/38 md:flex-row md:items-center md:justify-between md:px-7">
          <span>
            Real reference market data supplied by Pyth. Underlying market hours and maintenance windows apply.
          </span>
          <span className="text-emerald-200">
            Real-world reference market
          </span>
        </div>
      </div>
    </div>
  );
}

function RealCandlestickChart({
  candles,
  livePrice,
}: {
  candles: HistoryCandle[];
  livePrice: number | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: Math.max(container.clientWidth, 320),
      height: container.clientHeight || 520,
      layout: {
        background: {
          type: ColorType.Solid,
          color: '#04110c',
        },
        textColor: '#71867b',
        fontFamily:
          'IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: {
          color: 'rgba(111,140,123,.09)',
        },
        horzLines: {
          color: 'rgba(111,140,123,.09)',
        },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(167,190,177,.28)',
          labelBackgroundColor: '#17261f',
        },
        horzLine: {
          color: 'rgba(167,190,177,.28)',
          labelBackgroundColor: '#17261f',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(111,140,123,.16)',
      },
      timeScale: {
        borderColor: 'rgba(111,140,123,.16)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#55d99a',
      downColor: '#ef6272',
      borderUpColor: '#55d99a',
      borderDownColor: '#ef6272',
      wickUpColor: '#70e6ad',
      wickDownColor: '#ff7180',
      priceLineVisible: false,
      lastValueVisible: true,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const observer = new ResizeObserver(() => {
      if (!containerRef.current) return;

      chart.applyOptions({
        width: Math.max(
          containerRef.current.clientWidth,
          320,
        ),
        height:
          containerRef.current.clientHeight || 520,
      });
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    const data: CandlestickData<UTCTimestamp>[] =
      [...candles]
        .sort((a, b) => a.time - b.time)
        .map((candle) => ({
          time: candle.time as UTCTimestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        }));

    series.setData(data);

    if (data.length) {
      chart.timeScale().fitContent();
    }
  }, [candles]);

  useEffect(() => {
    const series = seriesRef.current;
    if (
      !series ||
      livePrice == null ||
      !Number.isFinite(livePrice) ||
      candles.length === 0
    ) {
      return;
    }

    const last = candles[candles.length - 1];

    if (!last) return;

    try {
      series.update({
        time: last.time as UTCTimestamp,
        open: last.open,
        high: Math.max(last.high, livePrice),
        low: Math.min(last.low, livePrice),
        close: livePrice,
      });
    } catch {
      // Historical series remains visible even if a live tick is out of order.
    }
  }, [livePrice, candles]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
    />
  );
}

function TradePage({ isOnchain, market, meta, wallet, quoteBalance, quoteSymbol, assetBalance, side, setSide, amount, setAmount, output, slippage, setSlippage, onConnect, onSwap, swapBusy }: { isOnchain: boolean; market?: ChainMarket; meta: AssetMeta; wallet: string; quoteBalance: string; quoteSymbol: string; assetBalance: string; side: TradeSide; setSide: (value: TradeSide) => void; amount: string; setAmount: (value: string) => void; output: string; slippage: string; setSlippage: (value: string) => void; onConnect: () => void; onSwap: () => void; swapBusy: boolean; }) {
  if (!market) return <SetupCard />;
  return <div className="fade-up grid gap-5 xl:grid-cols-[1.08fr_.92fr]">
    <section className="giwa-panel rounded-[26px] p-6 md:p-8"><div className="flex items-start justify-between gap-5"><div><p className="text-[11px] font-semibold tracking-[.15em] text-emerald-300">PUBLIC TRADE</p><h1 className="mt-3 text-[46px] font-semibold tracking-[-.07em]">Trade real-world proof.</h1><p className="mt-3 max-w-xl text-[14px] leading-relaxed text-white/49">This is a {NETWORK_NAME} test AMM. Your input is a configured test quote token, not a stablecoin or real settlement asset.</p></div><StatusPill label={isOnchain ? 'ONCHAIN' : 'SETUP'} good={isOnchain} /></div>
      <div className="mt-7 flex gap-2 rounded-full border border-white/[.1] bg-black/[.16] p-1.5"><button onClick={() => setSide('buy')} className={`flex-1 rounded-full px-4 py-2.5 text-[12px] font-medium transition ${side === 'buy' ? 'bg-emerald-300 text-[#062012]' : 'text-white/58 hover:text-white'}`}>Buy {market.symbol}</button><button onClick={() => setSide('sell')} className={`flex-1 rounded-full px-4 py-2.5 text-[12px] font-medium transition ${side === 'sell' ? 'bg-emerald-300 text-[#062012]' : 'text-white/58 hover:text-white'}`}>Sell {market.symbol}</button></div>
      <TradeField label="You pay" value={amount} setValue={setAmount} token={side === 'buy' ? quoteSymbol : market.symbol} balance={side === 'buy' ? quoteBalance : assetBalance} />
      <div className="relative z-10 -my-2 flex justify-center"><span className="grid size-11 place-items-center rounded-full border border-emerald-200/25 bg-[#091b22] text-emerald-200"><ArrowDown size={18} /></span></div>
      <TradeField label="You receive" value={trim(output, 8)} token={side === 'buy' ? market.symbol : quoteSymbol} readOnly />
      <div className="mt-6 grid gap-3 border-t border-white/[.08] pt-5 text-[12px] sm:grid-cols-3"><Stat label="Trading fee" value="0.30%" /><Stat label="Slippage tolerance" value={`${slippage}%`} /><Stat label="Network" value={NETWORK_NAME} /></div>
      <label className="mt-5 block text-[11px] text-white/52">Slippage tolerance (%)<input value={slippage} onChange={(event) => setSlippage(event.target.value.replace(/[^0-9.]/g, ''))} className="field-surface mt-2 w-full rounded-xl px-3 py-3 text-[13px]" inputMode="decimal" /></label>
      {!wallet ? <button onClick={onConnect} className="primary-button mt-5 flex w-full items-center justify-center gap-2 rounded-full px-6 py-4 text-[14px] font-semibold"><Wallet size={16} />Connect wallet</button> : <button onClick={onSwap} disabled={!isOnchain || swapBusy} className="primary-button mt-5 flex w-full items-center justify-center gap-2 rounded-full px-6 py-4 text-[14px] font-semibold disabled:opacity-45">{swapBusy ? <Spinner /> : <ArrowLeftRight size={16} />}{swapBusy ? 'Submitting swap…' : `Swap with ${quoteSymbol}`}</button>}
      <div className="mt-4 rounded-xl border border-emerald-200/[.14] bg-emerald-300/[.05] p-3 text-[11px] leading-relaxed text-white/56">Need {quoteSymbol}? Use the configured testnet faucet or claim flow, then refresh your wallet balance. This asset is not a stablecoin and has no cash value.</div>
    </section>
    <aside className="overflow-hidden rounded-[26px] border border-white/[.1] bg-[#071722]"><img src={meta.image} alt="" className="h-[225px] w-full object-cover" /><div className="p-6"><p className="text-[11px] font-semibold tracking-[.13em] text-emerald-300">{market.symbol}</p><h2 className="mt-2 text-[34px] font-medium tracking-[-.06em]">{market.name}</h2><p className="mt-4 text-[13px] leading-relaxed text-white/52">{meta.description}</p><div className="mt-6 space-y-3 border-t border-white/[.08] pt-5"><Row label="Issuer" value={meta.issuer} /><Row label="Maturity" value={market.maturity} /><Row label="Document proof" value={short(market.documentHash)} /><Row label="Quote token" value={quoteSymbol} /></div><a className="mt-5 inline-flex items-center gap-1 text-[11px] text-emerald-200" href={explorer(market.poolAddress)} target="_blank" rel="noreferrer">Open pool contract <ExternalLink size={13} /></a></div></aside>
  </div>;
}

function TradeField({ label, value, setValue, token, balance, readOnly = false }: { label: string; value: string; setValue?: (value: string) => void; token: string; balance?: string; readOnly?: boolean }) {
  return <div className={`mt-5 rounded-[24px] border p-5 ${readOnly ? 'border-emerald-200/[.17] bg-emerald-300/[.045]' : 'border-white/[.1] bg-black/[.14]'}`}><div className="flex items-center justify-between text-[12px]"><span className="text-white/70">{label}</span>{balance !== undefined && <span className="text-white/42">Balance: {trim(balance, 5)}</span>}</div><div className="mt-7 flex items-end justify-between gap-4"><input readOnly={readOnly} value={value} onChange={(event) => setValue?.(event.target.value.replace(/[^0-9.]/g, ''))} className="min-w-0 flex-1 bg-transparent text-[47px] font-semibold tracking-[-.07em] outline-none" inputMode="decimal" /><span className="rounded-xl bg-white/[.08] px-4 py-2.5 text-[14px] font-medium">{token}</span></div></div>;
}

function LiquidityPage({ isOnchain, markets, selected, setSelectedSymbol, reserves, quoteBalance, quoteSymbol, quoteDecimals, assetBalance, lpBalance, quoteAmount, setQuoteAmount, assetAmount, removeAmount, setRemoveAmount, onAdd, onRemove, busy, onTrade }: { isOnchain: boolean; markets: ChainMarket[]; selected?: ChainMarket; setSelectedSymbol: (value: string) => void; reserves: Record<string, Reserves>; quoteBalance: string; quoteSymbol: string; quoteDecimals: number; assetBalance: string; lpBalance: string; quoteAmount: string; setQuoteAmount: (value: string) => void; assetAmount: string; removeAmount: string; setRemoveAmount: (value: string) => void; onAdd: () => void; onRemove: () => void; busy: string | null; onTrade: () => void; }) {
  if (!selected) return <SetupCard />;
  const quoteReserve = reserves[selected.symbol] ? ratio(reserves[selected.symbol].quote, quoteDecimals) : Number(selected.quoteLiquidity || 0);
  return <div className="fade-up"><section className="giwa-panel flex flex-col gap-5 rounded-[26px] px-6 py-7 md:flex-row md:items-end md:justify-between md:px-8"><div><p className="text-[11px] font-semibold tracking-[.15em] text-emerald-300">AMM LIQUIDITY</p><h1 className="mt-3 text-[43px] font-semibold tracking-[-.07em]">Liquidity, after proof.</h1><p className="mt-3 max-w-xl text-[14px] leading-relaxed text-white/48">Acquire RWA inventory with the configured {quoteSymbol} test asset first, then provide both tokens at the pool ratio to receive LP shares.</p></div><button onClick={onTrade} className="primary-button inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-[13px] font-semibold"><ArrowLeftRight size={16} />Acquire RWA inventory</button></section>
    <section className="mt-5 grid gap-5 xl:grid-cols-[1.05fr_.95fr]"><div className="overflow-hidden rounded-[24px] border border-white/[.1] bg-[#081521]/80"><div className="grid grid-cols-[1.35fr_.7fr_.7fr_110px] gap-4 border-b border-white/[.08] px-6 py-4 text-[10px] font-medium tracking-[.11em] text-white/38 max-md:grid-cols-[1.3fr_.8fr_95px]"><span>Liquidity pool</span><span>Quote reserve</span><span className="max-md:hidden">LP fee</span><span className="text-right">Action</span></div>{markets.map((market) => <button key={market.symbol} onClick={() => setSelectedSymbol(market.symbol)} className={`grid w-full grid-cols-[1.35fr_.7fr_.7fr_110px] items-center gap-4 border-b border-white/[.07] px-6 py-5 text-left transition last:border-0 hover:bg-emerald-300/[.035] max-md:grid-cols-[1.3fr_.8fr_95px] ${selected.symbol === market.symbol ? 'bg-emerald-300/[.07]' : ''}`}><div className="flex items-center gap-3"><div className="relative flex"><span className="grid size-9 place-items-center rounded-full bg-emerald-300/[.13] text-emerald-200"><Landmark size={16} /></span><span className="-ml-2 mt-4 grid size-7 place-items-center rounded-full border border-[#0b1d2a] bg-sky-300/[.18] text-sky-100"><CircleDollarSign size={13} /></span></div><div><p className="text-[14px] font-medium text-white">{market.symbol} / {quoteSymbol}</p><p className="mt-1 text-[11px] text-white/40">Verified RWA / test quote token</p></div></div><div><p className="text-[13px] text-white/85">{trim(reserves[market.symbol] ? ratio(reserves[market.symbol].quote, quoteDecimals) : Number(market.quoteLiquidity || 0), 4)}</p><p className="mt-1 text-[10px] text-emerald-300">{quoteSymbol}</p></div><p className="text-[13px] text-emerald-200 max-md:hidden">0.30%</p><span className="justify-self-end rounded-xl border border-emerald-200/22 bg-emerald-300/[.08] px-3 py-2 text-[10px] font-medium text-emerald-100">Manage</span></button>)}</div>
      <div className="giwa-panel rounded-[24px] p-6"><div className="flex items-center justify-between"><div><p className="text-[11px] font-semibold tracking-[.13em] text-emerald-300">MANAGE POOL</p><h2 className="mt-2 text-[30px] font-medium tracking-[-.055em]">{selected.symbol} / {quoteSymbol}</h2></div><StatusPill label={isOnchain ? 'ONCHAIN' : 'SETUP'} good={isOnchain} /></div><div className="mt-5 rounded-2xl border border-white/[.1] bg-black/[.14] p-4"><div className="flex justify-between gap-4 text-[12px]"><span className="text-white/42">Pool quote reserve</span><span>{trim(quoteReserve, 5)} {quoteSymbol}</span></div><div className="mt-3 flex justify-between gap-4 text-[12px]"><span className="text-white/42">Your balances</span><span>{trim(assetBalance, 5)} {selected.symbol} · {trim(quoteBalance, 4)} {quoteSymbol}</span></div><div className="mt-3 flex justify-between gap-4 text-[12px]"><span className="text-white/42">Your LP shares</span><span>{trim(lpBalance, 6)} LP</span></div></div><div className="mt-6"><p className="text-[12px] font-medium text-white">Add liquidity</p><label className="mt-3 block text-[11px] text-white/48">{quoteSymbol} amount<input value={quoteAmount} onChange={(event) => setQuoteAmount(event.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className="field-surface mt-2 w-full rounded-xl px-3 py-3 text-[13px]" /></label><div className="mt-3 rounded-xl border border-emerald-200/[.14] bg-emerald-300/[.055] p-3 text-[12px] text-white/72">Required matched asset: <strong className="text-emerald-100">{trim(assetAmount, 6)} {selected.symbol}</strong></div><button onClick={onAdd} disabled={!isOnchain || busy !== null} className="primary-button mt-4 flex w-full items-center justify-center gap-2 rounded-full px-5 py-3.5 text-[13px] font-semibold disabled:opacity-40">{busy === 'add-liquidity' ? <Spinner /> : <Plus size={16} />}{busy === 'add-liquidity' ? 'Adding liquidity…' : 'Add liquidity'}</button></div><div className="mt-7 border-t border-white/[.1] pt-6"><p className="text-[12px] font-medium text-white">Remove liquidity</p><label className="mt-3 block text-[11px] text-white/48">LP token amount<input value={removeAmount} onChange={(event) => setRemoveInputGuard(setRemoveAmount, event.target.value)} inputMode="decimal" placeholder="0.00" className="field-surface mt-2 w-full rounded-xl px-3 py-3 text-[13px]" /></label><button onClick={onRemove} disabled={!isOnchain || busy !== null} className="secondary-button mt-4 flex w-full items-center justify-center gap-2 rounded-full px-5 py-3.5 text-[13px] font-medium disabled:opacity-40">{busy === 'remove-liquidity' ? <Spinner /> : <Droplets size={16} />}{busy === 'remove-liquidity' ? 'Removing…' : 'Remove liquidity'}</button></div></div></section></div>;
}

function setRemoveInputGuard(setter: (value: string) => void, value: string) {
  setter(value.replace(/[^0-9.]/g, ''));
}

function ProofPage({ markets, quoteSymbol, settlement }: { markets: ChainMarket[]; quoteSymbol: string; settlement: SettlementToken }) {
  const claimUrl = settlement.claimUrl || (settlement.official ? PLAYGROUND_URL : '');
  return <div className="fade-up"><p className="text-[11px] font-semibold tracking-[.15em] text-emerald-300">PROOF VAULT</p><h1 className="mt-3 text-[48px] font-semibold tracking-[-.07em]">Evidence before entry.</h1><p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-white/50">Document hash, asset ID, maturity, RWA token, AMM pool, and the configured quote-token relationship remain visible before any market action.</p><section className="giwa-panel mt-6 rounded-[22px] p-5"><p className="text-[11px] font-semibold tracking-[.13em] text-emerald-300">QUOTE TOKEN</p><div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><p className="text-[20px] font-medium">{settlement.official ? 'Official GIWA Playground' : 'Custos project'} {quoteSymbol}</p><p className="mt-1 text-[12px] text-white/48">{settlement.disclaimer || 'Testnet-only token. Not USDC and not redeemable for cash.'}</p></div>{claimUrl ? <a href={claimUrl} target="_blank" rel="noreferrer" className="secondary-button inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[12px]">Open token flow <ExternalLink size={14} /></a> : null}</div></section><div className="mt-5 grid gap-4 xl:grid-cols-3">{markets.map((market) => <article key={market.symbol} className="giwa-panel rounded-[24px] p-6"><div className="flex items-center justify-between"><span className="grid size-10 place-items-center rounded-xl bg-emerald-300/[.1] text-emerald-200"><FileText size={18} /></span><StatusPill label="VERIFIED" /></div><p className="mt-6 text-[11px] font-semibold tracking-[.13em] text-emerald-300">{market.symbol} / {quoteSymbol}</p><h2 className="mt-2 text-[24px] font-medium tracking-[-.045em]">{market.name}</h2><div className="mt-6 space-y-3 border-t border-white/[.08] pt-5 text-[12px]"><Row label="Asset ID" value={short(market.assetId)} /><Row label="Document hash" value={short(market.documentHash)} /><Row label="Maturity" value={market.maturity} /><Row label="Token" value={short(market.tokenAddress)} /><Row label="Pool" value={short(market.poolAddress)} /></div><div className="mt-5 flex gap-3"><a className="inline-flex items-center gap-1 text-[11px] text-emerald-200" href={explorer(market.tokenAddress)} target="_blank" rel="noreferrer">Token <ExternalLink size={13} /></a><a className="inline-flex items-center gap-1 text-[11px] text-emerald-200" href={explorer(market.poolAddress)} target="_blank" rel="noreferrer">Pool <ExternalLink size={13} /></a></div></article>)}</div>{!markets.length && <SetupCard />}</div>;
}

function Stat({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/[.09] bg-white/[.025] p-3"><p className="text-[10px] tracking-[.11em] text-white/40">{label}</p><p className="mt-1 truncate text-[12px] font-medium text-white/82">{value}</p></div>; }
function Row({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-4"><span className="text-white/42">{label}</span><span className="max-w-[62%] truncate text-right text-white/85">{value}</span></div>; }
function BackendWakeCard({
  status,
  attempt,
  onRetry,
}: {
  status: 'connecting' | 'retrying' | 'ready' | 'offline';
  attempt: number;
  onRetry: () => void;
}) {
  const offline = status === 'offline';

  return (
    <div className="giwa-panel mt-6 rounded-[24px] p-7 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-2xl border border-emerald-200/20 bg-emerald-300/[.08] text-emerald-200">
        <Loader2 size={23} className={offline ? '' : 'animate-spin'} />
      </div>

      <p className="mt-5 text-[11px] font-semibold tracking-[.16em] text-emerald-300">
        GIWA API CONNECTION
      </p>

      <h2 className="mt-3 text-[25px] font-medium tracking-[-.04em]">
        {offline ? 'GIWA API is taking longer than usual.' : 'Waking up GIWA API…'}
      </h2>

      <p className="mx-auto mt-3 max-w-xl text-[13px] leading-relaxed text-white/55">
        {offline
          ? 'The API service may still be starting. Your deployed contracts remain unchanged. Click Retry now to check the onchain configuration again.'
          : `Checking your deployed GIWA markets and quote-token configuration${attempt ? ` — attempt ${attempt}/8` : ''}.`}
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <span className="rounded-full border border-emerald-200/15 bg-emerald-300/[.07] px-3 py-2 text-[11px] text-emerald-100/85">
          {offline ? 'Waiting for API response' : 'Automatic retry enabled'}
        </span>

        <button
          type="button"
          onClick={onRetry}
          className="primary-button inline-flex items-center gap-2 rounded-full px-5 py-3 text-[12px] font-semibold"
        >
          <RefreshCw size={14} />
          Retry now
        </button>
      </div>
    </div>
  );
}

function SetupCard() { return <div className="giwa-panel mt-6 rounded-[24px] p-7 text-center"><LockKeyhole size={25} className="mx-auto text-amber-200" /><h2 className="mt-3 text-[24px] font-medium">Contracts are not configured.</h2><p className="mx-auto mt-3 max-w-xl text-[13px] leading-relaxed text-white/48">Deploy the Custos market contracts on the selected test network, then restart the API and refresh this page.</p></div>; }
