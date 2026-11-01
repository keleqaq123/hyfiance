const fs=require('fs'),path=require('path'),{ethers}=require('ethers');
const oracle='0x2880aB155794e7179c9eE2e38200202908C17B43';
async function main(){
 const file=process.argv[2];if(!file)throw Error('Local env file required');
 const env={};for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z_]+)\s*=\s*(.*)$/);if(m)env[m[1]]=m[2].trim().replace(/^['"]|['"]$/g,'');}
 const p=new ethers.providers.JsonRpcProvider('https://sepolia-rpc.giwa.io');if((await p.getNetwork()).chainId!==91342)throw Error('Wrong chain');
 if((await p.getCode(oracle))==='0x')throw Error('Oracle missing');
 const wallet=new ethers.Wallet(env.PRIVATE_KEY,p),a=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../apps/web/src/custos/cfi-artifact.json'))),factory=new ethers.ContractFactory(a.abi,a.bytecode,wallet),target=path.resolve(__dirname,'../deployments/giwa-cfi.json');
 let record=fs.existsSync(target)?JSON.parse(fs.readFileSync(target)):null;
 if(!record){const gas=(await p.estimateGas({...factory.getDeployTransaction(oracle),from:wallet.address})).mul(120).div(100),price=await p.getGasPrice();if(gas.mul(price).gt(ethers.utils.parseEther('0.0002'))||gas.mul(price).gt((await wallet.getBalance()).div(2)))throw Error('Fee or balance limit');console.log('Estimated execution fee ETH',ethers.utils.formatEther(gas.mul(price)));if(!process.argv.includes('--send'))return;const c=await factory.deploy(oracle,{gasLimit:gas,gasPrice:price});record={chainId:91342,deployer:wallet.address,vault:c.address,cfi:c.address,pyth:oracle,transactionHash:c.deployTransaction.hash,status:'pending'};fs.writeFileSync(target,JSON.stringify(record,null,2));console.log('CFI deployment submitted',record.transactionHash);}
 const receipt=await p.waitForTransaction(record.transactionHash,2,180000);if(!receipt||receipt.status!==1)throw Error('Deployment failed');
 const tx=await p.getTransaction(record.transactionHash);if(tx.data.toLowerCase()!==factory.getDeployTransaction(oracle).data.toLowerCase()||tx.from.toLowerCase()!==record.deployer.toLowerCase())throw Error('Creation bytecode mismatch');
 const contract=new ethers.Contract(record.vault,a.abi,p);if((await contract.pyth()).toLowerCase()!==oracle.toLowerCase()||await contract.symbol()!=='CFI')throw Error('Contract configuration mismatch');
 record.status='verified';record.blockNumber=receipt.blockNumber;record.runtimeCodeHash=ethers.utils.keccak256(await p.getCode(record.vault));record.deployedAt=new Date().toISOString();fs.writeFileSync(target,JSON.stringify(record,null,2));console.log(JSON.stringify(record));
}
main().catch(()=>{console.error('CFI deployment stopped. Check the saved transaction, chain and wallet balance. Credentials were not logged.');process.exitCode=1});
