const path = require('node:path');
const dotenv = require('dotenv');
require('@nomicfoundation/hardhat-toolbox');
const { subtask } = require('hardhat/config');
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require('hardhat/builtin-tasks/task-names');

dotenv.config({
  path: process.env.CUSTOS_NFT_ENV_FILE || path.resolve(__dirname, '../markets/.env'),
});

const privateKey = (process.env.PRIVATE_KEY || '').trim();
const giwaRpc = process.env.GIWA_RPC_URL || 'https://sepolia-rpc.giwa.io';

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

module.exports = {
  solidity: {
    version: '0.8.26',
    settings: {
      optimizer: { enabled: true, runs: 200 },
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
    },
    giwaSepolia: {
      url: giwaRpc,
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
  mocha: {
    timeout: 200000,
  },
};
