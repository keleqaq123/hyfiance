// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IPythCFI {
    struct Price { int64 price; uint64 conf; int32 expo; uint256 publishTime; }
    function getUpdateFee(bytes[] calldata data) external view returns(uint256);
    function updatePriceFeeds(bytes[] calldata data) external payable;
    function getPriceNoOlderThan(bytes32 id,uint256 age) external view returns(Price memory);
}

/// @notice Account-bound receipts for ETH principal, denominated using ETH/USD
/// at deposit time. Not a dollar-pegged stablecoin or a yield-bearing strategy.
/// No administrator, collateral withdrawals, token tax, or discretionary mint.
contract CustosCFIStake {
    string public constant name="Custos Finance Staking Receipt";
    string public constant symbol="CFI";
    uint8 public constant decimals=18;
    bytes32 public constant ETH_USD=0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;
    IPythCFI public immutable pyth;
    uint256 public totalSupply;
    uint256 public totalPrincipal;
    mapping(address=>uint256) public balanceOf;
    mapping(address=>uint256) public principalOf;
    uint256 private entered;
    event Transfer(address indexed from,address indexed to,uint256 value);
    event Staked(address indexed account,uint256 ethAmount,uint256 cfiAmount,uint256 price18,uint256 publishTime);
    event Unstaked(address indexed account,uint256 cfiAmount,uint256 ethAmount);
    modifier lock(){require(entered==0,"REENTRANCY");entered=1;_;entered=0;}
    constructor(address oracle){require(oracle.code.length>0,"ORACLE");pyth=IPythCFI(oracle);}
    function allowance(address,address) external pure returns(uint256){return 0;}
    function approve(address,uint256) external pure returns(bool){revert("ACCOUNT_BOUND_RECEIPT");}
    function transfer(address,uint256) external pure returns(bool){revert("ACCOUNT_BOUND_RECEIPT");}
    function transferFrom(address,address,uint256) external pure returns(bool){revert("ACCOUNT_BOUND_RECEIPT");}
    function stake(uint256 amount,uint256 minCFI,bytes[] calldata data) external payable lock returns(uint256 minted){
        require(amount>0&&amount<=1e24,"AMOUNT");
        uint256 fee=pyth.getUpdateFee(data);require(msg.value==amount+fee,"VALUE");
        pyth.updatePriceFeeds{value:fee}(data);
        IPythCFI.Price memory quote=pyth.getPriceNoOlderThan(ETH_USD,60);
        require(quote.price>0&&quote.expo>=-18&&quote.expo<=0,"PRICE");
        require(quote.publishTime<=block.timestamp+5&&quote.publishTime+60>=block.timestamp,"STALE_PRICE");
        require(uint256(quote.conf)*100<=uint256(uint64(quote.price)),"CONFIDENCE");
        uint256 price18=uint256(uint64(quote.price))*10**uint256(int256(18)+quote.expo);
        require(price18<=1e26,"PRICE_RANGE");
        minted=amount*price18/1e18;require(minted>0&&minted>=minCFI,"SLIPPAGE");
        balanceOf[msg.sender]+=minted;totalSupply+=minted;principalOf[msg.sender]+=amount;totalPrincipal+=amount;
        emit Transfer(address(0),msg.sender,minted);emit Staked(msg.sender,amount,minted,price18,quote.publishTime);
    }
    function previewUnstake(address account,uint256 cfi) public view returns(uint256){
        uint256 balance=balanceOf[account];require(cfi>0&&cfi<=balance,"BALANCE");
        return cfi==balance?principalOf[account]:principalOf[account]*cfi/balance;
    }
    function unstake(uint256 cfi,uint256 minETH) external lock returns(uint256 amount){
        amount=previewUnstake(msg.sender,cfi);require(amount>0&&amount>=minETH,"SLIPPAGE");
        balanceOf[msg.sender]-=cfi;totalSupply-=cfi;principalOf[msg.sender]-=amount;totalPrincipal-=amount;
        emit Transfer(msg.sender,address(0),cfi);emit Unstaked(msg.sender,cfi,amount);
        (bool ok,)=payable(msg.sender).call{value:amount}("");require(ok,"ETH_TRANSFER");
    }
}
