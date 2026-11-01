const assert = require('node:assert/strict');
const {ethers} = require('ethers');
const ganache = require('ganache');
const {compileConfigurableFaucet} = require('./configurable-faucet-artifact.cjs');

async function main() {
  const chain = ganache.provider({logging: {quiet: true}, chain: {chainId: 91342}});
  const provider = new ethers.providers.Web3Provider(chain);
  const owner = provider.getSigner(0), operator = provider.getSigner(1), alice = provider.getSigner(2);
  try {
    const compiled = compileConfigurableFaucet();
    const factory = new ethers.ContractFactory(compiled.faucet.abi, compiled.faucet.bytecode, owner);
    const amount = ethers.utils.parseEther('0.001'), ownerAddress = await owner.getAddress(), operatorAddress = await operator.getAddress(), aliceAddress = await alice.getAddress();
    const faucet = await factory.deploy(ownerAddress, operatorAddress, amount, 86400, ethers.utils.parseEther('1'));
    await faucet.deployed();
    await (await owner.sendTransaction({to: faucet.address, value: amount.mul(5)})).wait();
    await assert.rejects(() => faucet.connect(owner).claimFor(aliceAddress));
    await (await faucet.setPaused(true)).wait();
    await (await faucet.setClaimAmount(ethers.utils.parseEther('0.002'))).wait();
    await (await faucet.setClaimCooldown(0)).wait();
    await (await faucet.setDailyLimit(ethers.utils.parseEther('10'))).wait();
    assert((await faucet.claimAmount()).eq(ethers.utils.parseEther('0.002')));
    assert((await faucet.claimCooldown()).eq(0));
    assert((await faucet.dailyLimit()).eq(ethers.utils.parseEther('10')));
    await (await faucet.setPaused(false)).wait();
    const before = await provider.getBalance(aliceAddress);
    await (await faucet.connect(operator).claimFor(aliceAddress)).wait();
    await (await faucet.connect(operator).claimFor(aliceAddress)).wait();
    assert((await provider.getBalance(aliceAddress)).sub(before).eq(ethers.utils.parseEther('0.004')));
    await (await faucet.setPaused(true)).wait();
    await assert.rejects(() => faucet.setClaimAmount(ethers.utils.parseEther('11')));
    await assert.rejects(() => faucet.connect(operator).setClaimCooldown(86400));
    await (await faucet.setPaused(false)).wait();
    console.log('Configurable faucet checks passed: owner-only amount/cooldown/daily setters, pause gate, zero cooldown, repeated sponsored payouts and bounds.');
  } finally { await chain.disconnect(); }
}

main().catch(error => {console.error(error); process.exitCode = 1;});
