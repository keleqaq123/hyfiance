const fs = require('node:fs'), path = require('node:path');
const {ethers} = require('ethers');
const dotenv = require('../../../apps/relayer/node_modules/dotenv');
const {compileFaucet} = require('./faucet-artifact.cjs');

async function main() {
  const file = process.argv[2], send = process.argv.includes('--send');
  if (!file || file.startsWith('--')) throw Error('Explicit private env file required');
  const env = dotenv.parse(fs.readFileSync(file));
  const provider = new ethers.providers.StaticJsonRpcProvider(env.GIWA_RPC_URL || 'https://sepolia-rpc.giwa.io', 91342);
  if (Number(BigInt(await provider.send('eth_chainId', []))) !== 91342) throw Error('Wrong chain');
  const wallet = new ethers.Wallet(env.PRIVATE_KEY, provider);
  if (!ethers.utils.isAddress(env.FAUCET_OPERATOR_ADDRESS || '') || env.FAUCET_OPERATOR_ADDRESS === ethers.constants.AddressZero) throw Error('Explicit official operator address required');
  const amount = ethers.utils.parseEther(env.FAUCET_CLAIM_ETH || '0.001');
  const daily = ethers.utils.parseEther(env.FAUCET_DAILY_ETH || '1');
  const cooldown = Number(env.FAUCET_COOLDOWN_SECONDS || 86400);
  const {faucet} = compileFaucet(), factory = new ethers.ContractFactory(faucet.abi, faucet.bytecode, wallet);
  const args = [wallet.address, env.FAUCET_OPERATOR_ADDRESS, amount, cooldown, daily];
  const directory = path.resolve(__dirname, '../artifacts');
  const pendingFile = path.join(directory, 'faucet-deployment-pending.json');
  const target = path.resolve(__dirname, '../deployments/giwa-faucet.json');
  let replacing = false;
  if (fs.existsSync(target)) {
    if (!process.argv.includes('--replace-paused-empty')) throw Error('Existing deployment record found; explicit paused-empty replacement required');
    const previous = JSON.parse(fs.readFileSync(target));
    const old = new ethers.Contract(previous.address, faucet.abi, provider);
    if (previous.chainId !== 91342 || (await old.owner()) !== wallet.address || !await old.paused() || !(await provider.getBalance(previous.address)).isZero()) throw Error('Previous faucet must be owner-controlled, paused and empty');
    replacing = true;
    console.log(JSON.stringify({replacementOf: previous.address,previousPaused: true,previousBalanceETH: '0'}));
    if (send) {
      const history = path.resolve(__dirname, '../deployments/history');
      fs.mkdirSync(history, {recursive: true});
      const archived = {...previous, retired: true, pausedOnRetirement: true, balanceETHOnRetirement: '0'};
      fs.writeFileSync(path.join(history, 'giwa-faucet-' + previous.blockNumber + '.json'), JSON.stringify(archived, null, 2) + '\n');
      if (fs.existsSync(pendingFile)) {
        const oldPending = JSON.parse(fs.readFileSync(pendingFile));
        if (oldPending.hash !== previous.transactionHash) throw Error('An unrelated pending deployment exists');
        fs.renameSync(pendingFile, path.join(directory, 'faucet-deployment-completed-' + previous.blockNumber + '.json'));
      }
      fs.mkdirSync(directory, {recursive: true});
      fs.renameSync(target, path.join(directory, 'faucet-retired-public-' + previous.blockNumber + '.json'));
    }
  }
  let record = replacing && !send ? null : fs.existsSync(pendingFile) ? JSON.parse(fs.readFileSync(pendingFile)) : null;
  const deployment = factory.getDeployTransaction(...args);
  if (record && (record.creationData !== deployment.data || record.owner !== wallet.address)) throw Error('Saved deployment differs; inspect before sending');
  if (!record) {
    const [estimate, price, balance, nonce] = await Promise.all([
      provider.estimateGas({...deployment, from: wallet.address}), provider.getGasPrice(), wallet.getBalance(), provider.getTransactionCount(wallet.address, 'pending'),
    ]);
    const gas = estimate.mul(125).div(100);
    const raw = await wallet.signTransaction({...deployment, chainId: 91342, nonce, gasLimit: gas, gasPrice: price, type: 0});
    const oracle = new ethers.Contract('0x420000000000000000000000000000000000000F', ['function getL1Fee(bytes) view returns(uint256)'], provider);
    const budget = gas.mul(price).add((await oracle.getL1Fee(raw)).mul(2));
    if (budget.gt(ethers.utils.parseEther('0.00001')) || budget.gt(balance.div(4))) throw Error('Deployment gas budget exceeded');
    console.log(JSON.stringify({chainId: 91342, owner: wallet.address, operator: env.FAUCET_OPERATOR_ADDRESS, claimETH: ethers.utils.formatEther(amount), cooldownSeconds: cooldown, dailyETH: ethers.utils.formatEther(daily), estimatedMaxFeeETH: ethers.utils.formatEther(budget), send}));
    if (!send) return;
    record = {owner: wallet.address, operator: env.FAUCET_OPERATOR_ADDRESS, creationData: deployment.data, raw, hash: ethers.utils.keccak256(raw), address: ethers.utils.getContractAddress({from: wallet.address, nonce})};
    fs.mkdirSync(directory, {recursive: true});fs.writeFileSync(pendingFile, JSON.stringify(record), {mode: 0o600});
  }
  if (!send) {console.log('An interrupted deployment exists; use --send to resume the same signed transaction.');return;}
  if (!await provider.getTransactionReceipt(record.hash)) {
    try {await provider.sendTransaction(record.raw);} catch {if (!await provider.getTransaction(record.hash)) throw Error('Broadcast uncertain; resume the saved transaction, never redeploy blindly');}
  }
  const receipt = await provider.waitForTransaction(record.hash, 2, 180000);
  if (!receipt || receipt.status !== 1) throw Error('Deployment failed/pending; inspect the saved transaction');
  const contract = new ethers.Contract(record.address, faucet.abi, provider);
  if ((await contract.owner()) !== wallet.address || (await contract.operator()).toLowerCase() !== record.operator.toLowerCase() || !(await contract.claimAmount()).eq(amount) || !(await contract.dailyLimit()).eq(daily) || !(await contract.claimCooldown()).eq(cooldown)) throw Error('Deployment verification failed');
  const publicRecord = {chainId: 91342, address: record.address, owner: record.owner, operator: record.operator, claimETH: ethers.utils.formatEther(amount), cooldownSeconds: cooldown, dailyETH: ethers.utils.formatEther(daily), transactionHash: record.hash, blockNumber: receipt.blockNumber, funded: false};
  fs.mkdirSync(path.dirname(target), {recursive: true});fs.writeFileSync(target, JSON.stringify(publicRecord, null, 2) + '\n');
  console.log(JSON.stringify(publicRecord));
}
main().catch(() => {console.error('Faucet deployment stopped. Check explicit configuration, saved transaction and gas budget. Credentials were not logged.');process.exitCode = 1;});
