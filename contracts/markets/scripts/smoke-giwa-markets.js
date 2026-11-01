const fs = require('fs');
const path = require('path');
const hre = require('hardhat');

const { ethers } = hre;

const root = path.resolve(__dirname, '../../..');
const deploymentFile = path.join(__dirname, '../deployments/giwa-sepolia.json');
const deployment = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));

const ZERO_UPDATE = [];
const CONFIDENCE_18 = ethers.parseUnits('0.01', 18);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function tx(label, transaction) {
  const sent = await transaction;
  const receipt = await sent.wait();
  assert(receipt && receipt.status === 1, `${label} did not succeed`);
  console.log(`ok  ${label} (${receipt.hash})`);
  return receipt;
}

async function readEventually(read, label, predicate) {
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const value = await read();
      if (predicate(value)) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`GIWA RPC did not expose ${label} after confirmation${lastError ? `: ${lastError.message}` : '.'}`);
}

function eventArgument(receipt, contract, eventName, argumentName) {
  for (const log of receipt?.logs || []) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === eventName) return parsed.args[argumentName];
    } catch {
      // Ignore logs emitted by other contracts in the same receipt.
    }
  }
  return undefined;
}

async function expectRevert(label, action) {
  try {
    await action();
  } catch (error) {
    console.log(`ok  ${label} reverted as expected`);
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

async function main() {
  const [owner] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  assert(Number(network.chainId) === 91342, `expected GIWA Sepolia, got ${network.chainId}`);

  const contracts = deployment.contracts;
  const quote = await ethers.getContractAt('TestUSDC', contracts.testUSDC, owner);
  const quoteAddress = await quote.getAddress();
  const quoteUnit = ethers.parseUnits('1', 6);
  const provider = ethers.provider;
  const trader = ethers.Wallet.createRandom().connect(provider);

  console.log(`GIWA smoke deployer: ${owner.address}`);
  console.log(`GIWA smoke trader:   ${trader.address}`);

  const ownerBalanceBefore = await quote.balanceOf(owner.address);
  assert(ownerBalanceBefore >= ethers.parseUnits('2000', 6), 'deployer has insufficient tUSDC for smoke test');
  await tx('fund temporary trader gas', owner.sendTransaction({
    to: trader.address,
    value: ethers.parseEther('0.001'),
  }));
  await tx('fund temporary trader collateral', quote.transfer(trader.address, ethers.parseUnits('1500', 6)));

  // RWA: swap in both directions and add/remove a fresh LP position.
  for (const market of deployment.markets) {
    const asset = await ethers.getContractAt('RwaAssetToken', market.tokenAddress, owner);
    const pool = await ethers.getContractAt('RwaAMMPool', market.poolAddress, owner);
    const reservesBefore = await pool.getReserves();
    assert(reservesBefore[0] > 0n && reservesBefore[1] > 0n, `${market.symbol} has empty reserves`);

    const quoteIn = ethers.parseUnits('10', 6);
    const assetOut = await pool.getAmountOut(quoteAddress, quoteIn);
    assert(assetOut > 0n, `${market.symbol} quote-to-asset quote is zero`);
    await tx(`${market.symbol} approve quote for buy`, quote.approve(market.poolAddress, quoteIn));
    await tx(`${market.symbol} buy asset`, pool.swapExactInput(
      quoteAddress,
      quoteIn,
      (assetOut * 99n) / 100n,
      owner.address,
    ));

    const quoteOut = await pool.getAmountOut(market.tokenAddress, assetOut);
    assert(quoteOut > 0n, `${market.symbol} asset-to-quote quote is zero`);
    await tx(`${market.symbol} approve asset for sell`, asset.approve(market.poolAddress, assetOut));
    await tx(`${market.symbol} sell asset`, pool.swapExactInput(
      market.tokenAddress,
      assetOut,
      (quoteOut * 99n) / 100n,
      owner.address,
    ));

    const reserves = await pool.getReserves();
    const lpQuote = ethers.parseUnits('10', 6);
    const lpAsset = (lpQuote * 10n ** 12n * BigInt(reserves[0])) / BigInt(reserves[1]);
    assert(lpAsset > 0n, `${market.symbol} LP asset amount is zero`);
    await tx(`${market.symbol} approve LP asset`, asset.approve(market.poolAddress, lpAsset));
    await tx(`${market.symbol} approve LP quote`, quote.approve(market.poolAddress, lpQuote));
    const lpBefore = await pool.balanceOf(owner.address);
    await tx(`${market.symbol} add liquidity`, pool.addLiquidity(
      lpAsset,
      lpQuote,
      0,
      0,
      owner.address,
    ));
    const lpBalance = await readEventually(
      () => pool.balanceOf(owner.address),
      `${market.symbol} LP balance`,
      (value) => value > lpBefore,
    );
    const lpMinted = lpBalance - lpBefore;
    assert(lpMinted > 0n, `${market.symbol} LP mint is zero`);
    await tx(`${market.symbol} remove liquidity`, pool.removeLiquidity(
      lpMinted,
      0,
      0,
      owner.address,
    ));
  }

  // Spot: all three deployed pools use the empty updateData fallback path.
  for (const [symbol, market] of Object.entries(deployment.spot)) {
    const token = await ethers.getContractAt('SyntheticRwaToken', market.token, owner);
    const pool = await ethers.getContractAt('OracleSpotPool', market.pool, owner);
    const quoteIn = ethers.parseUnits('10', 6);
    const buyQuote = await pool.quoteBuy(quoteIn);
    assert(buyQuote[0] > 0n, `${symbol} spot buy quote is zero`);
    await tx(`${symbol} spot approve buy`, quote.approve(market.pool, quoteIn));
    await tx(`${symbol} spot buy with fallback`, pool.buyExactQuote(
      quoteIn,
      (buyQuote[0] * 99n) / 100n,
      ZERO_UPDATE,
    ));

    const sellQuote = await pool.quoteSell(buyQuote[0]);
    assert(sellQuote[0] > 0n, `${symbol} spot sell quote is zero`);
    await tx(`${symbol} spot approve sell`, token.approve(market.pool, buyQuote[0]));
    await tx(`${symbol} spot sell with fallback`, pool.sellExactAsset(
      buyQuote[0],
      (sellQuote[0] * 99n) / 100n,
      ZERO_UPDATE,
    ));

    const lpQuote = ethers.parseUnits('10', 6);
    const lpBefore = await pool.balanceOf(owner.address);
    await tx(`${symbol} spot approve LP`, quote.approve(market.pool, lpQuote));
    await tx(`${symbol} spot add liquidity with fallback`, pool.addLiquidity(
      lpQuote,
      0,
      ZERO_UPDATE,
    ));
    const lpBalance = await readEventually(
      () => pool.balanceOf(owner.address),
      `${symbol} spot LP balance`,
      (value) => value > lpBefore,
    );
    const lpMinted = lpBalance - lpBefore;
    assert(lpMinted > 0n, `${symbol} spot LP mint is zero`);
    await tx(`${symbol} spot remove liquidity with fallback`, pool.removeLiquidity(
      lpMinted,
      0,
      ZERO_UPDATE,
    ));
  }

  // Perpetuals: collateral, close, permissionless TP/SL and liquidation.
  const vault = await ethers.getContractAt('MarginVault', contracts.marginVault, owner);
  const engine = await ethers.getContractAt('GiwaPerpEngineV12', contracts.perpEngine, owner);
  const oracle = await ethers.getContractAt('PythOracleRouter', contracts.oracleRouter, owner);
  const btc = deployment.perps.BTC;
  const btcFeed = btc.feedId;
  const traderQuote = ethers.parseUnits('1000', 6);
  const traderSigner = trader;
  const traderVault = vault.connect(traderSigner);
  const traderEngine = engine.connect(traderSigner);
  const traderQuoteToken = quote.connect(traderSigner);

  await tx('trader approve vault', traderQuoteToken.approve(contracts.marginVault, traderQuote));
  await tx('trader deposit collateral', traderVault.deposit(traderQuote));
  await readEventually(
    () => vault.available(trader.address),
    'trader available collateral',
    (value) => value >= traderQuote,
  );

  const closeReceipt = await tx('open BTC position', traderEngine.openPosition(
    btc.marketId,
    true,
    ethers.parseUnits('100', 6),
    20_000,
    ZERO_UPDATE,
  ));
  const closePositionId = eventArgument(closeReceipt, engine, 'PositionOpened', 'positionId');
  assert(closePositionId !== undefined, 'BTC open receipt did not contain position ID');
  await readEventually(
    () => engine.getActivePositionIds(trader.address, btc.marketId),
    'BTC active position',
    (value) => value.length === 1 && value[0] === closePositionId,
  );
  await tx('close BTC position', traderEngine.closePosition(closePositionId, ZERO_UPDATE));
  await readEventually(
    () => engine.getActivePositionIds(trader.address, btc.marketId),
    'BTC closed position state',
    (value) => value.length === 0,
  );

  const triggerReceipt = await tx('open BTC TP/SL position', traderEngine.openPositionWithTriggers(
    btc.marketId,
    true,
    ethers.parseUnits('100', 6),
    50_000,
    ethers.parseUnits('110000', 18),
    ethers.parseUnits('90000', 18),
    ZERO_UPDATE,
  ));
  const triggerPositionId = eventArgument(triggerReceipt, engine, 'PositionOpened', 'positionId');
  assert(triggerPositionId !== undefined, 'BTC trigger receipt did not contain position ID');
  await readEventually(
    () => engine.getActivePositionIds(trader.address, btc.marketId),
    'BTC trigger position',
    (value) => value.length === 1 && value[0] === triggerPositionId,
  );
  await expectRevert('BTC trigger before price hit', () => engine.executeTriggerPosition.staticCall(triggerPositionId, ZERO_UPDATE));
  await tx('raise BTC fallback to TP', oracle.setFallbackPrice(btcFeed, ethers.parseUnits('110000', 18), CONFIDENCE_18));
  await tx('execute BTC TP permissionlessly', engine.executeTriggerPosition(triggerPositionId, ZERO_UPDATE));
  await readEventually(
    () => engine.getActivePositionIds(trader.address, btc.marketId),
    'BTC TP closed state',
    (value) => value.length === 0,
  );

  await tx('reset BTC fallback before liquidation', oracle.setFallbackPrice(btcFeed, ethers.parseUnits('100000', 18), CONFIDENCE_18));
  const liquidationReceipt = await tx('open BTC liquidation position', traderEngine.openPosition(
    btc.marketId,
    true,
    ethers.parseUnits('100', 6),
    50_000,
    ZERO_UPDATE,
  ));
  const liquidationPositionId = eventArgument(liquidationReceipt, engine, 'PositionOpened', 'positionId');
  assert(liquidationPositionId !== undefined, 'BTC liquidation receipt did not contain position ID');
  await readEventually(
    () => engine.getActivePositionIds(trader.address, btc.marketId),
    'BTC liquidation position',
    (value) => value.length === 1 && value[0] === liquidationPositionId,
  );
  const liquidationPrice = await engine.getLiquidationPrice(liquidationPositionId);
  assert(liquidationPrice > 0n, 'liquidation price is zero');
  const belowLiquidation = liquidationPrice > ethers.parseUnits('1000', 18)
    ? liquidationPrice - ethers.parseUnits('1000', 18)
    : liquidationPrice;
  await tx('lower BTC fallback to liquidation level', oracle.setFallbackPrice(btcFeed, belowLiquidation, CONFIDENCE_18));
  await tx('liquidate BTC position', engine.liquidate(liquidationPositionId, ZERO_UPDATE));
  await readEventually(
    () => engine.getActivePositionIds(trader.address, btc.marketId),
    'BTC liquidation closed state',
    (value) => value.length === 0,
  );
  await tx('restore BTC fallback', oracle.setFallbackPrice(btcFeed, ethers.parseUnits('100000', 18), CONFIDENCE_18));

  console.log(JSON.stringify({
    ok: true,
    chainId: Number(network.chainId),
    deployment: path.relative(root, deploymentFile),
    rwaMarkets: deployment.markets.length,
    spotMarkets: Object.keys(deployment.spot),
    perpMarket: 'BTC',
    liquidationPrice18: liquidationPrice.toString(),
    fallbackUpdateData: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
