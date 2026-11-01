const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('Custos markets integration', function () {
  async function deploy(name, args = []) {
    const factory = await ethers.getContractFactory(name);
    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();
    return contract;
  }

  async function tx(transaction) {
    await (await transaction).wait();
  }

  it('runs RWA proof, RWA AMM, oracle Spot and Perpetual flows locally', async function () {
    const [owner, trader, liquidator] = await ethers.getSigners();
    const quote = await deploy('TestUSDC', [owner.address]);
    const oracle = await deploy('MockOracleRouter', [owner.address]);
    const quoteAddress = await quote.getAddress();

    await tx(quote.ownerMint(owner.address, ethers.parseUnits('1000000', 6)));
    await tx(quote.ownerMint(trader.address, ethers.parseUnits('10000', 6)));

    // RWA proof -> verified asset -> token -> constant-product pool -> swap.
    const registry = await deploy('RwaVerificationRegistry');
    const assetFactory = await deploy('RwaAssetFactory', [await registry.getAddress()]);
    const poolFactory = await deploy('RwaPoolFactory');
    const assetId = ethers.id('CUSTOS-RWA:TEST:v1');
    const proofHash = ethers.id('test document');

    await tx(registry.registerAsset(assetId, proofHash, 'ipfs://custos/test', 1_900_000_000, 25));
    await expect(assetFactory.createAssetToken(assetId, 'Unverified', 'rNO', ethers.parseUnits('1', 18)))
      .to.be.revertedWith('asset not verified');
    await tx(registry.setAssetStatus(assetId, 2));
    await tx(assetFactory.createAssetToken(assetId, 'Test Invoice', 'rTEST', ethers.parseUnits('100000', 18)));
    const rwaTokenAddress = await assetFactory.assetToken(assetId);
    await tx(poolFactory.createPool(rwaTokenAddress, quoteAddress));
    const rwaPoolAddress = await poolFactory.getPool(rwaTokenAddress, quoteAddress);
    const rwaToken = await ethers.getContractAt('RwaAssetToken', rwaTokenAddress);
    const rwaPool = await ethers.getContractAt('RwaAMMPool', rwaPoolAddress);
    await tx(rwaToken.approve(rwaPoolAddress, ethers.parseUnits('20000', 18)));
    await tx(quote.approve(rwaPoolAddress, ethers.parseUnits('20000', 6)));
    await tx(rwaPool.addLiquidity(ethers.parseUnits('20000', 18), ethers.parseUnits('20000', 6), 0, 0, owner.address));
    await tx(quote.connect(trader).approve(rwaPoolAddress, ethers.parseUnits('1000', 6)));
    const rwaOut = await rwaPool.getAmountOut(quoteAddress, ethers.parseUnits('1000', 6));
    await tx(rwaPool.connect(trader).swapExactInput(quoteAddress, ethers.parseUnits('1000', 6), rwaOut, trader.address));
    expect(await rwaToken.balanceOf(trader.address)).to.equal(rwaOut);

    // Oracle Spot: tUSDC-only LP, oracle-priced mint/burn and liquidity shares.
    const spotFeed = ethers.id('CUSTOS-SPOT:XAU:v1');
    await tx(oracle.setPrice(spotFeed, ethers.parseUnits('2300', 18), ethers.parseUnits('0.01', 18), 0));
    const synthetic = await deploy('SyntheticRwaToken', [
      'Custos Synthetic Gold',
      'rXAU',
      'XAU/USD',
      '1 token = 1 troy oz gold reference',
      owner.address,
    ]);
    const spotPool = await deploy('OracleSpotPool', [
      await synthetic.getAddress(),
      quoteAddress,
      await oracle.getAddress(),
      spotFeed,
      'Custos rXAU LP',
      'cLP-XAU',
      owner.address,
    ]);
    await tx(synthetic.setPool(await spotPool.getAddress()));
    await tx(quote.approve(await spotPool.getAddress(), ethers.parseUnits('10000', 6)));
    await tx(spotPool.addLiquidity(ethers.parseUnits('10000', 6), 0, []));
    const quotedSpot = await spotPool.quoteBuy(ethers.parseUnits('100', 6));
    await tx(quote.connect(trader).approve(await spotPool.getAddress(), ethers.parseUnits('100', 6)));
    await tx(spotPool.connect(trader).buyExactQuote(ethers.parseUnits('100', 6), quotedSpot.assetOut, []));
    expect(await synthetic.balanceOf(trader.address)).to.equal(quotedSpot.assetOut);
    await tx(synthetic.connect(trader).approve(await spotPool.getAddress(), quotedSpot.assetOut));
    const quotedSell = await spotPool.connect(trader).quoteSell(quotedSpot.assetOut);
    await tx(spotPool.connect(trader).sellExactAsset(quotedSpot.assetOut, quotedSell.quoteOut, []));
    expect(await synthetic.balanceOf(trader.address)).to.equal(0n);

    // Perpetual: collateral deposit -> isolated position -> PnL settlement.
    const perpFeed = ethers.id('CUSTOS-PERP:BTC:v1');
    await tx(oracle.setPrice(perpFeed, ethers.parseUnits('100', 18), ethers.parseUnits('0.01', 18), 0));
    const marketRegistry = await deploy('MarketRegistry', [owner.address]);
    const vault = await deploy('MarginVault', [quoteAddress, owner.address]);
    const engine = await deploy('GiwaPerpEngineV12', [
      await vault.getAddress(),
      await marketRegistry.getAddress(),
      await oracle.getAddress(),
      owner.address,
    ]);
    await tx(vault.setEngine(await engine.getAddress()));
    const marketId = ethers.id('CUSTOS-PERP:BTC:v1');
    await tx(marketRegistry.setMarket(marketId, {
      symbol: 'BTC',
      feedId: perpFeed,
      maxPriceAge: 120,
      maxLeverageBps: 50000,
      maintenanceMarginBps: 500,
      maxConfidenceBps: 100,
      maxOpenInterestUsd: ethers.parseUnits('100000', 18),
      active: true,
      reduceOnly: false,
    }));
    await tx(quote.approve(await vault.getAddress(), ethers.parseUnits('100000', 6)));
    await tx(vault.fundReserve(ethers.parseUnits('100000', 6)));
    await tx(quote.connect(trader).approve(await vault.getAddress(), ethers.parseUnits('2000', 6)));
    await tx(vault.connect(trader).deposit(ethers.parseUnits('2000', 6)));
    await tx(engine.connect(trader).openPositionWithTriggers(
      marketId,
      true,
      ethers.parseUnits('1000', 6),
      20000,
      0,
      0,
      [],
    ));
    const ids = await engine.getActivePositionIds(trader.address, marketId);
    expect(ids).to.have.length(1);
    await tx(oracle.setPrice(perpFeed, ethers.parseUnits('110', 18), ethers.parseUnits('0.01', 18), 0));
    await tx(engine.connect(trader).closePosition(ids[0], []));
    expect(await vault.available(trader.address)).to.be.greaterThan(ethers.parseUnits('2000', 6));
    expect(await vault.locked(trader.address)).to.equal(0n);
    expect(await vault.available(liquidator.address)).to.equal(0n);
  });

  it('supports RWA and Spot LP add/remove, Perp TP/SL and liquidation', async function () {
    const [owner, trader, liquidator] = await ethers.getSigners();
    const quote = await deploy('TestUSDC', [owner.address]);
    const oracle = await deploy('MockOracleRouter', [owner.address]);
    const quoteAddress = await quote.getAddress();

    await tx(quote.ownerMint(owner.address, ethers.parseUnits('1000000', 6)));
    await tx(quote.ownerMint(trader.address, ethers.parseUnits('10000', 6)));

    // RWA LP lifecycle with a quote token that uses six decimals.
    const registry = await deploy('RwaVerificationRegistry');
    const assetFactory = await deploy('RwaAssetFactory', [await registry.getAddress()]);
    const poolFactory = await deploy('RwaPoolFactory');
    const assetId = ethers.id('CUSTOS-RWA:LP-TEST:v1');
    await tx(registry.registerAsset(assetId, ethers.id('lp proof'), 'ipfs://lp-test', 1_900_000_000, 20));
    await tx(registry.setAssetStatus(assetId, 2));
    await tx(assetFactory.createAssetToken(assetId, 'LP Test Asset', 'rLPTEST', ethers.parseUnits('100000', 18)));
    const assetAddress = await assetFactory.assetToken(assetId);
    await tx(poolFactory.createPool(assetAddress, quoteAddress));
    const rwaPool = await ethers.getContractAt('RwaAMMPool', await poolFactory.getPool(assetAddress, quoteAddress));
    const rwaAsset = await ethers.getContractAt('RwaAssetToken', assetAddress);

    await tx(rwaAsset.approve(await rwaPool.getAddress(), ethers.parseUnits('20000', 18)));
    await tx(quote.approve(await rwaPool.getAddress(), ethers.parseUnits('20000', 6)));
    await tx(rwaPool.addLiquidity(ethers.parseUnits('20000', 18), ethers.parseUnits('20000', 6), 0, 0, owner.address));

    const rwaTradeQuote = ethers.parseUnits('1000', 6);
    const rwaTradeOut = await rwaPool.getAmountOut(quoteAddress, rwaTradeQuote);
    await tx(quote.connect(trader).approve(await rwaPool.getAddress(), rwaTradeQuote));
    await tx(rwaPool.connect(trader).swapExactInput(quoteAddress, rwaTradeQuote, rwaTradeOut, trader.address));

    const rwaQuote = ethers.parseUnits('250', 6);
    const [assetReserve, quoteReserve] = await rwaPool.getReserves();
    const rwaAssetForLp = (rwaQuote * 10n ** 12n * BigInt(assetReserve)) / BigInt(quoteReserve);
    await tx(quote.connect(trader).approve(await rwaPool.getAddress(), rwaQuote));
    await tx(rwaAsset.connect(trader).approve(await rwaPool.getAddress(), rwaAssetForLp));
    await tx(rwaPool.connect(trader).addLiquidity(rwaAssetForLp, rwaQuote, 0, 0, trader.address));
    const rwaLp = await rwaPool.balanceOf(trader.address);
    expect(rwaLp).to.be.greaterThan(0n);
    await tx(rwaPool.connect(trader).removeLiquidity(rwaLp, 0, 0, trader.address));
    expect(await rwaPool.balanceOf(trader.address)).to.equal(0n);

    // Spot LP lifecycle and a full buy/sell round trip.
    const spotFeed = ethers.id('CUSTOS-SPOT:LP-XAU:v1');
    await tx(oracle.setPrice(spotFeed, ethers.parseUnits('2300', 18), ethers.parseUnits('0.01', 18), 0));
    const synthetic = await deploy('SyntheticRwaToken', [
      'Custos Synthetic Gold LP Test',
      'rXAU-LP',
      'XAU/USD',
      '1 token = 1 troy oz gold reference',
      owner.address,
    ]);
    const spotPool = await deploy('OracleSpotPool', [
      await synthetic.getAddress(),
      quoteAddress,
      await oracle.getAddress(),
      spotFeed,
      'Custos rXAU LP Test',
      'cLP-XAU-TEST',
      owner.address,
    ]);
    await tx(synthetic.setPool(await spotPool.getAddress()));
    await tx(quote.approve(await spotPool.getAddress(), ethers.parseUnits('10000', 6)));
    await tx(spotPool.addLiquidity(ethers.parseUnits('10000', 6), 0, []));

    const spotQuote = ethers.parseUnits('100', 6);
    const quotedBuy = await spotPool.quoteBuy(spotQuote);
    await tx(quote.connect(trader).approve(await spotPool.getAddress(), spotQuote));
    await tx(spotPool.connect(trader).buyExactQuote(spotQuote, quotedBuy.assetOut, []));
    await tx(synthetic.connect(trader).approve(await spotPool.getAddress(), quotedBuy.assetOut));
    const quotedSell = await spotPool.connect(trader).quoteSell(quotedBuy.assetOut);
    await tx(spotPool.connect(trader).sellExactAsset(quotedBuy.assetOut, quotedSell.quoteOut, []));
    expect(await synthetic.balanceOf(trader.address)).to.equal(0n);

    const spotLpQuote = ethers.parseUnits('500', 6);
    await tx(quote.connect(trader).approve(await spotPool.getAddress(), spotLpQuote));
    await tx(spotPool.connect(trader).addLiquidity(spotLpQuote, 0, []));
    const spotLp = await spotPool.balanceOf(trader.address);
    expect(spotLp).to.be.greaterThan(0n);
    await tx(spotPool.connect(trader).removeLiquidity(spotLp, 0, []));
    expect(await spotPool.balanceOf(trader.address)).to.equal(0n);

    // TP/SL execution is permissionless once a trigger price is hit.
    const perpFeed = ethers.id('CUSTOS-PERP:TRIGGER:v1');
    const marketId = ethers.id('CUSTOS-PERP:TRIGGER:v1');
    await tx(oracle.setPrice(perpFeed, ethers.parseUnits('100', 18), ethers.parseUnits('0.01', 18), 0));
    const marketRegistry = await deploy('MarketRegistry', [owner.address]);
    const vault = await deploy('MarginVault', [quoteAddress, owner.address]);
    const engine = await deploy('GiwaPerpEngineV12', [
      await vault.getAddress(),
      await marketRegistry.getAddress(),
      await oracle.getAddress(),
      owner.address,
    ]);
    await tx(vault.setEngine(await engine.getAddress()));
    await tx(marketRegistry.setMarket(marketId, {
      symbol: 'TRIGGER',
      feedId: perpFeed,
      maxPriceAge: 120,
      maxLeverageBps: 50000,
      maintenanceMarginBps: 500,
      maxConfidenceBps: 100,
      maxOpenInterestUsd: ethers.parseUnits('100000', 18),
      active: true,
      reduceOnly: false,
    }));
    await tx(quote.approve(await vault.getAddress(), ethers.parseUnits('100000', 6)));
    await tx(vault.fundReserve(ethers.parseUnits('100000', 6)));
    await tx(quote.connect(trader).approve(await vault.getAddress(), ethers.parseUnits('1000', 6)));
    await tx(vault.connect(trader).deposit(ethers.parseUnits('1000', 6)));

    const triggerPositionId = await engine.nextPositionId();
    await tx(engine.connect(trader).openPositionWithTriggers(
      marketId,
      true,
      ethers.parseUnits('100', 6),
      50000,
      ethers.parseUnits('120', 18),
      ethers.parseUnits('90', 18),
      [],
    ));
    await tx(oracle.setPrice(perpFeed, ethers.parseUnits('120', 18), ethers.parseUnits('0.01', 18), 0));
    await tx(engine.connect(liquidator).executeTriggerPosition(triggerPositionId, []));
    expect(await engine.activePositionCount(trader.address, marketId)).to.equal(0n);
    expect(await engine.positions(triggerPositionId)).to.deep.equal([
      ethers.ZeroAddress,
      ethers.ZeroHash,
      0n,
      0n,
      0n,
      false,
      0n,
    ]);

    // A price at the calculated liquidation boundary must be liquidatable.
    await tx(oracle.setPrice(perpFeed, ethers.parseUnits('100', 18), ethers.parseUnits('0.01', 18), 0));
    const liquidationPositionId = await engine.nextPositionId();
    await tx(engine.connect(trader).openPositionWithTriggers(
      marketId,
      true,
      ethers.parseUnits('100', 6),
      50000,
      0,
      0,
      [],
    ));
    expect(await engine.getLiquidationPrice(liquidationPositionId)).to.equal(ethers.parseUnits('85', 18));
    await tx(oracle.setPrice(perpFeed, ethers.parseUnits('85', 18), ethers.parseUnits('0.01', 18), 0));
    await tx(engine.connect(liquidator).liquidate(liquidationPositionId, []));
    expect(await engine.activePositionCount(trader.address, marketId)).to.equal(0n);
    expect(await vault.available(liquidator.address)).to.equal(625000n);
  });

  it('uses an explicit Pyth fallback when a testnet feed has no update payload', async function () {
    const [owner] = await ethers.getSigners();
    const mockPyth = await deploy('MockOracleRouter', [owner.address]);
    const oracle = await deploy('PythOracleRouter', [await mockPyth.getAddress(), owner.address]);
    const feedId = ethers.id('CUSTOS-FALLBACK:AAPL:v1');

    await tx(oracle.setFallbackPrice(feedId, ethers.parseUnits('220', 18), ethers.parseUnits('0.01', 18)));
    expect(await oracle.getUpdateFee([])).to.equal(0n);
    const price = await oracle.getPrice18(feedId, 600);
    expect(price[0]).to.equal(ethers.parseUnits('220', 18));
    expect(price[1]).to.equal(ethers.parseUnits('0.01', 18));
  });
});
