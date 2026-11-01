from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from local_market_data import local_candles, local_quote
from network_config import is_local_network, network_config

try:
    from websockets.asyncio.client import connect as websocket_connect
except ImportError:
    from websockets import connect as websocket_connect  # type: ignore

router = APIRouter()

CHAIN_ID = int(network_config()["chain_id"])

PYTH_HERMES_URL = os.getenv(
    "PYTH_HERMES_URL",
    "https://hermes.pyth.network",
).rstrip("/")
PYTH_API_KEY = os.getenv("PYTH_API_KEY", "").strip()
# Pyth Core and Pyth Pro/Lazer use the same project API key in this setup.
# Keep the dedicated variable for compatibility, but accept the Core name
# when only one credential is configured.
PYTH_PRO_API_KEY = (
    os.getenv("PYTH_PRO_API_KEY", "").strip() or PYTH_API_KEY
)
PYTH_STREAM_CHANNEL = os.getenv("PYTH_STREAM_CHANNEL", "fixed_rate@200ms")
PYTH_STREAM_ENDPOINTS = [
    value.strip()
    for value in os.getenv(
        "PYTH_STREAM_ENDPOINTS",
        ",".join(
            [
                "wss://pyth-lazer-0.dourolabs.app/v1/stream",
                "wss://pyth-lazer-1.dourolabs.app/v1/stream",
                "wss://pyth-lazer-2.dourolabs.app/v1/stream",
            ]
        ),
    ).split(",")
    if value.strip()
]


@dataclass(frozen=True)
class PerpMarket:
    symbol: str
    name: str
    asset_type: str
    core_feed_id: str
    pro_feed_id: int
    max_leverage: int


MARKETS = [
    PerpMarket(
        "BTC",
        "Bitcoin",
        "crypto",
        "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
        1,
        10,
    ),
    PerpMarket(
        "ETH",
        "Ethereum",
        "crypto",
        "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
        2,
        10,
    ),
    PerpMarket(
        "SOL",
        "Solana",
        "crypto",
        "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
        5,
        10,
    ),
    PerpMarket(
        "AAPL",
        "Apple Inc.",
        "equity",
        "0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
        922,
        5,
    ),
    PerpMarket(
        "NVDA",
        "NVIDIA Corporation",
        "equity",
        "0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
        1314,
        5,
    ),
    PerpMarket(
        "XAU",
        "Gold",
        "metal",
        "0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2",
        346,
        5,
    ),
]

BY_SYMBOL = {market.symbol: market for market in MARKETS}
BY_PRO = {market.pro_feed_id: market for market in MARKETS}

PYTH_HISTORY_SYMBOLS = {
    "BTC": "Crypto.BTC/USD",
    "ETH": "Crypto.ETH/USD",
    "SOL": "Crypto.SOL/USD",
    "AAPL": "Equity.US.AAPL/USD",
    "NVDA": "Equity.US.NVDA/USD",
    "XAU": "Metal.XAU/USD",
}

PYTH_HISTORY_RESOLUTIONS = {
    "1m": ("1", 60),
    "5m": ("5", 5 * 60),
    "30m": ("30", 30 * 60),
    "2h": ("120", 2 * 60 * 60),
    "6h": ("360", 6 * 60 * 60),
    "1d": ("D", 24 * 60 * 60),
}

FALLBACK_PRICES = {
    "BTC": 100_000.0,
    "ETH": 4_000.0,
    "SOL": 200.0,
    "AAPL": 220.0,
    "NVDA": 180.0,
    "XAU": 2_300.0,
}

NASDAQ_API_URL = "https://api.nasdaq.com/api"
NASDAQ_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://www.nasdaq.com",
    "Referer": "https://www.nasdaq.com/",
    "User-Agent": "Mozilla/5.0 (Custos RWA market terminal)",
}


def auth_headers(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}"} if key else {}


def fallback_quote(market: PerpMarket) -> dict[str, Any]:
    now_us = int(time.time() * 1_000_000)
    return {
        "symbol": market.symbol,
        "name": market.name,
        "assetType": market.asset_type,
        "price": FALLBACK_PRICES[market.symbol],
        "session": "testnet",
        "streamTimestampUs": now_us,
        "feedUpdateTimestampUs": now_us,
        "fresh": False,
        "source": "testnet-fallback",
        "sourceNode": "Custos fallback oracle",
        "channel": "fallback",
        "receivedAtMs": int(time.time() * 1000),
        "ageSeconds": 0,
    }


def parse_market_number(value: Any) -> float | None:
    if value is None:
        return None

    if isinstance(value, (int, float)):
        number = float(value)
        return number if number == number and number not in (float("inf"), float("-inf")) else None

    text = str(value).strip().replace("$", "").replace(",", "")
    if not text or text in {"--", "-", "N/A", "NA"}:
        return None

    try:
        number = float(text)
    except (TypeError, ValueError):
        return None

    return number if number == number and number not in (float("inf"), float("-inf")) else None


def candles_from_history_body(body: dict[str, Any]) -> list[dict[str, Any]]:
    timestamps = body.get("t") or []
    opens = body.get("o") or []
    highs = body.get("h") or []
    lows = body.get("l") or []
    closes = body.get("c") or []
    volumes = body.get("v") or []

    count = min(
        len(timestamps),
        len(opens),
        len(highs),
        len(lows),
        len(closes),
    )

    candles = []
    for index in range(count):
        candles.append(
            {
                "time": int(timestamps[index]),
                "open": float(opens[index]),
                "high": float(highs[index]),
                "low": float(lows[index]),
                "close": float(closes[index]),
                "volume": (
                    float(volumes[index])
                    if index < len(volumes) and volumes[index] is not None
                    else None
                ),
            }
        )

    return candles


async def fetch_nasdaq_chart(symbol: str) -> dict[str, Any]:
    response = await http.get(
        f"{NASDAQ_API_URL}/quote/{symbol}/chart",
        params={"assetclass": "stocks"},
        headers=NASDAQ_HEADERS,
    )

    if response.status_code >= 400:
        raise RuntimeError(
            f"Nasdaq chart HTTP {response.status_code}: {response.text[:300]}"
        )

    body = response.json()
    status = body.get("status") or {}
    if status.get("rCode") not in (None, 200):
        raise RuntimeError(f"Nasdaq chart returned: {status}")

    data = body.get("data") or {}
    if not isinstance(data, dict):
        raise RuntimeError("Nasdaq chart returned no data")

    return data


def candles_from_nasdaq_chart(
    data: dict[str, Any],
    seconds_per_bar: int,
    bars: int,
) -> list[dict[str, Any]]:
    points = data.get("chart") or []
    grouped: dict[int, dict[str, Any]] = {}

    for point in points:
        timestamp_ms = parse_market_number(point.get("x"))
        price = parse_market_number(point.get("y"))
        if timestamp_ms is None or price is None or price <= 0:
            continue

        timestamp = int(timestamp_ms / 1000)
        bucket = (timestamp // seconds_per_bar) * seconds_per_bar
        candle = grouped.get(bucket)

        if candle is None:
            grouped[bucket] = {
                "time": bucket,
                "open": price,
                "high": price,
                "low": price,
                "close": price,
                "volume": None,
            }
            continue

        candle["high"] = max(candle["high"], price)
        candle["low"] = min(candle["low"], price)
        candle["close"] = price

    candles = [grouped[key] for key in sorted(grouped)]
    return candles[-bars:] if bars > 0 else candles


def latest_quote_from_nasdaq_chart(
    market: PerpMarket,
    data: dict[str, Any],
) -> dict[str, Any] | None:
    for point in reversed(data.get("chart") or []):
        timestamp_ms = parse_market_number(point.get("x"))
        price = parse_market_number(point.get("y"))
        if timestamp_ms is None or price is None or price <= 0:
            continue

        timestamp = int(timestamp_ms / 1000)
        age = max(0, int(time.time()) - timestamp)
        timestamp_us = timestamp * 1_000_000
        return {
            "symbol": market.symbol,
            "name": market.name,
            "assetType": market.asset_type,
            "price": price,
            "session": "nasdaq",
            "streamTimestampUs": timestamp_us,
            "feedUpdateTimestampUs": timestamp_us,
            "fresh": age <= 300,
            "source": "nasdaq-chart",
            "sourceNode": "api.nasdaq.com",
            "channel": "nasdaq-chart",
            "receivedAtMs": int(time.time() * 1000),
        }

    return None


async def fetch_nasdaq_daily_history(
    symbol: str,
    start: int,
    end: int,
    bars: int,
) -> list[dict[str, Any]]:
    response = await http.get(
        f"{NASDAQ_API_URL}/quote/{symbol}/historical",
        params={
            "assetclass": "stocks",
            "fromdate": datetime.fromtimestamp(start, timezone.utc).strftime("%Y-%m-%d"),
            "todate": datetime.fromtimestamp(end, timezone.utc).strftime("%Y-%m-%d"),
            "limit": min(max(bars, 20), 5000),
            "offset": 0,
        },
        headers=NASDAQ_HEADERS,
    )

    if response.status_code >= 400:
        raise RuntimeError(
            f"Nasdaq historical HTTP {response.status_code}: {response.text[:300]}"
        )

    body = response.json()
    status = body.get("status") or {}
    if status.get("rCode") not in (None, 200):
        raise RuntimeError(f"Nasdaq historical returned: {status}")

    rows = ((body.get("data") or {}).get("tradesTable") or {}).get("rows") or []
    candles = []
    for row in reversed(rows):
        try:
            day = datetime.strptime(str(row["date"]), "%m/%d/%Y").replace(
                tzinfo=timezone.utc
            )
        except (KeyError, TypeError, ValueError):
            continue

        open_price = parse_market_number(row.get("open"))
        high = parse_market_number(row.get("high"))
        low = parse_market_number(row.get("low"))
        close = parse_market_number(row.get("close"))
        if None in (open_price, high, low, close):
            continue

        candles.append(
            {
                "time": int(day.timestamp()),
                "open": open_price,
                "high": high,
                "low": low,
                "close": close,
                "volume": parse_market_number(row.get("volume")),
            }
        )

    return candles[-bars:] if bars > 0 else candles


class MarketStreamHub:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()
        self.quotes: dict[str, dict[str, Any]] = {}
        self.tasks: list[asyncio.Task[Any]] = []
        self.running = False
        self.last_keys: dict[str, tuple[Any, ...]] = {}
        self.node_status = {
            url: {"connected": False, "messages": 0, "error": ""}
            for url in PYTH_STREAM_ENDPOINTS
        }

    async def start(self) -> None:
        if self.running:
            return

        self.running = True
        if is_local_network():
            for market in MARKETS:
                self.quotes[market.symbol] = local_quote(
                    market.symbol, market.name, market.asset_type
                )
        else:
            for market in MARKETS:
                self.quotes[market.symbol] = fallback_quote(market)
        for index, url in enumerate(PYTH_STREAM_ENDPOINTS):
            if PYTH_PRO_API_KEY:
                self.tasks.append(
                    asyncio.create_task(
                        self._worker(url, index),
                        name=f"custos-pyth-pro-{index}",
                    )
                )

        self.tasks.append(
            asyncio.create_task(
                self._nasdaq_worker(),
                name="custos-nasdaq-equity-fallback",
            )
        )

    async def stop(self) -> None:
        self.running = False
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        self.tasks.clear()

    async def _worker(self, url: str, index: int) -> None:
        backoff = 1.0

        while self.running:
            try:
                async with websocket_connect(
                    url,
                    additional_headers={
                        "Authorization": f"Bearer {PYTH_PRO_API_KEY}",
                        "User-Agent": "CUSTOS-RWA-PERP/1.0",
                    },
                    open_timeout=10,
                    ping_interval=15,
                    ping_timeout=10,
                    compression=None,
                ) as websocket:
                    self.node_status[url]["connected"] = True

                    await websocket.send(
                        json.dumps(
                            {
                                "type": "subscribe",
                                "subscriptionId": 100 + index,
                                "priceFeedIds": [
                                    market.pro_feed_id for market in MARKETS
                                ],
                                "properties": [
                                    "price",
                                    "exponent",
                                    "confidence",
                                    "publisherCount",
                                    "marketSession",
                                    "feedUpdateTimestamp",
                                    "bestBidPrice",
                                    "bestAskPrice",
                                ],
                                "formats": [],
                                "deliveryFormat": "json",
                                "channel": PYTH_STREAM_CHANNEL,
                                "ignoreInvalidFeeds": True,
                            }
                        )
                    )

                    async for raw in websocket:
                        self.node_status[url]["messages"] += 1

                        if isinstance(raw, bytes):
                            raw = raw.decode("utf-8", errors="ignore")

                        try:
                            message = json.loads(raw)
                        except json.JSONDecodeError:
                            continue

                        if message.get("type") == "subscriptionError":
                            raise RuntimeError(
                                "Pyth subscription rejected: "
                                + str(message.get("error") or "Unknown subscription error")[:1024]
                            )

                        if message.get("type") != "streamUpdated":
                            continue

                        await self._ingest(message, url)
                        self.node_status[url]["error"] = ""
                        backoff = 1.0

            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.node_status[url]["error"] = (
                    f"{type(exc).__name__}: {exc}"
                )
            finally:
                self.node_status[url]["connected"] = False

            await asyncio.sleep(backoff)
            backoff = min(15.0, backoff * 1.8)

    async def _nasdaq_worker(self) -> None:
        while self.running:
            for market in MARKETS:
                if market.asset_type != "equity":
                    continue

                try:
                    data = await fetch_nasdaq_chart(market.symbol)
                    quote = latest_quote_from_nasdaq_chart(market, data)
                    if not quote:
                        continue

                    current = self.quotes.get(market.symbol)
                    current_timestamp = int(
                        (current or {}).get("feedUpdateTimestampUs") or 0
                    )
                    if (
                        current
                        and current.get("source") == "pyth-pro-websocket"
                        and current_timestamp >= quote["feedUpdateTimestampUs"]
                    ):
                        continue

                    key = (
                        quote["feedUpdateTimestampUs"],
                        quote["price"],
                        quote["source"],
                    )
                    if self.last_keys.get(market.symbol) == key:
                        continue

                    self.last_keys[market.symbol] = key
                    self.quotes[market.symbol] = quote
                    await self.broadcast({"type": "quote", "quote": quote})
                except asyncio.CancelledError:
                    raise
                except Exception:
                    # Nasdaq is only a UI fallback. Pyth remains the source
                    # of truth for onchain settlement and can recover independently.
                    continue

            try:
                await asyncio.sleep(15)
            except asyncio.CancelledError:
                raise

    async def _ingest(
        self,
        message: dict[str, Any],
        source: str,
    ) -> None:
        parsed = message.get("parsed") or {}
        stream_timestamp = int(parsed.get("timestampUs") or 0)
        feeds = parsed.get("priceFeeds") or []

        for feed in feeds:
            market = BY_PRO.get(int(feed.get("priceFeedId") or -1))
            if not market:
                continue

            try:
                exponent = int(feed["exponent"])
                price = int(feed["price"]) * (10 ** exponent)
            except Exception:
                continue

            update_timestamp = int(
                feed.get("feedUpdateTimestamp")
                or stream_timestamp
            )
            session = str(feed.get("marketSession") or "unknown")

            key = (update_timestamp, price, session)
            if self.last_keys.get(market.symbol) == key:
                continue
            self.last_keys[market.symbol] = key

            quote = {
                "symbol": market.symbol,
                "name": market.name,
                "assetType": market.asset_type,
                "price": price,
                "session": session,
                "streamTimestampUs": stream_timestamp,
                "feedUpdateTimestampUs": update_timestamp,
                "fresh": (
                    update_timestamp == stream_timestamp
                    and session.lower() != "closed"
                ),
                "source": "pyth-pro-websocket",
                "sourceNode": source,
                "channel": PYTH_STREAM_CHANNEL,
                "receivedAtMs": int(time.time() * 1000),
            }

            self.quotes[market.symbol] = quote
            await self.broadcast(
                {"type": "quote", "quote": quote}
            )

    async def broadcast(self, payload: dict[str, Any]) -> None:
        dead: list[WebSocket] = []

        for websocket in list(self.clients):
            try:
                await websocket.send_json(payload)
            except Exception:
                dead.append(websocket)

        for websocket in dead:
            self.clients.discard(websocket)

    def snapshot(self) -> dict[str, Any]:
        return {
            "type": "snapshot",
            "providerConfigured": bool(PYTH_PRO_API_KEY),
            "channel": PYTH_STREAM_CHANNEL,
            "nodes": self.node_status,
            "markets": [
                {
                    **asdict(market),
                    "quote": self.quotes.get(market.symbol),
                }
                for market in MARKETS
            ],
        }


hub = MarketStreamHub()
http = httpx.AsyncClient(timeout=12.0, trust_env=False)


async def start_perp_stream() -> None:
    await hub.start()


async def stop_perp_stream() -> None:
    await hub.stop()
    await http.aclose()


@router.get("/api/perp/health")
async def perp_health() -> dict[str, Any]:
    live = any(q.get("fresh") and q.get("source") == "pyth-pro-websocket"
               and abs(time.time() * 1_000_000 - q.get("feedUpdateTimestampUs", 0)) < 15_000_000
               for q in hub.quotes.values())
    return {
        "ok": True,
        "chainId": int(network_config()["chain_id"]),
        "pythCoreConfigured": bool(PYTH_API_KEY),
        "pythProConfigured": bool(PYTH_PRO_API_KEY),
        "streamChannel": PYTH_STREAM_CHANNEL,
        "pythLive": live,
        "degraded": not is_local_network() and not live,
        "providerErrors": [n["error"] for n in hub.node_status.values() if n.get("error")],
    }


@router.get("/api/markets")
async def perp_markets() -> dict[str, Any]:
    return hub.snapshot()


@router.get("/api/pyth/update/{symbol}")
async def pyth_update(symbol: str) -> dict[str, Any]:
    market = BY_SYMBOL.get(symbol.upper())
    if not market:
        raise HTTPException(status_code=404, detail="Unknown market")

    if is_local_network():
        return {
            "symbol": market.symbol,
            "feedId": market.core_feed_id,
            "updateData": [],
            "parsed": None,
            "source": "local-mock",
        }

    try:
        response = await http.get(
            f"{PYTH_HERMES_URL}/v2/updates/price/latest",
            params=[("ids[]", market.core_feed_id)],
            headers=auth_headers(PYTH_API_KEY),
        )
    except httpx.HTTPError as exc:
        raise HTTPException(503, detail={"code": "PYTH_UNAVAILABLE", "message": "Pyth Core is unavailable. No signed oracle update; transaction not submitted."}) from exc

    if response.status_code >= 400:
        raise HTTPException(503, detail={"code": "PYTH_ENTITLEMENT_REQUIRED" if response.status_code in (401,403) else "PYTH_UNAVAILABLE", "message": "Pyth Core access is unavailable. Configure a credential entitled to this feed. No signed oracle update; transaction not submitted."})

    try:
        body = response.json()
        if not isinstance(body, dict): raise ValueError("Invalid payload")
    except ValueError as exc:
        raise HTTPException(503, detail={"code":"PYTH_INVALID_RESPONSE", "message":"Pyth Core returned invalid data; transaction not submitted."}) from exc
    binary_body = body.get("binary")
    binary = binary_body.get("data") if isinstance(binary_body, dict) else None

    if not isinstance(binary, list) or not binary or not all(isinstance(value, str) and value.removeprefix("0x") and len(value.removeprefix("0x")) % 2 == 0 and all(c in "0123456789abcdefABCDEF" for c in value.removeprefix("0x")) for value in binary):
        raise HTTPException(503, detail={"code":"PYTH_NO_SIGNED_UPDATE", "message":"Pyth Core returned no signed update; transaction not submitted."})

    update_data = [
        value
        if str(value).startswith("0x")
        else "0x" + str(value)
        for value in binary
    ]

    parsed = body.get("parsed") or []
    if not isinstance(parsed, list): parsed = []

    return {
        "symbol": market.symbol,
        "feedId": market.core_feed_id,
        "updateData": update_data,
        "parsed": parsed[0] if parsed else None,
    }


@router.get("/api/history/{symbol}")
async def market_history(
    symbol: str,
    resolution: str = "5m",
    bars: int = 300,
) -> dict[str, Any]:
    market = BY_SYMBOL.get(symbol.upper())
    if not market:
        raise HTTPException(status_code=404, detail="Unknown market")

    history_symbol = PYTH_HISTORY_SYMBOLS.get(market.symbol)
    if not history_symbol:
        raise HTTPException(
            status_code=404,
            detail="No history symbol configured",
        )

    resolution_cfg = PYTH_HISTORY_RESOLUTIONS.get(resolution)
    if not resolution_cfg:
        raise HTTPException(
            status_code=400,
            detail=(
                "Unsupported resolution. Use: "
                + ", ".join(PYTH_HISTORY_RESOLUTIONS)
            ),
        )

    if is_local_network():
        _, seconds_per_bar = resolution_cfg
        return {
            "symbol": market.symbol,
            "historySymbol": market.symbol,
            "resolution": resolution,
            "channel": "local",
            "source": "local-mock",
            "candles": local_candles(market.symbol, bars, seconds_per_bar),
        }

    tv_resolution, seconds_per_bar = resolution_cfg
    bars = max(20, min(int(bars), 500))
    now = int(time.time())
    start = now - seconds_per_bar * bars

    pyth_error = "PYTH_PRO_API_KEY is not configured"

    if PYTH_PRO_API_KEY:
        try:
            response = await http.get(
                f"https://pyth.dourolabs.app/v1/{PYTH_STREAM_CHANNEL}/history",
                params={
                    "symbol": history_symbol,
                    "from": start,
                    "to": now,
                    "resolution": tv_resolution,
                },
                headers={
                    "Authorization": f"Bearer {PYTH_PRO_API_KEY}"
                },
            )

            if response.status_code >= 400:
                pyth_error = "Pyth history access is not entitled for this credential." if response.status_code in (401,403) else "Pyth history provider is temporarily unavailable."
            else:
                body = response.json()
                if body.get("s") == "ok":
                    candles = candles_from_history_body(body)
                    if candles:
                        return {
                            "symbol": market.symbol,
                            "historySymbol": history_symbol,
                            "resolution": resolution,
                            "channel": PYTH_STREAM_CHANNEL,
                            "source": "pyth-pro",
                            "candles": candles,
                        }

                    pyth_error = "Pyth History returned empty candles"
                else:
                    pyth_error = "Pyth history returned no usable candles."
        except Exception as exc:
            pyth_error = "Pyth history provider is temporarily unavailable."

    if market.asset_type == "equity":
        try:
            if resolution == "1d":
                candles = await fetch_nasdaq_daily_history(
                    market.symbol,
                    start,
                    now,
                    bars,
                )
            else:
                data = await fetch_nasdaq_chart(market.symbol)
                candles = candles_from_nasdaq_chart(
                    data,
                    seconds_per_bar,
                    bars,
                )

            if candles:
                return {
                    "symbol": market.symbol,
                    "historySymbol": market.symbol,
                    "resolution": resolution,
                    "channel": "nasdaq-chart",
                    "source": "nasdaq",
                    "sourceNote": (
                        "Nasdaq public quote fallback; Pyth Pro equity history "
                        "is not entitled for this API key."
                    ),
                    "candles": candles,
                }
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail={"code":"HISTORY_UNAVAILABLE", "message":"Pyth and Nasdaq historical data are unavailable. Retry later."},
            ) from exc

    if not PYTH_PRO_API_KEY:
        raise HTTPException(status_code=503, detail={"code":"PYTH_HISTORY_UNAVAILABLE", "message":pyth_error})

    raise HTTPException(status_code=503, detail={"code":"PYTH_HISTORY_UNAVAILABLE", "message":pyth_error})


@router.websocket("/ws/markets")
async def market_socket(websocket: WebSocket) -> None:
    await websocket.accept()
    hub.clients.add(websocket)

    try:
        await websocket.send_json(hub.snapshot())

        while True:
            message = await websocket.receive_text()
            if message == "ping":
                await websocket.send_json(
                    {
                        "type": "pong",
                        "serverTimeMs": int(time.time() * 1000),
                    }
                )

    except WebSocketDisconnect:
        pass
    finally:
        hub.clients.discard(websocket)
