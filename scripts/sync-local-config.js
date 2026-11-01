#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const root = process.cwd()

function argValue(flag, fallback) {
  const idx = process.argv.indexOf(flag)
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeFile(file, content) {
  fs.writeFileSync(file, content, 'utf8')
  console.log(`Updated ${path.relative(root, file)}`)
}

function replaceSingle(file, pattern, replacement, label) {
  const src = fs.readFileSync(file, 'utf8')
  if (!pattern.test(src)) {
    throw new Error(`Failed to locate ${label} in ${path.relative(root, file)}`)
  }
  const next = src.replace(pattern, replacement)
  if (next === src) {
    console.log(`Unchanged ${path.relative(root, file)} (${label})`)
    return
  }
  writeFile(file, next)
}

const deployFile = path.resolve(root, 'contracts/swap/deployments/local/main-contracts.json')
if (!fs.existsSync(deployFile)) {
  console.error(`Missing deployment file: ${deployFile}`)
  process.exit(1)
}

const brandConfigFile = path.resolve(root, argValue('--branding-config', 'scripts/branding.config.json'))
let brandConfig = {
  brandName: 'Custos Swap',
  brandShort: 'Custos',
  tokenLogoURI: './custos-icon.png'
}
if (fs.existsSync(brandConfigFile)) {
  brandConfig = loadJson(brandConfigFile)
}

const deployment = loadJson(deployFile)
const chainId = Number(argValue('--chain-id', String(deployment.chainId || 47805)))
const rpcUrl = argValue('--rpc-url', 'http://127.0.0.1:7545')
const frontendUrl = argValue('--frontend-url', '')

const { contracts, initCodeHash } = deployment
if (!contracts || !contracts.factory || !contracts.router || !contracts.multicall || !contracts.weth) {
  console.error('Invalid deployment json, missing core contract addresses.')
  process.exit(1)
}

replaceSingle(
  path.resolve(root, 'packages/swap-sdk/src/constants.ts'),
  /export const FACTORY_ADDRESS = '0x[0-9a-fA-F]+'/,
  `export const FACTORY_ADDRESS = '${contracts.factory}'`,
  'FACTORY_ADDRESS'
)

replaceSingle(
  path.resolve(root, 'packages/swap-sdk/src/constants.ts'),
  /export const INIT_CODE_HASH = '0x[0-9a-fA-F]+'/,
  `export const INIT_CODE_HASH = '${initCodeHash}'`,
  'INIT_CODE_HASH'
)

replaceSingle(
  path.resolve(root, 'packages/swap-sdk/src/entities/token.ts'),
  /\[ChainId\.REI\]: new Token\(ChainId\.REI, '0x[0-9a-fA-F]+'/,
  `[ChainId.REI]: new Token(ChainId.REI, '${contracts.weth}'`,
  'WETH ETH'
)

replaceSingle(
  path.resolve(root, 'packages/swap-sdk/src/entities/token.ts'),
  /\[ChainId\.REITEST\]: new Token\(ChainId\.REITEST, '0x[0-9a-fA-F]+'/,
  `[ChainId.REITEST]: new Token(ChainId.REITEST, '${contracts.weth}'`,
  'WETH REITEST'
)

replaceSingle(
  path.resolve(root, 'apps/web/src/constants/index.ts'),
  /export const ROUTER_ADDRESS = '0x[0-9a-fA-F]+'/,
  `export const ROUTER_ADDRESS = '${contracts.router}'`,
  'ROUTER_ADDRESS'
)

replaceSingle(
  path.resolve(root, 'apps/web/src/constants/multicall/index.ts'),
  /\[ChainId\.REI\]: '0x[0-9a-fA-F]+'/,
  `[ChainId.REI]: '${contracts.multicall}'`,
  'MULTICALL REI'
)

replaceSingle(
  path.resolve(root, 'apps/web/src/constants/multicall/index.ts'),
  /\[ChainId\.REITEST\]: '0x[0-9a-fA-F]+'/,
  `[ChainId.REITEST]: '${contracts.multicall}'`,
  'MULTICALL REITEST'
)

const envFile = path.resolve(root, 'apps/web/.env')
const existingEnv = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : ''
const preservedEnv = existingEnv
  .split(/\r?\n/)
  .filter((line) => line.trim() && !/^\s*VITE_(CHAIN_ID|NETWORK_URL)=/.test(line))
const envKeys = new Set(preservedEnv.map((line) => line.split('=', 1)[0].trim()))
const envDefaults = [
  'VITE_API_BASE="http://127.0.0.1:8001"',
  'VITE_GIWA_RPC="https://sepolia-rpc.giwa.io"',
  'VITE_GIWA_EXPLORER="https://sepolia-explorer.giwa.io"',
  'VITE_GIWA_CHAIN_ID="91342"',
].filter((line) => !envKeys.has(line.split('=', 1)[0]))
const envLines = [`VITE_CHAIN_ID="${chainId}"`, `VITE_NETWORK_URL="${rpcUrl}"`, ...envDefaults, ...preservedEnv]
writeFile(envFile, `${envLines.join('\n')}\n`)

const brandShort = String(brandConfig.brandShort || 'Custos')
const brandUpper = brandShort.toUpperCase()
const listName = String(brandConfig.brandName || 'Custos Swap')
const configuredTokenLogoURI = String(
  brandConfig.tokenLogoURI || './custos-icon.png'
)
const tokenLogoURI = frontendUrl
  ? new URL('/custos-icon.png', frontendUrl).toString()
  : configuredTokenLogoURI
const wrappedNativeLogoURI = 'https://raw.githubusercontent.com/Uniswap/assets/master/blockchains/ethereum/info/logo.png'
const tokenlist = {
  name: listName,
  logoURI: tokenLogoURI,
  keywords: ['defi', 'local'],
  timestamp: new Date().toISOString(),
  tokens: [
    {
      chainId,
      address: contracts.tokenA,
      name: `${brandShort} Token A`,
      symbol: `${brandUpper}-A`,
      decimals: 18,
      logoURI: tokenLogoURI
    },
    {
      chainId,
      address: contracts.tokenB,
      name: `${brandShort} Token B`,
      symbol: `${brandUpper}-B`,
      decimals: 18,
      logoURI: tokenLogoURI
    },
    {
      chainId,
      address: contracts.weth,
      name: 'Wrapped Ether',
      symbol: 'WETH',
      decimals: 18,
      logoURI: wrappedNativeLogoURI
    }
  ],
  version: {
    major: 2,
    minor: 1,
    patch: 0
  }
}

writeFile(path.resolve(root, 'assets/tokenlist/tokenlist.json'), `${JSON.stringify(tokenlist, null, 2)}\n`)
writeFile(path.resolve(root, 'apps/web/public/tokenlist.json'), `${JSON.stringify(tokenlist, null, 2)}\n`)
writeFile(path.resolve(root, 'apps/web/src/constants/default-token-list.json'), `${JSON.stringify(tokenlist, null, 2)}\n`)

console.log('Sync complete.')
