# Hyfiance on Elysium Testnet

This checkout publishes to `keleqaq123/hyfiance`. The original Custos repository and its deployments are independent.

## Network

- Chain ID: **99801**, native gas: **HYPE**, 18 decimals.
- RPC: `https://testnet-rpc.elysium.kinetiq.xyz`
- Explorer: `https://testnet.elysium.kinetiq.xyz`
- Faucet: <https://elysium.kinetiq.xyz/testnet-faucet>
- Official bridge: <https://elysium.kinetiq.xyz/testnet-bridge>
- Network information: <https://www.alchemy.com/docs/reference/elysium-api-faq>
- Kinetiq builder documentation: <https://elysium.kinetiq.xyz/docs/building-on-elysium>

Do not use the unrelated Elysium chain IDs 1338/1339. The RPC chain ID is checked before deployment. This integration refuses other chains, including HyperEVM mainnet 999.

## Current state

Frontend and API can run locally now. Public-chain deployment remains **awaiting test HYPE**. See `deployments/elysium-testnet.json` for the actual deployment state. Empty addresses mean not deployed. Historical GIWA files are retained as reference, and are not used as Elysium contract addresses.

The dedicated deployer is `0xFc3FAB33fde4671851Dfb2Fb3802496AeC7F4607`. Its deployment key and the separate receipt-quote signing key exist only in the Git-ignored `.secrets/elysium-testnet.json`. This file is not included in source control or build output. Keep a private backup; a fresh clone does not contain these keys. Do not fund this test wallet on mainnet.

## Install and start

Use Node 22+ and Python 3.12. From the repository root:

```powershell
npm ci
npm run elysium:wallet
npm ci --prefix contracts/swap
npm ci --prefix contracts/markets
npm ci --prefix contracts/nft
npx --yes yarn@1.22.22 --cwd packages/swap-sdk install --frozen-lockfile
npm run build --prefix packages/swap-sdk
npx --yes yarn@1.22.22 --cwd apps/web install --frozen-lockfile
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r apps/api/requirements.txt
npm run elysium:configure
npm start
```

The initial dedicated wallet must exist locally before deployment. `elysium:configure` never generates or imports a production wallet and never reads credentials from Custos.

- App: <http://127.0.0.1:3001/reality>
- API documentation: <http://127.0.0.1:8001/docs>

`HYFIANCE_PYTHON` may point to an existing virtual environment Python executable. `npm start` runs both services on loopback, with strict frontend port selection. These processes run on this computer; they are not public website hosting.

## Compile, deploy and verify

Fund the dedicated address with Elysium **testnet** HYPE, then run:

```powershell
npm run elysium:compile
npm run elysium:check
npm run elysium:deploy
npm run elysium:smoke
npm run build --prefix packages/swap-sdk
# Refresh the local file dependency after rebuilding the SDK:
npx --yes yarn@1.22.22 --cwd apps/web install --force --frozen-lockfile
npm run build --prefix apps/web
```

Deployment intentionally uses precompiled artifacts. Restart both services after configuration changes.

The orchestrator deploys Swap + wrapped HYPE + test tokens and liquidity; synthetic RWA/Spot/Perps contracts; the Reality launchpad; a native-HYPE CFI receipt vault; and the community NFT contract. It saves module state and verifies code on chain. An interrupted module is marked `needs-review` and will not automatically redeploy. Inspect its transactions before retrying. Deployment stops between modules if spending exceeds 0.05 test HYPE; individual direct deployment estimates are capped at 0.01 test HYPE.

## Functional boundaries

- **Swap / liquidity:** project-owned V2 contracts and test token pools, not Ascend liquidity.
- **Launchpad / RWA:** existing independent project and proof-review workflow. New database files isolate the fork's users, uploads and points.
- **Spot / Perps:** project synthetic test markets. The initial Elysium deployment uses the owner-managed test-price oracle, not a verified Pyth deployment and not HyperCore trading. Prices expire under the contracts' freshness checks. Use `elysium:oracle` to refresh them from Pyth Hermes; stale or missing feeds are never assigned a fabricated fresh timestamp. Equity feeds may legitimately be stale while their markets are closed. No real funds belong in this test configuration.
- **CFI:** native HYPE principal receipts; no yield. The API reads HYPE mid prices from Hyperliquid and signs short-lived wallet-, amount-, nonce-, vault- and chain-bound quotes with the separate test quote signer. The vault trusts that signer. Its legacy EIP-712 domain name remains `Custos CFI Binance` for ABI compatibility; ETH prices are not used for HYPE deposits.
- **NFT:** separate free-mint deployment. The old GIWA NFT address is not reused.
- **Bridge / faucet:** explicit links to Elysium's official services. The old GIWA OP Stack bridge is not used for Elysium. A new project-operated gas sponsor and token relayer are not configured.
- **Hosting:** local services only. Public hosting, domain setup, persistent cloud storage and live HyperCore/HIP-3 execution are separate integrations.

## Checks performed

Frontend production build; frontend and API suites; SDK build; Swap, Markets and NFT compilation; local V2 liquidity/swap tests; local RWA/Spot/Perps integration tests; launchpad buy/sell and reserve isolation; CFI signature replay/chain binding and redemption; and an isolated complete deployment rehearsal with local chain ID 99801. None of these is a public Elysium deployment receipt.
