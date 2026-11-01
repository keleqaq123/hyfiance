const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{ethers}=require('ethers'),ganache=require('ganache'),solc=require('solc');
async function main(){
 const chain=ganache.provider({logging:{quiet:true},chain:{chainId:91342}}),p=new ethers.providers.Web3Provider(chain),owner=p.getSigner(0),alice=p.getSigner(1),bob=p.getSigner(2);
 const source=`pragma solidity ^0.8.30; contract Oracle {struct Price{int64 price;uint64 conf;int32 expo;uint256 publishTime;} Price public quote;function set(int64 v,uint64 c,int32 e,uint256 t) external{quote=Price(v,c,e,t);} function getUpdateFee(bytes[] calldata) external pure returns(uint256){return 1;}function updatePriceFeeds(bytes[] calldata) external payable{require(msg.value==1);}function getPriceNoOlderThan(bytes32,uint256) external view returns(Price memory){return quote;}}`;
 const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'O.sol':{content:source}},settings:{evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}))).contracts['O.sol'].Oracle;
 const oracle=await new ethers.ContractFactory(output.abi,'0x'+output.evm.bytecode.object,owner).deploy();await oracle.deployed();
 const artifact=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../apps/web/src/custos/cfi-artifact.json'))),c=await new ethers.ContractFactory(artifact.abi,artifact.bytecode,owner).deploy(oracle.address);await c.deployed();
 const one=ethers.utils.parseEther('1'),now=(await p.getBlock('latest')).timestamp,address=await alice.getAddress();
 await(await oracle.set(200000000000,1000000,-8,now)).wait();
 await(await c.connect(alice).stake(one,ethers.utils.parseEther('2000'),[],{value:one.add(1)})).wait();
 assert((await c.balanceOf(address)).eq(ethers.utils.parseEther('2000')));assert((await c.principalOf(address)).eq(one));
 await assert.rejects(()=>c.connect(alice).transfer(awaitAddress(),1));
 function awaitAddress(){return oracle.address}
 await assert.rejects(()=>c.connect(alice).stake(one,ethers.utils.parseEther('2001'),[],{value:one.add(1)}));
 await assert.rejects(()=>c.connect(alice).stake(one,0,[],{value:one}));
 await assert.rejects(()=>c.connect(bob).unstake(1,0));
 await(await oracle.set(400000000000,1000000,-8,now)).wait();
 await(await c.connect(alice).stake(one,ethers.utils.parseEther('4000'),[],{value:one.add(1)})).wait();
 assert((await c.previewUnstake(address,ethers.utils.parseEther('3000'))).eq(one));
 await(await c.connect(alice).unstake(ethers.utils.parseEther('3000'),one)).wait();
 assert((await c.principalOf(address)).eq(one));
 // Oracle failure cannot prevent withdrawal of recorded ETH principal.
 await(await oracle.set(0,0,-8,0)).wait();
 await(await c.connect(alice).unstake(ethers.utils.parseEther('3000'),one)).wait();
 assert((await c.balanceOf(address)).eq(0));assert((await c.totalPrincipal()).eq(0));assert((await p.getBalance(c.address)).eq(0));
 await assert.rejects(()=>c.connect(alice).stake(one,0,[],{value:one.add(1)}));
 await(await oracle.set(200000000000,1000000,-8,now-120)).wait();await assert.rejects(()=>c.connect(alice).stake(one,0,[],{value:one.add(1)}));
 await(await oracle.set(200000000000,3000000000,-8,now)).wait();await assert.rejects(()=>c.connect(alice).stake(one,0,[],{value:one.add(1)}));
 assert(!c.interface.functions['withdraw(uint256)']);assert(!c.interface.functions['mint(address,uint256)']);
 await chain.disconnect();console.log('CFI tests passed: USD receipt minting, fee validation, slippage, partial/full ETH redemption, stale/confidence rejection, account-bound receipts, no admin drain.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
