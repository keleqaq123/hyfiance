const fs = require('node:fs');
const path = require('node:path');
const solc = require('solc');

function compileFaucet(extraSources = {}) {
  const source = 'CustosTestnetFaucet.sol';
  const input = {
    language: 'Solidity',
    sources: {[source]: {content: fs.readFileSync(path.resolve(__dirname, '../src/' + source), 'utf8')}, ...extraSources},
    settings: {optimizer: {enabled: true, runs: 200}, evmVersion: 'paris', outputSelection: {'*': {'*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object']}}},
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter(error => error.severity === 'error');
  if (errors.length) throw new Error(errors.map(error => error.formattedMessage).join('\n'));
  const artifact = contract => ({abi: contract.abi, bytecode: '0x' + contract.evm.bytecode.object});
  return {faucet: artifact(output.contracts[source].CustosTestnetFaucet), contracts: output.contracts, artifact};
}

module.exports = {compileFaucet};
if (require.main === module) {
  const {faucet} = compileFaucet();
  console.log('CustosTestnetFaucet compiled: ' + (faucet.bytecode.length - 2) / 2 + ' byte creation code');
}
