# Google Cloud deployment

## Current production: Compute Engine + Docker Compose

The live site is https://www.custosfinance.xyz (also custosfinance.xyz).
It runs in `/opt/custos` on `instance-20260827-085236`, zone `us-central1-a`,
project `project-9c37ed4e-4de1-4d0f-9db`. This is **not** the historical Cloud Run
deployment below. The VM runs `custos-web`, `custos-api`, and
`custos-bridge-relayer`; Nginx serves `/api/`, `/ws/`, and `/relayer/` on the
same origin.

Keep `/opt/custos/.env`, `/opt/custos/runtime-data`, and TLS certificates intact.
The root-readable `.env` holds secrets; `deploy/reality.vm.env` contains public
Reality contract configuration only. Load both files for Compose operations:

```bash
cd /opt/custos
sudo -n docker compose --env-file /opt/custos/.env \
  --env-file /opt/custos/deploy/reality.vm.env \
  -f /opt/custos/deploy/compose.vm.yaml up -d --no-build --wait --wait-timeout 180
```

The relayer uses `deploy-relayer`, now rebuildable from `apps/relayer` using
`docker compose ... build relayer`. Retain the old image's rollback tag.
Its wallet and JSON state persist across deployments.
CFI now uses vault `0x91618694D70100edd9e6508A1d680Ea4E0797592`, whose immutable
signer is the existing project wallet `0xee379A4fC908F03Cd886197945bf964806709D97`.
For this explicitly requested testnet replacement, `deploy/reality.vm.env`
references the first env file's `RELAYER_PRIVATE_KEY` as `CFI_QUOTE_SIGNER_KEY`.
No private key is committed. Load both env files in the order shown above.
A production rollout should use a separate signing wallet and vault, not share
the funded Relayer key with the API. See `docs/CFI-REDEPLOYMENT-20261002.md`.

### Low-disk frontend releases

The VM root disk was expanded from 10 GB to 30 GB on October 2. Compile and test the frontend locally instead of
installing Node dependencies on the VM. Build `packages/swap-sdk` first; refresh
the frontend's `file:` SDK dependency if it was installed before an SDK update.

```bash
cd packages/swap-sdk
yarn install --frozen-lockfile --ignore-scripts
yarn build
cd ../../apps/web
yarn install --frozen-lockfile --ignore-scripts --force
npm test
release_dir=$(mktemp -d /tmp/custos-web-release.XXXXXX)
VITE_API_BASE='' VITE_CHAIN_ID=91342 \
VITE_NETWORK_URL=https://sepolia-rpc.giwa.io \
VITE_GIWA_RPC=https://sepolia-rpc.giwa.io \
VITE_GIWA_EXPLORER=https://sepolia-explorer.giwa.io \
VITE_GIWA_CHAIN_ID=91342 VITE_RELAYER_API_BASE=/relayer \
npm run build -- --outDir "$release_dir/dist" --emptyOutDir
cp ../../deploy/frontend-static.Dockerfile "$release_dir/Dockerfile"
cp ../../deploy/nginx.vm.conf "$release_dir/nginx.vm.conf"
cp ../../deploy/security-headers.conf "$release_dir/security-headers.conf"
cp ../../deploy/cloudflare-real-ip.conf "$release_dir/cloudflare-real-ip.conf"
tar -czf "$release_dir.tar.gz" -C "$release_dir" .
```

Upload the archive with `gcloud compute scp` using the project/zone above,
extract into a new explicit release directory under `/opt/custos`, and build
`docker build -t deploy-web <release-directory>`. Tag the currently running web
image as a rollback image before replacing `deploy-web`. Before building, copy
the old container's `/usr/share/nginx/html/assets` into a separate directory
and merge missing hashed chunks into the new `dist/assets`; this keeps existing
open tabs working. Do not replace the new `index.html` with the old one.

Build the backend from the updated source with `docker compose ... build api`;
do not invoke the memory/disk-heavy default web build on this VM. Validate
Nginx (`nginx -t` with the Compose network and certificate mount), then run the
Compose command above. Check `/api/health`, `/api/reality/config`,
`/relayer/health`, `/ws/markets`, desktop/mobile pages and the server disk.
Retain rollback images; never delete runtime databases or relayer state to
recover build space. NFT artwork and `public/nft/metadata` must be included in
the local source before building.

## Historical / alternative Cloud Run deployment

The optional Cloud Run setup uses two public services:

- `custos-api`: FastAPI API and WebSocket market stream
- `custos-web`: Vite-built static frontend served by Nginx

The script uses the current gcloud project and defaults to `asia-east2`:

```bash
gcloud config set project project-002102bc-53ba-48fd-9a8
./deploy/cloudrun.sh
```

Optional overrides:

```bash
CLOUD_RUN_REGION=asia-east1 \
CLOUD_RUN_API_SERVICE=custos-api \
CLOUD_RUN_WEB_SERVICE=custos-web \
./deploy/cloudrun.sh
```

The image build intentionally excludes local `.env` files and SQLite databases. Cloud Run's writable filesystem is ephemeral, so the demo database is initialized under `/tmp`; use Cloud SQL or another persistent store before treating this as production data.

The current Google Cloud project must have an open Billing account before Cloud Run, Cloud Build, or Artifact Registry can be enabled.
