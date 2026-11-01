const ConfigurableRightsPool = artifacts.require("ConfigurableRightsPool");
const TToken = artifacts.require("TToken");
const { toWei, toBN } = web3.utils;
const addresses = require('./token-addresses.json');

module.exports = async (callback) => {
  try {
    const [admin] = await web3.eth.getAccounts();
    const MAX = web3.utils.toTwosComplement(-1);

    const crpPoolAddress = '0x3aE1642930ba47bDdbA49a067CC58dD358B42a0e';

    const dot = await TToken.at('0xF3b0a9B095351FD98A5767cB03Fa0CA4DF3B5eB2');
    const axs = await TToken.at('0xF57D274101C8b447f3eD381b97A818f05D28B36f');
    const uni = await TToken.at('0xf71995c1DeBe92Cdf2e15D87c0696c35b80Eb7f0');
    const usdt = await TToken.at('0x70ED4ABBB2d681B1a1E7b98739D7Db4Cd80d77CC');

    const crpPool = await ConfigurableRightsPool.at(crpPoolAddress);

    const controller = await crpPool.getController();
    console.log(controller, 'controller');

    // set uniswap router
    // await crpPool.setSwapRouter('0xb8390ADb7402F145284B17eDF44ed6052e4C13c5');
    
    // await crpPool.setController('0xbF9c5AC0794db038b563C944b2B0C6D569c4d515');

    // await crpPool.rebalance(dot.address, axs.address, toWei('2.5'), 0); // sell part of dot to axs
    // await crpPool.rebalance(dot.address, axs.address, toWei('17.5'), 0); // sell all rest dot to axs
    // await crpPool.rebalance(axs.address, usdt.address, toWei('5'), 0); // sell part of axs to usdt
    await crpPool.rebalance(axs.address, dot.address, toWei('16.5'), 0); // sell all rest axs to dot

  } catch (e) {
    console.log(e, "failed");
  }

  callback();
};
