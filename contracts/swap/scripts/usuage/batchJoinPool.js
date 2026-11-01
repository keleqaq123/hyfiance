const { ethers } = require('hardhat');

async function approveIfNot(token, owner, spender, amount) {
    const allowance = await token.allowance(owner, spender);
    if (allowance.gte(amount)) {
        console.log('allowance is enough');
        return;
    }
    await token.approve(spender, ethers.constants.MaxUint256, {from: owner});
    console.log(` - Approved ${token.symbol ? (await token.symbol()) : token.address}`);
}

async function run() {
    const [account1] = await ethers.getSigners();
    const { utils } = ethers;

    const actionsAddress = '0x64E24A8EE9f854FC692ca77F18eBC1176608Cb2e';
    const proxyAddress = '0x74f18Fd66bFb308f6C67C4fB4F5588c0b2E99869';
    const poolAddresses = [
        // '0xf13cb06da4ba756c2f1c9f202da364204991a6cd',
        // '0x74eadd7cc2364c7e843af02db752f2348ec93cb6',
        // '0xc85406be3dba50ee3663878e51c86b8b605eff7e',
        '0xd85430e8997fe2eccb542069140577417bcf0506', // failed
        '0xcd1e7c5ae5f48b6cba3831cfed773b103df86a04', // failed
        '0xec654c1ef814256d7128d8f485c8f3f21f6023d2', // failed
        // '0x652a6fd04bcb8e970810fa7826e5cc312809166c',
        '0xaab0b71405a7f9ee01f04b89d5dcf262a00335d5',// failed
        // '0x3c551fef0fd76a12d06d70ca8ed92728cd26131d',
        '0xE5e11805d41F14ff444387ECf07f4F62376BB6a2',// failed
        // '0x43b4d50dabd0c658aa9311374df1e3c587c4953a'
    ];

    // proxy call
    const actions = await ethers.getContractAt('Actions', actionsAddress);
    const proxyFactory = await ethers.getContractFactory('DSProxy');

    try {
        for (let poolAddress of poolAddresses) {
            const proxyInstance = await proxyFactory.attach(proxyAddress);
        
            const crpPool = await ethers.getContractAt('contracts:test/ConfigurableRightsPool.sol/ConfigurableRightsPool', poolAddress);
            const bpool = await crpPool.bPool();
            const bpoolIns = await ethers.getContractAt('LiquidityPool', bpool);
            const tokens = await bpoolIns.getCurrentTokens();
            const amountsIn = new Array(tokens.length).fill(utils.parseEther('1000000'));
        
            for (let token of tokens) {
                const tokenContract = await ethers.getContractAt('Token', token);
                await approveIfNot(tokenContract, account1.address, proxyAddress, utils.parseEther('1000000'));
            }
            const data = actions.interface.encodeFunctionData('joinSmartPool', [poolAddress, utils.parseEther('10000'), amountsIn]);
            const rss = await proxyInstance['execute(address,bytes)'](actionsAddress, data);
            console.log(rss);
        }
    } catch (error) {
        console.log(error, 'join pool failed')
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
