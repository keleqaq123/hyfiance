#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANDING_CONFIG="scripts/branding.config.json"
START_FRONTEND=1
INSTALL_FRONTEND=1
START_BACKEND=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branding-config)
      BRANDING_CONFIG="$2"
      shift 2
      ;;
    --no-start-frontend)
      START_FRONTEND=0
      shift
      ;;
    --no-start-backend)
      START_BACKEND=0
      shift
      ;;
    --skip-install)
      INSTALL_FRONTEND=0
      shift
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

wait_for_rpc() {
  local retries=40
  local response=''
  for _ in $(seq 1 "$retries"); do
    response="$(curl -sS --max-time 5 -X POST http://127.0.0.1:7545 \
      -H 'Content-Type: application/json' \
      --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
      2>/dev/null || true)"
    if [[ "$response" == *'"result"'* ]]; then break; fi
    sleep 1
  done

  if [[ "$response" != *'"result"'* ]]; then
    echo "RPC not ready at http://127.0.0.1:7545"
    exit 1
  fi
}

wait_for_http() {
  local url="$1"
  local retries="${2:-30}"
  local response=''
  for _ in $(seq 1 "$retries"); do
    response="$(curl -sS --max-time 5 "$url" 2>/dev/null || true)"
    if [[ -n "$response" ]]; then return 0; fi
    sleep 1
  done
  return 1
}

echo "[1/10] Apply branding config: $BRANDING_CONFIG"
cd "$ROOT_DIR"
node scripts/apply-branding.js "$BRANDING_CONFIG"

echo "[2/10] Ensure local hardhat node is running"
if ! lsof -iTCP:7545 -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  cd "$ROOT_DIR/contracts/swap"
  nohup npx hardhat node --hostname 127.0.0.1 --port 7545 >/tmp/custoswap-hardhat.log 2>&1 &
  echo $! >/tmp/custoswap-hardhat.pid
  echo "Started hardhat node, pid=$(cat /tmp/custoswap-hardhat.pid), log=/tmp/custoswap-hardhat.log"
else
  echo "Port 7545 is already in use, reuse existing node"
fi
wait_for_rpc

echo "[3/10] Deploy local Swap contracts"
cd "$ROOT_DIR/contracts/swap"
npx hardhat run --network local scripts/deploy-local-uniswap.js

echo "[4/10] Sync Swap addresses/config to SDK + interface"
cd "$ROOT_DIR"
node scripts/sync-local-config.js \
  --branding-config "$BRANDING_CONFIG" \
  --rpc-url http://127.0.0.1:7545 \
  --frontend-url http://127.0.0.1:3001

echo "[5/10] Build local SDK"
cd "$ROOT_DIR/packages/swap-sdk"
yarn install --frozen-lockfile --ignore-scripts
yarn build

if [[ "$INSTALL_FRONTEND" -eq 1 ]]; then
  echo "[6/10] Install interface dependencies"
  cd "$ROOT_DIR/apps/web"
  yarn install --frozen-lockfile --ignore-scripts
else
  echo "[6/10] Skip interface install"
fi

echo "[7/10] Deploy local market contracts"
cd "$ROOT_DIR/contracts/markets"
npm run deploy:local:rpc

if [[ "$START_BACKEND" -eq 1 ]]; then
  echo "[8/10] Ensure Custos API is running"
  if lsof -iTCP:8001 -sTCP:LISTEN -n -P >/dev/null 2>&1; then
    echo "Port 8001 is already in use, reuse existing API"
  else
    if [[ ! -x "$ROOT_DIR/apps/api/.venv/bin/python" ]]; then
      echo "Missing API virtualenv at $ROOT_DIR/apps/api/.venv"
      echo "Create it with: python3 -m venv apps/api/.venv && apps/api/.venv/bin/pip install -r apps/api/requirements.txt"
      exit 1
    fi
    cd "$ROOT_DIR/apps/api"
    nohup .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8001 >/tmp/custos-api.log 2>&1 &
    api_pid="$!"
    echo "$api_pid" >/tmp/custos-api.pid
    echo "Started Custos API, pid=$api_pid, log=/tmp/custos-api.log"
  fi

  if ! wait_for_http http://127.0.0.1:8001/api/health 30; then
    echo "Custos API did not become ready; see /tmp/custos-api.log"
    exit 1
  fi
else
  echo "[8/10] Skip API startup"
fi

echo "[9/10] Verify on-chain interaction (swap test)"
cd "$ROOT_DIR/contracts/swap"
npx hardhat run --network local scripts/verify-local-interactions.js

if [[ "$START_FRONTEND" -eq 1 ]]; then
  echo "[10/10] Start interface"
  frontend_pid=''
  if lsof -iTCP:3001 -sTCP:LISTEN -n -P >/dev/null 2>&1; then
    echo "Port 3001 is already in use, reuse existing frontend"
  else
    cd "$ROOT_DIR/apps/web"
    nohup yarn start >/tmp/custoswap-frontend.log 2>&1 &
    frontend_pid="$!"
    echo "$frontend_pid" >/tmp/custoswap-frontend.pid
  fi

  if ! wait_for_http http://127.0.0.1:3001 30; then
    echo "Frontend did not become ready; see /tmp/custoswap-frontend.log"
    exit 1
  fi

  if [[ -z "$frontend_pid" && -f /tmp/custoswap-frontend.pid ]]; then
    frontend_pid="$(cat /tmp/custoswap-frontend.pid)"
  fi
  echo "Frontend pid=${frontend_pid:-existing}, url=http://127.0.0.1:3001, log=/tmp/custoswap-frontend.log"
else
  echo "[10/10] Skip frontend startup"
fi

echo "Done."
