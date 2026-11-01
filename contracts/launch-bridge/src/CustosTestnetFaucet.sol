// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Prefunded native ETH faucet for GIWA Sepolia, never for real assets.
/// @dev The official operator pays gas. Wallet cooldown is not Sybil protection.
contract CustosTestnetFaucet {
    address public immutable owner;
    address public operator;
    uint256 public immutable claimAmount;
    uint256 public immutable claimCooldown;
    uint256 public dailyLimit;
    mapping(uint256 => uint256) public distributedPerDay;
    mapping(address => uint256) public nextClaimAt;
    bool public paused;
    bool private entered;

    event Claimed(address indexed account, uint256 amount, uint256 nextClaimAt);
    event Funded(address indexed account, uint256 amount);
    event PauseChanged(bool paused);
    event FundsRecovered(address indexed recipient, uint256 amount);
    event OperatorChanged(address indexed operator);
    event DailyLimitChanged(uint256 previousLimit, uint256 newLimit);

    modifier onlyOwner() {
        require(msg.sender == owner, "OWNER_ONLY");
        _;
    }

    modifier nonReentrant() {
        require(!entered, "REENTRANCY");
        entered = true;
        _;
        entered = false;
    }

    constructor(address administrator, address sender, uint256 amount, uint256 cooldown, uint256 limit) {
        require(block.chainid == 91342 || block.chainid == 31337, "TESTNET_ONLY");
        require(administrator != address(0) && sender != address(0), "ZERO_OWNER");
        require(amount > 0 && amount <= 0.01 ether, "CLAIM_AMOUNT");
        require(cooldown >= 1 hours && cooldown <= 7 days, "CLAIM_COOLDOWN");
        require(limit >= amount, "DAILY_LIMIT");
        owner = administrator;
        operator = sender;
        claimAmount = amount;
        claimCooldown = cooldown;
        dailyLimit = limit;
    }

    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    function claimFor(address payable recipient) external nonReentrant {
        require(msg.sender == operator, "OPERATOR_ONLY");
        require(recipient != address(0) && recipient != address(this), "INVALID_RECIPIENT");
        require(!paused, "FAUCET_PAUSED");
        require(block.timestamp >= nextClaimAt[recipient], "FAUCET_COOLDOWN");
        require(address(this).balance >= claimAmount, "FAUCET_EMPTY");
        uint256 day = block.timestamp / 1 days;
        require(distributedPerDay[day] + claimAmount <= dailyLimit, "DAILY_LIMIT_REACHED");
        // Consume the cooldown before calling the recipient; a failed payout
        // reverts this write, so smart wallets do not lose their entitlement.
        nextClaimAt[recipient] = block.timestamp + claimCooldown;
        distributedPerDay[day] += claimAmount;
        (bool sent,) = recipient.call{value: claimAmount}("");
        require(sent, "PAYOUT_FAILED");
        emit Claimed(recipient, claimAmount, nextClaimAt[recipient]);
    }

    function setOperator(address sender) external onlyOwner {
        require(sender != address(0), "ZERO_OPERATOR");
        operator = sender;
        emit OperatorChanged(sender);
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit PauseChanged(value);
    }

    /// @notice Updating a budget never resets the amount already paid today.
    function setDailyLimit(uint256 limit) external onlyOwner {
        require(paused, "PAUSE_FIRST");
        require(limit >= claimAmount, "DAILY_LIMIT");
        uint256 previous = dailyLimit;
        dailyLimit = limit;
        emit DailyLimitChanged(previous, limit);
    }

    /// @notice Owner can recover unused test ETH only while claims are paused.
    function recoverFunds(address payable recipient, uint256 amount) external onlyOwner nonReentrant {
        require(paused, "PAUSE_FIRST");
        require(recipient != address(0) && amount > 0, "RECOVERY_AMOUNT");
        require(amount <= address(this).balance, "FAUCET_EMPTY");
        (bool sent,) = recipient.call{value: amount}("");
        require(sent, "PAYOUT_FAILED");
        emit FundsRecovered(recipient, amount);
    }
}
