from __future__ import annotations

import secrets
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from network_config import network_config

router = APIRouter(prefix="/api/beta", tags=["Custos Finance Public Beta"])

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / os.getenv("BETA_DATABASE_PATH", "kelq_beta.db")
CONFIG_PATH = BASE_DIR / "beta-contracts.generated.json"
CHAIN_ID = int(network_config()["chain_id"])

RPC_URLS = []
for candidate in [
    os.getenv("GIWA_RPC_URL", "https://sepolia-rpc.giwa.io"),
    os.getenv("GIWA_FLASHBLOCKS_RPC_URL", "https://sepolia-rpc-flashblocks.giwa.io"),
]:
    if candidate and candidate not in RPC_URLS:
        RPC_URLS.append(candidate)

ACTION_RULES: dict[str, tuple[int, int]] = {
    "faucet": (10, 1),
    "spot_trade": (50, 20),
    "add_liquidity": (100, 5),
    "remove_liquidity": (10, 5),
    "perp_deposit": (25, 3),
    "perp_withdraw": (0, 10),
    "perp_open": (75, 20),
    "perp_close": (25, 20),
    "tpsl": (30, 10),
}
REFERRAL_BONUS = 100
REFERRED_USER_BONUS = 0


class BetaClaim(BaseModel):
    wallet: str = Field(min_length=42, max_length=42)
    action: Literal[
        "faucet",
        "spot_trade",
        "add_liquidity",
        "remove_liquidity",
        "perp_deposit",
        "perp_withdraw",
        "perp_open",
        "perp_close",
        "tpsl",
    ]
    tx_hash: str = Field(min_length=66, max_length=66)
    ref_code: str = Field(default="", max_length=32)

    @field_validator("wallet")
    @classmethod
    def valid_wallet(cls, value: str) -> str:
        value = value.lower()
        if not value.startswith("0x") or any(ch not in "0123456789abcdef" for ch in value[2:]):
            raise ValueError("Invalid EVM wallet")
        return value

    @field_validator("tx_hash")
    @classmethod
    def valid_hash(cls, value: str) -> str:
        value = value.lower()
        if not value.startswith("0x") or any(ch not in "0123456789abcdef" for ch in value[2:]):
            raise ValueError("Invalid transaction hash")
        return value

    @field_validator("ref_code")
    @classmethod
    def normalize_ref(cls, value: str) -> str:
        return "".join(ch for ch in value.upper() if ch.isalnum())[:32]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_conn()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS beta_profiles (
          wallet TEXT PRIMARY KEY,
          referral_code TEXT NOT NULL UNIQUE,
          referrer_wallet TEXT DEFAULT '',
          created_at TEXT NOT NULL,
          first_verified_at TEXT DEFAULT ''
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS beta_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          wallet TEXT NOT NULL,
          action TEXT NOT NULL,
          tx_hash TEXT NOT NULL UNIQUE,
          points INTEGER NOT NULL DEFAULT 0,
          metadata TEXT DEFAULT '{}',
          created_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS beta_events_wallet_idx ON beta_events(wallet)")
    conn.execute("CREATE INDEX IF NOT EXISTS beta_events_action_idx ON beta_events(action)")
    conn.commit()
    conn.close()


init_db()


REFERRAL_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def generate_referral_code(conn: sqlite3.Connection) -> str:
    """Create a short, human-readable code that is unique in the Season database."""
    for _ in range(100):
        suffix = "".join(secrets.choice(REFERRAL_ALPHABET) for _ in range(8))
        code = f"CUSTOS{suffix}"
        exists = conn.execute(
            "SELECT 1 FROM beta_profiles WHERE referral_code = ?",
            (code,),
        ).fetchone()
        if not exists:
            return code
    raise RuntimeError("Unable to generate a unique referral code")


def migrate_legacy_referral_codes(conn: sqlite3.Connection) -> None:
    """
    Public Beta was not launched when Custos Finance replaced the KELQ brand.
    Upgrade unqualified legacy KELQ codes so existing local test profiles also
    receive a Custos-branded unique invite code.
    """
    rows = conn.execute(
        """
        SELECT wallet
        FROM beta_profiles
        WHERE referral_code LIKE 'KELQ%'
          AND first_verified_at = ''
          AND referrer_wallet = ''
        """
    ).fetchall()

    for row in rows:
        conn.execute(
            "UPDATE beta_profiles SET referral_code = ? WHERE wallet = ?",
            (generate_referral_code(conn), row["wallet"]),
        )
    conn.commit()


def ensure_profile(conn: sqlite3.Connection, wallet: str) -> sqlite3.Row:
    wallet = wallet.lower()
    row = conn.execute(
        "SELECT * FROM beta_profiles WHERE wallet = ?",
        (wallet,),
    ).fetchone()
    if row:
        return row

    conn.execute(
        "INSERT INTO beta_profiles (wallet, referral_code, created_at) VALUES (?, ?, ?)",
        (wallet, generate_referral_code(conn), now_iso()),
    )
    conn.commit()
    return conn.execute(
        "SELECT * FROM beta_profiles WHERE wallet = ?",
        (wallet,),
    ).fetchone()


_migration_conn = get_conn()
try:
    migrate_legacy_referral_codes(_migration_conn)
finally:
    _migration_conn.close()


def load_contract_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        return {"ready": False, "chainId": CHAIN_ID, "actions": {}}
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        data["ready"] = bool(data.get("actions"))
        return data
    except Exception as exc:
        return {"ready": False, "chainId": CHAIN_ID, "actions": {}, "error": str(exc)}


async def rpc_call(method: str, params: list[Any]) -> Any:
    errors: list[str] = []
    async with httpx.AsyncClient(timeout=12.0, trust_env=False) as client:
        for url in RPC_URLS:
            try:
                response = await client.post(
                    url,
                    json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
                )
                if response.status_code >= 400:
                    errors.append(f"{url}: HTTP {response.status_code}")
                    continue
                try:
                    body = response.json()
                except Exception:
                    errors.append(f"{url}: non-JSON response")
                    continue
                if body.get("error"):
                    errors.append(f"{url}: {body['error']}")
                    continue
                return body.get("result")
            except Exception as exc:
                errors.append(f"{url}: {type(exc).__name__}: {exc}")
    raise HTTPException(status_code=502, detail="GIWA RPC unavailable: " + " | ".join(errors))


def hex_status_ok(value: Any) -> bool:
    if isinstance(value, int):
        return value == 1
    if isinstance(value, str):
        try:
            return int(value, 16) == 1
        except ValueError:
            return False
    return False


async def verify_transaction(claim: BetaClaim) -> dict[str, Any]:
    config = load_contract_config()
    if not config.get("ready"):
        raise HTTPException(
            status_code=503,
            detail="Public Beta contract verification is not configured yet. Deploy V3 Spot first so beta-contracts.generated.json is created.",
        )

    action_config = (config.get("actions") or {}).get(claim.action)
    if not action_config:
        raise HTTPException(status_code=400, detail="Unsupported beta action")

    tx = await rpc_call("eth_getTransactionByHash", [claim.tx_hash])
    receipt = await rpc_call("eth_getTransactionReceipt", [claim.tx_hash])

    if not tx or not receipt:
        raise HTTPException(status_code=409, detail="Transaction is not indexed by GIWA RPC yet. Retry in a few seconds.")
    if not hex_status_ok(receipt.get("status")):
        raise HTTPException(status_code=400, detail="Transaction reverted onchain")

    sender = str(tx.get("from") or "").lower()
    target = str(tx.get("to") or "").lower()
    calldata = str(tx.get("input") or "").lower()

    if sender != claim.wallet.lower():
        raise HTTPException(status_code=403, detail="Transaction sender does not match wallet")

    allowed_targets = {str(value).lower() for value in action_config.get("targets", [])}
    allowed_selectors = {str(value).lower() for value in action_config.get("selectors", [])}

    if target not in allowed_targets:
        raise HTTPException(status_code=400, detail="Transaction target does not match this Custos Finance action")
    if not any(calldata.startswith(selector) for selector in allowed_selectors):
        raise HTTPException(status_code=400, detail="Transaction function does not match this Custos Finance action")

    chain_hex = await rpc_call("eth_chainId", [])
    if int(chain_hex, 16) != int(config.get("chainId", CHAIN_ID)):
        raise HTTPException(status_code=400, detail="Wrong chain")

    return {
        "blockNumber": int(str(receipt.get("blockNumber") or "0x0"), 16),
        "target": target,
        "selector": calldata[:10],
    }


def profile_payload(conn: sqlite3.Connection, wallet: str) -> dict[str, Any]:
    row = ensure_profile(conn, wallet)
    wallet = wallet.lower()
    totals = conn.execute(
        "SELECT COALESCE(SUM(points), 0) AS points, COUNT(*) AS txs FROM beta_events WHERE wallet = ?",
        (wallet,),
    ).fetchone()
    referrals = conn.execute(
        "SELECT COUNT(*) AS c FROM beta_profiles WHERE referrer_wallet = ? AND first_verified_at != ''",
        (wallet,),
    ).fetchone()["c"]
    rank = conn.execute(
        """
        WITH scores AS (
          SELECT wallet, SUM(points) AS points
          FROM beta_events
          GROUP BY wallet
        )
        SELECT 1 + COUNT(*) AS rank
        FROM scores
        WHERE points > COALESCE((SELECT SUM(points) FROM beta_events WHERE wallet = ?), 0)
        """,
        (wallet,),
    ).fetchone()["rank"]
    return {
        "wallet": wallet,
        "referralCode": row["referral_code"],
        "referrerWallet": row["referrer_wallet"],
        "points": int(totals["points"]),
        "verifiedTransactions": int(totals["txs"]),
        "qualifiedReferrals": int(referrals),
        "rank": int(rank),
        "qualified": bool(row["first_verified_at"]),
        "season": "S1",
    }


@router.get("/config")
def beta_config() -> dict[str, Any]:
    config = load_contract_config()
    chain_id = int(config.get("chainId") or network_config()["chain_id"])
    return {
        "season": "S1",
        "chainId": chain_id,
        "verificationReady": bool(config.get("ready")),
        "pointsDisclaimer": "Testnet participation points only. No token, airdrop, reward, or monetary value is promised.",
        "rules": [
            {"action": action, "points": rule[0], "cap": rule[1]}
            for action, rule in ACTION_RULES.items()
            if rule[0] > 0
        ],
        "referralBonus": REFERRAL_BONUS,
        "referredUserBonus": REFERRED_USER_BONUS,
    }


@router.get("/profile/{wallet}")
def get_profile(wallet: str) -> dict[str, Any]:
    wallet = wallet.lower()
    if len(wallet) != 42 or not wallet.startswith("0x"):
        raise HTTPException(status_code=400, detail="Invalid wallet")
    conn = get_conn()
    result = profile_payload(conn, wallet)
    conn.close()
    return result


@router.get("/leaderboard")
def leaderboard(limit: int = Query(default=25, ge=1, le=100)) -> dict[str, Any]:
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT p.wallet, p.referral_code,
               COALESCE(SUM(e.points), 0) AS points,
               COUNT(e.id) AS verified_txs,
               (SELECT COUNT(*) FROM beta_profiles r
                 WHERE r.referrer_wallet = p.wallet AND r.first_verified_at != '') AS referrals
        FROM beta_profiles p
        LEFT JOIN beta_events e ON e.wallet = p.wallet
        GROUP BY p.wallet
        HAVING verified_txs > 0
        ORDER BY points DESC, verified_txs DESC, p.first_verified_at ASC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    conn.close()
    return {
        "season": "S1",
        "entries": [
            {
                "rank": index + 1,
                "wallet": row["wallet"],
                "points": int(row["points"]),
                "verifiedTransactions": int(row["verified_txs"]),
                "qualifiedReferrals": int(row["referrals"]),
            }
            for index, row in enumerate(rows)
        ],
    }


@router.get("/stats")
def beta_stats() -> dict[str, Any]:
    conn = get_conn()
    participants = conn.execute(
        "SELECT COUNT(DISTINCT wallet) AS c FROM beta_events WHERE action NOT IN ('referral_bonus', 'referred_bonus')"
    ).fetchone()["c"]
    txs = conn.execute(
        "SELECT COUNT(*) AS c FROM beta_events WHERE action NOT IN ('referral_bonus', 'referred_bonus')"
    ).fetchone()["c"]
    points = conn.execute("SELECT COALESCE(SUM(points), 0) AS s FROM beta_events").fetchone()["s"]
    referrals = conn.execute(
        "SELECT COUNT(*) AS c FROM beta_profiles WHERE referrer_wallet != '' AND first_verified_at != ''"
    ).fetchone()["c"]
    recent = conn.execute(
        """
        SELECT wallet, action, points, tx_hash, created_at
        FROM beta_events
        WHERE action NOT IN ('referral_bonus', 'referred_bonus')
        ORDER BY id DESC LIMIT 12
        """
    ).fetchall()
    conn.close()
    return {
        "season": "S1",
        "participants": int(participants),
        "verifiedTransactions": int(txs),
        "pointsIssued": int(points),
        "qualifiedReferrals": int(referrals),
        "recent": [dict(row) for row in recent],
    }


@router.post("/claim")
async def claim_points(claim: BetaClaim) -> dict[str, Any]:
    verified = await verify_transaction(claim)
    conn = get_conn()

    existing = conn.execute("SELECT * FROM beta_events WHERE tx_hash = ?", (claim.tx_hash,)).fetchone()
    if existing:
        result = profile_payload(conn, claim.wallet)
        conn.close()
        return {"ok": True, "duplicate": True, "awarded": 0, "profile": result}

    profile = ensure_profile(conn, claim.wallet)
    first_verified = not bool(profile["first_verified_at"])

    if first_verified and claim.ref_code:
        inviter = conn.execute(
            "SELECT wallet FROM beta_profiles WHERE referral_code = ?",
            (claim.ref_code,),
        ).fetchone()
        if inviter and inviter["wallet"] != claim.wallet:
            conn.execute(
                "UPDATE beta_profiles SET referrer_wallet = ? WHERE wallet = ? AND referrer_wallet = ''",
                (inviter["wallet"], claim.wallet),
            )

    points, cap = ACTION_RULES[claim.action]
    prior_count = conn.execute(
        "SELECT COUNT(*) AS c FROM beta_events WHERE wallet = ? AND action = ?",
        (claim.wallet, claim.action),
    ).fetchone()["c"]
    awarded = points if prior_count < cap else 0

    conn.execute(
        "INSERT INTO beta_events (wallet, action, tx_hash, points, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (
            claim.wallet,
            claim.action,
            claim.tx_hash,
            awarded,
            json.dumps(verified, separators=(",", ":")),
            now_iso(),
        ),
    )

    if first_verified:
        conn.execute(
            "UPDATE beta_profiles SET first_verified_at = ? WHERE wallet = ?",
            (now_iso(), claim.wallet),
        )
        refreshed = conn.execute("SELECT * FROM beta_profiles WHERE wallet = ?", (claim.wallet,)).fetchone()
        referrer = refreshed["referrer_wallet"]
        if referrer:
            conn.execute(
                "INSERT OR IGNORE INTO beta_events (wallet, action, tx_hash, points, metadata, created_at) VALUES (?, 'referral_bonus', ?, ?, '{}', ?)",
                (referrer, f"referral:{claim.wallet}", REFERRAL_BONUS, now_iso()),
            )

    conn.commit()
    result = profile_payload(conn, claim.wallet)
    conn.close()
    return {
        "ok": True,
        "duplicate": False,
        "awarded": awarded,
        "profile": result,
        "verified": verified,
    }
