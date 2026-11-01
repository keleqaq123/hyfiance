"""Deterministic local market data used with the local MockOracle deployment."""

from __future__ import annotations

import time
from typing import Any

LOCAL_PRICES: dict[str, float] = {
    "BTC": 100_000.0,
    "ETH": 4_000.0,
    "SOL": 200.0,
    "AAPL": 220.0,
    "NVDA": 180.0,
    "XAU": 2_300.0,
    "XAG": 28.0,
    "OIL": 75.0,
}


def local_quote(symbol: str, name: str, asset_type: str) -> dict[str, Any]:
    now_us = int(time.time() * 1_000_000)
    return {
        "symbol": symbol,
        "name": name,
        "assetType": asset_type,
        "price": LOCAL_PRICES[symbol],
        "session": "local",
        "streamTimestampUs": now_us,
        "feedUpdateTimestampUs": now_us,
        "fresh": True,
        "source": "local-mock",
        "sourceNode": "MockOracleRouter",
        "channel": "local",
        "receivedAtMs": int(time.time() * 1000),
        "ageSeconds": 0,
    }


def local_candles(symbol: str, bars: int, seconds_per_bar: int) -> list[dict[str, Any]]:
    """Return stable, visibly moving candles so local charts exercise real rendering."""
    bars = max(20, min(int(bars), 500))
    base = LOCAL_PRICES[symbol]
    now = int(time.time())
    start = now - seconds_per_bar * bars
    candles: list[dict[str, Any]] = []

    for index in range(bars):
        wave = ((index % 17) - 8) / 800
        drift = (index / max(1, bars - 1) - 0.5) / 120
        open_price = base * (1 + wave + drift)
        close_price = open_price * (1 + (((index * 7) % 11) - 5) / 2_000)
        high = max(open_price, close_price) * 1.0015
        low = min(open_price, close_price) * 0.9985
        candles.append(
            {
                "time": start + index * seconds_per_bar,
                "open": round(open_price, 8),
                "high": round(high, 8),
                "low": round(low, 8),
                "close": round(close_price, 8),
                "volume": None,
            }
        )

    return candles
