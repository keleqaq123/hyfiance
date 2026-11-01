import React,{useCallback,useEffect,useState} from 'react'
import {BigNumber,Contract,utils} from 'ethers'
import {Loader2} from 'lucide-react'
import {ensureGiwa,launchABI,number,readonly,RealityAsset,RealityConfig,short,tradeLaunch} from './realityClient'
import {percentageAmount,readTradeBalance,TradeBalance} from './realityTradeBalance'

export default function RealityTradePanel({asset,config,wallet,connect,notify,onConfirmed,reserve}:{asset:RealityAsset;config:RealityConfig|null;wallet:string;connect:()=>Promise<void>;notify:(s:string)=>void;onConfirmed:()=>Promise<void>;reserve?:number|null}){
 const [side,setSide]=useState<'buy'|'sell'>('buy'),[amount,setAmount]=useState(''),[out,setOut]=useState(''),[balance,setBalance]=useState<TradeBalance|null>(null),[balanceError,setBalanceError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0),[custom,setCustom]=useState(false),[percent,setPercent]=useState(''),[selected,setSelected]=useState(''),[inputError,setInputError]=useState('')
 const load=useCallback(()=>config&&wallet?readTradeBalance(config,asset,wallet):Promise.reject(new Error('Connect wallet to view balances.')),[config,asset.token_address,wallet])
 useEffect(()=>{
  let alive=true,running=false;setBalance(null);setBalanceError('');setAmount('');setSelected('');setOut('')
  if(!wallet||!config)return
  async function refreshBalance(){if(running||document.hidden)return;running=true;try{const result=await load();if(alive){setBalance(result);setBalanceError('')}}catch{if(alive){setBalance(null);setBalanceError('Balances temporarily unavailable.')}}finally{running=false}}
  void refreshBalance();const timer=setInterval(()=>void refreshBalance(),15000),visible=()=>{if(!document.hidden)void refreshBalance()};document.addEventListener('visibilitychange',visible)
  return()=>{alive=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible)}
 },[load,refresh])
 useEffect(()=>{setOut('');if(!config||!asset.launch_id||!amount)return;let cancelled=false;const timer=setTimeout(async()=>{try{const n=utils.parseEther(amount);if(n.lte(0))return;const c=new Contract(config.launchpad,launchABI,readonly(config)),r=await c[side==='buy'?'quoteFor':'quoteSell'](asset.launch_id,n);if(!cancelled)setOut(utils.formatEther(r))}catch{/* No invented executable quotes. */}},400);return()=>{cancelled=true;clearTimeout(timer)}},[amount,side,config,asset.launch_id])
 function choose(value:string){try{if(!balance)throw new Error('Wait for your wallet balances to load.');setAmount(percentageAmount(side==='buy'?balance.available:balance.tokens,value));setSelected(value);setInputError('')}catch(e:any){setInputError(e.message)}}
 function changeSide(value:'buy'|'sell'){setSide(value);setAmount('');setSelected('');setInputError('');setOut('')}
 let invalid=''
 try{if(amount){const n=utils.parseEther(amount);if(n.lte(0))invalid='Enter an amount greater than zero.';else if(balance&&n.gt(side==='buy'?balance.available:balance.tokens))invalid=side==='buy'?'Amount exceeds available ETH after the gas allowance.':'Amount exceeds your token holdings.'}}catch{invalid='Enter a valid amount (up to 18 decimal places).'}
 async function execute(){
  if(!wallet){await connect();return}if(!config||busy)return;setBusy(true)
  try{
   const provider=await ensureGiwa(config),signer=provider.getSigner()
   if((await signer.getAddress()).toLowerCase()!==wallet.toLowerCase())throw new Error('Wallet changed. Sign in again before trading.')
   const fresh=await load();setBalance(fresh);const input=utils.parseEther(amount)
   if(input.lte(0)||input.gt(side==='buy'?fresh.available:fresh.tokens))throw new Error(side==='buy'?'Insufficient available ETH after the gas allowance.':'Insufficient token holdings.')
   if(side==='buy'){
    const launch=new Contract(config.launchpad,launchABI,signer),quote:BigNumber=await launch.quoteFor(asset.launch_id,input),gas:BigNumber=await launch.estimateGas.buy(asset.launch_id,quote.mul(9900).div(10000),{value:input}),fees=await provider.getFeeData(),fee=fees.maxFeePerGas||fees.gasPrice
    if(!fee||input.add(gas.mul(130).div(100).mul(fee).add(utils.parseEther('0.00002'))).gt(await provider.getBalance(wallet)))throw new Error('Not enough ETH for this buy and current gas fees. Reduce the amount.')
   }else if(fresh.eth.lt(fresh.gasReserve))throw new Error('Keep enough GIWA ETH for approval and sell gas fees.')
   const receipt=await tradeLaunch(config,asset,side,amount,100);setAmount('');setSelected('');notify('Transaction confirmed: '+short(receipt.transactionHash));await onConfirmed();setBalance(await load())
  }catch(e:any){notify(e.reason||e.message)}finally{setBusy(false)}
 }
 const display=(value?:BigNumber)=>value===undefined?'—':utils.formatEther(value).replace(/(\.\d{0,8})\d*$/, '$1').replace(/\.?0+$/,'')||'0'
 return <section className="rl-panel rl-inset rl-trade-panel"><h2>Trade {asset.symbol}</h2><p className="rl-muted">Express your support through trading. Buys move the curve price up; sells move it down.</p>
  <div className="rl-tabs">{(['buy','sell'] as const).map(value=><button key={value} disabled={busy} className={side===value?'active':''} onClick={()=>changeSide(value)}><span>{value==='buy'?'Buy':'Sell'}</span></button>)}</div>
  <div className="rl-trade-balances" aria-live="polite"><div><span>{side==='buy'?'Wallet balance':'Token holdings'}</span><strong>{display(side==='buy'?balance?.eth:balance?.tokens)} {side==='buy'?'ETH':asset.symbol}</strong></div><div><span>{side==='buy'?'Available to buy':'Gas balance'}</span><strong>{display(side==='buy'?balance?.available:balance?.eth)} ETH</strong></div><p>{!wallet?'Connect wallet to view balances.':side==='buy'?'A conservative gas allowance is reserved. Actual fees are shown in your wallet.':'Selling requires GIWA ETH for gas; approval may be needed.'}</p></div>
  {balanceError?<div className="rl-alert" role="status">{balanceError}<button disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Retry</button></div>:null}
  <label className="rl-field">{side==='buy'?'Buy amount · ETH':'Sell amount · '+asset.symbol}<input aria-label={side==='buy'?'Buy amount · ETH':'Sell amount · '+asset.symbol} value={amount} disabled={busy} inputMode="decimal" onChange={e=>{setAmount(e.target.value);setSelected('');setInputError('')}} placeholder="0.00"/></label>
  <div className="rl-trade-percentages" aria-label="Balance percentage">{['20','50','100'].map(value=><button disabled={busy||!balance} aria-pressed={selected===value} className={selected===value?'active':''} key={value} onClick={()=>choose(value)}><span>{value}%</span></button>)}<button disabled={busy||!balance} aria-expanded={custom} className={custom?'active':''} onClick={()=>setCustom(value=>!value)}><span>Custom</span></button></div>
  {custom?<div className="rl-trade-custom"><label>Custom percentage<input aria-label="Custom percentage" value={percent} disabled={busy} inputMode="decimal" placeholder="0–100" onChange={e=>setPercent(e.target.value)}/></label><span>%</span><button className="rl-outline" disabled={busy||!balance} onClick={()=>choose(percent)}>Apply</button></div>:null}
  {inputError||invalid?<p className="rl-alert" role="alert">{inputError||invalid}</p>:null}
  <div className="rl-estimate"><span>Expected output</span><strong>{out?number(Number(out),8):'—'} {side==='buy'?asset.symbol:'ETH'}</strong></div><p className="rl-footnote">1% slippage · Curve trading · Actual ETH reserve {number(reserve,6)}</p>
  <button className="rl-button rl-full" disabled={busy||Boolean(wallet&&(!balance||!out||invalid))} onClick={()=>void execute()}>{busy?<Loader2 className="spin" size={16}/>:null}<span>{busy?'Confirm in your wallet':!wallet?'Connect wallet':side==='buy'?'Confirm buy':'Confirm sell'}</span></button>
 </section>
}
