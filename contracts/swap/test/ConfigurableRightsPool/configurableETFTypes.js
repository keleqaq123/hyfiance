/* eslint-env es6 */

const BFactory = artifacts.require('Factory');
const BPool = artifacts.require('LiquidityPool');
const ConfigurableRightsPool = artifacts.require('ConfigurableRightsPool');
const CRPFactory = artifacts.require('CRPFactory');
const BVault = artifacts.require('Vault');
const TToken = artifacts.require('TToken');
const truffleAssert = require('truffle-assertions');
const { time } = require('@openzeppelin/test-helpers');
const { calcRelativeDiff } = require('../../lib/calc_comparisons');;
const Decimal = require('decimal.js');
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
    return Math.floor(new Date().getTime() / 1000) + 1800;
}

async function approveIfNot(token, owner, spender, amount) {
    const allowance = await token.allowance(owner, spender);
    if (web3.utils.toBN(allowance).gte(web3.utils.toBN(amount))) {
      return;
    }
    await token.approve(spender, amount, {from: owner});
    console.log(` - Approved ${token.symbol ? (await token.symbol()) : token.address}`);
}

contract('ETFTypes', async (accounts) => {
    const { deployments } = hre;
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
    let vault;
    let WETH;
    let DAI;
    let XYZ;
    let ABC;
    let weth;
    let dai;
    let xyz;
    let abc;

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

    describe('CreateETFs', () => {
        before(async () => {
            // bFactory = await BFactory.deployed();
            // crpFactory = await CRPFactory.deployed();
            // vault = await BVault.deployed();
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


        });

        it('Manager should be able to create opened-end ETF successfully', async () => {
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
                etype: 1
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

            
            const block = await web3.eth.getBlock('latest');
            await crpPool.createPool(toWei('1000'), 14400, 0);
            
            const bPoolAddr = await crpPool.bPool();
            const bPool = await BPool.at(bPoolAddr);
            const etfStatus = await crpPool.etfStatus();
            
            assert.equal(etfStatus.collectPeriod.toNumber(), 14400);
            assert.equal(etfStatus.closurePeriod.toNumber(), 86400);
        });

        it('Manager should be able to create closed-end ETF successfully', async () => {
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
                etype: 0
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

            await crpPool.createPool(toWei('1000'), 0, 0);

            const bPoolAddr = await crpPool.bPool();
            const bPool = await BPool.at(bPoolAddr);
            const etfStatus = await crpPool.etfStatus();

            assert.equal(etfStatus.collectPeriod, 0);
            assert.equal(etfStatus.closurePeriod, 0);
        });
    });

    describe('ETFManagement', () => {
        const { increaseTo, duration } = time;

        before(async () => {
            // bFactory = await BFactory.deployed();
            // crpFactory = await CRPFactory.deployed();
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

            await crpPool.createPool(toWei('1000'), 14400, 0);
        });

        it('User should be able to trade ETF during collect period', async () => {
            const bPoolAddr = await crpPool.bPool();
            const bPool = await BPool.at(bPoolAddr);

            const tokens = await bPool.getCurrentTokens();
            for (let token of tokens) {
                const tokenContract = await TToken.at(token);
                await tokenContract.approve(crpPool.address, MAX);
            }
            const maxAmountsIn = new Array(tokens.length).fill(toWei('1000'));
            await crpPool.joinPool(toWei('0.1'), maxAmountsIn); 
            
            const minAmountsIn = new Array(tokens.length).fill(toWei('0'));
            await crpPool.exitPool(toWei('0.1'), minAmountsIn);         
        });

        it('User should not be able to trade ETF during closure period', async () => {
            const bPoolAddr = await crpPool.bPool();
            const bPool = await BPool.at(bPoolAddr);
            const etfStatus = await crpPool.etfStatus();

            await increaseTo(etfStatus.collectEndTime.toNumber() + +duration.hours(12));

            const tokens = await bPool.getCurrentTokens();
            for (let token of tokens) {
                const tokenContract = await TToken.at(token);
                await tokenContract.approve(crpPool.address, MAX);
            }
            const maxAmountsIn = new Array(tokens.length).fill(toWei('100'));
            const minAmountsIn = new Array(tokens.length).fill(toWei('0'));
            
            await truffleAssert.reverts(
                crpPool.joinPool(toWei('1'), maxAmountsIn),
                'ERR_COLLECT_PERIOD_FINISHED',
            );    
    
            await truffleAssert.reverts(
                crpPool.exitPool(toWei('0.1'), minAmountsIn),
                'ERR_CLOSURE_TIME_NOT_ARRIVED',
            ); 
        });

        it('User should not be able to buy but can sell ETF during clear period', async () => {
            const bPoolAddr = await crpPool.bPool();
            const bPool = await BPool.at(bPoolAddr);
            const etfStatus = await crpPool.etfStatus();

            await increaseTo(etfStatus.closureEndTime.toNumber() + +duration.hours(1));

            const tokens = await bPool.getCurrentTokens();
            for (let token of tokens) {
                const tokenContract = await TToken.at(token);
                await tokenContract.approve(crpPool.address, MAX);
            }
            const maxAmountsIn = new Array(tokens.length).fill(toWei('100'));
            
            await truffleAssert.reverts(
                crpPool.joinPool(toWei('1'), maxAmountsIn),
                'ERR_COLLECT_PERIOD_FINISHED',
            );    

            const minAmountsIn = new Array(tokens.length).fill(toWei('0'));
            await crpPool.exitPool(toWei('0.1'), minAmountsIn);  
        });
    });
});
