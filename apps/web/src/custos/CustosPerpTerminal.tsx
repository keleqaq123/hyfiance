import React, { Component, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CircleDollarSign,
  Droplets,
  ExternalLink,
  Gauge,
  Radio,
  ShieldCheck,
  Wallet,
  Zap,
} from 'lucide-react';
import {
  BrowserProvider,
  Contract,
  formatUnits,
  keccak256,
  parseUnits,
  toUtf8Bytes,
} from 'ethers-v6';
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

import deployment from './deployment.generated.json';
import {
  ENGINE_ABI,
  GIWA,
  ORACLE_ABI,
  TEST_USDC_ABI,
  VAULT_ABI,
  ZERO,
} from './perpContracts';
import { hasLivePythQuote, useMarketStream } from './useMarketStream';
import './perpTerminal.css';


type PositionView = {
  id: bigint;
  sizeUsd: bigint;
  margin: bigint;
  entryPrice: bigint;
  isLong: boolean;
  openedAt: bigint;
  takeProfit: bigint;
  stopLoss: bigint;
  liqPrice: number | null;
};

type Timeframe = '1m' | '5m' | '30m' | '2h' | '6h' | '1d';
type CandleColorMode = 'global' | 'china';

type HistoryCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
};

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '30m', '2h', '6h', '1d'];

const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '30m': 30 * 60_000,
  '2h': 2 * 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

function marketId(symbol: string) {
  return keccak256(toUtf8Bytes(`${symbol}-USD`));
}

function fmt(value?: number | null, digits = 2) {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: value < 10 ? Math.min(4, digits + 2) : 2,
    maximumFractionDigits: value < 10 ? Math.min(4, digits + 2) : digits,
  }).format(value);
}

function short(address?: string) {
  if (!address) return 'Connect';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function hasDeployment() {
  return (
    deployment.contracts.testUSDC !== ZERO &&
    deployment.contracts.perpEngine !== ZERO
  );
}


function errorText(error: any) {
  const candidates = [
    error?.info?.error?.message,
    error?.error?.message,
    error?.data?.message,
    error?.shortMessage,
    error?.reason,
    error?.message,
  ].filter(Boolean);

  let message = candidates[0] || String(error);

  if (/could not coalesce error/i.test(message)) {
    const nested =
      error?.info?.error ||
      error?.error ||
      error?.data ||
      error?.payload;

    if (nested) {
      try {
        message = `${message} | ${JSON.stringify(nested)}`;
      } catch {
        // keep the original message
      }
    }
  }

  if (/insufficient funds|insufficient balance|gas required exceeds allowance/i.test(message)) {
    return `Not enough ${GIWA.name} test ETH for gas. Get test ETH from https://faucet.giwa.io/ and try again.`;
  }

  if (/FAUCET_COOLDOWN/i.test(message)) {
    return 'tUSDC faucet is on its 24-hour cooldown for this wallet.';
  }

  return message;
}

class TerminalErrorBoundary extends Component<
  { children: ReactNode },
  { error: string }
> {
  state = { error: '' };

  static getDerivedStateFromError(error: unknown) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[Custos terminal render error]', error, info);
  }

  recover = () => {
    this.setState({ error: '' });
  };

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            background: '#04100b',
            color: '#d8e7df',
            display: 'grid',
            placeItems: 'center',
            padding: 24,
            fontFamily: 'IBM Plex Mono, monospace',
          }}
        >
          <div
            style={{
              width: 'min(620px, 92vw)',
              border: '1px solid rgba(118,233,173,.18)',
              background: '#07150f',
              padding: 24,
            }}
          >
            <div style={{ color: '#76e9ad', marginBottom: 10 }}>
              Custos terminal recovered from a UI error
            </div>
            <div
              style={{
                color: '#789087',
                fontSize: 12,
                lineHeight: 1.6,
                wordBreak: 'break-word',
              }}
            >
              {this.state.error}
            </div>
            <button
              onClick={this.recover}
              style={{
                marginTop: 18,
                border: '1px solid rgba(118,233,173,.35)',
                background: '#10261c',
                color: '#76e9ad',
                padding: '10px 14px',
                cursor: 'pointer',
              }}
            >
              Recover terminal
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function PerpTerminal({
  externalWallet = '',
  standalone = false,
}: {
  externalWallet?: string;
  standalone?: boolean;
}) {
  return (
    <div className={`perp-embed ${standalone ? 'standalone' : ''}`}>
      <TerminalErrorBoundary>
        <PerpTerminalApp
          externalWallet={externalWallet}
          standalone={standalone}
        />
      </TerminalErrorBoundary>
    </div>
  );
}

function PerpTerminalApp({
  externalWallet,
  standalone,
}: {
  externalWallet: string;
  standalone: boolean;
}) {
  const stream = useMarketStream();

  function savedReferralCode() {
    const incoming = new URLSearchParams(window.location.hash.split('?')[1] || '')
      .get('ref')
      ?.toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 32) || '';
    if (incoming) localStorage.setItem('custos_ref', incoming);
    return incoming || localStorage.getItem('custos_ref') || localStorage.getItem('kelq_ref') || '';
  }

  async function reportBetaAction(action: string, txHash: string) {
    if (!account || !txHash) return;
    try {
      await fetch(`${stream.apiBase}/api/beta/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: account,
          action,
          tx_hash: txHash,
          ref_code: savedReferralCode(),
        }),
      });
    } catch {
      // The trade is authoritative onchain; beta points can be retried later.
    }
  }

  const initialPerpSymbol = (() => {
    const requested =
      new URLSearchParams(window.location.hash.split('?')[1] || '')
        .get('symbol')
        ?.toUpperCase() || 'BTC';

    return ['BTC', 'ETH', 'SOL', 'AAPL', 'NVDA', 'XAU'].includes(requested)
      ? requested
      : 'BTC';
  })();

  const [symbol, setSymbol] = useState(initialPerpSymbol);
  const market = stream.bySymbol[symbol] || stream.markets[0];

  const [account, setAccount] = useState('');
  const [, setProvider] = useState<BrowserProvider | null>(null);
  const [walletBalance, setWalletBalance] = useState('0');
  const [available, setAvailable] = useState('0');
  const [locked, setLocked] = useState('0');
  const [nativeBalance, setNativeBalance] = useState('0');
  const [margin, setMargin] = useState('100');
  const [leverage, setLeverage] = useState(3);
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [positions, setPositions] = useState<PositionView[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingTxHash, setPendingTxHash] = useState('');

  const [timeframe, setTimeframe] = useState<Timeframe>('5m');
  const [candleColorMode, setCandleColorMode] = useState<CandleColorMode>('global');
  const [historyCandles, setHistoryCandles] = useState<Record<string, HistoryCandle[]>>({});
  const [historySources, setHistorySources] = useState<Record<string, string>>({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      setHistoryLoading(true);
      setHistoryError('');

      try {
        const response = await fetch(
          `${stream.apiBase}/api/history/${symbol}?resolution=${timeframe}&bars=300`,
          { cache: 'no-store' },
        );

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.detail?.message || 'Historical data provider is unavailable. Retry later.');
        }

        const body = await response.json();
        if (cancelled) return;

        setHistoryCandles((old) => ({
          ...old,
          [`${symbol}:${timeframe}`]: body.candles || [],
        }));
        setHistorySources((old) => ({
          ...old,
          [`${symbol}:${timeframe}`]: body.source === 'local-mock'
            ? 'LOCAL MOCK'
            : body.source === 'nasdaq'
              ? 'NASDAQ'
              : 'PYTH',
        }));
      } catch (error: any) {
        if (cancelled) return;
        setHistoryError(error?.message || String(error));
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, [symbol, timeframe, stream.apiBase]);


  const chartCandles = historyCandles[`${symbol}:${timeframe}`] || [];
  const chartHistorySource = historySources[`${symbol}:${timeframe}`] || 'PYTH';
  const chartChange = useMemo(() => {
    if (!chartCandles.length) return 0;
    const first = chartCandles[0].open;
    const last =
      market?.quote?.price ??
      chartCandles[chartCandles.length - 1]?.close ??
      first;
    return first ? ((last - first) / first) * 100 : 0;
  }, [chartCandles, market?.quote?.price]);

  function positionPnl(position: PositionView) {
    if (!market?.quote?.price || position.sizeUsd === 0n) return null;

    const entry = Number(formatUnits(position.entryPrice, 18));
    const notional = Number(formatUnits(position.sizeUsd, 18));
    const mark = market.quote.price;
    const diff =
      position.isLong
        ? mark - entry
        : entry - mark;

    return (notional * diff) / entry;
  }

  async function ensureChain() {
    const ethereum = window.ethereum;
    if (!ethereum) throw new Error('EVM wallet not found');

    const currentChain = await ethereum.request({ method: 'eth_chainId' });
    if (String(currentChain).toLowerCase() === GIWA.hexChainId.toLowerCase()) {
      return;
    }

    try {
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: GIWA.hexChainId }],
      });
    } catch (error: any) {
      if (error?.code !== 4902) throw error;

      await ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: GIWA.hexChainId,
          chainName: GIWA.name,
          rpcUrls: [GIWA.rpc],
          nativeCurrency: {
            name: 'Ether',
            symbol: 'ETH',
            decimals: 18,
          },
          blockExplorerUrls: [GIWA.explorer],
        }],
      });
    }
  }

  async function freshWallet(requestAccounts = false) {
    const ethereum = window.ethereum;
    if (!ethereum) throw new Error('Install an EVM wallet first.');

    if (requestAccounts) {
      await ethereum.request({ method: 'eth_requestAccounts' });
    }

    await ensureChain();

    // Re-create BrowserProvider after a chain switch so ethers never keeps a stale network.
    const bp = new BrowserProvider(ethereum);
    const network = await bp.getNetwork();

    if (Number(network.chainId) !== GIWA.chainId) {
      throw new Error(
        `Wrong network. Expected ${GIWA.name} ${GIWA.chainId}, got ${network.chainId.toString()}.`,
      );
    }

    const signer = await bp.getSigner();
    const address = await signer.getAddress();

    return { bp, signer, address };
  }

  async function validateDeployment(bp: BrowserProvider) {
    if (!hasDeployment()) throw new Error('Deploy contracts first');

    const entries = [
      ['tUSDC', deployment.contracts.testUSDC],
      ['MarginVault', deployment.contracts.marginVault],
      ['OracleRouter', deployment.contracts.oracleRouter],
      ['PerpEngine', deployment.contracts.perpEngine],
    ] as const;

    for (const [name, address] of entries) {
      const code = await bp.getCode(address);
      if (!code || code === '0x') {
        throw new Error(
          `${name} contract not found at ${address} on ${GIWA.name}. Check deployment.generated.json.`,
        );
      }
    }
  }

  async function connect() {
    try {
      const { bp, address } = await freshWallet(true);
      await validateDeployment(bp);

      setProvider(bp);
      setAccount(address);

      const gas = await bp.getBalance(address);
      setNativeBalance(formatUnits(gas, 18));

      setStatus(`Wallet connected · ${GIWA.name} ready`);
    } catch (error: any) {
      setStatus(errorText(error));
    }
  }

  useEffect(() => {
    if (!externalWallet) {
      if (!standalone) {
        setAccount('');
        return;
      }

      let cancelled = false;

      async function hydrateStandaloneWallet() {
        try {
          const ethereum = window.ethereum;
          if (!ethereum) return;

          const accounts = await ethereum.request({
            method: 'eth_accounts',
          }) as string[];

          if (cancelled || !accounts?.length) return;

          const { bp, address } = await freshWallet(false);
          if (cancelled) return;

          await validateDeployment(bp);
          if (cancelled) return;

          setProvider(bp);
          setAccount(address);

          const gas = await bp.getBalance(address);
          if (cancelled) return;

          setNativeBalance(formatUnits(gas, 18));
          setStatus(`Wallet restored · ${GIWA.name} ready`);
        } catch (error) {
          console.warn('[Custos standalone wallet hydrate]', error);
        }
      }

      void hydrateStandaloneWallet();

      return () => {
        cancelled = true;
      };
    }

    let cancelled = false;

    async function hydrateExternalWallet() {
      try {
        const { bp, address } = await freshWallet(false);
        if (cancelled) return;

        await validateDeployment(bp);
        if (cancelled) return;

        setProvider(bp);
        setAccount(address);

        const gas = await bp.getBalance(address);
        if (cancelled) return;

        setNativeBalance(formatUnits(gas, 18));
        setStatus(`Shared wallet synced · ${GIWA.name} ready`);
      } catch (error: any) {
        if (!cancelled) {
          setStatus(errorText(error));
        }
      }
    }

    void hydrateExternalWallet();

    return () => {
      cancelled = true;
    };
  }, [externalWallet, standalone]);

  async function contracts() {
    const { bp, signer, address } = await freshWallet(false);

    // Deployment bytecode is validated once when the wallet connects.
    // Repeating four getCode RPC calls before every action caused avoidable stalls.
    // Keep React state synchronized with the account the wallet is actually using now.
    if (address.toLowerCase() !== account.toLowerCase()) {
      setAccount(address);
    }
    return {
      provider: bp,
      account: address,
      signer,
      usdc: new Contract(
        deployment.contracts.testUSDC,
        TEST_USDC_ABI,
        signer,
      ),
      vault: new Contract(
        deployment.contracts.marginVault,
        VAULT_ABI,
        signer,
      ),
      oracle: new Contract(
        deployment.contracts.oracleRouter,
        ORACLE_ABI,
        signer,
      ),
      engine: new Contract(
        deployment.contracts.perpEngine,
        ENGINE_ABI,
        signer,
      ),
    };
  }

  async function refresh() {
    if (!account || !hasDeployment()) return null;

    try {
      const c = await contracts();
      const [wb, av, lk, gas] = await Promise.all([
        c.usdc.balanceOf(c.account),
        c.vault.available(c.account),
        c.vault.locked(c.account),
        c.provider.getBalance(c.account),
      ]);

      setWalletBalance(formatUnits(wb, 6));
      setAvailable(formatUnits(av, 6));
      setLocked(formatUnits(lk, 6));
      setNativeBalance(formatUnits(gas, 18));

      const marketKey = marketId(symbol);
      const ids: bigint[] = await c.engine.getActivePositionIds(
        c.account,
        marketKey,
      );

      const nextPositions = await Promise.all(
        ids.map(async (positionId) => {
          const [p, trigger, lp] = await Promise.all([
            c.engine.positions(positionId),
            c.engine.triggerOrders(positionId),
            c.engine.getLiquidationPrice(positionId).catch(() => null),
          ]);

          return {
            id: positionId,
            sizeUsd: p[2],
            margin: p[3],
            entryPrice: p[4],
            isLong: p[5],
            openedAt: p[6],
            takeProfit: trigger[0],
            stopLoss: trigger[1],
            liqPrice:
              lp == null
                ? null
                : Number(formatUnits(lp, 18)),
          } satisfies PositionView;
        }),
      );

      nextPositions.sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      );

      setPositions(nextPositions);

      return {
        hasPosition: nextPositions.length > 0,
        positionCount: nextPositions.length,
        walletBalance: wb,
        available: av,
        locked: lk,
      };
    } catch (error: any) {
      console.warn('[Custos refresh]', error);
      return null;
    }
  }

  function sleep(ms: number) {
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  async function syncAfterTransaction(
    expectation: 'open' | 'close' | 'balance',
    previousCount?: number,
  ) {
    const delays = [250, 500, 900, 1400, 2200, 3200];

    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (attempt > 0) {
        await sleep(delays[attempt]);
      }

      const snapshot = await refresh();
      if (!snapshot) continue;

      if (
        expectation === 'open' &&
        previousCount != null &&
        snapshot.positionCount > previousCount
      ) {
        return true;
      }

      if (
        expectation === 'close' &&
        previousCount != null &&
        snapshot.positionCount < previousCount
      ) {
        return true;
      }

      if (expectation === 'balance' && attempt >= 1) {
        return true;
      }
    }

    return false;
  }

  useEffect(() => {
    void refresh();
  }, [account, symbol]);

  useEffect(() => {
    if (!account) return;

    // Background reconciliation: keeps wallet/vault/position state current
    // without requiring F5. 4 seconds is intentionally much slower than the
    // Pyth price stream and does not touch chart rendering.
    const timer = window.setInterval(() => {
      void refresh();
    }, 4_000);

    return () => window.clearInterval(timer);
  }, [account, symbol]);

  useEffect(() => {
    const ethereum = window.ethereum as any;
    if (!ethereum?.on) return;

    const onAccountsChanged = (accounts: string[]) => {
      const next = accounts?.[0] || '';
      setAccount(next);
      setProvider(null);
      setWalletBalance('0');
      setAvailable('0');
      setLocked('0');
      setNativeBalance('0');
      if (next) {
        setTimeout(() => void connect(), 0);
      }
    };

    const onChainChanged = () => {
      setProvider(null);
      if (account) {
        setTimeout(() => void connect(), 0);
      }
    };

    ethereum.on('accountsChanged', onAccountsChanged);
    ethereum.on('chainChanged', onChainChanged);

    return () => {
      ethereum.removeListener?.('accountsChanged', onAccountsChanged);
      ethereum.removeListener?.('chainChanged', onChainChanged);
    };
  }, [account]);

  async function run(label: string, fn: () => Promise<void>) {
    try {
      setBusy(true);
      setStatus(label);
      await fn();
    } catch (error: any) {
      console.error('[Custos onchain error]', error);
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  function requirePositiveAmount() {
    const amount = parseUnits(margin || '0', 6);
    if (amount <= 0n) throw new Error('Enter an amount greater than 0.');
    return amount;
  }

  async function requireGas(c: Awaited<ReturnType<typeof contracts>>, minWei = 1n) {
    const gas = await c.provider.getBalance(c.account);
    setNativeBalance(formatUnits(gas, 18));

    if (gas < minWei || gas === 0n) {
      throw new Error(
        `Not enough ${GIWA.name} test ETH for gas. Get test ETH from https://faucet.giwa.io/ and try again.`,
      );
    }

    return gas;
  }

  async function claimFaucet() {
    await run('Claiming 10,000 tUSDC…', async () => {
      const c = await contracts();
      await requireGas(c);

      const next = await c.usdc.nextFaucetAt(c.account);
      const now = BigInt(Math.floor(Date.now() / 1000));

      if (next > now) {
        const waitSeconds = Number(next - now);
        const hours = Math.floor(waitSeconds / 3600);
        const minutes = Math.ceil((waitSeconds % 3600) / 60);
        throw new Error(
          `tUSDC faucet cooldown: try again in about ${hours}h ${minutes}m.`,
        );
      }

      // Explicit gasLimit avoids flaky eth_estimateGas behavior on some injected GIWA RPC setups.
      setStatus('Confirm tUSDC faucet transaction in your wallet…');
      const tx = await c.usdc.faucet({ gasLimit: 180_000n });
      await waitForTx(tx, 'tUSDC faucet');
      void reportBetaAction('faucet', tx.hash);

      setStatus('Faucet confirmed · syncing tUSDC balance…');
      await syncAfterTransaction('balance');
      setStatus('Faucet complete');
    });
  }

  async function deposit() {
    await run('Depositing collateral…', async () => {
      const c = await contracts();
      await requireGas(c);

      const amount = requirePositiveAmount();
      const balance = await c.usdc.balanceOf(c.account);

      if (balance < amount) {
        throw new Error(
          `Insufficient wallet tUSDC. Wallet: ${formatUnits(balance, 6)} tUSDC; requested: ${formatUnits(amount, 6)} tUSDC.`,
        );
      }

      const allowance = await c.usdc.allowance(
        c.account,
        deployment.contracts.marginVault,
      );

      if (allowance < amount) {
        setStatus('Approving tUSDC for MarginVault…');
        const approve = await c.usdc.approve(
          deployment.contracts.marginVault,
          amount,
          { gasLimit: 120_000n },
        );
        await waitForTx(approve, 'tUSDC approval');
      }

      setStatus('Depositing tUSDC into MarginVault…');
      setStatus('Confirm DEPOSIT transaction in your wallet…');
      const tx = await c.vault.deposit(amount, { gasLimit: 220_000n });
      await waitForTx(tx, 'Deposit');
      void reportBetaAction('perp_deposit', tx.hash);

      setStatus('Deposit confirmed · syncing Vault balance…');
      await syncAfterTransaction('balance');
      setStatus('Deposit complete');
    });
  }

  async function withdraw() {
    await run('Withdrawing collateral…', async () => {
      const c = await contracts();
      await requireGas(c);

      const amount = requirePositiveAmount();
      const av = await c.vault.available(c.account);

      if (av < amount) {
        throw new Error(
          `Insufficient available collateral. Available: ${formatUnits(av, 6)} tUSDC; requested: ${formatUnits(amount, 6)} tUSDC.`,
        );
      }

      setStatus('Confirm WITHDRAW transaction in your wallet…');
      const tx = await c.vault.withdraw(amount, { gasLimit: 180_000n });
      await waitForTx(tx, 'Withdraw');
      void reportBetaAction('perp_withdraw', tx.hash);

      setStatus('Withdraw confirmed · syncing Vault balance…');
      await syncAfterTransaction('balance');
      setStatus('Withdraw complete');
    });
  }

  async function waitForTx(tx: any, label: string) {
    setPendingTxHash(tx.hash);
    setStatus(`${label} submitted · waiting for GIWA confirmation`);

    try {
      const receipt = await tx.wait(1, 120_000);

      if (!receipt) {
        throw new Error(
          `Transaction ${tx.hash} was submitted but no receipt was returned.`,
        );
      }

      if (Number(receipt.status) !== 1) {
        throw new Error(`Transaction reverted onchain: ${tx.hash}`);
      }

      setPendingTxHash('');
      return receipt;
    } catch (error: any) {
      const code = String(error?.code || '').toUpperCase();
      const message = String(error?.message || '');

      if (
        code === 'TIMEOUT' ||
        /timeout|timed out/i.test(message)
      ) {
        throw new Error(
          `Transaction already submitted (${tx.hash}) but confirmation is taking too long. Do NOT submit again yet; check GIWA Explorer first.`,
        );
      }

      throw error;
    }
  }

  async function getUpdateData() {
    setStatus(`Fetching fresh Pyth Core update for ${symbol}…`);

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 18_000);

    try {
      const response = await fetch(
        `${stream.apiBase}/api/pyth/update/${symbol}`,
        {
          cache: 'no-store',
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail?.message || 'Pyth Core is unavailable. No transaction was submitted.');
      }

      const body = await response.json();

      if (
        Array.isArray(body.updateData) &&
        GIWA.local
      ) {
        return body;
      }

      if (!Array.isArray(body.updateData) || body.updateData.length === 0) {
        throw new Error('Pyth Core returned no signed updateData.');
      }

      return body;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error(
          `Pyth Core update timed out after 18 seconds. The trade was NOT submitted; try again.`,
        );
      }
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function triggerPrice18(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return 0n;
    const parsed = parseUnits(trimmed, 18);
    if (parsed <= 0n) throw new Error('TP/SL price must be greater than 0.');
    return parsed;
  }

  async function updateTriggerPrices(position: PositionView) {
    const currentTp =
      position.takeProfit === 0n
        ? ''
        : Number(formatUnits(position.takeProfit, 18)).toFixed(2);

    const currentSl =
      position.stopLoss === 0n
        ? ''
        : Number(formatUnits(position.stopLoss, 18)).toFixed(2);

    const nextTp = window.prompt(
      `Position #${position.id.toString()} Take Profit price (blank = disabled)`,
      currentTp,
    );

    if (nextTp == null) return;

    const nextSl = window.prompt(
      `Position #${position.id.toString()} Stop Loss price (blank = disabled)`,
      currentSl,
    );

    if (nextSl == null) return;

    await run(`Updating position #${position.id.toString()} TP/SL…`, async () => {
      const c = await contracts();
      await requireGas(c);

      const tp = triggerPrice18(nextTp);
      const sl = triggerPrice18(nextSl);

      setStatus('Confirm TP/SL update in your wallet…');
      const tx = await c.engine.setTriggerPrices(
        position.id,
        tp,
        sl,
        { gasLimit: 220_000n },
      );

      await waitForTx(tx, 'TP/SL update');
      void reportBetaAction('tpsl', tx.hash);

      setStatus('TP/SL confirmed · syncing position…');
      await syncAfterTransaction('balance');
      setStatus(`Position #${position.id.toString()} TP/SL updated`);
    });
  }

  async function openPosition() {
    await run(`Preparing ${side} ${symbol}…`, async () => {
      setPendingTxHash('');

      const quoteSource = market?.quote?.source;
      const isConfiguredFallback = GIWA.local && quoteSource === 'local-mock';

      if (!market?.quote?.price || (!hasLivePythQuote(market.quote) && !isConfiguredFallback)) {
        throw new Error(`${symbol} has no usable price right now.`);
      }

      setStatus('Checking wallet, GIWA network and collateral…');
      const c = await contracts();
      const marginAmount = requirePositiveAmount();

      if (marginAmount < parseUnits('10', 6)) {
        throw new Error('Minimum margin is 10 tUSDC.');
      }

      const av = await c.vault.available(c.account);
      if (av < marginAmount) {
        throw new Error(
          `Deposit collateral first. Vault available: ${formatUnits(av, 6)} tUSDC; requested margin: ${formatUnits(marginAmount, 6)} tUSDC.`,
        );
      }

      if (leverage > (market?.max_leverage || 0)) {
        throw new Error(
          `Maximum leverage for ${symbol} is ${market?.max_leverage || 0}x.`,
        );
      }

      const tp = triggerPrice18(takeProfit);
      const sl = triggerPrice18(stopLoss);

      const previousIds: bigint[] =
        await c.engine.getActivePositionIds(
          c.account,
          marketId(symbol),
        );
      const previousCount = previousIds.length;

      const update = await getUpdateData();

      setStatus('Reading Pyth oracle update fee…');
      const fee = await c.oracle.getUpdateFee(update.updateData);

      setStatus('Checking ETH balance for oracle fee + gas…');
      const gas = await requireGas(c, fee + 1n);

      if (gas <= fee) {
        throw new Error(
          `Not enough test ETH for Pyth fee + gas. Pyth fee: ${formatUnits(fee, 18)} ETH.`,
        );
      }

      setStatus(
        `Confirm ${side.toUpperCase()} ${symbol} transaction in your wallet…`,
      );

      const tx = await c.engine.openPositionWithTriggers(
        marketId(symbol),
        side === 'long',
        marginAmount,
        BigInt(leverage) * 10_000n,
        tp,
        sl,
        update.updateData,
        {
          value: fee,
          gasLimit: 1_500_000n,
        },
      );

      await waitForTx(tx, `Open ${side.toUpperCase()} ${symbol}`);
      void reportBetaAction('perp_open', tx.hash);

      setStatus(`${side.toUpperCase()} ${symbol} confirmed · syncing position…`);
      const synced = await syncAfterTransaction('open', previousCount);

      if (synced) {
        setStatus(`${side.toUpperCase()} ${symbol} position live`);
      } else {
        setStatus(
          `${side.toUpperCase()} ${symbol} confirmed · GIWA RPC is catching up; position will appear automatically.`,
        );
      }
    });
  }

  async function closePosition(position: PositionView) {
    await run(`Preparing close position #${position.id.toString()}…`, async () => {
      setPendingTxHash('');

      setStatus('Checking wallet and current position…');
      const c = await contracts();

      const previousIds: bigint[] =
        await c.engine.getActivePositionIds(
          c.account,
          marketId(symbol),
        );
      const previousCount = previousIds.length;

      if (!previousIds.some((id) => id === position.id)) {
        throw new Error(
          `Position #${position.id.toString()} is no longer open.`,
        );
      }

      const update = await getUpdateData();

      setStatus('Reading Pyth oracle update fee…');
      const fee = await c.oracle.getUpdateFee(update.updateData);

      setStatus('Checking ETH balance for oracle fee + gas…');
      await requireGas(c, fee + 1n);

      setStatus(
        `Confirm CLOSE position #${position.id.toString()} in your wallet…`,
      );

      const tx = await c.engine.closePosition(
        position.id,
        update.updateData,
        {
          value: fee,
          gasLimit: 1_500_000n,
        },
      );

      await waitForTx(
        tx,
        `Close #${position.id.toString()} ${symbol}`,
      );
      void reportBetaAction('perp_close', tx.hash);

      setStatus(
        `Close #${position.id.toString()} confirmed · syncing positions…`,
      );

      const synced =
        await syncAfterTransaction(
          'close',
          previousCount,
        );

      if (synced) {
        setStatus(
          `Position #${position.id.toString()} closed`,
        );
      } else {
        setStatus(
          `Position #${position.id.toString()} confirmed closed · GIWA RPC is catching up.`,
        );
      }
    });
  }

  return (
    <div
      className={`app embedded ${standalone ? 'standalone' : ''} notranslate`}
      translate="no"
    >
      <div className="embedTopline">
        <div>
          {standalone && (
            <a
              href="#/defi?tab=overview"
              className="perpHomeLink"
              title="Back to RWA Exchange"
            >
              CUSTOS
            </a>
          )}
          <span className={stream.connected && stream.live ? 'pulse live' : 'pulse'} />
          <strong>PERPETUAL MARKETS</strong>
          <span>
            {stream.connected
              ? stream.live ? 'PYTH STREAM LIVE' : stream.providerError ? 'PYTH STREAM UNAVAILABLE' : 'WAITING FOR LIVE PRICES'
              : 'STREAM CONNECTING'}
          </span>
        </div>

        <div className="embedWallet">
          <span>{GIWA.name} · {GIWA.chainId}</span>

          {account ? (
            <strong>{short(account)}</strong>
          ) : standalone ? (
            <button
              type="button"
              className="standaloneConnect"
              onClick={() => void connect()}
            >
              <Wallet size={12} />
              Connect Wallet
            </button>
          ) : (
            <span>Connect wallet from the main header</span>
          )}
        </div>
      </div>

      {!hasDeployment() && (
        <div className="warning">
          Perpetual deployment is not linked yet. Copy the latest
          <code> deployment.generated.json </code> from the Custos deployment bundle
          frontend into this merged frontend.
        </div>
      )}

      <main className="terminal">
        <aside className="markets panel">
          <div className="panelTitle">
            <span>Markets</span>
            <Activity size={14} />
          </div>

          {stream.markets.map((m) => (
            <button
              key={m.symbol}
              className={`marketRow ${m.symbol === symbol ? 'active' : ''}`}
              onClick={() => setSymbol(m.symbol)}
            >
              <div className="assetBadge">{m.symbol.slice(0, 3)}</div>
              <div className="marketName">
                <strong>{m.symbol}</strong>
                <span>{m.asset_type.toUpperCase()}</span>
              </div>
              <div className="marketPx">
                <strong>{fmt(m.quote?.price)}</strong>
                <span className={m.quote?.fresh ? 'green' : 'amber'}>
                  {!m.quote
                    ? 'WAIT'
                    : m.quote.source === 'nasdaq-chart'
                      ? m.quote.fresh ? 'LIVE' : 'DELAYED'
                      : m.quote.fresh ? 'LIVE' : 'WAIT'}
                </span>
              </div>
            </button>
          ))}
        </aside>

        <section className="main panel">
          <div className="marketHeader">
            <div>
              <span className="eyebrow">{market?.asset_type || 'GLOBAL'} PERP</span>
              <h1>{symbol} / USD</h1>
              <p>{market?.name}</p>
            </div>

            <div className="bigPrice">
              <strong>${fmt(market?.quote?.price)}</strong>
              <span className={chartChange >= 0 ? 'green' : 'red'}>
                {chartChange >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                {Math.abs(chartChange).toFixed(3)}%
              </span>
            </div>
          </div>

          <div className="metrics">
            <div><span>Oracle</span><strong>Pyth Core</strong></div>
            <div><span>Stream</span><strong>{market?.quote?.source || 'waiting'}</strong></div>
            <div><span>Session</span><strong>{market?.quote?.session || '—'}</strong></div>
            <div><span>Max Lev</span><strong>{market?.max_leverage || 0}x</strong></div>
          </div>

          <div className="timeframeBar">
            <div className="timeframeButtons">
              {TIMEFRAMES.map((item) => (
                <button
                  key={item}
                  className={timeframe === item ? 'active' : ''}
                  onClick={() => setTimeframe(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="chartControlsRight">
              <span className="timeframeSource">
                {historyLoading
                  ? 'LOADING HISTORY…'
                  : `${chartHistorySource} HISTORY${market?.quote?.fresh ? ' + LIVE' : ' · LIVE DATA UNAVAILABLE'}`}
              </span>
              <div className="colorModeToggle">
                <button
                  className={candleColorMode === 'global' ? 'active' : ''}
                  onClick={() => setCandleColorMode('global')}
                  title="Green up / red down"
                >
                  绿涨红跌
                </button>
                <button
                  className={candleColorMode === 'china' ? 'active' : ''}
                  onClick={() => setCandleColorMode('china')}
                  title="Red up / green down"
                >
                  红涨绿跌
                </button>
              </div>
            </div>
          </div>

          <CandlestickChart
            candles={chartCandles}
            timeframe={timeframe}
            loading={historyLoading}
            error={historyError}
            colorMode={candleColorMode}
            livePrice={market?.quote?.price ?? null}
            liveTimestampUs={market?.quote?.feedUpdateTimestampUs ?? null}
            liveSource={market?.quote?.source || ''}
            liveFresh={market?.quote?.fresh ?? false}
          />

          <div className="accountStrip">
            <div>
              <CircleDollarSign size={14} />
              <span>Wallet tUSDC</span>
              <strong>{Number(walletBalance).toFixed(2)}</strong>
            </div>
            <div>
              <ShieldCheck size={14} />
              <span>Vault Available</span>
              <strong>{Number(available).toFixed(2)}</strong>
            </div>
            <div>
              <Gauge size={14} />
              <span>Locked Margin</span>
              <strong>{Number(locked).toFixed(2)}</strong>
            </div>
            <button onClick={claimFaucet} disabled={busy || !account}>
              <Droplets size={13} />
              Faucet 10,000 tUSDC
            </button>
          </div>

          <div className="positions">
            <div className="sectionTitle">
              Open Positions ({positions.length})
            </div>

            {positions.length ? (
              <div className="multiPositionList">
                {positions.map((position) => {
                  const pnl = positionPnl(position);
                  const tp =
                    position.takeProfit === 0n
                      ? '—'
                      : `$${Number(formatUnits(position.takeProfit, 18)).toFixed(2)}`;
                  const sl =
                    position.stopLoss === 0n
                      ? '—'
                      : `$${Number(formatUnits(position.stopLoss, 18)).toFixed(2)}`;

                  return (
                    <div
                      className="positionRow multiPositionRow"
                      key={position.id.toString()}
                    >
                      <div>
                        <span>ID</span>
                        <strong>#{position.id.toString()}</strong>
                      </div>
                      <div>
                        <span>Market</span>
                        <strong>{symbol}</strong>
                      </div>
                      <div>
                        <span>Side</span>
                        <strong
                          className={position.isLong ? 'green' : 'red'}
                        >
                          {position.isLong ? 'LONG' : 'SHORT'}
                        </strong>
                      </div>
                      <div>
                        <span>Size</span>
                        <strong>
                          ${Number(formatUnits(position.sizeUsd, 18)).toFixed(2)}
                        </strong>
                      </div>
                      <div>
                        <span>Margin</span>
                        <strong>
                          ${Number(formatUnits(position.margin, 6)).toFixed(2)}
                        </strong>
                      </div>
                      <div>
                        <span>Entry</span>
                        <strong>
                          ${Number(formatUnits(position.entryPrice, 18)).toFixed(2)}
                        </strong>
                      </div>
                      <div>
                        <span>PNL</span>
                        <strong
                          className={(pnl || 0) >= 0 ? 'green' : 'red'}
                        >
                          {pnl == null
                            ? '—'
                            : `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`}
                        </strong>
                      </div>
                      <div>
                        <span>TP</span>
                        <strong className="green">{tp}</strong>
                      </div>
                      <div>
                        <span>SL</span>
                        <strong className="red">{sl}</strong>
                      </div>
                      <div>
                        <span>Liq.</span>
                        <strong>
                          {position.liqPrice == null
                            ? '—'
                            : `$${position.liqPrice.toFixed(2)}`}
                        </strong>
                      </div>

                      <button
                        onClick={() => updateTriggerPrices(position)}
                        disabled={busy}
                      >
                        Update TP/SL
                      </button>

                      <button
                        onClick={() => closePosition(position)}
                        disabled={busy}
                      >
                        Close
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty">
                No open {symbol} positions.
              </div>
            )}
          </div>
        </section>

        <aside className="order panel">
          <div className="sideTabs">
            <button className={side === 'long' ? 'long active' : ''} onClick={() => setSide('long')}>Long</button>
            <button className={side === 'short' ? 'short active' : ''} onClick={() => setSide('short')}>Short</button>
          </div>

          <div className="orderMode">
            <button className="active">Market</button>
            <button disabled>Limit · V2</button>
          </div>

          <label>
            <span>Margin</span>
            <div className="input">
              <input value={margin} onChange={(e) => setMargin(e.target.value)} />
              <b>tUSDC</b>
            </div>
          </label>

          <div className="quick">
            {['50', '100', '250', '500'].map((x) => (
              <button key={x} onClick={() => setMargin(x)}>{x}</button>
            ))}
          </div>

          <label>
            <span>Leverage</span>
            <strong>{leverage}x</strong>
          </label>

          <div className="leverage">
            {[1, 2, 3, 5, 10].map((x) => (
              <button
                key={x}
                disabled={x > (market?.max_leverage || 0)}
                className={leverage === x ? 'active' : ''}
                onClick={() => setLeverage(x)}
              >
                {x}x
              </button>
            ))}
          </div>

          <div className="tpslGrid">
            <label>
              <span>Take Profit</span>
              <div className="input">
                <input
                  inputMode="decimal"
                  placeholder="Optional TP price"
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(e.target.value)}
                />
                <b>USD</b>
              </div>
            </label>

            <label>
              <span>Stop Loss</span>
              <div className="input">
                <input
                  inputMode="decimal"
                  placeholder="Optional SL price"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                />
                <b>USD</b>
              </div>
            </label>
          </div>

          <div className="tpslHint">
            Leave blank to disable. Existing positions can update TP/SL with one onchain transaction.
          </div>

          <div className="summary">
            <div><span>Notional</span><strong>${((Number(margin) || 0) * leverage).toFixed(2)}</strong></div>
            <div><span>Available</span><strong>${Number(available).toFixed(2)}</strong></div>
            <div><span>Collateral</span><strong>tUSDC</strong></div>
            <div><span>Gas balance</span><strong>{Number(nativeBalance).toFixed(6)} ETH</strong></div>
            <div><span>Settlement</span><strong>tUSDC</strong></div>
          </div>

          <div className="collateralActions">
            <button onClick={deposit} disabled={busy || !account}>Deposit</button>
            <button onClick={withdraw} disabled={busy || !account}>Withdraw</button>
          </div>

          <button
            className={`tradeButton ${side}`}
            disabled={busy || !account || (!GIWA.local && !hasLivePythQuote(market?.quote))}
            onClick={openPosition}
          >
            <Zap size={15} />
            {busy ? 'Processing…' : !GIWA.local && !hasLivePythQuote(market?.quote) ? 'Live oracle unavailable' : `${side === 'long' ? 'Long' : 'Short'} ${symbol}`}
          </button>

          <div className="statusBox">
            <Radio size={13} />
            <span>{status || (!GIWA.local && !hasLivePythQuote(market?.quote) ? 'Live Pyth access unavailable. New positions are paused; fallback prices are not trade quotes.' : 'Ready. Oracle fee is fetched on each onchain action.')}</span>
            {pendingTxHash && (
              <a
                href={`${GIWA.explorer}/tx/${pendingTxHash}`}
                target="_blank"
                rel="noreferrer"
                style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}
              >
                View TX
              </a>
            )}
          </div>

          {account && Number(nativeBalance) <= 0 && (
            <a
              className="gasFaucetLink"
              href="https://faucet.giwa.io/"
              target="_blank"
              rel="noreferrer"
            >
              Get {GIWA.name} test ETH for gas
            </a>
          )}

          <div className="risk">
            <ShieldCheck size={14} />
            <p>
              Testnet-only synthetic perpetuals. tUSDC has no cash value.
              Equity/metal markets are reference-price products, not ownership
              of the underlying asset.
            </p>
          </div>
        </aside>
      </main>

      <footer>
        <span>CUSTOS · {GIWA.name.toUpperCase()}</span>
        <span>Pyth Pro = UI stream</span>
        <span>Pyth Core = onchain settlement oracle</span>
        <a href={GIWA.explorer} target="_blank" rel="noreferrer">
          Explorer <ExternalLink size={10} />
        </a>
      </footer>
    </div>
  );
}

function CandlestickChart({
  candles,
  timeframe,
  loading,
  error,
  colorMode,
  livePrice,
  liveTimestampUs,
  liveSource,
  liveFresh,
}: {
  candles: HistoryCandle[];
  timeframe: Timeframe;
  loading: boolean;
  error: string;
  colorMode: CandleColorMode;
  livePrice: number | null;
  liveTimestampUs: number | null;
  liveSource: string;
  liveFresh: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const historyLastRef = useRef<HistoryCandle | null>(null);
  const liveCandleRef = useRef<HistoryCandle | null>(null);
  const [hoverCandle, setHoverCandle] = useState<HistoryCandle | null>(null);
  const [chartRuntimeError, setChartRuntimeError] = useState('');

  const colors = useMemo(() => {
    if (colorMode === 'china') {
      return {
        up: '#ff5c6c',
        down: '#44d78a',
        wickUp: '#ff5c6c',
        wickDown: '#44d78a',
      };
    }

    return {
      up: '#55d99a',
      down: '#ef6272',
      wickUp: '#70e6ad',
      wickDown: '#ff7180',
    };
  }, [colorMode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let observer: ResizeObserver | null = null;

    try {
      const chart = createChart(container, {
        width: Math.max(container.clientWidth, 320),
        height: container.clientHeight || 470,
        layout: {
          background: { type: ColorType.Solid, color: '#04100b' },
          textColor: '#75877d',
          fontFamily:
            'IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 11,
        },
        grid: {
          vertLines: { color: 'rgba(111, 140, 123, 0.10)' },
          horzLines: { color: 'rgba(111, 140, 123, 0.10)' },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: {
            color: 'rgba(167, 190, 177, 0.45)',
            width: 1,
            style: 2,
            labelBackgroundColor: '#1b2b24',
          },
          horzLine: {
            color: 'rgba(167, 190, 177, 0.45)',
            width: 1,
            style: 2,
            labelBackgroundColor: '#1b2b24',
          },
        },
        rightPriceScale: {
          borderColor: 'rgba(111, 140, 123, 0.20)',
          scaleMargins: {
            top: 0.08,
            bottom: 0.08,
          },
        },
        timeScale: {
          borderColor: 'rgba(111, 140, 123, 0.20)',
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 6,
          barSpacing: 9,
          minBarSpacing: 3,
        },
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: false,
        },
        handleScale: {
          axisPressedMouseMove: true,
          mouseWheel: true,
          pinch: true,
        },
      });

      const series = chart.addSeries(CandlestickSeries, {
        upColor: colors.up,
        downColor: colors.down,
        borderUpColor: colors.up,
        borderDownColor: colors.down,
        wickUpColor: colors.wickUp,
        wickDownColor: colors.wickDown,
        priceLineVisible: true,
        lastValueVisible: true,
        priceLineColor: colors.up,
        priceLineStyle: 2,
        priceLineWidth: 1,
      });

      chartRef.current = chart;
      seriesRef.current = series;

      chart.subscribeCrosshairMove((param) => {
        if (disposed) return;

        if (!param.time) {
          setHoverCandle(null);
          return;
        }

        const row = param.seriesData.get(series) as
          | CandlestickData<UTCTimestamp>
          | undefined;

        if (!row) {
          setHoverCandle(null);
          return;
        }

        setHoverCandle({
          time: Number(row.time),
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
        });
      });

      let resizeFrame = 0;
      observer = new ResizeObserver(() => {
        if (disposed || !containerRef.current) return;
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
          try {
            chart.applyOptions({
              width: Math.max(containerRef.current?.clientWidth || 320, 320),
              height: containerRef.current?.clientHeight || 470,
            });
          } catch (resizeError) {
            console.warn('[Custos chart resize]', resizeError);
          }
        });
      });

      observer.observe(container);

      return () => {
        disposed = true;
        cancelAnimationFrame(resizeFrame);
        observer?.disconnect();

        try {
          chart.remove();
        } catch (removeError) {
            console.warn('[Custos chart cleanup]', removeError);
        }

        chartRef.current = null;
        seriesRef.current = null;
        historyLastRef.current = null;
        liveCandleRef.current = null;
      };
    } catch (chartError: any) {
      console.error('[Custos chart init]', chartError);
      setChartRuntimeError(
        chartError?.message || 'Chart initialization failed.',
      );
      return undefined;
    }
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    try {
      series.applyOptions({
        upColor: colors.up,
        downColor: colors.down,
        borderUpColor: colors.up,
        borderDownColor: colors.down,
        wickUpColor: colors.wickUp,
        wickDownColor: colors.wickDown,
        priceLineColor: colors.up,
      });
    } catch (chartError) {
      console.warn('[Custos chart color update]', chartError);
    }
  }, [colors]);

  // Historical data is loaded only when symbol/timeframe changes.
  // Do not re-send 300 candles to TradingView on every 200ms Pyth tick.
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    try {
      const unique = new Map<number, HistoryCandle>();

      for (const candle of candles) {
        if (
          Number.isFinite(candle.time) &&
          Number.isFinite(candle.open) &&
          Number.isFinite(candle.high) &&
          Number.isFinite(candle.low) &&
          Number.isFinite(candle.close)
        ) {
          unique.set(candle.time, candle);
        }
      }

      const sorted = [...unique.values()].sort((a, b) => a.time - b.time);

      const data: CandlestickData<UTCTimestamp>[] = sorted.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      series.setData(data);

      const last = sorted[sorted.length - 1] || null;
      historyLastRef.current = last;
      liveCandleRef.current = last ? { ...last } : null;

      if (data.length > 0) {
        chart.timeScale().fitContent();
        chart.timeScale().scrollToRealTime();
      }

      setChartRuntimeError('');
    } catch (chartError: any) {
      console.error('[Custos chart history update]', chartError);
      setChartRuntimeError(
        chartError?.message || 'Historical chart update failed.',
      );
    }
  }, [candles, timeframe]);

  // Only update the current candle for each live Pyth tick.
  useEffect(() => {
    const series = seriesRef.current;
    if (
      !series ||
      livePrice == null ||
      !Number.isFinite(livePrice) ||
      !liveTimestampUs
    ) {
      return;
    }

    const intervalMs = TIMEFRAME_MS[timeframe];
    const tsMs = Math.floor(liveTimestampUs / 1000);
    const bucketMs = Math.floor(tsMs / intervalMs) * intervalMs;
    const bucketSec = Math.floor(bucketMs / 1000);

    const historyLast = historyLastRef.current;
    const current = liveCandleRef.current;

    // Ignore out-of-order live ticks older than the most recent history bar.
    if (historyLast && bucketSec < historyLast.time) {
      return;
    }

    let next: HistoryCandle;

    if (current && current.time === bucketSec) {
      next = {
        ...current,
        high: Math.max(current.high, livePrice),
        low: Math.min(current.low, livePrice),
        close: livePrice,
      };
    } else if (historyLast && historyLast.time === bucketSec) {
      next = {
        ...historyLast,
        high: Math.max(historyLast.high, livePrice),
        low: Math.min(historyLast.low, livePrice),
        close: livePrice,
      };
    } else {
      const open =
        current?.close ??
        historyLast?.close ??
        livePrice;

      next = {
        time: bucketSec,
        open,
        high: Math.max(open, livePrice),
        low: Math.min(open, livePrice),
        close: livePrice,
        volume: null,
      };
    }

    try {
      series.update({
        time: next.time as UTCTimestamp,
        open: next.open,
        high: next.high,
        low: next.low,
        close: next.close,
      });

      liveCandleRef.current = next;
    } catch (chartError) {
      // A chart update must never take down the entire trading terminal.
      console.warn('[Custos chart live update ignored]', chartError);
    }
  }, [livePrice, liveTimestampUs, timeframe]);

  const display =
    hoverCandle ||
    liveCandleRef.current ||
    candles[candles.length - 1] ||
    null;

  return (
    <div className="exchangeChartShell">
      <div className="exchangeChartToolbar">
        <div className="exchangeChartOHLC">
          {display ? (
            <>
              <span>O&nbsp; {fmt(display.open)}</span>
              <span>H&nbsp; {fmt(display.high)}</span>
              <span>L&nbsp; {fmt(display.low)}</span>
              <span>C&nbsp; {fmt(livePrice ?? display.close)}</span>
            </>
          ) : (
            <span>Waiting for market data…</span>
          )}
        </div>

        <div className="exchangeChartStatus">
          <Radio size={11} />
          {timeframe.toUpperCase()} ·{' '}
          {liveSource === 'testnet-fallback' || liveSource === 'local-mock'
            ? 'TESTNET FALLBACK'
            : liveSource === 'nasdaq-chart'
            ? liveFresh ? 'NASDAQ LIVE' : 'NASDAQ DELAYED'
            : liveFresh ? 'PYTH LIVE' : 'PYTH DELAYED'}
          {livePrice != null && <strong>${fmt(livePrice)}</strong>}
        </div>
      </div>

      <div ref={containerRef} className="exchangeChartCanvas" />

      {loading && candles.length === 0 && (
        <div className="exchangeChartOverlay">
          Loading {timeframe} historical candles…
        </div>
      )}

      {(error || chartRuntimeError) && candles.length === 0 && (
        <div className="exchangeChartOverlay exchangeChartError">
          {chartRuntimeError || error || 'Historical data provider is unavailable.'}
        </div>
      )}
    </div>
  );
}
