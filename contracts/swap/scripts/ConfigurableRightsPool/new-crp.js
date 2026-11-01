const BFactory = artifacts.require("Factory");
const ConfigurableRightsPool = artifacts.require("ConfigurableRightsPool");
const TToken = artifacts.require("TToken");
const CRPFactory = artifacts.require("CRPFactory");
const { toWei, toBN } = web3.utils;

async function approveIfNot(token, owner, spender, amount) {
  const allowance = await token.allowance(owner, spender);
  if (toBN(allowance).gte(toBN(amount))) {
    return;
  }
  await token.approve(spender, amount, { from: owner });
  console.log(
    ` - Approved ${token.symbol ? await token.symbol() : token.address}`
  );
}

module.exports = async (callback) => {
  try {
    // enum Etypes { OPENED, CLOSED }
    // enum Period { HALF, ONE, TWO }

    const [admin] = await web3.eth.getAccounts();
    // const bFactory = await BFactory.deployed();
    const bFactory = await BFactory.at('0xF3ec7FfeA53840Dc60A7Ea38D1c94F4BCDa64512');
    const crpFactory = await CRPFactory.deployed();
 
    const startWeights = [toWei("20"), toWei("2.5"), toWei("1.5")];
    const startBalances = [toWei("800"), toWei("40"), toWei("100")];
    const SYMBOL = "MVPI";
    const NAME = "Metaverse Platform Index";
    const swapFee = 10**15;
    const MAX = web3.utils.toTwosComplement(-1);

    const dot = await TToken.at('0xF3b0a9B095351FD98A5767cB03Fa0CA4DF3B5eB2');
    const uni = await TToken.at('0xf71995c1DeBe92Cdf2e15D87c0696c35b80Eb7f0');
    const axs = await TToken.at('0xF57D274101C8b447f3eD381b97A818f05D28B36f');

    const DOT = dot.address;
    const UNI = uni.address;
    const AXS = axs.address;

    const permissions = {
      canPauseSwapping: true,
      canChangeSwapFee: true,
      canChangeWeights: true,
      canAddRemoveTokens: true,
      canWhitelistLPs: false,
      canChangeCap: false,
    };

    const longPermissions = {
      canPauseSwapping: false,
      canChangeSwapFee: false,
      canChangeWeights: false,
      canAddRemoveTokens: true,
      canWhitelistLPs: false,
      canChangeCap: false,
      canMakeMischief: true,
      canOverflowArray: true,
      canBeThreeTooLong: true,
    };

    const poolParams = {
      poolTokenSymbol: SYMBOL,
      poolTokenName: NAME,
      constituentTokens: [DOT, UNI, AXS],
      tokenBalances: startBalances,
      tokenWeights: startWeights,
      swapFee: swapFee,
      etype: 1 // new parameters
    };

    const result = await crpFactory.newCrp(
      bFactory.address,
      poolParams,
      permissions
    );
    const crpPoolAddress = result.logs[0].args.pool;
    console.log(`crp pool address: ${crpPoolAddress}`);

    await approveIfNot(dot, admin, crpPoolAddress, MAX);
    await approveIfNot(uni, admin, crpPoolAddress, MAX);
    await approveIfNot(axs, admin, crpPoolAddress, MAX);

    const crpPool = await ConfigurableRightsPool.at(crpPoolAddress);

    // to create opened-end etf
    // await crpPool.createPool(toWei('1000'), 0, 0);

    // to create closed-end etf
    await crpPool.createPool(toWei('1000'), 86400, 0);
  } catch (e) {
    console.log(e, "failed");
  }

  callback();
};
