const fs = require('node:fs');
const path = require('node:path');
const solc = require('solc');

function compileConfigurableFaucet(extraSources = {}) {
  const source = 'CustosConfigurableTestnetFaucet.sol';
  const input = {
    language: 'Solidity',
    sources: {[source]: {content: fs.readFileSync(path.resolve(__dirname, '../src/' + source), 'utf8')}, ...extraSources},
    settings: {optimizer: {enabled: true, runs: 200}, evmVersion: 'paris', outputSelection: {'*': {'*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object']}}},
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter(error => error.severity === 'error');
  if (errors.length) throw new Error(errors.map(error => error.formattedMessage).join('\n'));
  const artifact = contract => ({abi: contract.abi, bytecode: '0x' + contract.evm.bytecode.object});
  return {faucet: artifact(output.contracts[source].CustosConfigurableTestnetFaucet), contracts: output.contracts, artifact};
}

module.exports = {compileConfigurableFaucet};

if (require.main === module) {
  const {faucet} = compileConfigurableFaucet();
  console.log('CustosConfigurableTestnetFaucet compiled: ' + (faucet.bytecode.length - 2) / 2 + ' byte creation code');
}
