const fs = require('fs');
const path = require('path');
const hre = require('hardhat');

const DEPLOYMENT = path.join(__dirname, '..', 'deployments', 'giwa-sepolia', 'main-contracts.json');

async function main() {
  const { ethers } = hre;
  const [user] = await ethers.getSigners();
  const deployed = JSON.parse(fs.readFileSync(DEPLOYMENT, 'utf8'));
  const chain = await user.provider.getNetwork();
  if (Number(chain.chainId) !== 91342) throw new Error(`Expected GIWA Sepolia, got ${chain.chainId}`);

  const erc20Abi = [
    'function balanceOf(address) view returns (uint256)',
    'function approve(address,uint256) returns (bool)',
  ];
  const routerAbi = [
    'function getAmountsOut(uint256,address[]) view returns (uint256[])',
    'function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])',
  ];
  const tokenA = new ethers.Contract(deployed.contracts.tokenA, erc20Abi, user);
  const tokenB = new ethers.Contract(deployed.contracts.tokenB, erc20Abi, user);
  const router = new ethers.Contract(deployed.contracts.router, routerAbi, user);
  const amountIn = ethers.utils.parseEther('1');
  const beforeA = await tokenA.balanceOf(user.address);
  const beforeB = await tokenB.balanceOf(user.address);

  await (await tokenA.approve(router.address, amountIn)).wait();
  const route = [deployed.contracts.tokenA, deployed.contracts.tokenB];
  const amountsOut = await router.getAmountsOut(amountIn, route);
  await (await router.swapExactTokensForTokens(
    amountIn,
    amountsOut[1].mul(99).div(100),
    route,
    user.address,
    Math.floor(Date.now() / 1000) + 1800,
  )).wait();

  const afterA = await tokenA.balanceOf(user.address);
  const afterB = await tokenB.balanceOf(user.address);
  if (!afterA.lt(beforeA) || !afterB.gt(beforeB)) throw new Error('GIWA swap balances did not change as expected');
  console.log(JSON.stringify({
    ok: true,
    chainId: Number(chain.chainId),
    pair: deployed.contracts.pair,
    amountIn: ethers.utils.formatEther(amountIn),
    amountOut: ethers.utils.formatEther(amountsOut[1]),
    tokenABefore: ethers.utils.formatEther(beforeA),
    tokenAAfter: ethers.utils.formatEther(afterA),
    tokenBBefore: ethers.utils.formatEther(beforeB),
    tokenBAfter: ethers.utils.formatEther(afterB),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
