import marketDeployment from './deployment.generated.json';
import rwaDeployment from './rwa.generated.json';
import spotDeployment from './spot.generated.json';

const generatedChainId = [
  Number((marketDeployment as { chainId?: number }).chainId || 0),
  Number((spotDeployment as { chainId?: number }).chainId || 0),
  Number((rwaDeployment as { chainId?: number }).chainId || 0),
].find((value) => value > 0);

const chainId = generatedChainId || Number(import.meta.env.VITE_CHAIN_ID || 91342);
const local = chainId === 47805;
const rpc = local
  ? (import.meta.env.VITE_NETWORK_URL || 'http://127.0.0.1:7545')
  : (import.meta.env.VITE_GIWA_RPC || 'https://sepolia-rpc.giwa.io');
const explorer = local
  ? (import.meta.env.VITE_LOCAL_EXPLORER || '')
  : (import.meta.env.VITE_GIWA_EXPLORER || 'https://sepolia-explorer.giwa.io');

export function resolveMarketApiBase(override: string | undefined, origin: string) {
  if (override) return override;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)
    ? 'http://127.0.0.1:8001'
    : origin || 'https://www.custosfinance.xyz';
}

export const CUSTOS_API_BASE = resolveMarketApiBase(
  import.meta.env.VITE_API_BASE,
  typeof window !== 'undefined' ? window.location.origin : '',
);

export const MARKET_NETWORK = {
  chainId,
  hexChainId: `0x${chainId.toString(16)}`,
  name: local ? 'Custos Local' : 'GIWA Sepolia',
  rpc,
  explorer,
  local,
};

export const WALLET_NETWORK = {
  chainId: MARKET_NETWORK.hexChainId,
  chainName: MARKET_NETWORK.name,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: [MARKET_NETWORK.rpc],
  ...(MARKET_NETWORK.explorer
    ? { blockExplorerUrls: [MARKET_NETWORK.explorer] }
    : {}),
};

export async function ensureMarketNetwork(ethereum: {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}) {
  const current = String(await ethereum.request({ method: 'eth_chainId' }));
  if (current.toLowerCase() === MARKET_NETWORK.hexChainId.toLowerCase()) return;

  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: MARKET_NETWORK.hexChainId }],
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 4902) throw error;
    await ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [WALLET_NETWORK],
    });
  }
}
