const fs = require('node:fs');
const path = require('node:path');
const { ethers } = require('../../swap/node_modules/ethers');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'out');
const DEPLOYMENTS = path.join(ROOT, 'deployments');
const FRONTEND_CONFIG = path.resolve(ROOT, '../../apps/web/src/custos/protocolDeployments.json');

const ZERO = ethers.constants.AddressZero;
const ZERO_BYTES = '0x';
const DECIMALS = 18;
const INITIAL_BRIDGE_SUPPLY = ethers.utils.parseUnits('1000000', DECIMALS);
const DEMO_LAUNCH_SUPPLY = ethers.utils.parseUnits('1000000', DECIMALS);
const DEMO_VIRTUAL_RESERVE = ethers.utils.parseEther('1');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function artifact(contractFile, contractName) {
  const file = path.join(OUT, contractFile, `${contractName}.json`);
  if (!fs.existsSync(file)) throw new Error(`Missing artifact ${file}; run forge build first`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function networkConfig(label, rpc, chainId) {
  return { label, rpc, chainId: Number(chainId) };
}

async function deployContract(wallet, contractFile, contractName, args) {
  const data = artifact(contractFile, contractName);
  const factory = new ethers.ContractFactory(data.abi, data.bytecode, wallet);
  const contract = await factory.deploy(...args);
  await contract.deployTransaction.wait();
  console.log(`${contractName} ${contract.address}`);
  return contract;
}

async function providerFor(config) {
  const provider = new ethers.providers.JsonRpcProvider(config.rpc, {
    name: config.label,
    chainId: config.chainId,
  });
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== config.chainId) {
    throw new Error(`${config.label} returned chain ${network.chainId}, expected ${config.chainId}`);
  }
  return provider;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function deployNetwork(config, privateKey) {
  console.log(`\nDeploying ${config.label} (${config.chainId})`);
  const provider = await providerFor(config);
  const wallet = new ethers.Wallet(privateKey, provider);
  const balance = await wallet.getBalance();
  console.log(`deployer ${wallet.address} · balance ${ethers.utils.formatEther(balance)} native`);

  const launchpad = await deployContract(wallet, 'CustosLaunchpad.sol', 'CustosLaunchpad', [wallet.address]);
  const bridge = await deployContract(wallet, 'CustosBridge.sol', 'CustosBridge', [wallet.address, wallet.address, config.chainId]);
  const bridgeToken = await deployContract(wallet, 'CustosBridge.sol', 'CustosBridgeToken', [
    'Custos Bridge Dollar',
    'cUSD',
    INITIAL_BRIDGE_SUPPLY,
    wallet.address,
  ]);

  await (await bridgeToken.setBridge(bridge.address)).wait();

  const record = {
    network: config.label,
    chainId: config.chainId,
    rpc: config.rpc,
    deployedAt: new Date().toISOString(),
    deployer: wallet.address,
    contracts: {
      launchpad: launchpad.address,
      bridge: bridge.address,
      bridgeToken: bridgeToken.address,
    },
    counterparty: null,
    demo: {},
  };
  writeJson(path.join(DEPLOYMENTS, `${config.label}.json`), record);

  return { config, provider, wallet, launchpad, bridge, bridgeToken, record };
}

function parseMessageId(receipt, bridge) {
  for (const event of receipt.events || []) {
    if (event.address.toLowerCase() !== bridge.address.toLowerCase()) continue;
    if (event.event === 'MessageSent' && event.args) return { messageId: event.args.messageId, nonce: event.args.nonce };
  }
  throw new Error('MessageSent event was not found');
}

async function configurePair(source, target) {
  await (await source.bridge.setTrustedRemote(target.config.chainId, target.bridge.address)).wait();
  await (await source.bridge.setTokenPair(target.config.chainId, source.bridgeToken.address, target.bridgeToken.address)).wait();
  // The same registry is used to validate both outbound and inbound
  // messages, so keep the reverse token direction available for execution.
  await (await source.bridge.setTokenPair(target.config.chainId, target.bridgeToken.address, source.bridgeToken.address)).wait();
  source.record.counterparty = {
    chainId: target.config.chainId,
    network: target.config.label,
    bridge: target.bridge.address,
    bridgeToken: target.bridgeToken.address,
  };
  writeJson(path.join(DEPLOYMENTS, `${source.config.label}.json`), source.record);
}

async function createDemoLaunch(deployment, suffix) {
  // Deployment may take several blocks on a local node. Leave a short buffer
  // so the demo launch is not already in the past when its tx is mined.
  const now = Math.floor(Date.now() / 1000) + 120;
  const tx = await deployment.launchpad.createLaunch(
    `Custos ${suffix} Launch`,
    suffix === 'Local' ? 'CLOCAL' : 'CDEMO',
    `custos://demo/${deployment.config.label}`,
    DEMO_LAUNCH_SUPPLY,
    DEMO_VIRTUAL_RESERVE,
    now,
    now + 30 * 24 * 60 * 60,
  );
  const receipt = await tx.wait();
  const event = (receipt.events || []).find((item) => item.event === 'LaunchCreated');
  deployment.record.demo.launchId = event ? event.args.launchId.toString() : '1';
  deployment.record.demo.launchTx = receipt.transactionHash;
  writeJson(path.join(DEPLOYMENTS, `${deployment.config.label}.json`), deployment.record);
}

async function seedBridge(source, target) {
  const amount = ethers.utils.parseUnits('100', DECIMALS);
  const tx = await source.bridge.bridgeOut(
    source.bridgeToken.address,
    target.config.chainId,
    target.bridge.address,
    source.wallet.address,
    amount,
    ZERO_BYTES,
  );
  const receipt = await tx.wait();
  const sent = parseMessageId(receipt, source.bridge);
  const messageId = sent.messageId;
  const executeTx = await target.bridge.executeMessage(
    messageId,
    source.config.chainId,
    source.bridge.address,
    source.bridgeToken.address,
    source.wallet.address,
    amount,
    sent.nonce,
    ZERO_BYTES,
  );
  const executeReceipt = await executeTx.wait();
  source.record.demo.bridgeMessage = messageId;
  source.record.demo.bridgeTx = receipt.transactionHash;
  source.record.demo.executeTx = executeReceipt.transactionHash;
  writeJson(path.join(DEPLOYMENTS, `${source.config.label}.json`), source.record);
}

function updateFrontend(records) {
  let current = {};
  if (fs.existsSync(FRONTEND_CONFIG)) current = JSON.parse(fs.readFileSync(FRONTEND_CONFIG, 'utf8'));
  for (const record of records) {
    current[String(record.chainId)] = record;
  }
  writeJson(FRONTEND_CONFIG, current);
}

async function main() {
  const privateKey = required('DEPLOYER_PRIVATE_KEY');
  const a = networkConfig(
    process.env.CHAIN_A_NAME || 'local-a',
    required('CHAIN_A_RPC'),
    required('CHAIN_A_ID'),
  );
  const b = networkConfig(
    process.env.CHAIN_B_NAME || 'local-b',
    required('CHAIN_B_RPC'),
    required('CHAIN_B_ID'),
  );

  const source = await deployNetwork(a, privateKey);
  const target = await deployNetwork(b, privateKey);
  await configurePair(source, target);
  await configurePair(target, source);

  if (process.env.SEED_DEMO !== '0') {
    await createDemoLaunch(source, a.label.includes('local') ? 'Local' : 'Bridge');
    await createDemoLaunch(target, b.label.includes('local') ? 'Local' : 'Bridge');
    await seedBridge(source, target);
  }

  updateFrontend([source.record, target.record]);
  writeJson(path.join(DEPLOYMENTS, `${a.label}--${b.label}.json`), {
    deployedAt: new Date().toISOString(),
    source: source.record,
    target: target.record,
  });
  const historyId = new Date().toISOString().replace(/[:.]/g, '-');
  writeJson(path.join(DEPLOYMENTS, 'history', `${historyId}--${a.label}--${b.label}.json`), {
    deployedAt: new Date().toISOString(),
    source: source.record,
    target: target.record,
  });

  console.log('\nProtocol deployment complete');
  console.log(JSON.stringify({
    source: source.record.contracts,
    target: target.record.contracts,
    demo: source.record.demo,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
