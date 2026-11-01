# Custos Reality Launchpad

The root page and `/#/defi/launchpad` now open the Reality application. Existing DeFi routes remain available. This implementation targets **GIWA Sepolia, chain 91342**. It does not claim a deployed GIWA mainnet contract.

## Implemented flows

- Wallet message authentication, expiring sessions, owned image uploads, immutable project metadata.
- Permissionless fixed-supply token launch: no platform approval and no verification badge.
- Asset-proof submission with a random challenge, private evidence, administrator review, approval/rejection/revocation and audit records. Administrators cannot review their own projects.
- Explore, market, rankings, project detail, likes, collections, watchlists, comments and one community valuation per wallet. Community valuation is separate from token price.
- Fixed-supply launch contract with native ETH bonding-curve purchases and sales. Receipt verification binds the token to its project. No creator reserve withdrawal, privileged minting or graduation mechanism.
- A resumable trade-event index provides real 24-hour volume and change. Missing or stale data displays a dash.
- ERC-20 swaps through a configured Uniswap V2-compatible router, direct or WETH routes, actual quotes, explicit approval, deadlines and slippage protection. Availability depends on deployed pools and liquidity.

Verification attests to reviewed proof. Creating an ERC-20 does not itself transfer legal ownership or establish a right to property or income. Those documents and issuance terms must be supplied for individual asset-backed projects.

## Local development

1. Install Python dependencies from `apps/api/requirements.txt` in a virtual environment.
2. Configure `apps/api/.env.example` variables in the process environment. `REALITY_DATA_DIR` must be a persistent directory. Set `FRONTEND_ORIGIN=http://127.0.0.1:3001` for development.
3. In `apps/api`, run `python -m uvicorn main:app --host 127.0.0.1 --port 8001`.
4. Install and build `packages/swap-sdk` before installing `apps/web` so its local package includes `dist`.
5. In `apps/web`, run `yarn install --frozen-lockfile`, then `yarn dev --host 127.0.0.1 --port 3001`. Vite proxies `/api` to port 8001.

## Contract and tests

In `contracts/launch-bridge`, run `yarn install --frozen-lockfile`, `yarn build:reality`, then `yarn test:reality`. The compiler writes matching frontend deployment and backend bytecode-validation artifacts. The contract test uses an isolated local chain with chain ID 91342; it does not send transactions to GIWA.

Backend checks: `python -m pytest apps/api/test_reality.py` (install pytest separately). Frontend checks: `yarn build` in `apps/web`.

## Deployment prerequisites

Set `REALITY_ADMIN_WALLETS` to comma-separated public administrator wallet addresses. A signed-in administrator can deploy the compiled launch contract through the review/configuration page using their own wallet and test ETH, then save its address. The backend verifies its deployed bytecode. No private key should be put in the application or sent in chat.

Set `REALITY_PLATFORM_TOKEN`, `REALITY_SWAP_ROUTER` and `REALITY_SWAP_FACTORY` to actual contracts on GIWA Sepolia. A router must be compatible with the swap interface and match the factory. Without these contracts and funded liquidity pools, the UI correctly disables quotes and exchanges.

For a persistent VM, configure `deploy/compose.vm.yaml` and run the existing Docker deployment. Keep `VITE_API_BASE` empty for the same-origin `/api` reverse proxy; set `FRONTEND_ORIGIN` and `REALITY_PUBLIC_ORIGIN` to your public HTTPS origin. Back up `runtime-data`. Uploaded public images are re-encoded, and private proof files require owner or administrator authentication.

For Cloud Run, configure `REALITY_DATABASE_URL` (PostgreSQL) and `REALITY_GCS_BUCKET` (private bucket), plus the service identity's database/storage access. Reality refuses Cloud Run's ephemeral local filesystem. Provide a reliable GIWA RPC for production traffic.

## Current limits

Contracts need independent security review before accepting valuable funds. Chain confirmations and the event index are not guarantees against deep reorganizations. The current ranking view loads up to 60 recent projects; a global market index and price-sorted pagination remain future work. The application does not supply fiat prices, automatic legal verification, marketplace shipping/escrow, real-property rights enforcement, external tokenization integrations or perpetual markets for newly launched tokens.

The code is locally runnable. Updating the public site requires repository push and access to its deployment environment; adding these files alone does not change the running website.

## Community pricing language

Custos presents real-world content as project themes. Community purchases and
sales form the token price through the existing ETH curve. Likes and bookmarks
express interest; the optional valuation form is labeled “价值看法” (value opinion)
and does not set token quotes. The blue verification badge denotes reviewed
reality evidence, not a platform appraisal or a guaranteed price.

## Token price charts

Issued-token detail pages include 1-hour, 24-hour and 7-day price histories, ETH
volume bars and the latest 50 trades within the selected period. The chart is
refreshed every 15 seconds. Chart points are the final post-trade reserve quote
in each occupied time bucket; trade rows show average execution prices instead.
Empty time buckets are not synthesized. The index waits for two confirmations
and polls every 30 seconds. Stale or incomplete index data is labeled, and totals
are unavailable until synchronized. A bounded query shows at most 5,000 trades
and explicitly labels truncation. No-trade histories display an empty state.

Chart resolution controls: 1m, 5m, 15m, 1h aggregate price and volume independently of the visible 1h/24h/7d time range. The default UI resolution is 1m.

## CFI staking and account center (October 1, 2026)

The Reality UI is English. Account pages provide display-name editing, native ETH/CFI/principal balances, project holdings and wallet-scoped transaction history.

Active GIWA Sepolia (91342) vault and account-bound CFI receipt: `0x91618694D70100edd9e6508A1d680Ea4E0797592`.
Deployment transaction: `0x192a3cf475abf72b24b29466839feeb365ec4454a3ab24519f8587f855420d9f`, block 37573108 (October 2 replacement).
Immutable quote signer: project wallet `0xee379A4fC908F03Cd886197945bf964806709D97`.
Previous Binance vault `0xE38214dEAC49b139d1a6376b3A58Ff72B3D0eE87` had zero principal/supply/balance before replacement. Its missing immutable signing key prevented new signed deposits; no funds were migrated.

- ETH stays in the immutable contract. There is no administrator withdrawal.
- Minting uses the Binance public ETHUSDT ticker: https://data-api.binance.vision/api/v3/ticker/price?symbol=ETHUSDT . No Binance API key or Pyth subscription is required for this staking flow.
- CFI minted = deposited ETH multiplied by its current ETH/USDT price. A 1 ETH deposit at 2,000 USDT mints 2,000 CFI; at 2,222 USDT it mints 2,222 CFI. USDT is the quote currency, not a guaranteed USD price.
- Binance does not sign the onchain quote. The contract trusts the configured backend operator signer. EIP-712 quotes bind the wallet, amount, price, nonce, chain and vault, expire within 60 seconds and cannot be replayed. Quotes refresh every 15 seconds in the visible UI; a new signed quote is fetched before each deposit.
- CFI has 18 decimals and is account-bound. Burning the entire balance returns the original ETH principal; partial burns return proportional principal. Multiple deposits aggregate. CFI is a receipt with no dollar peg or promised yield.
- A price/API failure blocks new deposits but does not block withdrawals. Unstaking requires no oracle or backend price quote.
- The first confirmed stake earns 100 Season 1 points once per wallet. GIWA transaction receipts are verified automatically.
- The previous Pyth vault `0xE6ad5FE166edeA0B949180168E928Ee6AA9B7137` had zero principal before switching. Its source and deployment record remain historical; no user deposits were migrated.

### Backend configuration

```env
REALITY_CFI_STAKING=0x91618694D70100edd9e6508A1d680Ea4E0797592
REALITY_CFI_START_BLOCK=37573108
REALITY_CFI_PRICE_SOURCE=binance
CFI_QUOTE_SIGNER_KEY=
```

The replacement explicitly uses the existing project wallet. On the VM, Compose resolves `CFI_QUOTE_SIGNER_KEY` from the secret `RELAYER_PRIVATE_KEY`; tracked configuration contains only a variable reference. Do not generate a different key for this immutable signer or put a key in a VITE_ variable. Production should separate signer and Relayer wallets. Pyth settings remain independent of CFI staking.

Contract commands in `contracts/launch-bridge`: `node scripts/compile-cfi-binance.cjs`, `node scripts/test-cfi-binance.cjs`. The deployment script estimates by default and sends only with `--send`; an existing verified record is reused.

Validation: production frontend build and 22 backend tests passed. Contract tests cover price conversion, tampering, signer/chain/vault binding, quote expiry, nonce replay, slippage, custody and partial/full redemption. A live Binance signed quote was recovered to the configured signer and its digest matched the deployed GIWA contract. No user staking transaction was submitted during verification.

## Distinct Markets and Rankings views

### Original Season 1 leaderboard

The Season page defaults to the Original Season 1 leaderboard from `/api/beta/leaderboard?limit=100`. Reality tasks remain available in a separate tab; historical and new points are not combined or re-awarded. Rank, wallet, points, verified transactions and qualified referrals retain their original backend values.

The local original database was restored using a SQLite backup from the user's previous project, preserving the source unchanged. The snapshot contains one participant, nine recorded transactions and 535 points. `BETA_DATABASE_PATH` in the private backend environment selects the snapshot. Project ZIPs exclude databases; preserve the separate `Custos-Season1-History.sqlite3` backup when moving the backend and point `BETA_DATABASE_PATH` at the restored file.

### Native ETH Bridge (testnet)

The main navigation now calls `/#/reality/swap` **Bridge**. This route contains a native ETH bridge between Ethereum Sepolia (11155111) and GIWA Sepolia (91342), using viem 2.38.0 OP Stack actions and official GIWA contract addresses. RWA trading remains at `/#/reality/swap/rwa`; existing liquidity routes remain separately available.

Deposits use the official Sepolia OptimismPortal. The page tracks the source receipt and derived GIWA deposit receipt before showing completion. Withdrawals use GIWA's L2ToL1MessagePasser, then expose **Prove withdrawal** and **Claim ETH on Sepolia** only when the chain reports readiness. Withdrawals can take up to two hours to become provable and roughly seven days through the challenge period. Each action requires the user's wallet signature; Custos never receives the bridged ETH.

History is saved locally per wallet, not automatically scanned across all wallet transactions. A source transaction hash can be imported and verified against its sender, official bridge contract and destination. The history displays source/delivery/proof/claim explorer links, actual status and retriable RPC errors. Pending writes are recorded immediately after the wallet returns their transaction hash.

The backend exposes `/api/reality/bridge/rpc/sepolia` and `/api/reality/bridge/rpc/giwa` as fixed-network, read-only RPC proxies. `SEPOLIA_RPC_URL` and `GIWA_RPC_URL` can select server-side endpoints. Send-transaction, signing and admin RPC methods are rejected. No paid widget or API key is required by this integration.

Validated with ten mocked bridge-flow tests, 26 backend tests, production build, live chain IDs and bytecode checks for the official Portal, MessagePasser and DisputeGameFactory, plus desktop/mobile UI checks. No wallet transfer was signed during validation; the full withdrawal challenge period has not been exercised end to end.

Official reference: https://docs.giwa.io/giwa-chain/en/get-started/bridging/eth

### Liquidity navigation within Reality

Liquidity views remain available at `/reality/pool` in the white Reality shell. Add liquidity, import pools, position add/remove actions, token changes and back navigation remain under `/reality/pool/*`. These views reuse the existing Custos V2 contract integrations. Legacy liquidity routes keep their original navigation. Production build and browser checks confirmed Pool → Add Liquidity → back → Import Pool without leaving the Reality interface; no liquidity transaction was submitted during UI verification.

- Markets (`/#/reality/market`) is now a photo-first catalog of confirmed issued projects: category filters, search, evidence verification filter, a seven-day Recent listings view, wallet-owned watchlist, community favourites sorting, ETH price/market-cap cards and project trading links. The launchpad continues to handle creation and issuance.
- Rankings (`/#/reality/rankings`) is a compact screener. Its global backend ordering supports Trending (unique traders, then ETH volume), Top gainers, Volume and New launches; metrics can be scoped to 5m/1h/6h/24h. Change, volume and trader columns support ascending/descending sorting, with category/verification filters and pagination.
- Confirmed launch receipt timestamps are durably indexed in `reality_launch_listings`; New launches and Recent listings use those timestamps rather than draft creation dates.
- Prices and actual ETH liquidity come from the configured GIWA launch contract. Virtual curve liquidity is excluded. Seven-day sparklines contain actual confirmed hourly post-trade records; a single observation is displayed as one point. Missing reference prices and stale index metrics stay null, and unknown metrics sort last.
- The market catalog uses owned images and real project metadata only. No mockup sample assets, invented prices or generated price curves are added to the database. Both views refresh every 30 seconds and support narrow-screen layouts.
- Validated: production frontend build, 18 backend checks including wallet-scoped watchlists, issuance timestamps, global ranking/pagination, time periods, missing-data behavior and live quote decoding. Browser checks confirm category filtering, the 5m switch, evidence filtering and actual project rendering.
### Ranking load performance

Ranking metrics come from the local confirmed-trade index. Live GIWA quote requests run independently, share in-flight work across filters, and cache successful results for 30 seconds. First-load quote waiting is bounded to 150 ms; an unavailable node cannot hold the table behind a spinner. During refresh, confirmed trade prices remain visible and missing liquidity stays blank. The client retrieves pending quotes after two seconds without clearing the table. Quotes older than 90 seconds are not reused.

### Site-wide loading performance

- Only the launchpad and project portfolio request the shared project list. Other routes no longer trigger unrelated list, price and activity requests.
- Memory-only API read caching and in-flight deduplication reuse requests across page visits. Credentials and every mutation invalidate the cache, including pending results; failed reads are not cached. Staking execution quotes always bypass this cache.
- Launchpad, Markets, project details and Rankings share server-side quote work. Price results appear per project without waiting for an entire batch. Confirmed trade prices can appear while current reserves load; unavailable reserves remain blank.
- Read-only Ethereum providers reuse connections and have a ten-second timeout. Server-side RPC calls reuse a connection pool. NFT and CFI display data have short-lived, wallet-scoped caches; execution still validates fresh onchain values.
- Public project images support 96/480/960-pixel WebP previews and ETag revalidation. Original private evidence retains its authorization and no-store policy.
- Legacy DeFi and swap modules load on demand. The main production script decreased from approximately 2.56 MB to 1.49 MB (uncompressed). Local port 3001 now serves the production build through Vite preview with the API proxy. After source edits, rebuild before refreshing this preview: run `yarn build`, then `yarn preview` from `apps/web`.
- Local API sample: list 4 ms, detail 3 ms, history 2 ms; a cold display quote returned in 159 ms. These are API timings, not guarantees of end-to-end browser rendering or external GIWA confirmations.
- Validation: production frontend build, 21 backend tests, and cache checks covering deduplication, expiration, wallet/write invalidation and failed-read retry. Browser checks cover launchpad, detail, swap, NFT, staking and Season 1 without submitting transactions.

## Reality listing moderation
The administrator dashboard has no public navigation link; direct URL access still requires a signed administrator wallet session. Administrators can delist any project with a recorded reason and restore it later. Delisted projects are excluded from Explore, Markets, Rankings, activity and token discovery. Public detail access is blocked; creators and administrators retain access to their records. Onchain tokens and holder balances are unchanged. Delisting revokes an existing Blue V; restoring a listing does not restore verification. Public token metadata remains available for onchain compatibility.


### Module navigation performance (2026-10-01)

- Navigation warms Markets/Rankings data after initial rendering and preloads Bridge code and verification on hover, keyboard focus or pointer-down. Project links prefetch their detail reads.
- Market, ranking, chart, NFT, staking and account views can reuse a matching in-memory display snapshot for up to 60 seconds while their normal API refresh runs. Filters use distinct keys; credentials, wallet changes and writes invalidate snapshots. There is no persistent cache of private account/evidence data.
- NFT collection and wallet mint fields now use one Multicall3 read instead of six/seven individual eth_call requests. A live GIWA check returned the real collection name, supply, limits and price in one RPC call.
- Bridge network verification is deduplicated and reused for 30 seconds for display; every deposit, proof and claim forces fresh verification before a wallet write. Executable staking/trading quotes still bypass display caching.
- Season public data renders independently instead of waiting for all three requests. Original leaderboard reads are deduplicated with a bounded timeout. Detail views remount per project/wallet to prevent showing another project's cached state.
- Validated: 151 frontend tests, cache snapshot expiration and wallet/write invalidation checks, production build and browser navigation through Markets, Rankings, NFT Mint, Season 1, Stake, Account and Bridge. Local list APIs completed in 4–11 ms during the sample; browser click operations were 35–69 ms, which measures navigation input handling rather than completion of live RPC data. No transaction was signed.

### Live original Season 1 leaderboard

`Original Season 1` now reads the previous public site's `/api/beta/leaderboard?limit=100` through the new read-only `/api/reality/season/original-leaderboard` backend route. The local one-participant SQLite backup is retained but is no longer the source for this leaderboard tab. Source ranks, wallets, points, transaction counts and referrals remain unchanged; Reality tasks stay in their own tab and do not re-award or merge old points.

The server validates remote entries, deduplicates requests and caches successful reads for 30 seconds. A temporary outage can return a clearly marked last successful snapshot for up to five minutes; it never silently substitutes the one-participant backup. Verified live first row: wallet 0xb2d0273b926c27df0be2a659bdd776c5096cf216, 38,410 points, 443 transactions, 345 referrals. All 100 returned rows are displayed. Backend checks: 29 passed; production build passed.

This is live read integration, not a production database migration. Before replacing the previous production backend or its domain routing, preserve and migrate its real Season 1 database or keep the old API at a separate stable origin.


## Public-route performance update (2026-10-01)

Reality and the landing page no longer mount the legacy Redux/Web3 providers, token-list updaters, multicall updaters or transaction watchers. These providers are loaded and mounted only for legacy trading routes and the V2 pool module. The existing pool selector and wallet contexts remain functional.

NFT, Season, Account, Stake and the price chart load as separate modules; navigation hover/focus prepares the relevant module. The Reality shell remains visible while a module loads. The hash router stays outside the Suspense boundary so its navigation subscription survives first-time module loading. Market and ranking polling pauses in hidden tabs and refreshes when visible; chart refreshes cannot overlap. Market quote updates are coalesced per animation frame and identical display quotes retain their existing state. Number formatters are reused. Chart geometry is memoized and cursor selection uses binary search over sorted recorded prices.

Production-build comparison against the pre-update local archive: the static JavaScript required for Reality entry decreased from 1,492,802 bytes to 636,931 bytes (57.3%); gzip equivalent decreased from 454,860 to 192,596 bytes. This measures build dependency bytes, excluding optional modules, CSS, photos and fonts; it is not a guarantee of end-to-end network loading time.

Validation: TypeScript and production build; 152 frontend tests (including cold lazy-route navigation and return); cache isolation checks; 30 API tests; Reality, CFI and Binance CFI contract tests. Browser checks covered the landing page, eight Reality navigation modules, V2 pool selection and 5-minute chart selection. Navigation heading observations were 64–126 ms in the local preview; these include browser-control overhead and do not measure completion of RPC reads. A timing-sensitive retry test failed once under concurrent test/contract load, then passed in isolation and in the complete suite with two workers.

Executable trade and staking quotes remain fresh. Wallet signing, RPC confirmation and bridge settlement are not accelerated by these display optimizations.
