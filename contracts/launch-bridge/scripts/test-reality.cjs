const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {ethers}=require(process.env.ETHERS_MODULE||'ethers');const ganache=require(process.env.GANACHE_MODULE||'ganache');
const artifact=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../apps/web/src/custos/reality-artifacts.json')));
async function rejects(fn){let failed=false;try{const r=await fn();if(r.wait)await r.wait()}catch{failed=true}assert(failed,'Expected a reverted transaction')}
async function main(){
 const server=ganache.provider({chain:{chainId:91342},logging:{quiet:true},wallet:{totalAccounts:4}}),provider=new ethers.providers.Web3Provider(server),creator=provider.getSigner(0),buyer=provider.getSigner(1),other=provider.getSigner(2);
 const launch=await new ethers.ContractFactory(artifact.CustosRealityLaunchpad.abi,artifact.CustosRealityLaunchpad.bytecode,creator).deploy();await launch.deployed();
 const supply=ethers.utils.parseEther('1000000');
 for(const name of ['Camera','Property'])await(await launch.createLaunch(name,name==='Camera'?'CAM':'HBR','https://example.test/api/reality/assets/'+name+'/metadata',supply,ethers.utils.parseEther('1'),0,0)).wait();
 assert.equal((await launch.launchCount()).toNumber(),2);const a=await launch.getLaunch(1),b=await launch.getLaunch(2);assert.equal(a.creator,await creator.getAddress());assert.equal(a.curated,false);
 const token=new ethers.Contract(a.token,artifact.RealityToken.abi,buyer);assert((await token.totalSupply()).eq(supply));
 await rejects(()=>launch.createLaunch('x','X','',supply,1,0,0));
 const amount=ethers.utils.parseEther('0.1'),quoted=await launch.quoteFor(1,amount);
 await rejects(()=>launch.connect(buyer).buy(1,quoted.add(1),{value:amount}));
 await(await launch.connect(buyer).buy(1,quoted,{value:amount})).wait();assert((await token.balanceOf(await buyer.getAddress())).eq(quoted));
 const after=await launch.getLaunch(1);assert(after.raised.eq(amount));assert(after.tokenReserve.add(quoted).eq(supply));assert((await launch.getLaunch(2)).raised.eq(0));
 await rejects(()=>launch.connect(buyer).sell(1,quoted,0,Math.floor(Date.now()/1000)+3600));
 await(await token.approve(launch.address,quoted)).wait();const refund=await launch.quoteSell(1,quoted);
 assert(refund.lte(amount));await rejects(()=>launch.connect(buyer).sell(1,quoted,refund.add(1),Math.floor(Date.now()/1000)+3600));
 await rejects(()=>launch.connect(buyer).sell(1,quoted,0,1));
 await(await launch.connect(buyer).sell(1,quoted,refund,Math.floor(Date.now()/1000)+3600)).wait();assert((await token.balanceOf(await buyer.getAddress())).eq(0));
 const reverted=await launch.getLaunch(1);assert(reverted.tokenReserve.eq(supply));assert(reverted.raised.eq(amount.sub(refund)));assert((await launch.getLaunch(2)).quoteReserve.eq(b.quoteReserve));
 // The creator cannot mint, seize proceeds or drain a different launch.
 assert(!launch.interface.functions['finalize(uint256)']);assert(!token.interface.functions['mint(address,uint256)']);
 await(await launch.connect(other).buy(2,0,{value:amount})).wait();assert((await launch.getLaunch(2)).raised.eq(amount));
 const balance=await provider.getBalance(launch.address);assert(balance.eq((await launch.getLaunch(1)).raised.add((await launch.getLaunch(2)).raised)));
 await server.disconnect();console.log('Reality contract tests passed: permissionless issuance, fixed supply, buy/sell, approval, slippage, deadline and reserve isolation.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
