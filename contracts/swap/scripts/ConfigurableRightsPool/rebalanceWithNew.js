const ConfigurableRightsPool = artifacts.require("ConfigurableRightsPool");
const TToken = artifacts.require("TToken");
const { toWei, toBN } = web3.utils;
const addresses = require('./token-addresses.json');

module.exports = async (callback) => {
  try {
    const [admin] = await web3.eth.getAccounts();
    const MAX = web3.utils.toTwosComplement(-1);

    const crpPoolAddress = '0xea3Cfbe4dEA4A67059DD87a0E590F605B4eD4ec6';

    const uni = await TToken.at('0xeBE8bC811afD8d7F6e574F2CF9cEc31B0dd1A7C7');
    const usdt = await TToken.at('0x0fbaF7eBf0bADb043469B679647b8CF5d452a3a2');

    const crpPool = await ConfigurableRightsPool.at(crpPoolAddress);

    const controller = await crpPool.getController();
    console.log(controller, 'controller');

    // set uniswap router
    await crpPool.setSwapRouter('0x9DF3a5Cf6A9Cf7b82E158bD0930A448c8451D468');
    
    // await crpPool.setController('0x74f18Fd66bFb308f6C67C4fB4F5588c0b2E99869');
    await crpPool.rebalanceWithTokensChange(uni.address, usdt.address, 0);

  } catch (e) {
    console.log(e, "failed");
  }

  callback();
};
