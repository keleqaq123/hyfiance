import React,{useEffect,useState} from 'react'
import {useRealityMarket} from './useRealityMarket'
import {Link} from 'react-router-dom'
import {Image as ImageIcon,Loader2,Search,Star,ArrowUpRight} from 'lucide-react'
import {api,number,photoUrl,RealityAsset,RealityConfig,snapshotReality} from './realityClient'

import RealityVerifiedMark from './RealityVerifiedMark'

export const marketCategories=[['','All projects'],['memories','Pets & Memories'],['things','Objects & Collectibles'],['assets','Property & Business']]
export function ProjectImage({asset,className}:{asset:RealityAsset;className:string}){
 const [failed,setFailed]=useState(false)
 useEffect(()=>setFailed(false),[asset.image_url])
 return failed?<div className={className+' rl-photo-missing'} role="img" aria-label="Project photo unavailable"><ImageIcon size={24}/></div>:<img className={className} src={photoUrl(asset.image_url,className==='rl-ranking-photo'?96:480)} alt={asset.name} loading="lazy" decoding="async" onError={()=>setFailed(true)}/>
}
export function ProjectBadge({asset}:{asset:RealityAsset}){
 return <span className={'rl-project-badge '+(asset.verified?'verified':'')} title={asset.verified?'Submitted evidence verified. This does not guarantee a price or return.':undefined}>{asset.verified?<RealityVerifiedMark/>:null}{asset.verified?'Verified':asset.mode==='free'?'Open launch':'Unverified'}</span>
}
export function PriceChange({value}:{value:number|null|undefined}){
 return <span className={value==null?'rl-muted':value<0?'rl-red':'rl-positive'}>{value==null?'—':(value>0?'+':'')+number(value,2)+'%'}</span>
}
type Props={config:RealityConfig|null;wallet:string;connect:()=>Promise<void>;notify:(s:string)=>void}
export default function RealityMarketsPage({config,wallet,connect,notify}:Props){
 const [items,setItems]=useState<RealityAsset[]>([]),[category,setCategory]=useState(''),[verification,setVerification]=useState(''),[search,setSearch]=useState(''),[tab,setTab]=useState('all'),[sort,setSort]=useState('new'),[page,setPage]=useState(1),[more,setMore]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[busy,setBusy]=useState<string[]>([])
 useEffect(()=>{
  let alive=true,sequence=0,running=false;setLoading(true);setError('')
  if(tab==='watchlist'&&!wallet){setLoading(false);return}
  const q=new URLSearchParams({issued:'true',search,category,verification,sort,page:String(page),limit:'24',...(tab==='watchlist'?{watched:'true'}:{}),...(tab==='recent'?{recent:'true'}:{})}),path='/assets?'+q,cached=snapshotReality(path)
  setItems(cached?.items||[]);setMore(cached?.has_more||false);setLoading(!cached)
  async function load(){if(running||document.hidden)return;running=true;const call=++sequence;try{const r=await api(path);if(alive&&call===sequence){setItems(previous=>JSON.stringify(previous)===JSON.stringify(r.items)?previous:r.items);setMore(r.has_more);setError('')}}catch(e:any){if(alive&&call===sequence)setError(e.message)}finally{running=false;if(alive&&call===sequence)setLoading(false)}}
  const visible=()=>{if(!document.hidden)void load()};document.addEventListener('visibilitychange',visible);const debounce=setTimeout(()=>void load(),search?200:0),timer=setInterval(()=>void load(),30000)
  return()=>{alive=false;clearTimeout(debounce);clearInterval(timer);document.removeEventListener('visibilitychange',visible)}
 },[search,category,verification,sort,tab,page,wallet,refresh])
 const market=useRealityMarket(items,config)
 async function toggleWatch(asset:RealityAsset){if(!wallet){await connect();return}setBusy(ids=>[...ids,asset.id]);try{const result=await api('/assets/'+asset.id+'/reactions',{kind:'watch'});if(tab==='watchlist')setRefresh(n=>n+1);else setItems(rows=>rows.map(a=>a.id===asset.id?{...a,watchd:result.active}:a))}catch(e:any){notify(e.message)}finally{setBusy(ids=>ids.filter(id=>id!==asset.id))}}
 function chooseTab(value:string){setTab(value);setPage(1);if(value==='recent')setSort('new')}
 return <div className="rl-discovery-page">
  <div className="rl-heading"><div><h1>Markets</h1><p>Discover real projects. Trade what matters to you.</p></div><label className="rl-search"><Search size={17}/><input aria-label="Search market projects" placeholder="Search projects or tokens" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}}/></label></div>
  <section className="rl-discovery-shell rl-panel">
   <aside className="rl-market-sidebar" aria-label="Market filters"><h2>Categories</h2><div className="rl-market-category-list">{marketCategories.map(([key,label])=><button key={key} className={category===key?'active':''} aria-pressed={category===key} onClick={()=>{setCategory(key);setPage(1)}}>{label}</button>)}</div><div className="rl-sidebar-section"><h2>Verification</h2><div className="rl-market-segments">{[['','All'],['verified','Verified']].map(([key,label])=><button key={key} className={verification===key?'active':''} aria-pressed={verification===key} onClick={()=>{setVerification(key);setPage(1)}}>{label}</button>)}</div></div><button className={'rl-sidebar-watch '+(tab==='watchlist'?'active':'')} onClick={()=>chooseTab(tab==='watchlist'?'all':'watchlist')}><Star size={16}/>My watchlist</button></aside>
   <div className="rl-market-catalog"><div className="rl-catalog-toolbar"><div className="rl-market-segments" aria-label="Market view">{[['all','All projects'],['recent','Recently listed'],['watchlist','Watchlist']].map(([key,label])=><button key={key} className={tab===key?'active':''} aria-pressed={tab===key} onClick={()=>chooseTab(key)}>{label}</button>)}</div><select aria-label="Market sort" value={sort} onChange={e=>{setSort(e.target.value);setPage(1)}}><option value="new">Recently listed</option><option value="popular">Community favourites</option></select></div>
    {tab==='recent'?<p className="rl-catalog-note">Confirmed listings from the last 7 days.</p>:null}
    {error?<div className="rl-alert" role="alert">{error}<button onClick={()=>setRefresh(n=>n+1)}>Retry</button></div>:null}
    {tab==='watchlist'&&!wallet?<div className="rl-catalog-empty"><Star size={28}/><h2>Your watchlist</h2><p>Sign in to see projects you follow.</p><button className="rl-button" onClick={()=>void connect()}>Connect wallet</button></div>:loading&&!items.length?<div className="rl-loading"><Loader2 className="spin"/>Loading market projects…</div>:!items.length&&!error?<div className="rl-catalog-empty"><ImageIcon size={28}/><h2>{tab==='watchlist'?'No watched projects yet':tab==='recent'?'No recent listings':'No projects found'}</h2><p>{tab==='watchlist'?'Save a project with its star to follow it here.':'Try another category or search. Only confirmed onchain tokens appear in Markets.'}</p>{category||verification||search?<button className="rl-outline" onClick={()=>{setCategory('');setVerification('');setSearch('');setPage(1)}}>Clear filters</button>:<Link className="rl-outline" to="/reality">Explore the launchpad</Link>}</div>:<div className="rl-market-grid">{items.map(a=>{const m=market[a.id];return <article className="rl-market-card" key={a.id}><div className="rl-market-photo-wrap"><Link to={'/reality/asset/'+a.id} aria-label={'View '+a.name}><ProjectImage asset={a} className="rl-market-photo"/>{a.verified?<RealityVerifiedMark corner/>:null}</Link><button className={'rl-market-star '+(a.watchd?'active':'')} disabled={busy.includes(a.id)} aria-label={(a.watchd?'Remove ':'Watch ')+a.name+(a.watchd?' from watchlist':'')} aria-pressed={a.watchd} onClick={()=>void toggleWatch(a)}><Star size={16} fill={a.watchd?'currentColor':'none'}/></button></div><div className="rl-market-card-body"><ProjectBadge asset={a}/><Link className="rl-market-card-title" to={'/reality/asset/'+a.id}><h2 title={a.name}>{a.name}</h2><span>{a.symbol}</span></Link><p className="rl-market-story">{a.story}</p><div className="rl-market-card-quote"><div><span>Price · HYPE</span><strong>{number(m?.price,10)}</strong></div><span className="rl-card-change" title="Price change in the last 24 hours"><PriceChange value={m?.change24h}/></span></div><div className="rl-market-card-bottom"><span title="Token market capitalization in ETH">Market cap <b>{number(m?.cap,5)}</b></span><Link to={'/reality/asset/'+a.id}>Trade <ArrowUpRight size={14}/></Link></div></div></article>})}</div>}
    {(items.length>0||page>1)&&!(tab==='watchlist'&&!wallet)?<div className="rl-pagination"><button disabled={page===1||loading} onClick={()=>setPage(n=>n-1)}>Previous</button><span>Page {page}</span><button disabled={!more||loading} onClick={()=>setPage(n=>n+1)}>Next</button></div>:null}
   </div>
  </section><p className="rl-footnote">Prices reflect community trading on GIWA. Listings and quotes refresh every 30 seconds. Unavailable prices are shown as —.</p>
 </div>
}
