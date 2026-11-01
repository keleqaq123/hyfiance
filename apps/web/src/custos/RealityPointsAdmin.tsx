import React,{useEffect,useState} from 'react'
import {utils} from 'ethers'
import {api,short} from './realityClient'

export default function RealityPointsAdmin({notify}:{notify:(message:string)=>void}){
 const [wallet,setWallet]=useState(''),[points,setPoints]=useState('100'),[reason,setReason]=useState(''),[reference,setReference]=useState(''),[tx,setTx]=useState('')
 const [rows,setRows]=useState<any[]>([]),[profile,setProfile]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[page,setPage]=useState(1),[more,setMore]=useState(false)
 const [requestId,setRequestId]=useState(()=>crypto.randomUUID()),[reasons,setReasons]=useState<Record<string,string>>({})
 async function load(address='',nextPage=1){const r=await api('/admin/points?wallet='+encodeURIComponent(address)+'&page='+nextPage);setRows(r.items);setProfile(r.profile);setPage(nextPage);setMore(r.has_more)}
 useEffect(()=>{void load().catch(e=>setError(e.message))},[])
 function edit(fn:()=>void){fn();setRequestId(crypto.randomUUID())}
 async function act(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn()}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 const valid=utils.isAddress(wallet.trim()),amount=Number(points)
 return <section className="rl-panel rl-inset"><h2>Season 1 points & feedback rewards</h2>
  <p className="rl-muted">These rewards update the Reality tasks leaderboard. The original Season 1 leaderboard is separate. Every award records the administrator, reason and feedback reference. First confirmed stake earns 100 points once per wallet.</p>
  <fieldset disabled={busy} style={{border:0,padding:0,minWidth:0}}><div className="rl-form-grid">
   <label className="rl-field">Recipient wallet<input value={wallet} placeholder="0x…" onChange={e=>edit(()=>{setWallet(e.target.value);setProfile(null)})}/></label>
   <label className="rl-field">Reward points<input type="number" min="1" max="100000" step="1" value={points} onChange={e=>edit(()=>setPoints(e.target.value))}/></label>
   <label className="rl-field">Feedback reference (unique)<input maxLength={200} value={reference} placeholder="Post URL or support ticket ID" onChange={e=>edit(()=>setReference(e.target.value))}/></label>
   <label className="rl-field">Reward reason<textarea maxLength={1000} value={reason} placeholder="Describe the feedback or contribution" onChange={e=>edit(()=>setReason(e.target.value))}/></label>
  </div><div className="rl-button-row"><button className="rl-outline" disabled={!valid} onClick={()=>void act(()=>load(wallet.trim()))}>Check points & history</button><button className="rl-button" disabled={!valid||!Number.isInteger(amount)||amount<1||amount>100000||reason.trim().length<3||reference.trim().length<3} onClick={()=>void act(async()=>{const r=await api('/admin/points',{id:requestId,wallet:wallet.trim(),points:amount,reason:reason.trim(),reference:reference.trim()});notify(r.duplicate?'Reward already recorded':'Feedback reward recorded');await load(wallet.trim())})}><span>{busy?'Working…':'Award feedback points'}</span></button></div>
  {profile?<p role="status">{short(profile.wallet)} · Total: {profile.points} points · Feedback rewards: {profile.bonusPoints||0} · Stake task: {profile.stakeCompleted?'Completed · 100 points':'Not recorded'}</p>:null}
  <h3>Recover a confirmed staking task</h3><p className="rl-footnote">Enter the recipient above and their GIWA staking transaction hash. This checks the receipt and event onchain; it cannot reward failed transactions or award a stake twice.</p><label className="rl-field">Staking transaction hash<input value={tx} placeholder="0x…" onChange={e=>setTx(e.target.value)}/></label><button className="rl-outline" disabled={!valid||!/^0x[0-9a-fA-F]{64}$/.test(tx.trim())} onClick={()=>void act(async()=>{await api('/admin/staking/verify',{wallet:wallet.trim(),tx_hash:tx.trim()});await load(wallet.trim());notify('Confirmed staking task recovered')})}>Verify & recover stake points</button>
  <h3>Reward history</h3><button className="rl-outline" onClick={()=>void act(()=>load())}>Show all rewards</button>
  {rows.map(row=><div className="rl-inline-note" key={row.id}><p><strong>{row.points} points</strong> · {row.wallet} · {row.revoked_at?'Revoked':'Active'}</p><p>{row.reason}</p><p>Reference: {row.reference}</p><p className="rl-footnote">By {row.admin} · {new Date(row.created_at*1000).toLocaleString()}</p>{row.revoked_at?<p>Revoked by {row.revoked_by}: {row.revoked_reason}</p>:<><label className="rl-field">Revocation reason<input value={reasons[row.id]||''} maxLength={1000} onChange={e=>setReasons(r=>({...r,[row.id]:e.target.value}))}/></label><button className="rl-danger" disabled={(reasons[row.id]||'').trim().length<3} onClick={()=>void act(async()=>{await api('/admin/points/'+row.id+'/revoke',{reason:reasons[row.id].trim()});await load(valid?wallet.trim():'',page);notify('Reward revoked; audit record retained')})}>Revoke reward</button></>}</div>)}
  {!rows.length?<p className="rl-muted">No rewards recorded.</p>:null}<div className="rl-button-row"><button className="rl-outline" disabled={page<=1} onClick={()=>void act(()=>load(profile?.wallet||'',page-1))}>Previous</button><button className="rl-outline" disabled={!more} onClick={()=>void act(()=>load(profile?.wallet||'',page+1))}>Next</button></div></fieldset>{error?<p className="rl-alert" role="alert">{error}</p>:null}
 </section>
}
