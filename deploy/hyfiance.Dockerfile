FROM node:22-bookworm-slim AS web
WORKDIR /workspace
RUN corepack enable
COPY packages/swap-sdk ./packages/swap-sdk
RUN cd packages/swap-sdk && yarn install --frozen-lockfile --ignore-scripts && yarn build
COPY apps/web/package.json apps/web/yarn.lock ./apps/web/
RUN cd apps/web && yarn install --frozen-lockfile --ignore-scripts
COPY apps/web ./apps/web
COPY networks ./networks
ENV VITE_API_BASE="" \
    VITE_CHAIN_ID=99801 \
    VITE_GIWA_CHAIN_ID=99801 \
    VITE_NETWORK_URL=https://testnet-rpc.elysium.kinetiq.xyz \
    VITE_GIWA_RPC=https://testnet-rpc.elysium.kinetiq.xyz \
    VITE_GIWA_EXPLORER=https://testnet.elysium.kinetiq.xyz \
    VITE_NFT_ADDRESS=0x3dCc1d199C08B6B4CF6E4C8f8d4D332400Ed9569
RUN cd apps/web && yarn build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 CUSTOS_CHAIN_ID=99801
WORKDIR /workspace/apps/api
COPY apps/api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY apps/api/*.py apps/api/*.json ./
COPY networks /workspace/networks
COPY deployments/elysium-testnet.json /workspace/deployments/elysium-testnet.json
COPY --from=web /workspace/apps/web/dist /workspace/apps/web/dist
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn hosted:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers"]
