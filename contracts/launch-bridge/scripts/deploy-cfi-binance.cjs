const fs = require('node:fs');
const path = require('node:path');
const {ethers} = require('ethers');
const dotenv = require('../../../apps/relayer/node_modules/dotenv');

async function main() {
  const args = process.argv.slice(2), send = args.includes('--send');
  const redeploy = args.includes('--redeploy'), projectSigner = args.includes('--use-project-signer');
  const files = args.filter(value => !value.startsWith('--'));
  if (!files[0] || (!projectSigner && !files[1])) throw Error('Deployer env and backend env paths required');
  const deploy = dotenv.parse(fs.readFileSync(files[0]));
  const backend = projectSigner ? null : dotenv.parse(fs.readFileSync(files[1]));
  const provider = new ethers.providers.StaticJsonRpcProvider(deploy.GIWA_RPC_URL || 'https://sepolia-rpc.giwa.io', 91342);
  if ((await provider.getNetwork()).chainId !== 91342) throw Error('Wrong chain');
  const wallet = new ethers.Wallet(deploy.PRIVATE_KEY, provider);
  const signer = projectSigner ? wallet.address : new ethers.Wallet(backend.CFI_QUOTE_SIGNER_KEY).address;
  const artifact = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../apps/web/src/custos/cfi-binance-artifact.json')));
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const target = path.resolve(__dirname, '../deployments/giwa-cfi-binance.json');
  const history = path.resolve(__dirname, '../deployments/history');
  const attemptFile = path.join(history, 'cfi-redeployment-pending.json');
  const active = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target)) : null;
  // Resume an interrupted replacement instead of sending a second deployment.
  let record = redeploy
    ? (fs.existsSync(attemptFile) ? JSON.parse(fs.readFileSync(attemptFile)) : null)
    : active;
  const previous = active?.vault || '0xE6ad5FE166edeA0B949180168E928Ee6AA9B7137';

  if (!record) {
    const old = new ethers.Contract(previous, ['function totalPrincipal() view returns(uint256)', 'function totalSupply() view returns(uint256)'], provider);
    if (!(await old.totalPrincipal()).isZero() || !(await old.totalSupply()).isZero()) {
      throw Error('Previous vault has positions; preserve its redemption UI before switching');
    }
    const deployment = factory.getDeployTransaction(signer);
    const [estimate, price, balance, nonce] = await Promise.all([
      provider.estimateGas({...deployment, from: wallet.address}), provider.getGasPrice(),
      wallet.getBalance(), provider.getTransactionCount(wallet.address, 'pending')
    ]);
    const gas = estimate.mul(125).div(100);
    const oracle = new ethers.Contract('0x420000000000000000000000000000000000000F', ['function getL1Fee(bytes) view returns(uint256)'], provider);
    const unsigned = ethers.utils.serializeTransaction({...deployment, chainId:91342, nonce, gasLimit:gas, gasPrice:price, type:0});
    const l1Fee = await oracle.getL1Fee(unsigned);
    const budget = gas.mul(price).add(l1Fee.mul(2));
    // Bound testnet spend and preserve gas for the existing Relayer.
    if (budget.gt(ethers.utils.parseEther('0.00001')) || budget.gt(balance.div(4))) throw Error('Fee or balance limit');
    console.log(JSON.stringify({chainId:91342, deployer:wallet.address, quoteSigner:signer, previousVault:previous, estimatedMaxFeeETH:ethers.utils.formatEther(budget), balanceETH:ethers.utils.formatEther(balance), send}));
    if (!send) return;
    // Recheck active positions immediately before submission.
    if (!(await old.totalPrincipal()).isZero() || !(await old.totalSupply()).isZero()) throw Error('Previous vault now has positions');
    const contract = await factory.deploy(signer, {gasLimit:gas, gasPrice:price});
    record = {chainId:91342, deployer:wallet.address, vault:contract.address, cfi:contract.address, quoteSigner:signer, priceSource:'Binance ETHUSDT, operator-signed', previousVault:previous, transactionHash:contract.deployTransaction.hash, status:'pending'};
    fs.mkdirSync(history, {recursive:true});
    fs.writeFileSync(redeploy ? attemptFile : target, JSON.stringify(record,null,2)+'\n');
    console.log('CFI deployment submitted', record.transactionHash);
  }
  const receipt = await provider.waitForTransaction(record.transactionHash, 2, 180000);
  if (!receipt || receipt.status !== 1) throw Error('Deployment failed or pending; resume from saved record');
  const tx = await provider.getTransaction(record.transactionHash);
  if (tx.data.toLowerCase() !== factory.getDeployTransaction(signer).data.toLowerCase() || tx.from.toLowerCase() !== record.deployer.toLowerCase()) throw Error('Creation bytecode mismatch');
  const contract = new ethers.Contract(record.vault, artifact.abi, provider);
  if ((await contract.quoteSigner()).toLowerCase() !== signer.toLowerCase() || await contract.symbol() !== 'CFI' || !(await contract.totalPrincipal()).isZero()) throw Error('Contract configuration mismatch');
  record.status='verified';
  record.blockNumber=receipt.blockNumber;
  record.runtimeCodeHash=ethers.utils.keccak256(await provider.getCode(record.vault));
  record.deployedAt=new Date().toISOString();
  // ethers v5 drops OP Stack-specific receipt fields; query the raw receipt.
  const rawReceipt = await provider.send('eth_getTransactionReceipt', [record.transactionHash]);
  record.deploymentFeeETH=ethers.utils.formatEther(receipt.gasUsed.mul(receipt.effectiveGasPrice).add(rawReceipt.l1Fee || 0));
  if (redeploy && active && active.vault.toLowerCase() !== record.vault.toLowerCase()) {
    fs.writeFileSync(path.join(history, 'cfi-before-'+record.blockNumber+'.json'), JSON.stringify(active,null,2)+'\n');
  }
  fs.writeFileSync(path.join(history, 'cfi-deployment-'+record.blockNumber+'.json'), JSON.stringify(record,null,2)+'\n');
  fs.writeFileSync(target, JSON.stringify(record,null,2)+'\n');
  // Retain the confirmed attempt as a durable idempotency record.
  if (redeploy) fs.writeFileSync(attemptFile, JSON.stringify(record,null,2)+'\n');
  console.log(JSON.stringify(record));
}
main().catch(() => {
  console.error('CFI deployment stopped. Check the saved transaction, chain and wallet balance. Credentials were not logged.');
  process.exitCode=1;
});
