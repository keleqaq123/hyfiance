"""Invoked only by the local Ganache integration script, never a public send."""
import asyncio
import json
import sys
import tempfile
from pathlib import Path

import httpx
from fastapi import FastAPI
import faucet as f


async def main():
    fixture = json.load(sys.stdin)
    assert fixture['rpc'].startswith('http://127.0.0.1:')
    with tempfile.TemporaryDirectory(prefix='custos-faucet-e2e-') as folder:
        settings = f.Settings(enabled=True, contract=fixture['contract'], key=fixture['key'],
                              rpc=fixture['rpc'], captcha_secret='isolated-captcha', site_key='isolated-site',
                              database=str(Path(folder) / 'faucet.db'), origins=('http://127.0.0.1:3015',),
                              max_fee=10**18)  # Ganache's synthetic gas price, not a production override.
        current = f.FaucetService(settings)
        real = httpx.AsyncClient(timeout=8, trust_env=False)
        async def transport(request):
            if request.url.host == 'challenges.cloudflare.com':
                return httpx.Response(200, json={'success': True, 'hostname': '127.0.0.1', 'action': 'faucet'})
            assert str(request.url).rstrip('/') == fixture['rpc'].rstrip('/')
            response = await real.post(fixture['rpc'], content=request.content, headers={'content-type': 'application/json'})
            return httpx.Response(response.status_code, content=response.content)
        await current.client.aclose()
        current.client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
        current.chain.client = current.client
        f._service = current
        app = FastAPI();app.include_router(f.router)
        try:
            assert settings.ready(), 'isolated settings must be configured'
            await current.chain.info()
            await current.chain.prepare(fixture['recipient'])
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:3015') as client:
                config = await client.get('/api/faucet/config');assert config.json()['enabled']
                response = await client.post('/api/faucet/requests', json={'address': fixture['recipient'], 'captchaToken': 'isolated-human'}, headers={'origin': 'http://127.0.0.1:3015'})
                assert response.status_code == 202, response.text
                job = response.json();assert job['state'] == 'queued'
                await current.step()
                assert current.store.get(job['id'])['state'] == 'submitted'
                await current.close()
                # Simulate API restart after broadcast: no replacement or double pay.
                current = f.FaucetService(settings)
                await current.client.aclose()
                current.client = httpx.AsyncClient(transport=httpx.MockTransport(transport));current.chain.client = current.client
                f._service = current
                await current.chain.rpc('evm_mine', [])
                await current.step()
                status = await client.get('/api/faucet/requests/' + job['id'])
                assert status.json()['state'] == 'confirmed', status.text
                assert 'raw_tx' not in status.text
                duplicate = await client.post('/api/faucet/requests', json={'address': fixture['recipient'], 'captchaToken': 'another-local-token'})
                assert duplicate.status_code == 429 and duplicate.json()['detail']['code'] == 'COOLDOWN'
                print('Faucet API integration passed: CAPTCHA boundary, signed transaction, restart recovery, two-block confirmation, status query and duplicate cooldown.')
        finally:
            await current.close();await real.aclose();f._service = None


if __name__ == '__main__':
    asyncio.run(main())
