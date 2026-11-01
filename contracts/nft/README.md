# GIWA Genesis NFT

This module contains the rewritten Custos NFT mint surface and the small
ERC-721 contract deployed to GIWA Sepolia.

- Chain ID: `91342`
- RPC: `https://sepolia-rpc.giwa.io`
- Explorer: `https://sepolia-explorer.giwa.io`
- Collection: `GIWA Genesis (GIWA)`
- Supply: `1111`
- Wallet limit: `1`
- Testnet mint price: `0.0001 ETH`
- Payment: native GIWA test ETH

## Commands

Run commands from this directory:

```bash
npm install
npm test
npm run compile
npm run deploy:giwa
npm run smoke:giwa
```

The deployment config reads `PRIVATE_KEY` and `GIWA_RPC_URL` from the existing
untracked `../markets/.env` by default. A different private env file can be
selected with `CUSTOS_NFT_ENV_FILE`. No private key is written to deployment
records or frontend files.

`deploy-giwa-nft.js` validates chain ID `91342`, deploys with the configured
price and metadata base URI, writes `deployments/giwa-sepolia.json`, creates an
immutable timestamped record under `deployments/history/`, and updates
`apps/web/src/custos/nftDeployment.json`.

`smoke-giwa-nft.js` performs a real testnet mint when the deployer has not
minted yet. It verifies supply, wallet limit, ownership, token URI, and that a
second mint from the same wallet is rejected. The result is appended to the
deployment record and saved as a separate history entry.

The frontend metadata is served from `/nft/metadata/` after the web build is
published. The contract base URI is configured as:

```text
https://www.custosfinance.xyz/nft/metadata/
```
