FROM node:22-bookworm-slim AS build

WORKDIR /workspace

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
    && git config --global url."https://github.com/".insteadOf "git+ssh://git@github.com/" \
    && rm -rf /var/lib/apt/lists/*

COPY packages/swap-sdk ./packages/swap-sdk
RUN corepack enable \
    && cd packages/swap-sdk \
    && yarn install --frozen-lockfile --ignore-scripts \
    && yarn build

COPY apps/web/package.json apps/web/yarn.lock ./apps/web/
RUN cd apps/web && yarn install --frozen-lockfile --ignore-scripts

COPY apps/web ./apps/web

ARG VITE_API_BASE
ARG VITE_RELAYER_API_BASE=/relayer
ARG VITE_CHAIN_ID=91342
ARG VITE_NETWORK_URL=https://sepolia-rpc.giwa.io
ARG VITE_GIWA_RPC=https://sepolia-rpc.giwa.io
ARG VITE_GIWA_EXPLORER=https://sepolia-explorer.giwa.io
ARG VITE_GIWA_CHAIN_ID=91342

ENV VITE_API_BASE=${VITE_API_BASE} \
    VITE_RELAYER_API_BASE=${VITE_RELAYER_API_BASE} \
    VITE_CHAIN_ID=${VITE_CHAIN_ID} \
    VITE_NETWORK_URL=${VITE_NETWORK_URL} \
    VITE_GIWA_RPC=${VITE_GIWA_RPC} \
    VITE_GIWA_EXPLORER=${VITE_GIWA_EXPLORER} \
    VITE_GIWA_CHAIN_ID=${VITE_GIWA_CHAIN_ID}

RUN cd apps/web && yarn build

FROM nginx:1.27-alpine

ARG NGINX_CONFIG=deploy/nginx.conf
COPY ${NGINX_CONFIG} /etc/nginx/conf.d/default.conf
COPY deploy/security-headers.conf /etc/nginx/security-headers.conf
COPY deploy/cloudflare-real-ip.conf /etc/nginx/cloudflare-real-ip.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
RUN chmod -R a+rX /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
