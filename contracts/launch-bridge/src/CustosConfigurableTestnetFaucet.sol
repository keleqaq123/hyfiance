// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Prefunded native ETH faucet for GIWA Sepolia with owner-configurable
/// payout amount, address cooldown and daily budget.
/// @dev Configuration changes require pausing first. The official operator pays gas.
contract CustosConfigurableTestnetFaucet {
    address public immutable owner;
    address public operator;
    uint256 public claimAmount;
    uint256 public claimCooldown;
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
    event ClaimAmountChanged(uint256 previousAmount, uint256 newAmount);
    event ClaimCooldownChanged(uint256 previousCooldown, uint256 newCooldown);
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
        require(amount > 0, "CLAIM_AMOUNT");
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

    function setClaimAmount(uint256 amount) external onlyOwner {
        require(paused, "PAUSE_FIRST");
        require(amount > 0 && amount <= dailyLimit, "CLAIM_AMOUNT");
        uint256 previous = claimAmount;
        claimAmount = amount;
        emit ClaimAmountChanged(previous, amount);
    }

    function setClaimCooldown(uint256 cooldown) external onlyOwner {
        require(paused, "PAUSE_FIRST");
        uint256 previous = claimCooldown;
        claimCooldown = cooldown;
        emit ClaimCooldownChanged(previous, cooldown);
    }

    function setDailyLimit(uint256 limit) external onlyOwner {
        require(paused, "PAUSE_FIRST");
        require(limit >= claimAmount, "DAILY_LIMIT");
        uint256 previous = dailyLimit;
        dailyLimit = limit;
        emit DailyLimitChanged(previous, limit);
    }

    function recoverFunds(address payable recipient, uint256 amount) external onlyOwner nonReentrant {
        require(paused, "PAUSE_FIRST");
        require(recipient != address(0) && amount > 0, "RECOVERY_AMOUNT");
        require(amount <= address(this).balance, "FAUCET_EMPTY");
        (bool sent,) = recipient.call{value: amount}("");
        require(sent, "PAYOUT_FAILED");
        emit FundsRecovered(recipient, amount);
    }
}
