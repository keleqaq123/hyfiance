const fs = require('node:fs');
const path = require('node:path');
const solc = require('../../../contracts/swap/node_modules/solc-0.6.6');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'src');
const outDir = path.join(root, 'out');
const sourceFiles = ['CustosLaunchpad.sol', 'CustosBridge.sol'];

const input = {
  language: 'Solidity',
  sources: Object.fromEntries(sourceFiles.map((file) => [file, { content: fs.readFileSync(path.join(sourceDir, file), 'utf8') }])),
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'istanbul',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = output.errors || [];
const fatal = errors.filter((error) => error.severity === 'error');
for (const error of errors) console.log(error.formattedMessage || error.message);
if (fatal.length > 0) process.exit(1);

for (const [fileName, contracts] of Object.entries(output.contracts || {})) {
  for (const [contractName, contract] of Object.entries(contracts)) {
    const artifactDir = path.join(outDir, fileName);
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, `${contractName}.json`), `${JSON.stringify({
      contractName,
      sourceName: fileName,
      abi: contract.abi,
      bytecode: `0x${contract.evm.bytecode.object}`,
      deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
    }, null, 2)}\n`);
    console.log(`compiled ${fileName}:${contractName}`);
  }
}

