const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ethers } = require('ethers');
const root = path.resolve(__dirname, '..');
const net = require('../networks/elysium-testnet.json');
const features = require('../networks/elysium-features.json');
const target = path.join(root, 'deployments/elysium-testnet.json');
function validateChain(value) {
  if (Number(value) !== 99801) throw Error(`Refusing chain ${value}; Elysium Testnet 99801 only`);
}
function load(file) { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
function save(record) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(record, null, 2) + '\n');
}
async function main() {
  const send = process.argv.includes('--send');
  const credentials = load('.secrets/elysium-testnet.json');
  validateChain(credentials.chainId);
  const rpc = process.env.ELYSIUM_RPC_URL || net.rpc;
  const provider = new ethers.providers.JsonRpcProvider({url: rpc, timeout: 20000, headers: {'User-Agent': 'hyfiance-testnet-check/1.0'}});
  validateChain(parseInt(await provider.send('eth_chainId', []), 16));
  const wallet = new ethers.Wallet(credentials.privateKey, provider);
  if (wallet.address !== credentials.address) throw Error('Deployer identity mismatch');
  const balance = await wallet.getBalance();
  let record = fs.existsSync(target) ? load('deployments/elysium-testnet.json') : {chainId: net.chainId, contracts: {}};
  validateChain(record.chainId);
  record.modules ||= {};
  Object.assign(record, {deployer: wallet.address, rpc, checkedAt: new Date().toISOString(), balanceWei: balance.toString()});
  if (balance.isZero()) {
    record.status = 'awaiting-funding'; save(record);
    console.log(JSON.stringify({status: record.status, address: wallet.address, chainId: net.chainId, balanceHYPE: '0', faucet: net.faucet}));
    if (send) process.exitCode = 2;
    return;
  }
  console.log(JSON.stringify({status: 'funded', address: wallet.address, balanceHYPE: ethers.utils.formatEther(balance), send}));
  if (!send) return;
  for (const directory of ['contracts/swap/artifacts/contracts','contracts/nft/artifacts/contracts',...(features.syntheticMarkets?['contracts/markets/artifacts/contracts']:[])]) {
    if (!fs.existsSync(path.join(root,directory))) throw Error('Compile contracts first: npm run elysium:compile');
  }
  // Refuse an unbounded or accidental large testnet deployment spend.
  const starting = balance;
  async function budget() {
    validateChain(parseInt(await provider.send('eth_chainId', []),16));
    if (starting.sub(await wallet.getBalance()).gt(ethers.utils.parseEther('0.05'))) throw Error('Testnet deployment spend exceeded 0.05 HYPE');
  }
  const childEnv = {...process.env, ELYSIUM_PRIVATE_KEY: credentials.privateKey, ELYSIUM_RPC_URL: rpc};
  async function module(name, run) {
    if (record.modules[name] === 'confirmed') return;
    if (['deploying','needs-review'].includes(record.modules[name])) throw Error(`${name} was interrupted. Inspect its transactions before retrying; automatic redeployment is disabled.`);
    await budget(); record.modules[name] = 'deploying'; record.status = 'deploying'; save(record);
    try { await run(); record.modules[name] = 'confirmed'; save(record); }
    catch (e) { record.modules[name] = 'needs-review'; record.status = 'needs-review'; save(record); throw e; }
  }
  function hardhat(project, script) {
    const cwd = path.join(root, 'contracts', project);
    const result = spawnSync(process.execPath, [path.join(cwd,'node_modules/hardhat/internal/cli/cli.js'), 'run', '--no-compile', script, '--network', 'elysiumTestnet'], {cwd, env: childEnv, stdio: 'inherit', timeout: 600000});
    if (result.status !== 0) throw Error(`${project} deployment failed; inspect saved chain receipts`);
  }
  await module('swap', async () => {
    hardhat('swap','scripts/deploy-elysium-uniswap.js');
    const result = load('contracts/swap/deployments/elysium-testnet/main-contracts.json');
    validateChain(result.chainId); Object.assign(record.contracts, result.contracts);
    record.initCodeHash = result.initCodeHash;
  });
  if (features.syntheticMarkets) await module('markets', async () => {
    hardhat('markets','scripts/deploy-elysium-markets.js');
    const result = load('contracts/markets/deployments/elysium-testnet.json');
    validateChain(result.network.chainId);
    Object.assign(record.contracts, result.contracts);
    record.marketOracle = 'operator-managed test price oracle; synthetic test assets only';
  });
  else {record.modules.markets='disabled'; save(record);}
  async function direct(name, artifact, args = []) {
    // Persist the creation transaction before waiting. The module guard prevents
    // duplicate sends if this process is stopped between broadcast and receipt.
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
    const request = factory.getDeployTransaction(...args);
    const gas = (await wallet.estimateGas(request)).mul(125).div(100);
    const gasPrice = (await provider.getGasPrice()).mul(125).div(100);
    if (gas.mul(gasPrice).gt(ethers.utils.parseEther('0.01'))) throw Error(`${name} deployment estimate exceeds 0.01 test HYPE`);
    const contract = await factory.deploy(...args, {gasLimit: gas, gasPrice});
    record.transactions ||= {}; record.transactions[name] = contract.deployTransaction.hash; save(record);
    const receipt = await contract.deployTransaction.wait(1);
    if (receipt.status !== 1 || (await provider.getCode(contract.address)) === '0x') throw Error(`${name} receipt/code verification failed`);
    record.contracts[name] = contract.address;
    record.receipts ||= {}; record.receipts[name] = {hash: receipt.transactionHash, blockNumber: receipt.blockNumber};
    return contract;
  }
  await module('launchpad', () => direct('launchpad', load('apps/api/reality-contract.json')));
  await module('cfi', async () => {
    await direct('cfi', load('apps/web/src/custos/cfi-binance-artifact.json'), [credentials.quoteSignerAddress]);
    record.cfiStartBlock = record.receipts.cfi.blockNumber;
  });
  await module('nft', () => direct('nft', load('contracts/nft/artifacts/contracts/CustosKBW2026.sol/CustosKBW2026.json'), [process.env.NFT_METADATA_URI || 'http://127.0.0.1:3001/assets/nft/kbw2026-metadata.json']));
  // Every active address must actually have code on the target chain.
  for (const [name,address] of Object.entries(record.contracts)) {
    if (ethers.utils.isAddress(address) && (await provider.getCode(address)) === '0x') throw Error(`${name} has no code on Elysium`);
  }
  record.status = 'deployed'; record.completedAt = new Date().toISOString(); save(record);
  require('./elysium-configure.cjs');
  console.log('Elysium deployment confirmed; rebuild SDK and frontend, then run the smoke checks.');
}
module.exports = {validateChain};
if (require.main === module) main().catch(error => { console.error(error.reason || error.message); process.exitCode = 1; });
