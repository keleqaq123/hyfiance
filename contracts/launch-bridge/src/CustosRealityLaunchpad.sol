// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Fixed supply ERC-20. No privileged mint, blacklist or transfer tax.
contract RealityToken {
    string public name; string public symbol;
    uint8 public constant decimals=18; uint256 public immutable totalSupply;
    mapping(address=>uint256) public balanceOf;
    mapping(address=>mapping(address=>uint256)) public allowance;
    event Transfer(address indexed from,address indexed to,uint256 value);
    event Approval(address indexed owner,address indexed spender,uint256 value);
    constructor(string memory n,string memory s,uint256 supply){name=n;symbol=s;totalSupply=supply;balanceOf[msg.sender]=supply;emit Transfer(address(0),msg.sender,supply);}
    function transfer(address to,uint256 amount) external returns(bool){_transfer(msg.sender,to,amount);return true;}
    function approve(address spender,uint256 amount) external returns(bool){allowance[msg.sender][spender]=amount;emit Approval(msg.sender,spender,amount);return true;}
    function transferFrom(address from,address to,uint256 amount) external returns(bool){uint256 a=allowance[from][msg.sender];require(a>=amount,"ALLOWANCE");if(a!=type(uint256).max)allowance[from][msg.sender]=a-amount;_transfer(from,to,amount);return true;}
    function _transfer(address from,address to,uint256 amount) internal {require(to!=address(0),"RECIPIENT");balanceOf[from]-=amount;balanceOf[to]+=amount;emit Transfer(from,to,amount);}
}

/// @notice Permissionless testnet curve. Certification is a separate reviewed
/// metadata claim. There is no admin proceeds withdrawal or fake graduation.
/// Native reserves are isolated per launch; users can buy and sell at any time.
contract CustosRealityLaunchpad {
    struct Launch{address creator;address token;string name;string symbol;string metadataURI;uint256 totalSupply;uint256 tokenReserve;uint256 quoteReserve;uint256 raised;uint64 startAt;uint64 endAt;bool curated;bool finalized;}
    mapping(uint256=>Launch) private launches;uint256 public launchCount;
    uint256 private entered;
    event LaunchCreated(uint256 indexed launchId,address indexed creator,address indexed token,bool curated,string metadataURI);
    event TokensPurchased(uint256 indexed launchId,address indexed buyer,uint256 quoteIn,uint256 tokensOut,uint256 quoteReserve,uint256 tokenReserve);
    event TokensSold(uint256 indexed launchId,address indexed seller,uint256 tokensIn,uint256 quoteOut,uint256 quoteReserve,uint256 tokenReserve);
    modifier lock(){require(entered==0,"REENTRANT");entered=1;_;entered=0;}
    function createLaunch(string calldata n,string calldata s,string calldata uri,uint256 supply,uint256 virtualReserve,uint64 start,uint64 end) external lock returns(uint256 id,address token){
        require(bytes(n).length>0&&bytes(n).length<=240&&bytes(s).length>=2&&bytes(s).length<=12,"NAME");
        require(bytes(uri).length<=600&&supply>=1e18&&supply<=1e30,"SUPPLY_OR_URI");
        require(virtualReserve>=1e12&&virtualReserve<=1e24,"RESERVE");
        require(start==0&&end==0,"PERMANENT_MARKET");
        id=++launchCount;token=address(new RealityToken(n,s,supply));
        launches[id]=Launch(msg.sender,token,n,s,uri,supply,supply,virtualReserve,0,uint64(block.timestamp),type(uint64).max,false,false);
        emit LaunchCreated(id,msg.sender,token,false,uri);
    }
    function getLaunch(uint256 id) external view returns(Launch memory){require(launches[id].creator!=address(0),"NOT_FOUND");return launches[id];}
    function quoteFor(uint256 id,uint256 amount) public view returns(uint256){Launch storage l=launches[id];require(l.creator!=address(0)&&amount>0,"INVALID");return amount*l.tokenReserve/(l.quoteReserve+amount);}
    function quoteSell(uint256 id,uint256 amount) public view returns(uint256){Launch storage l=launches[id];require(l.creator!=address(0)&&amount>0,"INVALID");return amount*l.quoteReserve/(l.tokenReserve+amount);}
    function buy(uint256 id,uint256 minOut) external payable lock returns(uint256 out){
        Launch storage l=launches[id];out=quoteFor(id,msg.value);require(out>0&&out>=minOut,"SLIPPAGE");
        l.tokenReserve-=out;l.quoteReserve+=msg.value;l.raised+=msg.value;
        require(RealityToken(l.token).transfer(msg.sender,out),"TRANSFER");
        emit TokensPurchased(id,msg.sender,msg.value,out,l.quoteReserve,l.tokenReserve);
    }
    function sell(uint256 id,uint256 amount,uint256 minOut,uint256 deadline) external lock returns(uint256 out){
        require(block.timestamp<=deadline,"EXPIRED");Launch storage l=launches[id];out=quoteSell(id,amount);
        require(out>0&&out>=minOut&&out<=l.raised,"SLIPPAGE_OR_RESERVE");
        l.tokenReserve+=amount;l.quoteReserve-=out;l.raised-=out;
        require(RealityToken(l.token).transferFrom(msg.sender,address(this),amount),"TRANSFER");
        (bool ok,)=payable(msg.sender).call{value:out}("");require(ok,"SEND");
        emit TokensSold(id,msg.sender,amount,out,l.quoteReserve,l.tokenReserve);
    }
}
