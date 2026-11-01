const hre = require('hardhat');
const path = require('path');
const {
  FEEDS,
  SPOT_MARKETS,
  PERP_MARKETS,
  RWA_MARKETS,
  perpMarketId,
  rwaAssetId,
} = require('./market-definitions');
const { beginDeployment, failDeployment, writeDeploymentFiles } = require('./write-deployment');

const { ethers, network } = hre;
const root = path.resolve(__dirname, '../../..');
let deploymentRun;

async function deploy(name, args = []) {
  const factory = await ethers.getContractFactory(name);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function wait(tx) {
  await tx.wait();
}

function timestamp(date) {
  return Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
}

async function deployRwa({ owner, quoteToken }) {
  const registry = await deploy('RwaVerificationRegistry');
  const assetFactory = await deploy('RwaAssetFactory', [await registry.getAddress()]);
  const poolFactory = await deploy('RwaPoolFactory');
  const quote = await ethers.getContractAt('TestUSDC', await quoteToken.getAddress());

  const markets = [];
  for (const config of RWA_MARKETS) {
    const assetId = rwaAssetId(config.key);
    const documentHash = ethers.id(`Custos demo proof | ${config.key} | ${config.name}`);

    await wait(await registry.registerAsset(
      assetId,
      documentHash,
      config.metadataURI,
      timestamp(config.maturity),
      config.risk,
    ));
    await wait(await registry.setAssetStatus(assetId, 2));

    await wait(await assetFactory.createAssetToken(
      assetId,
      config.name,
      config.key,
      ethers.parseUnits(config.supply, 18),
    ));
    const tokenAddress = await assetFactory.assetToken(assetId);

    await wait(await poolFactory.createPool(tokenAddress, await quoteToken.getAddress()));
    const poolAddress = await poolFactory.getPool(tokenAddress, await quoteToken.getAddress());

    const asset = await ethers.getContractAt('RwaAssetToken', tokenAddress);
    const pool = await ethers.getContractAt('RwaAMMPool', poolAddress);
    const assetSeed = ethers.parseUnits('50000', 18);
    const quoteSeed = ethers.parseUnits('50000', 6);
    await wait(await asset.approve(poolAddress, assetSeed));
    await wait(await quote.approve(poolAddress, quoteSeed));
    await wait(await pool.addLiquidity(assetSeed, quoteSeed, 0, 0, owner.address));

    const reserves = await pool.getReserves();
    markets.push({
      name: config.name,
      symbol: config.key,
      asset_type: config.assetType,
      maturity: config.maturity,
      risk: config.risk,
      supply: config.supply,
      weight: config.weight,
      assetPerQuote: 1,
      assetId,
      tokenAddress,
      poolAddress,
      documentHash,
      metadataURI: config.metadataURI,
      assetLiquidity: ethers.formatUnits(reserves.assetReserve, 18),
      quoteLiquidity: ethers.formatUnits(reserves.quoteReserve, 6),
    });
  }

  return {
    contracts: {
      registry: await registry.getAddress(),
      assetFactory: await assetFactory.getAddress(),
      poolFactory: await poolFactory.getAddress(),
    },
    settlementToken: {
      name: 'Custos Test USD Coin',
      symbol: 'tUSDC',
      address: await quoteToken.getAddress(),
      decimals: 6,
      official: false,
      faucetAddress: await quoteToken.getAddress(),
      claimUrl: '',
      claimFlow: 'Call the local tUSDC faucet from the connected wallet.',
      disclaimer: 'Local testnet-only collateral; no cash value.',
    },
    markets,
  };
}

async function deploySpot({ owner, quoteToken, oracle }) {
  const tokenFactory = await ethers.getContractFactory('SyntheticRwaToken');
  const poolFactory = await ethers.getContractFactory('OracleSpotPool');
  const quoteAddress = await quoteToken.getAddress();
  const oracleAddress = await oracle.getAddress();
  const markets = {};

  for (const config of SPOT_MARKETS) {
    const token = await tokenFactory.deploy(
      config.name,
      config.symbol,
      config.underlying,
      config.unit,
      owner.address,
    );
    await token.waitForDeployment();

    const pool = await poolFactory.deploy(
      await token.getAddress(),
      quoteAddress,
      oracleAddress,
      FEEDS[config.key],
      `Custos ${config.symbol} LP`,
      `cLP-${config.key}`,
      owner.address,
    );
    await pool.waitForDeployment();
    await wait(await token.setPool(await pool.getAddress()));

    await wait(await oracle.setPrice(
      FEEDS[config.key],
      ethers.parseUnits(config.price18, 18),
      ethers.parseUnits('0.01', 18),
      0,
    ));

    const seed = ethers.parseUnits('10000', 6);
    await wait(await quoteToken.approve(await pool.getAddress(), seed));
    await wait(await pool.addLiquidity(seed, 0, []));

    markets[config.key] = {
      name: config.name,
      tokenSymbol: config.symbol,
      underlying: config.underlying,
      pythSymbol: config.pythSymbol,
      feedId: FEEDS[config.key],
      unit: config.unit,
      token: await token.getAddress(),
      pool: await pool.getAddress(),
    };
  }

  return markets;
}

async function deployPerps({ owner, quoteToken, oracle }) {
  const registry = await deploy('MarketRegistry', [owner.address]);
  const vault = await deploy('MarginVault', [await quoteToken.getAddress(), owner.address]);
  const engine = await deploy('GiwaPerpEngineV12', [
    await vault.getAddress(),
    await registry.getAddress(),
    await oracle.getAddress(),
    owner.address,
  ]);
  await wait(await vault.setEngine(await engine.getAddress()));

  const markets = {};
  for (const config of PERP_MARKETS) {
    const marketId = perpMarketId(config.key);
    await wait(await registry.setMarket(marketId, {
      symbol: config.key,
      feedId: FEEDS[config.key],
      maxPriceAge: config.maxPriceAge,
      maxLeverageBps: config.maxLeverageBps,
      maintenanceMarginBps: config.maintenanceMarginBps,
      maxConfidenceBps: config.maxConfidenceBps,
      maxOpenInterestUsd: ethers.parseUnits(config.maxOpenInterestUsd, 18),
      active: true,
      reduceOnly: false,
    }));
    await wait(await oracle.setPrice(
      FEEDS[config.key],
      ethers.parseUnits(config.price18, 18),
      ethers.parseUnits('0.01', 18),
      0,
    ));

    markets[config.key] = {
      marketId,
      feedId: FEEDS[config.key],
      maxPriceAge: config.maxPriceAge,
      maxLeverageBps: config.maxLeverageBps,
      maintenanceMarginBps: config.maintenanceMarginBps,
      maxConfidenceBps: config.maxConfidenceBps,
      maxOpenInterestUsd: config.maxOpenInterestUsd,
    };
  }

  const reserve = ethers.parseUnits('500000', 6);
  await wait(await quoteToken.approve(await vault.getAddress(), reserve));
  await wait(await vault.fundReserve(reserve));

  return {
    contracts: {
      marketRegistry: await registry.getAddress(),
      marginVault: await vault.getAddress(),
      perpEngine: await engine.getAddress(),
    },
    markets,
  };
}

async function main() {
  const [owner] = await ethers.getSigners();
  const chainId = Number(network.config.chainId || 47805);
  const networkInfo = { name: 'Custos Local', chainId };
  deploymentRun = beginDeployment({
    root,
    network: networkInfo,
    deployer: owner.address,
    requestedRwaQuote: 'project',
  });
  const quoteToken = await deploy('TestUSDC', [owner.address]);
  const oracle = await deploy('MockOracleRouter', [owner.address]);

  await wait(await quoteToken.ownerMint(owner.address, ethers.parseUnits('2000000', 6)));

  const rwa = await deployRwa({ owner, quoteToken });
  const spot = await deploySpot({ owner, quoteToken, oracle });
  const perps = await deployPerps({ owner, quoteToken, oracle });

  const deployment = writeDeploymentFiles({
    root,
    network: networkInfo,
    deployer: owner.address,
    pyth: '',
    contracts: {
      testUSDC: await quoteToken.getAddress(),
      rwaSettlementToken: await quoteToken.getAddress(),
      verifiedToken: await quoteToken.getAddress(),
      verifiedTokenFaucet: await quoteToken.getAddress(),
      oracleRouter: await oracle.getAddress(),
      ...rwa.contracts,
      ...perps.contracts,
    },
    rwa,
    spot,
    perps: perps.markets,
    recordHistory: true,
    deploymentRunId: deploymentRun.runId,
    deploymentMetadata: {
      requestedRwaQuote: 'project',
      selectedRwaQuote: 'project',
      officialCanReceive: false,
    },
  });

  console.log(JSON.stringify({
    network: deployment.network,
    deployer: deployment.deployer,
    contracts: deployment.contracts,
    spot: Object.fromEntries(Object.entries(spot).map(([key, value]) => [key, value.pool])),
    rwa: rwa.markets.map((market) => ({ symbol: market.symbol, token: market.tokenAddress, pool: market.poolAddress })),
  }, null, 2));
}

main().catch((error) => {
  try {
    failDeployment({ root, runId: deploymentRun?.runId, error });
  } catch (recordError) {
    console.error(`Unable to record failed deployment: ${recordError.message}`);
  }
  console.error(error);
  process.exitCode = 1;
});
