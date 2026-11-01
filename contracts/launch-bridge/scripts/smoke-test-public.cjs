const fs = require('node:fs');
const path = require('node:path');
const { ethers } = require('../../swap/node_modules/ethers');

const ROOT = path.resolve(__dirname, '..');
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const sourceFile = process.env.CHAIN_A_NAME || 'GIWA Sepolia';
const targetFile = process.env.CHAIN_B_NAME || 'Ethereum Sepolia';
const sourceRpc = process.env.CHAIN_A_RPC || 'https://sepolia-rpc.giwa.io';
const targetRpc = process.env.CHAIN_B_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';

if (!PRIVATE_KEY) throw new Error('DEPLOYER_PRIVATE_KEY is required');

const launchArtifact = JSON.parse(fs.readFileSync(path.join(ROOT, 'out/CustosLaunchpad.sol/CustosLaunchpad.json'), 'utf8'));
const bridgeArtifact = JSON.parse(fs.readFileSync(path.join(ROOT, 'out/CustosBridge.sol/CustosBridge.json'), 'utf8'));
const tokenArtifact = JSON.parse(fs.readFileSync(path.join(ROOT, 'out/CustosBridge.sol/CustosBridgeToken.json'), 'utf8'));

function recordFile(name) {
  return path.join(ROOT, 'deployments', `${name}.json`);
}

function assert(condition, message) {
  if (!condition) throw new Error(`PUBLIC SMOKE ASSERTION FAILED: ${message}`);
}

async function expectRevert(promise, label) {
  try {
    await promise;
    throw new Error(`${label} did not revert`);
  } catch (error) {
    if (String(error.message || error).includes('did not revert')) throw error;
    console.log(`ok ${label} rejected as expected`);
  }
}

function launchContract(address, signer) {
  return new ethers.Contract(address, launchArtifact.abi, signer);
}

function bridgeContract(address, signer) {
  return new ethers.Contract(address, bridgeArtifact.abi, signer);
}

function bridgeToken(address, signer) {
  return new ethers.Contract(address, tokenArtifact.abi, signer);
}

function launchIdFrom(receipt) {
  const event = (receipt.events || []).find((item) => item.event === 'LaunchCreated');
  if (!event) throw new Error('LaunchCreated event was not found');
  return event.args.launchId;
}

function messageFrom(receipt) {
  const event = (receipt.events || []).find((item) => item.event === 'MessageSent');
  if (!event) throw new Error('MessageSent event was not found');
  return event;
}

async function main() {
  const source = JSON.parse(fs.readFileSync(recordFile(sourceFile), 'utf8'));
  const target = JSON.parse(fs.readFileSync(recordFile(targetFile), 'utf8'));
  const providerA = new ethers.providers.JsonRpcProvider(sourceRpc, { name: source.network, chainId: source.chainId });
  const providerB = new ethers.providers.JsonRpcProvider(targetRpc, { name: target.network, chainId: target.chainId });
  const [networkA, networkB] = await Promise.all([providerA.getNetwork(), providerB.getNetwork()]);
  assert(Number(networkA.chainId) === source.chainId, `source chain is ${networkA.chainId}, expected ${source.chainId}`);
  assert(Number(networkB.chainId) === target.chainId, `target chain is ${networkB.chainId}, expected ${target.chainId}`);

  const adminA = new ethers.Wallet(PRIVATE_KEY, providerA);
  const adminB = new ethers.Wallet(PRIVATE_KEY, providerB);
  const giwaGasPrice = await providerA.getGasPrice();
  const transactions = {};
  // Use the funded deployer as the buyer as well. This keeps the smoke test
  // deterministic and avoids spending a second faucet allocation on a
  // temporary EOA, while still exercising both launch lanes.
  const user = adminA;
  const userA = adminA;
  const userB = adminB;
  console.log(`public smoke buyer: ${user.address}`);

  const launchpadA = launchContract(source.contracts.launchpad, adminA);
  const publicTx = await launchpadA.createLaunch(
    'Public Network Smoke',
    'PNSMOKE',
    'custos://public-smoke/open',
    ethers.utils.parseUnits('1000000', 18),
    ethers.utils.parseEther('1'),
    0,
    0,
    { gasLimit: 1200000, gasPrice: giwaGasPrice },
  );
  const publicReceipt = await publicTx.wait();
  transactions.publicLaunch = publicReceipt.transactionHash;
  const publicId = launchIdFrom(publicReceipt);
  const publicCreated = (publicReceipt.events || []).find((item) => item.event === 'LaunchCreated');
  const publicToken = bridgeToken(publicCreated.args.token, userA);
  const publicBefore = await publicToken.balanceOf(user.address);
  const publicQuote = ethers.utils.parseEther('0.00001');
  transactions.publicBuy = (await (await launchpadA.connect(userA).buy(publicId, 0, { value: publicQuote, gasPrice: giwaGasPrice })).wait()).transactionHash;
  const publicAfter = await publicToken.balanceOf(user.address);
  assert(publicAfter.gt(publicBefore), 'public launch buyer received tokens');
  console.log(`ok permissionless launch buy: ${ethers.utils.formatUnits(publicAfter.sub(publicBefore), 18)} PNSMOKE`);

  const curatedTx = await launchpadA.createCuratedLaunch(
    'Curated RWA Network Smoke',
    'RNSMOKE',
    'custos://public-smoke/curated-rwa',
    ethers.utils.parseUnits('500000', 18),
    ethers.utils.parseEther('1'),
    0,
    0,
    { gasLimit: 1200000, gasPrice: giwaGasPrice },
  );
  const curatedReceipt = await curatedTx.wait();
  transactions.curatedLaunch = curatedReceipt.transactionHash;
  const curatedId = launchIdFrom(curatedReceipt);
  await (await launchpadA.setWhitelist(curatedId, user.address, true, { gasPrice: giwaGasPrice })).wait();
  const curatedCreated = (curatedReceipt.events || []).find((item) => item.event === 'LaunchCreated');
  const curatedToken = bridgeToken(curatedCreated.args.token, userA);
  const curatedBefore = await curatedToken.balanceOf(user.address);
  const curatedQuote = ethers.utils.parseEther('0.000005');
  transactions.curatedBuy = (await (await launchpadA.connect(userA).buy(curatedId, 0, { value: curatedQuote, gasPrice: giwaGasPrice })).wait()).transactionHash;
  const curatedAfter = await curatedToken.balanceOf(user.address);
  assert(curatedAfter.gt(curatedBefore), 'curated whitelist buyer received tokens');
  console.log(`ok curated RWA launch buy: ${ethers.utils.formatUnits(curatedAfter.sub(curatedBefore), 18)} RNSMOKE`);

  const bridgeA = bridgeContract(source.contracts.bridge, adminA);
  const bridgeB = bridgeContract(target.contracts.bridge, adminB);
  const tokenA = bridgeToken(source.contracts.bridgeToken, adminA);
  const tokenB = bridgeToken(target.contracts.bridgeToken, adminB);
  const amountA = ethers.utils.parseUnits('7', 18);
  const beforeA = await tokenA.balanceOf(adminA.address);
  const beforeB = await tokenB.balanceOf(adminB.address);
  const outboundA = await bridgeA.bridgeOut(source.contracts.bridgeToken, target.chainId, target.contracts.bridge, adminB.address, amountA, '0x', { gasPrice: giwaGasPrice });
  const outboundAReceipt = await outboundA.wait();
  transactions.bridgeATx = outboundAReceipt.transactionHash;
  const messageA = messageFrom(outboundAReceipt);
  await (await bridgeB.executeMessage(
    messageA.args.messageId,
    source.chainId,
    source.contracts.bridge,
    source.contracts.bridgeToken,
    adminB.address,
    amountA,
    messageA.args.nonce,
    '0x',
  )).wait();
  const afterA = await tokenA.balanceOf(adminA.address);
  const afterB = await tokenB.balanceOf(adminB.address);
  assert(beforeA.sub(afterA).eq(amountA), 'GIWA source burn completed');
  assert(afterB.sub(beforeB).eq(amountA), 'Ethereum Sepolia destination mint completed');
  console.log(`ok GIWA -> Ethereum Sepolia relay: ${messageA.args.messageId}`);
  await expectRevert(
    bridgeB.executeMessage(messageA.args.messageId, source.chainId, source.contracts.bridge, source.contracts.bridgeToken, adminB.address, amountA, messageA.args.nonce, '0x'),
    'forward replay protection',
  );

  const amountB = ethers.utils.parseUnits('3', 18);
  const beforeBReverse = await tokenB.balanceOf(adminB.address);
  const beforeAReverse = await tokenA.balanceOf(adminA.address);
  const outboundB = await bridgeB.bridgeOut(target.contracts.bridgeToken, source.chainId, source.contracts.bridge, adminA.address, amountB, '0x');
  const outboundBReceipt = await outboundB.wait();
  transactions.bridgeBTx = outboundBReceipt.transactionHash;
  const messageB = messageFrom(outboundBReceipt);
  await (await bridgeA.executeMessage(
    messageB.args.messageId,
    target.chainId,
    target.contracts.bridge,
    target.contracts.bridgeToken,
    adminA.address,
    amountB,
    messageB.args.nonce,
    '0x',
    { gasPrice: giwaGasPrice },
  )).wait();
  const afterBReverse = await tokenB.balanceOf(adminB.address);
  const afterAReverse = await tokenA.balanceOf(adminA.address);
  assert(beforeBReverse.sub(afterBReverse).eq(amountB), 'Ethereum Sepolia source burn completed');
  assert(afterAReverse.sub(beforeAReverse).eq(amountB), 'GIWA destination mint completed');
  console.log(`ok Ethereum Sepolia -> GIWA relay: ${messageB.args.messageId}`);
  await expectRevert(
    bridgeA.executeMessage(messageB.args.messageId, target.chainId, target.contracts.bridge, target.contracts.bridgeToken, adminA.address, amountB, messageB.args.nonce, '0x', { gasPrice: giwaGasPrice }),
    'reverse replay protection',
  );

  const result = {
    type: 'public-dual-chain-smoke',
    testedAt: new Date().toISOString(),
    source: { network: source.network, chainId: source.chainId, deployer: adminA.address },
    target: { network: target.network, chainId: target.chainId, deployer: adminB.address },
    smokeBuyer: user.address,
    checks: {
      permissionlessLaunch: true,
      curatedRwaLaunch: true,
      forwardRelay: true,
      reverseRelay: true,
      replayProtection: true,
    },
    transactions,
  };
  const historyId = new Date().toISOString().replace(/[:.]/g, '-');
  const historyFile = path.join(ROOT, 'deployments', 'history', `${historyId}--public-smoke--${sourceFile}--${targetFile}.json`);
  fs.mkdirSync(path.dirname(historyFile), { recursive: true });
  fs.writeFileSync(historyFile, `${JSON.stringify(result, null, 2)}\n`);
  console.log('\nPublic dual-chain smoke test passed');
  console.log(JSON.stringify({ ...result, historyFile: path.relative(ROOT, historyFile) }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
