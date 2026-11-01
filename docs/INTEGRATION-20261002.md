# Main-first integration — 2026-10-02

## Preserved sources

- Original work: `backup/local-changes-before-main-sync-20261001`, `6e51fa3`.
- Previously verified VM fixes: `backup/server-hotfix-before-integration-20261002`;
  incorporated as `a020ab2` on the integration branch.
- Integration: `integrate/main-with-local-supplements-20261002`, based on
  remote main `373e4e3` (bridge deposit gas floor and wallet gas guidance).

This is a selective port, not a wholesale merge of the old snapshot.

## Decisions

| Area | Integration |
| --- | --- |
| Landing, branding, Reality UI, navigation, auth and wallet sessions | Keep main plus the independently verified VM hotfixes. |
| Official native ETH bridge | Keep main, including the newest gas-floor fix. |
| Legacy cUSD trusted-message bridge | Restore automatic Relayer, its source/deployment records and public-chain configs. `/defi/bridge` stays separate from `/reality/swap`. |
| Relayer deployment | Rebuildable Docker image; retain server wallet and persisted message/cursor state. |
| Legacy launchpad | Restore pinned public reads; `/defi/launchpad` remains the main Reality entry. The old module remains reachable at `/defi/launchpad/legacy`. |
| NFT | Keep new mint UI/sold-out handling and restored artwork/1,111 metadata; add missing original contracts/tests/deployment records. |
| GIWA V2 | Restore verified GIWA router/factory, chain-keyed pair cache and A/B tokens; use separate `V2_WETH` for routes/approvals/liquidity/wrapping, without replacing native WETH. |
| Backup Sep6 Spot/Perp/RWA deployments | Archive under `docs/archived-deployments/local-20260906`; merge deployment history. Do not change active main defaults or migrate balances/positions. |

Relayer recovery additionally retains submitted transaction hashes during RPC
receipt failures and honors the configured destination receipt confirmations.
GIWA token icons no longer probe nonexistent Ethereum-mainnet Trust Wallet art.
The Relayer pins a patched compatible `ws` 8.x via an npm override rather than
migrating the ethers API during this integration. Legacy ethers 5 elliptic
low-severity advisories remain; a major SDK migration is separate work.

## Verification

- Frontend: 171 tests passed; TypeScript and production build passed.
- SDK tests: chain-separated pair cache, verified GIWA pair and V2 ETH route
  encoding while retaining native WETH. Three pre-existing network tests skipped.
- Relayer unit tests: persistence/resume, no duplicate submission, confirmation
  count, RPC interruption recovery, retry backoff and onchain replay protection.
- Isolated dual-chain A→B and B→A automatic burn/mint, balances and receipts.
- NFT local contract tests and existing Reality/CFI isolated contract suites.
- Backend: 33 Reality and market-stream regression tests passed.
- Playwright with real Chrome: new routes, sold-out NFT/mobile artwork,
  verified-form draft retention, native bridge, cUSD Relayer health, old launchpad
  reads and actual GIWA V2 quote. No public onchain transactions submitted.
- Live RPC checks: SDK quote equals `router.getAmountsOut` at the same block;
  factory, router WETH and deterministic pair address match the deployment.

## External requirements not resolved by merging

At the time of integration, CFI deposits needed the original immutable vault
signer's secret. A later authorized replacement resolves that configuration:
see `CFI-REDEPLOYMENT-20261002.md` for the active vault and project signer.
Pyth Pro still needs a credential entitled to the configured feeds. Neither
issue can be fixed by replacing keys/contracts or showing fallback data as LIVE.
The NFT is genuinely sold out (1,111/1,111). This is testnet integration testing,
not a security audit or certification for mainnet use.

## VM release result

The integrated application at `c1e7282` was pushed to main and deployed to
https://www.custosfinance.xyz. API, frontend and Relayer containers are healthy;
Nginx configuration passed. On-server file hashes match the tested source.
Live Chrome verified all listed routes, mobile NFT layout, same-origin WebSocket
transport and a 1 CUSTOS-A → 0.996502 CUSTOS-B V2 quote without sending a trade.
Both Relayer chains scan with no errors and the existing two executed messages
are retained. SQLite files, wallet environment and runtime state were not replaced.

The compatible Relayer `ws` patch passed unit and isolated dual-chain tests;
its npm audit reports zero high/moderate/critical findings (14 low-severity
legacy ethers advisories remain). Rollback images and old hashed frontend
chunks are retained. The VM still has a small disk (~861 MB free immediately
after the application release); capacity expansion is recommended separately.
