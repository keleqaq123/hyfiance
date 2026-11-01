const fs = require('fs')
const path = require('path')
const hre = require('hardhat')

async function main() {
  const { ethers, network } = hre
  const [deployer] = await ethers.getSigners()

  console.log(`Network: ${network.name}`)
  console.log(`Deployer: ${deployer.address}`)

  const wethArtifact = require('@uniswap/v2-periphery/build/WETH9.json')
  const WETH9 = new ethers.ContractFactory(wethArtifact.abi, wethArtifact.bytecode, deployer)
  const weth = await WETH9.deploy()
  await weth.deployed()

  const Factory = await ethers.getContractFactory('UniswapV2Factory')
  const factory = await Factory.deploy(deployer.address)
  await factory.deployed()

  const Router = await ethers.getContractFactory('UniswapV2Router02')
  const router = await Router.deploy(factory.address, weth.address)
  await router.deployed()

  const Multicall = await ethers.getContractFactory('Multicall')
  const multicall = await Multicall.deploy()
  await multicall.deployed()

  const ERC20 = await ethers.getContractFactory('MockERC20')
  const totalSupply = ethers.utils.parseEther('1000000')
  const tokenA = await ERC20.deploy('Custos Token A', 'CUSTOS-A', totalSupply)
  await tokenA.deployed()
  const tokenB = await ERC20.deploy('Custos Token B', 'CUSTOS-B', totalSupply)
  await tokenB.deployed()

  const addAmount = ethers.utils.parseEther('10000')
  await (await tokenA.approve(router.address, addAmount)).wait()
  await (await tokenB.approve(router.address, addAmount)).wait()
  await (
    await router.addLiquidity(
      tokenA.address,
      tokenB.address,
      addAmount,
      addAmount,
      0,
      0,
      deployer.address,
      Math.floor(Date.now() / 1000) + 3600
    )
  ).wait()

  const pairAddress = await factory.getPair(tokenA.address, tokenB.address)
  const initCodeHash = await factory.INIT_CODE_PAIR_HASH()

  const result = {
    network: network.name,
    chainId: 47805,
    deployer: deployer.address,
    contracts: {
      weth: weth.address,
      factory: factory.address,
      router: router.address,
      multicall: multicall.address,
      tokenA: tokenA.address,
      tokenB: tokenB.address,
      pair: pairAddress
    },
    initCodeHash
  }

  const outDir = path.join(__dirname, '..', 'deployments', 'local')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'main-contracts.json'), JSON.stringify(result, null, 2) + '\n')

  console.log('Deployment result:')
  console.log(JSON.stringify(result, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
