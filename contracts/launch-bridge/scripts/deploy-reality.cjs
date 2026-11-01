// Deploy only to GIWA Sepolia. Credentials stay in the local environment file.
const fs=require('node:fs'),path=require('node:path'),{ethers}=require('ethers');
async function main(){
 const file=process.argv[2];if(!file)throw Error('Pass the local deployment .env path');
 const env={};for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z_]+)\s*=\s*(.*)$/);if(m)env[m[1]]=m[2].trim().replace(/^['"]|['"]$/g,'');}
 const provider=new ethers.providers.JsonRpcProvider('https://sepolia-rpc.giwa.io');
 if((await provider.getNetwork()).chainId!==91342)throw Error('Wrong chain');
 const wallet=new ethers.Wallet(env.PRIVATE_KEY,provider);
 const artifact=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../apps/api/reality-contract.json')));
 const target=path.resolve(__dirname,'../deployments/giwa-reality.json');
 let record=fs.existsSync(target)?JSON.parse(fs.readFileSync(target)):null;
 if(!record){
  const factory=new ethers.ContractFactory(artifact.abi,artifact.bytecode,wallet),request=factory.getDeployTransaction();
  const gas=(await provider.estimateGas({...request,from:wallet.address})).mul(120).div(100),price=await provider.getGasPrice(),balance=await wallet.getBalance();
  const cap=ethers.utils.parseEther('0.0002');
  if(gas.mul(price).gt(cap)||gas.mul(price).gt(balance.div(2)))throw Error('Deployment fee exceeds safety cap or available balance');
  console.log(JSON.stringify({deployer:wallet.address,gasLimit:gas.toString(),maxExecutionFeeETH:ethers.utils.formatEther(gas.mul(price))}));
  if(!process.argv.includes('--send'))return;
  const contract=await factory.deploy({gasLimit:gas,gasPrice:price});
  record={chainId:91342,deployer:wallet.address,launchpad:contract.address,transactionHash:contract.deployTransaction.hash,status:'pending'};
  fs.writeFileSync(target,JSON.stringify(record,null,2));console.log('Deployment submitted',record.transactionHash);
 }
 const receipt=await provider.waitForTransaction(record.transactionHash,2,180000);
 if(!receipt||receipt.status!==1)throw Error('Deployment not confirmed successfully');
 if((await provider.getCode(record.launchpad)).toLowerCase()!==artifact.deployedBytecode.toLowerCase())throw Error('Deployed bytecode mismatch');
 record.status='verified';record.blockNumber=receipt.blockNumber;record.deployedAt=new Date().toISOString();
 fs.writeFileSync(target,JSON.stringify(record,null,2));console.log(JSON.stringify(record));
}
main().catch(()=>{console.error('Deployment stopped. Check wallet balance, network, or the saved deployment transaction. No credentials logged.');process.exitCode=1});
