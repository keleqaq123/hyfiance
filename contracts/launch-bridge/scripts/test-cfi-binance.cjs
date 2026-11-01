const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{ethers}=require('ethers'),ganache=require('ganache');
async function main(){
 const chain=ganache.provider({logging:{quiet:true},chain:{chainId:91342}}),p=new ethers.providers.Web3Provider(chain),owner=p.getSigner(0),alice=p.getSigner(1),bob=p.getSigner(2),oracle=ethers.Wallet.createRandom();
 try{
 const artifact=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../apps/web/src/custos/cfi-binance-artifact.json'))),c=await new ethers.ContractFactory(artifact.abi,artifact.bytecode,owner).deploy(oracle.address);await c.deployed();
 const one=ethers.utils.parseEther('1'),account=await alice.getAddress();
 const fields=[{name:'account',type:'address'},{name:'amount',type:'uint256'},{name:'price18',type:'uint256'},{name:'issuedAt',type:'uint256'},{name:'deadline',type:'uint256'},{name:'nonce',type:'uint256'}];
 async function quote(price,changes={},domainChanges={},signer=oracle){const now=(await p.getBlock('latest')).timestamp;const value={account,amount:one,price18:ethers.utils.parseEther(String(price)),issuedAt:now,deadline:now+60,nonce:await c.nonces(account),...changes};const domain={name:'Custos CFI Binance',version:'1',chainId:91342,verifyingContract:c.address,...domainChanges};return {...value,signature:await signer._signTypedData(domain,{StakeQuote:fields},value)}}
 const stake=(q,who=alice,min=0,changes={})=>{const v={...q,...changes};return c.connect(who).stake(v.amount,min,v.price18,v.issuedAt,v.deadline,v.nonce,v.signature,{value:v.amount})};
 const q=await quote(2000);
 assert.equal(await c.quoteDigest(q.account,q.amount,q.price18,q.issuedAt,q.deadline,q.nonce),ethers.utils._TypedDataEncoder.hash({name:'Custos CFI Binance',version:'1',chainId:91342,verifyingContract:c.address},{StakeQuote:fields},q));
 await assert.rejects(()=>stake(q,bob));
 await assert.rejects(()=>stake(q,alice,0,{amount:one.div(2)}));
 await assert.rejects(()=>stake(q,alice,0,{price18:ethers.utils.parseEther('2222')}));
 await assert.rejects(()=>stake(q,alice,ethers.utils.parseEther('2001')));
 await assert.rejects(()=>stake({...q,signature:'0x1234'}));
 await assert.rejects(async()=>stake(await quote(2000,{}, {chainId:1})));
 await assert.rejects(async()=>stake(await quote(2000,{}, {verifyingContract:await owner.getAddress()})));
 await assert.rejects(async()=>stake(await quote(2000,{}, {},ethers.Wallet.createRandom())));
 const now=(await p.getBlock('latest')).timestamp;
 await assert.rejects(async()=>stake(await quote(2000,{issuedAt:now-120,deadline:now-60})));
 await assert.rejects(async()=>stake(await quote(2000,{issuedAt:now+100,deadline:now+160})));
 await assert.rejects(async()=>stake(await quote(2000,{deadline:now+3600})));
 await(await stake(q,alice,ethers.utils.parseEther('2000'))).wait();
 assert((await c.balanceOf(account)).eq(ethers.utils.parseEther('2000')));assert((await c.principalOf(account)).eq(one));assert((await c.nonces(account)).eq(1));
 await assert.rejects(()=>stake(q));
 await(await stake(await quote(2222),alice,ethers.utils.parseEther('2222'))).wait();
 assert((await c.balanceOf(account)).eq(ethers.utils.parseEther('4222')));assert((await p.getBalance(c.address)).eq(one.mul(2)));
 await assert.rejects(()=>c.connect(alice).transfer(oracle.address,1));await assert.rejects(()=>c.connect(bob).unstake(1,0));
 assert((await c.previewUnstake(account,ethers.utils.parseEther('2111'))).eq(one));
 await(await c.connect(alice).unstake(ethers.utils.parseEther('2111'),one)).wait();
 // Withdrawals require no API, signature, new price or operator transaction.
 await p.send('evm_increaseTime',[3600]);await p.send('evm_mine',[]);
 await(await c.connect(alice).unstake(ethers.utils.parseEther('2111'),one)).wait();
 assert((await c.balanceOf(account)).eq(0));assert((await c.totalPrincipal()).eq(0));assert((await p.getBalance(c.address)).eq(0));
 assert(!c.interface.functions['withdraw(uint256)']);assert(!c.interface.functions['mint(address,uint256)']);
 console.log('Binance CFI checks passed: 2000/2222 conversion, EIP-712 digest, account/amount/price/chain/contract binding, wrong signer, expiration, nonce replay, slippage, bound receipts, partial/full ETH redemption and no admin drain.');
 }finally{await chain.disconnect()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
