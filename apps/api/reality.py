"""Reality Launchpad: signed wallet sessions, durable content and human review.

No price seeds, self-issued verification badges or unsigned chain attachments.
SQLite is suitable for a single persistent VM. Cloud Run requires PostgreSQL + GCS.
"""
from __future__ import annotations
import asyncio, hashlib, io, json, os, re, secrets, time, uuid
from pathlib import Path
from typing import Literal
import httpx
from network_config import network_config
from features import feature_enabled
from eth_account import Account
from eth_account.messages import encode_typed_data
from eth_account.messages import encode_defunct
from eth_abi import decode, encode
from eth_abi.exceptions import DecodingError
from decimal import Decimal, InvalidOperation
from eth_utils import keccak
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from PIL import Image, UnidentifiedImageError
from sqlalchemy import (create_engine, MetaData, Table, Column, String, Text, Integer, Float,
                        ForeignKey, UniqueConstraint, select, insert, update, delete, func, event)

router=APIRouter(prefix='/api/reality', tags=['Reality Launchpad'])
metadata=MetaData()
users=Table('reality_users', metadata, Column('wallet',String(42),primary_key=True),Column('created_at',Integer,nullable=False))
nonces=Table('reality_nonces',metadata,Column('id',String,primary_key=True),Column('wallet',String,nullable=False),Column('message',Text,nullable=False),Column('expires_at',Integer,nullable=False))
sessions=Table('reality_sessions',metadata,Column('hash',String,primary_key=True),Column('wallet',String,nullable=False),Column('expires_at',Integer,nullable=False))
uploads=Table('reality_uploads',metadata,Column('id',String,primary_key=True),Column('wallet',String,nullable=False),Column('name',String,nullable=False),Column('type',String,nullable=False),Column('private',Integer,nullable=False),Column('created_at',Integer,nullable=False))
assets=Table('reality_assets',metadata,Column('id',String,primary_key=True),Column('wallet',String,nullable=False),Column('name',String,nullable=False),Column('symbol',String,nullable=False),Column('story',String,nullable=False),Column('description',Text,nullable=False),Column('category',String,nullable=False),Column('image_id',String,ForeignKey('reality_uploads.id'),nullable=False),Column('mode',String,nullable=False),Column('supply',String,nullable=False),Column('review_status',String,nullable=False),Column('proof_code',String,nullable=False),Column('proof_ids',Text,nullable=False),Column('review_note',Text,nullable=False),Column('token_address',String),Column('launch_id',Integer),Column('tx_hash',String),Column('created_at',Integer,nullable=False),UniqueConstraint('token_address'))
reactions=Table('reality_reactions',metadata,Column('id',String,primary_key=True),Column('asset_id',String,ForeignKey('reality_assets.id'),nullable=False),Column('wallet',String,nullable=False),Column('kind',String,nullable=False),UniqueConstraint('asset_id','wallet','kind'))
comments=Table('reality_comments',metadata,Column('id',String,primary_key=True),Column('asset_id',String,ForeignKey('reality_assets.id'),nullable=False),Column('wallet',String,nullable=False),Column('body',Text,nullable=False),Column('created_at',Integer,nullable=False))
valuations=Table('reality_valuations',metadata,Column('id',String,primary_key=True),Column('asset_id',String,ForeignKey('reality_assets.id'),nullable=False),Column('wallet',String,nullable=False),Column('amount',Float,nullable=False),UniqueConstraint('asset_id','wallet'))
audits=Table('reality_audits',metadata,Column('id',String,primary_key=True),Column('asset_id',String,nullable=False),Column('wallet',String,nullable=False),Column('decision',String,nullable=False),Column('note',Text,nullable=False),Column('created_at',Integer,nullable=False))
moderation=Table('reality_moderation',metadata,Column('asset_id',String,ForeignKey('reality_assets.id'),primary_key=True),Column('status',String,nullable=False),Column('reason',Text,nullable=False),Column('wallet',String,nullable=False),Column('updated_at',Integer,nullable=False))
runtime_settings=Table('reality_settings',metadata,Column('key',String,primary_key=True),Column('value',Text,nullable=False))
trades=Table('reality_trades',metadata,Column('id',String,primary_key=True),Column('launch_id',Integer,nullable=False),Column('block_number',Integer,nullable=False),Column('timestamp',Integer,nullable=False),Column('wallet',String,nullable=False),Column('side',String,nullable=False),Column('quote_amount',String,nullable=False),Column('token_amount',String,nullable=False),Column('quote_reserve',String,nullable=False),Column('token_reserve',String,nullable=False),Column('tx_hash',String,nullable=False))
_engine=None
season_profiles=Table('reality_season_profiles',metadata,Column('wallet',String,primary_key=True),Column('code',String,unique=True,nullable=False),Column('inviter',String,nullable=False),Column('x_handle',String,nullable=False),Column('x_status',String,nullable=False),Column('created_at',Integer,nullable=False))
x_visits=Table('reality_x_visits',metadata,Column('wallet',String,primary_key=True),Column('created_at',Integer,nullable=False))
point_awards=Table('reality_point_awards',metadata,
    Column('id',String,primary_key=True),Column('wallet',String,nullable=False),
    Column('points',Integer,nullable=False),Column('reason',Text,nullable=False),
    Column('reference',String(200),unique=True,nullable=False),Column('admin',String,nullable=False),
    Column('created_at',Integer,nullable=False),Column('revoked_by',String),
    Column('revoked_reason',Text),Column('revoked_at',Integer))
account_profiles=Table('reality_account_profiles',metadata,Column('wallet',String,primary_key=True),Column('display_name',String(40),nullable=False))
stake_events=Table('reality_stake_events',metadata,Column('id',String,primary_key=True),Column('wallet',String,nullable=False),Column('side',String,nullable=False),Column('eth_amount',String,nullable=False),Column('cfi_amount',String,nullable=False),Column('tx_hash',String,nullable=False),Column('block_number',Integer,nullable=False),Column('timestamp',Integer,nullable=False))
launch_listings=Table('reality_launch_listings',metadata,Column('asset_id',String,primary_key=True),Column('timestamp',Integer,nullable=False),Column('block_number',Integer,nullable=False))


def engine():
    global _engine
    if _engine is None:
        url=os.getenv('REALITY_DATABASE_URL','').strip()
        if os.getenv('K_SERVICE') and (not url.startswith('postgresql') or not os.getenv('REALITY_GCS_BUCKET')):
            raise HTTPException(503,'Cloud Run requires persistent PostgreSQL and GCS storage')
        if not url:
            root=Path(os.getenv('REALITY_DATA_DIR',str(Path(__file__).parent/'data'/'reality'))).resolve()
            root.mkdir(parents=True,exist_ok=True)
            url='sqlite:///'+str(root/'reality.db').replace('\\','/')
        if url.startswith('postgresql://'): url=url.replace('postgresql://','postgresql+psycopg://',1)
        _engine=create_engine(url,connect_args={'check_same_thread':False,'timeout':30} if url.startswith('sqlite') else {},pool_pre_ping=True)
        if url.startswith('sqlite'):
            @event.listens_for(_engine,'connect')
            def sqlite_setup(dbapi, _):
                dbapi.execute('PRAGMA foreign_keys=ON'); dbapi.execute('PRAGMA journal_mode=WAL')
        metadata.create_all(_engine)
    return _engine

def uid(): return str(uuid.uuid4())
def now(): return int(time.time())
def admins(): return {x.strip().lower() for x in os.getenv('REALITY_ADMIN_WALLETS','').split(',') if re.fullmatch(r'0x[0-9a-fA-F]{40}',x.strip())}
def config():
    with engine().connect() as db: stored={r.key:r.value for r in db.execute(select(runtime_settings))}
    net=network_config()
    return {'chain_id':net['chain_id'],'name':net['name'],'rpc':net['rpc'],
            'explorer':net['explorer'],'testnet':True,'native_symbol':net['native_symbol'],'points_enabled':feature_enabled('points'),
            'launchpad':os.getenv('REALITY_LAUNCHPAD_ADDRESS','') or stored.get('launchpad',''),'platform_token':os.getenv('REALITY_PLATFORM_TOKEN','') or stored.get('platform_token',''),
            'swap_router':os.getenv('REALITY_SWAP_ROUTER','') or stored.get('swap_router',''),'swap_factory':os.getenv('REALITY_SWAP_FACTORY','') or stored.get('swap_factory',''),
            'cfi_staking':os.getenv('REALITY_CFI_STAKING','') or stored.get('cfi_staking',''),
            'cfi_price_source':os.getenv('REALITY_CFI_PRICE_SOURCE','pyth'),
            'cfi_start_block':int(os.getenv('REALITY_CFI_START_BLOCK','0') or '0') or int(stored.get('cfi_start_block','0')),
            'weth':os.getenv('REALITY_WETH','' if net['chain_id']==99801 else '0x4200000000000000000000000000000000000006'),'admin_configured':bool(admins())}
class BridgeRpc(BaseModel):
    jsonrpc:Literal['2.0']='2.0'
    id:int|str|None=1
    method:str
    params:list=Field(default_factory=list,max_length=8)

class OriginalSeasonEntry(BaseModel):
    rank:int=Field(ge=1)
    wallet:str=Field(pattern=r'^0x[0-9a-fA-F]{40}$')
    points:int=Field(ge=0)
    verifiedTransactions:int=Field(ge=0)
    qualifiedReferrals:int=Field(ge=0)
class OriginalSeasonBoard(BaseModel):
    season:Literal['S1']
    entries:list[OriginalSeasonEntry]=Field(max_length=100)
_original_season_cache=None
_original_season_task=None

async def fetch_original_season():
    global _original_season_cache
    url='https://www.custosfinance.xyz/api/beta/leaderboard?limit=100'
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response=await client.get(url);response.raise_for_status()
            board=OriginalSeasonBoard.model_validate(response.json()).model_dump()
        board.update(source='original_custos',source_url='https://www.custosfinance.xyz',updated_at=now(),stale=False)
        _original_season_cache=board
        return board
    except (httpx.HTTPError,ValueError):
        if _original_season_cache and now()-_original_season_cache['updated_at']<300:
            return {**_original_season_cache,'stale':True}
        raise HTTPException(503,'Original Custos Season 1 is temporarily unavailable. Retry later.')

@router.get('/season/original-leaderboard')
async def original_season_leaderboard():
    global _original_season_task
    if _original_season_cache and now()-_original_season_cache['updated_at']<30:return _original_season_cache
    if _original_season_task is None:_original_season_task=asyncio.create_task(fetch_original_season())
    task=_original_season_task
    try:return await asyncio.shield(task)
    finally:
        if task.done() and _original_season_task is task:_original_season_task=None

BRIDGE_READ_METHODS={'eth_chainId','eth_blockNumber','eth_getBalance','eth_getCode','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getBlockByNumber','eth_getBlockByHash','eth_getLogs','eth_getProof','eth_getStorageAt','eth_call','eth_estimateGas','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory','eth_getTransactionCount'}
@router.post('/bridge/rpc/{network}')
async def bridge_rpc(network:Literal['sepolia','giwa'],body:BridgeRpc):
    if body.method not in BRIDGE_READ_METHODS:raise HTTPException(400,'Only read-only bridge RPC methods are allowed')
    if len(json.dumps(body.params))>32768:raise HTTPException(400,'RPC parameters too large')
    endpoint=os.getenv('SEPOLIA_RPC_URL','https://ethereum-sepolia-rpc.publicnode.com') if network=='sepolia' else os.getenv('GIWA_RPC_URL','https://sepolia-rpc.giwa.io')
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response=await client.post(endpoint,json=body.model_dump())
            response.raise_for_status();result=response.json()
        if not isinstance(result,dict) or ('result' not in result and 'error' not in result):raise ValueError('Invalid RPC response')
        return result
    except (httpx.HTTPError,ValueError):raise HTTPException(503,'Bridge RPC temporarily unavailable. Retry later.')

def wallet_auth(request:Request):
    value=request.headers.get('authorization','')
    if not value.startswith('Bearer '): raise HTTPException(401,'Connect your wallet and sign in')
    digest=hashlib.sha256(value[7:].encode()).hexdigest()
    with engine().connect() as db: row=db.execute(select(sessions).where(sessions.c.hash==digest,sessions.c.expires_at>now())).mappings().first()
    if not row: raise HTTPException(401,'Session expired. Please sign in again')
    return row['wallet']
def admin_auth(wallet=Depends(wallet_auth)):
    if wallet not in admins(): raise HTTPException(403,'Administrator access required')
    return wallet
def visible_listing():
    return ~assets.c.id.in_(select(moderation.c.asset_id).where(moderation.c.status=='delisted'))

def find_asset(db,id):
    row=db.execute(select(assets).where(assets.c.id==id)).mappings().first()
    if not row: raise HTTPException(404,'Project not found')
    return dict(row)
def own(row,wallet):
    if row['wallet']!=wallet: raise HTTPException(403,'Only the project creator may do this')
def check_upload(db,id,wallet,private=None):
    row=db.execute(select(uploads).where(uploads.c.id==id,uploads.c.wallet==wallet)).mappings().first()
    if not row or (private is not None and bool(row['private'])!=private): raise HTTPException(400,'Attachment missing, inaccessible or wrong type')
    return row
def image_url(id): return '/api/reality/media/'+id
def enrich(db,row,wallet=''):
    result=dict(row);m=db.execute(select(moderation).where(moderation.c.asset_id==row['id'])).mappings().first();result['listing_status']=m['status'] if m else 'listed';result['moderation_reason']=m['reason'] if m else '';result['image_url']=image_url(row['image_id']);result['verified']=row['review_status']=='approved'
    result['issued_at']=db.execute(select(launch_listings.c.timestamp).where(launch_listings.c.asset_id==row['id'])).scalar()
    # Verification is only computed from the server-controlled review result.
    for kind in ('love','collect','watch'):
        result[kind+'_count']=db.execute(select(func.count()).select_from(reactions).where(reactions.c.asset_id==row['id'],reactions.c.kind==kind)).scalar()
        result[kind+'d']=bool(db.execute(select(reactions.c.id).where(reactions.c.asset_id==row['id'],reactions.c.kind==kind,reactions.c.wallet==wallet)).first())
    offers=list(db.execute(select(valuations.c.amount).where(valuations.c.asset_id==row['id'])).scalars())
    offers.sort();n=len(offers);result['valuation_count']=n
    result['community_value']=None if not n else (offers[n//2] if n%2 else (offers[n//2-1]+offers[n//2])/2)
    if row['wallet']!=wallet and wallet not in admins():
        result.pop('proof_ids',None);result.pop('proof_code',None);result.pop('review_note',None)
    return result

class Challenge(BaseModel): wallet:str=Field(pattern=r'^0x[0-9a-fA-F]{40}$')
class Login(BaseModel): id:str;signature:str=Field(min_length=100,max_length=200)
@router.get('/config')
def get_config(): return config()
@router.post('/auth/challenge')
def challenge(body:Challenge,request:Request):
    id=uid();wallet=body.wallet.lower();stamp=now()
    domain=os.getenv('REALITY_PUBLIC_ORIGIN','').strip() or str(request.base_url).rstrip('/')
    message=f'{domain} requests a Custos wallet login.\nWallet: {wallet}\nChain ID: {network_config()["chain_id"]}\nNonce: {secrets.token_hex(16)}\nIssued: {stamp}\nExpires: {stamp+300}\nSign in only. No transaction or token allowance.'
    with engine().begin() as db:
        db.execute(delete(nonces).where(nonces.c.expires_at<stamp));db.execute(delete(sessions).where(sessions.c.expires_at<stamp))
        existing=db.execute(select(func.count()).select_from(nonces).where(nonces.c.wallet==wallet)).scalar()
        if existing>=5: raise HTTPException(429,'Too many requests. Retry in five minutes')
        db.execute(insert(nonces).values(id=id,wallet=wallet,message=message,expires_at=stamp+300))
    return {'id':id,'message':message}
@router.post('/auth/login')
def login(body:Login):
    with engine().begin() as db:
        row=db.execute(select(nonces).where(nonces.c.id==body.id,nonces.c.expires_at>now())).mappings().first()
        if not row: raise HTTPException(401,'Sign-in challenge expired or already used')
        try: address=Account.recover_message(encode_defunct(text=row['message']),signature=body.signature).lower()
        except Exception: raise HTTPException(401,'Invalid signature')
        if address!=row['wallet']: raise HTTPException(401,'Signature wallet mismatch')
        consumed=db.execute(delete(nonces).where(nonces.c.id==body.id))
        if consumed.rowcount!=1: raise HTTPException(401,'Sign-in challenge already used')
        if not db.execute(select(users.c.wallet).where(users.c.wallet==address)).first(): db.execute(insert(users).values(wallet=address,created_at=now()))
        token=secrets.token_urlsafe(48);db.execute(insert(sessions).values(hash=hashlib.sha256(token.encode()).hexdigest(),wallet=address,expires_at=now()+86400))
    return {'token':token,'wallet':address,'is_admin':address in admins(),'expires_at':now()+86400}
@router.get('/me')
def me(wallet=Depends(wallet_auth)): return {'wallet':wallet,'is_admin':wallet in admins()}
@router.get('/account/profile')
def account_profile(wallet=Depends(wallet_auth)):
    with engine().connect() as db:name=db.execute(select(account_profiles.c.display_name).where(account_profiles.c.wallet==wallet)).scalar()
    return {'wallet':wallet,'display_name':name or ''}

class ProfileUpdate(BaseModel):display_name:str=Field(min_length=1,max_length=40)
@router.put('/account/profile')
def save_account_profile(body:ProfileUpdate,wallet=Depends(wallet_auth)):
    name=body.display_name.strip()
    if not name or any(ord(c)<32 for c in name):raise HTTPException(400,'Please enter a valid display name')
    with engine().begin() as db:
        if db.execute(select(account_profiles.c.wallet).where(account_profiles.c.wallet==wallet)).scalar():db.execute(update(account_profiles).where(account_profiles.c.wallet==wallet).values(display_name=name))
        else:db.execute(insert(account_profiles).values(wallet=wallet,display_name=name))
    return {'wallet':wallet,'display_name':name}

@router.get('/account/holdings')
async def account_holdings(page:int=1,wallet=Depends(wallet_auth)):
    page=max(1,page)
    if int(await rpc('eth_chainId',[]),16)!=network_config()['chain_id']:raise HTTPException(503,'GIWA RPC network mismatch')
    with engine().connect() as db:
        rows=db.execute(select(assets).where(visible_listing(),assets.c.token_address.is_not(None)).order_by(assets.c.created_at.desc(),assets.c.id.asc()).offset((page-1)*50).limit(51)).mappings().all()
    selector='0x'+keccak(text='balanceOf(address)').hex()[:8]+wallet[2:].rjust(64,'0')
    async def balance(row):
        try:
            value=await rpc('eth_call',[{'to':row['token_address'],'data':selector},'latest'])
            amount=int(value,16)
            return {'asset_id':row['id'],'name':row['name'],'symbol':row['symbol'],'token_address':row['token_address'],'balance_raw':str(amount),'available':True} if amount else None
        except Exception:return {'asset_id':row['id'],'name':row['name'],'symbol':row['symbol'],'token_address':row['token_address'],'balance_raw':None,'available':False}
    result=[]
    for i in range(0,min(50,len(rows)),5):result.extend(await asyncio.gather(*(balance(row) for row in rows[i:i+5])))
    return {'wallet':wallet,'items':[r for r in result if r is not None],'has_more':len(rows)>50,'page':page}

@router.get('/account/trades')
def account_trades(page:int=1,wallet=Depends(wallet_auth)):
    page=max(1,page)
    with engine().connect() as db:
        updated=db.execute(select(runtime_settings.c.value).where(runtime_settings.c.key=='index_updated_at')).scalar()
        query=select(trades,assets.c.id.label('asset_id'),assets.c.name,assets.c.symbol).join(assets,assets.c.launch_id==trades.c.launch_id).where(trades.c.wallet==wallet).order_by(trades.c.block_number.desc(),trades.c.id.desc()).offset((page-1)*50).limit(51)
        rows=db.execute(query).mappings().all()
    selected=sorted(rows[:50],key=lambda r:(r['block_number'],int(r['id'].rsplit(':',1)[-1])),reverse=True)
    return {'items':[dict(r) for r in selected],'has_more':len(rows)>50,'page':page,'indexed':bool(updated and 0<=now()-int(updated)<120)}
@router.post('/auth/logout')
def logout(request:Request,wallet=Depends(wallet_auth)):
    with engine().begin() as db: db.execute(delete(sessions).where(sessions.c.hash==hashlib.sha256(request.headers['authorization'][7:].encode()).hexdigest()))
    return {'ok':True}

def store_bytes(id,data):
    bucket=os.getenv('REALITY_GCS_BUCKET','')
    if bucket:
        from google.cloud import storage
        storage.Client().bucket(bucket).blob('reality/'+id).upload_from_string(data)
    else:
        root=Path(os.getenv('REALITY_DATA_DIR',str(Path(__file__).parent/'data'/'reality')))/'files';root.mkdir(parents=True,exist_ok=True)
        (root/id).write_bytes(data)
def read_bytes(id):
    bucket=os.getenv('REALITY_GCS_BUCKET','')
    if bucket:
        from google.cloud import storage
        return storage.Client().bucket(bucket).blob('reality/'+id).download_as_bytes()
    return (Path(os.getenv('REALITY_DATA_DIR',str(Path(__file__).parent/'data'/'reality')))/'files'/id).read_bytes()
@router.post('/uploads')
async def upload(request:Request,private:bool=False,wallet=Depends(wallet_auth)):
    mime=request.headers.get('content-type','').split(';')[0];name=request.headers.get('x-file-name','upload')[:180]
    data=bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data)>10*1024*1024: raise HTTPException(413,'Files must be under 10 MB')
    if not data: raise HTTPException(400,'File is empty')
    if mime in ('image/jpeg','image/png','image/webp'):
        try:
            Image.MAX_IMAGE_PIXELS=24_000_000
            photo=Image.open(io.BytesIO(data));photo.load();photo=photo.convert('RGB');photo.thumbnail((2400,2400));buffer=io.BytesIO();photo.save(buffer,format='JPEG',quality=90);data=buffer.getvalue();mime='image/jpeg'
        except (UnidentifiedImageError,Image.DecompressionBombError,Image.DecompressionBombWarning,OSError,ValueError): raise HTTPException(400,'Invalid image or image too large')
    elif private and mime=='application/pdf' and bytes(data).startswith(b'%PDF-'): data=bytes(data)
    elif private and mime=='video/mp4' and bytes(data)[4:8]==b'ftyp':data=bytes(data)
    elif private and mime=='video/webm' and bytes(data).startswith(b'\x1a\x45\xdf\xa3'):data=bytes(data)
    else: raise HTTPException(400,'Images support JPG/PNG/WebP. Private evidence also supports PDF/MP4/WebM')
    with engine().connect() as db:
        count=db.execute(select(func.count()).select_from(uploads).where(uploads.c.wallet==wallet,uploads.c.created_at>now()-3600)).scalar()
        if count>=50: raise HTTPException(429,'Maximum 50 uploads per hour')
    id=uid();store_bytes(id,data)
    with engine().begin() as db: db.execute(insert(uploads).values(id=id,wallet=wallet,name=name,type=mime,private=int(private),created_at=now()))
    return {'id':id,'url':image_url(id),'name':name,'private':private}
@router.get('/media/{id}')
def media(id:str,request:Request,size:int|None=None):
    if size is not None and size not in (96,480,960):raise HTTPException(422,'Unsupported image size')
    with engine().connect() as db: row=db.execute(select(uploads).where(uploads.c.id==id)).mappings().first()
    if not row: raise HTTPException(404,'Attachment not found')
    if row['private']:
        wallet=wallet_auth(request)
        if wallet!=row['wallet'] and wallet not in admins(): raise HTTPException(403,'Evidence is private to creators and reviewers')
    try: data=read_bytes(id)
    except Exception: raise HTTPException(503,'Attachment storage temporarily unavailable')
    mime=row['type']
    if size and not row['private'] and mime.startswith('image/'):
        photo=Image.open(io.BytesIO(data));photo.thumbnail((size,size));buffer=io.BytesIO();photo.convert('RGB').save(buffer,format='WEBP',quality=80);data=buffer.getvalue();mime='image/webp'
    etag='"'+hashlib.sha256(data).hexdigest()+'"'
    headers={'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store' if row['private'] else 'public, max-age=86400','Content-Disposition':'attachment' if mime=='application/pdf' else 'inline'}
    if not row['private']:
        headers['ETag']=etag
        if request.headers.get('if-none-match')==etag:return Response(status_code=304,headers=headers)
    return Response(data,media_type=mime,headers=headers)

class CreateAsset(BaseModel):
    name:str=Field(min_length=2,max_length=80);symbol:str=Field(pattern=r'^[A-Z0-9]{2,12}$')
    story:str=Field(min_length=3,max_length=180);description:str=Field(default='',max_length=5000)
    category:Literal['memories','things','assets'];mode:Literal['free','verified'];image_id:str
    supply:str=Field(pattern=r'^[1-9][0-9]{0,11}$')
@router.post('/assets')
def create_asset(body:CreateAsset,wallet=Depends(wallet_auth)):
    with engine().begin() as db:
        check_upload(db,body.image_id,wallet,False)
        count=db.execute(select(func.count()).select_from(assets).where(assets.c.wallet==wallet,assets.c.created_at>now()-3600)).scalar()
        if count>=10: raise HTTPException(429,'Maximum 10 projects per hour')
        row={**body.model_dump(),'id':uid(),'wallet':wallet,'review_status':'unverified','proof_code':'CUS-'+secrets.token_hex(3).upper(),'proof_ids':'[]','review_note':'','created_at':now()}
        db.execute(insert(assets).values(**row));return enrich(db,row,wallet)
@router.get('/assets')
def list_assets(search:str='',category:str='',verification:str='',sort:Literal['new','popular']='new',page:int=1,limit:int=24,issued:bool=False,watched:bool=False,recent:bool=False,request:Request=None):
    limit=max(1,min(limit,60));page=max(1,page);wallet=''
    if request and request.headers.get('authorization'):
        try: wallet=wallet_auth(request)
        except HTTPException: pass
    with engine().connect() as db:
        query=select(assets).where(visible_listing())
        if watched:
            if not wallet:raise HTTPException(401,'Connect your wallet and sign in')
            query=query.where(assets.c.id.in_(select(reactions.c.asset_id).where(reactions.c.wallet==wallet,reactions.c.kind=='watch')))
        if issued: query=query.where(assets.c.token_address.is_not(None),assets.c.launch_id.is_not(None))
        if recent:query=query.where(assets.c.id.in_(select(launch_listings.c.asset_id).where(launch_listings.c.timestamp>=now()-604800)))
        if search: query=query.where((assets.c.name.contains(search[:100],autoescape=True))|(assets.c.symbol.contains(search[:100],autoescape=True)))
        if category in ('memories','things','assets'): query=query.where(assets.c.category==category)
        if verification=='verified': query=query.where(assets.c.review_status=='approved')
        elif verification=='free': query=query.where(assets.c.mode=='free')
        if sort=='popular':
            count=select(func.count()).select_from(reactions).where(reactions.c.asset_id==assets.c.id,reactions.c.kind=='love').scalar_subquery();query=query.order_by(count.desc(),assets.c.created_at.desc())
        elif issued:
            listed=select(launch_listings.c.timestamp).where(launch_listings.c.asset_id==assets.c.id).scalar_subquery()
            query=query.order_by(listed.desc(),assets.c.created_at.desc(),assets.c.id.asc())
        else: query=query.order_by(assets.c.created_at.desc(),assets.c.id.asc())
        rows=db.execute(query.limit(limit+1).offset((page-1)*limit)).mappings().all()
        return {'items':[enrich(db,r,wallet) for r in rows[:limit]],'has_more':len(rows)>limit,'page':page}
@router.get('/assets/{id}')
def asset_detail(id:str,request:Request):
    wallet=''
    if request.headers.get('authorization'):
        try: wallet=wallet_auth(request)
        except HTTPException: pass
    with engine().connect() as db:
        row=enrich(db,find_asset(db,id),wallet)
        if row['listing_status']=='delisted' and wallet!=row['wallet'] and wallet not in admins():raise HTTPException(404,'Project removed from Custos for violating reality listing rules')
        row['comments']=[dict(r) for r in db.execute(select(comments).where(comments.c.asset_id==id).order_by(comments.c.created_at.desc()).limit(100)).mappings()]
    return row
@router.get('/assets/{id}/metadata')
def asset_metadata(id:str,request:Request):
    with engine().connect() as db: row=find_asset(db,id)
    base=os.getenv('REALITY_PUBLIC_ORIGIN','').rstrip('/') or str(request.base_url).rstrip('/')
    return {'name':row['name'],'symbol':row['symbol'],'description':row['description'] or row['story'],'image':base+image_url(row['image_id']),'external_url':base+'/#/reality/asset/'+id,'properties':{'custos_id':id,'creator':row['wallet'],'category':row['category'],'verification':row['review_status']}}
@router.get('/portfolio')
def portfolio(wallet=Depends(wallet_auth)):
    with engine().connect() as db:
        owned=db.execute(select(assets).where(assets.c.wallet==wallet).order_by(assets.c.created_at.desc())).mappings().all()
        watched=db.execute(select(assets).join(reactions,reactions.c.asset_id==assets.c.id).where(reactions.c.wallet==wallet,reactions.c.kind=='watch')).mappings().all()
        collected=db.execute(select(assets).join(reactions,reactions.c.asset_id==assets.c.id).where(reactions.c.wallet==wallet,reactions.c.kind=='collect')).mappings().all()
        return {'owned':[enrich(db,r,wallet) for r in owned],'watched':[enrich(db,r,wallet) for r in watched],'collected':[enrich(db,r,wallet) for r in collected]}
class Reaction(BaseModel): kind:Literal['love','collect','watch']
@router.post('/assets/{id}/reactions')
def reaction(id:str,body:Reaction,wallet=Depends(wallet_auth)):
    with engine().begin() as db:
        find_asset(db,id);where=(reactions.c.asset_id==id)&(reactions.c.wallet==wallet)&(reactions.c.kind==body.kind)
        row=db.execute(select(reactions.c.id).where(where)).first()
        if row: db.execute(delete(reactions).where(where))
        else: db.execute(insert(reactions).values(id=uid(),asset_id=id,wallet=wallet,kind=body.kind))
    return {'active':not bool(row)}
class Comment(BaseModel): body:str=Field(min_length=1,max_length=1000)
@router.post('/assets/{id}/comments')
def comment(id:str,body:Comment,wallet=Depends(wallet_auth)):
    with engine().begin() as db:
        find_asset(db,id);recent=db.execute(select(func.count()).select_from(comments).where(comments.c.wallet==wallet,comments.c.created_at>now()-60)).scalar()
        if recent>=5: raise HTTPException(429,'Please wait before posting another comment')
        db.execute(insert(comments).values(id=uid(),asset_id=id,wallet=wallet,body=body.body.strip(),created_at=now()))
    return {'ok':True}
class Valuation(BaseModel): amount:float=Field(gt=0,le=1_000_000_000,allow_inf_nan=False)
@router.post('/assets/{id}/valuations')
def valuation(id:str,body:Valuation,wallet=Depends(wallet_auth)):
    with engine().begin() as db:
        row=find_asset(db,id)
        if row['wallet']==wallet: raise HTTPException(400,'You cannot value your own project')
        where=(valuations.c.asset_id==id)&(valuations.c.wallet==wallet)
        if db.execute(select(valuations.c.id).where(where)).first(): db.execute(update(valuations).where(where).values(amount=body.amount))
        else: db.execute(insert(valuations).values(id=uid(),asset_id=id,wallet=wallet,amount=body.amount))
    return {'ok':True}
class Proof(BaseModel): proof_ids:list[str]=Field(min_length=1,max_length=12);note:str=Field(default='',max_length=2000)
@router.post('/assets/{id}/proof')
def submit_proof(id:str,body:Proof,wallet=Depends(wallet_auth)):
    with engine().begin() as db:
        row=find_asset(db,id);own(row,wallet)
        if row['review_status'] in ('pending','approved'): raise HTTPException(409,'Project already pending review or approved')
        for file in body.proof_ids: check_upload(db,file,wallet,True)
        db.execute(update(assets).where(assets.c.id==id).values(proof_ids=json.dumps(body.proof_ids),review_status='pending',review_note=body.note))
    return {'ok':True,'review_status':'pending'}
@router.get('/admin/reviews')
def reviews(wallet=Depends(admin_auth)):
    with engine().connect() as db:
        rows=db.execute(select(assets).order_by(assets.c.created_at.desc())).mappings().all()
        result=[]
        for r in rows:
            row=enrich(db,r,wallet);ids=json.loads(row['proof_ids'])
            row['proof_files']=[dict(x) for x in db.execute(select(uploads).where(uploads.c.id.in_(ids))).mappings()];result.append(row)
    return {'items':result}
class ModerationDecision(BaseModel):
    status:Literal['listed','delisted']
    reason:str=Field(min_length=3,max_length=2000)
@router.post('/admin/projects/{id}/moderation')
def moderate(id:str,body:ModerationDecision,wallet=Depends(admin_auth)):
    reason=body.reason.strip()
    if len(reason)<3:raise HTTPException(400,'Enter a reason of at least three characters')
    with engine().begin() as db:
        find_asset(db,id)
        values={'status':body.status,'reason':reason,'wallet':wallet,'updated_at':now()}
        if db.execute(select(moderation.c.asset_id).where(moderation.c.asset_id==id)).first():db.execute(update(moderation).where(moderation.c.asset_id==id).values(**values))
        else:db.execute(insert(moderation).values(asset_id=id,**values))
        if body.status=='delisted':db.execute(update(assets).where(assets.c.id==id,assets.c.review_status=='approved').values(review_status='revoked',review_note=reason))
        db.execute(insert(audits).values(id=uid(),asset_id=id,wallet=wallet,decision=body.status,note=reason,created_at=now()))
    return {'ok':True,'listing_status':body.status}

class Review(BaseModel): decision:Literal['approved','rejected','revoked'];note:str=Field(min_length=3,max_length=2000)
@router.post('/admin/reviews/{id}')
def review(id:str,body:Review,wallet=Depends(admin_auth)):
    with engine().begin() as db:
        row=find_asset(db,id)
        if row['wallet']==wallet: raise HTTPException(403,'Reviewers cannot review their own projects')
        if body.decision=='approved' and not db.execute(select(assets.c.id).where(assets.c.id==id,visible_listing())).first():raise HTTPException(409,'Restore the listing before reviewing verification')
        if (body.decision=='revoked' and row['review_status']!='approved') or (body.decision!='revoked' and row['review_status'] not in ('unverified','pending','rejected','revoked')): raise HTTPException(409,'Review status changed. Please refresh')
        db.execute(update(assets).where(assets.c.id==id).values(review_status=body.decision,review_note=body.note))
        db.execute(insert(audits).values(id=uid(),asset_id=id,wallet=wallet,decision=body.decision,note=body.note,created_at=now()))
    return {'ok':True}

_rpc_client=None
_rpc_loop=None
async def close_rpc():
    global _rpc_client,_rpc_loop
    if _rpc_client:await _rpc_client.aclose()
    _rpc_client=None;_rpc_loop=None

async def rpc(method,params):
    global _rpc_client,_rpc_loop
    try:
        loop=asyncio.get_running_loop()
        if _rpc_client is None or _rpc_client.is_closed or _rpc_loop is not loop:
            _rpc_client=httpx.AsyncClient(timeout=httpx.Timeout(10,connect=4),limits=httpx.Limits(max_connections=20,max_keepalive_connections=10));_rpc_loop=loop
        r=await _rpc_client.post(config()['rpc'],json={'jsonrpc':'2.0','id':1,'method':method,'params':params});r.raise_for_status();body=r.json()
    except (httpx.HTTPError,ValueError):
        raise HTTPException(503,'RPC temporarily unavailable. Retry later')
    if body.get('error'): raise HTTPException(503,'RPC temporarily unavailable')
    return body.get('result')
class Attachment(BaseModel): tx_hash:str=Field(pattern=r'^0x[0-9a-fA-F]{64}$')
ETH_USD_FEED='ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'
STAKE_TOPIC='0x'+keccak(text='Staked(address,uint256,uint256,uint256,uint256)').hex()
UNSTAKE_TOPIC='0x'+keccak(text='Unstaked(address,uint256,uint256)').hex()
def staking_address():
    address=config()['cfi_staking'].lower()
    if not re.fullmatch(r'0x[0-9a-f]{40}',address):raise HTTPException(503,'CFI staking is not configured')
    return address

_binance_price_cache=None
_binance_price_task=None
STAKE_QUOTE_FIELDS=[{'name':'account','type':'address'},{'name':'amount','type':'uint256'},{'name':'price18','type':'uint256'},{'name':'issuedAt','type':'uint256'},{'name':'deadline','type':'uint256'},{'name':'nonce','type':'uint256'}]

async def read_binance_price():
    global _binance_price_cache
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            if network_config()['chain_id']==99801:
                response=await client.post('https://api.hyperliquid.xyz/info',json={'type':'allMids'})
                response.raise_for_status();body={'symbol':'HYPEUSDT','price':response.json()['HYPE']}
            else:
                response=await client.get('https://data-api.binance.vision/api/v3/ticker/price',params={'symbol':'ETHUSDT'})
                response.raise_for_status();body=response.json()
        price=Decimal(body['price']);scaled=price*10**18
        if body.get('symbol')!=('HYPEUSDT' if network_config()['chain_id']==99801 else 'ETHUSDT') or not price.is_finite() or not 0<price<=10**8 or scaled!=scaled.to_integral_value():raise ValueError('Invalid price')
        _binance_price_cache=(time.monotonic(),int(scaled),now())
        return _binance_price_cache
    except (httpx.HTTPError,ValueError,KeyError,TypeError,InvalidOperation):raise HTTPException(503,'Fresh Binance ETH/USDT data is unavailable. Retry later.')

async def binance_staking_quote(request,address,value):
    global _binance_price_task
    wallet=wallet_auth(request) if request.headers.get('authorization') else ''
    cached=_binance_price_cache
    if not cached or time.monotonic()-cached[0]>5 or not -5<=now()-cached[2]<=5:
        if _binance_price_task is None or _binance_price_task.done() or _binance_price_task.get_loop() is not asyncio.get_running_loop():_binance_price_task=asyncio.create_task(read_binance_price())
        cached=await asyncio.shield(_binance_price_task)
    _,price18,issued=cached
    if now()-issued>10:raise HTTPException(503,'Binance quote expired. Retry.')
    try:signer=Account.from_key(os.getenv('CFI_QUOTE_SIGNER_KEY',''))
    except (ValueError,TypeError):raise HTTPException(503,'Staking quote signing is not configured')
    calls=[rpc('eth_chainId',[]),rpc('eth_call',[{'to':address,'data':'0x'+keccak(text='quoteSigner()').hex()[:8]},'latest'])]
    if wallet:calls.append(rpc('eth_call',[{'to':address,'data':'0x'+keccak(text='nonces(address)').hex()[:8]+encode(['address'],[wallet]).hex()},'latest']))
    results=await asyncio.gather(*calls)
    if int(results[0],16)!=network_config()['chain_id'] or not isinstance(results[1],str) or len(results[1])!=66 or ('0x'+results[1][-40:]).lower()!=signer.address.lower():raise HTTPException(503,'Staking quote signer or GIWA network mismatch')
    if now()-issued>15:raise HTTPException(503,'Binance quote expired. Retry.')
    nonce=int(results[2],16) if wallet else 0;deadline=issued+60;signature=None
    if wallet:
        message={'account':wallet,'amount':value,'price18':price18,'issuedAt':issued,'deadline':deadline,'nonce':nonce}
        typed=encode_typed_data(domain_data={'name':'Custos CFI Binance','version':'1','chainId':network_config()['chain_id'],'verifyingContract':address},message_types={'StakeQuote':STAKE_QUOTE_FIELDS},message_data=message)
        signature='0x'+Account.sign_message(typed,signer.key).signature.hex().removeprefix('0x')
    return {'source':config()['cfi_price_source'],'pair':'HYPE/USD' if network_config()['chain_id']==99801 else 'ETHUSDT','quoteCurrency':'USD' if network_config()['chain_id']==99801 else 'USDT','vault':address,'account':wallet,'amountWei':str(value),'expectedCFI':str(value*price18//10**18),'price18':str(price18),'publishTime':issued,'issuedAt':issued,'deadline':deadline,'nonce':str(nonce),'signature':signature,'feeWei':'0'}

@router.get('/staking/quote')
async def staking_quote(request:Request,amount:str):
    address=staking_address()
    if not re.fullmatch(r'\d{1,7}(\.\d{1,18})?',amount):raise HTTPException(400,'Enter a valid ETH amount with up to 18 decimals')
    value=int(Decimal(amount)*10**18)
    if not 0<value<=10**24:raise HTTPException(400,'ETH amount is out of range')
    if config()['cfi_price_source'] in ('binance','hyperliquid'):return await binance_staking_quote(request,address,value)
    if int(await rpc('eth_chainId',[]),16)!=network_config()['chain_id']:raise HTTPException(503,'GIWA RPC network mismatch')
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            key=os.getenv('PYTH_API_KEY','').strip()
            response=await client.get('https://hermes.pyth.network/v2/updates/price/latest',params={'ids[]':ETH_USD_FEED,'encoding':'hex','parsed':'true'},headers={'Authorization':'Bearer '+key} if key else {})
            if response.status_code in (401,403):raise HTTPException(503,'ETH/USD oracle access is not configured. Contact the operator to enable new deposits. Withdrawals remain available.')
            response.raise_for_status();payload=response.json()
        parsed=next(p for p in payload['parsed'] if p['id'].removeprefix('0x').lower()==ETH_USD_FEED)['price']
        price=int(parsed['price']);expo=int(parsed['expo']);stamp=int(parsed['publish_time']);conf=int(parsed['conf'])
        if price<=0 or not -18<=expo<=0 or not -5<=now()-stamp<=60 or conf*100>price:raise ValueError('Unusable quote')
        price18=price*10**(18+expo)
        if price18>10**26:raise ValueError('Price range')
        data=['0x'+s.removeprefix('0x') for s in payload['binary']['data']]
        if not data:raise ValueError('Missing update')
    except (httpx.HTTPError,ValueError,KeyError,StopIteration,TypeError):raise HTTPException(503,'Fresh ETH/USD oracle data is unavailable. Retry later.')
    oracle_data='0x'+keccak(text='pyth()').hex()[:8]
    oracle='0x'+(await rpc('eth_call',[{'to':address,'data':oracle_data},'latest']))[-40:]
    calldata='0x'+keccak(text='getUpdateFee(bytes[])').hex()[:8]+encode(['bytes[]'],[[bytes.fromhex(s[2:]) for s in data]]).hex()
    fee=int(await rpc('eth_call',[{'to':oracle,'data':calldata},'latest']),16)
    return {'vault':address,'amountWei':str(value),'expectedCFI':str(value*price18//10**18),'price18':str(price18),'publishTime':stamp,'updateData':data,'feeWei':str(fee)}

def decode_stake_event(log,stamp):
    topics=log.get('topics',[])
    if len(topics)!=2 or topics[0].lower() not in (STAKE_TOPIC,UNSTAKE_TOPIC):return None
    deposited=topics[0].lower()==STAKE_TOPIC
    values=decode(['uint256']*(4 if deposited else 2),bytes.fromhex(log['data'][2:]))
    eth,cfi=(values[0],values[1]) if deposited else (values[1],values[0])
    if eth<=0 or cfi<=0:return None
    return {'id':log['transactionHash']+':'+str(int(log['logIndex'],16)),'wallet':'0x'+topics[1][-40:].lower(),'side':'stake' if deposited else 'unstake','eth_amount':str(eth),'cfi_amount':str(cfi),'tx_hash':log['transactionHash'],'block_number':int(log['blockNumber'],16),'timestamp':stamp}

@router.post('/staking/verify')
async def verify_staking(body:Attachment,wallet=Depends(wallet_auth)):
    address=staking_address()
    if int(await rpc('eth_chainId',[]),16)!=network_config()['chain_id']:raise HTTPException(503,'GIWA RPC network mismatch')
    receipt=await rpc('eth_getTransactionReceipt',[body.tx_hash])
    if not receipt or receipt.get('status')!='0x1':raise HTTPException(409,'Transaction has not confirmed successfully')
    if receipt.get('to','').lower()!=address or receipt.get('from','').lower()!=wallet:raise HTTPException(400,'Staking contract or wallet mismatch')
    block=int(receipt['blockNumber'],16)
    if int(await rpc('eth_blockNumber',[]),16)-block<1:raise HTTPException(409,'Wait for two confirmations and retry')
    header=await rpc('eth_getBlockByNumber',[hex(block),False]);records=[]
    for log in receipt.get('logs',[]):
        if log.get('removed') or log.get('address','').lower()!=address:continue
        row=decode_stake_event(log,int(header['timestamp'],16))
        if row and row['wallet']==wallet:records.append(row)
    if not records:raise HTTPException(400,'No matching staking event found')
    with engine().begin() as db:
        for row in records:
            if not db.execute(select(stake_events.c.id).where(stake_events.c.id==row['id'])).scalar():db.execute(insert(stake_events).values(**row))
    return {'ok':True,'profile':season_profile(wallet)} if feature_enabled('points') else {'ok':True}

async def sync_staking():
    cfg=config();address=cfg['cfi_staking'];first=cfg['cfi_start_block']
    if not address or not first:return
    if int(await rpc('eth_chainId',[]),16)!=network_config()['chain_id']:raise HTTPException(503,'GIWA RPC network mismatch')
    cursor_key='cfi_index_block:'+address.lower()
    updated_key='cfi_index_updated_at:'+address.lower()
    with engine().connect() as db:cursor=db.execute(select(runtime_settings.c.value).where(runtime_settings.c.key==cursor_key)).scalar()
    start=max(first,int(cursor)-16) if cursor else first
    latest=int(await rpc('eth_blockNumber',[]),16)-2;end=min(latest,start+4999)
    for a in range(start,end+1,1000):
        b=min(end,a+999);records=[];times={}
        logs=await rpc('eth_getLogs',[{'address':address,'fromBlock':hex(a),'toBlock':hex(b),'topics':[[STAKE_TOPIC,UNSTAKE_TOPIC]]}])
        for log in logs:
            if log.get('removed'):continue
            block=int(log['blockNumber'],16)
            if block not in times:times[block]=int((await rpc('eth_getBlockByNumber',[hex(block),False]))['timestamp'],16)
            row=decode_stake_event(log,times[block])
            if row:records.append(row)
        with engine().begin() as db:
            db.execute(delete(stake_events).where(stake_events.c.block_number>=a,stake_events.c.block_number<=b))
            if records:db.execute(insert(stake_events),records)
            db.execute(delete(runtime_settings).where(runtime_settings.c.key==cursor_key));db.execute(insert(runtime_settings).values(key=cursor_key,value=str(b+1)))
    with engine().begin() as db:
        db.execute(delete(runtime_settings).where(runtime_settings.c.key==updated_key));db.execute(insert(runtime_settings).values(key=updated_key,value=str(now()) if end==latest else '0'))

@router.get('/account/staking')
def account_staking(page:int=1,wallet=Depends(wallet_auth)):
    page=max(1,page)
    updated_key='cfi_index_updated_at:'+config()['cfi_staking'].lower()
    with engine().connect() as db:
        rows=db.execute(select(stake_events).where(stake_events.c.wallet==wallet).order_by(stake_events.c.block_number.desc(),stake_events.c.id.desc()).offset((page-1)*50).limit(51)).mappings().all()
        updated=db.execute(select(runtime_settings.c.value).where(runtime_settings.c.key==updated_key)).scalar()
    return {'items':[dict(r) for r in rows[:50]],'has_more':len(rows)>50,'page':page,'indexed':bool(updated and 0<=now()-int(updated)<120)}

@router.post('/assets/{id}/attach')
async def attach(id:str,body:Attachment,wallet=Depends(wallet_auth)):
    with engine().connect() as db:
        row=find_asset(db,id);own(row,wallet)
        if not db.execute(select(assets.c.id).where(assets.c.id==id,visible_listing())).first():raise HTTPException(403,'Project is delisted from Custos')
    if row['token_address']: raise HTTPException(409,'Project already has a token')
    if row['mode']=='verified' and row['review_status']!='approved': raise HTTPException(403,'Verified issuance requires evidence approval')
    launchpad=config()['launchpad'].lower()
    if not re.fullmatch(r'0x[0-9a-f]{40}',launchpad): raise HTTPException(503,'GIWA Launchpad is not deployed or configured')
    chain=await rpc('eth_chainId',[])
    if int(chain,16)!=network_config()['chain_id']: raise HTTPException(503,'RPC Network does not match GIWA configuration')
    receipt=await rpc('eth_getTransactionReceipt',[body.tx_hash])
    if not receipt or receipt.get('status')!='0x1': raise HTTPException(409,'Transaction has not confirmed successfully')
    if receipt.get('to','').lower()!=launchpad or receipt.get('from','').lower()!=wallet: raise HTTPException(400,'Transaction contract or creator mismatch')
    head=int(await rpc('eth_blockNumber',[]),16)
    if head-int(receipt['blockNumber'],16)<1: raise HTTPException(409,'Wait for more onchain confirmations and retry')
    topic='0x'+keccak(text='LaunchCreated(uint256,address,address,bool,string)').hex()
    found=None
    for log in receipt.get('logs',[]):
        topics=log.get('topics',[])
        if log.get('address','').lower()==launchpad and len(topics)==4 and topics[0].lower()==topic:
            if '0x'+topics[2][-40:].lower()!=wallet: continue
            curated,uri=decode(['bool','string'],bytes.fromhex(log['data'][2:]))
            if not uri.endswith('/api/reality/assets/'+id+'/metadata'): continue
            found=(int(topics[1],16),'0x'+topics[3][-40:].lower());break
    if not found: raise HTTPException(400,'No matching project issuance event found')
    launch_id,token=found
    raw=await rpc('eth_call',[{'to':launchpad,'data':'0x'+keccak(text='getLaunch(uint256)')[:4].hex()+hex(launch_id)[2:].zfill(64)},'latest'])
    value=decode(['(address,address,string,string,string,uint256,uint256,uint256,uint256,uint64,uint64,bool,bool)'],bytes.fromhex(raw[2:]))[0]
    if value[0].lower()!=wallet or value[1].lower()!=token or value[2]!=row['name'] or value[3]!=row['symbol'] or value[5]!=int(row['supply'])*10**18: raise HTTPException(400,'Onchain name, supply or creator mismatch')
    with engine().begin() as db:
        changed=db.execute(update(assets).where(assets.c.id==id,assets.c.token_address.is_(None)).values(token_address=token,launch_id=launch_id,tx_hash=body.tx_hash))
        if changed.rowcount!=1: raise HTTPException(409,'Project already has a token')
    return {'ok':True,'token_address':token,'launch_id':launch_id}

@router.get('/activity')
def activity():
    with engine().connect() as db:
        created=[{'id':r['id'],'asset_id':r['id'],'wallet':r['wallet'],'text':'created '+r['name'],'created_at':r['created_at']} for r in db.execute(select(assets).where(visible_listing()).order_by(assets.c.created_at.desc()).limit(12)).mappings()]
        reviewed=[{'id':r['id'],'asset_id':r['asset_id'],'wallet':r['wallet'],'text':{'approved':'verified project evidence','rejected':'reviewed project evidence','revoked':'revoked project verification','delisted':'removed a project','listed':'restored a project'}.get(r['decision'],'reviewed project'),'created_at':r['created_at']} for r in db.execute(select(audits).where(~audits.c.asset_id.like("season:%"),audits.c.asset_id.in_(select(assets.c.id).where(visible_listing()))).order_by(audits.c.created_at.desc()).limit(12)).mappings()]
    return {'items':sorted(created+reviewed,key=lambda x:x['created_at'],reverse=True)[:12]}

_index_task=None
async def sync_trades():
    address=config()['launchpad']
    if not address: return
    with engine().connect() as db:
        txs=list(db.execute(select(assets.c.tx_hash).where(assets.c.token_address.is_not(None))).scalars())
        cursor=db.execute(select(runtime_settings.c.value).where(runtime_settings.c.key=='index_block')).scalar()
    if not txs: return
    if not cursor:
        blocks=[]
        for offset in range(0,len(txs),20):
            receipts=await asyncio.gather(*(rpc('eth_getTransactionReceipt',[tx]) for tx in txs[offset:offset+20]))
            blocks.extend(int(x['blockNumber'],16) for x in receipts if x)
        if not blocks:return
        start=min(blocks)
    else:start=max(0,int(cursor)-16)
    latest=int(await rpc('eth_blockNumber',[]),16)-2
    buy='0x'+keccak(text='TokensPurchased(uint256,address,uint256,uint256,uint256,uint256)').hex()
    sell='0x'+keccak(text='TokensSold(uint256,address,uint256,uint256,uint256,uint256)').hex()
    # Bounded backfill, then resume from the persisted cursor on the next pass.
    end=min(latest,start+4999)
    if end<start:return
    block_times={}
    for a in range(start,end+1,1000):
        b=min(end,a+999)
        logs=await rpc('eth_getLogs',[{'address':address,'fromBlock':hex(a),'toBlock':hex(b),'topics':[[buy,sell]]}])
        records=[]
        for log in logs:
            if log.get('removed'):continue
            block=int(log['blockNumber'],16)
            if block not in block_times:
                header=await rpc('eth_getBlockByNumber',[hex(block),False]);block_times[block]=int(header['timestamp'],16)
            first,second,quote_reserve,token_reserve=decode(['uint256']*4,bytes.fromhex(log['data'][2:]))
            is_buy=log['topics'][0].lower()==buy.lower()
            records.append({'id':log['transactionHash']+':'+str(int(log['logIndex'],16)),'launch_id':int(log['topics'][1],16),'wallet':'0x'+log['topics'][2][-40:].lower(),'block_number':block,'timestamp':block_times[block],'side':'buy' if is_buy else 'sell','quote_amount':str(first if is_buy else second),'token_amount':str(second if is_buy else first),'quote_reserve':str(quote_reserve),'token_reserve':str(token_reserve),'tx_hash':log['transactionHash']})
        with engine().begin() as db:
            db.execute(delete(trades).where(trades.c.block_number>=a,trades.c.block_number<=b))
            if records:db.execute(insert(trades),records)
            db.execute(delete(runtime_settings).where(runtime_settings.c.key=='index_block'));db.execute(insert(runtime_settings).values(key='index_block',value=str(b+1)))
    with engine().begin() as db:
        db.execute(delete(runtime_settings).where(runtime_settings.c.key=='index_updated_at'))
        db.execute(insert(runtime_settings).values(key='index_updated_at',value=str(now()) if end==latest else '0'))

async def start_reality_index():
    global _index_task
    async def loop():
        while True:
            for job in (sync_listings,sync_trades,sync_staking):
                try:await job()
                except asyncio.CancelledError:raise
                except Exception as e:
                    import logging
                    logging.getLogger('custos.reality').warning('Reality index unavailable: %s',type(e).__name__)
            await asyncio.sleep(30)
    _index_task=asyncio.create_task(loop())

async def sync_listings():
    address=config()['launchpad']
    if not address:return
    with engine().connect() as db:
        rows=db.execute(select(assets).where(assets.c.token_address.is_not(None),assets.c.tx_hash.is_not(None),~assets.c.id.in_(select(launch_listings.c.asset_id))).limit(20)).mappings().all()
    if not rows:return
    if int(await rpc('eth_chainId',[]),16)!=network_config()['chain_id']:raise HTTPException(503,'GIWA RPC network mismatch')
    head=int(await rpc('eth_blockNumber',[]),16)
    for row in rows:
        receipt=await rpc('eth_getTransactionReceipt',[row['tx_hash']])
        if not receipt or receipt.get('status')!='0x1' or receipt.get('to','').lower()!=address.lower() or receipt.get('from','').lower()!=row['wallet']:continue
        block=int(receipt['blockNumber'],16)
        if head-block<1:continue
        stamp=int((await rpc('eth_getBlockByNumber',[hex(block),False]))['timestamp'],16)
        with engine().begin() as db:
            if not db.execute(select(launch_listings.c.asset_id).where(launch_listings.c.asset_id==row['id'])).scalar():db.execute(insert(launch_listings).values(asset_id=row['id'],timestamp=stamp,block_number=block))
async def stop_reality_index():
    if _index_task:
        _index_task.cancel()
        try:await _index_task
        except asyncio.CancelledError:pass

@router.get('/market-stats')
def market_stats():
    cutoff=now()-86400
    with engine().connect() as db:
        rows=db.execute(select(assets.c.id,assets.c.launch_id).where(assets.c.token_address.is_not(None))).mappings().all()
        cursor=db.execute(select(runtime_settings.c.value).where(runtime_settings.c.key=='index_block')).scalar()
        updated=db.execute(select(runtime_settings.c.value).where(runtime_settings.c.key=='index_updated_at')).scalar()
        complete=bool(cursor and updated and now()-int(updated)<120)
        result={}
        for row in rows:
            records=db.execute(select(trades).where(trades.c.launch_id==row['launch_id']).order_by(trades.c.block_number.asc(),trades.c.id.asc())).mappings().all()
            records=sorted(records,key=lambda t:(t['block_number'],int(t['id'].rsplit(':',1)[-1])))
            recent=[t for t in records if t['timestamp']>=cutoff]
            before=[t for t in records if t['timestamp']<cutoff]
            # Never invent a 24-hour reference price when index history is absent.
            reference=before[-1] if before else None
            last=records[-1] if records else None
            baseline=int(reference['quote_reserve'])/int(reference['token_reserve']) if reference and int(reference['token_reserve']) else None
            latest=int(last['quote_reserve'])/int(last['token_reserve']) if last and int(last['token_reserve']) else None
            result[row['id']]={'volume_eth':sum(int(t['quote_amount']) for t in recent)/10**18 if complete else None,'change_24h':(latest/baseline-1)*100 if complete and baseline and latest else None,'history':[{'time':t['timestamp'],'price':int(t['quote_reserve'])/int(t['token_reserve'])} for t in recent[-100:] if int(t['token_reserve'])]}
    return {'items':result,'indexed':complete}

_ranking_quotes={}
_ranking_quote_tasks={}

async def ranking_quote(key,asset):
    try:
        if int(await rpc('eth_chainId',[]),16)!=network_config()['chain_id']:return
        data='0x'+keccak(text='getLaunch(uint256)').hex()[:8]+encode(['uint256'],[asset['launch_id']]).hex()
        raw=await rpc('eth_call',[{'to':key[1],'data':data},'latest'])
        state=decode(['(address,address,string,string,string,uint256,uint256,uint256,uint256,uint64,uint64,bool,bool)'],bytes.fromhex(raw[2:]))[0]
        if state[1].lower()!=asset['token_address'].lower() or state[0].lower()!=asset['wallet'].lower() or not state[6]:return
        price=state[7]/state[6]
        _ranking_quotes[key]=(time.monotonic(),{'price':price,'cap':price*state[5]/10**18,'liquidity_eth':state[8]/10**18,'tokenReserve':str(state[6]),'quoteReserve':str(state[7])})
    except (HTTPException,ValueError,OverflowError,TypeError,DecodingError):pass
    finally:_ranking_quote_tasks.pop(key,None)

async def resolve_market_quotes(selected,wait=.15):
    cfg=config();address=cfg['launchpad'];keys=[];pending=[]
    for row in selected:
        a=row['asset'];key=(cfg['rpc'],address,a['launch_id'],a['token_address'],a['wallet']);keys.append(key)
        cached=_ranking_quotes.get(key)
        if address and a['launch_id'] and a['token_address'] and (not cached or time.monotonic()-cached[0]>=30):
            task=_ranking_quote_tasks.get(key)
            if task is None or task.done():
                task=asyncio.create_task(ranking_quote(key,a));_ranking_quote_tasks[key]=task
            if not cached:pending.append(task)
    if pending:await asyncio.wait(pending,timeout=wait)
    quotes_pending=False
    for row,key in zip(selected,keys):
        cached=_ranking_quotes.get(key)
        if cached and time.monotonic()-cached[0]<90:row.update(cached[1])
        quotes_pending=quotes_pending or key in _ranking_quote_tasks
    return quotes_pending

@router.get('/assets/{id}/market')
async def asset_market(id:str):
    with engine().connect() as db:
        a=dict(find_asset(db,id));block=db.execute(select(func.max(trades.c.block_number)).where(trades.c.launch_id==a['launch_id'])).scalar() if a['launch_id'] else None
        last=db.execute(select(trades).where(trades.c.launch_id==a['launch_id'],trades.c.block_number==block)).mappings().all() if block is not None else []
        updated=db.execute(select(runtime_settings.c.value).where(runtime_settings.c.key=='index_updated_at')).scalar()
    last=sorted(last,key=lambda t:(t['block_number'],int(t['id'].rsplit(':',1)[-1])))
    price=int(last[-1]['quote_reserve'])/int(last[-1]['token_reserve']) if last and int(last[-1]['token_reserve']) and updated and 0<=now()-int(updated)<120 else None
    row={'asset':a,'price':price,'cap':None,'liquidity_eth':None,'tokenReserve':'','quoteReserve':''}
    pending=await resolve_market_quotes([row])
    return {'price':row['price'],'cap':row['cap'],'reserve':row['liquidity_eth'],'tokenReserve':row['tokenReserve'],'quoteReserve':row['quoteReserve'],'pending':pending}

@router.get('/market/rankings')
async def market_rankings(request:Request,period:Literal['5m','1h','6h','24h']='24h',metric:Literal['trending','gainers','volume','new']='trending',direction:Literal['desc','asc']='desc',category:str='',verification:Literal['','verified','free']='',page:int=1,limit:int=25):
    stamp=now();cutoff=stamp-{'5m':300,'1h':3600,'6h':21600,'24h':86400}[period]
    page=max(1,page);limit=max(1,min(limit,50));wallet=''
    if request.headers.get('authorization'):
        try:wallet=wallet_auth(request)
        except HTTPException:pass
    with engine().connect() as db:
        query=select(assets).where(visible_listing(),assets.c.token_address.is_not(None),assets.c.launch_id.is_not(None))
        if category in ('memories','things','assets'):query=query.where(assets.c.category==category)
        if verification=='verified':query=query.where(assets.c.review_status=='approved')
        elif verification=='free':query=query.where(assets.c.mode=='free')
        projects=list(db.execute(query).mappings())
        cursor=db.execute(select(runtime_settings.c.value).where(runtime_settings.c.key=='index_block')).scalar()
        updated=db.execute(select(runtime_settings.c.value).where(runtime_settings.c.key=='index_updated_at')).scalar()
        complete=bool(cursor and updated and 0<=stamp-int(updated)<120)
        ids=[a['launch_id'] for a in projects]
        records=db.execute(select(trades).where(trades.c.launch_id.in_(ids),trades.c.timestamp>=stamp-604800)).mappings().all() if ids else []
        grouped={}
        for record in records:grouped.setdefault(record['launch_id'],[]).append(record)
        result=[]
        for a in projects:
            history=sorted(grouped.get(a['launch_id'],[]),key=lambda t:(t['block_number'],int(t['id'].rsplit(':',1)[-1])))
            recent=[t for t in history if t['timestamp']>=cutoff]
            before=[t for t in history if t['timestamp']<cutoff]
            # Read an older reference when the seven-day chart has no baseline.
            older=[]
            if not before:
                block=db.execute(select(func.max(trades.c.block_number)).where(trades.c.launch_id==a['launch_id'],trades.c.timestamp<stamp-604800)).scalar()
                if block is not None:older=db.execute(select(trades).where(trades.c.launch_id==a['launch_id'],trades.c.block_number==block)).mappings().all()
            older=sorted(older,key=lambda t:(t['block_number'],int(t['id'].rsplit(':',1)[-1])))
            baseline=before[-1] if before else (older[-1] if older else None)
            last=history[-1] if history else baseline
            def price(t):return int(t['quote_reserve'])/int(t['token_reserve']) if t and int(t['token_reserve']) else None
            initial,latest=price(baseline),price(last)
            hourly={}
            for t in history:
                value=price(t)
                if value is not None:hourly[t['timestamp']//3600]={'time':t['timestamp'],'price':value}
            result.append({'asset':enrich(db,a,wallet),'change':(latest/initial-1)*100 if complete and initial and latest else None,'volume_eth':sum(int(t['quote_amount']) for t in recent)/10**18 if complete else None,'traders':len({t['wallet'] for t in recent}) if complete else None,'trend':list(hourly.values()),'price':latest if complete else None,'cap':None,'liquidity_eth':None})
    def key(row):
        primary=row['asset']['issued_at'] if metric=='new' else row['change'] if metric=='gainers' else row['volume_eth'] if metric=='volume' else row['traders']
        value=primary if primary is not None else 0
        secondary=(row['volume_eth'] or 0) if metric=='trending' else row['asset']['created_at']
        return (primary is None,-value if direction=='desc' else value,-secondary,-row['asset']['created_at'],row['asset']['id'])
    result.sort(key=key);total=len(result);selected=result[(page-1)*limit:page*limit]
    quotes_pending=await resolve_market_quotes(selected,wait=.15)
    for index,row in enumerate(selected):row['rank']=(page-1)*limit+index+1
    return {'items':selected,'total':total,'has_more':page*limit<total,'page':page,'period':period,'metric':metric,'indexed':complete,'indexed_at':int(updated or 0),'as_of':stamp,'quotes_pending':quotes_pending}

@router.get('/assets/{id}/chart')
def asset_chart(id:str,period:Literal['1h','24h','7d']='24h',resolution:Literal['1m','5m','15m','1h','4h','1d']|None=None):
    duration,step={'1h':(3600,60),'24h':(86400,900),'7d':(604800,3600)}[period]
    if resolution:step={'1m':60,'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400}[resolution]
    end=now();start=end-duration
    with engine().connect() as db:
        asset=find_asset(db,id)
        updated=db.execute(select(runtime_settings.c.value).where(runtime_settings.c.key=='index_updated_at')).scalar()
        indexed=bool(updated and 0<=end-int(updated)<120)
        records=[]
        if asset['token_address'] and asset['launch_id']:
            records=db.execute(select(trades).where(trades.c.launch_id==asset['launch_id'],trades.c.timestamp>=start,trades.c.timestamp<=end).order_by(trades.c.block_number.desc(),trades.c.id.desc()).limit(5001)).mappings().all()
        records=sorted(records,key=lambda t:(t['block_number'],int(t['id'].rsplit(':',1)[-1])))
        truncated=len(records)>5000;records=records[-5000:]
        candles={};valid=[]
        for t in records:
            reserve=int(t['token_reserve']);amount=int(t['token_amount'])
            if reserve<=0 or amount<=0:continue
            price=int(t['quote_reserve'])/reserve;volume=int(t['quote_amount'])/10**18
            bucket=t['timestamp']//step*step
            if bucket not in candles:candles[bucket]={'time':bucket,'open':price,'high':price,'low':price,'close':price,'volume_eth':0,'count':0}
            bar=candles[bucket];bar['high']=max(bar['high'],price);bar['low']=min(bar['low'],price);bar['close']=price;bar['volume_eth']+=volume;bar['count']+=1
            valid.append({'id':t['id'],'time':t['timestamp'],'side':t['side'],'wallet':t['wallet'],'tx_hash':t['tx_hash'],'amount_eth':str(int(t['quote_amount'])),'amount_token':str(amount),'execution_price':int(t['quote_amount'])/amount,'price_after':price})
    return {'period':period,'from':start,'to':end,'interval':step,'indexed':indexed,'indexed_at':int(updated or 0),'truncated':truncated,'candles':list(candles.values()),'trades':list(reversed(valid[-50:])),'trade_count':len(valid),'volume_eth':sum(c['volume_eth'] for c in candles.values()) if indexed and not truncated else None}

class RuntimeConfig(BaseModel):
    launchpad:str=Field(default='',max_length=42);platform_token:str=Field(default='',max_length=42)
    swap_router:str=Field(default='',max_length=42);swap_factory:str=Field(default='',max_length=42)
@router.post('/admin/config')
async def set_runtime_config(body:RuntimeConfig,wallet=Depends(admin_auth)):
    values=body.model_dump()
    if int(await rpc('eth_chainId',[]),16)!=network_config()['chain_id']: raise HTTPException(503,'RPC chain ID mismatch')
    for key,value in values.items():
        if not value: continue
        if not re.fullmatch(r'0x[0-9a-fA-F]{40}',value): raise HTTPException(400,'Invalid contract address')
        code=await rpc('eth_getCode',[value,'latest'])
        if code in ('0x','0x0',None): raise HTTPException(400,f'{key} has no deployed code on GIWA')
        if key=='launchpad':
            artifact=json.loads((Path(__file__).parent/'reality-contract.json').read_text())
            if code.lower()!=artifact['deployedBytecode'].lower(): raise HTTPException(400,'Launchpad bytecode does not match this version')
            current=config()['launchpad']
            if current and current.lower()!=value.lower():
                with engine().connect() as db: issued=db.execute(select(func.count()).select_from(assets).where(assets.c.token_address.is_not(None))).scalar()
                if issued: raise HTTPException(409,'An active launchpad cannot be replaced directly')
    if values['swap_router']:
        raw=await rpc('eth_call',[{'to':values['swap_router'],'data':'0x'+keccak(text='factory()')[:4].hex()},'latest'])
        if not values['swap_factory'] or ('0x'+raw[-40:]).lower()!=values['swap_factory'].lower(): raise HTTPException(400,'Router does not match the factory')
    with engine().begin() as db:
        for key,value in values.items():
            db.execute(delete(runtime_settings).where(runtime_settings.c.key==key));db.execute(insert(runtime_settings).values(key=key,value=value))
    return config()

@router.get('/health')
def health():
    with engine().connect() as db: db.execute(select(func.count()).select_from(users))
    return {'ok':True,'chain_id':network_config()['chain_id'],'launchpad_configured':bool(config()['launchpad'])}

def season_scores(db):
    issued=dict(db.execute(select(assets.c.wallet,func.count()).where(assets.c.token_address.is_not(None)).group_by(assets.c.wallet)).all())
    profiles=list(db.execute(select(season_profiles)).mappings())
    verified_x=set(db.execute(select(x_visits.c.wallet)).scalars())
    verified_stakes=set(db.execute(select(stake_events.c.wallet).where(stake_events.c.side=='stake')).scalars())
    bonuses=dict(db.execute(select(point_awards.c.wallet,func.sum(point_awards.c.points)).where(point_awards.c.revoked_at.is_(None)).group_by(point_awards.c.wallet)).all())
    # A confirmed stake is a completed task even if the user never opened Season 1.
    registered={p['wallet'] for p in profiles}
    profiles.extend({'wallet':w,'code':'','inviter':'','x_handle':''} for w in (verified_stakes|set(bonuses))-registered)
    scores=[]
    for p in profiles:
        invites=sum(1 for q in profiles if q['inviter']==p['wallet'] and issued.get(q['wallet'],0)>0)
        launches=issued.get(p['wallet'],0)
        x_approved=p['wallet'] in verified_x
        bonus=int(bonuses.get(p['wallet'],0))
        points=(100 if launches else 0)+invites*100+(10 if x_approved else 0)+(100 if p['wallet'] in verified_stakes else 0)+bonus
        scores.append({'wallet':p['wallet'],'referralCode':p['code'],'points':points,'bonusPoints':bonus,'stakeCompleted':p['wallet'] in verified_stakes,'verifiedTransactions':launches,'qualifiedReferrals':invites,'qualified':points>0,'season':'S1','xStatus':'visited' if x_approved else 'none','xHandle':p['x_handle']})
    scores.sort(key=lambda p:(-p['points'],p['wallet']))
    for i,p in enumerate(scores):p['rank']=i+1 if p['qualified'] else 0
    return scores

@router.get('/season/profile/{wallet}')
def season_profile(wallet:str):
    with engine().connect() as db:
        return next((p for p in season_scores(db) if p['wallet']==wallet.lower()),{'wallet':wallet.lower(),'referralCode':'','points':0,'bonusPoints':0,'stakeCompleted':False,'verifiedTransactions':0,'qualifiedReferrals':0,'rank':0,'qualified':False,'season':'S1','xStatus':'none','xHandle':''})

@router.get('/season/stats')
def season_stats():
    with engine().connect() as db:rows=season_scores(db)
    return {'participants':len(rows),'verifiedTransactions':sum(r['verifiedTransactions'] for r in rows),'pointsIssued':sum(r['points'] for r in rows),'qualifiedReferrals':sum(r['qualifiedReferrals'] for r in rows)}

@router.get('/season/leaderboard')
def season_board():
    with engine().connect() as db:rows=season_scores(db)
    return {'entries':[r for r in rows if r['qualified']][:25]}

class SeasonRegistration(BaseModel):ref_code:str=Field(default='',max_length=32)
@router.post('/season/register')
def season_register(body:SeasonRegistration,wallet=Depends(wallet_auth)):
    with engine().begin() as db:
        existing=db.execute(select(season_profiles).where(season_profiles.c.wallet==wallet)).mappings().first()
        if not existing:
            inviter=db.execute(select(season_profiles.c.wallet).where(season_profiles.c.code==body.ref_code.upper())).scalar() if body.ref_code else ''
            issued=db.execute(select(func.count()).select_from(assets).where(assets.c.wallet==wallet,assets.c.token_address.is_not(None))).scalar()
            if inviter==wallet:raise HTTPException(400,'Self-referrals are not allowed')
            if issued:inviter=''
            db.execute(insert(season_profiles).values(wallet=wallet,code='CST'+secrets.token_hex(8).upper(),inviter=inviter or '',x_handle='',x_status='none',created_at=now()))
    return season_profile(wallet)


@router.get('/season/x/config')
def x_config():
    return {'url':os.getenv('REALITY_X_PROFILE_URL','https://x.com/custosfinance'),'mode':'visit','points':10}

@router.post('/season/x-visit')
def season_x_visit(wallet=Depends(wallet_auth)):
    from sqlalchemy.exc import IntegrityError
    try:
        with engine().begin() as db:
            if not db.execute(select(season_profiles.c.wallet).where(season_profiles.c.wallet==wallet)).scalar():raise HTTPException(409,'Join Season 1 first')
            if not db.execute(select(x_visits.c.wallet).where(x_visits.c.wallet==wallet)).scalar():
                db.execute(insert(x_visits).values(wallet=wallet,created_at=now()))
    except IntegrityError:
        pass  # Concurrent clicks on the same wallet still award only once.
    return season_profile(wallet)

class PointAward(BaseModel):
    id:str=Field(pattern=r'^[0-9a-fA-F-]{36}$')
    wallet:str=Field(pattern=r'^0x[0-9a-fA-F]{40}$')
    points:int=Field(gt=0,le=100000,strict=True)
    reason:str=Field(min_length=3,max_length=1000)
    reference:str=Field(min_length=3,max_length=200)

@router.get('/admin/points')
def admin_points(wallet:str='',page:int=1,admin=Depends(admin_auth)):
    wallet=wallet.strip().lower()
    if wallet and not re.fullmatch(r'0x[0-9a-f]{40}',wallet):raise HTTPException(400,'Invalid wallet address')
    page=max(1,page)
    query=select(point_awards)
    if wallet:query=query.where(point_awards.c.wallet==wallet)
    with engine().connect() as db:
        rows=db.execute(query.order_by(point_awards.c.created_at.desc(),point_awards.c.id.desc()).offset((page-1)*25).limit(26)).mappings().all()
    return {'items':[dict(r) for r in rows[:25]],'has_more':len(rows)>25,'page':page,'profile':season_profile(wallet) if wallet else None}

@router.post('/admin/points')
def award_points(body:PointAward,admin=Depends(admin_auth)):
    from sqlalchemy.exc import IntegrityError
    wallet=body.wallet.lower();reason=body.reason.strip();reference=body.reference.strip()
    if len(reason)<3 or len(reference)<3:raise HTTPException(400,'A reason and unique feedback reference are required')
    duplicate=False
    try:
        with engine().begin() as db:
            db.execute(insert(point_awards).values(id=body.id,wallet=wallet,points=body.points,reason=reason,reference=reference,admin=admin,created_at=now()))
    except IntegrityError:
        with engine().connect() as db:existing=db.execute(select(point_awards).where(point_awards.c.id==body.id)).mappings().first()
        if not existing or any(existing[k]!=v for k,v in {'wallet':wallet,'points':body.points,'reason':reason,'reference':reference,'admin':admin}.items()):
            raise HTTPException(409,'This request ID or feedback reference has already been used')
        duplicate=True
    return {'ok':True,'duplicate':duplicate,'profile':season_profile(wallet)}

class RevokePoints(BaseModel):reason:str=Field(min_length=3,max_length=1000)
@router.post('/admin/points/{id}/revoke')
def revoke_points(id:str,body:RevokePoints,admin=Depends(admin_auth)):
    reason=body.reason.strip()
    if len(reason)<3:raise HTTPException(400,'Enter a revocation reason')
    with engine().begin() as db:
        row=db.execute(select(point_awards).where(point_awards.c.id==id)).mappings().first()
        if not row:raise HTTPException(404,'Award not found')
        db.execute(update(point_awards).where(point_awards.c.id==id,point_awards.c.revoked_at.is_(None)).values(revoked_by=admin,revoked_reason=reason,revoked_at=now()))
    return {'ok':True,'profile':season_profile(row['wallet'])}

class StakeRepair(Attachment):wallet:str=Field(pattern=r'^0x[0-9a-fA-F]{40}$')
@router.post('/admin/staking/verify')
async def admin_verify_staking(body:StakeRepair,admin=Depends(admin_auth)):
    return await verify_staking(body,body.wallet.lower())
