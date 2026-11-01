const assert = require('node:assert/strict'), path = require('node:path'), {spawn} = require('node:child_process');
const {ethers} = require('ethers'), ganache = require('ganache');
const {compileFaucet} = require('./faucet-artifact.cjs');
async function main() {
  const server = ganache.server({logging: {quiet: true}, chain: {chainId: 91342}});
  await server.listen(0, '127.0.0.1');
  try {
    const rpc = 'http://127.0.0.1:' + server.address().port, p = new ethers.providers.JsonRpcProvider(rpc);
    const compiled = compileFaucet({'GasOracle.sol': {content: 'pragma solidity ^0.8.30; contract GasOracle {function getL1Fee(bytes calldata) external pure returns(uint256){return 0;}}'}});
    await p.send('evm_setAccountCode', ['0x420000000000000000000000000000000000000F', '0x' + compiled.contracts['GasOracle.sol'].GasOracle.evm.deployedBytecode.object]);
    const accounts = server.provider.getInitialAccounts(), keys = Object.values(accounts).map(value => value.secretKey);
    const owner = new ethers.Wallet(keys[0], p), operator = new ethers.Wallet(keys[1], p);
    const recipient = ethers.Wallet.createRandom().address, amount = ethers.utils.parseEther('0.001');
    const faucet = await new ethers.ContractFactory(compiled.faucet.abi, compiled.faucet.bytecode, owner).deploy(owner.address, operator.address, amount, 86400, amount.mul(10));await faucet.deployed();
    await (await owner.sendTransaction({to: faucet.address, value: amount.mul(3)})).wait();
    assert((await p.getBalance(recipient)).isZero());
    const python = spawn(process.env.TEST_PYTHON || 'python3', [path.resolve(__dirname, '../../../apps/api/test_faucet_e2e.py')], {stdio: ['pipe', 'pipe', 'pipe']});
    // Isolated Ganache-only credential is passed through stdin, never printed.
    python.stdin.end(JSON.stringify({rpc, contract: faucet.address, key: keys[1], recipient}));
    let stdout = '', stderr = '';
    python.stdout.on('data', data => stdout += data);python.stderr.on('data', data => stderr += data);
    const code = await new Promise(resolve => python.on('close', resolve));
    if (code !== 0) {console.error('Faucet API integration failed; isolated test output:', stderr.slice(-3000));throw Error('Integration failed');}
    console.log(stdout.trim());assert((await p.getBalance(recipient)).eq(amount));
    assert((await faucet.nextClaimAt(recipient)).gt(0));
    console.log('Actual isolated-chain delivery passed: zero-ETH recipient receives exactly 0.001 ETH; official sender pays gas.');
  } finally {await server.close();}
}
main().catch(error => {console.error(error.message);process.exitCode = 1;});
