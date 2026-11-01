const fs = require('fs');
const path = require('path');
const { id } = require('ethers');

function json(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function deploymentHistoryFile(root) {
  return path.join(root, 'docs/deployment-history.json');
}

function readDeploymentHistory(root) {
  const file = deploymentHistoryFile(root);
  if (!fs.existsSync(file)) return [];

  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(value)) throw new Error(`Deployment history must be an array: ${file}`);
  return value;
}

function writeDeploymentHistory(root, history) {
  json(deploymentHistoryFile(root), history);
}

function runId({ network, deployer, startedAt }) {
  const stamp = String(startedAt).replace(/[^0-9]/g, '').slice(0, 14);
  const addressSuffix = String(deployer || 'unknown').slice(-8).toLowerCase();
  return `${network.chainId}-${stamp}-${addressSuffix}`;
}

function beginDeployment({ root, network, deployer, pyth = '', requestedRwaQuote = '', startedAt }) {
  const timestamp = startedAt || new Date().toISOString();
  const entry = {
    runId: runId({ network, deployer, startedAt: timestamp }),
    status: 'in_progress',
    network,
    deployer,
    startedAt: timestamp,
    requestedRwaQuote,
    pyth,
  };
  const history = readDeploymentHistory(root);
  history.push(entry);
  writeDeploymentHistory(root, history);
  return entry;
}

function deploymentSummary(marketDeployment) {
  return {
    contracts: marketDeployment.contracts,
    settlementToken: marketDeployment.settlementToken,
    spot: Object.fromEntries(Object.entries(marketDeployment.spot || {}).map(([key, market]) => [key, {
      token: market.token,
      pool: market.pool,
      feedId: market.feedId,
      oracleMode: market.oracleMode || '',
    }])),
    rwa: (marketDeployment.markets || []).map((market) => ({
      symbol: market.symbol,
      assetId: market.assetId,
      token: market.tokenAddress,
      pool: market.poolAddress,
      assetLiquidity: market.assetLiquidity,
      quoteLiquidity: market.quoteLiquidity,
    })),
    perps: marketDeployment.perps || {},
  };
}

function completeDeployment({ root, runId: deploymentRunId, marketDeployment, metadata = {} }) {
  const history = readDeploymentHistory(root);
  const index = history.findIndex((entry) => entry.runId === deploymentRunId);
  const summary = deploymentSummary(marketDeployment);
  const entry = index >= 0 ? history[index] : { runId: deploymentRunId || runId({
    network: marketDeployment.network,
    deployer: marketDeployment.deployer,
    startedAt: marketDeployment.deployedAt,
  }) };

  Object.assign(entry, {
    status: 'success',
    network: marketDeployment.network,
    deployer: marketDeployment.deployer,
    deployedAt: marketDeployment.deployedAt,
    completedAt: metadata.completedAt || new Date().toISOString(),
    ...summary,
    ...metadata,
  });

  if (index >= 0) history[index] = entry;
  else history.push(entry);
  writeDeploymentHistory(root, history);
  return entry;
}

function failDeployment({ root, runId: deploymentRunId, error, completedAt }) {
  if (!deploymentRunId) return;
  const history = readDeploymentHistory(root);
  const index = history.findIndex((entry) => entry.runId === deploymentRunId);
  if (index < 0) return;

  history[index] = {
    ...history[index],
    status: 'failed',
    completedAt: completedAt || new Date().toISOString(),
    error: String(error?.shortMessage || error?.message || error).slice(0, 1200),
  };
  writeDeploymentHistory(root, history);
}

function address(value) {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value) ? value : '';
}

function clean(value) {
  return address(value) ? value : '';
}

function betaAction(targets, selectors) {
  return { targets: targets.filter(Boolean), selectors };
}

function selector(signature) {
  return id(signature).slice(0, 10).toLowerCase();
}

function upsertEnv(file, values) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = existing.split(/\r?\n/);
  const remaining = new Map(Object.entries(values).map(([key, value]) => [key, String(value)]));
  const next = lines.map((line) => {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)=/);
    if (!match || !remaining.has(match[1])) return line;
    const key = match[1];
    const value = remaining.get(key);
    remaining.delete(key);
    return `${key}=${value}`;
  });

  for (const [key, value] of remaining) {
    if (next.length && next[next.length - 1] !== '') next.push('');
    next.push(`${key}=${value}`);
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${next.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
}

function removeEnvKeys(file, keys) {
  if (!fs.existsSync(file)) return;
  const keySet = new Set(keys);
  const next = fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)=/);
      return !match || !keySet.has(match[1]);
    });
  fs.writeFileSync(file, `${next.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
}

function syncRuntimeEnv(root, network) {
  const chainId = Number(network.chainId);
  const local = chainId === 47805;
  const rpc = local
    ? 'http://127.0.0.1:7545'
    : (process.env.GIWA_RPC_URL || 'https://sepolia-rpc.giwa.io');
  const flashblocksRpc = local
    ? rpc
    : (process.env.GIWA_FLASHBLOCKS_RPC_URL || 'https://sepolia-rpc-flashblocks.giwa.io');
  const explorer = local
    ? ''
    : (process.env.GIWA_EXPLORER_URL || 'https://sepolia-explorer.giwa.io');
  const networkName = network.name || (local ? 'Custos Local' : 'GIWA Sepolia');

  upsertEnv(path.join(root, 'apps/api/.env'), {
    CUSTOS_CHAIN_ID: chainId,
    CUSTOS_NETWORK_NAME: networkName,
    GIWA_RPC_URL: rpc,
    GIWA_FLASHBLOCKS_RPC_URL: flashblocksRpc,
    GIWA_EXPLORER_URL: explorer,
    FRONTEND_ORIGIN: 'http://127.0.0.1:3001,http://localhost:3001',
  });

  const webValues = {
    VITE_CHAIN_ID: chainId,
    VITE_NETWORK_URL: rpc,
    VITE_GIWA_RPC: rpc,
    VITE_GIWA_CHAIN_ID: chainId,
    VITE_GIWA_EXPLORER: explorer,
  };
  const webEnvFile = path.join(root, 'apps/web/.env');
  if (local) {
    webValues.VITE_API_BASE = 'http://127.0.0.1:8001';
  } else if (process.env.VITE_API_BASE) {
    webValues.VITE_API_BASE = process.env.VITE_API_BASE;
  }
  upsertEnv(webEnvFile, webValues);
  if (!local && !process.env.VITE_API_BASE) {
    // Do not let a local API URL survive a GIWA deployment. The frontend
    // will use its production fallback unless an explicit API URL is supplied.
    removeEnvKeys(webEnvFile, ['VITE_API_BASE']);
  }
}

function writeDeploymentFiles({
  root,
  network,
  deployer,
  pyth,
  contracts,
  rwa,
  spot,
  perps,
  deployedAt,
  recordHistory = false,
  deploymentRunId,
  deploymentMetadata,
}) {
  const timestamp = deployedAt || new Date().toISOString();
  const marketDeployment = {
    version: 'custos-markets-v1',
    network,
    deployer,
    deployedAt: timestamp,
    contracts,
    settlementToken: rwa.settlementToken,
    markets: rwa.markets,
    spot,
    perps,
  };

  json(path.join(root, 'contracts/markets/deployments', network.chainId === 91342 ? 'giwa-sepolia.json' : 'local.json'), marketDeployment);

  json(path.join(root, 'apps/web/src/custos/deployment.generated.json'), {
    network: network.name,
    chainId: network.chainId,
    deployedAt: marketDeployment.deployedAt,
    deployer,
    pyth: pyth || '',
    contracts: {
      testUSDC: contracts.testUSDC || contracts.rwaSettlementToken,
      oracleRouter: contracts.oracleRouter,
      marketRegistry: contracts.marketRegistry,
      marginVault: contracts.marginVault,
      perpEngine: contracts.perpEngine,
    },
    markets: perps,
    version: 'custos-markets-v1',
  });

  json(path.join(root, 'apps/web/src/custos/spot.generated.json'), {
    version: 'custos-spot-v1',
    chainId: network.chainId,
    deployedAt: marketDeployment.deployedAt,
    deployer,
    quoteToken: contracts.testUSDC || contracts.rwaSettlementToken,
    quoteSymbol: 'tUSDC',
    quoteDecimals: 6,
    oracleRouter: contracts.oracleRouter,
    markets: spot,
    notes: [
      'Synthetic testnet spot markets; not redeemable for physical assets.',
      'Spot execution is anchored to the configured Pyth or local mock oracle.',
      'The same tUSDC contract is used by Spot and Perpetuals.',
    ],
  });

  json(path.join(root, 'apps/web/src/custos/rwa.generated.json'), {
    version: 'custos-rwa-v1',
    chainId: network.chainId,
    deployedAt: marketDeployment.deployedAt,
    deployer,
    contracts: {
      verifiedToken: contracts.verifiedToken || contracts.rwaSettlementToken,
      verifiedTokenFaucet: contracts.verifiedTokenFaucet || '',
      registry: contracts.registry,
      assetFactory: contracts.assetFactory,
      poolFactory: contracts.poolFactory,
    },
    settlementToken: rwa.settlementToken,
    markets: rwa.markets,
  });

  json(path.join(root, 'apps/api/market-config.json'), marketDeployment);

  const spotPools = Object.values(spot).map((market) => clean(market.pool));
  const betaConfig = {
    version: 'public-beta-s1',
    chainId: network.chainId,
    generatedAt: marketDeployment.deployedAt,
    contracts: {
      testUSDC: contracts.testUSDC || contracts.rwaSettlementToken,
      marginVault: contracts.marginVault,
      perpEngine: contracts.perpEngine,
      spotPools,
      spotMarkets: Object.fromEntries(Object.entries(spot).map(([key, market]) => [key, {
        token: market.token,
        pool: market.pool,
        feedId: market.feedId,
        tokenSymbol: market.tokenSymbol,
        underlying: market.underlying,
      }])),
    },
    actions: {
      faucet: betaAction([contracts.testUSDC || contracts.rwaSettlementToken], [selector('faucet()')]),
      spot_trade: betaAction(spotPools, [selector('buyExactQuote(uint256,uint256,bytes[])'), selector('sellExactAsset(uint256,uint256,bytes[])')]),
      add_liquidity: betaAction(spotPools, [selector('addLiquidity(uint256,uint256,bytes[])')]),
      remove_liquidity: betaAction(spotPools, [selector('removeLiquidity(uint256,uint256,bytes[])')]),
      perp_deposit: betaAction([contracts.marginVault], [selector('deposit(uint256)')]),
      perp_withdraw: betaAction([contracts.marginVault], [selector('withdraw(uint256)')]),
      perp_open: betaAction([contracts.perpEngine], [selector('openPositionWithTriggers(bytes32,bool,uint256,uint256,uint256,uint256,bytes[])')]),
      perp_close: betaAction([contracts.perpEngine], [selector('closePosition(uint256,bytes[])')]),
      tpsl: betaAction([contracts.perpEngine], [selector('setTriggerPrices(uint256,uint256,uint256)')]),
    },
  };
  json(path.join(root, 'apps/api/beta-contracts.generated.json'), betaConfig);
  syncRuntimeEnv(root, network);
  if (recordHistory) {
    completeDeployment({
      root,
      runId: deploymentRunId,
      marketDeployment,
      metadata: deploymentMetadata,
    });
  }
  return marketDeployment;
}

module.exports = {
  beginDeployment,
  completeDeployment,
  failDeployment,
  writeDeploymentFiles,
  selector,
};
