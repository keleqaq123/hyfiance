from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timezone
from dataclasses import dataclass
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException

from local_market_data import local_candles, local_quote
from network_config import is_local_network

router = APIRouter()

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
PYTH_STREAM_CHANNEL = os.getenv(
    "PYTH_STREAM_CHANNEL",
    "fixed_rate@200ms",
)

http = httpx.AsyncClient(timeout=12.0, trust_env=False)


@dataclass(frozen=True)
class RealMarket:
    symbol: str
    name: str
    asset_type: str
    pyth_symbol: str
    unit: str


REAL_MARKETS = [
    RealMarket(
        "XAU",
        "Gold",
        "metal",
        "Metal.XAU/USD",
        "USD / oz",
    ),
    RealMarket(
        "XAG",
        "Silver",
        "metal",
        "Metal.XAG/USD",
        "USD / oz",
    ),
    RealMarket(
        "OIL",
        "WTI Crude Oil",
        "energy",
        "Commodities.WTIX6/USD",
        "USD / barrel",
    ),
]

BY_SYMBOL = {market.symbol: market for market in REAL_MARKETS}


MONTH_CODES = {
    1: "F",
    2: "G",
    3: "H",
    4: "J",
    5: "K",
    6: "M",
    7: "N",
    8: "Q",
    9: "U",
    10: "V",
    11: "X",
    12: "Z",
}


def _add_months(year: int, month: int, offset: int) -> tuple[int, int]:
    total = year * 12 + (month - 1) + offset
    return total // 12, total % 12 + 1


def history_symbols(market: RealMarket) -> list[str]:
    if market.symbol != "OIL":
        return [market.pyth_symbol]

    # History subscriptions expose monthly WTI futures.  Try the configured
    # October 2026 contract first, then current/next contracts as they rotate.
    now = datetime.now(timezone.utc)
    candidates = [market.pyth_symbol]

    for offset in range(0, 5):
        year, month = _add_months(now.year, now.month, offset)
        code = MONTH_CODES[month]
        candidates.append(f"Commodities.WTI{code}{str(year)[-1]}/USD")

    return candidates


def history_channels() -> list[str]:
    ordered = [
        PYTH_STREAM_CHANNEL,
        "fixed_rate@1000ms",
        "fixed_rate@200ms",
    ]
    seen: set[str] = set()
    result: list[str] = []
    for value in ordered:
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result

RESOLUTIONS = {
    "1m": ("1", 60),
    "5m": ("5", 5 * 60),
    "30m": ("30", 30 * 60),
    "2h": ("120", 2 * 60 * 60),
    "6h": ("360", 6 * 60 * 60),
    "1d": ("D", 24 * 60 * 60),
}

_feed_ids: dict[str, str] = {}
_quote_cache: dict[str, dict[str, Any]] = {}
_quote_cache_at = 0.0
_refresh_lock = asyncio.Lock()

FALLBACK_FEEDS = {
    "XAU": "0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2",
    "XAG": "0xf2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e",
    "OIL": "0xf8c2191e76f7f4d5335e7f4e8f81ab0df6360d54ee020874222841894203e9d7",
}

FALLBACK_PRICES = {
    "XAU": 2300.0,
    "XAG": 28.0,
    "OIL": 80.0,
}


def auth_headers(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}"} if key else {}


def normalize_feed_id(value: str) -> str:
    return value if value.startswith("0x") else "0x" + value


async def resolve_feed_id(market: RealMarket) -> str:
    cached = _feed_ids.get(market.symbol)
    if cached:
        return cached

    fallback = FALLBACK_FEEDS.get(market.symbol)
    try:
        response = await http.get(
            f"{PYTH_HERMES_URL}/v2/price_feeds",
            params={"query": market.pyth_symbol},
            headers=auth_headers(PYTH_API_KEY),
        )
    except httpx.HTTPError:
        if fallback:
            _feed_ids[market.symbol] = fallback
            return fallback
        raise

    if response.status_code >= 400:
        if fallback:
            _feed_ids[market.symbol] = fallback
            return fallback
        raise HTTPException(
            status_code=502,
            detail=(
                f"Hermes feed discovery {response.status_code}: "
                f"{response.text[:400]}"
            ),
        )

    rows = response.json()
    match = next(
        (
            row
            for row in rows
            if str((row.get("attributes") or {}).get("symbol", "")).lower()
            == market.pyth_symbol.lower()
        ),
        None,
    )

    if not match or not match.get("id"):
        if fallback:
            _feed_ids[market.symbol] = fallback
            return fallback
        raise HTTPException(
            status_code=502,
            detail=f"No exact Pyth feed found for {market.pyth_symbol}",
        )

    feed_id = normalize_feed_id(str(match["id"]))
    _feed_ids[market.symbol] = feed_id
    return feed_id


def parse_rpc_price(parsed: dict[str, Any]) -> dict[str, Any] | None:
    price_node = parsed.get("price") or {}

    try:
        raw = int(price_node.get("price"))
        expo = int(price_node.get("expo"))
        price = raw * (10 ** expo)
        conf = int(price_node.get("conf") or 0) * (10 ** expo)
        publish_time = int(price_node.get("publish_time") or 0)
    except Exception:
        return None

    if not price or price <= 0:
        return None

    age = max(0, int(time.time()) - publish_time) if publish_time else 0

    return {
        "price": float(price),
        "confidence": abs(float(conf)),
        "session": "regular",
        "fresh": age <= 120 if publish_time else True,
        "source": "Pyth Core",
        "feedUpdateTimestampUs": publish_time * 1_000_000,
        "ageSeconds": age,
    }


def fallback_quote(market: RealMarket) -> dict[str, Any]:
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
        "feedId": FALLBACK_FEEDS[market.symbol],
        "pythSymbol": market.pyth_symbol,
    }


async def refresh_quotes(force: bool = False) -> None:
    global _quote_cache_at

    if not force and _quote_cache and time.monotonic() - _quote_cache_at < 1.5:
        return

    async with _refresh_lock:
        if not force and _quote_cache and time.monotonic() - _quote_cache_at < 1.5:
            return

        if is_local_network():
            for market in REAL_MARKETS:
                quote = local_quote(market.symbol, market.name, market.asset_type)
                quote["feedId"] = FALLBACK_FEEDS[market.symbol]
                quote["pythSymbol"] = market.pyth_symbol
                _quote_cache[market.symbol] = quote
                _feed_ids[market.symbol] = FALLBACK_FEEDS[market.symbol]
            _quote_cache_at = time.monotonic()
            return

        resolved = await asyncio.gather(
            *(resolve_feed_id(market) for market in REAL_MARKETS),
            return_exceptions=True,
        )
        resolved_by_symbol = {
            market.symbol: value
            for market, value in zip(REAL_MARKETS, resolved)
        }
        ids = [
            value
            for value in resolved_by_symbol.values()
            if isinstance(value, str)
        ]
        if not ids:
            for market in REAL_MARKETS:
                _quote_cache[market.symbol] = fallback_quote(market)
            _quote_cache_at = time.monotonic()
            return

        params = [("ids[]", feed_id) for feed_id in ids]
        params.append(("parsed", "true"))

        try:
            response = await http.get(
                f"{PYTH_HERMES_URL}/v2/updates/price/latest",
                params=params,
                headers=auth_headers(PYTH_API_KEY),
            )
        except httpx.HTTPError:
            response = None

        if response is None or response.status_code >= 400:
            for market in REAL_MARKETS:
                _quote_cache[market.symbol] = fallback_quote(market)
            _quote_cache_at = time.monotonic()
            return

        body = response.json()
        parsed_rows = body.get("parsed") or []
        by_id = {
            normalize_feed_id(str(row.get("id", ""))).lower(): row
            for row in parsed_rows
            if row.get("id")
        }

        next_cache: dict[str, dict[str, Any]] = {}

        for market in REAL_MARKETS:
            feed_id = resolved_by_symbol.get(market.symbol)
            if not isinstance(feed_id, str):
                _quote_cache[market.symbol] = fallback_quote(market)
                continue
            row = by_id.get(feed_id.lower())
            quote = parse_rpc_price(row or {}) if row else None
            if quote:
                quote["feedId"] = feed_id
                quote["pythSymbol"] = market.pyth_symbol
                next_cache[market.symbol] = quote
            else:
                next_cache[market.symbol] = fallback_quote(market)

        if next_cache:
            _quote_cache.update(next_cache)
            _quote_cache_at = time.monotonic()


@router.get("/api/real-markets")
async def real_markets() -> dict[str, Any]:
    error = ""

    try:
        await refresh_quotes()
    except HTTPException as exc:
        error = str(exc.detail)
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"

    markets = []

    for market in REAL_MARKETS:
        feed_id = _feed_ids.get(market.symbol)
        quote = _quote_cache.get(market.symbol)
        markets.append(
            {
                "symbol": market.symbol,
                "name": market.name,
                "assetType": market.asset_type,
                "unit": market.unit,
                "pythSymbol": market.pyth_symbol,
                "feedId": feed_id,
                "quote": quote,
            }
        )

    return {
        "ok": bool(_quote_cache),
        "provider": "Pyth Core",
        "markets": markets,
        "error": error or None,
    }


@router.get("/api/real-market/update/{symbol}")
async def real_market_update(symbol: str) -> dict[str, Any]:
    market = BY_SYMBOL.get(symbol.upper())
    if not market:
        raise HTTPException(
            status_code=404,
            detail="Unknown real market. Use XAU, XAG or OIL.",
        )

    feed_id = await resolve_feed_id(market)
    if is_local_network():
        return {
            "symbol": market.symbol,
            "pythSymbol": market.pyth_symbol,
            "feedId": feed_id,
            "updateData": [],
            "parsed": None,
            "source": "local-mock",
        }
    try:
        response = await http.get(
            f"{PYTH_HERMES_URL}/v2/updates/price/latest",
            params=[("ids[]", feed_id), ("parsed", "true")],
            headers=auth_headers(PYTH_API_KEY),
        )
    except httpx.HTTPError as exc:
        response = None
        error_detail = f"{type(exc).__name__}: {exc}"
    else:
        error_detail = f"Hermes {response.status_code}: {response.text[:400]}"

    if response is None or response.status_code >= 400:
        return {
            "symbol": market.symbol,
            "pythSymbol": market.pyth_symbol,
            "feedId": feed_id,
            "updateData": [],
            "parsed": None,
            "source": "testnet-fallback",
            "oracleMode": "fallback",
            "warning": error_detail,
        }

    body = response.json()
    binary = (body.get("binary") or {}).get("data") or []

    if not binary:
        raise HTTPException(
            status_code=502,
            detail="Hermes returned no binary update",
        )

    return {
        "symbol": market.symbol,
        "pythSymbol": market.pyth_symbol,
        "feedId": feed_id,
        "updateData": [
            value if str(value).startswith("0x") else "0x" + str(value)
            for value in binary
        ],
        "parsed": (body.get("parsed") or [None])[0],
    }


@router.get("/api/real-market/history/{symbol}")
async def real_market_history(
    symbol: str,
    resolution: str = "5m",
    bars: int = 300,
) -> dict[str, Any]:
    market = BY_SYMBOL.get(symbol.upper())
    if not market:
        raise HTTPException(
            status_code=404,
            detail="Unknown real market. Use XAU, XAG or OIL.",
        )

    config = RESOLUTIONS.get(resolution)
    if not config:
        raise HTTPException(
            status_code=400,
            detail="Unsupported resolution. Use 1m, 5m, 30m, 2h, 6h or 1d.",
        )

    if is_local_network():
        _, seconds_per_bar = config
        return {
            "symbol": market.symbol,
            "historySymbol": market.symbol,
            "resolution": resolution,
            "channel": "local",
            "source": "local-mock",
            "candles": local_candles(market.symbol, bars, seconds_per_bar),
        }

    if not PYTH_PRO_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="PYTH_PRO_API_KEY is not configured for historical candles",
        )

    tv_resolution, seconds_per_bar = config
    bars = max(20, min(int(bars), 500))
    now = int(time.time())
    start = now - seconds_per_bar * bars

    errors: list[str] = []

    for history_symbol in history_symbols(market):
        for channel in history_channels():
            try:
                response = await http.get(
                    f"https://pyth.dourolabs.app/v1/{channel}/history",
                    params={
                        "symbol": history_symbol,
                        "from": start,
                        "to": now,
                        "resolution": tv_resolution,
                    },
                    headers=auth_headers(PYTH_PRO_API_KEY),
                )
            except Exception as exc:
                errors.append(
                    f"{history_symbol}@{channel}: {type(exc).__name__}: {exc}"
                )
                continue

            if response.status_code >= 400:
                errors.append(
                    f"{history_symbol}@{channel}: HTTP {response.status_code} "
                    f"{response.text[:180]}"
                )
                continue

            body = response.json()
            if body.get("s") != "ok":
                errors.append(
                    f"{history_symbol}@{channel}: {str(body)[:180]}"
                )
                continue

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
                            if index < len(volumes)
                            and volumes[index] is not None
                            else None
                        ),
                    }
                )

            if candles:
                return {
                    "symbol": market.symbol,
                    "pythSymbol": market.pyth_symbol,
                    "historySymbol": history_symbol,
                    "resolution": resolution,
                    "channel": channel,
                    "candles": candles,
                }

            errors.append(f"{history_symbol}@{channel}: empty history")

    raise HTTPException(
        status_code=502,
        detail=(
            "No Pyth historical candles were available for this market. "
            + " | ".join(errors[:8])
        ),
    )
