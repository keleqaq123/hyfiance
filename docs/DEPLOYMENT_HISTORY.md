# Market deployment history

`deployment-history.json` is the persistent record for the Spot, Perps and RWA
market deployment scripts. A deployment is written as `in_progress` before the
first transaction, then updated to `success` or `failed` when the script exits.

The latest generated address files are intentionally runtime artifacts and may
be ignored by Git. The history file is tracked so a context restart or
conversation compression does not lose the fact that a deployment happened.

Run the deployment from `contracts/markets/` with the appropriate network
script. Do not copy private keys or API keys into this document.

When the Pyth credential is stored in a separate backend env file, pass only
its path to Hardhat:

```bash
PYTH_ENV_FILE=/path/to/backend/.env \
CUSTOS_MARKETS_ENV=/path/to/contracts/.env \
npm run deploy:giwa
```

The API accepts the same `PYTH_ENV_FILE` variable. This lets `PYTH_API_KEY`
and `PYTH_PRO_API_KEY` remain outside the repository while enabling Hermes,
Pyth Pro history and the market stream:

```bash
PYTH_ENV_FILE=/path/to/backend/.env \
  .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8001
```
