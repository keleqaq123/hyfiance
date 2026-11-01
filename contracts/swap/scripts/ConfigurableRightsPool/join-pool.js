const ConfigurableRightsPool = artifacts.require("ConfigurableRightsPool");
const TToken = artifacts.require("TToken");
const LiquidityPool = artifacts.require("LiquidityPool");

const { toWei, toBN } = web3.utils;
const addresses = require('./token-addresses.json');

const MAX = web3.utils.toTwosComplement(-1);

async function approveIfNot(token, owner, spender, amount) {
  const allowance = await token.allowance(owner, spender);
  if (toBN(allowance).gte(toBN(amount))) {
    return;
  }
  await token.approve(spender, MAX, { from: owner });
  console.log(
    ` - Approved ${token.symbol ? await token.symbol() : token.address}`
  );
}

module.exports = async (callback) => {
  try {
    const [admin] = await web3.eth.getAccounts();

    const crpPoolAddress = '0x7bb29371bdd6dd636aacd7fcb6b3b8ac9f6276c4';
    console.log(`crp pool address: ${crpPoolAddress}`);

    const crpPool = await ConfigurableRightsPool.at(crpPoolAddress);

    const bpoolAddress = await crpPool.bPool();
    const bpoolInstance = await LiquidityPool.at(bpoolAddress);
    const tokens = await bpoolInstance.getCurrentTokens();
    const maxAmountsIn = new Array(tokens.length).fill(web3.utils.toWei('10'));

    for (let token of tokens) {
      const tokenContract = await TToken.at(token);
      await approveIfNot(tokenContract, admin, crpPoolAddress, web3.utils.toWei('10000'));
    }

    await crpPool.joinPool(toWei('0.1'), maxAmountsIn);

  } catch (e) {
    console.log(e, "failed");
  }

  callback();
};
