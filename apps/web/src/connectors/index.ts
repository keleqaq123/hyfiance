import { Web3Provider } from '@ethersproject/providers'
import { InjectedConnector } from '@web3-react/injected-connector'
import { WalletLinkConnector } from '@web3-react/walletlink-connector'

import { NetworkConnector } from './NetworkConnector'

const NETWORK_URL = import.meta.env.VITE_NETWORK_URL || import.meta.env.VITE_GIWA_RPC || 'https://sepolia-rpc.giwa.io'

export const NETWORK_CHAIN_ID: number = parseInt(import.meta.env.VITE_CHAIN_ID ?? import.meta.env.VITE_GIWA_CHAIN_ID ?? '91342', 10)

if (typeof NETWORK_URL === 'undefined') {
  throw new Error(`VITE_NETWORK_URL must be a defined environment variable`)
}

export const network = new NetworkConnector({
  urls: { [NETWORK_CHAIN_ID]: NETWORK_URL }
})

let networkLibrary: Web3Provider | undefined
export function getNetworkLibrary(): Web3Provider {
  return (networkLibrary = networkLibrary ?? new Web3Provider(network.provider as any))
}

export const injected = new InjectedConnector({
  supportedChainIds: NETWORK_CHAIN_ID===99801 ? [99801] : [1, 3, 4, 5, 42, 1337, 31337, 47805, 47806, 12357, 91342, 11155111]
})

// Retired hosted wallets and WalletConnect v1 are not bundled.
export const walletlink = new WalletLinkConnector({
  url: NETWORK_URL,
  appName: 'Custos Swap',
  appLogoUrl:
    'https://mpng.pngfly.com/20181202/bex/kisspng-emoji-domain-unicorn-pin-badges-sticker-unicorn-tumblr-emoji-unicorn-iphoneemoji-5c046729264a77.5671679315437924251569.jpg'
})
