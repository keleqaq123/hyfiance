const fs = require('fs');
const path = require('path');
const hre = require('hardhat');

const OUTPUT = path.join(__dirname, '..', 'deployments', 'elysium-testnet', 'main-contracts.json');

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();
  const chain = await deployer.provider.getNetwork();
  if (Number(chain.chainId) !== 99801) {
    throw new Error(`Expected Elysium Testnet (99801), got ${chain.chainId}`);
  }

  console.log(`Network: ${network.name} (${chain.chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.utils.formatEther(await deployer.getBalance())} HYPE`);

  const wethArtifact = require('@uniswap/v2-periphery/build/WETH9.json');
  const WETH9 = new ethers.ContractFactory(wethArtifact.abi, wethArtifact.bytecode, deployer);
  const weth = await WETH9.deploy();
  await weth.deployed();

  const Factory = await ethers.getContractFactory('UniswapV2Factory');
  const factory = await Factory.deploy(deployer.address);
  await factory.deployed();

  const Router = await ethers.getContractFactory('UniswapV2Router02');
  const router = await Router.deploy(factory.address, weth.address);
  await router.deployed();

  const Multicall = await ethers.getContractFactory('Multicall');
  const multicall = await Multicall.deploy();
  await multicall.deployed();

  const ERC20 = await ethers.getContractFactory('MockERC20');
  const totalSupply = ethers.utils.parseEther('1000000');
  const tokenA = await ERC20.deploy('Custos Token A', 'CUSTOS-A', totalSupply);
  await tokenA.deployed();
  const tokenB = await ERC20.deploy('Custos Token B', 'CUSTOS-B', totalSupply);
  await tokenB.deployed();

  const addAmount = ethers.utils.parseEther('10000');
  await (await tokenA.approve(router.address, addAmount)).wait();
  await (await tokenB.approve(router.address, addAmount)).wait();
  await (await router.addLiquidity(
    tokenA.address,
    tokenB.address,
    addAmount,
    addAmount,
    0,
    0,
    deployer.address,
    Math.floor(Date.now() / 1000) + 3600,
  )).wait();

  const pair = await factory.getPair(tokenA.address, tokenB.address);
  const result = {
    network: 'Elysium Testnet',
    chainId: Number(chain.chainId),
    rpc: process.env.ELYSIUM_RPC_URL || 'https://testnet-rpc.elysium.kinetiq.xyz',
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    contracts: {
      weth: weth.address,
      factory: factory.address,
      router: router.address,
      multicall: multicall.address,
      tokenA: tokenA.address,
      tokenB: tokenB.address,
      pair,
    },
    initCodeHash: await factory.INIT_CODE_PAIR_HASH(),
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
