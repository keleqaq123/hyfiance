const assert = require('assert');
const hre = require('hardhat');

const { ethers } = hre;

function deadline(seconds = 1_800) {
  return Math.floor(Date.now() / 1_000) + seconds;
}

async function deploy(name, args = []) {
  const factory = await ethers.getContractFactory(name);
  const contract = await factory.deploy(...args);
  await contract.deployed();
  return contract;
}

async function fixture() {
  const [owner, trader] = await ethers.getSigners();
  const wethArtifact = require('@uniswap/v2-periphery/build/WETH9.json');
  const weth = await new ethers.ContractFactory(
    wethArtifact.abi,
    wethArtifact.bytecode,
    owner,
  ).deploy();
  await weth.deployed();

  const factory = await deploy('UniswapV2Factory', [owner.address]);
  const router = await deploy('UniswapV2Router02', [factory.address, weth.address]);
  const multicall = await deploy('Multicall');
  const tokenA = await deploy('MockERC20', [
    'Custos Token A',
    'CUSTOS-A',
    ethers.utils.parseEther('1000000'),
  ]);
  const tokenB = await deploy('MockERC20', [
    'Custos Token B',
    'CUSTOS-B',
    ethers.utils.parseEther('1000000'),
  ]);

  return { owner, trader, weth, factory, router, multicall, tokenA, tokenB };
}

describe('Custos V2 Swap', function () {
  this.timeout(200_000);

  it('deploys the complete local swap surface', async function () {
    const { factory, router, weth, multicall } = await fixture();

    assert.strictEqual(await router.factory(), factory.address);
    assert.strictEqual(await router.WETH(), weth.address);
    assert.strictEqual(await multicall.getEthBalance(multicall.address).then((v) => v.toString()), '0');
    assert.strictEqual((await factory.allPairsLength()).toString(), '0');
  });

  it('supports token-to-token liquidity, swap and withdrawal', async function () {
    const { owner, trader, factory, router, tokenA, tokenB } = await fixture();
    const liquidity = ethers.utils.parseEther('10000');
    const traderAmount = ethers.utils.parseEther('1000');

    await tokenA.transfer(trader.address, traderAmount);
    await tokenB.transfer(trader.address, traderAmount);
    await tokenA.approve(router.address, liquidity);
    await tokenB.approve(router.address, liquidity);

    await router.addLiquidity(
      tokenA.address,
      tokenB.address,
      liquidity,
      liquidity,
      0,
      0,
      owner.address,
      deadline(),
    );

    const pairAddress = await factory.getPair(tokenA.address, tokenB.address);
    assert.notStrictEqual(pairAddress, ethers.constants.AddressZero);
    assert.strictEqual((await factory.allPairsLength()).toString(), '1');

    const pair = await ethers.getContractAt('UniswapV2Pair', pairAddress);
    const reservesBefore = await pair.getReserves();
    assert(reservesBefore[0].gt(0));
    assert(reservesBefore[1].gt(0));

    const amountIn = ethers.utils.parseEther('100');
    const path = [tokenA.address, tokenB.address];
    const quoted = await router.getAmountsOut(amountIn, path);
    assert(quoted[1].gt(0));

    await tokenA.connect(trader).approve(router.address, amountIn);
    const beforeB = await tokenB.balanceOf(trader.address);
    await router.connect(trader).swapExactTokensForTokens(
      amountIn,
      quoted[1].mul(99).div(100),
      path,
      trader.address,
      deadline(),
    );
    const afterB = await tokenB.balanceOf(trader.address);
    assert(afterB.gt(beforeB));

    const liquidityBalance = await pair.balanceOf(owner.address);
    assert(liquidityBalance.gt(0));
    await pair.approve(router.address, liquidityBalance.div(2));
    const beforeA = await tokenA.balanceOf(owner.address);
    await router.removeLiquidity(
      tokenA.address,
      tokenB.address,
      liquidityBalance.div(2),
      0,
      0,
      owner.address,
      deadline(),
    );
    assert((await tokenA.balanceOf(owner.address)).gt(beforeA));
  });

  it('supports native ETH liquidity and an ETH-to-token swap', async function () {
    const { owner, trader, weth, factory, router } = await fixture();
    const token = await deploy('MockERC20', [
      'Custos ETH Pair Token',
      'C-ETH',
      ethers.utils.parseEther('1000000'),
    ]);
    const tokenLiquidity = ethers.utils.parseEther('10000');
    await token.approve(router.address, tokenLiquidity);

    await router.addLiquidityETH(
      token.address,
      tokenLiquidity,
      0,
      0,
      owner.address,
      deadline(),
      { value: ethers.utils.parseEther('10') },
    );

    const pairAddress = await factory.getPair(token.address, weth.address);
    assert.notStrictEqual(pairAddress, ethers.constants.AddressZero);

    const amountIn = ethers.utils.parseEther('1');
    const quote = await router.getAmountsOut(amountIn, [weth.address, token.address]);
    const before = await token.balanceOf(trader.address);
    await router.connect(trader).swapExactETHForTokens(
      quote[1].mul(99).div(100),
      [weth.address, token.address],
      trader.address,
      deadline(),
      { value: amountIn },
    );
    assert((await token.balanceOf(trader.address)).gt(before));
  });
});
