const fs = require('fs');
const path = require('path');
const { writeDeploymentFiles } = require('./write-deployment');

const root = path.resolve(__dirname, '../../..');
const DEFAULT_PYTH = '0x2880ab155794e7179c9ee2e38200202908c17b43';

function argument(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function load(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read deployment file ${file}: ${error.message}`);
  }
}

function main() {
  const requestedNetwork = argument(
    '--network',
    process.env.CUSTOS_MARKETS_NETWORK || 'local',
  ).toLowerCase();
  const fileName = requestedNetwork === 'giwa' || requestedNetwork === 'giwa-sepolia'
    ? 'giwa-sepolia.json'
    : 'local.json';
  const deploymentFile = path.resolve(
    argument('--file', path.join(__dirname, '../deployments', fileName)),
  );

  if (!fs.existsSync(deploymentFile)) {
    throw new Error(`Missing deployment file: ${deploymentFile}`);
  }

  const source = load(deploymentFile);
  const sourceNetwork = source.network || {};
  const chainId = Number(sourceNetwork.chainId || (fileName === 'giwa-sepolia.json' ? 91342 : 47805));
  const network = {
    name: sourceNetwork.name || (chainId === 91342 ? 'GIWA Sepolia' : 'Custos Local'),
    chainId,
  };
  const settlementToken = source.settlementToken || {
    name: 'Custos Test USD Coin',
    symbol: 'tUSDC',
    address: source.contracts?.testUSDC || source.contracts?.rwaSettlementToken || '',
    decimals: 6,
    official: false,
    faucetAddress: source.contracts?.verifiedTokenFaucet || '',
    claimUrl: '',
    claimFlow: 'Use the configured test-token faucet.',
    disclaimer: 'Testnet-only collateral; no cash value.',
  };

  const result = writeDeploymentFiles({
    root,
    network,
    deployer: source.deployer || '',
    pyth: source.pyth || (chainId === 91342 ? (process.env.PYTH_ADDRESS || DEFAULT_PYTH) : ''),
    contracts: source.contracts || {},
    rwa: {
      settlementToken,
      markets: Array.isArray(source.markets) ? source.markets : [],
    },
    spot: source.spot || {},
    perps: source.perps || {},
    deployedAt: source.deployedAt,
  });

  console.log(`Synced Custos market configuration from ${path.relative(root, deploymentFile)}.`);
  console.log(`Network: ${result.network.name} (${result.network.chainId})`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
