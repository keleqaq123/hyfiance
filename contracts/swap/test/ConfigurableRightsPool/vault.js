/* eslint-env es6 */

const Vault = artifacts.require('Vault');
const truffleAssert = require('truffle-assertions');
const { assert } = require('chai');

contract('configurableSwapFee', async (accounts) => {
    const admin = accounts[0];
    const { toWei } = web3.utils;

    const MAX = web3.utils.toTwosComplement(-1);


    before(async () => {
    });
    it('Non Controller account should not be able to change managerFee', async () => {
        const bVault = await Vault.at("0x4CD0E925e3045d1DeEc16029303225A1f60AdA28");
      const managerAddress =    await bVault.pool_manager("0x33D4037A47A7AC657F6E4e2CB6c772a605e4cF16");
      console.log("managerAddress",managerAddress);
      const tokenList =    await bVault.poolTokenList("0x33D4037A47A7AC657F6E4e2CB6c772a605e4cF16");
      console.log("tokenList",tokenList);
      const pool_tokenAmount =    await bVault.poolTokenAmount("0x33D4037A47A7AC657F6E4e2CB6c772a605e4cF16");
      console.log("pool_tokenAmount",pool_tokenAmount.toString());
    });
});
