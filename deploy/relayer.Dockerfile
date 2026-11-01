FROM node:20-alpine

WORKDIR /app/apps/relayer

COPY apps/relayer/package.json apps/relayer/package-lock.json ./
RUN npm ci --omit=dev

WORKDIR /app
COPY apps/relayer ./apps/relayer
COPY contracts/launch-bridge/deployments ./contracts/launch-bridge/deployments

WORKDIR /app/apps/relayer
CMD ["node", "src/index.cjs"]
