const path = require('path');
const hre = require('hardhat');
const {
  FEEDS,
  SPOT_MARKETS,
  PERP_MARKETS,
  RWA_MARKETS,
  FALLBACK_ORACLE_PRICES,
  perpMarketId,
  rwaAssetId,
} = require('./market-definitions');
const { beginDeployment, failDeployment, writeDeploymentFiles } = require('./write-deployment');

const { ethers, network } = hre;
const DEFAULT_PYTH = '0x2880ab155794e7179c9ee2e38200202908c17b43';
const DEFAULT_VERIFIED_TOKEN = '0xBCdB22f56642DE57624CfC2fBb9eE398cF3CA268';
const DEFAULT_VERIFIED_TOKEN_FAUCET = '0xfe4b4F5f2f8843dC9Ca75E563f2f7eB0f44Ae83e';
const root = path.resolve(__dirname, '../../..');
let deploymentRun;

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address,uint256) returns (bool)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
];

async function deploy(name, args = []) {
  const factory = await ethers.getContractFactory(name);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function wait(tx) {
  return tx.wait();
}

function eventArgument(receipt, contract, eventName, argumentName) {
  for (const log of receipt?.logs || []) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === eventName) {
        return parsed.args[argumentName];
      }
    } catch {
      // The receipt contains logs from several contracts. Ignore unrelated logs.
    }
  }
  return '';
}

async function readEventually(read, label) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const value = await read();
      if (value && value !== ethers.ZeroAddress) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`GIWA RPC did not expose ${label} after confirmation${lastError ? `: ${lastError.message}` : '.'}`);
}

async function readReservesEventually(pool, label) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const reserves = await pool.getReserves();
      if (reserves[0] > 0n && reserves[1] > 0n) return reserves;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`GIWA RPC did not expose non-zero ${label} after confirmation${lastError ? `: ${lastError.message}` : '.'}`);
}

async function canTransferToUnverifiedRecipient(token, owner) {
  // GIWA's current VerifiedToken implementation may require every recipient
  // to be Dojang-verified. A newly deployed AMM contract cannot complete that
  // external verification flow, so probe a deterministic unused EOA before
  // selecting the official token as an executable pool quote asset.
  const probe = ethers.getAddress(
    `0x${ethers.keccak256(ethers.toUtf8Bytes('custos-rwa-quote-probe')).slice(-40)}`,
  );

  try {
    await token.transfer.staticCall(probe, 1n, { from: owner.address });
    return true;
  } catch {
    return false;
  }
}

async function assertContract(address, label) {
  if (!ethers.isAddress(address)) throw new Error(`${label} is not a valid address.`);
  const code = await ethers.provider.getCode(address);
  if (code === '0x') throw new Error(`${label} has no code at ${address}.`);
}

async function pythUpdate(feedId) {
  const base = (process.env.PYTH_HERMES_URL || 'https://hermes.pyth.network').replace(/\/$/, '');
  const url = `${base}/v2/updates/price/latest?ids[]=${encodeURIComponent(feedId)}`;
  const response = await fetch(url, {
    headers: process.env.PYTH_API_KEY ? { Authorization: `Bearer ${process.env.PYTH_API_KEY}` } : {},
  });
  if (!response.ok) throw new Error(`Pyth update failed (${response.status}) for ${feedId}: ${await response.text()}`);
  const body = await response.json();
  const data = body?.binary?.data || [];
  if (!data.length) throw new Error(`Pyth returned no binary update for ${feedId}.`);
  return data.map((value) => String(value).startsWith('0x') ? String(value) : `0x${value}`);
}

async function canSubmitPythUpdate({ oracle, updateData }) {
  if (!updateData.length) return false;

  try {
    const fee = await oracle.getUpdateFee(updateData);
    await oracle.updatePriceFeeds.staticCall(updateData, { value: fee });
    return true;
  } catch (error) {
    const reason = error.shortMessage || error.reason || error.message || 'unknown revert';
    console.warn(`GIWA Pyth Core rejected the update payload; using fallback: ${reason}`);
    return false;
  }
}

async function configureFallbacks({ oracle }) {
  const keys = [...new Set([
    ...SPOT_MARKETS.map((market) => market.key),
    ...PERP_MARKETS.map((market) => market.key),
  ])];

  for (const key of keys) {
    if (!FEEDS[key] || !FALLBACK_ORACLE_PRICES[key]) continue;
    await wait(await oracle.setFallbackPrice(
      FEEDS[key],
      ethers.parseUnits(FALLBACK_ORACLE_PRICES[key], 18),
      ethers.parseUnits('0.01', 18),
    ));
  }
}

async function deployRwa({ owner, quoteAddress }) {
  const registry = await deploy('RwaVerificationRegistry');
  const assetFactory = await deploy('RwaAssetFactory', [await registry.getAddress()]);
  const poolFactory = await deploy('RwaPoolFactory');
  const quote = new ethers.Contract(quoteAddress, ERC20_ABI, owner);
  const decimals = Number(await quote.decimals());
  const quoteUnit = 10n ** BigInt(decimals);
  const assetUnit = 10n ** 18n;
  const markets = [];

  for (const config of RWA_MARKETS) {
    const assetId = rwaAssetId(config.key);
    const documentHash = ethers.id(`Custos GIWA test proof | ${config.key} | ${config.name}`);
    await wait(await registry.registerAsset(assetId, documentHash, config.metadataURI, Math.floor(new Date(`${config.maturity}T00:00:00Z`).getTime() / 1000), config.risk));
    await wait(await registry.setAssetStatus(assetId, 2));
    const tokenReceipt = await wait(await assetFactory.createAssetToken(
      assetId,
      config.name,
      config.key,
      ethers.parseUnits(config.supply, 18),
    ));
    // GIWA RPC can lag one block on mapping reads even after tx.wait(). Prefer
    // the factory event in the confirmed receipt, then retry the mapping read.
    const tokenAddress = eventArgument(
      tokenReceipt,
      assetFactory,
      'AssetTokenCreated',
      'token',
    ) || await readEventually(
      () => assetFactory.assetToken(assetId),
      `${config.key} asset token`,
    );

    const poolReceipt = await wait(await poolFactory.createPool(tokenAddress, quoteAddress));
    const poolAddress = eventArgument(
      poolReceipt,
      poolFactory,
      'PoolCreated',
      'pool',
    ) || await readEventually(
      () => poolFactory.getPool(tokenAddress, quoteAddress),
      `${config.key} RWA pool`,
    );
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
      assetLiquidity: '0',
      quoteLiquidity: '0',
    });
  }

  return {
    contracts: {
      registry: await registry.getAddress(),
      assetFactory: await assetFactory.getAddress(),
      poolFactory: await poolFactory.getAddress(),
    },
    quote,
    decimals,
    quoteUnit,
    assetUnit,
    markets,
  };
}

async function seedRwa({ owner, rwa, quoteAddress }) {
  const balance = await rwa.quote.balanceOf(owner.address);
  if (balance === 0n) {
    console.warn('RWA pools were created but not seeded: deployer has no official VerifiedToken.');
    return;
  }

  const configuredBps = Number(process.env.BOOTSTRAP_VERIFIED_TOKEN_BPS || 6000);
  const seedTotal = (balance * BigInt(Math.min(9500, Math.max(100, configuredBps)))) / 10000n;
  const weightTotal = RWA_MARKETS.reduce((sum, market) => sum + market.weight, 0);
  let distributed = 0n;

  for (let index = 0; index < rwa.markets.length; index += 1) {
    const market = rwa.markets[index];
    const isLast = index === rwa.markets.length - 1;
    const quoteAmount = isLast ? seedTotal - distributed : (seedTotal * BigInt(RWA_MARKETS[index].weight)) / BigInt(weightTotal);
    distributed += quoteAmount;
    const assetAmount = (quoteAmount * rwa.assetUnit) / rwa.quoteUnit;
    if (quoteAmount === 0n || assetAmount === 0n) continue;

    const asset = await ethers.getContractAt('RwaAssetToken', market.tokenAddress, owner);
    const pool = await ethers.getContractAt('RwaAMMPool', market.poolAddress, owner);
    await wait(await asset.approve(market.poolAddress, assetAmount));
    await wait(await rwa.quote.approve(market.poolAddress, quoteAmount));
    await wait(await pool.addLiquidity(assetAmount, quoteAmount, 0, 0, owner.address));
    const reserves = await readReservesEventually(pool, `${market.symbol} RWA pool reserves`);
    market.assetLiquidity = ethers.formatUnits(reserves.assetReserve, 18);
    market.quoteLiquidity = ethers.formatUnits(reserves.quoteReserve, rwa.decimals);
  }
}

async function deploySpot({ owner, quoteToken, oracle }) {
  const tokenFactory = await ethers.getContractFactory('SyntheticRwaToken');
  const poolFactory = await ethers.getContractFactory('OracleSpotPool');
  const quoteAddress = await quoteToken.getAddress();
  const markets = {};

  for (const config of SPOT_MARKETS) {
    const token = await tokenFactory.deploy(config.name, config.symbol, config.underlying, config.unit, owner.address);
    await token.waitForDeployment();
    const pool = await poolFactory.deploy(
      await token.getAddress(), quoteAddress, await oracle.getAddress(), FEEDS[config.key],
      `Custos ${config.symbol} LP`, `cLP-${config.key}`, owner.address,
    );
    await pool.waitForDeployment();
    await wait(await token.setPool(await pool.getAddress()));

    let updateData = [];
    let oracleMode = 'fallback';
    try {
      const candidate = await pythUpdate(FEEDS[config.key]);
      if (await canSubmitPythUpdate({ oracle, updateData: candidate })) {
        updateData = candidate;
        oracleMode = 'pyth';
      }
    } catch (error) {
      console.warn(`Pyth update unavailable for ${config.key}; using configured testnet fallback: ${error.message}`);
    }
    const fee = await pool.getUpdateFee(updateData);
    const seed = ethers.parseUnits('1000', 6);
    await wait(await quoteToken.approve(await pool.getAddress(), seed));
    await wait(await pool.addLiquidity(seed, 0, updateData, { value: fee }));

    markets[config.key] = {
      name: config.name,
      tokenSymbol: config.symbol,
      underlying: config.underlying,
      pythSymbol: config.pythSymbol,
      feedId: FEEDS[config.key],
      unit: config.unit,
      token: await token.getAddress(),
      pool: await pool.getAddress(),
      oracleMode,
    };
  }
  return markets;
}

async function deployPerps({ owner, quoteToken, oracle }) {
  const marketRegistry = await deploy('MarketRegistry', [owner.address]);
  const vault = await deploy('MarginVault', [await quoteToken.getAddress(), owner.address]);
  const engine = await deploy('GiwaPerpEngineV12', [await vault.getAddress(), await marketRegistry.getAddress(), await oracle.getAddress(), owner.address]);
  await wait(await vault.setEngine(await engine.getAddress()));

  const markets = {};
  for (const config of PERP_MARKETS) {
    const marketId = perpMarketId(config.key);
    await wait(await marketRegistry.setMarket(marketId, {
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
    markets[config.key] = {
      marketId,
      feedId: FEEDS[config.key],
      maxPriceAge: config.maxPriceAge,
      maxLeverageBps: config.maxLeverageBps,
      maintenanceMarginBps: config.maintenanceMarginBps,
      maxConfidenceBps: config.maxConfidenceBps,
      maxOpenInterestUsd: config.maxOpenInterestUsd,
      oracleMode: 'pyth-or-fallback',
    };
  }

  const reserve = ethers.parseUnits('100000', 6);
  await wait(await quoteToken.approve(await vault.getAddress(), reserve));
  await wait(await vault.fundReserve(reserve));
  return {
    contracts: {
      marketRegistry: await marketRegistry.getAddress(),
      marginVault: await vault.getAddress(),
      perpEngine: await engine.getAddress(),
    },
    markets,
  };
}

async function main() {
  const [owner] = await ethers.getSigners();
  const chainId = Number(network.config.chainId || 91342);
  const networkInfo = { name: 'GIWA Sepolia', chainId };
  const verifiedTokenAddress = process.env.VERIFIED_TOKEN_ADDRESS || DEFAULT_VERIFIED_TOKEN;
  const faucetAddress = process.env.VERIFIED_TOKEN_FAUCET_ADDRESS || DEFAULT_VERIFIED_TOKEN_FAUCET;
  const pythAddress = process.env.PYTH_ADDRESS || DEFAULT_PYTH;
  const requestedRwaQuote = String(process.env.RWA_QUOTE_MODE || 'auto').toLowerCase();
  deploymentRun = beginDeployment({
    root,
    network: networkInfo,
    deployer: owner.address,
    pyth: pythAddress,
    requestedRwaQuote,
  });
  await assertContract(verifiedTokenAddress, 'Official VerifiedToken');
  await assertContract(faucetAddress, 'Official VerifiedToken Faucet');
  await assertContract(pythAddress, 'GIWA Pyth Core');

  const verified = new ethers.Contract(verifiedTokenAddress, ERC20_ABI, owner);
  const verifiedDecimals = Number(await verified.decimals());
  const verifiedSymbol = await verified.symbol();
  const projectQuote = await deploy('TestUSDC', [owner.address]);
  const oracle = await deploy('PythOracleRouter', [pythAddress, owner.address]);
  await configureFallbacks({ oracle });
  await wait(await projectQuote.ownerMint(owner.address, ethers.parseUnits('500000', 6)));

  const officialCanReceive = await canTransferToUnverifiedRecipient(verified, owner);
  const useOfficialRwaQuote =
    requestedRwaQuote === 'official'
      ? true
      : requestedRwaQuote === 'project'
        ? false
        : officialCanReceive;

  if (useOfficialRwaQuote) {
    console.log(`RWA quote: official ${verifiedSymbol} (${verifiedTokenAddress})`);
  } else {
    console.warn(
      `RWA quote: project tUSDC (${await projectQuote.getAddress()}). ` +
      'The current GIWA VerifiedToken only accepts transfers to Dojang-verified recipients; ' +
      'newly deployed AMM contracts cannot receive it.',
    );
  }

  const rwaQuoteToken = useOfficialRwaQuote
    ? verified
    : await ethers.getContractAt('TestUSDC', await projectQuote.getAddress());
  const rwa = await deployRwa({ owner, quoteAddress: await rwaQuoteToken.getAddress() });
  await seedRwa({ owner, rwa, quoteAddress: await rwaQuoteToken.getAddress() });
  const spot = await deploySpot({ owner, quoteToken: projectQuote, oracle });
  const perps = await deployPerps({ owner, quoteToken: projectQuote, oracle });

  const rwaQuoteAddress = await rwaQuoteToken.getAddress();
  const rwaSettlement = useOfficialRwaQuote
    ? {
        name: 'GIWA VerifiedToken',
        symbol: verifiedSymbol,
        address: rwaQuoteAddress,
        decimals: verifiedDecimals,
        official: true,
        faucetAddress,
        claimUrl: 'https://sepolia-playground.giwa.io/',
        claimFlow: 'Issue Dojang → Claim VerifiedToken → return to Custos Finance',
        disclaimer: 'Official GIWA Playground test token. Testnet-only; not USDC and not redeemable for cash.',
      }
    : {
        name: 'Custos Test USD Coin',
        symbol: 'tUSDC',
        address: rwaQuoteAddress,
        decimals: 6,
        official: false,
        faucetAddress: rwaQuoteAddress,
        claimUrl: '',
        claimFlow: 'Call the Custos tUSDC faucet from the connected wallet.',
        disclaimer: 'Project-owned testnet-only collateral; not USDC, not fiat-backed and not redeemable for cash.',
      };

  const deployment = writeDeploymentFiles({
    root,
    network: networkInfo,
    deployer: owner.address,
    pyth: pythAddress,
    contracts: {
      // `verifiedToken` is the quote-token field consumed by the RWA UI for
      // backwards compatibility. Keep the external official token separately
      // when GIWA's recipient restrictions require project tUSDC instead.
      verifiedToken: rwaQuoteAddress,
      verifiedTokenFaucet: useOfficialRwaQuote ? faucetAddress : rwaQuoteAddress,
      officialVerifiedToken: verifiedTokenAddress,
      rwaSettlementToken: rwaQuoteAddress,
      testUSDC: await projectQuote.getAddress(),
      oracleRouter: await oracle.getAddress(),
      ...rwa.contracts,
      ...perps.contracts,
    },
    rwa: {
      settlementToken: rwaSettlement,
      markets: rwa.markets,
    },
    spot,
    perps: perps.markets,
    recordHistory: true,
    deploymentRunId: deploymentRun.runId,
    deploymentMetadata: {
      requestedRwaQuote,
      selectedRwaQuote: useOfficialRwaQuote ? 'official' : 'project',
      officialCanReceive,
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
