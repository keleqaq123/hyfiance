// SPDX-License-Identifier: MIT
pragma solidity ^0.6.6;
pragma experimental ABIEncoderV2;

interface IERC20LaunchToken {
    function transfer(address to, uint256 amount) external returns (bool);
}

/**
 * A small, permissionless launch token used by the Custos testnet launchpad.
 * The launchpad owns the initial supply until tokens are bought or a launch is
 * finalized. It intentionally has no owner-controlled mint function.
 */
contract CustosLaunchToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory tokenName, string memory tokenSymbol, uint256 supply, address holder) public {
        require(bytes(tokenName).length > 0, "TOKEN_NAME_REQUIRED");
        require(bytes(tokenSymbol).length > 0, "TOKEN_SYMBOL_REQUIRED");
        require(supply > 0, "TOKEN_SUPPLY_REQUIRED");
        name = tokenName;
        symbol = tokenSymbol;
        totalSupply = supply;
        balanceOf[holder] = supply;
        emit Transfer(address(0), holder, supply);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        require(currentAllowance >= amount, "INSUFFICIENT_ALLOWANCE");
        if (currentAllowance != uint256(-1)) {
            allowance[from][msg.sender] = currentAllowance - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "INVALID_RECIPIENT");
        require(balanceOf[from] >= amount, "INSUFFICIENT_BALANCE");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

/**
 * Permissionless fixed-product launchpad.
 *
 * New launches start with virtual quote liquidity. Users buy tokens with the
 * native coin and the curve moves from the virtual reserve plus real proceeds.
 * This mirrors the useful part of popular fair-launch products while keeping
 * the contract intentionally small for testnet use. There is no hidden admin
 * mint and no creator withdrawal before finalization.
 */
contract CustosLaunchpad {
    struct Launch {
        address creator;
        address token;
        string name;
        string symbol;
        string metadataURI;
        uint256 totalSupply;
        uint256 tokenReserve;
        uint256 quoteReserve;
        uint256 raised;
        uint64 startAt;
        uint64 endAt;
        bool curated;
        bool finalized;
    }

    address public admin;
    uint256 public nextLaunchId = 1;
    mapping(uint256 => Launch) private launches;
    mapping(uint256 => mapping(address => bool)) public whitelist;
    mapping(address => uint256) public launchForToken;
    uint256 private entered;

    event LaunchCreated(
        uint256 indexed launchId,
        address indexed creator,
        address indexed token,
        bool curated,
        string metadataURI
    );
    event TokensPurchased(
        uint256 indexed launchId,
        address indexed buyer,
        uint256 quoteIn,
        uint256 tokensOut,
        uint256 quoteReserve,
        uint256 tokenReserve
    );
    event LaunchFinalized(uint256 indexed launchId, address indexed creator, uint256 raised, uint256 unsoldTokens);
    event AdminSet(address indexed admin);
    event WhitelistSet(uint256 indexed launchId, address indexed account, bool allowed);

    modifier nonReentrant() {
        require(entered == 0, "REENTRANT_CALL");
        entered = 1;
        _;
        entered = 0;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "ADMIN_ONLY");
        _;
    }

    constructor(address initialAdmin) public {
        require(initialAdmin != address(0), "INVALID_ADMIN");
        admin = initialAdmin;
    }

    function setAdmin(address nextAdmin) external onlyAdmin {
        require(nextAdmin != address(0), "INVALID_ADMIN");
        admin = nextAdmin;
        emit AdminSet(nextAdmin);
    }

    function createLaunch(
        string calldata tokenName,
        string calldata tokenSymbol,
        string calldata metadataURI,
        uint256 totalSupply,
        uint256 virtualQuoteReserve,
        uint64 startAt,
        uint64 endAt
    ) external returns (uint256 launchId, address token) {
        return _createLaunch(msg.sender, tokenName, tokenSymbol, metadataURI, totalSupply, virtualQuoteReserve, startAt, endAt, false);
    }

    function createCuratedLaunch(
        string calldata tokenName,
        string calldata tokenSymbol,
        string calldata metadataURI,
        uint256 totalSupply,
        uint256 virtualQuoteReserve,
        uint64 startAt,
        uint64 endAt
    ) external onlyAdmin returns (uint256 launchId, address token) {
        return _createLaunch(msg.sender, tokenName, tokenSymbol, metadataURI, totalSupply, virtualQuoteReserve, startAt, endAt, true);
    }

    function _createLaunch(
        address creator,
        string memory tokenName,
        string memory tokenSymbol,
        string memory metadataURI,
        uint256 totalSupply,
        uint256 virtualQuoteReserve,
        uint64 startAt,
        uint64 endAt,
        bool curated
    ) internal returns (uint256 launchId, address token) {
        require(totalSupply > 0, "SUPPLY_REQUIRED");
        require(virtualQuoteReserve > 0, "VIRTUAL_RESERVE_REQUIRED");

        uint64 actualStart = startAt == 0 ? uint64(block.timestamp) : startAt;
        uint64 actualEnd = endAt == 0 ? actualStart + 30 days : endAt;
        require(actualStart >= block.timestamp, "START_IN_PAST");
        require(actualEnd > actualStart, "INVALID_WINDOW");

        launchId = nextLaunchId++;
        token = address(new CustosLaunchToken(tokenName, tokenSymbol, totalSupply, address(this)));
        launches[launchId] = Launch({
            creator: creator,
            token: token,
            name: tokenName,
            symbol: tokenSymbol,
            metadataURI: metadataURI,
            totalSupply: totalSupply,
            tokenReserve: totalSupply,
            quoteReserve: virtualQuoteReserve,
            raised: 0,
            startAt: actualStart,
            endAt: actualEnd,
            curated: curated,
            finalized: false
        });
        launchForToken[token] = launchId;

        _emitLaunchCreated(launchId, creator, token, curated, metadataURI);
    }

    function _emitLaunchCreated(
        uint256 launchId,
        address creator,
        address token,
        bool curated,
        string memory metadataURI
    ) internal {
        emit LaunchCreated(
            launchId,
            creator,
            token,
            curated,
            metadataURI
        );
    }

    function setWhitelist(uint256 launchId, address account, bool allowed) external onlyAdmin {
        require(launches[launchId].creator != address(0), "LAUNCH_NOT_FOUND");
        require(launches[launchId].curated, "NOT_CURATED_LAUNCH");
        whitelist[launchId][account] = allowed;
        emit WhitelistSet(launchId, account, allowed);
    }

    function buy(uint256 launchId, uint256 minTokensOut) external payable nonReentrant returns (uint256 tokensOut) {
        Launch storage launch = launches[launchId];
        require(launch.creator != address(0), "LAUNCH_NOT_FOUND");
        require(!launch.finalized, "LAUNCH_FINALIZED");
        require(block.timestamp >= launch.startAt && block.timestamp <= launch.endAt, "LAUNCH_NOT_LIVE");
        if (launch.curated) require(whitelist[launchId][msg.sender], "NOT_WHITELISTED");
        require(msg.value > 0, "QUOTE_REQUIRED");
        require(launch.tokenReserve > 0, "SOLD_OUT");

        uint256 newQuoteReserve = launch.quoteReserve + msg.value;
        uint256 invariant = launch.tokenReserve * launch.quoteReserve;
        uint256 newTokenReserve = invariant / newQuoteReserve;
        tokensOut = launch.tokenReserve - newTokenReserve;
        require(tokensOut > 0 && tokensOut >= minTokensOut, "SLIPPAGE_OR_SMALL_TRADE");

        launch.quoteReserve = newQuoteReserve;
        launch.tokenReserve = newTokenReserve;
        launch.raised += msg.value;
        require(IERC20LaunchToken(launch.token).transfer(msg.sender, tokensOut), "TOKEN_TRANSFER_FAILED");

        emit TokensPurchased(launchId, msg.sender, msg.value, tokensOut, newQuoteReserve, newTokenReserve);
    }

    function finalize(uint256 launchId) external nonReentrant {
        Launch storage launch = launches[launchId];
        require(launch.creator != address(0), "LAUNCH_NOT_FOUND");
        require(!launch.finalized, "ALREADY_FINALIZED");
        require(msg.sender == launch.creator, "CREATOR_ONLY");
        require(block.timestamp >= launch.endAt || launch.tokenReserve == 0, "LAUNCH_STILL_LIVE");

        launch.finalized = true;
        uint256 unsoldTokens = launch.tokenReserve;
        launch.tokenReserve = 0;
        uint256 proceeds = launch.raised;

        if (unsoldTokens > 0) {
            require(IERC20LaunchToken(launch.token).transfer(launch.creator, unsoldTokens), "UNSOLD_TRANSFER_FAILED");
        }
        if (proceeds > 0) {
            (bool sent, ) = payable(launch.creator).call{value: proceeds}("");
            require(sent, "PROCEEDS_TRANSFER_FAILED");
        }

        emit LaunchFinalized(launchId, launch.creator, proceeds, unsoldTokens);
    }

    function quoteFor(uint256 launchId, uint256 quoteIn) external view returns (uint256 tokensOut) {
        Launch memory launch = launches[launchId];
        require(launch.creator != address(0), "LAUNCH_NOT_FOUND");
        require(quoteIn > 0 && launch.tokenReserve > 0, "INVALID_QUOTE");
        uint256 newQuoteReserve = launch.quoteReserve + quoteIn;
        uint256 invariant = launch.tokenReserve * launch.quoteReserve;
        tokensOut = launch.tokenReserve - (invariant / newQuoteReserve);
    }

    function getLaunch(uint256 launchId) external view returns (Launch memory) {
        require(launches[launchId].creator != address(0), "LAUNCH_NOT_FOUND");
        return launches[launchId];
    }

    function launchCount() external view returns (uint256) {
        return nextLaunchId - 1;
    }
}
