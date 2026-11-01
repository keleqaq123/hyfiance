# Full-site remediation — 2026-10-02

Scope: repair findings from the full-site audit and deploy without changing
contracts, private keys, user balances, existing databases or Relayer state.

## Applied changes

- Root persistent disk expanded online from 10 GB to 30 GB; `/dev/sda1` ext4
  grown in place. About 20 GB free afterward (30% used). No logs/images deleted.
  Existing daily snapshot policy remains attached. This increases disk billing.
- `custos-allow-web` now permits only tcp:80; existing HTTPS rule remains.
  Compose binds API port 8000 to loopback only. Nginx retains internal API/WS
  access; SSH, certificates and Relayer ports/state are unchanged.
- Nginx security headers: HSTS, nosniff, same-origin framing, restricted
  base/object/frame-ancestor CSP, Referrer-Policy and Permissions-Policy.
  Header include is repeated where cache directives override inheritance.
- Rankings table scrollport is positioned relative, anchoring absolutely
  positioned screen-reader labels inside it. The table remains horizontally
  scrollable without widening the whole mobile document.
- Explorer helper maps GIWA and Ethereum Sepolia explicitly; GIWA link labels
  no longer say Etherscan.
- Removed retired WalletConnect v1, Portis and Fortmatic connectors/menu items.
  Injected/MetaMask and Coinbase access remain. No QR v2 replacement is claimed;
  it needs its own project configuration. Avatar artwork uses a dependency-free
  public-address SVG instead of the vulnerable legacy color parser.
- Compatible security patches locked for ws, routing regex, hashing, secp256k1
  v3 and semver v5. Frontend production dependency audit changed from 57 findings
  (4 critical, 20 high, 18 moderate) to 17 low-only findings. Yarn lock is updated;
  npm override equivalents are included for local installs.
- Pyth Core errors return structured 503, not a successful empty/unsigned quote.
  Public-chain transactions cannot use the local mock or testnet fallback path.
  New perpetual orders require a fresh real Pyth quote; collateral withdrawal
  remains available independently of the oracle. Local mocks remain supported.
- History failures return safe structured errors, not upstream HTML/provider
  internals. UI displays the explanatory message. Perp health separates loaded
  credentials from actual fresh Pyth data and reports degraded status.

## External constraints — not falsely marked resolved

The current credential is loaded, but Pyth rejects every requested Pro feed and
Core BTC/ETH with `Not entitled`. An unauthenticated Core request returns 401.
Only a correctly entitled credential or provider-side grant can restore live
Pyth data. No keys were changed, printed or committed; no subscription purchased.
CFI Binance quotes and native/Relayer bridges are independent of Pyth.

The 17 remaining low dependency advisories propagate from elliptic/Ethers v5
and legacy Coinbase crypto helpers. Compatibility-preserving patched releases
cannot remove all of them. Resolving them requires a planned wallet/Ethers major
migration with transaction/signature regression tests; arbitrary cross-major
overrides are not a valid security fix. This is not a mainnet security audit.

## Verification

Remote main's real on-chain OHLC candles and red/green volume update (`4bdbec2`)
was merged before building, including its 4h/1d chart resolutions.
Frontend: 175 tests passed, TypeScript and fresh production build passed.
Backend: 46 tests passed, including denied/malformed oracle payload rejection,
local mock compatibility, structured history errors and degraded health.
Relayer: 3 persistence/retry/replay tests passed. Browser regression checks cover
mobile page containment with independent table scrolling, GIWA explorer links,
nonzero V2 quotes, retired-wallet removal and the disabled stale-oracle order.

## Deployed and verified

Live release: `0870ae7` on https://www.custosfinance.xyz. Both remote updates
were preserved: `4bdbec2` (OHLC) and `09d8caa` (two owner-selected admin wallets).
Frontend and backend release metadata match; Relayer stays at `76ff411` and was
not recreated. No new contracts or real economic transactions were submitted.

- 33 public/auth/error API checks returned the expected status. GIWA and
  Ethereum Sepolia RPC reads succeeded; same-origin WSS returned a snapshot.
- Ten main browser routes, V2 nonzero swap quote and mobile NFT page passed
  with no page errors. NFT remains sold out at 1111/1111, not a mint regression.
- Mobile Rankings root width stays 390px; horizontal scrolling belongs only to
  the table. Correct GIWA explorer targets and retired-wallet removal verified.
- Index, API and hashed static asset all return security headers. Public port
  8000 is unreachable; Docker publishes API only on `127.0.0.1:8000`.
- CFI anonymous and authenticated signed Binance quotes, EIP-712 digest,
  callStatic stake and gas estimation passed. Desktop/mobile quote UI passed.
  Existing user principal/supply were not assumed empty or changed by testing.
- Both Relayer networks are healthy and scanning; two executed message records
  remain. All three SQLite databases pass read-only `PRAGMA quick_check`.
- All containers have zero restarts. Secret env remains root-owned mode 600.
  The 1195-file frontend release scan contains no project deployment private key.
- Pyth credentials are present but unentitled. Core/history return safe 503;
  UI reports unavailable and disables new orders. This is intentionally degraded,
  not a restored live oracle.
- Seven stored Reality projects were administratively delisted before this
  deployment. The empty public list and anonymous detail 404 are expected;
  no project was restored/deleted. Existing chart records return real 4h/1d
  intervals (14400/86400 seconds). Chart component unit tests passed; anonymous
  browser chart interaction is unavailable while all projects are delisted.
- Final production npm audit: 17 low, zero moderate/high/critical. Root disk:
  30GB total, about 20GB free (31% used after release/rollback storage).

Browser regression used the `playwright-chrome-browser` skill with isolated
headless Google Chrome. Local preview processes created for QA were stopped.

## Rollback retained

Previous images: `custos-api:before-security-0870ae7` and
`custos-web:before-security-0870ae7`. Previous Compose, nginx/public env, backend
files and old frontend entry/assets/metadata remain at
`/opt/custos/rollback-security-0870ae7`. New immutable source/release contexts are
`/opt/custos/source-security-0870ae7` and
`/opt/custos/web-release-security-0870ae7`. Old hashed frontend chunks are retained
in the new image for already-open tabs. No images, databases or logs were pruned.

An application rollback can retag the retained images as `deploy-api:latest`
and `deploy-web:latest`, then run the existing Compose command with both env
files and `up -d --no-build --no-deps --wait api web`. Keep the new loopback port
binding/firewall and disk expansion; do not restore public port 8000. Restore
old public admin configuration only if explicitly requested. No DB rollback is
needed or implied by this code-only release.
