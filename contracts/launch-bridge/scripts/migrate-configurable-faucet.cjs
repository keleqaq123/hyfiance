const fs = require('node:fs');
const path = require('node:path');
const {ethers} = require('ethers');
const {compileConfigurableFaucet} = require('./configurable-faucet-artifact.cjs');

const RPC = 'https://sepolia-rpc.giwa.io';
const CHAIN_ID = 91342;
const oldAbi = [
  'function owner() view returns (address)',
  'function paused() view returns (bool)',
  'function operator() view returns (address)',
  'function setPaused(bool) external',
  'function recoverFunds(address payable,uint256) external',
];

function readInput() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (!input.privateKey || !ethers.utils.isAddress(input.oldAddress) || !ethers.utils.isAddress(input.operator)) throw Error('Invalid migration input');
  return input;
}

const txs = {};
async function wait(label, tx) {
  const receipt = await tx.wait(2);
  if (!receipt || receipt.status !== 1) throw Error(label + ' failed');
  txs[label] = {hash: tx.hash, blockNumber: receipt.blockNumber};
  console.log(JSON.stringify({label, hash: tx.hash, blockNumber: receipt.blockNumber}));
  return receipt;
}

async function main() {
  const input = readInput();
  const provider = new ethers.providers.StaticJsonRpcProvider(RPC, CHAIN_ID);
  const wallet = new ethers.Wallet(input.privateKey, provider);
  if ((await provider.getNetwork()).chainId !== CHAIN_ID) throw Error('Wrong chain');
  const old = new ethers.Contract(input.oldAddress, oldAbi, wallet);
  if ((await old.owner()).toLowerCase() !== wallet.address.toLowerCase()) throw Error('Owner key does not match old faucet');
  const oldBalance = await provider.getBalance(input.oldAddress);
  if (oldBalance.isZero()) throw Error('Old faucet is empty');
  if (!(await old.paused())) await wait('pause-old', await old.setPaused(true));
  if (!(await old.paused())) throw Error('Old faucet did not pause');
  await wait('recover-old', await old.recoverFunds(wallet.address, oldBalance));
  if (!(await provider.getBalance(input.oldAddress)).isZero()) throw Error('Old faucet recovery incomplete');

  const {faucet} = compileConfigurableFaucet();
  const factory = new ethers.ContractFactory(faucet.abi, faucet.bytecode, wallet);
  const amount = ethers.utils.parseEther(input.claimETH || '0.001');
  const cooldown = ethers.BigNumber.from(input.cooldownSeconds || '0');
  const daily = ethers.utils.parseEther(input.dailyETH || '100');
  const deployment = factory.getDeployTransaction(wallet.address, input.operator, amount, cooldown, daily);
  const gas = (await provider.estimateGas({...deployment, from: wallet.address})).mul(125).div(100);
  const price = await provider.getGasPrice();
  const balance = await wallet.getBalance();
  if (gas.mul(price).gt(balance.div(4))) throw Error('Deployment gas exceeds safety budget');
  const deployed = await factory.deploy(wallet.address, input.operator, amount, cooldown, daily, {gasLimit: gas, gasPrice: price});
  const receipt = await wait('deploy-new', deployed.deployTransaction);
  const next = new ethers.Contract(deployed.address, faucet.abi, wallet);
  if ((await next.owner()).toLowerCase() !== wallet.address.toLowerCase() || (await next.operator()).toLowerCase() !== input.operator.toLowerCase()) throw Error('New faucet ownership mismatch');
  await wait('fund-new', await wallet.sendTransaction({to: next.address, value: oldBalance}));
  if (!(await provider.getBalance(next.address)).eq(oldBalance)) throw Error('New faucet funding mismatch');

  await wait('pause-new-setters', await next.setPaused(true));
  await wait('set-amount-test', await next.setClaimAmount(amount.mul(2)));
  await wait('set-cooldown-test', await next.setClaimCooldown(3600));
  await wait('set-daily-test', await next.setDailyLimit(daily.mul(2)));
  await wait('restore-amount', await next.setClaimAmount(amount));
  await wait('restore-cooldown', await next.setClaimCooldown(cooldown));
  await wait('restore-daily', await next.setDailyLimit(daily));
  await wait('activate-new', await next.setPaused(false));
  const record = {
    chainId: CHAIN_ID, address: next.address, owner: wallet.address, operator: input.operator,
    claimETH: ethers.utils.formatEther(amount), cooldownSeconds: cooldown.toNumber(), dailyETH: ethers.utils.formatEther(daily),
    transactionHash: deployed.deployTransaction.hash, blockNumber: receipt.blockNumber, fundedETH: ethers.utils.formatEther(oldBalance),
    replaced: input.oldAddress, oldRecoveryBalanceETH: ethers.utils.formatEther(oldBalance),
    setterTests: {amount: 'passed', cooldown: 'passed', dailyLimit: 'passed'}, transactions: txs,
  };
  fs.writeFileSync(path.resolve(__dirname, '../deployments/giwa-faucet-configurable.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify(record));
}

main().catch(error => {console.error('Configurable faucet migration stopped: ' + (error.message || 'unknown error')); process.exitCode = 1;});
