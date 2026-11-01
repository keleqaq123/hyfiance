/* eslint-env es6 */

const { artifacts } = require("hardhat");

const BFactory = artifacts.require('Factory');
const BPool = artifacts.require('LiquidityPool');
const ConfigurableRightsPool = artifacts.require('ConfigurableRightsPool');
const CRPFactory = artifacts.require('CRPFactory');
const BVault = artifacts.require('Vault');
const TToken = artifacts.require('TToken');
const BOracle = artifacts.require('DesynChainlinkOracle');
contract('configurableProFee', async (accounts) => {
    const admin = accounts[0];
    const managerOwner = accounts[2];
    const tesra = accounts[4];
    const { toWei } = web3.utils;
    const { deployments } = hre;
    const MAX = web3.utils.toTwosComplement(-1);
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
    let oracle;

    // These are the intial settings for newCrp:
    const swapFee = 10 ** 15;
    const managerFee = toWei('0.1');
    const redeemFee = 0;
    const issueFee = 0;
    const perfermanceFee =toWei('0.001');
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

        const factoryAddress = (await deployments.get('Factory')).address;
        const crpFactoryAddress = (await deployments.get('CRPFactory')).address;
        const vaultAddress = (await deployments.get('Vault')).address;
        const oracleAddress =  (await deployments.get('DesynChainlinkOracle')).address;
        bFactory = await BFactory.at(factoryAddress);
        crpFactory = await CRPFactory.at(crpFactoryAddress);
        vault = await BVault.at(vaultAddress);
        oracle = await BOracle.at(oracleAddress);
 
        xyz = await TToken.new('XYZ', 'XYZ', 18);
        weth = await TToken.new('Wrapped Ether', 'WETH', 18);
        dai = await TToken.new('Dai Stablecoin', 'DAI', 18);
        abc = await TToken.new('ABC', 'ABC', 18);

        await oracle.setDirectPrice(xyz.address,toWei('1'));
        await oracle.setDirectPrice(weth.address,toWei('2'));
        await oracle.setDirectPrice(dai.address,toWei('3'));
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
             perfermanceFee:perfermanceFee,
             etype:1
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
        await crpPool.createPool(toWei('100'), 12, 0);
    });

    it('joinpool', async () => {
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
        const amount9 =   await xyz.balanceOf(accounts[1]);
        console.log("begin",amount9.toString());
        const amount7 =  await weth.balanceOf(accounts[1]);
        console.log("begin",amount7.toString());
        const amount8 =   await dai.balanceOf(accounts[1]);
        console.log("begin",amount8.toString());

        await crpPool.joinPool(1000000000000000+"",[toWei('8'), toWei('41'), toWei('1')],{from:accounts[1]});
        const amount91 =   await xyz.balanceOf(accounts[1]);
        console.log("begin",amount91.toString());
        const amount71 =  await weth.balanceOf(accounts[1]);
        console.log("begin",amount71.toString());
        const amount81 =   await dai.balanceOf(accounts[1]);
        console.log("begin",amount81.toString());
      const beginAmount = await crpPool.beginFund(accounts[1]);
      console.log("begin",beginAmount.etfAmount.toString());
      console.log("begin",beginAmount.fundAmount.toString());
      const beginAmount11aq = await oracle.testList(0);
      console.log("oracle",beginAmount11aq.toString());
      const beginAmount12aq = await oracle.testList(1);
      console.log("oracle",beginAmount12aq.toString());
      const beginAmount13aq = await oracle.testList(2);
      console.log("oracle",beginAmount13aq.toString());
    await oracle.setDirectPrice(xyz.address,toWei('2'));
    await oracle.setDirectPrice(weth.address,toWei('4'));
    await oracle.setDirectPrice(dai.address,toWei('6'));
    await crpPool.exitPool(1000000000000000+"",[toWei('0'), toWei('0'), toWei('0')],{from:accounts[1]});

    const beginAmount1 = await crpPool.beginFund(accounts[1]);
    console.log("begin",beginAmount1.etfAmount.toString());
    console.log("begin",beginAmount1.fundAmount.toString());
    const endAmount1 = await crpPool.endFund(accounts[1]);
    console.log("end",endAmount1.etfAmount.toString());
    console.log("end",endAmount1.fundAmount.toString());

    const beginAmount11q = await oracle.testList(3);
    console.log("oracle",beginAmount11q.toString());
    const beginAmount12q = await oracle.testList(4);
    console.log("oracle",beginAmount12q.toString());
    const beginAmount13q = await oracle.testList(5);
    console.log("oracle",beginAmount13q.toString());

    //  const beginAmount11 = await crpPool.testList(0);
    //   console.log("begin",beginAmount11.toString());
    //   const beginAmount12 = await crpPool.testList(1);
    //   console.log("begin",beginAmount12.toString());
    //   const beginAmount13 = await crpPool.testList(2);
    //   console.log("begin",beginAmount13.toString());
     const  listas  =  await vault.managerClaimList(crpPool.address);
        console.log("list",listas);
        const amount3 =   await xyz.balanceOf(vault.address);
        const amount1 =  await weth.balanceOf(vault.address);
       const amount2 =   await dai.balanceOf(vault.address);
       console.log(amount3.toString());
       console.log(amount1.toString());
       console.log(amount2.toString());
  
        //    await vault.managerClaim(CRPPOOL_ADDRESS);
        //    const amount11 =  await weth.balanceOf(vault.address);
        //    const amount21 =   await dai.balanceOf(vault.address);
        //    const amount31 =   await xyz.balanceOf(vault.address);
        //    console.log(amount11.toString());
        //    console.log(amount21.toString());
        //    console.log(amount31.toString());
        
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
