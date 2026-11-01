# Custos Swap Interface

Custos Swap 的 React + Vite 前端，使用仓库内的 `custoswap-sdk` 与本地 Hardhat 合约进行开发和验证。

## 开发

在 `apps/web/` 目录执行：

```bash
yarn install
yarn dev
```

默认访问地址：`http://127.0.0.1:3001`。

## 配置

环境变量位于 `.env`，前端使用：

```text
VITE_CHAIN_ID=47805
VITE_NETWORK_URL=http://127.0.0.1:7545
```

仓库根目录的一键脚本会在本地部署合约后自动同步这些地址、SDK 配置和 TokenList：

```bash
cd ..
./scripts/run-local-full.sh
```

## 验证

```bash
yarn build
yarn test
yarn lint
```
