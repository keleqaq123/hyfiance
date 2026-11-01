require('@nomicfoundation/hardhat-toolbox');
const path = require('path');
const dotenv = require('dotenv');
const marketEnvFile = process.env.CUSTOS_MARKETS_ENV || path.join(__dirname, '.env');
dotenv.config({ path: marketEnvFile });

// Keep market deployment settings and Pyth credentials separate. The Pyth
// credential may live in the backend env file and must never be copied into
// the repository or exposed to the frontend.
if (process.env.PYTH_ENV_FILE) {
  dotenv.config({ path: process.env.PYTH_ENV_FILE });
}

const { subtask } = require('hardhat/config');
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require('hardhat/builtin-tasks/task-names');

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, _hre, runSuper) => {
  if (args.solcVersion === '0.8.26') {
    return {
      compilerPath: require.resolve('solc/soljson.js'),
      isSolcJs: true,
      version: '0.8.26',
      longVersion: '0.8.26+commit.8a97fa7a',
    };
  }
  return runSuper();
});

const privateKey = (process.env.PRIVATE_KEY || '').trim();
const rpcUrl = process.env.GIWA_RPC_URL || 'https://sepolia-rpc.giwa.io';

module.exports = {
  defaultNetwork: 'hardhat',
  solidity: {
    version: '0.8.26',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    elysiumTestnet: {
      url: process.env.ELYSIUM_RPC_URL || 'https://testnet-rpc.elysium.kinetiq.xyz',
      chainId: 99801,
      accounts: process.env.ELYSIUM_PRIVATE_KEY ? [process.env.ELYSIUM_PRIVATE_KEY] : [],
    },
    hardhat: {
      chainId: 47805,
      allowUnlimitedContractSize: true,
    },
    local: {
      url: process.env.LOCAL_RPC_URL || 'http://127.0.0.1:7545',
      chainId: 47805,
      accounts: privateKey ? [privateKey] : 'remote',
    },
    giwaSepolia: {
      url: rpcUrl,
      chainId: 91342,
      accounts: privateKey ? [privateKey] : [],
    },
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
  mocha: { timeout: 200000 },
};
