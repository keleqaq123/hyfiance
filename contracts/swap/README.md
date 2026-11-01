# Custos Swap Contracts

这是 Custos Finance 的 Hardhat 合约工作区，保留原有的 Uniswap V2-compatible Swap
原语、CRP/ConfigurableRightsPool、部署脚本和测试脚本。Spot、Perps 与 Real Market
测试环境的页面和 API 配置位于仓库的 `apps/web/` 与 `apps/api/`。

## 本地开发

```bash
npm install --legacy-peer-deps
npx hardhat deploy --network local --tags main
npm test
npx hardhat run --network local scripts/verify-local-interactions.js
```

默认本地 RPC 是 `http://127.0.0.1:7545`，部署结果写入
`deployments/local/main-contracts.json`。

`test/current/` 覆盖当前部署脚本和前端实际使用的 Uniswap V2-compatible
Factory、Router、WETH、Multicall、交易和流动性流程。仓库中原有的
Balancer/CRP 测试脚本仍保留在 `test/` 下作为历史资料，但对应的
`Factory`、`CRPFactory`、`LiquidityPool` 源码不在原始导入中，因此不属于当前
默认协议测试入口。

## 安全说明

本地部署脚本使用 Hardhat 测试账户和测试 Token。不要把本地私钥或测试部署用于真实网络。
