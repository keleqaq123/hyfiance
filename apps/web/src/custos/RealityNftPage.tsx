import React,{useCallback,useEffect,useRef,useState} from 'react'
import {Contract} from 'ethers'
import {Diamond,ExternalLink,Loader2,RefreshCw} from 'lucide-react'
import {displayRead,snapshotDisplay,invalidateRealityReads,ensureGiwa,RealityConfig,short} from './realityClient'

import {nftAddress as address,nftAbi as abi,readNftState,type NftState as State} from './realityNftRead'

export default function RealityNftPage({config,wallet,connect,notify}:{config:RealityConfig|null;wallet:string;connect:()=>Promise<void>;notify:(message:string)=>void}){
  const [state,setState]=useState<State|null>(()=>config?snapshotDisplay<State>('nft:'+address+':'+config.rpc+':'+wallet)||null:null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[hash,setHash]=useState('')
  const request=useRef(0)
  const refresh=useCallback(async()=>{
    if(!config||!address)return;const sequence=++request.current;setLoading(true)
    try{const result=await displayRead<State>('nft:'+address+':'+config.rpc+':'+wallet,15000,()=>readNftState(config,wallet));if(sequence===request.current){setState(result);setError('')}}
    catch{if(sequence===request.current)setError('Unable to read the GIWA NFT contract. Refresh to retry.')}
    finally{if(sequence===request.current)setLoading(false)}
  },[config,wallet])
  useEffect(()=>{setState(config?snapshotDisplay<State>('nft:'+address+':'+config.rpc+':'+wallet)||null:null);void refresh();const t=setInterval(()=>void refresh(),20000);return()=>{request.current++;clearInterval(t)}},[refresh])
  async function mint(){
    if(!wallet){await connect();return}if(!config||!state)return;setBusy(true)
    try{const p=await ensureGiwa(config),signer=p.getSigner();if((await signer.getAddress()).toLowerCase()!==wallet.toLowerCase())throw new Error('Use the connected wallet')
      const c=new Contract(address,abi,signer);const [price,open,minted,supply,max]=await Promise.all([c.mintPrice(),c.mintOpen(),c.mintedByWallet(wallet),c.totalSupply(),c.MAX_SUPPLY()]);if(!open)throw new Error('Mint is not open');if(minted.gte(await c.WALLET_LIMIT()))throw new Error('Wallet mint limit reached');if(supply.gte(max))throw new Error('Collection sold out')
      notify('Confirm the NFT mint in your wallet');const tx=await c.publicMint(1,{value:price});setHash(tx.hash);await tx.wait(2);invalidateRealityReads();notify('KBW 2026 commemorative NFT minted');await refresh()
    }catch(e:any){notify(e.reason||e.message||'Mint failed')}finally{setBusy(false)}
  }
  const sold=!!state&&state.supply>=state.max,limit=!!state&&state.minted>=state.limit
  return <section className="rl-nft-page">
    <div className="rl-nft-top"><span><Diamond size={18}/> CUSTOS <small>COMMUNITY ART</small></span>{address&&config?<a href={config.explorer+'/address/'+address} target="_blank" rel="noreferrer">EXPLORER <ExternalLink size={13}/></a>:null}</div>
    <div className="rl-nft-layout">
      <div className="rl-nft-story"><p className="rl-eyebrow">DEDICATED TO THOSE WHO CHOOSE TO BUILD</p><p className="rl-nft-chapter">KBW 2026 — COMMUNITY EDITION</p><h1 style={{fontSize:'clamp(38px,4vw,62px)',letterSpacing:'-2px'}}>I came to<br/>participate.<br/><em>I stayed<br/>to build.</em></h1><p>For everyone who arrived with curiosity and stayed to create. This Custos Finance community artwork celebrates the journey from discovering Web3 to bringing something real into it — an idea, a story, a piece of your world.</p><div className="rl-nft-caption">FROM PARTICIPATION TO CREATION · KBW 2026</div></div>
      <div className="rl-nft-art" style={{background:'#bceefa',transform:'none',boxShadow:'none',border:'1px solid #9ecfd8',padding:10}}><div className="rl-nft-art-cap">CUSTOS FINANCE <span>KBW 2026</span></div><img src="/assets/nft/kbw2026-community.png" alt="KBW 2026 Custos Finance community artwork: I came to participate. I stayed to build." style={{aspectRatio:'1 / 1',objectFit:'contain'}}/><p>INDEPENDENT COMMUNITY EDITION</p></div>
      <div className="rl-panel rl-nft-mint">
        <p className="rl-footnote">KBW 2026 · Independent community keepsake. Free mint; network gas applies.</p><p className="rl-eyebrow">{!address?'AWAITING DEPLOYMENT':sold?'COLLECTION SOLD OUT':state?(state.open?'MINT OPEN':'MINT PAUSED'):'GIWA TESTNET'}</p>
        <div className="rl-nft-mint-title"><div><p>MINT INFO</p><h2>{state?.name||"Custos — The Builder’s Mark"}</h2></div><span>KBW 2026</span></div>
        <dl><div><dt>COLLECTION SUPPLY</dt><dd>{state?state.supply.toLocaleString()+' / '+state.max.toLocaleString():'2,026 · planned'}</dd></div><div><dt>MINT PRICE</dt><dd>{state?'Free · Gas only':'Free · Gas only (planned)'}</dd></div><div><dt>WALLET LIMIT</dt><dd>{state?state.limit+' NFT':'1 NFT · planned'}</dd></div><div><dt>QUANTITY</dt><dd>01</dd></div></dl>
        <button className="rl-button" disabled={!address||!config||busy||sold||!!wallet&&(!state||!state.open||limit)} onClick={()=>void mint()}>{busy?<Loader2 className="spin" size={16}/>:null}<span>{!address?'NOT DEPLOYED':sold?'COLLECTION SOLD OUT':!wallet?'Connect wallet':limit?'ALREADY MINTED':state?.open?'Mint your mark':'MINT PAUSED'}</span></button>
        {error?<p className="rl-footnote">{error}</p>:null}
        <button className="rl-nft-refresh" disabled={loading} onClick={()=>{invalidateRealityReads();void refresh()}}><RefreshCw size={13}/>Refresh onchain state</button>
        <p className="rl-footnote">{wallet?short(wallet):'Wallet limits and prices are read from the contract'} · GIWA Sepolia</p>
        {hash?<a className="rl-chain-link" href={config?.explorer+'/tx/'+hash} target="_blank" rel="noreferrer">View mint transaction ↗</a>:null}
      </div>
    </div>
  </section>
}
