"""GIWA RWA Exchange demo API.

This service stores asset metadata, market configuration and demo analytics. Swaps and
user protocol actions are executed by connected wallets. The optional testnet faucet
is the explicit exception: a dedicated official signer sponsors native test ETH claims.
It is disabled unless configured and does not handle mainnet funds or legal eligibility.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

# Load apps/api/.env BEFORE importing perp_market.
# perp_market reads its Pyth configuration at module-import time.
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

# Keep Pyth credentials outside the repository when they are shared with the
# deployment scripts.  An explicit process environment variable still wins;
# this only fills values that are not already present.
PYTH_ENV_FILE = os.getenv("PYTH_ENV_FILE", "").strip()
if PYTH_ENV_FILE:
    load_dotenv(PYTH_ENV_FILE)

from network_config import network_config

from perp_market import router as perp_router, start_perp_stream, stop_perp_stream
from real_market import router as real_market_router
from public_beta import router as public_beta_router
from reality import router as reality_router, start_reality_index, stop_reality_index, close_rpc
from faucet import router as faucet_router, start_faucet, stop_faucet

DB_PATH = BASE_DIR / os.getenv("DATABASE_PATH", "rwa_exchange.db")
MARKET_CONFIG_PATH = BASE_DIR / "market-config.json"
_network = network_config()
GIWA_RPC_URL = _network["rpc"]
GIWA_FLASHBLOCKS_RPC_URL = _network["flashblocks_rpc"]
GIWA_EXPLORER_URL = _network["explorer"]
CHAIN_ID = int(_network["chain_id"])

app = FastAPI(
    title="Hyfiance Testnet API",
    version="3.0.0-beta",
    description="Metadata, demo-market quotes and activity for GIWA RWA Exchange.",
)

_default_allowed_origins = [
    "http://127.0.0.1:3001",
    "http://localhost:3001",
    "http://127.0.0.1:3002",
    "http://localhost:3002",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "https://giwa-rwa-exchange.vercel.app",
    "https://keleqaq.xyz",
    "https://www.keleqaq.xyz",
    "https://custosfinance.xyz",
    "https://www.custosfinance.xyz",
]
_configured_allowed_origins = [
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGIN", "").split(",")
    if origin.strip()
]
_allowed_origins = list(dict.fromkeys(_default_allowed_origins + _configured_allowed_origins))

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(perp_router)
app.include_router(real_market_router)
app.include_router(public_beta_router)
app.include_router(reality_router)
app.include_router(faucet_router)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class AssetCreate(BaseModel):
    name: str = Field(min_length=3, max_length=120)
    symbol: str = Field(min_length=3, max_length=14)
    asset_type: str = Field(min_length=3, max_length=60)
    issuer: str = Field(min_length=3, max_length=120)
    verifier: str = Field(default="Pending", max_length=120)
    value_usd: float = Field(gt=0, le=1_000_000_000)
    maturity_date: str
    jurisdiction: str = Field(default="Global", max_length=80)
    document_hash: str = Field(min_length=8, max_length=200)
    metadata_uri: str = Field(default="", max_length=500)
    status: Literal["Draft", "Review", "Verified", "Paused", "Matured"] = "Draft"
    risk_score: Optional[int] = Field(default=None, ge=1, le=99)
    notes: str = Field(default="", max_length=1000)

    @field_validator("symbol")
    @classmethod
    def normalize_symbol(cls, value: str) -> str:
        cleaned = "".join(ch for ch in value.upper() if ch.isalnum() or ch in {"-", "_"})
        if len(cleaned) < 3:
            raise ValueError("symbol must contain at least three valid characters")
        return cleaned

    @field_validator("maturity_date")
    @classmethod
    def validate_maturity(cls, value: str) -> str:
        try:
            datetime.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("maturity_date must use YYYY-MM-DD") from exc
        return value


class HashRequest(BaseModel):
    text: str = Field(min_length=1, max_length=100_000)


class ChainAttachment(BaseModel):
    onchain_asset_id: str = Field(min_length=10, max_length=100)
    token_address: str = Field(default="", max_length=80)
    pool_address: str = Field(default="", max_length=80)
    tx_hash: str = Field(default="", max_length=100)


class VerificationRequest(BaseModel):
    verifier: str = Field(min_length=3, max_length=120)
    status: Literal["Review", "Verified", "Paused", "Matured"] = "Verified"


class SwapQuoteRequest(BaseModel):
    pool_id: int = Field(gt=0)
    side: Literal["buy", "sell"]
    amount_in: float = Field(gt=0, le=100_000_000)
    slippage_bps: int = Field(default=100, ge=1, le=2_000)


class LiquidityQuoteRequest(BaseModel):
    pool_id: int = Field(gt=0)
    amount_quote: float = Field(gt=0, le=100_000_000)


class PoolSyncRequest(BaseModel):
    asset_reserve: float = Field(ge=0)
    quote_reserve: float = Field(ge=0)
    volume_increment: float = Field(default=0, ge=0)


class ActivityCreate(BaseModel):
    wallet: str = Field(default="", max_length=80)
    action: Literal[
        "swap",
        "add_liquidity",
        "remove_liquidity",
        "faucet",
        "register_asset",
        "verify_asset",
        "issue_token",
        "create_pool",
    ]
    pool_id: Optional[int] = Field(default=None, gt=0)
    asset_id: Optional[int] = Field(default=None, gt=0)
    summary: str = Field(min_length=3, max_length=240)
    tx_hash: str = Field(default="", max_length=100)
    execution_mode: Literal["demo", "onchain"] = "demo"


# ---------------------------------------------------------------------------
# Database and configuration
# ---------------------------------------------------------------------------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_text(text: str) -> str:
    return "0x" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in existing:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def load_market_config() -> dict[str, Any]:
    if not MARKET_CONFIG_PATH.exists():
        return {
            "network": {"name": _network["name"], "chainId": CHAIN_ID},
            "contracts": {},
            "markets": [],
        }
    try:
        parsed = json.loads(MARKET_CONFIG_PATH.read_text(encoding="utf-8"))
        if not isinstance(parsed, dict):
            raise ValueError("market config root must be an object")
        return parsed
    except Exception as exc:  # pragma: no cover - defensive error path
        return {
            "network": {"name": _network["name"], "chainId": CHAIN_ID},
            "contracts": {},
            "markets": [],
            "warning": f"Could not read market-config.json: {exc}",
        }


def calculate_risk_score(value_usd: float, status: str, verifier: str, maturity_date: str) -> int:
    score = 48
    if value_usd >= 100_000:
        score += 20
    elif value_usd >= 50_000:
        score += 12
    elif value_usd <= 15_000:
        score -= 5

    status_delta = {"verified": -18, "review": 3, "draft": 10, "paused": 18, "matured": 5}
    score += status_delta.get(status.lower(), 8)
    score += -9 if verifier and verifier.lower() not in {"pending", "none", ""} else 10

    try:
        days_left = (datetime.fromisoformat(maturity_date).date() - datetime.now(timezone.utc).date()).days
        if days_left < 0:
            score += 6
        elif days_left < 30:
            score += 9
        elif days_left > 365:
            score += 5
        else:
            score -= 3
    except ValueError:
        score += 8
    return max(1, min(99, int(score)))


def registry_payload(asset: dict[str, Any]) -> str:
    payload = {
        "assetId": asset.get("onchain_asset_id") or sha256_text(
            f"{asset['symbol']}:{asset['document_hash']}"
        ),
        "name": asset["name"],
        "symbol": asset["symbol"],
        "assetType": asset["asset_type"],
        "issuer": asset["issuer"],
        "valueUsd": asset["value_usd"],
        "maturityDate": asset["maturity_date"],
        "documentHash": asset["document_hash"],
        "riskScore": asset["risk_score"],
        "status": asset["status"],
        "network": network_config()["name"],
    }
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def create_asset_record(conn: sqlite3.Connection, item: dict[str, Any]) -> int:
    data = dict(item)
    data["document_hash"] = data["document_hash"] if data["document_hash"].startswith("0x") else "0x" + data["document_hash"]
    data["risk_score"] = data.get("risk_score") or calculate_risk_score(
        float(data["value_usd"]), data.get("status", "Draft"), data.get("verifier", ""), data["maturity_date"]
    )
    data.setdefault("token_address", "")
    data.setdefault("pool_address", "")
    data.setdefault("onchain_asset_id", "")
    data.setdefault("metadata_uri", "")
    data.setdefault("notes", "")
    data["registry_payload"] = registry_payload(data)
    ts = now_iso()
    cursor = conn.execute(
        """
        INSERT INTO assets (
          name, symbol, asset_type, issuer, verifier, value_usd, maturity_date, jurisdiction,
          document_hash, metadata_uri, status, risk_score, notes, registry_payload,
          onchain_asset_id, token_address, pool_address, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            data["name"], data["symbol"], data["asset_type"], data["issuer"], data.get("verifier", "Pending"),
            float(data["value_usd"]), data["maturity_date"], data.get("jurisdiction", "Global"),
            data["document_hash"], data.get("metadata_uri", ""), data.get("status", "Draft"),
            int(data["risk_score"]), data.get("notes", ""), data["registry_payload"],
            data.get("onchain_asset_id", ""), data.get("token_address", ""), data.get("pool_address", ""),
            ts, ts,
        ),
    )
    conn.commit()
    return int(cursor.lastrowid)


def init_db() -> None:
    conn = get_conn()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS assets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          symbol TEXT NOT NULL UNIQUE,
          asset_type TEXT NOT NULL,
          issuer TEXT NOT NULL,
          verifier TEXT DEFAULT 'Pending',
          value_usd REAL NOT NULL,
          maturity_date TEXT NOT NULL,
          jurisdiction TEXT DEFAULT 'Global',
          document_hash TEXT NOT NULL,
          metadata_uri TEXT DEFAULT '',
          status TEXT NOT NULL,
          risk_score INTEGER NOT NULL,
          notes TEXT DEFAULT '',
          registry_payload TEXT NOT NULL,
          onchain_asset_id TEXT DEFAULT '',
          token_address TEXT DEFAULT '',
          pool_address TEXT DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS pools (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          asset_id INTEGER NOT NULL UNIQUE,
          name TEXT NOT NULL,
          asset_symbol TEXT NOT NULL,
          quote_symbol TEXT NOT NULL DEFAULT 'VerifiedToken',
          asset_reserve REAL NOT NULL,
          quote_reserve REAL NOT NULL,
          fee_bps INTEGER NOT NULL DEFAULT 30,
          volume_24h REAL NOT NULL DEFAULT 0,
          pool_address TEXT DEFAULT '',
          token_address TEXT DEFAULT '',
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS activity (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          wallet TEXT DEFAULT '',
          action TEXT NOT NULL,
          pool_id INTEGER,
          asset_id INTEGER,
          summary TEXT NOT NULL,
          tx_hash TEXT DEFAULT '',
          execution_mode TEXT NOT NULL DEFAULT 'demo',
          created_at TEXT NOT NULL,
          FOREIGN KEY(pool_id) REFERENCES pools(id) ON DELETE SET NULL,
          FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE SET NULL
        )
        """
    )
    # Migration guard for anyone upgrading from the old proof-desk database.
    for column, definition in [
        ("symbol", "TEXT DEFAULT ''"), ("metadata_uri", "TEXT DEFAULT ''"),
        ("onchain_asset_id", "TEXT DEFAULT ''"), ("token_address", "TEXT DEFAULT ''"),
        ("pool_address", "TEXT DEFAULT ''"),
    ]:
        ensure_column(conn, "assets", column, definition)

    count = conn.execute("SELECT COUNT(*) AS c FROM assets").fetchone()["c"]
    if count == 0:
        seeds = [
            {
                "name": "Korea Export Invoice 2026", "symbol": "rKINV26", "asset_type": "Trade Invoice",
                "issuer": "Busan Supply Co.", "verifier": "GIWA Demo Verifier DAO", "value_usd": 24_800,
                "maturity_date": "2026-08-30", "jurisdiction": "KR",
                "document_hash": sha256_text("Busan Supply Co invoice batch 2026-08-30 24800"),
                "metadata_uri": "ipfs://demo/kinv26", "status": "Verified", "risk_score": 31,
                "notes": "Demo trade-receivable market. No legal claim or redemption right.",
            },
            {
                "name": "Solar Equipment Lease", "symbol": "rSOLAR27", "asset_type": "Equipment Lease",
                "issuer": "Green Grid Lab", "verifier": "GIWA Demo Verifier DAO", "value_usd": 51_200,
                "maturity_date": "2027-01-15", "jurisdiction": "SG",
                "document_hash": sha256_text("Green Grid Lab solar lease 2027-01-15 51200"),
                "metadata_uri": "ipfs://demo/solar27", "status": "Verified", "risk_score": 39,
                "notes": "Demo lease-cashflow market. No legal claim or redemption right.",
            },
            {
                "name": "Coffee Supply Receivable", "symbol": "rCOFFEE26", "asset_type": "Supply-chain Receivable",
                "issuer": "Origin Trade Desk", "verifier": "Pending", "value_usd": 9_200,
                "maturity_date": "2026-10-20", "jurisdiction": "Global",
                "document_hash": sha256_text("Origin coffee receivable 2026-10-20 9200"),
                "metadata_uri": "ipfs://demo/coffee26", "status": "Review", "risk_score": 58,
                "notes": "Awaiting verifier review in the demo issuer workflow.",
            },
        ]
        for seed in seeds:
            create_asset_record(conn, seed)

        rows = conn.execute("SELECT id, symbol FROM assets ORDER BY id").fetchall()
        seed_pools = {
            "rKINV26": (20_000.0, 20_000.0, 18_420.0),
            "rSOLAR27": (32_000.0, 31_200.0, 12_640.0),
        }
        for row in rows:
            if row["symbol"] in seed_pools:
                ar, qr, volume = seed_pools[row["symbol"]]
                ts = now_iso()
                conn.execute(
                    """INSERT INTO pools (asset_id, name, asset_symbol, quote_symbol, asset_reserve,
                    quote_reserve, fee_bps, volume_24h, created_at, updated_at)
                    VALUES (?, ?, ?, 'VerifiedToken', ?, ?, 30, ?, ?, ?)""",
                    (row["id"], f"{row['symbol']} / VerifiedToken", row["symbol"], ar, qr, volume, ts, ts),
                )
        conn.commit()

    sync_chain_config(conn)
    conn.commit()
    conn.close()


def sync_chain_config(conn: sqlite3.Connection) -> None:
    """Attach token/pool addresses generated by the bootstrap script, when present."""
    config = load_market_config()
    settlement = config.get("settlementToken", {})
    quote_symbol = str(settlement.get("symbol") or "VerifiedToken")
    for market in config.get("markets", []):
        symbol = market.get("symbol")
        if not symbol:
            continue
        asset = conn.execute("SELECT id FROM assets WHERE symbol = ?", (symbol,)).fetchone()
        if not asset:
            continue
        conn.execute(
            """
            UPDATE assets SET
              name = COALESCE(?, name),
              asset_type = COALESCE(?, asset_type),
              maturity_date = COALESCE(?, maturity_date),
              document_hash = COALESCE(?, document_hash),
              metadata_uri = COALESCE(?, metadata_uri),
              status = COALESCE(?, status),
              risk_score = COALESCE(?, risk_score),
              onchain_asset_id = COALESCE(?, onchain_asset_id),
              token_address = COALESCE(?, token_address),
              pool_address = COALESCE(?, pool_address),
              updated_at = ?
            WHERE id = ?
            """,
            (
                market.get("name"),
                market.get("asset_type"),
                market.get("maturity"),
                market.get("documentHash"),
                market.get("metadataURI"),
                "Verified" if market.get("assetId") else None,
                market.get("risk"),
                market.get("assetId"),
                market.get("tokenAddress"),
                market.get("poolAddress"),
                now_iso(),
                asset["id"],
            ),
        )
        refreshed_asset = conn.execute(
            "SELECT * FROM assets WHERE id = ?", (asset["id"],)
        ).fetchone()
        if refreshed_asset:
            conn.execute(
                "UPDATE assets SET registry_payload = ? WHERE id = ?",
                (registry_payload(dict(refreshed_asset)), asset["id"]),
            )
        pool = conn.execute("SELECT id FROM pools WHERE asset_id = ?", (asset["id"],)).fetchone()
        asset_reserve = market.get("assetLiquidity")
        quote_reserve = market.get("quoteLiquidity")
        if pool:
            conn.execute(
                """
                UPDATE pools SET
                  name = ?, quote_symbol = ?, pool_address = ?, token_address = ?,
                  asset_reserve = COALESCE(?, asset_reserve),
                  quote_reserve = COALESCE(?, quote_reserve),
                  updated_at = ?
                WHERE id = ?
                """,
                (
                    f"{symbol} / {quote_symbol}",
                    quote_symbol,
                    market.get("poolAddress") or None,
                    market.get("tokenAddress") or None,
                    float(asset_reserve) if asset_reserve is not None else None,
                    float(quote_reserve) if quote_reserve is not None else None,
                    now_iso(),
                    pool["id"],
                ),
            )
        elif market.get("poolAddress"):
            conn.execute(
                """INSERT INTO pools (asset_id, name, asset_symbol, quote_symbol, asset_reserve, quote_reserve,
                fee_bps, volume_24h, pool_address, token_address, active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 30, 0, ?, ?, 1, ?, ?)""",
                (
                    asset["id"],
                    f"{symbol} / {quote_symbol}",
                    symbol,
                    quote_symbol,
                    float(market.get("assetLiquidity", 0)),
                    float(market.get("quoteLiquidity", 0)),
                    market.get("poolAddress", ""),
                    market.get("tokenAddress", ""),
                    now_iso(),
                    now_iso(),
                ),
            )


def dict_row(row: Optional[sqlite3.Row]) -> Optional[dict[str, Any]]:
    return dict(row) if row else None


def hydrate_asset(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    pool = conn.execute("SELECT * FROM pools WHERE asset_id = ?", (row["id"],)).fetchone()
    data["pool"] = dict(pool) if pool else None
    return data


def market_row(conn: sqlite3.Connection, pool_id: int) -> sqlite3.Row:
    row = conn.execute(
        """
        SELECT p.*, a.name AS asset_name, a.asset_type, a.issuer, a.verifier, a.maturity_date,
               a.jurisdiction, a.document_hash, a.status, a.risk_score, a.notes, a.onchain_asset_id
        FROM pools p JOIN assets a ON p.asset_id = a.id WHERE p.id = ?
        """,
        (pool_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Pool not found")
    return row


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def startup() -> None:
    init_db()
    await start_perp_stream()
    await start_faucet()
    await start_reality_index()


@app.on_event("shutdown")
async def shutdown() -> None:
    await stop_faucet()
    await stop_reality_index()
    await close_rpc()
    await stop_perp_stream()


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------
@app.get("/")
def root() -> dict[str, Any]:
    return {"ok": True, "service": "GIWA RWA Exchange API", "version": "2.0.0"}


@app.get("/api/health")
def health() -> dict[str, Any]:
    config = load_market_config()
    contracts = config.get("contracts", {})
    network = config.get("network") or {}
    chain_id = int(network.get("chainId") or CHAIN_ID)
    return {
        "ok": True,
        "service": "Hyfiance Testnet API",
        "chainId": chain_id,
        "rpc": GIWA_RPC_URL,
        "flashblocksRpc": GIWA_FLASHBLOCKS_RPC_URL,
        "explorer": GIWA_EXPLORER_URL,
        "contractsConfigured": bool(contracts.get("verifiedToken") and contracts.get("poolFactory")),
        "time": now_iso(),
    }


@app.get("/api/config")
def config() -> dict[str, Any]:
    parsed = load_market_config()
    contracts = parsed.get("contracts", {})
    network = parsed.get("network") or {"name": _network["name"], "chainId": CHAIN_ID}
    return {
        "network": network,
        "contracts": contracts,
        "markets": parsed.get("markets", []),
        "settlementToken": parsed.get("settlementToken", {
            "name": "VerifiedToken",
            "symbol": "VerifiedToken",
            "address": contracts.get("verifiedToken", ""),
            "official": True,
            "claimUrl": "https://sepolia-playground.giwa.io/",
            "claimFlow": "Issue Dojang → Claim VerifiedToken → return to GIWA RWA Exchange",
            "disclaimer": "Official GIWA Playground test token. Testnet-only; not a stablecoin and not USDC.",
        }),
        "demoMode": not bool(contracts.get("verifiedToken") and contracts.get("poolFactory")),
        "warning": parsed.get("warning", ""),
    }


@app.get("/api/overview")
def overview() -> dict[str, Any]:
    conn = get_conn()
    assets = conn.execute("SELECT * FROM assets").fetchall()
    pools = conn.execute("SELECT * FROM pools WHERE active = 1").fetchall()
    activity_count = conn.execute("SELECT COUNT(*) AS c FROM activity").fetchone()["c"]
    conn.close()
    total_tvl = sum(float(pool["quote_reserve"]) * 2 for pool in pools)
    total_volume = sum(float(pool["volume_24h"]) for pool in pools)
    verified = sum(1 for asset in assets if asset["status"] == "Verified")
    avg_risk = round(sum(int(asset["risk_score"]) for asset in assets) / max(1, len(assets)), 1)
    return {
        "totalValueLocked": round(total_tvl, 2),
        "volume24h": round(total_volume, 2),
        "assetCount": len(assets),
        "verifiedAssets": verified,
        "poolCount": len(pools),
        "averageRisk": avg_risk,
        "activityCount": activity_count,
    }


@app.get("/api/assets")
def list_assets(status: Optional[str] = Query(default=None)) -> list[dict[str, Any]]:
    conn = get_conn()
    if status:
        rows = conn.execute("SELECT * FROM assets WHERE status = ? ORDER BY id DESC", (status,)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM assets ORDER BY CASE status WHEN 'Verified' THEN 0 WHEN 'Review' THEN 1 ELSE 2 END, id DESC").fetchall()
    result = [hydrate_asset(conn, row) for row in rows]
    conn.close()
    return result


@app.get("/api/assets/{asset_id}")
def get_asset(asset_id: int) -> dict[str, Any]:
    conn = get_conn()
    row = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Asset not found")
    result = hydrate_asset(conn, row)
    conn.close()
    return result


@app.post("/api/assets", status_code=201)
def create_asset(asset: AssetCreate) -> dict[str, Any]:
    conn = get_conn()
    existing = conn.execute("SELECT id FROM assets WHERE symbol = ?", (asset.symbol,)).fetchone()
    if existing:
        conn.close()
        raise HTTPException(status_code=409, detail="Asset symbol already exists")
    asset_id = create_asset_record(conn, asset.model_dump())
    row = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
    result = hydrate_asset(conn, row)
    conn.close()
    return result


@app.post("/api/assets/{asset_id}/chain")
def attach_chain_data(asset_id: int, attachment: ChainAttachment) -> dict[str, Any]:
    conn = get_conn()
    row = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Asset not found")
    conn.execute(
        """UPDATE assets SET onchain_asset_id = ?, token_address = ?, pool_address = ?, updated_at = ?
        WHERE id = ?""",
        (attachment.onchain_asset_id, attachment.token_address, attachment.pool_address, now_iso(), asset_id),
    )
    if attachment.pool_address:
        existing_pool = conn.execute("SELECT id FROM pools WHERE asset_id = ?", (asset_id,)).fetchone()
        if existing_pool:
            conn.execute(
                "UPDATE pools SET pool_address = ?, token_address = ?, updated_at = ? WHERE asset_id = ?",
                (attachment.pool_address, attachment.token_address, now_iso(), asset_id),
            )
        else:
            conn.execute(
                """INSERT INTO pools (asset_id, name, asset_symbol, quote_symbol, asset_reserve, quote_reserve,
                fee_bps, volume_24h, pool_address, token_address, active, created_at, updated_at)
                SELECT id, symbol || ' / VerifiedToken', symbol, 'VerifiedToken', 0, 0, 30, 0, ?, ?, 1, ?, ?
                FROM assets WHERE id = ?""",
                (attachment.pool_address, attachment.token_address, now_iso(), now_iso(), asset_id),
            )
    conn.execute(
        """INSERT INTO activity (action, asset_id, summary, tx_hash, execution_mode, created_at)
        VALUES ('register_asset', ?, ?, ?, 'onchain', ?)""",
        (asset_id, "Attached on-chain asset data", attachment.tx_hash, now_iso()),
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
    result = hydrate_asset(conn, updated)
    conn.close()
    return result


@app.post("/api/assets/{asset_id}/verify")
def verify_asset(asset_id: int, request: VerificationRequest) -> dict[str, Any]:
    conn = get_conn()
    row = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Asset not found")
    next_risk = calculate_risk_score(row["value_usd"], request.status, request.verifier, row["maturity_date"])
    conn.execute(
        """UPDATE assets SET verifier = ?, status = ?, risk_score = ?, updated_at = ? WHERE id = ?""",
        (request.verifier, request.status, next_risk, now_iso(), asset_id),
    )
    conn.execute(
        """INSERT INTO activity (action, asset_id, summary, execution_mode, created_at)
        VALUES ('verify_asset', ?, ?, 'demo', ?)""",
        (asset_id, f"{request.status} by {request.verifier}", now_iso()),
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
    result = hydrate_asset(conn, updated)
    conn.close()
    return result


@app.post("/api/hash")
def make_hash(request: HashRequest) -> dict[str, Any]:
    return {"hash": sha256_text(request.text), "sourceLength": len(request.text)}


@app.get("/api/pools")
def list_pools() -> list[dict[str, Any]]:
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT p.*, a.name AS asset_name, a.asset_type, a.issuer, a.maturity_date, a.status,
               a.risk_score, a.document_hash, a.jurisdiction, a.verifier
        FROM pools p JOIN assets a ON p.asset_id = a.id
        WHERE p.active = 1 ORDER BY p.volume_24h DESC, p.id DESC
        """
    ).fetchall()
    results = []
    for row in rows:
        data = dict(row)
        data["spot_price"] = round(float(row["quote_reserve"]) / max(float(row["asset_reserve"]), 0.000001), 6)
        data["tvl_usd"] = round(float(row["quote_reserve"]) * 2, 2)
        data["fee_apr_estimate"] = round(
            (float(row["volume_24h"]) * int(row["fee_bps"]) / 10_000 * 365 / max(float(row["quote_reserve"]) * 2, 1)) * 100,
            2,
        )
        results.append(data)
    conn.close()
    return results


@app.get("/api/pools/{pool_id}")
def get_pool(pool_id: int) -> dict[str, Any]:
    conn = get_conn()
    row = market_row(conn, pool_id)
    data = dict(row)
    data["spot_price"] = round(float(row["quote_reserve"]) / max(float(row["asset_reserve"]), 0.000001), 6)
    data["tvl_usd"] = round(float(row["quote_reserve"]) * 2, 2)
    conn.close()
    return data


@app.post("/api/pools/{pool_id}/sync")
def sync_pool(pool_id: int, request: PoolSyncRequest) -> dict[str, Any]:
    conn = get_conn()
    pool = market_row(conn, pool_id)
    conn.execute(
        """UPDATE pools SET asset_reserve = ?, quote_reserve = ?, volume_24h = volume_24h + ?, updated_at = ?
        WHERE id = ?""",
        (request.asset_reserve, request.quote_reserve, request.volume_increment, now_iso(), pool_id),
    )
    conn.commit()
    updated = market_row(conn, pool_id)
    conn.close()
    return dict(updated)


@app.post("/api/quotes/swap")
def quote_swap(request: SwapQuoteRequest) -> dict[str, Any]:
    conn = get_conn()
    pool = market_row(conn, request.pool_id)
    conn.close()
    if not pool["active"]:
        raise HTTPException(status_code=400, detail="Pool is paused")
    reserve_asset = float(pool["asset_reserve"])
    reserve_quote = float(pool["quote_reserve"])
    fee_multiplier = 1 - int(pool["fee_bps"]) / 10_000
    amount_in = float(request.amount_in)
    if request.side == "buy":
        reserve_in, reserve_out = reserve_quote, reserve_asset
        pay_symbol, receive_symbol = pool["quote_symbol"], pool["asset_symbol"]
    else:
        reserve_in, reserve_out = reserve_asset, reserve_quote
        pay_symbol, receive_symbol = pool["asset_symbol"], pool["quote_symbol"]

    amount_with_fee = amount_in * fee_multiplier
    amount_out = (reserve_out * amount_with_fee) / (reserve_in + amount_with_fee)
    if amount_out <= 0 or amount_out >= reserve_out:
        raise HTTPException(status_code=400, detail="Trade size exceeds available liquidity")
    mid_price = reserve_out / reserve_in
    execution_price = amount_out / amount_in
    price_impact = max(0.0, (1 - (execution_price / mid_price)) * 100)
    minimum_received = amount_out * (1 - request.slippage_bps / 10_000)
    fee_paid = amount_in - amount_with_fee
    return {
        "poolId": request.pool_id,
        "executionMode": "demo_quote",
        "paySymbol": pay_symbol,
        "receiveSymbol": receive_symbol,
        "amountIn": round(amount_in, 6),
        "amountOut": round(amount_out, 6),
        "minimumReceived": round(minimum_received, 6),
        "feePaid": round(fee_paid, 6),
        "feeBps": int(pool["fee_bps"]),
        "priceImpactPct": round(price_impact, 4),
        "spotPrice": round(mid_price, 6),
        "route": f"{pool['asset_symbol']} / {pool['quote_symbol']}",
    }


@app.post("/api/quotes/liquidity")
def quote_liquidity(request: LiquidityQuoteRequest) -> dict[str, Any]:
    conn = get_conn()
    pool = market_row(conn, request.pool_id)
    conn.close()
    quote_amount = float(request.amount_quote)
    asset_amount = quote_amount * float(pool["asset_reserve"]) / max(float(pool["quote_reserve"]), 0.000001)
    share = quote_amount / (float(pool["quote_reserve"]) + quote_amount) * 100
    return {
        "poolId": request.pool_id,
        "quoteAmount": round(quote_amount, 6),
        "assetAmount": round(asset_amount, 6),
        "assetSymbol": pool["asset_symbol"],
        "quoteSymbol": pool["quote_symbol"],
        "estimatedPoolSharePct": round(share, 4),
        "feeBps": int(pool["fee_bps"]),
    }


@app.post("/api/activity", status_code=201)
def create_activity(activity: ActivityCreate) -> dict[str, Any]:
    conn = get_conn()
    cursor = conn.execute(
        """INSERT INTO activity (wallet, action, pool_id, asset_id, summary, tx_hash, execution_mode, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            activity.wallet.lower(), activity.action, activity.pool_id, activity.asset_id,
            activity.summary, activity.tx_hash, activity.execution_mode, now_iso(),
        ),
    )
    conn.commit()
    result = conn.execute("SELECT * FROM activity WHERE id = ?", (cursor.lastrowid,)).fetchone()
    conn.close()
    return dict(result)


@app.get("/api/activity")
def list_activity(limit: int = Query(default=20, ge=1, le=100)) -> list[dict[str, Any]]:
    conn = get_conn()
    rows = conn.execute(
        """SELECT a.*, p.name AS pool_name, s.symbol AS asset_symbol
        FROM activity a
        LEFT JOIN pools p ON p.id = a.pool_id
        LEFT JOIN assets s ON s.id = a.asset_id
        ORDER BY a.id DESC LIMIT ?""",
        (limit,),
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


@app.get("/api/portfolio/{wallet}")
def portfolio(wallet: str) -> dict[str, Any]:
    conn = get_conn()
    activities = conn.execute(
        "SELECT * FROM activity WHERE lower(wallet) = lower(?) ORDER BY id DESC LIMIT 50", (wallet,)
    ).fetchall()
    pools = conn.execute("SELECT * FROM pools WHERE active = 1").fetchall()
    conn.close()
    return {
        "wallet": wallet,
        "activity": [dict(row) for row in activities],
        "poolCount": len(pools),
        "note": "Token balances are fetched by the connected wallet in the front end when contracts are configured.",
    }


async def json_rpc(method: str, params: Optional[list[Any]] = None, use_flashblocks: bool = False) -> Any:
    url = GIWA_FLASHBLOCKS_RPC_URL if use_flashblocks else GIWA_RPC_URL
    body = {"jsonrpc": "2.0", "method": method, "params": params or [], "id": 1}
    try:
        async with httpx.AsyncClient(timeout=15, trust_env=False) as client:
            response = await client.post(url, json=body)
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"GIWA RPC unavailable: {exc}") from exc
    if "error" in data:
        raise HTTPException(status_code=400, detail=data["error"])
    return data.get("result")


@app.get("/api/rpc/status")
async def rpc_status() -> dict[str, Any]:
    block_hex = await json_rpc("eth_blockNumber")
    gas_hex = await json_rpc("eth_gasPrice")
    chain_hex = await json_rpc("eth_chainId")
    return {
        "ok": True,
        "chainId": int(chain_hex, 16),
        "blockNumber": int(block_hex, 16),
        "gasPriceWei": int(gas_hex, 16),
        "gasPriceGwei": round(int(gas_hex, 16) / 1_000_000_000, 4),
        "rpc": GIWA_RPC_URL,
        "flashblocksRpc": GIWA_FLASHBLOCKS_RPC_URL,
    }


@app.get("/api/rpc/balance/{address}")
async def wallet_balance(address: str) -> dict[str, Any]:
    if not address.startswith("0x") or len(address) != 42:
        raise HTTPException(status_code=400, detail="Invalid EVM address")
    balance_hex = await json_rpc("eth_getBalance", [address, "latest"])
    wei = int(balance_hex, 16)
    return {"address": address, "wei": wei, "eth": wei / 1_000_000_000_000_000_000}
