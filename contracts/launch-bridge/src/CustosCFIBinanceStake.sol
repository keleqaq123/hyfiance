// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Account-bound ETH principal receipts. Binance ETH/USDT quotes are
/// attested by the operator, not by Binance itself. No withdrawal/mint admin.
contract CustosCFIBinanceStake {
    string public constant name="Custos Finance Staking Receipt";
    string public constant symbol="CFI";
    uint8 public constant decimals=18;
    address public immutable quoteSigner;
    uint256 public totalSupply;
    uint256 public totalPrincipal;
    mapping(address=>uint256) public balanceOf;
    mapping(address=>uint256) public principalOf;
    mapping(address=>uint256) public nonces;
    uint256 private entered;
    bytes32 private constant DOMAIN_TYPEHASH=keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant QUOTE_TYPEHASH=keccak256("StakeQuote(address account,uint256 amount,uint256 price18,uint256 issuedAt,uint256 deadline,uint256 nonce)");
    event Transfer(address indexed from,address indexed to,uint256 value);
    event Staked(address indexed account,uint256 ethAmount,uint256 cfiAmount,uint256 price18,uint256 publishTime);
    event Unstaked(address indexed account,uint256 cfiAmount,uint256 ethAmount);
    modifier lock(){require(entered==0,"REENTRANCY");entered=1;_;entered=0;}
    constructor(address signer){require(signer!=address(0),"SIGNER");quoteSigner=signer;}
    function allowance(address,address) external pure returns(uint256){return 0;}
    function approve(address,uint256) external pure returns(bool){revert("ACCOUNT_BOUND_RECEIPT");}
    function transfer(address,uint256) external pure returns(bool){revert("ACCOUNT_BOUND_RECEIPT");}
    function transferFrom(address,address,uint256) external pure returns(bool){revert("ACCOUNT_BOUND_RECEIPT");}
    function quoteDigest(address account,uint256 amount,uint256 price18,uint256 issuedAt,uint256 deadline,uint256 nonce) public view returns(bytes32){
        bytes32 domain=keccak256(abi.encode(DOMAIN_TYPEHASH,keccak256("Custos CFI Binance"),keccak256("1"),block.chainid,address(this)));
        bytes32 quote=keccak256(abi.encode(QUOTE_TYPEHASH,account,amount,price18,issuedAt,deadline,nonce));
        return keccak256(abi.encodePacked("\x19\x01",domain,quote));
    }
    function stake(uint256 amount,uint256 minCFI,uint256 price18,uint256 issuedAt,uint256 deadline,uint256 nonce,bytes calldata signature) external payable lock returns(uint256 minted){
        require(amount>0&&amount<=1e24&&msg.value==amount,"AMOUNT_VALUE");
        require(price18>0&&price18<=1e26,"PRICE");
        require(issuedAt<=block.timestamp+5&&issuedAt+60>=block.timestamp&&deadline>=block.timestamp&&deadline>=issuedAt&&deadline<=issuedAt+60,"QUOTE_EXPIRED");
        require(nonce==nonces[msg.sender],"QUOTE_USED");
        require(signature.length==65,"SIGNATURE");bytes32 r;bytes32 s;uint8 v;
        assembly {r:=calldataload(signature.offset) s:=calldataload(add(signature.offset,32)) v:=byte(0,calldataload(add(signature.offset,64)))}
        require(uint256(s)<=0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0&&(v==27||v==28),"SIGNATURE");
        require(ecrecover(quoteDigest(msg.sender,amount,price18,issuedAt,deadline,nonce),v,r,s)==quoteSigner,"SIGNER");
        minted=amount*price18/1e18;require(minted>0&&minted>=minCFI,"SLIPPAGE");
        nonces[msg.sender]=nonce+1;balanceOf[msg.sender]+=minted;totalSupply+=minted;principalOf[msg.sender]+=amount;totalPrincipal+=amount;
        emit Transfer(address(0),msg.sender,minted);emit Staked(msg.sender,amount,minted,price18,issuedAt);
    }
    function previewUnstake(address account,uint256 cfi) public view returns(uint256){
        uint256 balance=balanceOf[account];require(cfi>0&&cfi<=balance,"BALANCE");
        return cfi==balance?principalOf[account]:principalOf[account]*cfi/balance;
    }
    function unstake(uint256 cfi,uint256 minETH) external lock returns(uint256 amount){
        amount=previewUnstake(msg.sender,cfi);require(amount>0&&amount>=minETH,"SLIPPAGE");
        balanceOf[msg.sender]-=cfi;totalSupply-=cfi;principalOf[msg.sender]-=amount;totalPrincipal-=amount;
        emit Transfer(address(msg.sender),address(0),cfi);emit Unstaked(msg.sender,cfi,amount);
        (bool ok,)=payable(msg.sender).call{value:amount}("");require(ok,"ETH_TRANSFER");
    }
}
