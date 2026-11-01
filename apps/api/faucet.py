"""Gas-sponsored GIWA test ETH. Dedicated signer, durable single-flight queue.

Disabled unless explicitly configured. No fallback to the Bridge/CFI private key.
Signed transactions are persisted BEFORE broadcast and retries reuse identical bytes.
"""
from __future__ import annotations

import asyncio
import contextlib
import hashlib
import hmac
import ipaddress
import os
import sqlite3
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

import httpx
from eth_abi import encode, decode
from eth_account import Account
from eth_utils import is_address, is_checksum_address, keccak, to_checksum_address
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

CHAIN_ID = 91342
ZERO = '0x' + '0' * 40
router = APIRouter(prefix='/api/faucet', tags=['Testnet faucet'])


def reject(status: int, code: str, message: str):
    raise HTTPException(status, detail={'code': code, 'message': message})


def address(value: str) -> str:
    value = value.strip()
    if not is_address(value) or value.lower() == ZERO:
        raise ValueError('Enter a valid, nonzero Ethereum address')
    letters = value[2:]
    if letters != letters.lower() and letters != letters.upper() and not is_checksum_address(value):
        raise ValueError('Address checksum is invalid')
    return to_checksum_address(value)


class ClaimRequest(BaseModel):
    model_config = {'extra': 'forbid'}
    address: str = Field(min_length=42, max_length=42)
    captchaToken: str = Field(default='', max_length=2048)

    @field_validator('address')
    @classmethod
    def recipient(cls, value):
        return address(value)


@dataclass
class Settings:
    enabled: bool = False
    contract: str = ''
    key: str = field(default='', repr=False)
    captcha_secret: str = field(default='', repr=False)
    site_key: str = ''
    captcha_required: bool = True  # Explicit operator opt-out only; never controlled by a request.
    rpc: str = 'https://sepolia-rpc.giwa.io'
    database: str = ''
    origins: tuple[str, ...] = ('https://custosfinance.xyz', 'https://www.custosfinance.xyz')
    trusted_proxies: tuple[str, ...] = ()
    max_fee: int = 10**12  # 0.000001 ETH per sponsored transaction, including L1 fee.
    ip_limit: int = 6
    daily_requests: int | None = None  # Default follows the onchain payout budget.

    @classmethod
    def environment(cls):
        return cls(
            enabled=os.getenv('FAUCET_ENABLED', 'false').lower() == 'true',
            contract=os.getenv('FAUCET_CONTRACT_ADDRESS', ''),
            key=os.getenv('FAUCET_OPERATOR_PRIVATE_KEY', ''),
            captcha_secret=os.getenv('FAUCET_TURNSTILE_SECRET', ''),
            site_key=os.getenv('FAUCET_TURNSTILE_SITE_KEY', ''),
            captcha_required=os.getenv('FAUCET_CAPTCHA_REQUIRED', 'true').lower() != 'false',
            rpc=os.getenv('GIWA_RPC_URL', 'https://sepolia-rpc.giwa.io'),
            database=os.getenv('FAUCET_DATABASE_PATH', str(Path(__file__).parent / 'data' / 'faucet.db')),
            origins=tuple(x.strip() for x in os.getenv('FAUCET_ALLOWED_ORIGINS', 'https://custosfinance.xyz,https://www.custosfinance.xyz').split(',') if x.strip()),
            trusted_proxies=tuple(x.strip() for x in os.getenv('FAUCET_TRUSTED_PROXY_CIDRS', '').split(',') if x.strip()),
            daily_requests=int(os.environ['FAUCET_DAILY_REQUEST_LIMIT']) if os.getenv('FAUCET_DAILY_REQUEST_LIMIT') else None,
        )

    def signer_ready(self):
        try:
            return bool(address(self.contract) and Account.from_key(self.key))
        except (ValueError, TypeError):
            return False

    def ready(self):
        captcha_ready = not self.captcha_required or bool(self.captcha_secret and self.site_key)
        return bool(self.enabled and captcha_ready and self.origins and self.signer_ready())


class Store:
    def __init__(self, filename):
        Path(filename).parent.mkdir(parents=True, exist_ok=True)
        self.filename = filename
        with self.connection() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS requests (
                  id TEXT PRIMARY KEY, recipient TEXT NOT NULL, state TEXT NOT NULL,
                  created INTEGER NOT NULL, raw_tx TEXT, tx_hash TEXT, error TEXT NOT NULL DEFAULT '',
                  retries INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0);
                CREATE INDEX IF NOT EXISTS recipient_requests ON requests(recipient,created);
                CREATE TABLE IF NOT EXISTS attempts (client TEXT NOT NULL, created INTEGER NOT NULL);
                CREATE INDEX IF NOT EXISTS client_attempts ON attempts(client,created);
                CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY, holder TEXT NOT NULL, expires INTEGER NOT NULL);
            ''')
        os.chmod(filename, 0o600)

    @contextlib.contextmanager
    def connection(self):
        db = sqlite3.connect(self.filename, timeout=5)
        db.row_factory = sqlite3.Row
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def attempt(self, client, limit):
        now = int(time.time())
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM attempts WHERE created < ?', (now - 86400,))
            if db.execute('SELECT count(*) FROM attempts WHERE client=? AND created>?', (client, now - 3600)).fetchone()[0] >= limit:
                reject(429, 'RATE_LIMIT', 'Too many requests. Retry in one hour.')
            db.execute('INSERT INTO attempts VALUES (?,?)', (client, now))

    def enqueue(self, recipient, daily_limit):
        now, identifier = int(time.time()), uuid.uuid4().hex
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute("SELECT * FROM requests WHERE recipient=? AND state IN ('queued','signed','submitted','attention') ORDER BY created LIMIT 1", (recipient,)).fetchone()
            if previous:
                return dict(previous)
            if db.execute('SELECT count(*) FROM requests WHERE created>=?', (now // 86400 * 86400,)).fetchone()[0] >= daily_limit:
                reject(429, 'DAILY_REQUEST_LIMIT', 'The daily faucet request budget is exhausted.')
            if db.execute('SELECT count(*) FROM requests WHERE recipient=? AND created>?', (recipient, now - 86400)).fetchone()[0] >= 3:
                reject(429, 'ADDRESS_LIMIT', 'Too many requests for this address. Retry later.')
            if db.execute("SELECT count(*) FROM requests WHERE state IN ('queued','signed','submitted','attention')").fetchone()[0] >= 50:
                reject(503, 'QUEUE_FULL', 'Faucet is busy. Retry later.')
            db.execute("INSERT INTO requests(id,recipient,state,created) VALUES (?,?,'queued',?)", (identifier, recipient, now))
        return self.get(identifier)

    def get(self, identifier):
        with self.connection() as db:
            row = db.execute('SELECT * FROM requests WHERE id=?', (identifier,)).fetchone()
            return dict(row) if row else None

    def next(self):
        with self.connection() as db:
            # An uncertain broadcast always blocks new nonces; never double-pay.
            row = db.execute("SELECT * FROM requests WHERE state IN ('signed','submitted','attention') ORDER BY created,id LIMIT 1").fetchone()
            if not row:
                row = db.execute("SELECT * FROM requests WHERE state='queued' ORDER BY created,id LIMIT 1").fetchone()
            return dict(row) if row else None

    def update(self, identifier, **fields):
        assert set(fields) <= {'state', 'raw_tx', 'tx_hash', 'error', 'retries', 'retry_at'}
        with self.connection() as db:
            db.execute('UPDATE requests SET ' + ','.join(name + '=?' for name in fields) + ' WHERE id=?', (*fields.values(), identifier))

    def acquire(self, holder):
        now = int(time.time())
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM lease WHERE id=1').fetchone()
            if row and row['expires'] > now and row['holder'] != holder:
                return False
            db.execute('INSERT OR REPLACE INTO lease VALUES (1,?,?)', (holder, now + 180))
            return True

    def release(self, holder):
        with self.connection() as db:
            db.execute('DELETE FROM lease WHERE holder=?', (holder,))


def transient_rpc_error(error):
    return (
        isinstance(error, httpx.RequestError)
        or isinstance(error, httpx.HTTPStatusError)
        and error.response.status_code in (408, 429, 500, 502, 503, 504)
        or isinstance(error, RuntimeError) and str(error) == 'RPC_UNAVAILABLE'
    )


class Chain:
    def __init__(self, settings, client):
        self.settings, self.client = settings, client

    async def rpc(self, method, params):
        # Retry only idempotent reads here. Broadcast retries remain under the
        # durable worker's same-byte / same-hash rules, never request handlers.
        for attempt in range(3):
            try:
                response = await self.client.post(self.settings.rpc, json={'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params})
                response.raise_for_status()
                body = response.json()
                if body.get('error') or 'result' not in body:
                    raise RuntimeError('RPC_UNAVAILABLE')  # Never expose provider payloads or signed bytes.
                return body['result']
            except Exception as error:
                if method == 'eth_sendRawTransaction' or not transient_rpc_error(error) or attempt == 2:
                    raise
                await asyncio.sleep(0.25 * (attempt + 1))

    async def call(self, signature, types=(), values=(), output='uint256', target=None):
        data = '0x' + (keccak(text=signature)[:4] + encode(types, values)).hex()
        result = await self.rpc('eth_call', [{'to': target or self.settings.contract, 'data': data}, 'latest'])
        return decode([output], bytes.fromhex(result[2:]))[0]

    async def info(self, recipient=ZERO):
        if int(await self.rpc('eth_chainId', []), 16) != CHAIN_ID:
            raise RuntimeError('WRONG_CHAIN')
        if await self.rpc('eth_getCode', [self.settings.contract, 'latest']) == '0x':
            raise RuntimeError('CONTRACT_UNAVAILABLE')
        block = await self.rpc('eth_getBlockByNumber', ['latest', False])
        now = int(block['timestamp'], 16)
        operator, amount, cooldown, limit, distributed, paused, next_at, reserve = await asyncio.gather(
            self.call('operator()', output='address'), self.call('claimAmount()'),
            self.call('claimCooldown()'), self.call('dailyLimit()'),
            self.call('distributedPerDay(uint256)', ['uint256'], [now // 86400]),
            self.call('paused()', output='bool'), self.call('nextClaimAt(address)', ['address'], [recipient]),
            self.rpc('eth_getBalance', [self.settings.contract, 'latest']),
        )
        if operator.lower() != Account.from_key(self.settings.key).address.lower():
            raise RuntimeError('OPERATOR_MISMATCH')
        return {'amountWei': str(amount), 'cooldownSeconds': cooldown, 'dailyLimitWei': str(limit),
                'distributedTodayWei': str(distributed), 'paused': paused, 'nextClaimAt': next_at,
                'reserveWei': str(int(reserve, 16)), 'blockTime': now}

    async def prepare(self, recipient):
        info = await self.info(recipient)
        check_info(info)
        account = Account.from_key(self.settings.key)
        data = '0x' + (keccak(text='claimFor(address)')[:4] + encode(['address'], [recipient])).hex()
        tx = {'from': account.address, 'to': to_checksum_address(self.settings.contract), 'value': '0x0', 'data': data}
        estimate, price, balance, nonce = await asyncio.gather(
            self.rpc('eth_estimateGas', [tx]), self.rpc('eth_gasPrice', []),
            self.rpc('eth_getBalance', [account.address, 'latest']),
            self.rpc('eth_getTransactionCount', [account.address, 'pending']),
        )
        gas = (int(estimate, 16) * 125 + 99) // 100
        if gas > 300000:
            raise RuntimeError('GAS_LIMIT')
        signed = account.sign_transaction({'chainId': CHAIN_ID, 'nonce': int(nonce, 16), 'to': tx['to'],
                                           'value': 0, 'data': data, 'gas': gas, 'gasPrice': int(price, 16)})
        # GIWA is OP Stack: bound L1 data fees as well as execution gas.
        l1_fee = await self.call('getL1Fee(bytes)', ['bytes'], [signed.raw_transaction], target='0x420000000000000000000000000000000000000F')
        budget = gas * int(price, 16) + l1_fee * 2
        if budget > self.settings.max_fee or budget > int(balance, 16) // 4:
            raise RuntimeError('OPERATOR_GAS_BUDGET')
        return '0x' + bytes(signed.raw_transaction).hex(), '0x' + bytes(signed.hash).hex()


def check_info(info):
    if info['paused']:
        reject(503, 'PAUSED', 'The faucet is paused.')
    if int(info['reserveWei']) < int(info['amountWei']):
        reject(503, 'EMPTY', 'The faucet needs test ETH funding.')
    if int(info['distributedTodayWei']) + int(info['amountWei']) > int(info['dailyLimitWei']):
        reject(429, 'DAILY_LIMIT', 'The onchain daily allocation is exhausted.')
    if info['nextClaimAt'] > info['blockTime']:
        reject(429, 'COOLDOWN', 'This address is still in its onchain cooldown.')


def public_job(job):
    return {key: job[key] for key in ('id', 'recipient', 'state', 'created', 'tx_hash', 'error')}


class FaucetService:
    def __init__(self, settings):
        self.settings = settings
        self.client = httpx.AsyncClient(timeout=8, trust_env=False)
        self.chain = Chain(settings, self.client)
        self._store = None
        self.holder = uuid.uuid4().hex
        self.task = None

    @property
    def store(self):
        if self._store is None:
            self._store = Store(self.settings.database)
        return self._store

    def require_ready(self):
        if not self.settings.ready():
            reject(503, 'NOT_CONFIGURED', 'Sponsored faucet is not yet configured.')

    async def describe(self):
        base = {'chainId': CHAIN_ID, 'contract': self.settings.contract, 'siteKey': self.settings.site_key if self.settings.captcha_required else '',
                'captchaRequired': self.settings.captcha_required,
                'enabled': False, 'message': 'Sponsored faucet is not yet configured.'}
        if not self.settings.signer_ready():
            return base
        try:
            info = await self.chain.info()
            if not self.settings.ready():
                message = ('Human verification is not yet configured.' if self.settings.captcha_required and (not self.settings.captcha_secret or not self.settings.site_key)
                           else 'Faucet service is awaiting activation.')
                if info['paused']:
                    message = 'The faucet is paused. ' + message
                return {**base, **info, 'message': message}
            check_info(info)
            return {**base, **info, 'enabled': True, 'message': ''}
        except HTTPException as exc:
            return {**base, **info, 'message': exc.detail['message']}
        except Exception:
            return {**base, 'message': 'Faucet onchain checks are temporarily unavailable.'}

    def client_ip(self, request):
        peer = request.client.host if request.client else 'unknown'
        try:
            if any(ipaddress.ip_address(peer) in ipaddress.ip_network(cidr) for cidr in self.settings.trusted_proxies):
                return str(ipaddress.ip_address(request.headers.get('x-real-ip', peer)))
        except ValueError:
            pass
        return peer

    async def verify_captcha(self, token, ip):
        try:
            response = await self.client.post('https://challenges.cloudflare.com/turnstile/v0/siteverify',
                                              data={'secret': self.settings.captcha_secret, 'response': token, 'remoteip': ip})
            response.raise_for_status()
            body = response.json()
            hostnames = {urlparse(origin).hostname for origin in self.settings.origins}
            if not body.get('success') or body.get('action') != 'faucet' or body.get('hostname') not in hostnames:
                reject(400, 'CAPTCHA', 'Human verification expired or failed. Please retry.')
        except HTTPException:
            raise
        except Exception:
            reject(503, 'CAPTCHA_UNAVAILABLE', 'Human verification is temporarily unavailable.')

    async def submit(self, body, request):
        self.require_ready()
        origin = request.headers.get('origin')
        if origin and origin not in self.settings.origins:
            reject(403, 'ORIGIN', 'This origin is not allowed.')
        if body.address.lower() == self.settings.contract.lower():
            reject(400, 'RECIPIENT', 'The faucet cannot pay itself.')
        ip = self.client_ip(request)
        salt = hashlib.sha256(('custos-faucet-ip-v1:' + self.settings.key).encode()).digest()
        client = hmac.new(salt, ip.encode(), hashlib.sha256).hexdigest()
        self.store.attempt(client, self.settings.ip_limit)
        if self.settings.captcha_required:
            if not body.captchaToken:
                reject(400, 'CAPTCHA', 'Complete human verification before requesting test ETH.')
            await self.verify_captcha(body.captchaToken, ip)
        try:
            info = await self.chain.info(body.address)
        except Exception:
            reject(503, 'ONCHAIN_UNAVAILABLE', 'Could not verify faucet state. Retry later.')
        check_info(info)
        onchain_requests = min(int(info['dailyLimitWei']) // int(info['amountWei']), 2**63 - 1)
        daily_requests = min(onchain_requests, self.settings.daily_requests) if self.settings.daily_requests is not None else onchain_requests
        return public_job(self.store.enqueue(body.address, daily_requests))

    async def step(self):
        if not self.store.acquire(self.holder):
            return
        try:
            job = self.store.next()
            if not job or job['state'] == 'attention' or job['retry_at'] > int(time.time()):
                return
            if job['state'] == 'queued':
                try:
                    raw, tx_hash = await self.chain.prepare(job['recipient'])
                    self.store.update(job['id'], state='signed', raw_tx=raw, tx_hash=tx_hash,
                                      retries=0, retry_at=0, error='')
                    job = self.store.get(job['id'])
                except Exception as error:
                    if transient_rpc_error(error):
                        retries = job['retries'] + 1
                        self.store.update(job['id'], retries=retries,
                                          retry_at=int(time.time()) + min(60, retries * 5),
                                          state='failed' if retries >= 20 else 'queued',
                                          error='RPC temporarily unavailable. No transaction was sent.' if retries >= 20
                                          else 'RPC preparation retry pending. No transaction has been sent.')
                        return
                    self.store.update(job['id'], state='failed', error='Onchain eligibility or operator gas check failed. No transaction was sent.')
                    return
            try:
                receipt = await self.chain.rpc('eth_getTransactionReceipt', [job['tx_hash']])
                if receipt:
                    height = int(await self.chain.rpc('eth_blockNumber', []), 16)
                    if height < int(receipt['blockNumber'], 16) + 1:
                        return
                    if receipt['transactionHash'].lower() != job['tx_hash'].lower():
                        raise RuntimeError('RECEIPT_MISMATCH')
                    success = int(receipt['status'], 16) == 1
                    self.store.update(job['id'], state='confirmed' if success else 'failed', error='' if success else 'Onchain payout reverted; no ETH was delivered.')
                    return
                if job['state'] == 'signed':
                    tx_hash = await self.chain.rpc('eth_sendRawTransaction', [job['raw_tx']])
                    if tx_hash.lower() != job['tx_hash'].lower():
                        raise RuntimeError('HASH_MISMATCH')
                    self.store.update(job['id'], state='submitted', error='', retries=0)
                elif int(time.time()) - job['created'] > 1800:
                    self.store.update(job['id'], state='attention', error='Confirmation timed out. Operator review is required before more payouts.')
            except Exception:
                retries = job['retries'] + 1
                self.store.update(job['id'], retries=retries, retry_at=int(time.time()) + min(60, retries * 5),
                                  state='attention' if retries >= 20 else job['state'],
                                  error='Transaction status needs operator review.' if retries >= 20 else 'RPC retry pending. The same signed transaction will be reused.')
        finally:
            self.store.release(self.holder)

    async def run(self):
        while True:
            try:
                await self.step()
            except Exception:
                # Do not log credentials, raw signed transactions or provider data.
                pass
            await asyncio.sleep(3)

    async def close(self):
        if self.task:
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.task
        await self.client.aclose()


_service = None


def service():
    global _service
    if _service is None:
        _service = FaucetService(Settings.environment())
    return _service


async def start_faucet():
    current = service()
    if current.settings.ready():
        current.task = asyncio.create_task(current.run())


async def stop_faucet():
    global _service
    if _service:
        await _service.close()
        _service = None


@router.get('/config')
async def config():
    return await service().describe()


@router.post('/requests', status_code=202)
async def claim(body: ClaimRequest, request: Request):
    return await service().submit(body, request)


@router.get('/requests/{identifier}')
def request_status(identifier: str):
    current = service()
    current.require_ready()
    if len(identifier) != 32 or any(c not in '0123456789abcdef' for c in identifier):
        reject(404, 'NOT_FOUND', 'Faucet request not found.')
    job = current.store.get(identifier)
    if not job:
        reject(404, 'NOT_FOUND', 'Faucet request not found.')
    return public_job(job)
