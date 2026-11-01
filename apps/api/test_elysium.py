import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
import network_config as networks
import reality

def test_elysium_does_not_inherit_old_chain_addresses_or_currency(monkeypatch, tmp_path):
    monkeypatch.setenv('CUSTOS_CHAIN_ID', '99801')
    monkeypatch.setenv('CUSTOS_NETWORK_NAME', 'Elysium Testnet')
    monkeypatch.setenv('CUSTOS_RPC_URL', 'https://testnet-rpc.elysium.kinetiq.xyz')
    monkeypatch.setenv('CUSTOS_EXPLORER_URL', 'https://testnet.elysium.kinetiq.xyz')
    monkeypatch.setenv('REALITY_DATA_DIR', str(tmp_path))
    monkeypatch.setenv('REALITY_WETH', '')
    monkeypatch.setenv('REALITY_LAUNCHPAD_ADDRESS', '')
    monkeypatch.setenv('REALITY_CFI_STAKING', '')
    if reality._engine: reality._engine.dispose()
    reality._engine = None
    try:
        net = networks.network_config()
        assert net['chain_id'] == 99801 and net['native_symbol'] == 'HYPE'
        config = reality.config()
        assert config['chain_id'] == 99801 and config['native_symbol'] == 'HYPE'
        assert config['launchpad'] == '' and config['weth'] == '' and config['cfi_staking'] == ''
        app = FastAPI(); app.include_router(reality.router)
        with TestClient(app) as client:
            response = client.post('/api/reality/auth/challenge', json={'wallet': '0x'+'1'*40})
            assert response.status_code == 200
            assert 'Chain ID: 99801' in response.json()['message']
    finally:
        if reality._engine: reality._engine.dispose()
        reality._engine = None

@pytest.mark.asyncio
async def test_hype_receipts_use_hype_price_instead_of_eth(monkeypatch):
    monkeypatch.setenv('CUSTOS_CHAIN_ID', '99801')
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, url, json):
            assert url == 'https://api.hyperliquid.xyz/info' and json == {'type':'allMids'}
            return reality.httpx.Response(200, json={'HYPE':'35.12'}, request=reality.httpx.Request('POST',url))
    monkeypatch.setattr(reality.httpx, 'AsyncClient', Client)
    result = await reality.read_binance_price()
    assert result[1] == 3512 * 10**16

@pytest.mark.asyncio
async def test_signed_receipt_quote_binds_elysium_chain(monkeypatch, tmp_path):
    from eth_account import Account
    from eth_account.messages import encode_typed_data
    from starlette.requests import Request
    signer, trader = Account.create(), Account.create()
    vault = '0x'+'2'*40
    monkeypatch.setenv('CUSTOS_CHAIN_ID','99801')
    monkeypatch.setenv('CFI_QUOTE_SIGNER_KEY',signer.key.hex())
    monkeypatch.setattr(reality,'config',lambda:{'cfi_price_source':'hyperliquid'})
    monkeypatch.setattr(reality,'wallet_auth',lambda _:trader.address)
    monkeypatch.setattr(reality,'_binance_price_cache',(reality.time.monotonic(),35*10**18,reality.now()))
    async def rpc(method, params):
        if method=='eth_chainId': return '0x185d9'
        if params[0]['data'].startswith('0x'+reality.keccak(text='quoteSigner()').hex()[:8]):
            return '0x'+reality.encode(['address'],[signer.address]).hex()
        return '0x'+('0'*64)
    monkeypatch.setattr(reality,'rpc',rpc)
    request=Request({'type':'http','headers':[(b'authorization',b'Bearer test')]})
    quote=await reality.binance_staking_quote(request,vault,10**18)
    message={'account':trader.address,'amount':10**18,'price18':int(quote['price18']),'issuedAt':quote['issuedAt'],'deadline':quote['deadline'],'nonce':0}
    def recover(chain):
        typed=encode_typed_data(domain_data={'name':'Custos CFI Binance','version':'1','chainId':chain,'verifyingContract':vault},message_types={'StakeQuote':reality.STAKE_QUOTE_FIELDS},message_data=message)
        return Account.recover_message(typed,signature=quote['signature'])
    assert recover(99801)==signer.address
    assert recover(91342)!=signer.address
    assert quote['source']=='hyperliquid' and quote['expectedCFI']==str(35*10**18)
