const { keccak256, toUtf8Bytes } = require('ethers');

function id(value) {
  return keccak256(toUtf8Bytes(value));
}

const FEEDS = Object.freeze({
  BTC: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  ETH: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  SOL: '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  AAPL: '0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688',
  NVDA: '0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593',
  XAU: '0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2',
  // Keep these IDs byte32-sized.  The previous XAG value had one extra
  // hexadecimal character and was rejected by Hermes/Pyth Core.
  XAG: '0xf2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e',
  // USOILSPOT was retired from the current Hermes catalogue.  WTIX6 is the
  // currently accessible October 2026 WTI reference used by this testnet.
  OIL: '0xf8c2191e76f7f4d5335e7f4e8f81ab0df6360d54ee020874222841894203e9d7',
});

// Testnet-only safety prices used when a Pyth feed is gated or temporarily
// unavailable to the deployer's entitlement. Pyth remains the preferred
// source whenever a signed update is available.
const FALLBACK_ORACLE_PRICES = Object.freeze({
  BTC: '100000',
  ETH: '4000',
  SOL: '200',
  AAPL: '220',
  NVDA: '180',
  XAU: '2300',
  XAG: '28',
  OIL: '80',
});

const SPOT_MARKETS = Object.freeze([
  {
    key: 'XAU',
    name: 'Custos Synthetic Gold',
    symbol: 'rXAU',
    underlying: 'XAU/USD',
    pythSymbol: 'Metal.XAU/USD',
    unit: '1 token = 1 troy oz gold reference',
    price18: '2300',
  },
  {
    key: 'XAG',
    name: 'Custos Synthetic Silver',
    symbol: 'rXAG',
    underlying: 'XAG/USD',
    pythSymbol: 'Metal.XAG/USD',
    unit: '1 token = 1 troy oz silver reference',
    price18: '28',
  },
  {
    key: 'OIL',
    name: 'Custos Synthetic WTI',
    symbol: 'rWTI',
    underlying: 'WTI/USD',
    pythSymbol: 'Commodities.WTIX6/USD',
    unit: '1 token = 1 barrel WTI reference',
    price18: '75',
  },
]);

const PERP_MARKETS = Object.freeze([
  { key: 'BTC', maxPriceAge: 120, maxLeverageBps: 100000, maintenanceMarginBps: 500, maxConfidenceBps: 100, maxOpenInterestUsd: '250000', price18: '100000' },
  { key: 'ETH', maxPriceAge: 120, maxLeverageBps: 100000, maintenanceMarginBps: 500, maxConfidenceBps: 100, maxOpenInterestUsd: '200000', price18: '4000' },
  { key: 'SOL', maxPriceAge: 120, maxLeverageBps: 100000, maintenanceMarginBps: 600, maxConfidenceBps: 125, maxOpenInterestUsd: '150000', price18: '200' },
  { key: 'AAPL', maxPriceAge: 600, maxLeverageBps: 50000, maintenanceMarginBps: 1000, maxConfidenceBps: 100, maxOpenInterestUsd: '100000', price18: '220' },
  { key: 'NVDA', maxPriceAge: 600, maxLeverageBps: 50000, maintenanceMarginBps: 1000, maxConfidenceBps: 100, maxOpenInterestUsd: '100000', price18: '180' },
  { key: 'XAU', maxPriceAge: 120, maxLeverageBps: 50000, maintenanceMarginBps: 750, maxConfidenceBps: 100, maxOpenInterestUsd: '100000', price18: '2300' },
]);

const RWA_MARKETS = Object.freeze([
  { key: 'rKINV26', name: 'Korea Export Invoice 2026', assetType: 'Trade Invoice', maturity: '2027-08-30', risk: 31, supply: '1000000', weight: 30, metadataURI: 'ipfs://custos-rwa-demo/rkinv26' },
  { key: 'rSOLAR27', name: 'Solar Equipment Lease', assetType: 'Equipment Lease', maturity: '2027-12-15', risk: 39, supply: '1000000', weight: 45, metadataURI: 'ipfs://custos-rwa-demo/rsolar27' },
  { key: 'rCOFFEE26', name: 'Coffee Supply Receivable', assetType: 'Supply-chain Receivable', maturity: '2027-10-20', risk: 58, supply: '1000000', weight: 25, metadataURI: 'ipfs://custos-rwa-demo/rcoffee26' },
]);

function spotFeedId(key) {
  return FEEDS[key];
}

function perpMarketId(key) {
  // Keep the identifier compatible with the existing Perps terminal and the
  // source deployment bundle: keccak256(`${symbol}-USD`).
  return id(`${key}-USD`);
}

function rwaAssetId(key) {
  return id(`CUSTOS-RWA:${key}:v1`);
}

module.exports = {
  FEEDS,
  SPOT_MARKETS,
  PERP_MARKETS,
  RWA_MARKETS,
  FALLBACK_ORACLE_PRICES,
  spotFeedId,
  perpMarketId,
  rwaAssetId,
};
