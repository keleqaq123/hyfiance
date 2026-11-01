const fs=require('node:fs'),path=require('node:path'),{Wallet}=require('ethers');
const root=path.resolve(__dirname,'..'),file=path.join(root,'.secrets/elysium-testnet.json');
fs.mkdirSync(path.dirname(file),{recursive:true});
if(!fs.existsSync(file)){
 const deployer=Wallet.createRandom(),quote=Wallet.createRandom();
 fs.writeFileSync(file,JSON.stringify({chainId:99801,address:deployer.address,privateKey:deployer.privateKey,quoteSignerAddress:quote.address,quoteSignerKey:quote.privateKey},null,2)+'\n',{flag:'wx',mode:0o600});
}
const record=JSON.parse(fs.readFileSync(file,'utf8'));
if(record.chainId!==99801||new Wallet(record.privateKey).address!==record.address)throw Error('Unexpected test-wallet file; not overwritten');
console.log(JSON.stringify({chainId:99801,address:record.address,faucet:'https://elysium.kinetiq.xyz/testnet-faucet'}));
