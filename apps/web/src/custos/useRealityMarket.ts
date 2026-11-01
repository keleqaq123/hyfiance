import {useEffect,useState} from 'react'
import {api,fetchMarket,MarketValue,RealityAsset,RealityConfig,snapshotReality} from './realityClient'

// Publish each completed quote immediately; one slow token cannot block a grid.
export function useRealityMarket(items:RealityAsset[],config:RealityConfig|null,enabled=true){
 const [values,setValues]=useState<Record<string,MarketValue>>({})
 useEffect(()=>{
  if(!config||!enabled||!items.length)return
  const snapshots:Record<string,MarketValue>={}
  for(const asset of items){const cached=snapshotReality<MarketValue>('/assets/'+asset.id+'/market');if(cached)snapshots[asset.id]=cached}
  setValues(previous=>Object.keys(snapshots).some(id=>JSON.stringify(previous[id])!==JSON.stringify(snapshots[id]))?{...previous,...snapshots}:previous)
  let alive=true,running=false,frame=0,buffer:Record<string,MarketValue>={},timer:ReturnType<typeof setTimeout>|undefined
  function publish(id:string,value:MarketValue){
   buffer[id]=value
   if(!frame)frame=requestAnimationFrame(()=>{frame=0;const next=buffer;buffer={};if(alive)setValues(previous=>Object.keys(next).some(key=>JSON.stringify(previous[key])!==JSON.stringify(next[key]))?{...previous,...next}:previous)})
  }
  async function load(){
   if(running||!alive)return
   if(document.hidden){timer=setTimeout(()=>void load(),30000);return}
   running=true;let pending=false
   const stats=api('/market-stats').catch(()=>null)
   try{
    for(let i=0;i<items.length&&alive;i+=8)await Promise.all(items.slice(i,i+8).map(async asset=>{
     try{const value=await fetchMarket(config!,asset);if(alive&&value){pending=pending||!!value.pending;publish(asset.id,value)}}catch{/* Keep the last displayed quote until the next bounded refresh. */}
    }))
    const activity=await stats
    if(alive&&activity)for(const asset of items){const cached=buffer[asset.id]||snapshotReality<MarketValue>('/assets/'+asset.id+'/market');if(cached)publish(asset.id,{...cached,change24h:activity.items[asset.id]?.change_24h??null,volume24h:activity.items[asset.id]?.volume_eth??null})}
   }finally{running=false;if(alive)timer=setTimeout(()=>void load(),pending?2000:30000)}
  }
  const visible=()=>{if(!document.hidden){if(timer)clearTimeout(timer);void load()}}
  document.addEventListener('visibilitychange',visible);void load()
  return()=>{alive=false;if(frame)cancelAnimationFrame(frame);if(timer)clearTimeout(timer);document.removeEventListener('visibilitychange',visible)}
 },[items,config,enabled])
 return values
}
