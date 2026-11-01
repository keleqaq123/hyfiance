import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowUpRight,
  CircleDollarSign,
  Droplets,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  BrowserProvider,
  Contract,
  formatEther,
  formatUnits,
  parseUnits,
} from 'ethers-v6';

import spotDeployment from './spot.generated.json';
import perpDeployment from './deployment.generated.json';
import {
  PERP_VAULT_ABI,
  SPOT_POOL_ABI,
  SYNTH_ABI,
  TEST_USDC_ABI,
  ZERO,
} from './spotContracts';
import { CUSTOS_API_BASE, MARKET_NETWORK, ensureMarketNetwork } from './marketNetwork';

const API_BASE =
  CUSTOS_API_BASE;
const GIWA_EXPLORER =
  MARKET_NETWORK.explorer || import.meta.env.VITE_GIWA_EXPLORER || 'https://sepolia-explorer.giwa.io';
const CHAIN_ID = MARKET_NETWORK.chainId;
const NETWORK_NAME = MARKET_NETWORK.name;

export type SpotSymbol = 'XAU' | 'XAG' | 'OIL';

type SpotMarketConfig = {
  name: string;
  tokenSymbol: string;
  underlying: string;
  pythSymbol: string;
  feedId: string;
  unit: string;
  token: string;
  pool: string;
};

type RealQuote = {
  price: number;
  fresh: boolean;
  source: string;
  ageSeconds?: number;
};

const MARKET_META: Record<
  SpotSymbol,
  {
    title: string;
    token: string;
    unit: string;
    image: string;
    accent: string;
  }
> = {
  XAU: {
    title: 'Gold',
    token: 'rXAU',
    unit: '1 token = 1 troy oz gold reference',
    image: '/assets/markets/gold.png',
    accent: 'GOLD',
  },
  XAG: {
    title: 'Silver',
    token: 'rXAG',
    unit: '1 token = 1 troy oz silver reference',
    image: '/assets/markets/silver.png',
    accent: 'SILVER',
  },
  OIL: {
    title: 'WTI Crude Oil',
    token: 'rWTI',
    unit: '1 token = 1 barrel WTI reference',
    image: '/assets/markets/oil.png',
    accent: 'ENERGY',
  },
};

const MARKET_ORDER: SpotSymbol[] = ['XAU', 'XAG', 'OIL'];

function marketConfig(symbol: SpotSymbol): SpotMarketConfig | null {
  const markets = (spotDeployment as any).markets || {};
  return markets[symbol] || null;
}

function isDeployed(symbol: SpotSymbol) {
  const market = marketConfig(symbol);
  return Boolean(
    market &&
      market.token &&
      market.pool &&
      market.token !== ZERO &&
      market.pool !== ZERO,
  );
}

function short(address?: string) {
  if (!address) return '—';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function fmt(value?: number | null, digits = 2) {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: value < 10 ? Math.min(4, digits + 2) : 2,
    maximumFractionDigits: value < 10 ? Math.min(4, digits + 2) : digits,
  }).format(value);
}

function useRealQuotes() {
  const [quotes, setQuotes] = useState<Partial<Record<SpotSymbol, RealQuote>>>({});

  async function refresh() {
    try {
      const response = await fetch(`${API_BASE}/api/real-markets`, {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const body = await response.json();
      const next: Partial<Record<SpotSymbol, RealQuote>> = {};
      for (const row of body.markets || []) {
        const symbol = String(row.symbol || '').toUpperCase() as SpotSymbol;
        if (!MARKET_META[symbol] || !row.quote) continue;
        next[symbol] = {
          price: Number(row.quote.price),
          fresh: Boolean(row.quote.fresh),
          source: String(row.quote.source || 'Pyth Core'),
          ageSeconds: Number(row.quote.ageSeconds || 0),
        };
      }
      setQuotes(next);
    } catch {
      // Keep previous values.
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 2_000);
    return () => window.clearInterval(timer);
  }, []);

  return { quotes, refresh };
}

async function freshWallet() {
  const ethereum = (window as any).ethereum;
  if (!ethereum) throw new Error('Install an EVM wallet first.');
  await ensureMarketNetwork(ethereum);
  const bp = new BrowserProvider(ethereum);
  const network = await bp.getNetwork();
  if (Number(network.chainId) !== CHAIN_ID) {
    throw new Error(`Switch wallet to ${NETWORK_NAME} first.`);
  }
  const signer = await bp.getSigner();
  return { bp, signer, address: await signer.getAddress() };
}

async function ensureApproval(
  tokenAddress: string,
  spender: string,
  amount: bigint,
  signer: any,
  abi: readonly string[],
) {
  const token = new Contract(tokenAddress, abi, signer);
  const owner = await signer.getAddress();
  const allowance = (await token.allowance(owner, spender)) as bigint;
  if (allowance >= amount) return;
  const tx = await token.approve(spender, amount);
  await tx.wait();
}

async function getUpdate(symbol: SpotSymbol) {
  const response = await fetch(`${API_BASE}/api/real-market/update/${symbol}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

function savedReferralCode() {
  const incoming = new URLSearchParams(window.location.hash.split('?')[1] || '')
    .get('ref')
    ?.toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 32) || '';
  if (incoming) localStorage.setItem('custos_ref', incoming);
  return incoming || localStorage.getItem('custos_ref') || localStorage.getItem('kelq_ref') || '';
}

async function writeActivity(
  wallet: string,
  action: 'swap' | 'add_liquidity' | 'remove_liquidity' | 'faucet',
  summary: string,
  txHash: string,
) {
  try {
    await fetch(`${API_BASE}/api/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wallet,
        action,
        summary,
        tx_hash: txHash,
        execution_mode: 'onchain',
      }),
    });
  } catch {
    // Chain state remains authoritative if the optional activity API is offline.
  }

  const betaAction = {
    swap: 'spot_trade',
    add_liquidity: 'add_liquidity',
    remove_liquidity: 'remove_liquidity',
    faucet: 'faucet',
  }[action];

  try {
    await fetch(`${API_BASE}/api/beta/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wallet,
        action: betaAction,
        tx_hash: txHash,
        ref_code: savedReferralCode(),
      }),
    });
  } catch {
    // Points can be retried later; the transaction itself remains authoritative.
  }
}


function MarketSelector({
  symbol,
  setSymbol,
  quotes,
}: {
  symbol: SpotSymbol;
  setSymbol: (value: SpotSymbol) => void;
  quotes: Partial<Record<SpotSymbol, RealQuote>>;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {MARKET_ORDER.map((key) => {
        const meta = MARKET_META[key];
        const quote = quotes[key];
        return (
          <button
            type="button"
            key={key}
            onClick={() => setSymbol(key)}
            className={`relative overflow-hidden rounded-2xl border p-4 text-left transition ${
              symbol === key
                ? 'border-emerald-300/35 bg-emerald-300/[.08]'
                : 'border-white/[.09] bg-white/[.02] hover:border-white/[.17]'
            }`}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-[#071722]/95 to-[#071722]/72" />
            <img
              src={meta.image}
              alt=""
              referrerPolicy="no-referrer"
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover opacity-[.15]"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
            <div className="relative z-10">
              <p className="text-[9px] font-semibold tracking-[.13em] text-emerald-200">
                {meta.accent}
              </p>
              <div className="mt-1 flex items-end justify-between gap-3">
                <div>
                  <strong className="text-[17px]">{meta.title}</strong>
                  <p className="mt-1 text-[10px] text-white/40">{key} / USD</p>
                </div>
                <span className="font-mono text-[15px] text-white">
                  ${fmt(quote?.price)}
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function SpotTradePage({
  wallet,
  onConnect,
  setToast,
}: {
  wallet: string;
  onConnect: () => Promise<void> | void;
  setToast: (value: string) => void;
}) {
  const { quotes } = useRealQuotes();
  const [symbol, setSymbol] = useState<SpotSymbol>('XAU');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('100');
  const [slippage, setSlippage] = useState('0.50');
  const [feeBps, setFeeBps] = useState(30);
  const [walletTusdc, setWalletTusdc] = useState('0');
  const [assetBalance, setAssetBalance] = useState('0');
  const [vaultAvailable, setVaultAvailable] = useState('0');
  const [vaultLocked, setVaultLocked] = useState('0');
  const [gasBalance, setGasBalance] = useState('0');
  const [poolTusdc, setPoolTusdc] = useState('0');
  const [vaultMoveAmount, setVaultMoveAmount] = useState('100');
  const [busy, setBusy] = useState(false);

  const market = marketConfig(symbol);
  const quote = quotes[symbol];
  const meta = MARKET_META[symbol];
  const deployed = isDeployed(symbol);

  const output = useMemo(() => {
    const input = Number(amount);
    const price = quote?.price;
    if (!Number.isFinite(input) || input <= 0 || !price) return 0;
    const feeFactor = 1 - feeBps / 10_000;
    return side === 'buy'
      ? (input * feeFactor) / price
      : input * price * feeFactor;
  }, [amount, quote?.price, side, feeBps]);

  async function refreshBalances() {
    if (!wallet || !market || !deployed) return;
    try {
      const { bp } = await freshWallet();
      const quoteToken = new Contract(
        (spotDeployment as any).quoteToken,
        TEST_USDC_ABI,
        bp,
      );
      const asset = new Contract(market.token, SYNTH_ABI, bp);
      const pool = new Contract(market.pool, SPOT_POOL_ABI, bp);
      const vaultAddress = (perpDeployment as any)?.contracts?.marginVault;
      const vault = vaultAddress
        ? new Contract(vaultAddress, PERP_VAULT_ABI, bp)
        : null;

      const [tusdc, assetRaw, fee, gas, av, lk, poolRaw] = await Promise.all([
        quoteToken.balanceOf(wallet) as Promise<bigint>,
        asset.balanceOf(wallet) as Promise<bigint>,
        pool.feeBps() as Promise<bigint>,
        bp.getBalance(wallet),
        vault ? (vault.available(wallet) as Promise<bigint>) : Promise.resolve(0n),
        vault ? (vault.locked(wallet) as Promise<bigint>) : Promise.resolve(0n),
        quoteToken.balanceOf(market.pool) as Promise<bigint>,
      ]);

      setWalletTusdc(formatUnits(tusdc, 6));
      setAssetBalance(formatUnits(assetRaw, 18));
      setFeeBps(Number(fee));
      setGasBalance(formatEther(gas));
      setVaultAvailable(formatUnits(av, 6));
      setVaultLocked(formatUnits(lk, 6));
      setPoolTusdc(formatUnits(poolRaw, 6));
    } catch (error) {
      console.warn('[Custos spot balance]', error);
    }
  }

  useEffect(() => {
    void refreshBalances();
    const timer = window.setInterval(refreshBalances, 5_000);
    return () => window.clearInterval(timer);
  }, [wallet, symbol, deployed]);

  async function faucet() {
    if (!wallet) {
      await onConnect();
      return;
    }
    try {
      setBusy(true);
      const { signer } = await freshWallet();
      const quoteToken = new Contract(
        (spotDeployment as any).quoteToken,
        TEST_USDC_ABI,
        signer,
      );
      const nextAt = Number(await quoteToken.nextFaucetAt(wallet));
      if (nextAt > Math.floor(Date.now() / 1000)) {
        throw new Error('tUSDC faucet is still in its 24-hour cooldown.');
      }
      const tx = await quoteToken.faucet({ gasLimit: 180_000n });
      setToast('tUSDC faucet submitted…');
      await tx.wait();
      setToast('10,000 tUSDC received. The same token works in Spot and Perpetuals.');
      void writeActivity(wallet, 'faucet', 'Claimed 10,000 shared tUSDC.', tx.hash);
      await refreshBalances();
    } catch (error: any) {
      setToast(error?.shortMessage || error?.message || 'Faucet failed.');
    } finally {
      setBusy(false);
    }
  }

  async function moveTusdc(direction: 'toVault' | 'toWallet') {
    if (!wallet) {
      await onConnect();
      return;
    }

    const vaultAddress = (perpDeployment as any)?.contracts?.marginVault;
    const quoteTokenAddress = (spotDeployment as any).quoteToken as string;

    if (!vaultAddress || vaultAddress === ZERO) {
      setToast('Perpetual MarginVault is not configured.');
      return;
    }

    const amountRaw = Number(vaultMoveAmount);
    if (!Number.isFinite(amountRaw) || amountRaw <= 0) {
      setToast('Enter a tUSDC amount greater than zero.');
      return;
    }

    try {
      setBusy(true);
      const { signer } = await freshWallet();
      const amount = parseUnits(vaultMoveAmount, 6);
      const vault = new Contract(vaultAddress, PERP_VAULT_ABI, signer);

      if (direction === 'toVault') {
        await ensureApproval(
          quoteTokenAddress,
          vaultAddress,
          amount,
          signer,
          TEST_USDC_ABI,
        );
        setToast(`Moving ${vaultMoveAmount} tUSDC to Perpetuals collateral…`);
        const tx = await vault.deposit(amount, { gasLimit: 240_000n });
        await tx.wait();
        setToast(`${vaultMoveAmount} tUSDC is now available as Perpetuals collateral.`);
      } else {
        setToast(`Returning ${vaultMoveAmount} tUSDC from Perpetuals to Spot wallet…`);
        const tx = await vault.withdraw(amount, { gasLimit: 220_000n });
        await tx.wait();
        setToast(`${vaultMoveAmount} tUSDC returned to your wallet for Spot trading.`);
      }

      await refreshBalances();
    } catch (error: any) {
      setToast(
        error?.shortMessage ||
          error?.reason ||
          error?.message ||
          'tUSDC transfer failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    if (!wallet) {
      await onConnect();
      return;
    }
    if (!market || !deployed) {
      setToast('Spot contracts are not deployed yet.');
      return;
    }
    if (!quote?.price) {
      setToast(`${symbol} reference price is not ready.`);
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setToast('Enter an amount greater than zero.');
      return;
    }

    try {
      setBusy(true);
      const { signer, address } = await freshWallet();
      const pool = new Contract(market.pool, SPOT_POOL_ABI, signer);
      const update = await getUpdate(symbol);
      const updateData = update.updateData as string[];
      const oracleFee = (await pool.getUpdateFee(updateData)) as bigint;
      const slipBps = Math.max(
        1,
        Math.min(2_000, Math.round(Number(slippage || '0.5') * 100)),
      );

      let tx: any;

      if (side === 'buy') {
        const quoteIn = parseUnits(amount, 6);
        const expected = parseUnits(output.toFixed(18), 18);
        const minOut = (expected * BigInt(10_000 - slipBps)) / 10_000n;
        await ensureApproval(
          (spotDeployment as any).quoteToken,
          market.pool,
          quoteIn,
          signer,
          TEST_USDC_ABI,
        );
        setToast(`Confirm BUY ${meta.token} in your wallet…`);
        tx = await pool.buyExactQuote(quoteIn, minOut, updateData, {
          value: oracleFee,
          gasLimit: 1_100_000n,
        });
      } else {
        const assetIn = parseUnits(amount, 18);
        const expected = parseUnits(output.toFixed(6), 6);
        const minOut = (expected * BigInt(10_000 - slipBps)) / 10_000n;
        await ensureApproval(
          market.token,
          market.pool,
          assetIn,
          signer,
          SYNTH_ABI,
        );
        setToast(`Confirm SELL ${meta.token} in your wallet…`);
        tx = await pool.sellExactAsset(assetIn, minOut, updateData, {
          value: oracleFee,
          gasLimit: 1_100_000n,
        });
      }

      setToast(`Spot transaction submitted: ${tx.hash}`);
      await tx.wait();
      setToast(
        `${side === 'buy' ? 'Bought' : 'Sold'} ${meta.token} at the Pyth-anchored reference price.`,
      );
      void writeActivity(
        address,
        'swap',
        `${side === 'buy' ? 'Bought' : 'Sold'} ${meta.token} in the ${symbol}/tUSDC oracle-priced spot market.`,
        tx.hash,
      );
      await refreshBalances();
    } catch (error: any) {
      setToast(error?.shortMessage || error?.reason || error?.message || 'Spot trade failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fade-up space-y-5">
      <section className="rounded-[26px] border border-white/[.1] bg-white/[.025] p-6 md:p-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[11px] font-semibold tracking-[.15em] text-emerald-300">
              PYTH-ANCHORED SPOT
            </p>
            <h1 className="mt-2 text-[44px] font-semibold tracking-[-.065em]">
              Real-price synthetic spot markets.
            </h1>
            <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-white/48">
              Buy or sell testnet rXAU, rXAG and rWTI against the same tUSDC used by
              the Perpetuals MarginVault. Execution is anchored to a fresh Pyth Core update.
            </p>
          </div>
          <button
            type="button"
            onClick={faucet}
            disabled={busy}
            className="primary-button inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-[12px] font-semibold disabled:opacity-50"
          >
            <CircleDollarSign size={15} /> Faucet 10,000 tUSDC
          </button>
        </div>
      </section>

      <MarketSelector symbol={symbol} setSymbol={setSymbol} quotes={quotes} />

      <section className="grid gap-4 xl:grid-cols-[1fr_390px]">
        <div className="giwa-panel overflow-hidden rounded-[24px] p-5 md:p-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <MiniStat label="Wallet tUSDC" value={fmt(Number(walletTusdc))} />
            <MiniStat label="Perp Vault available" value={fmt(Number(vaultAvailable))} />
            <MiniStat label="Perp locked margin" value={fmt(Number(vaultLocked))} />
            <MiniStat
              label="Your total tUSDC"
              value={fmt(
                Number(walletTusdc) + Number(vaultAvailable) + Number(vaultLocked),
              )}
            />
            <MiniStat label="Spot pool tUSDC" value={fmt(Number(poolTusdc))} />
          </div>

          <div className="mt-4 grid gap-3 rounded-2xl border border-emerald-300/12 bg-emerald-300/[.025] p-4 lg:grid-cols-[1fr_auto_auto_auto] lg:items-end">
            <label className="block text-[10px] text-white/42">
              Shared tUSDC amount
              <input
                value={vaultMoveAmount}
                onChange={(event) => setVaultMoveAmount(event.target.value)}
                inputMode="decimal"
                className="mt-2 h-11 w-full rounded-xl border border-white/[.09] bg-black/15 px-3 font-mono outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => void moveTusdc('toVault')}
              disabled={busy || !wallet}
              className="secondary-button h-11 rounded-xl px-4 text-[11px] font-semibold disabled:opacity-40"
            >
              Wallet → Perp Vault
            </button>
            <button
              type="button"
              onClick={() => void moveTusdc('toWallet')}
              disabled={busy || !wallet}
              className="secondary-button h-11 rounded-xl px-4 text-[11px] font-semibold disabled:opacity-40"
            >
              Perp Vault → Wallet
            </button>
            <a
              href="#/defi?tab=perpetuals"
              target="_blank"
              rel="noopener noreferrer"
              className="primary-button flex h-11 items-center justify-center rounded-xl px-4 text-[11px] font-semibold"
            >
              Open Perpetuals ↗
            </a>
          </div>

          <div className="mt-3 flex items-center justify-between text-[9px] text-white/30">
            <span>Wallet tUSDC trades Spot; Vault tUSDC backs Perpetuals.</span>
            <span>Gas {fmt(Number(gasBalance), 5)} ETH</span>
          </div>

          <div className="mt-6 overflow-hidden rounded-2xl border border-white/[.08] bg-[#06131c]">
            <div className="relative h-[230px] bg-[radial-gradient(circle_at_70%_20%,rgba(108,255,170,.12),transparent_38%),linear-gradient(135deg,#071a18,#07131e)]">
              <img
                src={meta.image}
                alt={meta.title}
                referrerPolicy="no-referrer"
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover opacity-55"
                onError={(event) => {
                  event.currentTarget.style.display = 'none';
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#06131c] via-[#06131c]/25 to-transparent" />
              <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between gap-4">
                <div>
                  <p className="text-[10px] font-semibold tracking-[.14em] text-emerald-200">
                    {symbol} / USD · PYTH CORE
                  </p>
                  <h2 className="mt-1 text-[30px] font-medium">{meta.title}</h2>
                </div>
                <div className="text-right">
                  <strong className="text-[28px]">${fmt(quote?.price)}</strong>
                  <p className="mt-1 text-[9px] text-emerald-200">
                    {quote?.fresh ? 'LIVE REFERENCE' : 'REFERENCE'}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 p-5 sm:grid-cols-3">
              <MiniStat label="Synthetic token" value={meta.token} />
              <MiniStat label="Your balance" value={fmt(Number(assetBalance), 6)} />
              <MiniStat label="Trading fee" value={`${(feeBps / 100).toFixed(2)}%`} />
            </div>
          </div>
        </div>

        <aside className="giwa-panel rounded-[24px] p-5">
          <div className="grid grid-cols-2 rounded-xl border border-white/[.08] p-1">
            <button
              type="button"
              onClick={() => setSide('buy')}
              className={`rounded-lg py-3 text-[12px] font-semibold ${
                side === 'buy' ? 'bg-emerald-300/14 text-emerald-200' : 'text-white/40'
              }`}
            >
              Buy {meta.token}
            </button>
            <button
              type="button"
              onClick={() => setSide('sell')}
              className={`rounded-lg py-3 text-[12px] font-semibold ${
                side === 'sell' ? 'bg-rose-300/10 text-rose-200' : 'text-white/40'
              }`}
            >
              Sell {meta.token}
            </button>
          </div>

          <label className="mt-5 block text-[10px] text-white/45">
            You pay ({side === 'buy' ? 'tUSDC' : meta.token})
            <div className="mt-2 flex items-center rounded-xl border border-white/[.1] bg-black/15 px-4">
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                className="h-14 min-w-0 flex-1 bg-transparent font-mono text-[20px] outline-none"
              />
              <span className="text-[10px] text-white/38">
                {side === 'buy' ? 'tUSDC' : meta.token}
              </span>
            </div>
          </label>

          <div className="mt-4 rounded-xl border border-white/[.08] bg-white/[.02] p-4">
            <div className="flex items-center justify-between text-[10px] text-white/42">
              <span>Estimated receive</span>
              <strong className="font-mono text-[15px] text-white">
                {fmt(output, 6)} {side === 'buy' ? meta.token : 'tUSDC'}
              </strong>
            </div>
            <div className="mt-3 flex items-center justify-between text-[10px] text-white/42">
              <span>Pyth reference</span>
              <span>${fmt(quote?.price)}</span>
            </div>
            <div className="mt-3 flex items-center justify-between text-[10px] text-white/42">
              <span>Fee</span>
              <span>{(feeBps / 100).toFixed(2)}%</span>
            </div>
          </div>

          <label className="mt-4 block text-[10px] text-white/42">
            Slippage tolerance
            <div className="mt-2 flex items-center rounded-xl border border-white/[.09] px-3">
              <input
                value={slippage}
                onChange={(event) => setSlippage(event.target.value)}
                className="h-11 min-w-0 flex-1 bg-transparent font-mono outline-none"
              />
              <span>%</span>
            </div>
          </label>

          <button
            type="button"
            disabled={busy || !deployed || Number(poolTusdc) <= 0}
            onClick={execute}
            className="primary-button mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-4 text-[14px] font-semibold disabled:opacity-40"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowLeftRight size={16} />}
            {!deployed
              ? 'Deploy Spot Contracts First'
              : Number(poolTusdc) <= 0
                ? 'Seed Liquidity First'
                : !wallet
                  ? 'Connect Wallet'
                  : `${side === 'buy' ? 'Buy' : 'Sell'} ${meta.token}`}
          </button>

          <p className="mt-4 text-[10px] leading-relaxed text-white/34">
            Synthetic testnet asset. It tracks a real Pyth reference price but has no
            claim on physical gold, silver, oil, shares, custody or redemption value.
          </p>
        </aside>
      </section>
    </div>
  );
}

export function SpotLiquidityPage({
  wallet,
  onConnect,
  setToast,
}: {
  wallet: string;
  onConnect: () => Promise<void> | void;
  setToast: (value: string) => void;
}) {
  const { quotes } = useRealQuotes();
  const [symbol, setSymbol] = useState<SpotSymbol>('XAU');
  const [deposit, setDeposit] = useState('500');
  const [removeLp, setRemoveLp] = useState('0');
  const [busy, setBusy] = useState(false);
  const [walletTusdc, setWalletTusdc] = useState('0');
  const [lpBalance, setLpBalance] = useState('0');
  const [state, setState] = useState<{
    quoteBalance: string;
    liability: string;
    equity: string;
    collateral: string;
    syntheticSupply: string;
    lpSupply: string;
    totalFees: string;
  } | null>(null);

  const market = marketConfig(symbol);
  const deployed = isDeployed(symbol);

  async function refresh() {
    if (!wallet || !market || !deployed) return;
    try {
      const { bp } = await freshWallet();
      const quote = new Contract(
        (spotDeployment as any).quoteToken,
        TEST_USDC_ABI,
        bp,
      );
      const pool = new Contract(market.pool, SPOT_POOL_ABI, bp);
      const [walletRaw, lpRaw] = await Promise.all([
        quote.balanceOf(wallet) as Promise<bigint>,
        pool.balanceOf(wallet) as Promise<bigint>,
      ]);
      setWalletTusdc(formatUnits(walletRaw, 6));
      setLpBalance(formatUnits(lpRaw, 18));

      try {
        const [s, fees] = await Promise.all([
          pool.getPoolState(),
          pool.totalFeesQuote() as Promise<bigint>,
        ]);
        setState({
          quoteBalance: formatUnits(s[1], 6),
          liability: formatUnits(s[2], 6),
          equity: formatUnits(s[3], 6),
          collateral:
            s[4] > 10_000_000n ? '∞' : `${(Number(s[4]) / 100).toFixed(2)}%`,
          syntheticSupply: formatUnits(s[5], 18),
          lpSupply: formatUnits(s[6], 18),
          totalFees: formatUnits(fees, 6),
        });
      } catch {
        setState(null);
      }
    } catch (error) {
      console.warn('[Custos liquidity refresh]', error);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => window.clearInterval(timer);
  }, [wallet, symbol, deployed]);

  async function add() {
    if (!wallet) {
      await onConnect();
      return;
    }
    if (!market || !deployed) {
      setToast('Spot contracts are not deployed yet.');
      return;
    }
    try {
      setBusy(true);
      const { signer, address } = await freshWallet();
      const amount = parseUnits(deposit, 6);
      const pool = new Contract(market.pool, SPOT_POOL_ABI, signer);
      await ensureApproval(
        (spotDeployment as any).quoteToken,
        market.pool,
        amount,
        signer,
        TEST_USDC_ABI,
      );
      const update = await getUpdate(symbol);
      const fee = (await pool.getUpdateFee(update.updateData)) as bigint;
      const tx = await pool.addLiquidity(amount, 0n, update.updateData, {
        value: fee,
        gasLimit: 1_100_000n,
      });
      setToast(`Adding ${deposit} tUSDC liquidity to ${symbol}…`);
      await tx.wait();
      setToast(`${symbol} liquidity added. LP shares are in your wallet.`);
      void writeActivity(
        address,
        'add_liquidity',
        `Added ${deposit} tUSDC to the ${symbol} synthetic spot liquidity pool.`,
        tx.hash,
      );
      await refresh();
    } catch (error: any) {
      setToast(error?.shortMessage || error?.reason || error?.message || 'Add liquidity failed.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!wallet) {
      await onConnect();
      return;
    }
    if (!market || !deployed) return;
    try {
      setBusy(true);
      const { signer, address } = await freshWallet();
      const lp = parseUnits(removeLp, 18);
      const pool = new Contract(market.pool, SPOT_POOL_ABI, signer);
      const update = await getUpdate(symbol);
      const fee = (await pool.getUpdateFee(update.updateData)) as bigint;
      const tx = await pool.removeLiquidity(lp, 0n, update.updateData, {
        value: fee,
        gasLimit: 1_100_000n,
      });
      setToast(`Removing ${removeLp} LP from ${symbol}…`);
      await tx.wait();
      setToast(`${symbol} liquidity removed.`);
      void writeActivity(
        address,
        'remove_liquidity',
        `Removed ${removeLp} LP shares from the ${symbol} synthetic spot pool.`,
        tx.hash,
      );
      await refresh();
    } catch (error: any) {
      setToast(error?.shortMessage || error?.reason || error?.message || 'Remove liquidity failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fade-up space-y-5">
      <section className="rounded-[26px] border border-white/[.1] bg-white/[.025] p-6 md:p-8">
        <p className="text-[11px] font-semibold tracking-[.15em] text-emerald-300">
          ONE-SIDED tUSDC LIQUIDITY
        </p>
        <h1 className="mt-2 text-[44px] font-semibold tracking-[-.065em]">
          Provide liquidity. Earn spot fees.
        </h1>
        <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-white/48">
          LPs deposit only tUSDC. The pool mints/burns synthetic RWA units against a
          fresh Pyth price and keeps trading fees inside pool equity. LPs also carry
          synthetic market risk, so withdrawals are constrained by the collateral ratio.
        </p>
      </section>

      <MarketSelector symbol={symbol} setSymbol={setSymbol} quotes={quotes} />

      <section className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <div className="giwa-panel rounded-[24px] p-5 md:p-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <MiniStat label="Pool tUSDC" value={state ? fmt(Number(state.quoteBalance)) : '—'} />
            <MiniStat label="Synthetic liability" value={state ? fmt(Number(state.liability)) : '—'} />
            <MiniStat label="LP equity" value={state ? fmt(Number(state.equity)) : '—'} />
            <MiniStat label="Trading fees accrued" value={state ? `${fmt(Number(state.totalFees))} tUSDC` : '—'} />
            <MiniStat label="Collateral ratio" value={state?.collateral || '—'} />
            <MiniStat label="Synthetic supply" value={state ? fmt(Number(state.syntheticSupply), 6) : '—'} />
            <MiniStat label="Your LP shares" value={fmt(Number(lpBalance), 6)} />
          </div>

          <div className="mt-6 rounded-2xl border border-emerald-300/12 bg-emerald-300/[.035] p-5 text-[11px] leading-relaxed text-white/48">
            <strong className="text-emerald-100">How fees work:</strong> every buy/sell
            charges the pool fee. The fee stays in tUSDC pool equity, so LP share value
            can grow from trading activity. Price movement in the synthetic liability can
            also increase or decrease LP equity.
          </div>
        </div>

        <aside className="giwa-panel rounded-[24px] p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-white/40">Wallet balance</p>
              <strong className="mt-1 block text-[20px]">{fmt(Number(walletTusdc))} tUSDC</strong>
            </div>
            <Droplets size={20} className="text-emerald-300" />
          </div>

          <label className="mt-5 block text-[10px] text-white/42">
            Add tUSDC
            <input
              value={deposit}
              onChange={(event) => setDeposit(event.target.value)}
              className="mt-2 h-13 w-full rounded-xl border border-white/[.09] bg-black/15 px-4 font-mono outline-none"
            />
          </label>
          <button
            type="button"
            onClick={add}
            disabled={busy || !deployed}
            className="primary-button mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-[12px] font-semibold disabled:opacity-40"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Droplets size={15} />}
            Add Liquidity
          </button>

          <div className="my-5 border-t border-white/[.08]" />

          <label className="block text-[10px] text-white/42">
            Remove LP shares
            <input
              value={removeLp}
              onChange={(event) => setRemoveLp(event.target.value)}
              className="mt-2 h-13 w-full rounded-xl border border-white/[.09] bg-black/15 px-4 font-mono outline-none"
            />
          </label>
          <button
            type="button"
            onClick={remove}
            disabled={busy || !deployed}
            className="secondary-button mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-[12px] font-semibold disabled:opacity-40"
          >
            Remove Liquidity
          </button>
        </aside>
      </section>
    </div>
  );
}


type PortfolioAsset = {
  symbol: SpotSymbol;
  token: string;
  tokenBalance: number;
  tokenValue: number;
  lpBalance: number;
  lpValue: number;
  referencePrice: number;
};

type PortfolioActivity = {
  id?: number;
  action?: string;
  summary?: string;
  tx_hash?: string;
  created_at?: string;
};

export function SpotPortfolioPage({
  wallet,
  onConnect,
  setToast,
}: {
  wallet: string;
  onConnect: () => Promise<void> | void;
  setToast: (value: string) => void;
}) {
  const { quotes } = useRealQuotes();
  const [walletTusdc, setWalletTusdc] = useState(0);
  const [vaultAvailable, setVaultAvailable] = useState(0);
  const [vaultLocked, setVaultLocked] = useState(0);
  const [gasBalance, setGasBalance] = useState(0);
  const [assets, setAssets] = useState<PortfolioAsset[]>([]);
  const [activity, setActivity] = useState<PortfolioActivity[]>([]);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    if (!wallet) {
      setWalletTusdc(0);
      setVaultAvailable(0);
      setVaultLocked(0);
      setGasBalance(0);
      setAssets([]);
      setActivity([]);
      return;
    }

    try {
      setLoading(true);
      const { bp } = await freshWallet();
      const quoteToken = new Contract(
        (spotDeployment as any).quoteToken,
        TEST_USDC_ABI,
        bp,
      );

      const vaultAddress =
        (perpDeployment as any)?.contracts?.marginVault as string | undefined;
      const vault =
        vaultAddress && vaultAddress !== ZERO
          ? new Contract(vaultAddress, PERP_VAULT_ABI, bp)
          : null;

      const [walletRaw, availableRaw, lockedRaw, gasRaw] = await Promise.all([
        quoteToken.balanceOf(wallet) as Promise<bigint>,
        vault
          ? (vault.available(wallet) as Promise<bigint>)
          : Promise.resolve(0n),
        vault
          ? (vault.locked(wallet) as Promise<bigint>)
          : Promise.resolve(0n),
        bp.getBalance(wallet),
      ]);

      setWalletTusdc(Number(formatUnits(walletRaw, 6)));
      setVaultAvailable(Number(formatUnits(availableRaw, 6)));
      setVaultLocked(Number(formatUnits(lockedRaw, 6)));
      setGasBalance(Number(formatEther(gasRaw)));

      const nextAssets = await Promise.all(
        MARKET_ORDER.map(async (symbol): Promise<PortfolioAsset> => {
          const market = marketConfig(symbol);
          const referencePrice = Number(quotes[symbol]?.price || 0);

          if (!market || !isDeployed(symbol)) {
            return {
              symbol,
              token: MARKET_META[symbol].token,
              tokenBalance: 0,
              tokenValue: 0,
              lpBalance: 0,
              lpValue: 0,
              referencePrice,
            };
          }

          try {
            const asset = new Contract(market.token, SYNTH_ABI, bp);
            const pool = new Contract(market.pool, SPOT_POOL_ABI, bp);

            const [assetRaw, lpRaw, poolState] = await Promise.all([
              asset.balanceOf(wallet) as Promise<bigint>,
              pool.balanceOf(wallet) as Promise<bigint>,
              pool.getPoolState(),
            ]);

            const assetAmount = Number(formatUnits(assetRaw, 18));
            const lpAmount = Number(formatUnits(lpRaw, 18));
            const equityRaw = poolState[3] as bigint;
            const lpSupplyRaw = poolState[6] as bigint;
            const lpValueRaw =
              lpSupplyRaw > 0n
                ? (lpRaw * equityRaw) / lpSupplyRaw
                : 0n;

            return {
              symbol,
              token: MARKET_META[symbol].token,
              tokenBalance: assetAmount,
              tokenValue: assetAmount * referencePrice,
              lpBalance: lpAmount,
              lpValue: Number(formatUnits(lpValueRaw, 6)),
              referencePrice,
            };
          } catch {
            return {
              symbol,
              token: MARKET_META[symbol].token,
              tokenBalance: 0,
              tokenValue: 0,
              lpBalance: 0,
              lpValue: 0,
              referencePrice,
            };
          }
        }),
      );

      setAssets(nextAssets);

      try {
        const response = await fetch(
          `${API_BASE}/api/portfolio/${wallet}`,
          { cache: 'no-store' },
        );
        if (response.ok) {
          const body = await response.json();
          setActivity(
            Array.isArray(body.activity)
              ? body.activity.slice(0, 8)
              : [],
          );
        }
      } catch {
        // Activity log is optional.
      }
    } catch (error: any) {
      setToast(
        error?.shortMessage ||
          error?.message ||
          'Could not refresh unified portfolio.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => window.clearInterval(timer);
  }, [
    wallet,
    quotes.XAU?.price,
    quotes.XAG?.price,
    quotes.OIL?.price,
  ]);

  const spotValue = assets.reduce(
    (sum, row) => sum + row.tokenValue,
    0,
  );
  const lpValue = assets.reduce(
    (sum, row) => sum + row.lpValue,
    0,
  );
  const totalTestEquity =
    walletTusdc +
    vaultAvailable +
    vaultLocked +
    spotValue +
    lpValue;

  if (!wallet) {
    return (
      <div className="fade-up">
        <section className="giwa-panel rounded-[26px] p-8 text-center">
          <Wallet
            size={28}
            className="mx-auto text-emerald-300"
          />
          <h1 className="mt-4 text-[38px] font-semibold tracking-[-.06em]">
            Unified portfolio
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-[13px] leading-relaxed text-white/45">
            Connect one GIWA wallet to see shared tUSDC, Spot synthetic holdings,
            LP equity and Perpetuals collateral in one place.
          </p>
          <button
            type="button"
            onClick={() => void onConnect()}
            className="primary-button mt-6 rounded-xl px-5 py-3 text-[12px] font-semibold"
          >
            Connect Wallet
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="fade-up space-y-5">
      <section className="rounded-[26px] border border-white/[.1] bg-white/[.025] p-6 md:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold tracking-[.15em] text-emerald-300">
              UNIFIED PORTFOLIO
            </p>
            <h1 className="mt-2 text-[44px] font-semibold tracking-[-.065em]">
              Spot, LP and Perpetuals. One wallet.
            </h1>
            <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-white/48">
              Test equity combines wallet tUSDC, MarginVault collateral, oracle-priced
              synthetic holdings and your share of Spot LP equity.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="secondary-button inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-[11px] font-semibold disabled:opacity-50"
          >
            <RefreshCw
              size={14}
              className={loading ? 'animate-spin' : ''}
            />
            Refresh
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MiniStat
          label="Total test equity"
          value={`${fmt(totalTestEquity)} tUSDC`}
        />
        <MiniStat
          label="Wallet tUSDC"
          value={`${fmt(walletTusdc)} tUSDC`}
        />
        <MiniStat
          label="Perp collateral"
          value={`${fmt(vaultAvailable + vaultLocked)} tUSDC`}
        />
        <MiniStat
          label="Spot + LP value"
          value={`${fmt(spotValue + lpValue)} tUSDC`}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="giwa-panel rounded-[24px] p-5 md:p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold tracking-[.12em] text-emerald-200">
                REAL-ASSET EXPOSURE
              </p>
              <h2 className="mt-2 text-[27px] font-medium tracking-[-.04em]">
                Your synthetic Spot + LP positions
              </h2>
            </div>
            <TrendingUp
              size={20}
              className="text-emerald-300"
            />
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead className="text-[9px] uppercase tracking-[.1em] text-white/30">
                <tr className="border-b border-white/[.08]">
                  <th className="pb-3">Market</th>
                  <th className="pb-3">Reference</th>
                  <th className="pb-3">Token balance</th>
                  <th className="pb-3">Token value</th>
                  <th className="pb-3">LP shares</th>
                  <th className="pb-3">LP value</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((row) => (
                  <tr
                    key={row.symbol}
                    className="border-b border-white/[.06] text-[11px] last:border-0"
                  >
                    <td className="py-4">
                      <strong>{MARKET_META[row.symbol].title}</strong>
                      <span className="ml-2 font-mono text-white/35">
                        {row.symbol}
                      </span>
                    </td>
                    <td className="py-4 font-mono">
                      ${fmt(row.referencePrice)}
                    </td>
                    <td className="py-4 font-mono">
                      {fmt(row.tokenBalance, 6)} {row.token}
                    </td>
                    <td className="py-4 font-mono">
                      {fmt(row.tokenValue)} tUSDC
                    </td>
                    <td className="py-4 font-mono">
                      {fmt(row.lpBalance, 6)}
                    </td>
                    <td className="py-4 font-mono">
                      {fmt(row.lpValue)} tUSDC
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <a
              href="#/defi?tab=spot"
              className="primary-button flex items-center justify-center rounded-xl px-4 py-3 text-[11px] font-semibold"
            >
              Trade Spot
            </a>
            <a
              href="#/defi?tab=liquidity"
              className="secondary-button flex items-center justify-center rounded-xl px-4 py-3 text-[11px] font-semibold"
            >
              Manage Liquidity
            </a>
            <a
              href="#/defi?tab=perpetuals"
              target="_blank"
              rel="noopener noreferrer"
              className="secondary-button flex items-center justify-center rounded-xl px-4 py-3 text-[11px] font-semibold"
            >
              Open Perpetuals ↗
            </a>
          </div>
        </div>

        <aside className="giwa-panel rounded-[24px] p-5">
          <p className="text-[10px] font-semibold tracking-[.12em] text-emerald-200">
            BALANCE BREAKDOWN
          </p>
          <div className="mt-4 space-y-3">
            <MiniStat
              label="Perp Vault available"
              value={`${fmt(vaultAvailable)} tUSDC`}
            />
            <MiniStat
              label="Perp locked margin"
              value={`${fmt(vaultLocked)} tUSDC`}
            />
            <MiniStat
              label="Spot token value"
              value={`${fmt(spotValue)} tUSDC`}
            />
            <MiniStat
              label="LP equity value"
              value={`${fmt(lpValue)} tUSDC`}
            />
            <MiniStat
              label="Gas"
              value={`${fmt(gasBalance, 5)} ETH`}
            />
          </div>
        </aside>
      </section>

      <section className="giwa-panel rounded-[24px] p-5 md:p-6">
        <p className="text-[10px] font-semibold tracking-[.12em] text-emerald-200">
          RECENT ONCHAIN ACTIVITY
        </p>
        <div className="mt-4 space-y-0">
          {activity.length ? (
            activity.map((row, index) => (
              <div
                key={`${row.id || index}-${row.tx_hash || ''}`}
                className="flex flex-col gap-1 border-b border-white/[.06] py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <strong className="text-[11px]">
                    {row.summary || row.action || 'Onchain activity'}
                  </strong>
                  <p className="mt-1 text-[9px] text-white/30">
                    {row.created_at || ''}
                  </p>
                </div>
                {row.tx_hash ? (
                  <a
                    href={`${GIWA_EXPLORER}/tx/${row.tx_hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[9px] text-emerald-200"
                  >
                    {short(row.tx_hash)} ↗
                  </a>
                ) : null}
              </div>
            ))
          ) : (
            <p className="py-4 text-[11px] text-white/35">
              No recorded Spot or liquidity activity yet.
            </p>
          )}
        </div>
      </section>

      <p className="text-[10px] leading-relaxed text-white/28">
        “Total test equity” is a testnet accounting view. Synthetic tokens are not
        redeemable for physical gold, silver or oil, and tUSDC has no cash redemption value.
      </p>
    </div>
  );
}

export function SpotTransparencyPage() {
  const quote = (spotDeployment as any).quoteToken as string;
  const oracle = (spotDeployment as any).oracleRouter as string;

  return (
    <div className="fade-up space-y-5">
      <section className="rounded-[26px] border border-white/[.1] bg-white/[.025] p-6 md:p-8">
        <p className="text-[11px] font-semibold tracking-[.15em] text-emerald-300">
          TRANSPARENCY
        </p>
        <h1 className="mt-2 text-[44px] font-semibold tracking-[-.065em]">
          One tUSDC. Two trading systems.
        </h1>
        <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-white/48">
          The same testnet tUSDC contract is the quote asset for RWA Spot and the collateral
          token for Perpetuals. Market prices come from Pyth; synthetic tokens remain testnet-only.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <ContractCard title="Shared tUSDC" address={quote} note="Spot quote + Perp collateral" />
        <ContractCard title="Pyth Oracle Router" address={oracle} note="Shared onchain price adapter" />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        {MARKET_ORDER.map((symbol) => {
          const market = marketConfig(symbol);
          const meta = MARKET_META[symbol];
          return (
            <article key={symbol} className="giwa-panel rounded-[22px] p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold tracking-[.12em] text-emerald-200">
                    {symbol} · {meta.title}
                  </p>
                  <h3 className="mt-2 text-[22px] font-medium">{meta.token} / tUSDC</h3>
                </div>
                <ShieldCheck size={18} className="text-emerald-300" />
              </div>
              <div className="mt-5 space-y-3 text-[10px]">
                <AddressRow label="Synthetic token" value={market?.token || 'Not deployed'} />
                <AddressRow label="Spot pool" value={market?.pool || 'Not deployed'} />
                <AddressRow label="Pyth feed" value={market?.feedId || 'Resolved at deployment'} />
              </div>
              <p className="mt-5 text-[10px] leading-relaxed text-white/34">
                {meta.unit}. No physical custody, redemption or legal ownership is represented.
              </p>
            </article>
          );
        })}
      </section>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[.08] bg-white/[.018] p-4">
      <p className="text-[9px] uppercase tracking-[.1em] text-white/34">{label}</p>
      <strong className="mt-2 block font-mono text-[14px] text-white">{value}</strong>
    </div>
  );
}

function AddressRow({ label, value }: { label: string; value: string }) {
  const linked = value.startsWith('0x') && value.length === 42;
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/[.06] pb-3 last:border-0 last:pb-0">
      <span className="text-white/35">{label}</span>
      {linked ? (
        <a
          href={`${GIWA_EXPLORER}/address/${value}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-emerald-200"
        >
          {short(value)} <ExternalLink size={10} className="inline" />
        </a>
      ) : (
        <span className="max-w-[190px] break-all text-right font-mono text-white/65">{value}</span>
      )}
    </div>
  );
}

function ContractCard({
  title,
  address,
  note,
}: {
  title: string;
  address: string;
  note: string;
}) {
  return (
    <article className="giwa-panel rounded-[22px] p-5">
      <div className="flex items-center gap-2 text-emerald-300">
        <ShieldCheck size={16} />
        <span className="text-[10px] font-semibold tracking-[.12em]">{title}</span>
      </div>
      <p className="mt-4 font-mono text-[13px] text-white/75">{short(address)}</p>
      <p className="mt-2 text-[11px] text-white/38">{note}</p>
      {address && address !== ZERO && (
        <a
          href={`${GIWA_EXPLORER}/address/${address}`}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center gap-1 text-[10px] text-emerald-200"
        >
          Explorer <ArrowUpRight size={11} />
        </a>
      )}
    </article>
  );
}
