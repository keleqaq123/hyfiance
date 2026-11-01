# Reality functional audit — October 1, 2026

## Fixed

- GIWA token selection previously threw `Cannot read properties of undefined (reading 'map')` in CommonBases. Chain configuration now supports GIWA and unknown-chain fallbacks.
- The local SDK now includes GIWA Sepolia and its verified native WETH predeploy. A verified Multicall3 address is configured for chain reads.
- Token lists can introduce a new chain without crashing. Bundled GIWA tokens remain available when an older token-list selection is persisted.
- Liquidity routes, pair choices and back navigation remain in the white Reality shell.
- A render error now presents a recovery screen rather than an empty page. Local builds preserve old hashed chunks used by existing preview tabs.

## Validation

- 137 frontend tests across 18 files passed, including GIWA and unknown-chain selector regressions.
- 22 backend tests passed: signed authentication, replay rejection, uploads/ownership/private proofs, certification authorization, reactions/comments/opinions, issuance receipts, tasks/referrals/X visits, account/profile/holdings/history, chart buckets, market filters and global ranking metrics, cache latency, images and authenticated Binance quotes.
- Frontend production build and cache isolation/deduplication tests passed.
- Isolated Reality launchpad tests passed: permissionless issuance, supply, buy/sell, approvals, slippage/deadlines and reserve isolation.
- Isolated CFI tests passed: conversion, EIP-712 signer/wallet/amount/chain/vault binding, expiration, replay prevention and partial/full ETH redemption.
- 24 live same-origin API checks passed; protected routes correctly rejected anonymous access. A live Binance signed quote matched the digest on the deployed GIWA vault.
- Browser checks: every main route opens; market verification filtering/reset, actual project rendering, chart 5m switching, sell switching, ranking 5m/Volume controls, and GIWA token selection work.

## GIWA V2 correction — October 2 integration

The original audit checked only old-chain addresses: router `0x70E5370b8981Abc6e14C91F4AcE823954EFC8eA3` and factory `0xb868Cc77A95a65F42611724AF05Aa2d3B6Ec05F2` return empty code on GIWA. The preserved local branch actually contains deployed GIWA V2 infrastructure: router `0x4F1F5E8DE722e2773e7794af41ca0863457943C5`, factory `0x349a1CBB28C6267B4B567A06b2661Af8d6A1a1f5`, and A/B pair `0x1A649Eb1D48D7962D3f72A54311CA4048590B25A`. Read-only RPC checks verified code, router factory/WETH, pair tokens/reserves and a nonzero quote. The integration configures those addresses and removes the blanket GIWA disable guards; no new contracts were deployed.

The V2 router's WETH is `0xeDBc87C8c03af5eB8Ff2C97ae9708719Ed050b66`, exposed separately as `V2_WETH`. GIWA native `WETH` remains `0x4200000000000000000000000000000000000006`. V2 routes, wrapping, approvals and liquidity permits use V2-specific configuration. Regression tests cover pair cache isolation by chain and ETH route encoding.

Issued Reality launch tokens trade through the separately deployed Reality launchpad. CFI staking uses its separately deployed Binance vault. Neither integration is replaced by the legacy V2 configuration.

Wallet signing and economic transactions were not submitted in the browser during this audit. Buy/sell/stake/redeem were tested on an isolated chain; live RPC/quote checks were read-only. This audit does not certify mainnet readiness or constitute a security audit.

When reinstalling, build `packages/swap-sdk` before installing `apps/web` so the file dependency contains the updated GIWA SDK distribution, as described in REALITY-LAUNCHPAD.md.
