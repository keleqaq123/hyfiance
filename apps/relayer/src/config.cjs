const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_DEPLOYMENT_FILE = path.join(
  ROOT,
  'contracts/launch-bridge/deployments/GIWA Sepolia--Ethereum Sepolia.json',
);

dotenv.config({
  path: process.env.RELAYER_ENV_FILE || path.join(ROOT, 'apps/relayer/.env'),
});

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value.trim();
}

function integer(name, fallback, minimum = 0) {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return value;
}

function duration(name, fallback, minimum = 0) {
  return integer(name, fallback, minimum);
}

function startBlock(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === '' || raw.toLowerCase() === 'latest') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative block number or latest`);
  return value;
}

function resolvePath(value) {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function loadJson(file) {
  if (!fs.existsSync(file)) throw new Error(`Relayer deployment file does not exist: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function networkFromRecord(key, record) {
  const prefix = key === 'A' ? 'A' : 'B';
  const chainId = Number(process.env[`RELAYER_CHAIN_${prefix}_ID`] || record.chainId);
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error(`Invalid chain ID for chain ${prefix}`);

  return {
    key,
    name: process.env[`RELAYER_CHAIN_${prefix}_NAME`] || record.network,
    chainId,
    rpc: process.env[`RELAYER_CHAIN_${prefix}_RPC`] || record.rpc,
    bridge: process.env[`RELAYER_CHAIN_${prefix}_BRIDGE`] || record.contracts.bridge,
    bridgeToken: process.env[`RELAYER_CHAIN_${prefix}_TOKEN`] || record.contracts.bridgeToken,
    startBlock: startBlock(`RELAYER_CHAIN_${prefix}_START_BLOCK`),
  };
}

function loadConfig() {
  const deploymentFile = resolvePath(process.env.RELAYER_DEPLOYMENT_FILE || DEFAULT_DEPLOYMENT_FILE);
  const deployment = loadJson(deploymentFile);
  if (!deployment.source || !deployment.target) {
    throw new Error(`Relayer deployment file must contain source and target records: ${deploymentFile}`);
  }

  const stateFile = resolvePath(
    process.env.RELAYER_STATE_FILE || path.join(ROOT, 'runtime-data/bridge-relayer-state.json'),
  );

  return {
    root: ROOT,
    deploymentFile,
    privateKey: required('RELAYER_PRIVATE_KEY'),
    pollIntervalMs: duration('RELAYER_POLL_INTERVAL_MS', 5000, 250),
    confirmations: integer('RELAYER_CONFIRMATIONS', 1, 0),
    receiptConfirmations: integer('RELAYER_RECEIPT_CONFIRMATIONS', 1, 1),
    maxLogBlockRange: integer('RELAYER_MAX_LOG_BLOCK_RANGE', 2000, 1),
    retryBaseMs: duration('RELAYER_RETRY_BASE_MS', 5000, 250),
    retryMaxMs: duration('RELAYER_RETRY_MAX_MS', 300000, 1000),
    pendingTxTimeoutMs: duration('RELAYER_PENDING_TX_TIMEOUT_MS', 900000, 10000),
    gasLimitMultiplierBps: integer('RELAYER_GAS_LIMIT_MULTIPLIER_BPS', 12500, 10000),
    stateFile,
    http: {
      host: process.env.RELAYER_HTTP_HOST || '127.0.0.1',
      port: integer('RELAYER_HTTP_PORT', 8090, 1),
    },
    networks: [
      networkFromRecord('A', deployment.source),
      networkFromRecord('B', deployment.target),
    ],
  };
}

module.exports = { DEFAULT_DEPLOYMENT_FILE, ROOT, loadConfig };
