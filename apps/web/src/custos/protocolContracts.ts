import { Contract } from '@ethersproject/contracts'
import { StaticJsonRpcProvider, Web3Provider } from '@ethersproject/providers'
import deployments from './protocolDeployments.json'

export type ProtocolDeployment = {
  network: string
  chainId: number
  rpc: string
  deployedAt: string
  deployer: string
  contracts: {
    launchpad: string
    bridge: string
    bridgeToken: string
  }
  counterparty?: {
    chainId: number
    network: string
    bridge: string
    bridgeToken: string
  } | null
  demo?: {
    launchId?: string
    launchTx?: string
    bridgeMessage?: string
    bridgeTx?: string
    executeTx?: string
  }
}

const deploymentMap = deployments as Record<string, ProtocolDeployment>
const readProviderCache = new Map<number, StaticJsonRpcProvider>()

export const LAUNCHPAD_ABI = [
  'function admin() view returns (address)',
  'function launchCount() view returns (uint256)',
  'function createLaunch(string tokenName,string tokenSymbol,string metadataURI,uint256 totalSupply,uint256 virtualQuoteReserve,uint64 startAt,uint64 endAt) returns (uint256 launchId,address token)',
  'function createCuratedLaunch(string tokenName,string tokenSymbol,string metadataURI,uint256 totalSupply,uint256 virtualQuoteReserve,uint64 startAt,uint64 endAt) returns (uint256 launchId,address token)',
  'function buy(uint256 launchId,uint256 minTokensOut) payable returns (uint256 tokensOut)',
  'function quoteFor(uint256 launchId,uint256 quoteIn) view returns (uint256 tokensOut)',
  'function finalize(uint256 launchId)',
  'function setWhitelist(uint256 launchId,address account,bool allowed)',
  'function whitelist(uint256 launchId,address account) view returns (bool)',
  'function getLaunch(uint256 launchId) view returns (tuple(address creator,address token,string name,string symbol,string metadataURI,uint256 totalSupply,uint256 tokenReserve,uint256 quoteReserve,uint256 raised,uint64 startAt,uint64 endAt,bool curated,bool finalized))',
  'event LaunchCreated(uint256 indexed launchId,address indexed creator,address indexed token,bool curated,string metadataURI)',
  'event TokensPurchased(uint256 indexed launchId,address indexed buyer,uint256 quoteIn,uint256 tokensOut,uint256 quoteReserve,uint256 tokenReserve)',
] as const

export const BRIDGE_ABI = [
  'function admin() view returns (address)',
  'function relayer() view returns (address)',
  'function localChainId() view returns (uint256)',
  'function nextNonce() view returns (uint256)',
  'function isAdmin(address account) view returns (bool)',
  'function isRelayer(address account) view returns (bool)',
  'function bridgeOut(address token,uint256 targetChainId,address targetBridge,address recipient,uint256 amount,bytes payload) returns (bytes32 messageId)',
  'function executeMessage(bytes32 messageId,uint256 sourceChainId,address sourceBridge,address sourceToken,address recipient,uint256 amount,uint256 nonce,bytes payload)',
  'function processed(bytes32 messageId) view returns (bool)',
  'function trustedRemoteBridge(uint256 chainId) view returns (address)',
  'function remoteToken(uint256 chainId,address localToken) view returns (address)',
  'event MessageSent(bytes32 indexed messageId,uint256 indexed sourceChainId,uint256 indexed targetChainId,address sourceBridge,address targetBridge,address sourceToken,address targetToken,address sender,address recipient,uint256 amount,bytes payload,uint256 nonce)',
  'event MessageExecuted(bytes32 indexed messageId,uint256 indexed sourceChainId,address indexed recipient,address sourceToken,address targetToken,uint256 amount,address executor)',
] as const

export const BRIDGE_TOKEN_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function bridge() view returns (address)',
] as const

export type LaunchRecord = {
  id: number
  creator: string
  token: string
  name: string
  symbol: string
  metadataURI: string
  totalSupply: string
  tokenReserve: string
  quoteReserve: string
  raised: string
  startAt: number
  endAt: number
  curated: boolean
  finalized: boolean
}

export function protocolDeployments(): ProtocolDeployment[] {
  return Object.values(deploymentMap)
    .filter((item) => item && item.contracts?.launchpad && item.contracts?.bridge && item.contracts?.bridgeToken)
    .sort((a, b) => a.chainId - b.chainId)
}

export function protocolDeployment(chainId?: number): ProtocolDeployment | null {
  if (!chainId) return null
  return deploymentMap[String(chainId)] || null
}

export function protocolContract(
  address: string | undefined,
  abi: readonly string[],
  library: StaticJsonRpcProvider | Web3Provider | null | undefined,
  account?: string,
): Contract | null {
  if (!address || !library) return null
  return new Contract(address, abi, account ? library.getSigner(account) : library)
}

/**
 * Build a provider pinned to the deployment network. This is used for public
 * reads so the Launchpad remains usable before a wallet is connected and does
 * not inherit a stale or wrong-network injected provider.
 */
export function protocolReadProvider(deployment: ProtocolDeployment | null): StaticJsonRpcProvider | null {
  if (!deployment?.rpc) return null
  const cached = readProviderCache.get(deployment.chainId)
  if (cached) return cached

  const provider = new StaticJsonRpcProvider(deployment.rpc, {
    name: deployment.network,
    chainId: deployment.chainId,
  })
  readProviderCache.set(deployment.chainId, provider)
  return provider
}

export function launchFromTuple(id: number, value: any): LaunchRecord {
  return {
    id,
    creator: value.creator,
    token: value.token,
    name: value.name,
    symbol: value.symbol,
    metadataURI: value.metadataURI,
    totalSupply: value.totalSupply.toString(),
    tokenReserve: value.tokenReserve.toString(),
    quoteReserve: value.quoteReserve.toString(),
    raised: value.raised.toString(),
    startAt: Number(value.startAt),
    endAt: Number(value.endAt),
    curated: Boolean(value.curated),
    finalized: Boolean(value.finalized),
  }
}
