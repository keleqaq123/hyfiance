# hyfiance

这是一个本地可完整跑通的 DEX 项目仓库，包含：
- 合约工程（Hardhat）
- SDK（`custoswap-sdk` 本地源码版）
- 前端（React）
- TokenList
- 一键全流程脚本（改名 + 本地链 + 部署 + 回填 + 验证 + 启动前端）

## 仓库结构

- `contracts/swap/`：Swap/CRP 合约与本地部署、测试脚本
- `packages/swap-sdk/`：SDK 源码（前端通过本地 `file:` 依赖）
- `apps/web/`：React 前端，包含原有 Swap、Spot、Perps、CRP 相关页面
- `apps/api/`：Spot/Perps/Real Market 测试环境 API
- `assets/tokenlist/`：Token 列表与图标
- `scripts/`：仓库级自动化脚本

## 快速开始（一键）

在仓库根目录执行：

```bash
./scripts/run-local-full.sh
```

执行内容：
1. 应用品牌配置
2. 启动或复用本地 Hardhat 节点（`127.0.0.1:7545`）
3. 部署本地 Factory/Router/WETH/Multicall/测试代币
4. 自动回填 SDK 与前端地址配置
5. 构建 SDK
6. 安装前端依赖
7. 执行链上 Swap 验证
8. 启动 Custos API（`http://127.0.0.1:8001`）
9. 启动前端（`http://127.0.0.1:3001`）

## 常用参数

```bash
# 跳过前端依赖安装（已装过时更快）
./scripts/run-local-full.sh --skip-install

# 跳过启动前端（只做部署和验证）
./scripts/run-local-full.sh --no-start-frontend

# 只启动前端/合约流程，不启动已在运行的 API
./scripts/run-local-full.sh --no-start-backend

# 手动同步本地前端 token logo（可选）
node scripts/sync-local-config.js \
  --branding-config scripts/branding.config.json \
  --rpc-url http://127.0.0.1:7545 \
  --frontend-url http://127.0.0.1:3001

# 指定品牌配置文件
./scripts/run-local-full.sh --branding-config scripts/branding.config.json
```

## 品牌配置

编辑：`scripts/branding.config.json`

然后执行：

```bash
node scripts/apply-branding.js scripts/branding.config.json
```

说明：
- 默认品牌为 `Custos Swap/Custos`
- `custoswap-sdk` 是前端使用的本地 SDK 包名

## 本地网络信息

- RPC: `http://127.0.0.1:7545`
- Chain ID: `47805`（前端也兼容 `31337/1337`）
- 前端环境变量文件：`apps/web/.env`

Hardhat 默认账号（部署账号）：
- Address: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
- Private Key: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`

## 产物与关键文件

- 本地部署结果：`contracts/swap/deployments/local/main-contracts.json`
- 一键脚本：`scripts/run-local-full.sh`
- 地址回填脚本：`scripts/sync-local-config.js`
- 交互验证脚本：`contracts/swap/scripts/verify-local-interactions.js`

## 详细文档

完整说明见：`PROJECT_GUIDE.md`
