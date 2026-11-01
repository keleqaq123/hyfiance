# Custos protocol deployment log

## 2026-09-05 · local dual-chain smoke

- Chain A: `Custos Local A` (`47805`, `http://127.0.0.1:8545`)
  - Launchpad: `0xc5a5C42992dECbae36851359345FE25997F5C42d`
  - Bridge: `0x67d269191c92Caf3cD7723F116c85e6E9bf55933`
  - cUSD: `0xE6E340D132b5f46d1e472DebcD681B2aBc16e57E`
- Chain B: `Custos Local B` (`47806`, `http://127.0.0.1:8546`)
  - Launchpad: `0x322813Fd9A801c5507c9de605d63CEA4f2CE6c44`
  - Bridge: `0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f`
  - cUSD: `0x4A679253410272dd5232B3Ff7cF5dbB88f295319`
- Demo public launch: `Custos Bridge Launch` / `CDEMO`, launch `#1` on both chains.
- Demo relay: message `0x46ee036df246e0b92245d246c902acaa9d75d38c7233877a55d65931f90588c9` moved `100 cUSD` from A to B.
- Smoke test: public launch buy, curated whitelist buy, source burn, destination mint, and replay rejection all passed.

The complete transaction hashes and JSON deployment metadata are in the adjacent network records and the pair record. Future runs also append a timestamped file under `deployments/history/`.

## Public testnet

Pending deployer key injection and selection of the second EVM testnet endpoint. No public-network transaction has been sent by this deployment run.
