#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const configPath = process.argv[2] || 'scripts/branding.config.json'
const resolvedConfigPath = path.resolve(root, configPath)

if (!fs.existsSync(resolvedConfigPath)) {
  console.error(`Brand config not found: ${resolvedConfigPath}`)
  process.exit(1)
}

const config = JSON.parse(fs.readFileSync(resolvedConfigPath, 'utf8'))

const brandName = config.brandName || 'Custos Swap'
const brandShort = config.brandShort || 'Custos'
const brandUpper = brandShort.toUpperCase()
const brandSlug = config.brandSlug || 'custoswap'

const dynamicReplacements = [
  { from: 'CustosSwapV2Router', to: `${brandShort}SwapV2Router` },
  { from: 'CustosSwap_fi', to: `${brandShort}Swap_fi` },
  { from: 'Custos Swap V2', to: config.lpTokenName || `${brandName} V2` },
  { from: 'CUSTOS-V2', to: config.lpTokenSymbol || `${brandUpper}-V2` },
  { from: 'Custos Swap', to: brandName },
  { from: 'custoswap', to: brandSlug },
  { from: 'CUSTOS', to: brandUpper },
  { from: 'Custos', to: brandShort }
]

const replacements = [...dynamicReplacements, ...(config.replacements || [])]

const missing = []
let updatedCount = 0

for (const relativeFile of config.files || []) {
  const absFile = path.resolve(root, relativeFile)
  if (!fs.existsSync(absFile)) {
    missing.push(relativeFile)
    continue
  }

  const before = fs.readFileSync(absFile, 'utf8')
  let after = before

  for (const rule of replacements) {
    if (!rule || typeof rule.from !== 'string' || typeof rule.to !== 'string') continue
    after = after.split(rule.from).join(rule.to)
  }

  if (after !== before) {
    fs.writeFileSync(absFile, after, 'utf8')
    updatedCount += 1
    console.log(`Updated ${relativeFile}`)
  }
}

if (config.tokenLogoFileFrom && config.tokenLogoFileTo) {
  const from = path.resolve(root, config.tokenLogoFileFrom)
  const to = path.resolve(root, config.tokenLogoFileTo)
  if (fs.existsSync(from) && !fs.existsSync(to)) {
    fs.copyFileSync(from, to)
    console.log(`Copied ${config.tokenLogoFileFrom} -> ${config.tokenLogoFileTo}`)
  }
}

if (missing.length) {
  console.warn('Missing files:')
  missing.forEach(file => console.warn(`- ${file}`))
}

console.log(`Done. Updated ${updatedCount} file(s).`)
