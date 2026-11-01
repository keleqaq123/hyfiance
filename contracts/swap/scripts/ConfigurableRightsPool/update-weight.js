const ConfigurableRightsPool = artifacts.require("ConfigurableRightsPool");
const TToken = artifacts.require("TToken");
const { toWei, toBN } = web3.utils;
const addresses = require('./token-addresses.json');

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
    const [admin] = await web3.eth.getAccounts();
    const MAX = web3.utils.toTwosComplement(-1);

    // const axs = await TToken.at(addresses['AXS']);
    const axs = await TToken.at('0xFD3acCBCe9C4C9FE13C13983eC02f798591313EA');
    const crpPoolAddress = '0xF095323e95b231395D641055379497A1FB14A69D';

    await approveIfNot(axs, admin, crpPoolAddress, MAX);

    const crpPool = await ConfigurableRightsPool.at(crpPoolAddress);

    const controller = await crpPool.getController();
    console.log(controller, 'controller');
    
    // await crpPool.setController('0x74f18Fd66bFb308f6C67C4fB4F5588c0b2E99869');
    await crpPool.updateWeight(axs.address, toWei('25'));

  } catch (e) {
    console.log(e, "failed");
  }

  callback();
};
