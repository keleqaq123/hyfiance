// Configure only this checkout. Never read credentials from the original project.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const net = require('../networks/elysium-testnet.json');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
function json(file, value) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + '\n');
}
function env(file, values) {
  const target = path.join(root, file);
  const previous = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').split(/\r?\n/) : [];
  const keys = new Set(Object.keys(values));
  const lines = previous.filter(line => !keys.has(line.split('=')[0]));
  for (const [key, value] of Object.entries(values)) lines.push(`${key}=${value}`);
  fs.writeFileSync(target, lines.filter(Boolean).join('\n') + '\n');
}
const walletPath = path.join(root, '.secrets/elysium-testnet.json');
const wallet = fs.existsSync(walletPath) ? read('.secrets/elysium-testnet.json') : {};
const base = {
  CUSTOS_CHAIN_ID: net.chainId, CUSTOS_NETWORK_NAME: net.name,
  CUSTOS_RPC_URL: net.rpc, CUSTOS_EXPLORER_URL: net.explorer,
  GIWA_RPC_URL: net.rpc, GIWA_FLASHBLOCKS_RPC_URL: net.rpc, GIWA_EXPLORER_URL: net.explorer,
  REALITY_PUBLIC_ORIGIN: 'http://127.0.0.1:3001',
  REALITY_DATA_DIR: './data/elysium-reality',
  DATABASE_PATH: 'hyfiance-elysium.db', BETA_DATABASE_PATH: 'hyfiance-elysium-beta.db',
  FRONTEND_ORIGIN: 'http://127.0.0.1:3001,http://localhost:3001',
  REALITY_ADMIN_WALLETS: wallet.address || '',
  REALITY_CFI_PRICE_SOURCE: 'hyperliquid',
  CFI_QUOTE_SIGNER_KEY: wallet.quoteSignerKey || '',
  FAUCET_ENABLED: 'false',
  REALITY_LAUNCHPAD_ADDRESS: '', REALITY_SWAP_ROUTER: '', REALITY_SWAP_FACTORY: '',
  REALITY_WETH: '', REALITY_CFI_STAKING: '', REALITY_CFI_START_BLOCK: 0,
};
const manifestPath = 'deployments/elysium-testnet.json';
const manifest = fs.existsSync(path.join(root, manifestPath)) ? read(manifestPath) : { chainId: net.chainId, status: 'awaiting-funding', contracts: {} };
if (manifest.chainId !== net.chainId) throw Error('Deployment manifest chain mismatch');
const c = manifest.contracts;
fs.writeFileSync(path.join(root, 'packages/swap-sdk/src/elysium.ts'),
  '// Generated from confirmed Elysium deployments.\nexport const ELYSIUM_V2 = ' +
  JSON.stringify({ factory: c.factory || '', weth: c.weth || '', initCodeHash: manifest.initCodeHash || '' }) + '\n');
Object.assign(base, {
  REALITY_LAUNCHPAD_ADDRESS: c.launchpad || '', REALITY_SWAP_ROUTER: c.router || '',
  REALITY_SWAP_FACTORY: c.factory || '', REALITY_WETH: c.weth || '',
  REALITY_CFI_STAKING: c.cfi || '', REALITY_CFI_START_BLOCK: manifest.cfiStartBlock || 0,
});
env('apps/api/.env', base);
env('apps/web/.env', {
  VITE_CHAIN_ID: net.chainId, VITE_NETWORK_URL: net.rpc,
  VITE_GIWA_RPC: net.rpc, VITE_GIWA_CHAIN_ID: net.chainId, VITE_GIWA_EXPLORER: net.explorer,
  VITE_API_BASE: 'http://127.0.0.1:8001', VITE_NFT_ADDRESS: c.nft || '',
});
// Quarantine inherited generated addresses until this chain has its own deployment.
if (!manifest.modules?.markets) {
  for (const file of ['deployment.generated.json', 'spot.generated.json', 'rwa.generated.json']) {
    const value = read('apps/web/src/custos/' + file);
    function clearAddresses(item) {
      if (Array.isArray(item)) return item.map(clearAddresses);
      if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([k,v]) => [k, clearAddresses(v)]));
      return typeof item === 'string' && /^0x[a-fA-F0-9]{40}$/.test(item) ? '' : item;
    }
    const next = clearAddresses(value);
    Object.assign(next, { chainId: net.chainId, network: net.name, deployedAt: null, deployer: '', status: 'not-deployed' });
    json('apps/web/src/custos/' + file, next);
  }
  json('apps/api/market-config.json', { network: net, contracts: {}, markets: [], spot: {}, perps: {}, status: 'not-deployed' });
  json('apps/api/beta-contracts.generated.json', { chainId: net.chainId, contracts: {}, actions: {}, status: 'not-deployed' });
}
json('apps/web/src/custos/elysiumDeployment.json', { ...net, ...manifest, contracts: c });
json(manifestPath, manifest);
console.log(`Configured ${net.name} (${net.chainId}); deployment status: ${manifest.status}`);
