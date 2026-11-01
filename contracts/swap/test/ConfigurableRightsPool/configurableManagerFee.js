/* eslint-env es6 */

const BFactory = artifacts.require('Factory');
const BPool = artifacts.require('LiquidityPool');
const ConfigurableRightsPool = artifacts.require('ConfigurableRightsPool');
const CRPFactory = artifacts.require('CRPFactory');
const BVault = artifacts.require('Vault');
const TToken = artifacts.require('TToken');
const BDSProxyFactory = artifacts.require("DSProxyFactory");
const BProxyRegistry = artifacts.require("ProxyRegistry");
const truffleAssert = require('truffle-assertions');
const { assert } = require('chai');
const RightsManager = artifacts.require('RightsManager');
const SmartPoolManager = artifacts.require('SmartPoolManager');
const DesynSafeMath = artifacts.require('DesynSafeMath');

contract('configurableManagerFee', async (accounts) => {
    const admin = accounts[0];
    const managerOwner = accounts[2];
    const tesra = accounts[4];
    const { toWei } = web3.utils;
    const { deployments } = hre;
    const MAX = web3.utils.toTwosComplement(-1);
    let bRightsManager;
    let bSmartPoolManager;
    let bDesynSafeMath;
    let crpFactory;
    let bFactory;
    let crpPool;
    let CRPPOOL;
    let WETH;
    let DAI;
    let XYZ;
    let ABC;
    let weth;
    let dai;
    let abc;
    let xyz;
    let vault;
    let DSProxyFactory;
    let ProxyRegistry;
    let proxy;
    let proxyRegistry;

    // These are the intial settings for newCrp:
    const swapFee = 10 ** 15;
    const managerFee = toWei('0.1');
    const redeemFee = 10 ** 15;
    const issueFee = 10 ** 15;
    const startWeights = [toWei('12'), toWei('1.5'), toWei('1.5')];
    const startBalances = [toWei('80000'), toWei('40'), toWei('10000')];
    const SYMBOL = 'BSP';
    const NAME = 'Desyn Pool Token';

    // const permissions = [false, true, false, false];
    const permissions = {
        canPauseSwapping: false,
        canChangeSwapFee: false,
        canChangeWeights: false,
        canAddRemoveTokens: true,
        canWhitelistLPs: false,
        canChangeCap: false
    };

    before(async () => {
        //During testing，You need to replace the following test script in ConfigurableRightsPool 
        //DEFAULT_ADD_TOKEN_TIME_LOCK_IN_BLOCKS set 0
        //replace vault address
        console.log("managerOwner",managerOwner);

        // bFactory = await BFactory.deployed();
        // crpFactory = await CRPFactory.deployed();
        // bRightsManager = await RightsManager.new();
        // RightsManager.setAsDeployed(bRightsManager);
        // bSmartPoolManager = await SmartPoolManager.new();
        // SmartPoolManager.setAsDeployed(bSmartPoolManager);
        // bDesynSafeMath = await DesynSafeMath.new();
        // DesynSafeMath.setAsDeployed(bDesynSafeMath);
        // bFactory = await BFactory.new();
        // BFactory.setAsDeployed(bFactory);
        // CRPFactory.link(bDesynSafeMath);
        // CRPFactory.link(bSmartPoolManager);
        // CRPFactory.link(bRightsManager);
        // crpFactory = await CRPFactory.new();
        // CRPFactory.setAsDeployed(crpFactory);
        // vault = await BVault.at("0x9BC17C13B29377D3EB0b4B10b196DC0f6888a49e");
        //  DSProxyFactory = await BDSProxyFactory.deployed();
        //  ProxyRegistry = await BProxyRegistry.deployed(DSProxyFactory.address);
        //  console.log(ProxyRegistry.address);

        //  proxyRegistry =   await ProxyRegistry.build.call();
        //  await ProxyRegistry.build(tesra);
        //  proxy =await BProxyRegistry.at(proxyRegistry);
        // console.log(proxy);
        // console.log(proxy.address);

        const factoryAddress = (await deployments.get('Factory')).address;
        const crpFactoryAddress = (await deployments.get('CRPFactory')).address;
        const vaultAddress = (await deployments.get('Vault')).address;

        bFactory = await BFactory.at(factoryAddress);
        crpFactory = await CRPFactory.at(crpFactoryAddress);
        vault = await BVault.at(vaultAddress);

        xyz = await TToken.new('XYZ', 'XYZ', 18);
        weth = await TToken.new('Wrapped Ether', 'WETH', 18);
        dai = await TToken.new('Dai Stablecoin', 'DAI', 18);
        abc = await TToken.new('ABC', 'ABC', 18);

        WETH = weth.address;
        DAI = dai.address;
        XYZ = xyz.address;
        ABC = abc.address;

        // admin balances
        await weth.mint(admin, toWei('100'));
        await dai.mint(admin, toWei('15000'));
        await xyz.mint(admin, toWei('100000'));
        await abc.mint(admin, toWei('100000'));

        const tokenAddresses = [XYZ, WETH, DAI];
        const poolParams = {
            poolTokenSymbol: SYMBOL,
            poolTokenName: NAME,
            constituentTokens: tokenAddresses,
            tokenBalances: startBalances,
            tokenWeights: startWeights,
            swapFee: swapFee,
            managerFee: managerFee,
             redeemFee:redeemFee,
             issueFee:issueFee,
             etype:0
        }

        CRPPOOL = await crpFactory.newCrp.call(
            bFactory.address,
            poolParams,
            permissions
        );

        await crpFactory.newCrp(
            bFactory.address,
            poolParams,
            permissions
        );

        crpPool = await ConfigurableRightsPool.at(CRPPOOL);

        const CRPPOOL_ADDRESS = crpPool.address;
        console.log("vault",vault.address);
        console.log("CRPPOOL_ADDRESS",CRPPOOL_ADDRESS);
        await weth.approve(CRPPOOL_ADDRESS, MAX);
        await dai.approve(CRPPOOL_ADDRESS, MAX);
        await xyz.approve(CRPPOOL_ADDRESS, MAX);
        await abc.approve(CRPPOOL_ADDRESS,MAX);
        await crpPool.createPool(toWei('100'), 10, 0);
    });

    // it('crpPool should have correct rights set', async () => {
    //     const managerRight = await crpPool.hasPermission(6);
    //     assert.isTrue(managerRight);

    //     let x;
    //     for (x = 0; x < permissions.length; x++) {
    //         if (x !== 6) {
    //             const otherPerm = await crpPool.hasPermission(x);
    //             assert.isFalse(otherPerm);
    //         }
    //     }
    // });

    // it('Non Controller account should not be able to change managerFee', async () => {
    //     await truffleAssert.reverts(
    //         crpPool.setManagerFee(toWei('0.001'), { from: accounts[1] }),
    //         'ERR_NOT_CONTROLLER',
    //     );
    // });

    // it('Controller should be able to change managerFee', async () => {
    //     const deployedManagerFee = await crpPool.managerFee();
    //     console.log(deployedManagerFee.toNumber());
    //     assert.equal(managerFee, deployedManagerFee.toNumber());

    //     const newManagerFee = toWei('0.1');
    //     await crpPool.setManagerFee(newManagerFee);

    //     // Setting it to the same as the old value, so if it fails silently we wouldn't know
    //     // To guard against that, set it to something actually different in the next test, to
    //     // make sure it really changes it
    //     const newManagerFeeCheck = await crpPool.managerFee();
    //     assert.equal(newManagerFee, newManagerFeeCheck);

    //     // const differentSwapFee = toWei('0.003');
    //     // await crpPool.setSwapFee(differentSwapFee);

    //     // const secondSwapFeeCheck = await bPool.getSwapFee();
    //     // assert.equal(differentSwapFee, secondSwapFeeCheck);
    // });

    // it('Configurable tokens should revert because non-permissioned', async () => {
    //     truffleAssert.reverts(
    //         crpPool.commitAddToken(ABC, toWei('1'), toWei('1')),
    //         'ERR_CANNOT_ADD_REMOVE_TOKENS',
    //     );

    //     truffleAssert.reverts(
    //         crpPool.applyAddToken(),
    //         'ERR_CANNOT_ADD_REMOVE_TOKENS',
    //     );

    //     truffleAssert.reverts(
    //         crpPool.removeToken(WETH),
    //         'ERR_CANNOT_ADD_REMOVE_TOKENS',
    //     );
    // });

    // it('Set public swap should revert because non-permissioned', async () => {
    //     await truffleAssert.reverts(
    //         crpPool.setPublicSwap(false),
    //         'ERR_NOT_PAUSABLE_SWAP',
    //     );
    // });

    // it('Should not be able to bypass crpPool', async () => {
    //     const bPoolAddr = await crpPool.bPool();
    //     const bPool = await BPool.at(bPoolAddr);

    //     let oldSwapFee = await bPool.getSwapFee();
    //     await truffleAssert.reverts(
    //         bPool.setSwapFee(toWei('0.007')),
    //         'ERR_NOT_CONTROLLER'
    //     );
    //     let newSwapFee = await bPool.getSwapFee();

    //     assert.equal(newSwapFee - oldSwapFee, 0);
    // });


    it('claim token', async () => {
        //mint
        const CRPPOOL_ADDRESS = crpPool.address;
        console.log(accounts[2]);
        await weth.mint(accounts[1], toWei('100'));
        await dai.mint(accounts[1], toWei('15000'));
        await xyz.mint(accounts[1], toWei('100000'));
        await weth.approve(CRPPOOL_ADDRESS, MAX,{from:accounts[1]});
        await dai.approve(CRPPOOL_ADDRESS, MAX,{from:accounts[1]});
        await xyz.approve(CRPPOOL_ADDRESS, MAX,{from:accounts[1]});
        //claim fee
        //the first claim before
        console.log("the first claim before");
        const bPoolAddr = await crpPool.bPool();
        const bPool = await BPool.at(bPoolAddr);
        const managerAddress11 =    await vault.pool_manager(crpPool.address);
        console.log("managerAddress",managerAddress11);
        const tokenList11 =    await vault.poolManagerTokenList(crpPool.address);
        console.log("tokenList",tokenList11);
        const pool_tokenAmount11 =    await vault.poolManagerTokenAmount(crpPool.address);
        console.log("pool_tokenAmount",pool_tokenAmount11.toString());
        const tokenListIssue11 =    await vault.poolIssueRedeemTokenList(crpPool.address);
        console.log("tokenListIssue",tokenListIssue11);
        const pool_tokenAmountIssue11 =    await vault.poolIssueRedeemTokenAmount(crpPool.address);
        console.log("pool_tokenAmountIssue",pool_tokenAmountIssue11.toString());

        console.log("the first joinPool before");
        await crpPool.joinPool(1000000000000000+"",[toWei('8'), toWei('41'), toWei('1')],{from:accounts[1]});
     const  listas  =  await vault.managerClaimList(crpPool.address);
        console.log("list",listas);
               const amount1 =  await weth.balanceOf(vault.address);
       const amount2 =   await dai.balanceOf(vault.address);
       const amount3 =   await xyz.balanceOf(vault.address);
       console.log(amount1.toString());
       console.log(amount2.toString());
       console.log(amount3.toString());
           await vault.managerClaim(CRPPOOL_ADDRESS);
           const amount11 =  await weth.balanceOf(vault.address);
           const amount21 =   await dai.balanceOf(vault.address);
           const amount31 =   await xyz.balanceOf(vault.address);
           console.log(amount11.toString());
           console.log(amount21.toString());
           console.log(amount31.toString());
        
    //    await crpPool.claimManagerFee(1,{from:accounts[2]});
    //    console.log("the first claim after");
    //    const managerAddress12 =    await vault.pool_manager(crpPool.address);
    //    console.log("managerAddress",managerAddress12);
    //    const tokenList12 =    await vault.poolManagerTokenList(crpPool.address);
    //    console.log("tokenList",tokenList12);
    //    const pool_tokenAmount12 =    await vault.poolManagerTokenAmount(crpPool.address);
    //    console.log("pool_tokenAmount",pool_tokenAmount12.toString());
    //    const tokenListIssue12 =    await vault.poolIssueRedeemTokenList(crpPool.address);
    //    console.log("tokenListIssue",tokenListIssue12);
    //    const pool_tokenAmountIssue12 =    await vault.poolIssueRedeemTokenAmount(crpPool.address);
    //    console.log("pool_tokenAmountIssue",pool_tokenAmountIssue12.toString());
    //    // account[1]  jointoken 
    //    const xyzPool = await xyz.balanceOf(bPoolAddr);
    //    const etfTotal = await crpPool.totalSupply();
    //    console.log(etfTotal.toString());
    //     const etfAmount = (toWei('80000')/xyzPool)*etfTotal;
    //     console.log(etfAmount);

    //     console.log("the first joinPool before");
    //     await crpPool.joinPool(100000000000000000000+"",[toWei('81000'), toWei('41'), toWei('11000')],{from:accounts[1]});
    //     // await crpPool.joinPool(10000000000000000+"",[toWei('81000'), toWei('41'), toWei('11000')],{from:accounts[1]});
        
    //     // await crpPool.exitPool(99000000000000000000+"",[100000,100000,100000]);
    //     // const wethPool1 = await weth.balanceOf(bPoolAddr);
    //     // console.log(wethPool1.toString());
    //     //vault

    //     console.log("the first joinPool after");
    //     const managerAddress =    await vault.pool_manager(crpPool.address);
    //     console.log("managerAddress",managerAddress);
    //     const tokenList =    await vault.poolManagerTokenList(crpPool.address);
    //     console.log("tokenList",tokenList);
    //     const pool_tokenAmount =    await vault.poolManagerTokenAmount(crpPool.address);
    //     console.log("pool_tokenAmount",pool_tokenAmount.toString());
    //     const tokenListIssue =    await vault.poolIssueRedeemTokenList(crpPool.address);
    //     console.log("tokenListIssue",tokenListIssue);
    //     const pool_tokenAmountIssue =    await vault.poolIssueRedeemTokenAmount(crpPool.address);
    //     console.log("pool_tokenAmountIssue",pool_tokenAmountIssue.toString());

    //     //exit
    //     const etfTotalNew = await crpPool.totalSupply();
    //     console.log(etfTotalNew.toString());
    //     const amount21 =  await weth.balanceOf(accounts[1]);
    //     console.log("amount21",amount21.toString());

    //     console.log("the first exitPool before");
    //     await crpPool.exitPool(99900000000000000000+"",[100000,100000,100000],{from:accounts[1]});
    //     // await crpPool.exitPool(99900000000000000000+"",[100000,100000,100000],{from:accounts[1]});
    //     console.log("the first exitPool after");
    //     const managerAddress13 =    await vault.pool_manager(crpPool.address);
    //     console.log("managerAddress",managerAddress13);
    //     const tokenList13 =    await vault.poolManagerTokenList(crpPool.address);
    //     console.log("tokenList",tokenList13);
    //     const pool_tokenAmount13 =    await vault.poolManagerTokenAmount(crpPool.address);
    //     console.log("pool_tokenAmount",pool_tokenAmount13.toString());
    //     const tokenListIssue13 =    await vault.poolIssueRedeemTokenList(crpPool.address);
    //     console.log("tokenListIssue",tokenListIssue13);
    //     const pool_tokenAmountIssue13 =    await vault.poolIssueRedeemTokenAmount(crpPool.address);
    //     console.log("pool_tokenAmountIssue",pool_tokenAmountIssue13.toString());


    //     const etfTotalNew1 = await crpPool.totalSupply();
    //     console.log(etfTotalNew1.toString());
    //     const amount22 =  await weth.balanceOf(accounts[1]);
    //     console.log("amount22",amount22.toString());
    //     const wethPool = await weth.balanceOf(bPoolAddr);
    //     console.log(wethPool.toString());

    //     // await crpPool.setController(proxy.address);
    //     // await vault.managerClaim(CRPPOOL_ADDRESS);

    //     //add token
    //     const  list  =  await vault.managerClaimList(crpPool.address);
    //     console.log("list",list);


    //     console.log("the first commitAddToken before");
    //     await crpPool.commitAddToken(abc.address,toWei('10000'),toWei('1.5'));
    //     await crpPool.applyAddToken();
    //     //delete token
    //     const managerAddress14 =    await vault.pool_manager(crpPool.address);
    //     console.log("managerAddress",managerAddress14);
    //     const tokenList14 =    await vault.poolManagerTokenList(crpPool.address);
    //     console.log("tokenList",tokenList14);
    //     const pool_tokenAmount14 =    await vault.poolManagerTokenAmount(crpPool.address);
    //     console.log("pool_tokenAmount",pool_tokenAmount14.toString());
    //     const tokenListIssue14 =    await vault.poolIssueRedeemTokenList(crpPool.address);
    //     console.log("tokenListIssue",tokenListIssue14);
    //     const pool_tokenAmountIssue14 =    await vault.poolIssueRedeemTokenAmount(crpPool.address);
    //     console.log("pool_tokenAmountIssue",pool_tokenAmountIssue14.toString());

    //     await crpPool.removeToken(xyz.address);
    //     //claim fee
    //     const  list1  =  await vault.managerClaimList(crpPool.address);
    //     console.log("list",list1);
    //     await crpPool.claimManagerFee(1,{from:accounts[2]});
    //     const  list2  =  await vault.managerClaimList(crpPool.address);
    //     console.log("list",list2);
    //     const managerAddress1 =    await vault.pool_manager(crpPool.address);
    //     console.log("managerAddress",managerAddress1);
    //     const tokenList1 =    await vault.poolManagerTokenList(crpPool.address);
    //     console.log("tokenList",tokenList1);
    //     const pool_tokenAmount1 =    await vault.poolManagerTokenAmount(crpPool.address);
    //     console.log("pool_tokenAmount",pool_tokenAmount1.toString());
    //     const tokenListIssue1 =    await vault.poolIssueRedeemTokenList(crpPool.address);
    //     console.log("tokenListIssue",tokenListIssue1);
    //     const pool_tokenAmountIssue1 =    await vault.poolIssueRedeemTokenAmount(crpPool.address);
    //     console.log("pool_tokenAmountIssue",pool_tokenAmountIssue1.toString());
    //     const pool_tokenAmountIssuesss1 =    await vault.record_number(crpPool.address);
    //     console.log("pool_tokenAmountIssuesss1",pool_tokenAmountIssuesss1.toString());
        
    //     await vault.managerClaim(crpPool.address);

    //     const pool_tokenAmountIssue1234 =    await vault.managerClaimRecordList(crpPool.address);
    //     console.log("pool_tokenAmountIssue1234",pool_tokenAmountIssue1234[1].tokens);

    //     //test amount 
    //    const amount7 =  await weth.balanceOf("0x6f395356E6AAA1E0d575817A00676d9148DE3A5e");
    //    const amount8 =   await dai.balanceOf("0x6f395356E6AAA1E0d575817A00676d9148DE3A5e");
    //    const amount9 =   await xyz.balanceOf("0x6f395356E6AAA1E0d575817A00676d9148DE3A5e");
    //    console.log(amount7.toString());
    //    console.log(amount8.toString());
    //    console.log(amount9.toString());
    //    const amount1 =  await weth.balanceOf(vault.address);
    //    const amount2 =   await dai.balanceOf(vault.address);
    //    const amount3 =   await xyz.balanceOf(vault.address);
    //    console.log(amount1.toString());
    //    console.log(amount2.toString());
    //    console.log(amount3.toString());

        //add token 
        // await crpPool.commitAddToken(abc.address,toWei('10000'),toWei('1.5'));
       //exitToken
    //   const lpTokenAmount =  await crpPool.balanceOf(admin);
    //   console.log(lpTokenAmount.toString());
    //    await crpPool.exitPool(lpTokenAmount/2+"",[100000,100000,100000]);
    //    const amount7 =  await weth.balanceOf(admin);
    //    const amount8 =   await dai.balanceOf(admin);
    //    const amount9 =   await xyz.balanceOf(admin);
    //    console.log("amount7",(amount7-amount4).toString());
    //    console.log("amount8",(amount8-amount5).toString());
    //    console.log("amount9",(amount9-amount6).toString());

    });

});
