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

    const crpPoolAddress = '0xf13cb06da4ba756c2f1c9f202da364204991a6cd';
    console.log(`crp pool address: ${crpPoolAddress}`);

    const crpPool = await ConfigurableRightsPool.at(crpPoolAddress);

    const bpoolAddress = await crpPool.bPool();
    const bpoolInstance = await LiquidityPool.at(bpoolAddress);
    const tokens = await bpoolInstance.getCurrentTokens();
    const minAmountsIn = new Array(tokens.length).fill(web3.utils.toWei('0'));

    await approveIfNot(crpPool, admin, crpPoolAddress, web3.utils.toWei('10000'));

    const poolBal = await crpPool.balanceOf(admin);
    console.log(poolBal/1e18, 'pool balacne');

    await crpPool.exitPool(toWei('2'), minAmountsIn);

  } catch (e) {
    console.log(e, "failed");
  }

  callback();
};
