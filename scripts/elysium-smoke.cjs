const fs=require('node:fs'),path=require('node:path'),{ethers}=require('ethers');
const root=path.resolve(__dirname,'..');
const net=require('../networks/elysium-testnet.json');
const {validateChain}=require('./elysium-deploy.cjs');
async function main(){
 const record=JSON.parse(fs.readFileSync(path.join(root,'deployments/elysium-testnet.json')));
 if(record.status!=='deployed')throw Error(`No completed Elysium deployment: ${record.status}`);
 const p=new ethers.providers.JsonRpcProvider({url:process.env.ELYSIUM_RPC_URL||net.rpc,headers:{'User-Agent':'hyfiance-testnet-check/1.0'},timeout:20000});
 validateChain(parseInt(await p.send('eth_chainId',[]),16));
 for(const module of ['swap','markets','launchpad','cfi','nft'])if(record.modules[module]!=='confirmed')throw Error(`${module} not confirmed`);
 for(const [name,address] of Object.entries(record.contracts))if(ethers.utils.isAddress(address)&&(await p.getCode(address))==='0x')throw Error(`${name} has no code`);
 const c=record.contracts;
 const router=new ethers.Contract(c.router,['function factory() view returns(address)','function WETH() view returns(address)'],p);
 if((await router.factory()).toLowerCase()!==c.factory.toLowerCase()||(await router.WETH()).toLowerCase()!==c.weth.toLowerCase())throw Error('Swap deployment binding mismatch');
 const pair=new ethers.Contract(c.pair,['function getReserves() view returns(uint112,uint112,uint32)'],p);
 const reserves=await pair.getReserves();if(reserves[0].isZero()||reserves[1].isZero())throw Error('Swap liquidity missing');
 const credentials=JSON.parse(fs.readFileSync(path.join(root,'.secrets/elysium-testnet.json')));
 const cfi=new ethers.Contract(c.cfi,['function quoteSigner() view returns(address)'],p);
 if((await cfi.quoteSigner()).toLowerCase()!==credentials.quoteSignerAddress.toLowerCase())throw Error('Receipt quote signer mismatch');
 const nft=new ethers.Contract(c.nft,['function mintPrice() view returns(uint256)','function MAX_SUPPLY() view returns(uint256)'],p);
 if(!(await nft.mintPrice()).isZero()||!(await nft.MAX_SUPPLY()).eq(2026))throw Error('NFT rules mismatch');
 console.log(JSON.stringify({ok:true,chainId:99801,modules:record.modules,checkedContractEntries:Object.keys(c).length,blockNumber:await p.getBlockNumber()}));
}
main().catch(e=>{console.error(e.reason||e.message);process.exitCode=1});
