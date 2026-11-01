const { ethers } = require('hardhat');

async function run() {
    [account1] = await ethers.getSigners();

    const { utils } = ethers
    const actionsAddress = '0x64E24A8EE9f854FC692ca77F18eBC1176608Cb2e'
    const poolAddress = '0x5207b6f9500794a04e91fa202024e8c375bd5968'
    const tok2Address = '0xdCF66694d46E4F463C564e5bD30E6529B092aE44'

    deployerAddress = account1.address;

    const proxy = '0x74f18Fd66bFb308f6C67C4fB4F5588c0b2E99869'

    // proxy call
    const proxyFactory = await ethers.getContractFactory('DSProxy');
    const proxyInstance = await proxyFactory.attach(proxy);

    const actions = await ethers.getContractAt('Actions', actionsAddress);
    const data = actions.interface.encodeFunctionData('increaseWeight', [poolAddress, tok2Address, utils.parseEther('12'), utils.parseEther('10')])
    console.log(data, 'data---')

    const tok2 = await ethers.getContractAt('Token', tok2Address);

    await tok2.approve(proxy, ethers.constants.MaxUint256);

    const rss = await proxyInstance['execute(address,bytes)'](actionsAddress, data);
    console.log(rss);
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
