const fs = require('fs')
const path = require('path')
const hre = require('hardhat')

async function main() {
  const { ethers } = hre
  const [user] = await ethers.getSigners()

  const deployed = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'deployments', 'local', 'main-contracts.json'), 'utf8')
  )

  const erc20Abi = [
    'function balanceOf(address) view returns (uint256)',
    'function approve(address,uint256) returns (bool)'
  ]
  const routerAbi = [
    'function getAmountsOut(uint256,address[]) view returns (uint256[])',
    'function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])'
  ]

  const tokenA = new ethers.Contract(deployed.contracts.tokenA, erc20Abi, user)
  const tokenB = new ethers.Contract(deployed.contracts.tokenB, erc20Abi, user)
  const router = new ethers.Contract(deployed.contracts.router, routerAbi, user)

  const amountIn = ethers.utils.parseEther('1')
  const beforeA = await tokenA.balanceOf(user.address)
  const beforeB = await tokenB.balanceOf(user.address)

  await (await tokenA.approve(router.address, amountIn)).wait()
  const pathTokens = [deployed.contracts.tokenA, deployed.contracts.tokenB]
  const amountsOut = await router.getAmountsOut(amountIn, pathTokens)

  await (
    await router.swapExactTokensForTokens(
      amountIn,
      amountsOut[1].mul(99).div(100),
      pathTokens,
      user.address,
      Math.floor(Date.now() / 1000) + 1800
    )
  ).wait()

  const afterA = await tokenA.balanceOf(user.address)
  const afterB = await tokenB.balanceOf(user.address)

  console.log('swap ok')
  console.log('tokenA before/after:', beforeA.toString(), afterA.toString())
  console.log('tokenB before/after:', beforeB.toString(), afterB.toString())
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
