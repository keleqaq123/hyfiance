import asyncio
import json
import sys
from pathlib import Path
import pytest
import httpx

sys.path.insert(0, str(Path(__file__).parent))
import perp_market as p


def stub_http(monkeypatch, status=200, payload=None, text=None):
    monkeypatch.setattr(p, 'is_local_network', lambda: False)
    class Client:
        async def get(self, *args, **kwargs):
            return httpx.Response(status, json=payload, text=text,
                                  request=httpx.Request('GET', 'https://provider.test'))
    monkeypatch.setattr(p, 'http', Client())


@pytest.mark.parametrize('status', [401, 403, 500])
def test_oracle_denial_fails_closed_without_unsigned_fallback(monkeypatch, status):
    stub_http(monkeypatch, status=status, text='private-provider-detail')
    with pytest.raises(p.HTTPException) as error:
        asyncio.run(p.pyth_update('BTC'))
    assert error.value.status_code == 503
    assert error.value.detail['code'] == ('PYTH_ENTITLEMENT_REQUIRED' if status in (401,403) else 'PYTH_UNAVAILABLE')
    assert 'private-provider-detail' not in str(error.value.detail)


@pytest.mark.parametrize('payload', [{}, {'binary': []}, {'binary': {'data': []}}, {'binary': {'data': ['not-hex']}}, {'binary': {'data': 'abc'}}])
def test_missing_or_malformed_signed_updates_are_rejected(monkeypatch, payload):
    stub_http(monkeypatch, payload=payload)
    with pytest.raises(p.HTTPException) as error:
        asyncio.run(p.pyth_update('ETH'))
    assert error.value.status_code == 503


def test_valid_signed_update_is_forwarded(monkeypatch):
    stub_http(monkeypatch, payload={'binary': {'data': ['deadbeef']}, 'parsed': []})
    result = asyncio.run(p.pyth_update('ETH'))
    assert result['updateData'] == ['0xdeadbeef']
    assert 'oracleMode' not in result


def test_history_denial_returns_safe_structured_error(monkeypatch):
    stub_http(monkeypatch, status=403, text='<html>private-provider-detail</html>')
    monkeypatch.setattr(p, 'PYTH_PRO_API_KEY', 'test-key')
    with pytest.raises(p.HTTPException) as error:
        asyncio.run(p.market_history('BTC'))
    assert error.value.status_code == 503
    assert error.value.detail['code'] == 'PYTH_HISTORY_UNAVAILABLE'
    assert '<html>' not in str(error.value.detail)


def test_local_mock_oracle_remains_available(monkeypatch):
    monkeypatch.setattr(p, 'is_local_network', lambda: True)
    assert asyncio.run(p.pyth_update('ETH'))['source'] == 'local-mock'


def test_health_does_not_equate_key_configuration_with_live_prices(monkeypatch):
    monkeypatch.setattr(p, 'is_local_network', lambda: False)
    monkeypatch.setattr(p.hub, 'quotes', {'BTC': {'source': 'testnet-fallback', 'fresh': False}})
    status = asyncio.run(p.perp_health())
    assert status['degraded']
    assert not status['pythLive']


def run_worker(monkeypatch, messages, attempts=1):
    hub = p.MarketStreamHub()
    url = 'wss://market.example.test'
    hub.node_status[url] = {'connected': False, 'messages': 0, 'error': ''}
    hub.running = True
    sent = []
    sleeps = []

    class Socket:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            nonlocal attempts
            attempts -= 1
            hub.running = attempts > 0

        async def send(self, data):
            sent.append(json.loads(data))

        async def __aiter__(self):
            for message in messages:
                yield json.dumps(message)

    async def sleep(seconds):
        sleeps.append(seconds)

    monkeypatch.setattr(p, 'websocket_connect', lambda *args, **kwargs: Socket())
    monkeypatch.setattr(p.asyncio, 'sleep', sleep)
    asyncio.run(hub._worker(url, 0))
    return hub, url, sent, sleeps


def test_subscription_rejection_is_reported_and_disconnects(monkeypatch):
    hub, url, sent, sleeps = run_worker(monkeypatch, [
        {'type': 'subscriptionError', 'subscriptionId': 100,
         'error': 'No valid feeds to subscribe to: Not entitled: feed 1'}
    ])
    status = hub.node_status[url]
    assert not status['connected']
    assert status['messages'] == 1
    assert 'Pyth subscription rejected' in status['error']
    assert 'Not entitled' in status['error']
    assert sent[0]['type'] == 'subscribe'
    assert sleeps == [1.0]
    assert not hub.quotes


def test_valid_price_stream_still_updates_quote(monkeypatch):
    hub, url, _, _ = run_worker(monkeypatch, [
        {'type': 'subscribed', 'subscriptionId': 100},
        {'type': 'streamUpdated', 'parsed': {
            'timestampUs': 123456789,
            'priceFeeds': [{'priceFeedId': 1, 'price': '123456789',
                            'exponent': -3, 'marketSession': 'regular',
                            'feedUpdateTimestamp': 123456789}]
        }}
    ])
    assert hub.node_status[url]['error'] == ''
    assert hub.quotes['BTC']['price'] == 123456.789
    assert hub.quotes['BTC']['source'] == 'pyth-pro-websocket'
    assert hub.quotes['BTC']['fresh']


def test_subscription_rejections_back_off_instead_of_retrying_every_second(monkeypatch):
    _, _, _, sleeps = run_worker(monkeypatch, [
        {'type': 'subscriptionError', 'error': 'Not entitled'}
    ], attempts=3)
    assert sleeps == [1.0, 1.8, 3.24]
