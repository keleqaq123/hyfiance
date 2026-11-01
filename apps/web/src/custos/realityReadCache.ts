// Short-lived, memory-only reads. Credentials and mutations create a new epoch,
// so a late request cannot repopulate data from an earlier wallet or write.
export class RealityReadCache {
 private values=new Map<string,{at:number;value:any}>()
 private pending=new Map<string,Promise<any>>()
 private epoch=0
 clear(){this.epoch++;this.values.clear();this.pending.clear()}
 peek<T>(key:string,maxAge=60000):T|undefined{
  const cached=this.values.get(key)
  return cached&&Date.now()-cached.at<maxAge?cached.value:undefined
 }
 async read<T>(key:string,ttl:number,fetcher:()=>Promise<T>):Promise<T>{
  const cached=this.values.get(key)
  if(cached&&Date.now()-cached.at<ttl)return cached.value
  const active=this.pending.get(key);if(active)return active
  const epoch=this.epoch
  const task=fetcher().then(value=>{
   if(epoch===this.epoch){if(this.values.size>=150)this.values.delete(this.values.keys().next().value!);this.values.set(key,{at:Date.now(),value})}
   return value
  }).finally(()=>{if(this.pending.get(key)===task)this.pending.delete(key)})
  this.pending.set(key,task);return task
 }
}
