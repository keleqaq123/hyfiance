#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${CLOUD_RUN_REGION:-asia-east2}"
REPOSITORY="${ARTIFACT_REPOSITORY:-custos}"
API_SERVICE="${CLOUD_RUN_API_SERVICE:-custos-api}"
WEB_SERVICE="${CLOUD_RUN_WEB_SERVICE:-custos-web}"
VITE_CHAIN_ID="${VITE_CHAIN_ID:-91342}"
VITE_NETWORK_URL="${VITE_NETWORK_URL:-https://sepolia-rpc.giwa.io}"
VITE_GIWA_RPC="${VITE_GIWA_RPC:-https://sepolia-rpc.giwa.io}"
VITE_GIWA_EXPLORER="${VITE_GIWA_EXPLORER:-https://sepolia-explorer.giwa.io}"
VITE_GIWA_CHAIN_ID="${VITE_GIWA_CHAIN_ID:-91342}"

if [[ -z "$PROJECT_ID" || "$PROJECT_ID" == "(unset)" ]]; then
  echo "Google Cloud project is not configured. Set GOOGLE_CLOUD_PROJECT first." >&2
  exit 1
fi

gcloud config set project "$PROJECT_ID" >/dev/null

if [[ "$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null || true)" != "True" ]]; then
  echo "Billing is not enabled for project $PROJECT_ID. Open or attach an active Billing account, then rerun this script." >&2
  exit 2
fi

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

if ! gcloud artifacts repositories describe "$REPOSITORY" --location="$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPOSITORY" \
    --repository-format=docker \
    --location="$REGION" \
    --description="Custos Cloud Run images"
fi

IMAGE_ROOT="$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY"
API_IMAGE="$IMAGE_ROOT/$API_SERVICE:$(date +%Y%m%d-%H%M%S)"
WEB_IMAGE="$IMAGE_ROOT/$WEB_SERVICE:$(date +%Y%m%d-%H%M%S)"

echo "Building API image..."
gcloud builds submit . \
  --config=deploy/cloudbuild.backend.yaml \
  --substitutions="_IMAGE=$API_IMAGE"

echo "Deploying API..."
API_URL="$(gcloud run deploy "$API_SERVICE" \
  --image="$API_IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=1Gi \
  --cpu=1 \
  --max=3 \
  --timeout=3600 \
  --set-env-vars="GIWA_RPC_URL=https://sepolia-rpc.giwa.io,GIWA_FLASHBLOCKS_RPC_URL=https://sepolia-rpc-flashblocks.giwa.io,GIWA_EXPLORER_URL=https://sepolia-explorer.giwa.io,DATABASE_PATH=/tmp/rwa_exchange.db,BETA_DATABASE_PATH=/tmp/kelq_beta.db" \
  --format='value(status.url)')"

echo "Building web image..."
gcloud builds submit . \
  --config=deploy/cloudbuild.frontend.yaml \
  --substitutions="_IMAGE=$WEB_IMAGE,_VITE_API_BASE=$API_URL,_VITE_CHAIN_ID=$VITE_CHAIN_ID,_VITE_NETWORK_URL=$VITE_NETWORK_URL,_VITE_GIWA_RPC=$VITE_GIWA_RPC,_VITE_GIWA_EXPLORER=$VITE_GIWA_EXPLORER,_VITE_GIWA_CHAIN_ID=$VITE_GIWA_CHAIN_ID"

echo "Deploying web..."
WEB_URL="$(gcloud run deploy "$WEB_SERVICE" \
  --image="$WEB_IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=256Mi \
  --cpu=1 \
  --max=3 \
  --format='value(status.url)')"

echo "Updating API CORS origin..."
gcloud run services update "$API_SERVICE" \
  --region="$REGION" \
  --update-env-vars="FRONTEND_ORIGIN=$WEB_URL"

echo
echo "Custos deployed"
echo "Web: $WEB_URL"
echo "API: $API_URL"
