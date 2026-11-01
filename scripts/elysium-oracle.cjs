// Test-only operator oracle updater. Preserve upstream timestamps; never turn
// stale market data into a fresh executable quote by stamping it with local time.
const fs=require('node:fs'),path=require('node:path'),{ethers}=require('ethers');
const {validateChain}=require('./elysium-deploy.cjs');
const root=path.resolve(__dirname,'..');
function load(file){return JSON.parse(fs.readFileSync(path.join(root,file),'utf8'))}
function scale(value,expo){
 const exponent=Number(expo)+18;
 if(!Number.isInteger(exponent)||exponent<0||exponent>36)throw Error('Unsupported oracle precision');
 return BigInt(value)*10n**BigInt(exponent);
}
async function main(){
 const record=load('deployments/elysium-testnet.json');
 if(record.modules?.markets!=='confirmed')throw Error('Elysium market deployment is not confirmed');
 const config=load('apps/api/market-config.json'),credentials=load('.secrets/elysium-testnet.json');
 validateChain(config.network.chainId);validateChain(credentials.chainId);
 const provider=new ethers.providers.JsonRpcProvider({url:process.env.ELYSIUM_RPC_URL||record.rpc,headers:{'User-Agent':'hyfiance-testnet-check/1.0'},timeout:20000});
 validateChain(parseInt(await provider.send('eth_chainId',[]),16));
 const wallet=new ethers.Wallet(credentials.privateKey,provider);
 const oracle=new ethers.Contract(record.contracts.oracleRouter,['function owner() view returns(address)','function setPrice(bytes32,uint256,uint256,uint256)'],wallet);
 if((await oracle.owner()).toLowerCase()!==wallet.address.toLowerCase())throw Error('Test oracle owner mismatch');
 const feeds=new Map();
 for(const market of [...Object.values(config.perps||{}),...Object.values(config.spot||{})])if(market.feedId)feeds.set(market.feedId.toLowerCase(),market.maxPriceAge||120);
 async function update(){
  const url=new URL('/v2/updates/price/latest',process.env.PYTH_HERMES_URL||'https://hermes.pyth.network');
  for(const feed of feeds.keys())url.searchParams.append('ids[]',feed);
  url.searchParams.set('parsed','true');
  const response=await fetch(url,{headers:process.env.PYTH_API_KEY?{'Authorization':'Bearer '+process.env.PYTH_API_KEY}:{},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error(`Hermes returned HTTP ${response.status}; no prices changed`);
  const data=await response.json();let updated=0;
  for(const item of data.parsed||[]){
   const feed='0x'+item.id.replace(/^0x/,''),age=Math.floor(Date.now()/1000)-Number(item.price.publish_time),maxAge=feeds.get(feed.toLowerCase());
   if(!maxAge||age < -5||age>maxAge){console.log('Skipped stale or unknown test feed',feed);continue}
   const price=scale(item.price.price,item.price.expo),confidence=scale(item.price.conf,item.price.expo);
   if(price<=0n||confidence*100n>price){console.log('Skipped low-confidence test feed',feed);continue}
   const args=[feed,String(price),String(confidence),item.price.publish_time];
   const gas=(await oracle.estimateGas.setPrice(...args)).mul(125).div(100),gasPrice=await provider.getGasPrice();
   if(gas.mul(gasPrice).gt(ethers.utils.parseEther('0.00005')))throw Error('Oracle update cost exceeds testnet per-update cap');
   await(await oracle.setPrice(...args,{gasLimit:gas,gasPrice})).wait(1);updated++;
  }
  console.log(JSON.stringify({chainId:99801,updated,source:'Pyth Hermes, operator-relayed test oracle',at:new Date().toISOString()}));
 }
 do{
  try{await update()}catch(error){if(!process.argv.includes('--watch'))throw error;console.error(error.reason||error.message)}
  if(!process.argv.includes('--watch'))break;
  await new Promise(resolve=>setTimeout(resolve,45000));
 }while(true);
}
module.exports={scale};
if(require.main===module)main().catch(error=>{console.error(error.reason||error.message);process.exitCode=1});
