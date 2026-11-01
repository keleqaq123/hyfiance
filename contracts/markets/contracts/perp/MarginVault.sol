// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Custodies tUSDC and tracks available vs isolated-position margin.
/// @dev The engine can only move internal accounting; user withdrawals remain user-initiated.
contract MarginVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20Metadata;

    IERC20Metadata public immutable collateral;
    uint8 public immutable collateralDecimals;
    uint256 public immutable collateralTo18Scale;

    address public engine;

    mapping(address => uint256) public available;
    mapping(address => uint256) public locked;

    uint256 public protocolReserve;
    uint256 public badDebt;

    error OnlyEngine();
    error InsufficientAvailable();
    error InsufficientLocked();
    error InsufficientReserve();
    error InvalidEngine();

    event EngineUpdated(address indexed previousEngine, address indexed newEngine);
    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event MarginLocked(address indexed account, uint256 amount);
    event PositionSettled(address indexed account, uint256 marginReleased, int256 pnl);
    event LiquidationSettled(
        address indexed account,
        address indexed liquidator,
        uint256 marginReleased,
        int256 pnl,
        uint256 liquidatorReward
    );
    event ReserveFunded(address indexed funder, uint256 amount);

    modifier onlyEngine() {
        if (msg.sender != engine) revert OnlyEngine();
        _;
    }

    constructor(address collateralToken, address initialOwner) Ownable(initialOwner) {
        require(collateralToken != address(0), "ZERO_COLLATERAL");
        collateral = IERC20Metadata(collateralToken);
        collateralDecimals = IERC20Metadata(collateralToken).decimals();
        require(collateralDecimals <= 18, "DECIMALS_GT_18");
        collateralTo18Scale = 10 ** (18 - collateralDecimals);
    }

    function setEngine(address newEngine) external onlyOwner {
        if (newEngine == address(0)) revert InvalidEngine();
        address previous = engine;
        engine = newEngine;
        emit EngineUpdated(previous, newEngine);
    }

    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "ZERO_AMOUNT");
        collateral.safeTransferFrom(msg.sender, address(this), amount);
        available[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (available[msg.sender] < amount) revert InsufficientAvailable();
        available[msg.sender] -= amount;
        collateral.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function fundReserve(uint256 amount) external nonReentrant {
        require(amount > 0, "ZERO_AMOUNT");
        collateral.safeTransferFrom(msg.sender, address(this), amount);
        protocolReserve += amount;
        emit ReserveFunded(msg.sender, amount);
    }

    function engineLockMargin(address account, uint256 amount) external onlyEngine {
        if (available[account] < amount) revert InsufficientAvailable();
        available[account] -= amount;
        locked[account] += amount;
        emit MarginLocked(account, amount);
    }

    function engineSettleClose(address account, uint256 marginAmount, int256 pnl)
        external
        onlyEngine
    {
        if (locked[account] < marginAmount) revert InsufficientLocked();
        locked[account] -= marginAmount;

        if (pnl >= 0) {
            uint256 profit = uint256(pnl);
            if (protocolReserve < profit) revert InsufficientReserve();
            protocolReserve -= profit;
            available[account] += marginAmount + profit;
        } else {
            uint256 loss = uint256(-pnl);
            uint256 absorbed = loss > marginAmount ? marginAmount : loss;
            protocolReserve += absorbed;

            if (loss > marginAmount) {
                badDebt += loss - marginAmount;
            } else {
                available[account] += marginAmount - loss;
            }
        }

        emit PositionSettled(account, marginAmount, pnl);
    }

    function engineSettleLiquidation(
        address account,
        address liquidator,
        uint256 marginAmount,
        int256 pnl,
        uint256 liquidationPenaltyBps,
        uint256 liquidatorShareBps
    ) external onlyEngine {
        if (locked[account] < marginAmount) revert InsufficientLocked();
        locked[account] -= marginAmount;

        uint256 loss = pnl < 0 ? uint256(-pnl) : 0;
        uint256 absorbed = loss > marginAmount ? marginAmount : loss;
        uint256 remaining = marginAmount - absorbed;

        protocolReserve += absorbed;

        if (loss > marginAmount) {
            badDebt += loss - marginAmount;
        }

        uint256 penalty = (remaining * liquidationPenaltyBps) / 10_000;
        uint256 reward = (penalty * liquidatorShareBps) / 10_000;
        uint256 traderRefund = remaining - penalty;

        available[account] += traderRefund;
        available[liquidator] += reward;
        protocolReserve += penalty - reward;

        emit LiquidationSettled(account, liquidator, marginAmount, pnl, reward);
    }
}
