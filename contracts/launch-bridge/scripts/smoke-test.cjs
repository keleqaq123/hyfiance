const fs = require('node:fs');
const path = require('node:path');
const { ethers } = require('../../swap/node_modules/ethers');

const ROOT = path.resolve(__dirname, '..');
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const USER_KEY = process.env.TEST_USER_PRIVATE_KEY || '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const aRecord = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments/Custos Local A.json'), 'utf8'));
const bRecord = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments/Custos Local B.json'), 'utf8'));
const launchArtifact = JSON.parse(fs.readFileSync(path.join(ROOT, 'out/CustosLaunchpad.sol/CustosLaunchpad.json'), 'utf8'));
const bridgeArtifact = JSON.parse(fs.readFileSync(path.join(ROOT, 'out/CustosBridge.sol/CustosBridge.json'), 'utf8'));
const tokenArtifact = JSON.parse(fs.readFileSync(path.join(ROOT, 'out/CustosBridge.sol/CustosBridgeToken.json'), 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(`SMOKE ASSERTION FAILED: ${message}`);
}

async function expectRevert(promise, label) {
  try {
    await promise;
    throw new Error(`${label} did not revert`);
  } catch (error) {
    if (String(error.message || error).includes('did not revert')) throw error;
    console.log(`✓ ${label} rejected as expected`);
  }
}

async function main() {
  const providerA = new ethers.providers.JsonRpcProvider('http://127.0.0.1:8545');
  const providerB = new ethers.providers.JsonRpcProvider('http://127.0.0.1:8546');
  const admin = new ethers.Wallet(PRIVATE_KEY, providerA);
  const user = new ethers.Wallet(USER_KEY, providerA);
  const adminB = new ethers.Wallet(PRIVATE_KEY, providerB);
  const launchpad = new ethers.Contract(aRecord.contracts.launchpad, launchArtifact.abi, admin);
  const bridgeA = new ethers.Contract(aRecord.contracts.bridge, bridgeArtifact.abi, admin);
  const bridgeB = new ethers.Contract(bRecord.contracts.bridge, bridgeArtifact.abi, adminB);
  const bridgeTokenA = new ethers.Contract(aRecord.contracts.bridgeToken, tokenArtifact.abi, admin);
  const bridgeTokenB = new ethers.Contract(bRecord.contracts.bridgeToken, tokenArtifact.abi, adminB);

  const publicTx = await launchpad.createLaunch('Smoke Public', 'SMOKE', 'custos://smoke/public', ethers.utils.parseUnits('1000000', 18), ethers.utils.parseEther('1'), 0, 0);
  const publicReceipt = await publicTx.wait();
  const publicCreated = publicReceipt.events.find((event) => event.event === 'LaunchCreated');
  const publicId = publicCreated.args.launchId;
  const publicLaunch = await launchpad.getLaunch(publicId);
  const publicToken = new ethers.Contract(publicLaunch.token, tokenArtifact.abi, user);
  const beforePublic = await publicToken.balanceOf(user.address);
  const expected = await launchpad.quoteFor(publicId, ethers.utils.parseEther('0.1'));
  await (await launchpad.connect(user).buy(publicId, expected.mul(98).div(100), { value: ethers.utils.parseEther('0.1') })).wait();
  const afterPublic = await publicToken.balanceOf(user.address);
  assert(afterPublic.gt(beforePublic), 'public launch buyer received tokens');
  console.log(`✓ open launch buy delivered ${ethers.utils.formatUnits(afterPublic.sub(beforePublic), 18)} SMOKE`);

  const curatedTx = await launchpad.createCuratedLaunch('Smoke RWA', 'RWA1', 'custos://smoke/rwa', ethers.utils.parseUnits('500000', 18), ethers.utils.parseEther('1'), 0, 0);
  const curatedReceipt = await curatedTx.wait();
  const curatedCreated = curatedReceipt.events.find((event) => event.event === 'LaunchCreated');
  const curatedId = curatedCreated.args.launchId;
  await (await launchpad.setWhitelist(curatedId, user.address, true)).wait();
  const curatedLaunch = await launchpad.getLaunch(curatedId);
  const curatedToken = new ethers.Contract(curatedLaunch.token, tokenArtifact.abi, user);
  const beforeCurated = await curatedToken.balanceOf(user.address);
  const curatedQuote = await launchpad.quoteFor(curatedId, ethers.utils.parseEther('0.05'));
  await (await launchpad.connect(user).buy(curatedId, curatedQuote.mul(98).div(100), { value: ethers.utils.parseEther('0.05') })).wait();
  const afterCurated = await curatedToken.balanceOf(user.address);
  assert(afterCurated.gt(beforeCurated), 'whitelisted curated buyer received tokens');
  console.log(`✓ curated whitelist buy delivered ${ethers.utils.formatUnits(afterCurated.sub(beforeCurated), 18)} RWA1`);

  const beforeA = await bridgeTokenA.balanceOf(admin.address);
  const beforeB = await bridgeTokenB.balanceOf(admin.address);
  const amount = ethers.utils.parseUnits('7', 18);
  const bridgeTx = await bridgeA.bridgeOut(aRecord.contracts.bridgeToken, bRecord.chainId, bRecord.contracts.bridge, admin.address, amount, '0x');
  const bridgeReceipt = await bridgeTx.wait();
  const sent = bridgeReceipt.events.find((event) => event.event === 'MessageSent');
  assert(sent, 'bridge emitted MessageSent');
  const messageId = sent.args.messageId;
  const afterBurnA = await bridgeTokenA.balanceOf(admin.address);
  assert(beforeA.sub(afterBurnA).eq(amount), 'source cUSD burned');
  await (await bridgeB.executeMessage(messageId, aRecord.chainId, aRecord.contracts.bridge, aRecord.contracts.bridgeToken, admin.address, amount, sent.args.nonce, '0x')).wait();
  const afterMintB = await bridgeTokenB.balanceOf(admin.address);
  assert(afterMintB.sub(beforeB).eq(amount), 'destination cUSD minted');
  console.log(`✓ bridge ${messageId} burned 7 cUSD on A and minted 7 cUSD on B`);
  await expectRevert(
    bridgeB.executeMessage(messageId, aRecord.chainId, aRecord.contracts.bridge, aRecord.contracts.bridgeToken, admin.address, amount, sent.args.nonce, '0x'),
    'bridge replay protection',
  );

  console.log('\nLocal protocol smoke test passed');
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
