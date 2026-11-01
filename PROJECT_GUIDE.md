# 项目完整说明（Project Guide）

## 1. 目标

本项目用于本地完整验证一个可交互 DEX 系统，覆盖：
- 本地链启动
- 核心合约部署
- SDK 地址同步
- 前端配置同步
- 前后端交互验证（含链上 swap）
- 品牌文案可配置替换

## 2. 子项目职责

### 2.1 `contracts/swap/`
- Hardhat 工程
- 本地部署脚本：`scripts/deploy-local-uniswap.js`
- 交互验证脚本：`scripts/verify-local-interactions.js`
- 部署输出：`deployments/local/main-contracts.json`

### 2.2 `packages/swap-sdk/`
- 前端依赖的 SDK
- 关键配置：
  - `src/constants.ts`（`FACTORY_ADDRESS`、`INIT_CODE_HASH`）
  - `src/entities/token.ts`（WETH 地址与代币信息）

### 2.3 `apps/web/`
- React 前端
- 使用本地 SDK：`package.json` 中 `"custoswap-sdk": "file:../../packages/swap-sdk"`
- 关键配置：
  - `src/constants/index.ts`（`ROUTER_ADDRESS`）
  - `src/constants/multicall/index.ts`
  - `.env`（`VITE_CHAIN_ID`、`VITE_NETWORK_URL`）

### 2.4 `assets/tokenlist/`
- Token list 与图标资源
- 一键流程会自动生成用于本地调试的 tokenlist（并同步到前端 `public/tokenlist.json`）

### 2.5 `scripts/`
- `branding.config.json`：品牌替换配置
- `apply-branding.js`：按配置批量替换文案
- `sync-local-config.js`：将部署结果自动回填到 SDK/前端/tokenlist
- `run-local-full.sh`：一键全流程脚本

## 3. 一键全流程

```bash
./scripts/run-local-full.sh
```

流程分解：
1. 读取品牌配置并执行替换
2. 检查 `7545` 端口，未启动则拉起 Hardhat 节点
3. 部署本地合约
4. 回填地址与本地网络配置
5. 构建 SDK
6. 安装前端依赖
7. 执行链上 swap 验证
8. 启动前端服务

## 4. 品牌配置机制

### 4.1 配置文件
- 文件：`scripts/branding.config.json`
- 核心字段：
  - `brandName`
  - `brandShort`
  - `lpTokenName`
  - `lpTokenSymbol`
  - `replacements[]`
  - `files[]`

### 4.2 使用方式

```bash
node scripts/apply-branding.js scripts/branding.config.json
```

建议：
- 先改配置，再跑 `run-local-full.sh`，确保文案与部署配置同步。

## 5. 本地网络与钱包

推荐 MetaMask 新增网络：
- Network Name: `Custos Swap Local`
- RPC URL: `http://127.0.0.1:7545`
- Chain ID: `47805`
- Currency Symbol: `ETH`

兼容说明：
- 前端注入钱包支持链：`1,3,4,5,42,1337,31337,47805,12357`

## 6. 常用命令

### 6.1 全流程
```bash
./scripts/run-local-full.sh
```

### 6.2 仅部署+回填+验证（不装依赖、不起前端）
```bash
./scripts/run-local-full.sh --skip-install --no-start-frontend
```

### 6.3 仅同步配置（部署后）
```bash
node scripts/sync-local-config.js --branding-config scripts/branding.config.json --rpc-url http://127.0.0.1:7545
```

本地调试时可额外传入 `--frontend-url http://127.0.0.1:3001`，让 TokenList 使用本地 Custos 图标；不传时使用配置中的相对图标路径。

### 6.4 查看本地部署地址
```bash
cat contracts/swap/deployments/local/main-contracts.json
```

## 7. 常见问题

### 7.1 提示 `Please connect to the appropriate network`
原因：钱包链 ID 不在前端支持列表内，或当前网络不是本地 RPC。  
处理：切换/新增到 `http://127.0.0.1:7545` + chainId `47805`。

### 7.2 前端白屏或环境变量未生效
原因：Vite 只会注入以 `VITE_` 开头的环境变量，或前端服务仍在使用旧构建产物。
处理：确认 `apps/web/.env` 中存在 `VITE_CHAIN_ID` 和 `VITE_NETWORK_URL`，重启 Vite 服务。

### 7.3 `npm install` 依赖冲突
原因：前端依赖包含历史 peer 依赖约束。
处理：使用 `yarn install --frozen-lockfile`（一键脚本和 Docker 构建已统一使用 Yarn）。

### 7.4 本地链端口冲突
处理：
- 结束占用 7545 的进程，或
- 复用当前进程并确保 chainId 与部署网络一致。

## 8. 安全说明

当前私钥和网络均为本地测试用途，仅用于开发联调。  
不要将本地测试私钥用于真实网络。

## 9. 后续建议

- 如需稳定 CI，可增加：
  - `make local-up` / `make local-down`
  - Playwright 端到端自动化
  - 对 `sync-local-config.js` 增加更多可配置项（token 符号、logo URI、RPC/chain 多环境）
