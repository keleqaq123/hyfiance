import io,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
import reality as r

@pytest.fixture
def setup(tmp_path,monkeypatch):
    monkeypatch.setenv('REALITY_DATA_DIR',str(tmp_path));monkeypatch.delenv('K_SERVICE',raising=False);monkeypatch.delenv('REALITY_DATABASE_URL',raising=False);monkeypatch.delenv('REALITY_GCS_BUCKET',raising=False)
    if r._engine:r._engine.dispose()
    r._engine=None
    r._ranking_quotes.clear();r._ranking_quote_tasks.clear()
    r._binance_price_cache=None;r._binance_price_task=None
    monkeypatch.setenv('REALITY_CFI_PRICE_SOURCE','pyth')
    owner,other,admin=Account.create(),Account.create(),Account.create();monkeypatch.setenv('REALITY_ADMIN_WALLETS',admin.address)
    app=FastAPI();app.include_router(r.router);client=TestClient(app)
    def auth(account):
        c=client.post('/api/reality/auth/challenge',json={'wallet':account.address}).json()
        sig=Account.sign_message(encode_defunct(text=c['message']),account.key).signature.hex()
        response=client.post('/api/reality/auth/login',json={'id':c['id'],'signature':'0x'+sig});assert response.status_code==200,response.text
        return {'Authorization':'Bearer '+response.json()['token']}
    yield client,owner,other,admin,auth
    if r._engine:r._engine.dispose()
    r._engine=None

def image_bytes():
    b=io.BytesIO();Image.new('RGB',(64,48),'green').save(b,format='PNG');return b.getvalue()

def test_original_season_proxy_preserves_old_points_and_caches_reads(setup,monkeypatch):
    c,*_=setup;calls=[]
    monkeypatch.setattr(r,'_original_season_cache',None);monkeypatch.setattr(r,'_original_season_task',None)
    row={'rank':1,'wallet':'0x'+'1'*40,'points':38410,'verifiedTransactions':443,'qualifiedReferrals':345}
    class RpcClient:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def get(self,url):
            calls.append(url)
            return r.httpx.Response(200,json={'season':'S1','entries':[row]},request=r.httpx.Request('GET',url))
    monkeypatch.setattr(r.httpx,'AsyncClient',RpcClient)
    for _ in range(2):
        response=c.get('/api/reality/season/original-leaderboard');assert response.status_code==200
        assert response.json()['entries']==[row] and response.json()['source']=='original_custos'
    assert len(calls)==1 and calls[0]=='https://www.custosfinance.xyz/api/beta/leaderboard?limit=100'

def test_original_season_proxy_marks_cached_fallback_and_rejects_old_cache(setup,monkeypatch):
    c,*_=setup;monkeypatch.setattr(r,'_original_season_task',None)
    cache={'season':'S1','entries':[],'source':'original_custos','updated_at':r.now()-40,'stale':False}
    monkeypatch.setattr(r,'_original_season_cache',cache)
    class RpcClient:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def get(self,*args):raise r.httpx.ConnectError('offline')
    monkeypatch.setattr(r.httpx,'AsyncClient',RpcClient)
    response=c.get('/api/reality/season/original-leaderboard');assert response.status_code==200 and response.json()['stale']
    monkeypatch.setattr(r,'_original_season_cache',{**cache,'updated_at':r.now()-301})
    assert c.get('/api/reality/season/original-leaderboard').status_code==503

def test_original_season_proxy_rejects_invalid_remote_wallets(setup,monkeypatch):
    c,*_=setup;monkeypatch.setattr(r,'_original_season_task',None);monkeypatch.setattr(r,'_original_season_cache',None)
    class RpcClient:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def get(self,url):return r.httpx.Response(200,json={'season':'S1','entries':[{'wallet':'bad','rank':1,'points':1,'verifiedTransactions':0,'qualifiedReferrals':0}]},request=r.httpx.Request('GET',url))
    monkeypatch.setattr(r.httpx,'AsyncClient',RpcClient)
    assert c.get('/api/reality/season/original-leaderboard').status_code==503

def test_bridge_proxy_rejects_writes_unknown_networks_and_oversized_calls(setup):
    c,*_=setup
    path='/api/reality/bridge/rpc/sepolia'
    for method in ('eth_sendTransaction','eth_sendRawTransaction','personal_sign','admin_peers'):
        assert c.post(path,json={'method':method,'params':[]}).status_code==400
    assert c.post('/api/reality/bridge/rpc/mainnet',json={'method':'eth_chainId'}).status_code==422
    assert c.post(path,json={'method':'eth_call','params':['x'*33000]}).status_code==400

def test_bridge_proxy_forwards_only_fixed_network_and_preserves_rpc_errors(setup,monkeypatch):
    c,*_=setup;calls=[]
    monkeypatch.setenv('SEPOLIA_RPC_URL','https://sepolia.example.test')
    class RpcClient:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def post(self,url,json):
            calls.append((url,json))
            return r.httpx.Response(200,json={'jsonrpc':'2.0','id':json['id'],'error':{'code':-32000,'message':'not found'}},request=r.httpx.Request('POST',url))
    monkeypatch.setattr(r.httpx,'AsyncClient',RpcClient)
    response=c.post('/api/reality/bridge/rpc/sepolia',json={'method':'eth_getTransactionReceipt','id':7,'params':['0xabc'],'url':'https://attacker.test'})
    assert response.status_code==200 and response.json()['error']['code']==-32000
    assert calls[0][0]=='https://sepolia.example.test' and 'url' not in calls[0][1]

def test_bridge_proxy_handles_unavailable_upstream(setup,monkeypatch):
    c,*_=setup
    class RpcClient:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def post(self,*args,**kwargs):raise r.httpx.ConnectError('offline')
    monkeypatch.setattr(r.httpx,'AsyncClient',RpcClient)
    assert c.post('/api/reality/bridge/rpc/giwa',json={'method':'eth_chainId'}).status_code==503
def create(client,headers,mode='free',upload_id=None):
    if not upload_id:
        image=client.post('/api/reality/uploads',headers={**headers,'Content-Type':'image/png'},content=image_bytes());assert image.status_code==200,image.text;upload_id=image.json()['id']
    return client.post('/api/reality/assets',headers=headers,json={'name':'真实相机','symbol':'CAM','story':'家人留下的相机','description':'我的原创照片','category':'things','mode':mode,'image_id':upload_id,'supply':'1000000','review_status':'approved','verified':True})

def test_signed_login_cannot_be_replayed_or_forged(setup):
    c,owner,other,_,_=setup
    challenge=c.post('/api/reality/auth/challenge',json={'wallet':owner.address}).json()
    bad='0x'+Account.sign_message(encode_defunct(text=challenge['message']),other.key).signature.hex()
    assert c.post('/api/reality/auth/login',json={'id':challenge['id'],'signature':bad}).status_code==401
    good='0x'+Account.sign_message(encode_defunct(text=challenge['message']),owner.key).signature.hex()
    assert c.post('/api/reality/auth/login',json={'id':challenge['id'],'signature':good}).status_code==200
    assert c.post('/api/reality/auth/login',json={'id':challenge['id'],'signature':good}).status_code==401

def test_upload_ownership_private_proofs_and_review_authority(setup):
    c,owner,other,admin,auth=setup;h,other_h,admin_h=auth(owner),auth(other),auth(admin)
    response=create(c,h,'verified');assert response.status_code==200,response.text;a=response.json();assert not a['verified']
    assert create(c,other_h,upload_id=a['image_id']).status_code==400
    proof=c.post('/api/reality/uploads?private=true',headers={**h,'Content-Type':'image/png'},content=image_bytes()).json()
    assert c.get('/api/reality/media/'+proof['id']).status_code==401
    assert c.get('/api/reality/media/'+proof['id'],headers=other_h).status_code==403
    assert c.get('/api/reality/media/'+proof['id'],headers=admin_h).status_code==200
    assert c.post('/api/reality/assets/'+a['id']+'/proof',headers=other_h,json={'proof_ids':[proof['id']]}).status_code==403
    assert c.post('/api/reality/assets/'+a['id']+'/proof',headers=h,json={'proof_ids':[proof['id']]}).status_code==200
    assert c.get('/api/reality/admin/reviews',headers=h).status_code==403
    assert c.post('/api/reality/admin/reviews/'+a['id'],headers=h,json={'decision':'approved','note':'真实证据充分'}).status_code==403
    assert c.post('/api/reality/admin/reviews/'+a['id'],headers=admin_h,json={'decision':'approved','note':'已检查原创图和权属证明'}).status_code==200
    assert c.get('/api/reality/assets/'+a['id']).json()['verified'] is True
    assert c.post('/api/reality/admin/reviews/'+a['id'],headers=admin_h,json={'decision':'revoked','note':'后续权属有争议'}).status_code==200
    assert c.get('/api/reality/assets/'+a['id']).json()['verified'] is False

def test_social_values_are_durable_and_not_self_valued(setup):
    c,owner,other,_,auth=setup;h,oh=auth(owner),auth(other);a=create(c,h).json();path='/api/reality/assets/'+a['id']
    assert c.post(path+'/valuations',headers=h,json={'amount':120}).status_code==400
    assert c.post(path+'/valuations',headers=oh,json={'amount':120}).status_code==200
    assert c.post(path+'/valuations',headers=oh,json={'amount':200}).status_code==200
    assert c.post(path+'/reactions',headers=oh,json={'kind':'love'}).json()['active'] is True
    assert c.post(path+'/comments',headers=oh,json={'body':'真实故事很动人'}).status_code==200
    row=c.get(path).json();assert row['community_value']==200 and row['valuation_count']==1 and row['love_count']==1 and len(row['comments'])==1
    r._engine.dispose();r._engine=None
    assert c.get(path).json()['community_value']==200
    assert c.post(path+'/reactions',headers=oh,json={'kind':'love'}).json()['active'] is False

def test_admin_can_review_without_submitted_evidence(setup):
    c,owner,other,admin,auth=setup;creator=auth(owner);reviewer=auth(admin)
    asset=create(c,creator,'verified').json();path='/api/reality/admin/reviews/'+asset['id']
    assert c.post(path,headers=auth(other),json={'decision':'approved','note':'Evidence checked'}).status_code==403
    assert c.post(path,headers=reviewer,json={'decision':'approved','note':'x'}).status_code==422
    assert c.post(path,headers=reviewer,json={'decision':'rejected','note':'Need original evidence'}).status_code==200
    assert c.get('/api/reality/assets/'+asset['id']).json()['review_status']=='rejected'
    assert c.post(path,headers=reviewer,json={'decision':'approved','note':'Original evidence checked offline'}).status_code==200
    assert c.get('/api/reality/assets/'+asset['id']).json()['verified'] is True
    assert c.post(path,headers=reviewer,json={'decision':'approved','note':'Duplicate approval'}).status_code==409
    with r.engine().connect() as db:
        records=db.execute(r.select(r.audits).where(r.audits.c.asset_id==asset['id'])).mappings().all()
        assert [row['decision'] for row in records]==['rejected','approved']
        assert all(row['wallet']==admin.address.lower() for row in records)
    another=create(c,creator,'verified').json()
    assert c.post('/api/reality/admin/reviews/'+another['id'],headers=reviewer,json={'decision':'approved','note':'Checked original item directly'}).status_code==200


def test_verification_lane_cannot_attach_before_review(setup):
    c,owner,_,_,auth=setup;h=auth(owner);a=create(c,h,'verified').json()
    assert c.post('/api/reality/assets/'+a['id']+'/attach',headers=h,json={'tx_hash':'0x'+'a'*64}).status_code==403

def test_upload_rejects_active_content_and_invalid_images(setup):
    c,owner,_,_,auth=setup;h=auth(owner)
    assert c.post('/api/reality/uploads',headers={**h,'Content-Type':'image/svg+xml'},content=b'<svg/>').status_code==400
    assert c.post('/api/reality/uploads',headers={**h,'Content-Type':'image/png'},content=b'<script/>').status_code==400
    assert c.post('/api/reality/uploads',headers={**h,'Content-Type':'application/pdf'},content=b'%PDF-').status_code==400

def test_attach_rejects_wrong_transaction_sender(setup,monkeypatch):
    c,owner,other,_,auth=setup;h=auth(owner);a=create(c,h).json()
    address='0x'+'1'*40
    monkeypatch.setenv('REALITY_LAUNCHPAD_ADDRESS',address)
    async def fake_rpc(method,params):
        if method=='eth_chainId':return hex(91342)
        if method=='eth_getTransactionReceipt':return {'status':'0x1','to':address,'from':other.address.lower(),'blockNumber':'0x10','logs':[]}
        raise AssertionError(method)
    monkeypatch.setattr(r,'rpc',fake_rpc)
    assert c.post('/api/reality/assets/'+a['id']+'/attach',headers=h,json={'tx_hash':'0x'+'a'*64}).status_code==400
    assert c.get('/api/reality/assets/'+a['id']).json()['token_address'] is None

def test_administrator_cannot_approve_own_asset(setup):
    c,_,_,admin,auth=setup;h=auth(admin);a=create(c,h,'verified').json()
    proof=c.post('/api/reality/uploads?private=true',headers={**h,'Content-Type':'image/png'},content=image_bytes()).json()
    assert c.post('/api/reality/assets/'+a['id']+'/proof',headers=h,json={'proof_ids':[proof['id']]}).status_code==200
    assert c.post('/api/reality/admin/reviews/'+a['id'],headers=h,json={'decision':'approved','note':'自己的证明'}).status_code==403

def test_index_orders_same_block_events_and_hides_stale_volume(setup):
    c,owner,_,_,auth=setup;h=auth(owner);a=create(c,h).json();timestamp=r.now()
    with r.engine().begin() as db:
        db.execute(r.update(r.assets).where(r.assets.c.id==a['id']).values(token_address='0x'+'2'*40,launch_id=1))
        for index,reserve in [(10,300),(2,200)]:
            db.execute(r.insert(r.trades).values(id='0xabc:'+str(index),launch_id=1,block_number=1,timestamp=timestamp,wallet=owner.address.lower(),side='buy',quote_amount=str(10**18),token_amount='1',quote_reserve=str(reserve),token_reserve='100',tx_hash='0xabc'))
        db.execute(r.insert(r.runtime_settings),[{'key':'index_block','value':'2'},{'key':'index_updated_at','value':str(timestamp)}])
    stats=c.get('/api/reality/market-stats').json();assert stats['items'][a['id']]['history'][-1]['price']==3
    assert stats['items'][a['id']]['volume_eth']==2
    with r.engine().begin() as db:db.execute(r.update(r.runtime_settings).where(r.runtime_settings.c.key=='index_updated_at').values(value='0'))
    assert c.get('/api/reality/market-stats').json()['items'][a['id']]['volume_eth'] is None


def test_season_launch_referral_and_x_visit_awards(setup):
    c,owner,other,_,auth=setup;h,oh=auth(owner),auth(other)
    p=c.post('/api/reality/season/register',headers=h,json={}).json()
    assert p['points']==0 and p['referralCode']
    assert c.post('/api/reality/season/register',headers=oh,json={'ref_code':p['referralCode']}).status_code==200
    assert c.post('/api/reality/season/x-visit',json={}).status_code==401
    assert c.get('/api/reality/season/x/config').json()['url']=='https://x.com/custosfinance'
    for _ in range(3):
        visit=c.post('/api/reality/season/x-visit',headers=h,json={})
        assert visit.status_code==200 and visit.json()['points']==10
        assert visit.json()['xStatus']=='visited'
    a=create(c,oh).json()
    assert c.get('/api/reality/season/profile/'+owner.address).json()['qualifiedReferrals']==0
    with r.engine().begin() as db:db.execute(r.update(r.assets).where(r.assets.c.id==a['id']).values(token_address='0x'+'4'*40,launch_id=1))
    assert c.get('/api/reality/season/profile/'+owner.address).json()['points']==110
    assert c.get('/api/reality/season/profile/'+other.address).json()['points']==100
    b=create(c,oh).json()
    with r.engine().begin() as db:db.execute(r.update(r.assets).where(r.assets.c.id==b['id']).values(token_address='0x'+'5'*40,launch_id=2))
    assert c.get('/api/reality/season/profile/'+owner.address).json()['points']==110
    assert c.get('/api/reality/season/profile/'+other.address).json()['points']==100
    assert c.post('/api/reality/season/x-proof',headers=h,json={'handle':'custosfinance'}).status_code==404
    r._engine.dispose();r._engine=None
    assert c.get('/api/reality/season/profile/'+owner.address).json()['points']==110


def test_market_filters_issued_assets_before_pagination(setup):
    c,owner,_,_,auth=setup;h=auth(owner)
    draft=create(c,h).json();issued=create(c,h).json()
    with r.engine().begin() as db:
        db.execute(r.update(r.assets).where(r.assets.c.id==issued['id']).values(token_address='0x'+'12'*20,launch_id=1))
    result=c.get('/api/reality/assets?issued=true&limit=1').json()
    assert [a['id'] for a in result['items']]==[issued['id']]
    assert result['has_more'] is False
    assert len(c.get('/api/reality/assets').json()['items'])==2
    assert c.get('/api/reality/assets?issued=true&search=NOTEXIST').json()['items']==[]


def test_chart_real_trades_buckets_order_and_empty_state(setup,monkeypatch):
    c,owner,_,_,auth=setup;h=auth(owner);a=create(c,h).json();other=create(c,h).json()
    clock=1800000000;monkeypatch.setattr(r,'now',lambda:clock)
    with r.engine().begin() as db:
        db.execute(r.update(r.assets).where(r.assets.c.id==a['id']).values(token_address='0x'+'12'*20,launch_id=1))
        db.execute(r.insert(r.runtime_settings).values(key='index_updated_at',value=str(clock)))
    empty=c.get('/api/reality/assets/'+a['id']+'/chart').json()
    assert empty['candles']==[] and empty['trades']==[] and empty['volume_eth']==0 and empty['indexed']
    def trade(log,side,q,t,qr,tr,time=clock-10,launch=1):
        return dict(id='0x'+'ab'*32+':'+str(log),launch_id=launch,block_number=100,timestamp=time,wallet=owner.address.lower(),side=side,quote_amount=str(q*10**18),token_amount=str(t*10**18),quote_reserve=str(int(r.Decimal(str(qr))*10**18)),token_reserve=str(tr*10**18),tx_hash='0x'+'ab'*32)
    with r.engine().begin() as db:
        db.execute(r.insert(r.trades),[trade(10,'sell',2,100,9,900),trade(2,'buy',3,100,12,800),trade(3,'buy',5,100,20,500,launch=2),trade(1,'buy',1,100,10,1000,time=clock-90000)])
    result=c.get('/api/reality/assets/'+a['id']+'/chart?period=24h').json()
    assert result['trade_count']==2 and result['volume_eth']==5
    assert len(result['candles'])==1
    candle=result['candles'][0]
    assert candle['open']==12/800 and candle['close']==9/900 and candle['high']==12/800 and candle['low']==9/900 and candle['volume_eth']==5
    assert [t['side'] for t in result['trades']]==['sell','buy']
    assert result['trades'][0]['execution_price']==2/100
    assert c.get('/api/reality/assets/'+a['id']+'/chart?period=7d').json()['trade_count']==3
    assert c.get('/api/reality/assets/'+other['id']+'/chart').json()['trades']==[]
    monkeypatch.setattr(r,'now',lambda:clock+121)
    stale=c.get('/api/reality/assets/'+a['id']+'/chart').json()
    assert not stale['indexed'] and stale['volume_eth'] is None and stale['candles']
    assert c.get('/api/reality/assets/not-found/chart').status_code==404
    assert c.get('/api/reality/assets/'+a['id']+'/chart?period=invalid').status_code==422


def test_chart_one_and_five_minute_resolution(setup,monkeypatch):
    c,owner,_,_,auth=setup;a=create(c,auth(owner)).json();clock=1800000000
    monkeypatch.setattr(r,'now',lambda:clock)
    with r.engine().begin() as db:
        db.execute(r.update(r.assets).where(r.assets.c.id==a['id']).values(token_address='0x'+'34'*20,launch_id=1))
        for log,time,q in [(1,clock-230,1),(2,clock-10,2)]:
            db.execute(r.insert(r.trades).values(id='0x'+'cd'*32+':'+str(log),launch_id=1,block_number=log,timestamp=time,wallet=owner.address.lower(),side='buy',quote_amount=str(q*10**18),token_amount=str(100*10**18),quote_reserve=str(q*10**18),token_reserve=str(1000*10**18),tx_hash='0x'+'cd'*32))
    url='/api/reality/assets/'+a['id']+'/chart?period=24h&resolution='
    one=c.get(url+'1m').json();five=c.get(url+'5m').json()
    assert one['interval']==60 and len(one['candles'])==2
    assert five['interval']==300 and len(five['candles'])==1
    bar=five['candles'][0]
    assert bar['open']==.001 and bar['close']==.002 and bar['volume_eth']==3 and bar['count']==2
    assert one['trade_count']==five['trade_count']==2 and one['trades']==five['trades']
    for resolution,step in [('4h',14400),('1d',86400)]:
        larger=c.get(url+resolution).json()
        assert larger['interval']==step and larger['trade_count']==2
        assert larger['trades']==one['trades']
    assert c.get(url+'2m').status_code==422


def test_account_profile_is_owned_and_durable(setup):
    c,owner,other,_,auth=setup;h,oh=auth(owner),auth(other)
    assert c.get('/api/reality/account/profile').status_code==401
    assert c.put('/api/reality/account/profile',headers=h,json={'display_name':'Alice'}).json()['display_name']=='Alice'
    assert c.get('/api/reality/account/profile',headers=oh).json()['display_name']==''
    assert c.put('/api/reality/account/profile',headers=h,json={'display_name':'   '}).status_code==400
    assert c.put('/api/reality/account/profile',headers=h,json={'display_name':'x'*41}).status_code==422
    r._engine.dispose();r._engine=None
    assert c.get('/api/reality/account/profile',headers=h).json()['display_name']=='Alice'


def test_account_holdings_read_chain_and_history_is_wallet_scoped(setup,monkeypatch):
    c,owner,other,_,auth=setup;h,oh=auth(owner),auth(other);a=create(c,h).json()
    with r.engine().begin() as db:
        db.execute(r.update(r.assets).where(r.assets.c.id==a['id']).values(token_address='0x'+'12'*20,launch_id=1))
        db.execute(r.insert(r.trades).values(id='0x'+'ef'*32+':1',launch_id=1,block_number=10,timestamp=r.now(),wallet=owner.address.lower(),side='buy',quote_amount=str(10**16),token_amount=str(100*10**18),quote_reserve=str(10**18),token_reserve=str(900*10**18),tx_hash='0x'+'ef'*32))
    async def rpc(method,params):
        if method=='eth_chainId':return hex(91342)
        assert method=='eth_call'
        if params[0]['data'].endswith(owner.address.lower()[2:]):return hex(100*10**18)
        return '0x0'
    monkeypatch.setattr(r,'rpc',rpc)
    assert c.get('/api/reality/account/holdings',headers=h).json()['items'][0]['balance_raw']==str(100*10**18)
    assert c.get('/api/reality/account/holdings',headers=oh).json()['items']==[]
    assert len(c.get('/api/reality/account/trades',headers=h).json()['items'])==1
    assert c.get('/api/reality/account/trades',headers=oh).json()['items']==[]
    async def broken(method,params):
        if method=='eth_chainId':return hex(91342)
        raise Exception('Unavailable')
    monkeypatch.setattr(r,'rpc',broken)
    assert c.get('/api/reality/account/holdings',headers=h).json()['items'][0]['available'] is False

def test_staking_awards_only_confirmed_wallet_events_once(setup,monkeypatch):
    from eth_abi import encode
    c,owner,other,_,auth=setup;h,oh=auth(owner),auth(other)
    vault='0x'+'51'*20;tx='0x'+'41'*32
    monkeypatch.setenv('REALITY_CFI_STAKING',vault)
    c.post('/api/reality/season/register',headers=h,json={})
    log={'address':vault,'topics':[r.STAKE_TOPIC,'0x'+owner.address.lower()[2:].rjust(64,'0')],'data':'0x'+encode(['uint256']*4,[10**18,2000*10**18,2000*10**18,r.now()]).hex(),'transactionHash':tx,'logIndex':'0x0','blockNumber':'0xa'}
    receipt={'status':'0x1','to':vault,'from':owner.address.lower(),'blockNumber':'0xa','logs':[log]}
    async def rpc(method,params):
        return {'eth_chainId':hex(91342),'eth_getTransactionReceipt':receipt,'eth_blockNumber':'0xc','eth_getBlockByNumber':{'timestamp':hex(r.now())}}[method]
    monkeypatch.setattr(r,'rpc',rpc)
    assert c.post('/api/reality/staking/verify',headers=oh,json={'tx_hash':tx}).status_code==400
    receipt['status']='0x0'
    assert c.post('/api/reality/staking/verify',headers=h,json={'tx_hash':tx}).status_code==409
    receipt['status']='0x1'
    for _ in range(2):
        result=c.post('/api/reality/staking/verify',headers=h,json={'tx_hash':tx});assert result.status_code==200,result.text
        assert result.json()['profile']['points']==100 and result.json()['profile']['stakeCompleted']
    assert len(c.get('/api/reality/account/staking',headers=h).json()['items'])==1
    assert c.get('/api/reality/account/staking',headers=oh).json()['items']==[]
    log['topics'][0]=r.UNSTAKE_TOPIC;log['data']='0x'+encode(['uint256']*2,[2000*10**18,10**18]).hex();log['logIndex']='0x1'
    assert c.post('/api/reality/staking/verify',headers=h,json={'tx_hash':tx}).json()['profile']['points']==100
    assert len(c.get('/api/reality/account/staking',headers=h).json()['items'])==2


def test_staking_quote_uses_signed_fresh_price_and_exact_fee(setup,monkeypatch):
    c,*_=setup;monkeypatch.setenv('REALITY_CFI_STAKING','0x'+'51'*20)
    payload={'parsed':[{'id':r.ETH_USD_FEED,'price':{'price':'200000000000','expo':-8,'publish_time':r.now(),'conf':'100'}}],'binary':{'data':['aabb']}}
    class Response:
        status_code=200
        def raise_for_status(self):pass
        def json(self):return payload
    class HTTP:
        def __init__(self,**kw):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def get(self,*args,**kw):return Response()
    monkeypatch.setattr(r.httpx,'AsyncClient',HTTP)
    async def rpc(method,params):
        if method=='eth_chainId':return hex(91342)
        return '0x'+'00'*12+'52'*20 if params[0]['data']=='0x'+r.keccak(text='pyth()').hex()[:8] else '0x1'
    monkeypatch.setattr(r,'rpc',rpc)
    result=c.get('/api/reality/staking/quote?amount=0.1');assert result.status_code==200,result.text
    q=result.json();assert q['amountWei']==str(10**17) and q['expectedCFI']==str(200*10**18) and q['feeWei']=='1' and q['updateData']==['0xaabb']
    for amount in ['0','-1','NaN','1e20','0.0000000000000000001']:
        assert c.get('/api/reality/staking/quote',params={'amount':amount}).status_code==400
    payload['parsed'][0]['price']['publish_time']=r.now()-61
    assert c.get('/api/reality/staking/quote?amount=1').status_code==503

def test_market_watchlist_and_recent_listing_filters_are_owned(setup):
    c,owner,other,_,auth=setup;h,oh=auth(owner),auth(other)
    a=create(c,h).json();b=create(c,h).json();unissued=create(c,h).json();clock=r.now()
    with r.engine().begin() as db:
        for i,row in enumerate([a,b]):db.execute(r.update(r.assets).where(r.assets.c.id==row['id']).values(token_address='0x'+str(i+1)*40,launch_id=i+1))
        db.execute(r.insert(r.launch_listings),[{'asset_id':a['id'],'timestamp':clock-100,'block_number':100},{'asset_id':b['id'],'timestamp':clock-700000,'block_number':1}])
    c.post('/api/reality/assets/'+a['id']+'/reactions',headers=h,json={'kind':'watch'})
    assert c.get('/api/reality/assets?issued=true&watched=true').status_code==401
    own=c.get('/api/reality/assets?issued=true&watched=true',headers=h).json()['items']
    assert [x['id'] for x in own]==[a['id']] and own[0]['watchd']
    assert c.get('/api/reality/assets?issued=true&watched=true',headers=oh).json()['items']==[]
    recent=c.get('/api/reality/assets?issued=true&recent=true').json()['items']
    assert [x['id'] for x in recent]==[a['id']] and recent[0]['issued_at']==clock-100
    assert unissued['id'] not in [x['id'] for x in c.get('/api/reality/assets?issued=true').json()['items']]


def test_rankings_global_metrics_periods_sorting_and_unavailable_values(setup,monkeypatch):
    from eth_abi import encode
    c,owner,other,_,auth=setup;h=auth(owner);a=create(c,h).json();b=create(c,h).json();clock=1800000000
    monkeypatch.setattr(r,'now',lambda:clock);monkeypatch.setenv('REALITY_LAUNCHPAD_ADDRESS','0x'+'98'*20)
    tokens=['0x'+'11'*20,'0x'+'22'*20]
    with r.engine().begin() as db:
        for i,row in enumerate([a,b]):
            db.execute(r.update(r.assets).where(r.assets.c.id==row['id']).values(token_address=tokens[i],launch_id=i+1,review_status='approved' if i else 'unverified'))
            db.execute(r.insert(r.launch_listings).values(asset_id=row['id'],timestamp=clock-200+i*50,block_number=1+i))
        db.execute(r.insert(r.runtime_settings),[{'key':'index_block','value':'105'},{'key':'index_updated_at','value':str(clock)}])
        def trade(launch,log,timestamp,q,qr,wallet=owner.address.lower()):
            return dict(id='0x'+'ae'*32+':'+str(log),launch_id=launch,block_number=log,timestamp=timestamp,wallet=wallet,side='buy',quote_amount=str(q*10**18),token_amount=str(100*10**18),quote_reserve=str(int(r.Decimal(str(qr))*10**18)),token_reserve=str(1000*10**18),tx_hash='0x'+'ae'*32)
        db.execute(r.insert(r.trades),[trade(1,1,clock-90000,1,1),trade(2,2,clock-90000,1,1),trade(1,3,clock-100,10,2),trade(2,4,clock-90,2,1.1),trade(2,5,clock-50,3,1.2,other.address.lower())])
    async def rpc(method,params):
        if method=='eth_chainId':return hex(91342)
        assert method=='eth_call';launch=int(params[0]['data'][-64:],16);i=launch-1
        state=(owner.address.lower(),tokens[i],['A','B'][i],'TOK','url',10**24,10**24,10**18,(i+1)*10**16,0,0,False,False)
        return '0x'+encode(['(address,address,string,string,string,uint256,uint256,uint256,uint256,uint64,uint64,bool,bool)'],[state]).hex()
    monkeypatch.setattr(r,'rpc',rpc)
    endpoint='/api/reality/market/rankings'
    trending=c.get(endpoint).json();assert trending['indexed'] and trending['total']==2
    assert trending['items'][0]['asset']['id']==b['id'] and trending['items'][0]['traders']==2
    assert trending['items'][0]['volume_eth']==5 and trending['items'][0]['liquidity_eth']==.02
    assert trending['items'][0]['price']==.000001 and len(trending['items'][0]['trend'])==2
    volume=c.get(endpoint+'?metric=volume&limit=1').json();assert volume['items'][0]['asset']['id']==a['id'] and volume['has_more']
    second=c.get(endpoint+'?metric=volume&limit=1&page=2').json();assert second['items'][0]['asset']['id']==b['id'] and second['items'][0]['rank']==2
    gainers=c.get(endpoint+'?metric=gainers').json()['items'];assert gainers[0]['asset']['id']==a['id'] and gainers[0]['change']==100
    assert c.get(endpoint+'?metric=volume&direction=asc').json()['items'][0]['asset']['id']==b['id']
    assert c.get(endpoint+'?metric=new').json()['items'][0]['asset']['id']==b['id']
    assert c.get(endpoint+'?verification=verified').json()['total']==1
    assert c.get(endpoint+'?period=5m').json()['items'][0]['traders']==2
    assert c.get(endpoint+'?period=2m').status_code==422
    monkeypatch.setattr(r,'now',lambda:clock+121)
    stale=c.get(endpoint).json();assert not stale['indexed'] and all(x['volume_eth'] is None and x['traders'] is None and x['change'] is None for x in stale['items'])
    async def unavailable(method,params):
        if method=='eth_chainId':return hex(91342)
        raise r.HTTPException(503,'Unavailable')
    monkeypatch.setattr(r,'rpc',unavailable)
    r._ranking_quotes.clear()
    assert all(x['price'] is None and x['liquidity_eth'] is None for x in c.get(endpoint).json()['items'])


def test_rankings_slow_rpc_does_not_block_confirmed_rows(setup,monkeypatch):
    import asyncio,time
    c,owner,_,_,auth=setup;a=create(c,auth(owner)).json()
    monkeypatch.setenv('REALITY_LAUNCHPAD_ADDRESS','0x'+'98'*20)
    with r.engine().begin() as db:
        db.execute(r.update(r.assets).where(r.assets.c.id==a['id']).values(token_address='0x'+'11'*20,launch_id=1))
    async def slow(method,params):
        await asyncio.sleep(5)
        return hex(91342)
    monkeypatch.setattr(r,'rpc',slow)
    started=time.perf_counter();response=c.get('/api/reality/market/rankings')
    assert time.perf_counter()-started<1.5
    assert response.status_code==200 and response.json()['total']==1
    assert response.json()['quotes_pending'] and response.json()['items'][0]['price'] is None

def test_small_public_photos_keep_evidence_private_and_support_revalidation(setup):
    c,owner,_,_,auth=setup;h=auth(owner)
    image=io.BytesIO();Image.new('RGB',(1600,1200),'green').save(image,format='PNG')
    photo=c.post('/api/reality/uploads',headers={**h,'Content-Type':'image/png'},content=image.getvalue()).json()
    url='/api/reality/media/'+photo['id']+'?size=480'
    preview=c.get(url);assert preview.status_code==200 and preview.headers['content-type']=='image/webp'
    assert Image.open(io.BytesIO(preview.content)).size==(480,360)
    assert c.get(url,headers={'If-None-Match':preview.headers['etag']}).status_code==304
    assert c.get('/api/reality/media/'+photo['id']+'?size=97').status_code==422
    private=c.post('/api/reality/uploads?private=true',headers={**h,'Content-Type':'image/png'},content=image.getvalue()).json()
    url='/api/reality/media/'+private['id']+'?size=480'
    assert c.get(url).status_code==401
    proof=c.get(url,headers=h);assert proof.headers['cache-control']=='private, no-store'
    assert 'etag' not in proof.headers and Image.open(io.BytesIO(proof.content)).size==(1600,1200)

def test_market_quotes_share_ranking_cache_and_do_not_wait_for_slow_rpc(setup,monkeypatch):
    import asyncio,time
    c,owner,_,_,auth=setup;a=create(c,auth(owner)).json();clock=r.now()
    monkeypatch.setenv('REALITY_LAUNCHPAD_ADDRESS','0x'+'98'*20)
    token='0x'+'11'*20
    with r.engine().begin() as db:
        db.execute(r.update(r.assets).where(r.assets.c.id==a['id']).values(token_address=token,launch_id=1))
        db.execute(r.insert(r.runtime_settings).values(key='index_updated_at',value=str(clock)))
        db.execute(r.insert(r.trades).values(id='0x'+'aa'*32+':1',launch_id=1,block_number=1,timestamp=clock,wallet=owner.address.lower(),side='buy',quote_amount='1',token_amount='1',quote_reserve='100',token_reserve='1000',tx_hash='0x'+'aa'*32))
    async def slow(method,params):await asyncio.sleep(5);return hex(91342)
    monkeypatch.setattr(r,'rpc',slow)
    started=time.perf_counter();result=c.get('/api/reality/assets/'+a['id']+'/market')
    assert time.perf_counter()-started<1 and result.json()['price']==.1 and result.json()['reserve'] is None
    key=(r.config()['rpc'],r.config()['launchpad'],1,token,owner.address.lower())
    r._ranking_quotes[key]=(time.monotonic(),{'price':.2,'cap':2,'liquidity_eth':.01,'tokenReserve':'1000','quoteReserve':'200'})
    assert c.get('/api/reality/assets/'+a['id']+'/market').json()['reserve']==.01
    assert c.get('/api/reality/market/rankings').json()['items'][0]['price']==.2

def test_staking_index_cursor_is_scoped_to_each_redeployed_vault(setup,monkeypatch):
    import asyncio
    from eth_abi import encode
    c,owner,*_=setup
    old_vault='0x'+'51'*20;new_vault='0x'+'52'*20
    monkeypatch.setenv('REALITY_CFI_STAKING',new_vault)
    monkeypatch.setenv('REALITY_CFI_START_BLOCK','100')
    with r.engine().begin() as db:
        db.execute(r.insert(r.runtime_settings),[{'key':'cfi_index_block','value':'99999'},{'key':'cfi_index_block:'+old_vault,'value':'99999'}])
    queries=[]
    log={'address':new_vault,'topics':[r.STAKE_TOPIC,'0x'+owner.address.lower()[2:].rjust(64,'0')],
         'data':'0x'+encode(['uint256']*4,[10**15,2*10**18,2000*10**18,r.now()]).hex(),
         'transactionHash':'0x'+'42'*32,'logIndex':'0x0','blockNumber':hex(100)}
    async def rpc(method,params):
        if method=='eth_chainId':return hex(91342)
        if method=='eth_blockNumber':return hex(104)
        if method=='eth_getBlockByNumber':return {'timestamp':hex(r.now())}
        if method=='eth_getLogs':queries.append(params[0]);return [log]
        raise AssertionError(method)
    monkeypatch.setattr(r,'rpc',rpc)
    asyncio.run(r.sync_staking())
    assert queries[0]['address']==new_vault and queries[0]['fromBlock']==hex(100)
    with r.engine().connect() as db:
        assert db.execute(r.select(r.runtime_settings.c.value).where(r.runtime_settings.c.key=='cfi_index_block:'+new_vault)).scalar()=='103'
        assert db.execute(r.select(r.runtime_settings.c.value).where(r.runtime_settings.c.key=='cfi_index_block:'+old_vault)).scalar()=='99999'
        assert db.execute(r.select(r.func.count()).select_from(r.stake_events)).scalar()==1

def test_binance_staking_quotes_use_operator_signature_and_authenticated_wallet(setup,monkeypatch):
    c,owner,other,_,auth=setup;h=auth(owner);vault='0x'+'51'*20;signer=Account.create()
    monkeypatch.setenv('REALITY_CFI_STAKING',vault);monkeypatch.setenv('REALITY_CFI_PRICE_SOURCE','binance');monkeypatch.setenv('CFI_QUOTE_SIGNER_KEY',signer.key.hex())
    payload={'symbol':'ETHUSDT','price':'2222.00000000'};requests=[]
    class Response:
        def raise_for_status(self):pass
        def json(self):return payload
    class HTTP:
        def __init__(self,**kw):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def get(self,url,**kwargs):requests.append((url,kwargs));return Response()
    monkeypatch.setattr(r.httpx,'AsyncClient',HTTP)
    async def rpc(method,params):
        if method=='eth_chainId':return hex(91342)
        if params[0]['data']=='0x'+r.keccak(text='quoteSigner()').hex()[:8]:return '0x'+'00'*12+signer.address.lower()[2:]
        return hex(5)
    monkeypatch.setattr(r,'rpc',rpc)
    q=c.get('/api/reality/staking/quote?amount=0.1',headers=h).json()
    assert q['expectedCFI']==str(2222*10**17) and q['price18']==str(2222*10**18) and q['feeWei']=='0' and q['nonce']=='5'
    assert q['source']=='binance' and q['account']==owner.address.lower() and q['deadline']==q['issuedAt']+60
    typed=r.encode_typed_data(domain_data={'name':'Custos CFI Binance','version':'1','chainId':91342,'verifyingContract':vault},message_types={'StakeQuote':r.STAKE_QUOTE_FIELDS},message_data={'account':q['account'],'amount':int(q['amountWei']),'price18':int(q['price18']),'issuedAt':q['issuedAt'],'deadline':q['deadline'],'nonce':int(q['nonce'])})
    assert Account.recover_message(typed,signature=q['signature'])==signer.address
    preview=c.get('/api/reality/staking/quote?amount=1').json();assert preview['signature'] is None and preview['expectedCFI']==str(2222*10**18)
    assert len(requests)==1 and requests[0][1]['params']=={'symbol':'ETHUSDT'} and 'headers' not in requests[0][1]
    assert c.get('/api/reality/staking/quote?amount=1',headers={'Authorization':'Bearer invalid'}).status_code==401
    for value in ['NaN','Infinity','0','-1','100000001']:
        r._binance_price_cache=None;r._binance_price_task=None;payload['price']=value
        assert c.get('/api/reality/staking/quote?amount=1',headers=h).status_code==503
    payload['price']='2000';r._binance_price_cache=None;r._binance_price_task=None
    assert c.get('/api/reality/staking/quote?amount=1',headers=h).json()['expectedCFI']==str(2000*10**18)
    monkeypatch.setenv('CFI_QUOTE_SIGNER_KEY',other.key.hex())
    assert c.get('/api/reality/staking/quote?amount=1',headers=h).status_code==503


def test_moderation_authority_visibility_persistence_and_restore(setup):
    c,owner,other,admin,auth=setup
    h,oh,ah=auth(owner),auth(other),auth(admin)
    a=create(c,h).json();id=a['id'];endpoint='/api/reality/admin/projects/'+id+'/moderation'
    with r.engine().begin() as db:
        db.execute(r.update(r.assets).where(r.assets.c.id==id).values(token_address='0x'+'2'*40,launch_id=1,review_status='approved'))
    body={'status':'delisted','reason':'No evidence of a real-world subject'}
    assert c.post(endpoint,json=body).status_code==401
    assert c.post(endpoint,headers=oh,json=body).status_code==403
    assert c.post(endpoint,headers=ah,json={**body,'reason':'   '}).status_code==400
    assert c.post(endpoint,headers=ah,json=body).status_code==200
    assert not c.get('/api/reality/assets').json()['items']
    assert not c.get('/api/reality/assets?issued=true').json()['items']
    assert not c.get('/api/reality/market/rankings').json()['items']
    assert c.get('/api/reality/assets/'+id).status_code==404
    assert c.get('/api/reality/assets/'+id,headers=oh).status_code==404
    owned=c.get('/api/reality/assets/'+id,headers=h).json()
    assert owned['listing_status']=='delisted' and owned['review_status']=='revoked'
    assert owned['token_address']=='0x'+'2'*40
    assert c.get('/api/reality/admin/reviews',headers=ah).json()['items'][0]['listing_status']=='delisted'
    assert c.get('/api/reality/activity').status_code==200
    r._engine.dispose();r._engine=None
    assert not c.get('/api/reality/assets').json()['items']
    assert c.post(endpoint,headers=ah,json={'status':'listed','reason':'Original evidence now supplied'}).status_code==200
    restored=c.get('/api/reality/assets/'+id).json()
    assert restored['listing_status']=='listed' and restored['verified'] is False
    assert c.get('/api/reality/assets').json()['items'][0]['id']==id
    with r.engine().connect() as db:
        assert len(list(db.execute(r.select(r.audits).where(r.audits.c.asset_id==id))))==2

def test_feedback_rewards_require_admin_and_are_audited_idempotent(setup):
    c,owner,other,admin,auth=setup
    h,ah=auth(owner),auth(admin)
    body={'id':r.uid(),'wallet':owner.address,'points':50,'reason':'Useful mobile feedback','reference':'feedback-001'}
    assert c.post('/api/reality/admin/points',json=body).status_code==401
    assert c.post('/api/reality/admin/points',headers=h,json=body).status_code==403
    assert c.get('/api/reality/admin/points',headers=h).status_code==403
    result=c.post('/api/reality/admin/points',headers=ah,json=body)
    assert result.status_code==200,result.text
    assert result.json()['profile']['points']==50 and result.json()['profile']['bonusPoints']==50
    assert c.post('/api/reality/admin/points',headers=ah,json=body).json()['duplicate']
    assert c.post('/api/reality/admin/points',headers=ah,json={**body,'id':r.uid()}).status_code==409
    assert c.post('/api/reality/admin/points',headers=ah,json={**body,'points':60}).status_code==409
    history=c.get('/api/reality/admin/points',headers=ah,params={'wallet':owner.address}).json()
    assert len(history['items'])==1 and history['items'][0]['admin']==admin.address.lower()
    assert c.get('/api/reality/season/stats').json()['pointsIssued']==50
    assert c.get('/api/reality/season/leaderboard').json()['entries'][0]['wallet']==owner.address.lower()
    for points in [0,-1,100001,1.5,'50',True]:
        assert c.post('/api/reality/admin/points',headers=ah,json={**body,'id':r.uid(),'reference':r.uid(),'points':points}).status_code==422
    assert c.post('/api/reality/admin/points',headers=ah,json={**body,'id':r.uid(),'reference':'   '}).status_code==400
    assert c.post('/api/reality/admin/points/'+body['id']+'/revoke',headers=h,json={'reason':'Mistake'}).status_code==403
    for _ in range(2):
        revoked=c.post('/api/reality/admin/points/'+body['id']+'/revoke',headers=ah,json={'reason':'Duplicate feedback report'})
        assert revoked.status_code==200 and revoked.json()['profile']['points']==0
    row=c.get('/api/reality/admin/points',headers=ah).json()['items'][0]
    assert row['revoked_by']==admin.address.lower() and row['revoked_reason']=='Duplicate feedback report'
    assert c.get('/api/reality/season/leaderboard').json()['entries']==[]


def test_confirmed_stake_counts_before_season_registration_and_admin_can_recover(setup,monkeypatch):
    from eth_abi import encode
    c,owner,other,admin,auth=setup
    vault='0x'+'51'*20;tx='0x'+'41'*32
    monkeypatch.setenv('REALITY_CFI_STAKING',vault)
    log={'address':vault,'topics':[r.STAKE_TOPIC,'0x'+owner.address.lower()[2:].rjust(64,'0')],'data':'0x'+encode(['uint256']*4,[10**18,2000*10**18,2000*10**18,r.now()]).hex(),'transactionHash':tx,'logIndex':'0x0','blockNumber':'0xa'}
    receipt={'status':'0x1','to':vault,'from':owner.address.lower(),'blockNumber':'0xa','logs':[log]}
    async def rpc(method,params):
        return {'eth_chainId':hex(91342),'eth_getTransactionReceipt':receipt,'eth_blockNumber':'0xc','eth_getBlockByNumber':{'timestamp':hex(r.now())}}[method]
    monkeypatch.setattr(r,'rpc',rpc)
    h,ah=auth(owner),auth(admin)
    assert c.post('/api/reality/admin/staking/verify',headers=h,json={'wallet':owner.address,'tx_hash':tx}).status_code==403
    assert c.post('/api/reality/admin/staking/verify',headers=ah,json={'wallet':other.address,'tx_hash':tx}).status_code==400
    receipt['status']='0x0'
    assert c.post('/api/reality/admin/staking/verify',headers=ah,json={'wallet':owner.address,'tx_hash':tx}).status_code==409
    receipt['status']='0x1'
    for _ in range(2):
        response=c.post('/api/reality/admin/staking/verify',headers=ah,json={'wallet':owner.address,'tx_hash':tx})
        assert response.status_code==200,response.text
        assert response.json()['profile']['points']==100 and response.json()['profile']['stakeCompleted']
    assert c.get('/api/reality/season/leaderboard').json()['entries'][0]['points']==100
    assert c.post('/api/reality/season/register',headers=h,json={}).json()['points']==100
    award={'id':r.uid(),'wallet':owner.address,'points':25,'reason':'Reported stake issue','reference':'stake-feedback-001'}
    assert c.post('/api/reality/admin/points',headers=ah,json=award).json()['profile']['points']==125
    assert c.post('/api/reality/staking/verify',headers=h,json={'tx_hash':tx}).json()['profile']['points']==125
