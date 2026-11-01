const { ethers } = require('hardhat');

async function run() {
    [account1] = await ethers.getSigners();

    const { utils } = ethers
    const actionsAddress = '0xB2d804d351ACb46Abc7010bfd8bF6c946Bc1F3B8'
    const poolAddress = '0xa29827994a657662c3187D5c78Df90E53E4F9d05'
    const tok2Address = '0xCA66270f6054CfFEcbB5c074a7BFfFc60F19d19C'
    const tok3Address = '0xd8D10a600C389Dd597A995886376545d4Ce4Fa7C'
    const registryAddress = '0x25E496cD29227033323dc8AbcC3aA43849555429'

    deployerAddress = account1.address;

    const dsProxyRegistry = await ethers.getContractFactory('ProxyRegistry');
    const dsProxyRegInstance = await dsProxyRegistry.attach(registryAddress);
    await dsProxyRegInstance['build()']();

    const proxy = await dsProxyRegInstance.proxies(deployerAddress)

    console.log(proxy, 'proxy---')
    // proxy call
    const proxyFactory = await ethers.getContractFactory('DSProxy');
    const proxyInstance = await proxyFactory.attach(proxy);

    const actions = await ethers.getContractAt('Actions', actionsAddress);
    const data = actions.interface.encodeFunctionData('joinPool', [poolAddress, utils.parseEther('1'), [utils.parseEther('100'), utils.parseEther('100')]])
    console.log(data, 'data---')

    const tok2 = await ethers.getContractAt('Token', tok2Address);
    const tok3 = await ethers.getContractAt('Token', tok3Address);

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
