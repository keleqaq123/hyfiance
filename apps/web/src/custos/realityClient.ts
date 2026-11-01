import { BigNumber, Contract, providers, utils } from 'ethers'
import artifacts from './reality-artifacts.json'
import {RealityReadCache} from './realityReadCache'

export const REALITY_API=(import.meta.env.VITE_API_BASE || '').replace(/\/$/,'')
export type RealityConfig={chain_id:number;name:string;rpc:string;explorer:string;testnet:boolean;native_symbol?:string;launchpad:string;platform_token:string;swap_router:string;swap_factory:string;weth:string;admin_configured:boolean;cfi_staking?:string;cfi_start_block?:number;cfi_price_source?:string}
export type RealityAsset={listing_status?:string;moderation_reason?:string;id:string;wallet:string;name:string;symbol:string;story:string;description:string;category:string;mode:string;image_url:string;review_status:string;verified:boolean;supply:string;proof_code?:string;proof_ids?:string;review_note?:string;proof_files?:{id:string;name:string;type:string}[];token_address?:string;launch_id?:number;tx_hash?:string;love_count:number;collect_count:number;watch_count:number;loved:boolean;collectd:boolean;watchd:boolean;valuation_count:number;community_value:number|null;created_at:number;issued_at?:number|null;comments?:{id:string;wallet:string;body:string;created_at:number}[]}
let credential=''
const reads=new RealityReadCache()
export function setCredential(token:string){credential=token;reads.clear()}
export async function api<T=any>(path:string,body?:unknown,method?:string):Promise<T>{
  const verb=method||(body===undefined?'GET':'POST'),token=credential
  async function request(){
   const controller=new AbortController(),timer=verb==='GET'?setTimeout(()=>controller.abort(),10000):undefined
   try{
    const response=await fetch(REALITY_API+'/api/reality'+path,{method:verb,signal:controller.signal,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})
    if(!response.ok){if(response.status===401&&credential===token){setCredential('');window.dispatchEvent(new Event('custos-auth-expired'))}let message='Request failed';try{const value=await response.json();message=typeof value.detail==='string'?value.detail:'Please check your input'}catch{message='Server temporarily unavailable'}throw new Error(message)}
    return await response.json() as T
   }catch(e:any){if(e.name==='AbortError')throw new Error('The server is taking too long. Please retry.');if(e instanceof TypeError)throw new Error('Could not connect to the server. Check your connection and try again.');throw e}finally{if(timer)clearTimeout(timer)}
  }
  if(verb!=='GET'){reads.clear();try{return await request()}finally{reads.clear()}}
  // Executable financial quotes are always fresh; cached values are display reads.
  if(path.startsWith('/staking/quote')||path.startsWith('/admin/'))return request()
  return reads.read<T>(path,path==='/config'?30000:path.startsWith('/market/rankings')?1000:5000,request)
}
export function prefetchReality(path:string){void api(path).catch(()=>{})}
// Display snapshots only: the usual api() call still refreshes expired data.
export function snapshotReality<T=any>(path:string){return reads.peek<T>(path)}
export function snapshotDisplay<T>(key:string){return reads.peek<T>('display:'+key)}
export function invalidateRealityReads(){reads.clear()}
export function displayRead<T>(key:string,ttl:number,load:()=>Promise<T>){return reads.read('display:'+key,ttl,load)}
export async function uploadFile(file:File,privateFile=false){
  try{const r=await fetch(REALITY_API+'/api/reality/uploads?private='+privateFile,{method:'POST',headers:{Authorization:'Bearer '+credential,'Content-Type':file.type,'X-File-Name':encodeURIComponent(file.name)},body:file});if(r.status===401){setCredential('');window.dispatchEvent(new Event('custos-auth-expired'));throw new Error('Session expired. Please sign in again. Your form is still here.')}if(r.status===413)throw new Error('This file is too large for the server. Please choose a smaller file.');let value:any;try{value=await r.json()}catch{throw new Error('Upload server temporarily unavailable. Your form is still here; please retry.')}if(!r.ok)throw new Error(value.detail||'Upload failed');return value as {id:string;url:string;name:string}}catch(e){if(e instanceof TypeError)throw new Error('Image upload could not connect to the server. Your form is still here. Check your connection and retry.');throw e}
}
export async function openProof(id:string){const r=await fetch(REALITY_API+'/api/reality/media/'+id,{headers:{Authorization:'Bearer '+credential}});if(!r.ok)throw new Error('Could not load evidence');const url=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000)}
export function photoUrl(value:string,size?:number){return value.startsWith('/api/')?REALITY_API+value+(size?(value.includes('?')?'&':'?')+'size='+size:''):value}
export const short=(s:string)=>s?s.slice(0,6)+'…'+s.slice(-4):'—'
const numberFormats=new Map<number,Intl.NumberFormat>()
export function number(n:number|null|undefined,digits=4){if(n===null||n===undefined||!Number.isFinite(n))return '—';let format=numberFormats.get(digits);if(!format){format=new Intl.NumberFormat('en-US',{maximumFractionDigits:digits});numberFormats.set(digits,format)}return format.format(n)}
export const launchABI=artifacts.CustosRealityLaunchpad.abi
export const tokenABI=['function name() view returns(string)','function symbol() view returns(string)','function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)','function totalSupply() view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)']
const providersByNetwork=new Map<string,providers.StaticJsonRpcProvider>()
export function readonly(config:RealityConfig){const key=config.rpc+':'+config.chain_id;let provider=providersByNetwork.get(key);if(!provider){provider=new providers.StaticJsonRpcProvider({url:config.rpc,timeout:10000},{name:config.name,chainId:config.chain_id});providersByNetwork.set(key,provider)}return provider}
export async function ensureGiwa(config:RealityConfig){
  const injected=(window as any).ethereum;if(!injected)throw new Error('Install MetaMask or a compatible EVM wallet')
  const id='0x'+config.chain_id.toString(16);const current=await injected.request({method:'eth_chainId'});if(current!==id){try{await injected.request({method:'wallet_switchEthereumChain',params:[{chainId:id}]})}catch(e:any){if(e.code!==4902)throw e;await injected.request({method:'wallet_addEthereumChain',params:[{chainId:id,chainName:config.name,rpcUrls:[config.rpc],nativeCurrency:{name:config.native_symbol||'Ether',symbol:config.native_symbol||'ETH',decimals:18},blockExplorerUrls:[config.explorer]}]})}}
  const provider=new providers.Web3Provider(injected,'any');await provider.send('eth_requestAccounts',[]);return provider
}
export type MarketValue={price:number|null;cap:number|null;reserve:number|null;tokenReserve:string;quoteReserve:string;change24h?:number|null;volume24h?:number|null;pending?:boolean}
export async function fetchMarket(config:RealityConfig,asset:RealityAsset):Promise<MarketValue|null>{
  if(!config.launchpad||!asset.launch_id||!asset.token_address)return null
  return api<MarketValue>('/assets/'+asset.id+'/market')
}
export async function publishAsset(config:RealityConfig,asset:RealityAsset,onHash:(hash:string)=>void){
  if(!utils.isAddress(config.launchpad))throw new Error('GIWA Launchpad is not configured. Contact an administrator.')
  if(asset.mode==='verified'&&!asset.verified)throw new Error('Verified issuance requires proof approval.')
  const p=await ensureGiwa(config);const signer=p.getSigner();if((await signer.getAddress()).toLowerCase()!==asset.wallet.toLowerCase())throw new Error('Switch to the project creator’s wallet')
  const launch=new Contract(config.launchpad,launchABI,signer)
  const origin=REALITY_API||window.location.origin
  const tx=await launch.createLaunch(asset.name,asset.symbol,origin+'/api/reality/assets/'+asset.id+'/metadata',utils.parseUnits(asset.supply,18),utils.parseEther('1'),0,0)
  onHash(tx.hash);await tx.wait(2)
  return api('/assets/'+asset.id+'/attach',{tx_hash:tx.hash})
}
export async function tradeLaunch(config:RealityConfig,asset:RealityAsset,side:'buy'|'sell',amount:string,slippage:number){
  if(!asset.launch_id||!config.launchpad)throw new Error('Project has not been issued')
  const provider=await ensureGiwa(config),signer=provider.getSigner(),launch=new Contract(config.launchpad,launchABI,signer),input=utils.parseUnits(amount,18)
  if(input.lte(0))throw new Error('Enter an amount greater than zero')
  if(side==='buy'){const out:BigNumber=await launch.quoteFor(asset.launch_id,input);const tx=await launch.buy(asset.launch_id,out.mul(10000-slippage).div(10000),{value:input});return tx.wait()}
  const token=new Contract(asset.token_address!,tokenABI,signer),out:BigNumber=await launch.quoteSell(asset.launch_id,input),owner=await signer.getAddress()
  if((await token.allowance(owner,launch.address)).lt(input)){await(await token.approve(launch.address,input)).wait()}
  const tx=await launch.sell(asset.launch_id,input,out.mul(10000-slippage).div(10000),Math.floor(Date.now()/1000)+600);return tx.wait()
}
const routerABI=['function factory() view returns(address)','function WETH() view returns(address)','function getAmountsOut(uint256,address[]) view returns(uint256[])','function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns(uint256[])','function swapExactETHForTokens(uint256,address[],address,uint256) payable returns(uint256[])','function swapExactTokensForETH(uint256,uint256,address[],address,uint256) returns(uint256[])']
export type SwapQuote={input:string;output:string;amount:string;amountOut:BigNumber;decimals:number;inputDecimals:number;symbol:string;inputSymbol:string;path:string[];at:number;router:string;chainId:number;launchId?:number}
export async function quoteLaunchSwap(config:RealityConfig,asset:RealityAsset,reverse:boolean,amount:string):Promise<SwapQuote>{
  if(!config.launchpad||!asset.launch_id||!asset.token_address)throw new Error('Project has not been issued')
  const launch=new Contract(config.launchpad,launchABI,readonly(config)),state=await launch.getLaunch(asset.launch_id)
  if(state.token.toLowerCase()!==asset.token_address.toLowerCase())throw new Error('Project token does not match the onchain record')
  const value=utils.parseEther(amount);if(value.lte(0))throw new Error('Enter a valid amount')
  const out:BigNumber=await launch[reverse?'quoteSell':'quoteFor'](asset.launch_id,value)
  if(out.lte(0))throw new Error('Amount is too small')
  if(reverse&&out.gt(state.raised))throw new Error('Project ETH reserves are insufficient')
  return {input:reverse?asset.token_address:'ETH',output:reverse?'ETH':asset.token_address,amount,amountOut:out,decimals:18,inputDecimals:18,symbol:reverse?(config.native_symbol||'ETH'):state.symbol,inputSymbol:reverse?state.symbol:(config.native_symbol||'ETH'),path:[],at:Date.now(),router:config.launchpad,chainId:config.chain_id,launchId:asset.launch_id}
}
export async function quoteSwap(config:RealityConfig,input:string,output:string,amount:string):Promise<SwapQuote>{
  if(!utils.isAddress(config.swap_router)||!utils.isAddress(config.swap_factory))throw new Error('GIWA Swap route is not configured')
  const nativeIn=input==='ETH',nativeOut=output==='ETH'
  if((!nativeIn&&!utils.isAddress(input))||(!nativeOut&&!utils.isAddress(output))||input.toLowerCase()===output.toLowerCase())throw new Error('Select two different valid tokens')
  const p=readonly(config),router=new Contract(config.swap_router,routerABI,p),a=nativeIn?null:new Contract(input,tokenABI,p),b=nativeOut?null:new Contract(output,tokenABI,p)
  const [factory,wrapped,ad,bd,symbol,inputSymbol]=await Promise.all([router.factory(),router.WETH(),a?a.decimals():18,b?b.decimals():18,b?b.symbol():(config.native_symbol||'ETH'),a?a.symbol():(config.native_symbol||'ETH')])
  if(factory.toLowerCase()!==config.swap_factory.toLowerCase())throw new Error('Swap router and factory do not match')
  if(!utils.isAddress(wrapped)||wrapped.toLowerCase()!==config.weth.toLowerCase())throw new Error('Router native ETH configuration mismatch')
  if(Number(ad)>36||Number(bd)>36)throw new Error('Unsupported token precision')
  const value=utils.parseUnits(amount,ad);if(value.lte(0))throw new Error('Enter a valid amount')
  const from=nativeIn?wrapped:input,to=nativeOut?wrapped:output
  if(from.toLowerCase()===to.toLowerCase())throw new Error('Select a project token to swap')
  let path=[from,to],result:BigNumber[]
  try{result=await router.getAmountsOut(value,path)}catch{if([from,to].some(x=>x.toLowerCase()===wrapped.toLowerCase()))throw new Error('No liquidity available');path=[from,wrapped,to];try{result=await router.getAmountsOut(value,path)}catch{throw new Error('No swap route is available. Liquidity is required.')}}
  return {input,output,amount,amountOut:result[result.length-1],decimals:Number(bd),inputDecimals:Number(ad),symbol,inputSymbol,path,at:Date.now(),router:config.swap_router,chainId:config.chain_id}
}
export async function executeSwap(config:RealityConfig,q:SwapQuote,slippage:number){
  if(Date.now()-q.at>60000)throw new Error('Quote expired. Request a new quote.')
  if(q.chainId!==config.chain_id||q.router.toLowerCase()!==(q.launchId?config.launchpad:config.swap_router).toLowerCase())throw new Error('Network or route changed')
  const p=await ensureGiwa(config),signer=p.getSigner(),account=await signer.getAddress(),amount=utils.parseUnits(q.amount,q.inputDecimals)
  if(!Number.isInteger(slippage)||slippage<0||slippage>2000)throw new Error('Invalid slippage')
  const router=new Contract(q.router,routerABI,signer)
  const minimum=q.amountOut.mul(10000-slippage).div(10000)
  if(q.launchId){
    const launch=new Contract(q.router,launchABI,signer),state=await launch.getLaunch(q.launchId),tokenAddress=q.input==='ETH'?q.output:q.input
    if(state.token.toLowerCase()!==tokenAddress.toLowerCase())throw new Error('Project token mismatch')
    if(q.input==='ETH')return (await launch.buy(q.launchId,minimum,{value:amount})).wait()
    const token=new Contract(tokenAddress,tokenABI,signer)
    if((await token.balanceOf(account)).lt(amount))throw new Error('Insufficient token balance')
    if((await token.allowance(account,q.router)).lt(amount))await (await token.approve(q.router,amount)).wait()
    if(Date.now()-q.at>60000)throw new Error('Approval confirmed. Quote expired; request a new quote.')
    return (await launch.sell(q.launchId,amount,minimum,Math.floor(Date.now()/1000)+600)).wait()
  }
  if(q.input==='ETH'){
    if((await p.getBalance(account)).lt(amount))throw new Error('ETH Insufficient balance')
    const tx=await router.swapExactETHForTokens(minimum,q.path,account,Math.floor(Date.now()/1000)+600,{value:amount});return tx.wait()
  }
  const token=new Contract(q.input,tokenABI,signer)
  if((await token.balanceOf(account)).lt(amount))throw new Error('Insufficient balance')
  if((await token.allowance(account,q.router)).lt(amount))await(await token.approve(q.router,amount)).wait()
  // Keep the user's quoted minimum through approval; never silently replace it.
  if(Date.now()-q.at>60000)throw new Error('Quote expired. Request a new quote.')
  const method=q.output==='ETH'?'swapExactTokensForETH':'swapExactTokensForTokens'
  const tx=await router[method](amount,minimum,q.path,account,Math.floor(Date.now()/1000)+600);return tx.wait()
}
