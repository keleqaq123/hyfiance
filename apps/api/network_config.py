"""Runtime network settings shared by the Custos API modules.

The market deployment writer records the selected chain in ``market-config.json``.
Keeping the lookup here prevents the API from accidentally reporting GIWA while it
is serving a local Anvil deployment (or vice versa).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
MARKET_CONFIG_PATH = BASE_DIR / "market-config.json"
LOCAL_CHAIN_ID = 47805
GIWA_CHAIN_ID = 91342


def _read_market_config() -> dict[str, Any]:
    try:
        value = json.loads(MARKET_CONFIG_PATH.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def _env_chain_id() -> int | None:
    for key in ("CUSTOS_CHAIN_ID", "CHAIN_ID"):
        raw = os.getenv(key, "").strip()
        if not raw:
            continue
        try:
            return int(raw, 0)
        except ValueError:
            continue
    return None


def network_config() -> dict[str, Any]:
    config = _read_market_config()
    configured_network = config.get("network")
    configured_network = configured_network if isinstance(configured_network, dict) else {}

    chain_id = _env_chain_id() or int(
        configured_network.get("chainId") or GIWA_CHAIN_ID
    )
    default_name = "Custos Local" if chain_id == LOCAL_CHAIN_ID else "GIWA Sepolia"
    name = str(
        os.getenv("CUSTOS_NETWORK_NAME", "").strip()
        or configured_network.get("name")
        or default_name
    )

    default_rpc = "http://127.0.0.1:7545" if chain_id == LOCAL_CHAIN_ID else "https://sepolia-rpc.giwa.io"
    default_flashblocks = (
        default_rpc
        if chain_id == LOCAL_CHAIN_ID
        else "https://sepolia-rpc-flashblocks.giwa.io"
    )
    default_explorer = "" if chain_id == LOCAL_CHAIN_ID else "https://sepolia-explorer.giwa.io"

    return {
        "name": name,
        "chain_id": chain_id,
        "rpc": os.getenv("GIWA_RPC_URL", default_rpc).strip() or default_rpc,
        "flashblocks_rpc": os.getenv(
            "GIWA_FLASHBLOCKS_RPC_URL", default_flashblocks
        ).strip()
        or default_flashblocks,
        "explorer": os.getenv("GIWA_EXPLORER_URL", default_explorer).strip()
        or default_explorer,
        "local": chain_id == LOCAL_CHAIN_ID,
    }


def is_local_network() -> bool:
    return bool(network_config()["local"])
