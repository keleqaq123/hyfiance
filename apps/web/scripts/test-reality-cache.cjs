const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript')
const source=fs.readFileSync(path.join(__dirname,'../src/custos/realityReadCache.ts'),'utf8')
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
const local={exports:{}};new Function('exports',output)(local.exports)
const {RealityReadCache}=local.exports
async function test(){
 const cache=new RealityReadCache();let calls=0,finish
 const fetcher=()=>{calls++;return new Promise(resolve=>finish=resolve)}
 const a=cache.read('public',5000,fetcher),b=cache.read('public',5000,fetcher)
 assert.equal(calls,1);finish({name:'first'});assert.deepEqual(await a,await b)
 await cache.read('public',5000,fetcher);assert.equal(calls,1)
 // Wallet switch / mutation invalidates pending results as well as stored reads.
 const late=cache.read('wallet',5000,fetcher);cache.clear();finish('old wallet');await late
 const fresh=cache.read('wallet',5000,fetcher);assert.equal(calls,3);finish('new wallet');assert.equal(await fresh,'new wallet')
 let failures=0
 for(let i=0;i<2;i++)await assert.rejects(cache.read('error',5000,async()=>{failures++;throw new Error('offline')}))
 assert.equal(failures,2)
 await cache.read('wallet',0,async()=>{calls++;return 'updated'});assert.equal(calls,4)
 assert.equal(cache.peek('wallet'),'updated');assert.equal(cache.peek('missing'),undefined)
 const clock=Date.now;Date.now=()=>clock()+60001;assert.equal(cache.peek('wallet'),undefined);Date.now=clock
 cache.clear();assert.equal(cache.peek('wallet'),undefined)
 console.log('Cache checks passed: request deduplication, reuse, wallet/write invalidation, expiration, failed-read retry.')
}
test().catch(error=>{console.error(error);process.exitCode=1})
