/* eslint-env es6 */
// const InitialArtifacts = {
//     UniswapV2Factory: require('@uniswap/v2-core/build/UniswapV2Factory.json'),
//     UniswapV2Router02: require('@uniswap/v2-periphery/build/UniswapV2Router02.json')
// };
// const Artifactor = require('@truffle/artifactor');
// const artifactor = new Artifactor(`${__dirname}/../../artifacts/uniswap`);
const BFactory = artifacts.require('Factory');
const BPool = artifacts.require('LiquidityPool');
const ConfigurableRightsPool = artifacts.require('ConfigurableRightsPool');
const CRPFactory = artifacts.require('CRPFactory');
const TToken = artifacts.require('TToken');
const truffleAssert = require('truffle-assertions');
const { time } = require('@openzeppelin/test-helpers');
const { calcRelativeDiff } = require('../../lib/calc_comparisons');
const Decimal = require('decimal.js');
const WETHA = artifacts.require('WETH');
const RightsManager = artifacts.require('RightsManager');
const SmartPoolManager = artifacts.require('SmartPoolManager');
const DesynSafeMath = artifacts.require('DesynSafeMath');

// Helper function to calculate new weights.
function newWeight(block, startBlock, endBlock, startWeight, endWeight) {
    let minBetweenEndBlockAndThisBlock; // This allows for pokes after endBlock that get weights to endWeights
    if (block.number > endBlock) {
        minBetweenEndBlockAndThisBlock = endBlock;
    } else {
        minBetweenEndBlockAndThisBlock = block.number;
    }

    const blockPeriod = endBlock - startBlock;

    if (startWeight >= endWeight) {
        const weightDelta = startWeight - endWeight;
        return startWeight - ((minBetweenEndBlockAndThisBlock - startBlock) * (weightDelta / blockPeriod));
    }
    const weightDelta = endWeight - startWeight;
    return startWeight + ((minBetweenEndBlockAndThisBlock - startBlock) * (weightDelta / blockPeriod));
}

function deadline() {
    // 30 minutes
    return Math.floor(new Date().getTime() / 1000) + 1850000;
}

async function approveIfNot(token, owner, spender, amount) {
    const allowance = await token.allowance(owner, spender);
    if (web3.utils.toBN(allowance).gte(web3.utils.toBN(amount))) {
        return;
    }
    await token.approve(spender, amount, { from: owner });
    console.log(` - Approved ${token.symbol ? (await token.symbol()) : token.address}`);
}

contract('ETFRebalance', async (accounts) => {
    // for await ([contractName, legacyArtifact] of Object.entries(InitialArtifacts)) {
    //     await artifactor.save({
    //         contractName,
    //         ...legacyArtifact,
    //     });
    // }
    // const UniswapV2Router02 = artifacts.require('UniswapV2Router02');
    // const UniswapV2Factory = artifacts.require('UniswapV2Factory');
    const admin = accounts[0];
    const { toWei } = web3.utils;
    const { fromWei } = web3.utils;
    const errorDelta = 10 ** -8;
    const MAX = web3.utils.toTwosComplement(-1);
    let bRightsManager;
    let bSmartPoolManager;
    let bDesynSafeMath;
    let crpFactory;
    let bFactory;
    let crpPool;
    let CRPPOOL;
    let uniswapRouter
    let WETH;
    let DAI;
    let XYZ;
    let ABC;
    let weth;
    let dai;
    let xyz;
    let abc;
    let wETH;
    let bUniswapV2Factory;

    // These are the intial settings for newCrp:
    const swapFee = 10 ** 15;
    let startingXyzWeight = '12';
    let startingWethWeight = '1.5';
    let startingDaiWeight = '1.5';
    const managerFee = toWei('0.1');
    const redeemFee = 10 ** 15;
    const issueFee = 10 ** 15;
    const startWeights = [toWei(startingXyzWeight), toWei(startingWethWeight), toWei(startingDaiWeight)];
    const startBalances = [toWei('80000'), toWei('40'), toWei('10000')];
    const minimumWeightChangeBlockPeriod = 10;
    const SYMBOL = 'BSP';
    const NAME = 'Desyn Pool Token';

    const permissions = {
        canPauseSwapping: false,
        canChangeSwapFee: false,
        canChangeWeights: true,
        canAddRemoveTokens: false,
        canWhitelistLPs: false,
        canChangeCap: false,
    };

    describe('Rebalance', () => {
        const { increaseTo, duration } = time;

        before(async () => {
            // bFactory = await BFactory.deployed();
            // crpFactory = await CRPFactory.deployed();
            // uniswapRouter = await UniswapV2Router02.deployed();
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
            // wETH = await WETHA.new();
            // WETHA.setAsDeployed(wETH);

            // bUniswapV2Factory = await UniswapV2Factory.new(admin);
            // UniswapV2Factory.setAsDeployed(bUniswapV2Factory);
            // uniswapRouter = await UniswapV2Router02.new(bUniswapV2Factory.address, wETH.address);
            // UniswapV2Router02.setAsDeployed(uniswapRouter);
            uniswapRouter = await ethers.getContract('UniswapV2Router02');

            const factoryAddress = (await deployments.get('Factory')).address;
            const crpFactoryAddress = (await deployments.get('CRPFactory')).address;

            bFactory = await BFactory.at(factoryAddress);
            crpFactory = await CRPFactory.at(crpFactoryAddress);

            xyz = await TToken.new('XYZ', 'XYZ', 18);
            weth = await TToken.new('Wrapped Ether', 'WETH', 18);
            dai = await TToken.new('Dai Stablecoin', 'DAI', 18);
            abc = await TToken.new('ABC', 'ABC', 18);

            WETH = weth.address;
            DAI = dai.address;
            XYZ = xyz.address;
            ABC = abc.address;

            // admin balances
            await weth.mint(admin, toWei('1000000'));
            await dai.mint(admin, toWei('1000000'));
            await xyz.mint(admin, toWei('1000000'));
            await abc.mint(admin, toWei('1000000'));

            const uintA = toWei('10000');
            const uintB = toWei('20000');

            await weth.approve(uniswapRouter.address, MAX);
            await dai.approve(uniswapRouter.address, MAX);
            await xyz.approve(uniswapRouter.address, MAX);
            await abc.approve(uniswapRouter.address, MAX);

            await uniswapRouter.addLiquidity(xyz.address, dai.address, uintA, uintB, uintA, uintB, admin, deadline());
            await uniswapRouter.addLiquidity(weth.address, dai.address, uintA, uintB, uintA, uintB, admin, deadline());
            await uniswapRouter.addLiquidity(xyz.address, weth.address, uintA, uintB, uintA, uintB, admin, deadline());
            await uniswapRouter.addLiquidity(abc.address, dai.address, uintB, uintB, uintB, uintB, admin, deadline());
            await uniswapRouter.addLiquidity(xyz.address, abc.address, uintA, uintB, uintA, uintB, admin, deadline());
            await uniswapRouter.addLiquidity(weth.address, abc.address, uintA, uintB, uintA, uintB, admin, deadline());
        });

        beforeEach(async () => {
            const tokenAddresses = [XYZ, WETH, DAI];

            const poolParams = {
                poolTokenSymbol: SYMBOL,
                poolTokenName: NAME,
                constituentTokens: tokenAddresses,
                tokenBalances: startBalances,
                tokenWeights: startWeights,
                swapFee: swapFee,
                managerFee: managerFee,
                redeemFee: redeemFee,
                issueFee: issueFee,
                etype: 1,
            }

            CRPPOOL = await crpFactory.newCrp.call(
                bFactory.address,
                poolParams,
                permissions,
            );

            await crpFactory.newCrp(
                bFactory.address,
                poolParams,
                permissions,
            );

            crpPool = await ConfigurableRightsPool.at(CRPPOOL);

            const CRPPOOL_ADDRESS = crpPool.address;

            await weth.approve(CRPPOOL_ADDRESS, MAX);
            await dai.approve(CRPPOOL_ADDRESS, MAX);
            await xyz.approve(CRPPOOL_ADDRESS, MAX);

            await crpPool.createPool(toWei('100'), 14400, 0);
            // await crpPool.setSwapRouter(uniswapRouter.address); // set swap router
        });

        it('Manager should not be able to rebalance in collecting period', async () => {
            const bPoolAddr = await crpPool.bPool();
            const bPool = await BPool.at(bPoolAddr);

            await truffleAssert.reverts(
                crpPool.rebalance(WETH, DAI, toWei('5'), 0),
                'ERR_NOT_REBALANCE_PERIOD',
            );
        });

        it('Manager should not be able to rebalance after closure period', async () => {
            const bPoolAddr = await crpPool.bPool();
            const bPool = await BPool.at(bPoolAddr);
            const etfStatus = await crpPool.etfStatus();

            // increase time to closure period
            await increaseTo(etfStatus.closureEndTime.toNumber() + +duration.hours(8));

            await truffleAssert.reverts(
                crpPool.rebalance(WETH, DAI, toWei('5'), 0),
                'ERR_NOT_REBALANCE_PERIOD',
            );
        });

        it('Manager should be able to sell part token to existed token', async () => {
            const bPoolAddr = await crpPool.bPool();
            const bPool = await BPool.at(bPoolAddr);
            const etfStatus = await crpPool.etfStatus();

            // increase time to closure period
            await increaseTo(etfStatus.collectEndTime.toNumber() + +duration.hours(8));

            let adminBPTBalance = await crpPool.balanceOf.call(admin);
            let adminWethBalance = await weth.balanceOf.call(admin);
            let bPoolXYZBalance = await xyz.balanceOf.call(bPoolAddr);
            let bPoolWethBalance = await weth.balanceOf.call(bPoolAddr);
            let bPoolDaiBalance = await dai.balanceOf.call(bPoolAddr);

            assert.equal(adminBPTBalance, toWei('100'));
            assert.equal(bPoolXYZBalance, toWei('80000'));
            assert.equal(bPoolWethBalance, toWei('40'));
            assert.equal(bPoolDaiBalance, toWei('10000'));

            let xyzWeight = await bPool.getDenormalizedWeight.call(xyz.address);
            let wethWeight = await bPool.getDenormalizedWeight.call(weth.address);
            let daiWeight = await bPool.getDenormalizedWeight.call(dai.address);

            assert.equal(xyzWeight, toWei(startingXyzWeight));
            assert.equal(wethWeight, toWei(startingWethWeight));
            assert.equal(daiWeight, toWei(startingDaiWeight));

            await crpPool.rebalance(XYZ, WETH, toWei('2'), 0); // This should make XYZ weight from 12 to 10.

            xyzWeight = await bPool.getDenormalizedWeight.call(xyz.address);
            wethWeight = await bPool.getDenormalizedWeight.call(weth.address);
            daiWeight = await bPool.getDenormalizedWeight.call(dai.address);

            assert.equal(xyzWeight, toWei('10'));
            assert.equal(wethWeight, toWei('3.5'));
            assert.equal(daiWeight, toWei(startingDaiWeight));
        });

        it('Manager should be able to sell all token to existed token', async () => {
            const bPoolAddr = await crpPool.bPool();
            const bPool = await BPool.at(bPoolAddr);
            const etfStatus = await crpPool.etfStatus();

            // increase time to closure period
            await increaseTo(etfStatus.collectEndTime.toNumber() + +duration.hours(8));

            let adminBPTBalance = await crpPool.balanceOf.call(admin);
            let adminWethBalance = await weth.balanceOf.call(admin);
            let bPoolXYZBalance = await xyz.balanceOf.call(bPoolAddr);
            let bPoolWethBalance = await weth.balanceOf.call(bPoolAddr);
            let bPoolDaiBalance = await dai.balanceOf.call(bPoolAddr);

            assert.equal(adminBPTBalance, toWei('100'));
            assert.equal(bPoolXYZBalance, toWei('80000'));
            assert.equal(bPoolWethBalance, toWei('40'));
            assert.equal(bPoolDaiBalance, toWei('10000'));

            let xyzWeight = await bPool.getDenormalizedWeight.call(xyz.address);
            let wethWeight = await bPool.getDenormalizedWeight.call(weth.address);
            let daiWeight = await bPool.getDenormalizedWeight.call(dai.address);

            assert.equal(xyzWeight, toWei(startingXyzWeight));
            assert.equal(wethWeight, toWei(startingWethWeight));
            assert.equal(daiWeight, toWei(startingDaiWeight));

            await crpPool.rebalance(XYZ, WETH, toWei('12'), 0);

            wethWeight = await bPool.getDenormalizedWeight.call(weth.address);
            daiWeight = await bPool.getDenormalizedWeight.call(dai.address);

            assert.equal(wethWeight, toWei('13.5'));
            assert.equal(daiWeight, toWei(startingDaiWeight));
        });

        it('Manager should not be able to sell all token to another existed token if the pool tokens lenth is two', async () => {
            const bPoolAddr = await crpPool.bPool();
            const bPool = await BPool.at(bPoolAddr);
            const etfStatus = await crpPool.etfStatus();

            // increase time to closure period
            await increaseTo(etfStatus.collectEndTime.toNumber() + +duration.hours(8));

            await crpPool.rebalance(XYZ, WETH, toWei('12'), 0);

            await truffleAssert.reverts(
                crpPool.rebalance(WETH, DAI, toWei('13.5'), 0),
                'ERR_MIN_TOKENS',
            );
        });

        it('Manager should be able to sell part token to external token', async () => {
            const bPoolAddr = await crpPool.bPool();
            const bPool = await BPool.at(bPoolAddr);
            const etfStatus = await crpPool.etfStatus();

            // increase time to closure period
            await increaseTo(etfStatus.collectEndTime.toNumber() + +duration.hours(8));

            let xyzWeight = await bPool.getDenormalizedWeight.call(xyz.address);
            let wethWeight = await bPool.getDenormalizedWeight.call(weth.address);
            let daiWeight = await bPool.getDenormalizedWeight.call(dai.address);

            assert.equal(xyzWeight, toWei(startingXyzWeight));
            assert.equal(wethWeight, toWei(startingWethWeight));
            assert.equal(daiWeight, toWei(startingDaiWeight));

            await crpPool.rebalance(XYZ, ABC, toWei('2'), 0);

            xyzWeight = await bPool.getDenormalizedWeight.call(xyz.address);
            wethWeight = await bPool.getDenormalizedWeight.call(weth.address);
            daiWeight = await bPool.getDenormalizedWeight.call(dai.address);

            const abcWeight = await bPool.getDenormalizedWeight.call(abc.address);

            assert.equal(xyzWeight, toWei('10'));
            assert.equal(wethWeight, toWei(startingWethWeight));
            assert.equal(daiWeight, toWei(startingDaiWeight));
            assert.equal(abcWeight, toWei('2'));
        });

        it('Manager should be able to sell all token to external token', async () => {
            const bPoolAddr = await crpPool.bPool();
            const bPool = await BPool.at(bPoolAddr);
            const etfStatus = await crpPool.etfStatus();

            // increase time to closure period
            await increaseTo(etfStatus.collectEndTime.toNumber() + +duration.hours(8));

            let xyzWeight = await bPool.getDenormalizedWeight.call(xyz.address);
            let wethWeight = await bPool.getDenormalizedWeight.call(weth.address);
            let daiWeight = await bPool.getDenormalizedWeight.call(dai.address);

            assert.equal(xyzWeight, toWei(startingXyzWeight));
            assert.equal(wethWeight, toWei(startingWethWeight));
            assert.equal(daiWeight, toWei(startingDaiWeight));

            await crpPool.rebalance(XYZ, ABC, toWei('12'), 0);

            wethWeight = await bPool.getDenormalizedWeight.call(weth.address);
            daiWeight = await bPool.getDenormalizedWeight.call(dai.address);

            const abcWeight = await bPool.getDenormalizedWeight.call(abc.address);

            assert.equal(wethWeight, toWei(startingWethWeight));
            assert.equal(daiWeight, toWei(startingDaiWeight));
            assert.equal(abcWeight, toWei('12'));
        });

        it('Manager should be able to sell the token repeatly', async () => {
            const bPoolAddr = await crpPool.bPool();
            const bPool = await BPool.at(bPoolAddr);
            const etfStatus = await crpPool.etfStatus();

            // increase time to closure period
            await increaseTo(etfStatus.collectEndTime.toNumber() + +duration.hours(8));

            let totalWeight = await bPool.getTotalDenormalizedWeight();
            assert.equal(totalWeight, toWei('15'));

            await crpPool.rebalance(XYZ, WETH, toWei('2'), 0);

            let xyzWeight = await bPool.getDenormalizedWeight.call(xyz.address);
            let wethWeight = await bPool.getDenormalizedWeight.call(weth.address);
            let daiWeight = await bPool.getDenormalizedWeight.call(dai.address);
            let abcWeight

            assert.equal(xyzWeight, toWei('10'));
            assert.equal(wethWeight, toWei('3.5'));
            assert.equal(daiWeight, toWei(startingDaiWeight));

            await crpPool.rebalance(XYZ, WETH, toWei('10'), 0);

            wethWeight = await bPool.getDenormalizedWeight.call(weth.address);
            daiWeight = await bPool.getDenormalizedWeight.call(dai.address);

            assert.equal(wethWeight, toWei('13.5'));
            assert.equal(daiWeight, toWei(startingDaiWeight));

            await crpPool.rebalance(WETH, ABC, toWei('3.5'), 0);

            wethWeight = await bPool.getDenormalizedWeight.call(weth.address);
            daiWeight = await bPool.getDenormalizedWeight.call(dai.address);
            abcWeight = await bPool.getDenormalizedWeight.call(abc.address);

            assert.equal(wethWeight, toWei('10'));
            assert.equal(daiWeight, toWei(startingDaiWeight));
            assert.equal(abcWeight, toWei('3.5'));

            totalWeight = await bPool.getTotalDenormalizedWeight();
            assert.equal(totalWeight, toWei('15'));
        });
    });
});
