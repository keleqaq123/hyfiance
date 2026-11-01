import { useEffect, useMemo, useRef, useState } from 'react';
import { CUSTOS_API_BASE } from './marketNetwork';

export type Quote = {
  symbol: string;
  name: string;
  assetType: string;
  price: number;
  session: string;
  streamTimestampUs: number;
  feedUpdateTimestampUs: number;
  fresh: boolean;
  source: string;
};

export type Market = {
  symbol: string;
  name: string;
  asset_type: string;
  core_feed_id: string;
  pro_feed_id: number;
  max_leverage: number;
  quote?: Quote | null;
};

const API_BASE =
  CUSTOS_API_BASE;

export function hasLivePythQuote(quote?: Quote | null, now = Date.now()) {
  return !!quote && quote.source === 'pyth-pro-websocket' && quote.fresh
    && Number.isFinite(quote.price) && quote.price > 0
    && Number.isFinite(quote.feedUpdateTimestampUs)
    && Math.abs(now - quote.feedUpdateTimestampUs / 1000) <= 15000;
}

function wsUrl() {
  const u = new URL(API_BASE);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/ws/markets';
  u.search = '';
  return u.toString();
}

export function useMarketStream() {
  const [map, setMap] = useState<Record<string, Market>>({});
  const [connected, setConnected] = useState(false);
  const [live, setLive] = useState(false);
  const [providerError, setProviderError] = useState('');
  const retry = useRef<number | null>(null);

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let freshTimer: number | null = null;
    const markLive = () => {
      setLive(true);
      if (freshTimer !== null) window.clearTimeout(freshTimer);
      freshTimer = window.setTimeout(() => setLive(false), 15000);
    };

    const connect = () => {
      if (stopped) return;

      const ws = new WebSocket(wsUrl());
      socket = ws;

      ws.onopen = () => {
        setConnected(true);
        ws.send('ping');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'snapshot') {
            const nodes = Object.values(msg.nodes || {}) as { error?: string }[];
            setProviderError(nodes.map(node => node.error || '').filter(Boolean).join('; '));
            if ((msg.markets || []).some((m: Market) => hasLivePythQuote(m.quote))) markLive();
            else setLive(false);
            setMap(
              Object.fromEntries(
                (msg.markets || []).map((m: Market) => [m.symbol, m]),
              ),
            );
          }

          if (msg.type === 'quote') {
            const q = msg.quote as Quote;
            if (hasLivePythQuote(q)) { markLive(); setProviderError(''); }
            setMap((current) => {
              const old = current[q.symbol];
              if (!old) return current;
              return {
                ...current,
                [q.symbol]: {
                  ...old,
                  quote: q,
                },
              };
            });
          }
        } catch {
          // ignore malformed frame
        }
      };

      ws.onclose = () => {
        if (stopped) return;
        setConnected(false);
        setLive(false);
        retry.current = window.setTimeout(connect, 3000);
      };

      ws.onerror = () => { setConnected(false); setLive(false); };
    };

    fetch(`${API_BASE}/api/markets`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((msg) => {
        setMap(
          Object.fromEntries(
            (msg.markets || []).map((m: Market) => [m.symbol, m]),
          ),
        );
      })
      .catch(() => undefined)
      .finally(connect);

    return () => {
      stopped = true;
      socket?.close();
      if (freshTimer !== null) window.clearTimeout(freshTimer);
      if (retry.current !== null) window.clearTimeout(retry.current);
    };
  }, []);

  const markets = useMemo(
    () =>
      ['BTC', 'ETH', 'SOL', 'AAPL', 'NVDA', 'XAU']
        .map((s) => map[s])
        .filter(Boolean),
    [map],
  );

  return { markets, bySymbol: map, connected, live, providerError, apiBase: API_BASE };
}
