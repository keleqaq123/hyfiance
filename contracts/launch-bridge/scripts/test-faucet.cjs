const assert = require('node:assert/strict');
const {ethers} = require('ethers');
const ganache = require('ganache');
const {compileFaucet} = require('./faucet-artifact.cjs');

async function main() {
  const chain = ganache.provider({logging: {quiet: true}, chain: {chainId: 91342}});
  const provider = new ethers.providers.Web3Provider(chain);
  const owner = provider.getSigner(0), operator = provider.getSigner(1), alice = provider.getSigner(2), bob = provider.getSigner(3);
  try {
    const compiled = compileFaucet({'Recipient.sol': {content: `pragma solidity ^0.8.30;
      interface IFaucet {function claimFor(address payable) external;}
      contract Rejecting {receive() external payable {revert("REJECT");}}
      contract Reentrant {
        IFaucet public faucet; bool public blocked;
        function start(address f) external {faucet=IFaucet(f);faucet.claimFor(payable(address(this)));}
        receive() external payable {try faucet.claimFor(payable(address(this))) {revert("UNSAFE");} catch {blocked=true;}}
      }`}});
    const factory = new ethers.ContractFactory(compiled.faucet.abi, compiled.faucet.bytecode, owner);
    const amount = ethers.utils.parseEther('0.001'), a = await alice.getAddress(), b = await bob.getAddress();
    const faucet = await factory.deploy(await owner.getAddress(), await operator.getAddress(), amount, 86400, amount.mul(2));
    await faucet.deployed();
    await assert.rejects(() => factory.deploy(ethers.constants.AddressZero, a, amount, 86400, amount));
    await assert.rejects(() => factory.deploy(a, b, 0, 86400, amount));
    await assert.rejects(() => factory.deploy(a, b, amount, 10, amount));
    await assert.rejects(() => factory.deploy(a, b, amount, 86400, amount.div(2)));
    const fullDaily = await factory.deploy(await owner.getAddress(), await operator.getAddress(), amount, 86400, ethers.utils.parseEther('1'));
    await fullDaily.deployed();assert((await fullDaily.dailyLimit()).eq(ethers.utils.parseEther('1')));
    await assert.rejects(() => faucet.connect(alice).claimFor(a));
    await assert.rejects(() => faucet.connect(operator).claimFor(a));
    assert((await faucet.nextClaimAt(a)).isZero());
    await (await owner.sendTransaction({to: faucet.address, value: amount.mul(10)})).wait();
    await assert.rejects(() => faucet.connect(operator).claimFor(ethers.constants.AddressZero));
    await assert.rejects(() => faucet.connect(operator).claimFor(faucet.address));
    await assert.rejects(() => faucet.connect(alice).setPaused(true));
    await (await faucet.setPaused(true)).wait();
    await assert.rejects(() => faucet.connect(operator).claimFor(a));
    await (await faucet.setPaused(false)).wait();
    const before = await provider.getBalance(a);
    const receipt = await (await faucet.connect(operator).claimFor(a)).wait();
    assert((await provider.getBalance(a)).sub(before).eq(amount), 'recipient pays no gas');
    assert.equal(receipt.events.find(e => e.event === 'Claimed').args.account, a);
    await assert.rejects(() => faucet.connect(operator).claimFor(a));
    await (await faucet.connect(operator).claimFor(b)).wait();
    const firstDay = Math.floor((await provider.getBlock('latest')).timestamp / 86400);
    await assert.rejects(() => faucet.connect(alice).setDailyLimit(amount.mul(3)));
    await assert.rejects(() => faucet.setDailyLimit(amount.mul(3)));
    await (await faucet.setPaused(true)).wait();
    await assert.rejects(() => faucet.setDailyLimit(0));
    await assert.rejects(() => faucet.setDailyLimit(amount.div(2)));
    const change = await (await faucet.setDailyLimit(ethers.utils.parseEther('1'))).wait();
    assert(change.events.some(e => e.event === 'DailyLimitChanged'));
    assert((await faucet.dailyLimit()).eq(ethers.utils.parseEther('1')));
    assert((await faucet.distributedPerDay(firstDay)).eq(amount.mul(2)), 'budget changes cannot reset payouts');
    await (await faucet.setDailyLimit(amount)).wait();
    await (await faucet.setPaused(false)).wait();
    await assert.rejects(async () => faucet.connect(operator).claimFor(await owner.getAddress()));
    await (await faucet.setPaused(true)).wait();
    await (await faucet.setDailyLimit(amount.mul(2))).wait();
    await (await faucet.setPaused(false)).wait();
    const ownerAddress = await owner.getAddress();
    await assert.rejects(() => faucet.connect(operator).claimFor(ownerAddress));
    await assert.rejects(() => faucet.recoverFunds(a, amount));
    await assert.rejects(() => faucet.connect(alice).setOperator(a));
    await provider.send('evm_increaseTime', [86401]);await provider.send('evm_mine', []);
    await (await faucet.connect(operator).claimFor(a)).wait();
    const rejectArtifact = compiled.artifact(compiled.contracts['Recipient.sol'].Rejecting);
    const rejecting = await new ethers.ContractFactory(rejectArtifact.abi, rejectArtifact.bytecode, owner).deploy();await rejecting.deployed();
    await assert.rejects(() => faucet.connect(operator).claimFor(rejecting.address));
    assert((await faucet.nextClaimAt(rejecting.address)).isZero(), 'failed payout must not consume cooldown');
    const reArtifact = compiled.artifact(compiled.contracts['Recipient.sol'].Reentrant);
    const reentrant = await new ethers.ContractFactory(reArtifact.abi, reArtifact.bytecode, owner).deploy();await reentrant.deployed();
    await (await faucet.setOperator(reentrant.address)).wait();
    await (await reentrant.start(faucet.address)).wait();assert(await reentrant.blocked());
    assert((await provider.getBalance(reentrant.address)).eq(amount), 'cannot drain via reentrancy');
    await assert.rejects(() => faucet.connect(operator).claimFor(b));
    await (await faucet.setOperator(await operator.getAddress())).wait();
    await (await faucet.setPaused(true)).wait();
    await assert.rejects(() => faucet.connect(alice).recoverFunds(a, amount));
    await (await faucet.recoverFunds(a, amount)).wait();
    assert(!faucet.interface.functions['claim()']);
    console.log('Faucet contract checks passed: sponsored payout, operator restriction, cooldown, daily cap, pause, rotation, failed-payout rollback, reentrancy and owner-only recovery.');
  } finally {await chain.disconnect();}
}
main().catch(error => {console.error(error);process.exitCode = 1;});
