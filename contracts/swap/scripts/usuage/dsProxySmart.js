const { ethers } = require('hardhat');

async function run() {
    [account1] = await ethers.getSigners();

    const { utils } = ethers
    const actionsAddress = '0x258dB6fF4434988B3032D7793856c4abCB24EB6b'
    const poolAddress = '0x70190Bc926Fcbf69D8348A10eB053f31B6AA9694'
    const tok1Address = '0x077310e204B4358acA67169de95fa8dB1ddf03B3'
    const tok2Address = '0x64cF67cF8F785c3f820f6a3021E2D86D7b7996DF'
    const tok3Address = '0x4dFF124Bf5416870f79751D62B5C9494442f6010'
    const registryAddress = '0x27AC9822C7e4d7Ff7375C611EFA78bf80B1d68D1'

    deployerAddress = account1.address;

    const dsProxyRegistry = await ethers.getContractFactory('ProxyRegistry');
    const dsProxyRegInstance = await dsProxyRegistry.attach(registryAddress);
    // await dsProxyRegInstance['build()']();

    const proxy = await dsProxyRegInstance.proxies(deployerAddress)

    console.log(proxy, 'proxy---')
    // proxy call
    const proxyFactory = await ethers.getContractFactory('DSProxy');
    const proxyInstance = await proxyFactory.attach(proxy);

    const actions = await ethers.getContractAt('Actions', actionsAddress);
    const data = actions.interface.encodeFunctionData('joinSmartPool', [poolAddress, utils.parseEther('1'), [utils.parseEther('1000'), utils.parseEther('1000'), utils.parseEther('1000')]])
    console.log(data, 'data---')

    const tok1 = await ethers.getContractAt('Token', tok1Address);
    const tok2 = await ethers.getContractAt('Token', tok2Address);
    const tok3 = await ethers.getContractAt('Token', tok3Address);

    await tok1.approve(proxy, ethers.constants.MaxUint256);
    await tok2.approve(proxy, ethers.constants.MaxUint256);
    await tok3.approve(proxy, ethers.constants.MaxUint256);

    const rss = await proxyInstance['execute(address,bytes)'](actionsAddress, data);
    console.log(rss);
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
