# Hyfiance — Custos core experience on Elysium Testnet

## Scope

Keep the original Custos Finance project workflow: launchpad and proof review, project token markets and rankings, token swaps and liquidity, native-HYPE CFI receipts, NFT minting, account/profile/history, and the official Elysium bridge/faucet entry points.

Independent synthetic RWA, oracle Spot and Perpetual modules are disabled. Season/points/tasks/referrals and their administration endpoints are disabled. The application does not automatically register wallets in a points campaign. `networks/elysium-features.json` defines this scope for deployment and runtime.

This checkout publishes only to `keleqaq123/hyfiance`. The original `custosDefi/custos-Finance` repository and its deployed contracts are independent.

## Network and current deployment

- Elysium Testnet chain ID **99801**, native gas **HYPE** (18 decimals).
- RPC: `https://testnet-rpc.elysium.kinetiq.xyz`
- Explorer: <https://testnet.elysium.kinetiq.xyz>
- Faucet: <https://elysium.kinetiq.xyz/testnet-faucet>
- Official bridge: <https://elysium.kinetiq.xyz/testnet-bridge>
- Network reference: <https://www.alchemy.com/docs/reference/elysium-api-faq>

The active contracts are deployed on the public testnet:

| Module | Address |
| --- | --- |
| Swap router | `0x01E9D616A064dC8E3a8ed43154631Abf06D402A1` |
| Swap factory | `0xa4ebF13e03ED586e33296896317AC79A1f7ACEE5` |
| Wrapped HYPE | `0xD1fB6128C215a8E30a482C31535a591fd41e9d5B` |
| Project launchpad | `0x6324bF0c17ACE5Da6404415aEA5c861e3CAe7Db5` |
| CFI receipt vault | `0xF9e8067285db6a6488a2d831782ec9D913f13115` |
| Community NFT | `0x3dCc1d199C08B6B4CF6E4C8f8d4D332400Ed9569` |

`deployments/elysium-testnet.json` contains deployment receipts and the active module state. `docs/ELYSIUM-LIVE-CHECK.json` records the actual testnet lifecycle transactions. Historical GIWA deployments remain source references and are not Elysium addresses.

The earlier synthetic-market deployment attempt was stopped when the user changed scope. Already confirmed transactions at deployer nonces 9–45 cannot be reversed; those partial contracts are excluded from the active configuration. No remaining synthetic-market deployment or oracle updater is started.

## Install and start

Use Node 22+ and Python 3.12. From the repository root:

```powershell
npm ci
npm ci --prefix contracts/swap
npm ci --prefix contracts/nft
npx --yes yarn@1.22.22 --cwd packages/swap-sdk install --frozen-lockfile
npm run build --prefix packages/swap-sdk
npx --yes yarn@1.22.22 --cwd apps/web install --frozen-lockfile
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r apps/api/requirements.txt
npm run elysium:configure
npm start
```

- Home: <http://127.0.0.1:3001/>
- App: <http://127.0.0.1:3001/#/reality>
- Project swaps: <http://127.0.0.1:3001/#/reality/swap/rwa>
- V2 liquidity: <http://127.0.0.1:3001/#/reality/pool>
- API documentation: <http://127.0.0.1:8001/docs>

`HYFIANCE_PYTHON` may point to an existing virtual-environment Python. The local app uses a hash router. These services run on this computer; public website hosting and domain configuration are separate from the public-chain contract deployments.

A fresh clone can use the public deployment manifest without deployment keys. To deploy a new instance, generate a dedicated test wallet with `npm run elysium:wallet`, fund it with test HYPE, then compile and deploy. Do not overwrite an existing deployment manifest to force a redeployment. The deployer and separate quote signer are stored only in the Git-ignored `.secrets/elysium-testnet.json`; no credentials are committed. Copy them only through a private local backup if moving this test instance.

## Deployment and verification commands

```powershell
npm run elysium:compile
npm run elysium:check
npm run elysium:deploy
npm run elysium:smoke
npm run build --prefix packages/swap-sdk
npx --yes yarn@1.22.22 --cwd apps/web install --force --frozen-lockfile
npm run build --prefix apps/web
```

Existing confirmed modules are skipped. New deployment runs include only Swap, launchpad, CFI and NFT; no synthetic markets. The orchestrator checks chain 99801 before signing and verifies the active deployed code. Interrupted modules require transaction inspection before retrying. Receipt/nonce recovery checks are retained in the deployment manifest. Restart both local services after configuration changes.

## Runtime behavior

- Project issuance, proof review and token trading remain the original independent Custos workflow. Testnet participation is not rewarded with points.
- Swap uses project-owned V2 contracts, a wrapped-HYPE contract and seeded test-token liquidity. It does not imply Ascend liquidity or HyperCore order-book integration.
- The CFI vault holds native HYPE principal, with account-bound receipts and proportional redemption. It does not earn yield. The API reads HYPE mid prices from Hyperliquid and signs short-lived account/amount/nonce/vault/chain-bound quotes using a separate test signer. The legacy EIP-712 domain name remains `Custos CFI Binance`; ETH prices are not used for HYPE deposits.
- NFT minting is free, with one mint per wallet. Metadata currently points to the local app and can be updated by the collection owner when a public hosting origin is configured.
- Bridge and faucet link to Elysium's official services. The old GIWA OP Stack bridge is not used for Elysium. A project-operated gas sponsor and token relayer are not configured.
- The API exposes Reality/project/account functions and the faucet entry, plus health/docs. Season, admin points, legacy synthetic market and beta-task routes return 404 and are not included in its OpenAPI description.

## Validation

See `docs/ELYSIUM-VALIDATION.json` for current check results. Public deployment receipts and lifecycle transactions are separate from earlier local rehearsals. Mainnet deployment, public website hosting, and HyperCore/HIP-3 execution are outside this testnet integration.
