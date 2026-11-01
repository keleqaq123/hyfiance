"""Same-origin frontend/API entrypoint for the independent Hyfiance deployment."""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
os.environ.setdefault('CUSTOS_CHAIN_ID', '99801')
if os.environ['CUSTOS_CHAIN_ID'] != '99801':
    raise RuntimeError('Hyfiance hosting requires Elysium Testnet (99801)')

# Render free services have ephemeral filesystems. Refuse to silently store
# project records/uploads there. Provision an external PostgreSQL DB and GCS.
if os.getenv('RENDER'):
    if not os.getenv('REALITY_DATABASE_URL', '').startswith('postgresql') or not os.getenv('REALITY_GCS_BUCKET'):
        raise RuntimeError('Configure persistent REALITY_DATABASE_URL and REALITY_GCS_BUCKET before hosting')

deployment = json.loads((ROOT / 'deployments/elysium-testnet.json').read_text(encoding='utf-8'))
contracts = deployment['contracts']
for key, value in {
    'REALITY_LAUNCHPAD_ADDRESS': contracts['launchpad'],
    'REALITY_SWAP_ROUTER': contracts['router'],
    'REALITY_SWAP_FACTORY': contracts['factory'],
    'REALITY_WETH': contracts['weth'],
    'REALITY_CFI_STAKING': contracts['cfi'],
    'REALITY_CFI_PRICE_SOURCE': 'hyperliquid',
    'REALITY_CFI_START_BLOCK': str(deployment['receipts']['cfi']['blockNumber']),
}.items():
    os.environ.setdefault(key, value)

from main import app  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

# Preserve /api and its JSON 404s; only non-API paths serve the frontend.
app.router.routes = [route for route in app.router.routes if getattr(route, 'path', '') != '/']

@app.api_route('/api/{path:path}', methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'], include_in_schema=False)
def missing_api(path: str):
    from fastapi import HTTPException
    raise HTTPException(404, 'Not found')

app.mount('/', StaticFiles(directory=ROOT / 'apps/web/dist', html=True), name='frontend')
