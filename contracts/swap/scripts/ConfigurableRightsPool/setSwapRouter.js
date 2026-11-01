const ConfigurableRightsPool = artifacts.require("ConfigurableRightsPool");
const TToken = artifacts.require("TToken");
const { toWei, toBN } = web3.utils;
const addresses = require('./token-addresses.json');

module.exports = async (callback) => {
  try {
    const [admin] = await web3.eth.getAccounts();

    const crpPoolAddress = '0xfcf245d53bfe02fe62ee2971bd16de5d85d06e72';

    const crpPool = await ConfigurableRightsPool.at(crpPoolAddress);

    const controller = await crpPool.getController();
    console.log(controller, 'controller');

    // set swap router
    // await crpPool.setSwapRouter('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D');
    
    // set controller back to proxy address
    await crpPool.setController('0xf845c5bea837ba0bfb00fef9ad1ad7195c9b2fda');
  } catch (e) {
    console.log(e, "failed");
  }

  callback();
};
