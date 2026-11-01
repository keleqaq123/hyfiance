// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./MarketRegistry.sol";
import "./MarginVault.sol";
import "./interfaces/IOracleRouter.sol";

/// @notice Custos testnet isolated-margin perpetual engine with multiple independent positions.
/// @dev Each position has its own positionId, margin, direction, entry price and TP/SL.
contract GiwaPerpEngineV12 is Ownable, Pausable, ReentrancyGuard {
    uint256 public constant BPS = 10_000;
    uint256 public constant MIN_MARGIN = 10 * 1e6;
    uint256 public constant MAX_POSITIONS_PER_MARKET = 20;
    uint256 public constant LIQUIDATION_PENALTY_BPS = 500;
    uint256 public constant LIQUIDATOR_SHARE_BPS = 5_000;

    struct Position {
        address trader;
        bytes32 marketId;
        uint128 sizeUsd;
        uint128 margin;
        uint128 entryPrice;
        bool isLong;
        uint64 openedAt;
    }

    struct TriggerOrder {
        uint128 takeProfitPrice;
        uint128 stopLossPrice;
    }

    MarketRegistry public immutable registry;
    MarginVault public immutable vault;
    IOracleRouter public oracle;

    uint256 public nextPositionId = 1;

    mapping(uint256 => Position) public positions;
    mapping(uint256 => TriggerOrder) public triggerOrders;
    mapping(address => mapping(bytes32 => uint256[])) private _activePositionIds;
    mapping(uint256 => uint256) private _activeIndexPlusOne;

    mapping(bytes32 => uint256) public longOpenInterestUsd;
    mapping(bytes32 => uint256) public shortOpenInterestUsd;

    error NoPosition();
    error NotPositionOwner();
    error MarketNotOpen();
    error InvalidLeverage();
    error OpenInterestLimit();
    error TooManyPositions();
    error ConfidenceTooWide();
    error NotLiquidatable();
    error SelfLiquidation();
    error OracleFeeTooLow();
    error RefundFailed();
    error InvalidTriggerPrices();
    error TriggerNotHit();

    event OracleUpdated(address indexed previousOracle, address indexed newOracle);

    event PositionOpened(
        uint256 indexed positionId,
        address indexed trader,
        bytes32 indexed marketId,
        bool isLong,
        uint256 margin,
        uint256 sizeUsd,
        uint256 entryPrice,
        uint256 leverageBps
    );

    event PositionClosed(
        uint256 indexed positionId,
        address indexed trader,
        bytes32 indexed marketId,
        uint256 exitPrice,
        int256 pnlCollateral
    );

    event PositionLiquidated(
        uint256 indexed positionId,
        address indexed trader,
        address indexed liquidator,
        bytes32 marketId,
        uint256 markPrice,
        int256 pnlCollateral
    );

    event TriggerPricesUpdated(
        uint256 indexed positionId,
        address indexed trader,
        uint256 takeProfitPrice,
        uint256 stopLossPrice
    );

    event TriggerPositionClosed(
        uint256 indexed positionId,
        address indexed trader,
        address indexed executor,
        bytes32 marketId,
        uint256 exitPrice,
        bool takeProfitHit,
        bool stopLossHit,
        int256 pnlCollateral
    );

    constructor(
        address vaultAddress,
        address registryAddress,
        address oracleAddress,
        address initialOwner
    ) Ownable(initialOwner) {
        require(vaultAddress != address(0), "ZERO_VAULT");
        require(registryAddress != address(0), "ZERO_REGISTRY");
        require(oracleAddress != address(0), "ZERO_ORACLE");

        vault = MarginVault(vaultAddress);
        registry = MarketRegistry(registryAddress);
        oracle = IOracleRouter(oracleAddress);
    }

    function setOracle(address newOracle) external onlyOwner {
        require(newOracle != address(0), "ZERO_ORACLE");
        address previous = address(oracle);
        oracle = IOracleRouter(newOracle);
        emit OracleUpdated(previous, newOracle);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function getActivePositionIds(address trader, bytes32 marketId)
        external
        view
        returns (uint256[] memory)
    {
        return _activePositionIds[trader][marketId];
    }

    function activePositionCount(address trader, bytes32 marketId)
        external
        view
        returns (uint256)
    {
        return _activePositionIds[trader][marketId].length;
    }

    function openPosition(
        bytes32 marketId,
        bool isLong,
        uint256 marginAmount,
        uint256 leverageBps,
        bytes[] calldata updateData
    ) external payable nonReentrant whenNotPaused returns (uint256 positionId) {
        positionId = _openPosition(
            msg.sender,
            marketId,
            isLong,
            marginAmount,
            leverageBps,
            0,
            0,
            updateData
        );
    }

    function openPositionWithTriggers(
        bytes32 marketId,
        bool isLong,
        uint256 marginAmount,
        uint256 leverageBps,
        uint256 takeProfitPrice,
        uint256 stopLossPrice,
        bytes[] calldata updateData
    ) external payable nonReentrant whenNotPaused returns (uint256 positionId) {
        positionId = _openPosition(
            msg.sender,
            marketId,
            isLong,
            marginAmount,
            leverageBps,
            takeProfitPrice,
            stopLossPrice,
            updateData
        );
    }

    function setTriggerPrices(
        uint256 positionId,
        uint256 takeProfitPrice,
        uint256 stopLossPrice
    ) external whenNotPaused {
        Position memory p = _ownedPosition(positionId, msg.sender);
        _setTriggerPrices(positionId, p, takeProfitPrice, stopLossPrice);
    }

    function clearTriggerPrices(uint256 positionId) external {
        Position memory p = _ownedPosition(positionId, msg.sender);
        delete triggerOrders[positionId];
        emit TriggerPricesUpdated(positionId, p.trader, 0, 0);
    }

    function executeTriggerPosition(
        uint256 positionId,
        bytes[] calldata updateData
    ) external payable nonReentrant whenNotPaused {
        Position memory p = _position(positionId);
        TriggerOrder memory order = triggerOrders[positionId];

        if (order.takeProfitPrice == 0 && order.stopLossPrice == 0) {
            revert TriggerNotHit();
        }

        MarketRegistry.MarketConfig memory m = registry.getMarket(p.marketId);
        (uint256 price18, uint256 feePaid) = _updateAndRead(m, updateData);

        bool takeProfitHit = order.takeProfitPrice != 0 && (
            p.isLong
                ? price18 >= uint256(order.takeProfitPrice)
                : price18 <= uint256(order.takeProfitPrice)
        );

        bool stopLossHit = order.stopLossPrice != 0 && (
            p.isLong
                ? price18 <= uint256(order.stopLossPrice)
                : price18 >= uint256(order.stopLossPrice)
        );

        if (!takeProfitHit && !stopLossHit) revert TriggerNotHit();

        int256 pnl = _pnlCollateral(p, price18);

        _decreaseOi(p.marketId, p);
        _removePosition(positionId, p);

        vault.engineSettleClose(p.trader, uint256(p.margin), pnl);
        _refund(msg.value - feePaid);

        emit TriggerPositionClosed(
            positionId,
            p.trader,
            msg.sender,
            p.marketId,
            price18,
            takeProfitHit,
            stopLossHit,
            pnl
        );

        emit PositionClosed(positionId, p.trader, p.marketId, price18, pnl);
    }

    function closePosition(
        uint256 positionId,
        bytes[] calldata updateData
    ) external payable nonReentrant {
        Position memory p = _ownedPosition(positionId, msg.sender);

        MarketRegistry.MarketConfig memory m = registry.getMarket(p.marketId);
        (uint256 price18, uint256 feePaid) = _updateAndRead(m, updateData);

        int256 pnl = _pnlCollateral(p, price18);

        _decreaseOi(p.marketId, p);
        _removePosition(positionId, p);

        vault.engineSettleClose(msg.sender, uint256(p.margin), pnl);
        _refund(msg.value - feePaid);

        emit PositionClosed(positionId, msg.sender, p.marketId, price18, pnl);
    }

    function liquidate(
        uint256 positionId,
        bytes[] calldata updateData
    ) external payable nonReentrant {
        Position memory p = _position(positionId);
        if (p.trader == msg.sender) revert SelfLiquidation();

        MarketRegistry.MarketConfig memory m = registry.getMarket(p.marketId);
        (uint256 price18, uint256 feePaid) = _updateAndRead(m, updateData);

        int256 pnl = _pnlCollateral(p, price18);
        if (!_isLiquidatable(p, m, pnl)) revert NotLiquidatable();

        _decreaseOi(p.marketId, p);
        _removePosition(positionId, p);

        vault.engineSettleLiquidation(
            p.trader,
            msg.sender,
            uint256(p.margin),
            pnl,
            LIQUIDATION_PENALTY_BPS,
            LIQUIDATOR_SHARE_BPS
        );

        _refund(msg.value - feePaid);

        emit PositionLiquidated(
            positionId,
            p.trader,
            msg.sender,
            p.marketId,
            price18,
            pnl
        );
    }

    function getPositionState(uint256 positionId)
        external
        view
        returns (
            Position memory position,
            uint256 markPrice,
            int256 pnlCollateral,
            int256 equityCollateral,
            uint256 maintenanceMarginCollateral,
            bool liquidatable
        )
    {
        position = _position(positionId);

        MarketRegistry.MarketConfig memory m =
            registry.getMarket(position.marketId);

        uint256 conf18;
        (markPrice, conf18, ) =
            oracle.getPrice18(m.feedId, m.maxPriceAge);

        _validateConfidence(markPrice, conf18, m.maxConfidenceBps);

        pnlCollateral = _pnlCollateral(position, markPrice);
        equityCollateral = int256(uint256(position.margin)) + pnlCollateral;
        maintenanceMarginCollateral =
            ((uint256(position.sizeUsd) * m.maintenanceMarginBps) / BPS)
            / vault.collateralTo18Scale();

        liquidatable =
            equityCollateral <= int256(maintenanceMarginCollateral);
    }

    function getLiquidationPrice(uint256 positionId)
        external
        view
        returns (uint256 price18)
    {
        Position memory p = _position(positionId);
        MarketRegistry.MarketConfig memory m = registry.getMarket(p.marketId);

        uint256 marginUsd18 =
            uint256(p.margin) * vault.collateralTo18Scale();

        uint256 maintenanceUsd18 =
            (uint256(p.sizeUsd) * m.maintenanceMarginBps) / BPS;

        if (marginUsd18 <= maintenanceUsd18) {
            return uint256(p.entryPrice);
        }

        uint256 lossBuffer = marginUsd18 - maintenanceUsd18;

        if (p.isLong) {
            if (lossBuffer >= uint256(p.sizeUsd)) return 0;
            return
                (uint256(p.entryPrice) *
                    (uint256(p.sizeUsd) - lossBuffer))
                / uint256(p.sizeUsd);
        }

        return
            (uint256(p.entryPrice) *
                (uint256(p.sizeUsd) + lossBuffer))
            / uint256(p.sizeUsd);
    }

    function _openPosition(
        address trader,
        bytes32 marketId,
        bool isLong,
        uint256 marginAmount,
        uint256 leverageBps,
        uint256 takeProfitPrice,
        uint256 stopLossPrice,
        bytes[] calldata updateData
    ) internal returns (uint256 positionId) {
        uint256[] storage ids = _activePositionIds[trader][marketId];
        if (ids.length >= MAX_POSITIONS_PER_MARKET) {
            revert TooManyPositions();
        }

        MarketRegistry.MarketConfig memory m = registry.getMarket(marketId);
        if (!m.active || m.reduceOnly) revert MarketNotOpen();

        if (leverageBps < BPS || leverageBps > m.maxLeverageBps) {
            revert InvalidLeverage();
        }

        require(marginAmount >= MIN_MARGIN, "MARGIN_TOO_SMALL");

        (uint256 price18, uint256 feePaid) =
            _updateAndRead(m, updateData);

        uint256 margin18 =
            marginAmount * vault.collateralTo18Scale();

        uint256 sizeUsd =
            (margin18 * leverageBps) / BPS;

        uint256 totalOi =
            longOpenInterestUsd[marketId] +
            shortOpenInterestUsd[marketId] +
            sizeUsd;

        if (totalOi > uint256(m.maxOpenInterestUsd)) {
            revert OpenInterestLimit();
        }

        vault.engineLockMargin(trader, marginAmount);

        positionId = nextPositionId++;
        Position memory next = Position({
            trader: trader,
            marketId: marketId,
            sizeUsd: uint128(sizeUsd),
            margin: uint128(marginAmount),
            entryPrice: uint128(price18),
            isLong: isLong,
            openedAt: uint64(block.timestamp)
        });

        positions[positionId] = next;

        ids.push(positionId);
        _activeIndexPlusOne[positionId] = ids.length;

        if (isLong) {
            longOpenInterestUsd[marketId] += sizeUsd;
        } else {
            shortOpenInterestUsd[marketId] += sizeUsd;
        }

        if (takeProfitPrice != 0 || stopLossPrice != 0) {
            _setTriggerPrices(
                positionId,
                next,
                takeProfitPrice,
                stopLossPrice
            );
        }

        _refund(msg.value - feePaid);

        emit PositionOpened(
            positionId,
            trader,
            marketId,
            isLong,
            marginAmount,
            sizeUsd,
            price18,
            leverageBps
        );
    }

    function _setTriggerPrices(
        uint256 positionId,
        Position memory p,
        uint256 takeProfitPrice,
        uint256 stopLossPrice
    ) internal {
        if (
            takeProfitPrice > type(uint128).max ||
            stopLossPrice > type(uint128).max
        ) {
            revert InvalidTriggerPrices();
        }

        uint256 entry = uint256(p.entryPrice);

        if (p.isLong) {
            if (takeProfitPrice != 0 && takeProfitPrice <= entry) {
                revert InvalidTriggerPrices();
            }
            if (stopLossPrice != 0 && stopLossPrice >= entry) {
                revert InvalidTriggerPrices();
            }
        } else {
            if (takeProfitPrice != 0 && takeProfitPrice >= entry) {
                revert InvalidTriggerPrices();
            }
            if (stopLossPrice != 0 && stopLossPrice <= entry) {
                revert InvalidTriggerPrices();
            }
        }

        triggerOrders[positionId] = TriggerOrder({
            takeProfitPrice: uint128(takeProfitPrice),
            stopLossPrice: uint128(stopLossPrice)
        });

        emit TriggerPricesUpdated(
            positionId,
            p.trader,
            takeProfitPrice,
            stopLossPrice
        );
    }

    function _position(uint256 positionId)
        internal
        view
        returns (Position memory p)
    {
        p = positions[positionId];
        if (p.trader == address(0) || p.sizeUsd == 0) {
            revert NoPosition();
        }
    }

    function _ownedPosition(uint256 positionId, address trader)
        internal
        view
        returns (Position memory p)
    {
        p = _position(positionId);
        if (p.trader != trader) revert NotPositionOwner();
    }

    function _removePosition(
        uint256 positionId,
        Position memory p
    ) internal {
        uint256[] storage ids =
            _activePositionIds[p.trader][p.marketId];

        uint256 indexPlusOne = _activeIndexPlusOne[positionId];
        if (indexPlusOne != 0) {
            uint256 index = indexPlusOne - 1;
            uint256 lastIndex = ids.length - 1;

            if (index != lastIndex) {
                uint256 movedId = ids[lastIndex];
                ids[index] = movedId;
                _activeIndexPlusOne[movedId] = index + 1;
            }

            ids.pop();
            delete _activeIndexPlusOne[positionId];
        }

        delete triggerOrders[positionId];
        delete positions[positionId];
    }

    function _updateAndRead(
        MarketRegistry.MarketConfig memory m,
        bytes[] calldata updateData
    ) internal returns (uint256 price18, uint256 feePaid) {
        feePaid = oracle.getUpdateFee(updateData);
        if (msg.value < feePaid) revert OracleFeeTooLow();

        oracle.updatePriceFeeds{value: feePaid}(updateData);

        uint256 conf18;
        (price18, conf18, ) =
            oracle.getPrice18(m.feedId, m.maxPriceAge);

        _validateConfidence(
            price18,
            conf18,
            m.maxConfidenceBps
        );
    }

    function _validateConfidence(
        uint256 price18,
        uint256 conf18,
        uint256 maxConfidenceBps
    ) internal pure {
        if (conf18 * BPS > price18 * maxConfidenceBps) {
            revert ConfidenceTooWide();
        }
    }

    function _pnlCollateral(
        Position memory p,
        uint256 markPrice18
    ) internal view returns (int256) {
        int256 delta =
            p.isLong
                ? int256(markPrice18) -
                    int256(uint256(p.entryPrice))
                : int256(uint256(p.entryPrice)) -
                    int256(markPrice18);

        int256 pnlUsd18 =
            (int256(uint256(p.sizeUsd)) * delta)
            / int256(uint256(p.entryPrice));

        return
            pnlUsd18 /
            int256(vault.collateralTo18Scale());
    }

    function _isLiquidatable(
        Position memory p,
        MarketRegistry.MarketConfig memory m,
        int256 pnlCollateral
    ) internal view returns (bool) {
        int256 equity =
            int256(uint256(p.margin)) + pnlCollateral;

        uint256 maintenance =
            ((uint256(p.sizeUsd) * m.maintenanceMarginBps) / BPS)
            / vault.collateralTo18Scale();

        return equity <= int256(maintenance);
    }

    function _decreaseOi(
        bytes32 marketId,
        Position memory p
    ) internal {
        if (p.isLong) {
            longOpenInterestUsd[marketId] -= uint256(p.sizeUsd);
        } else {
            shortOpenInterestUsd[marketId] -= uint256(p.sizeUsd);
        }
    }

    function _refund(uint256 amount) internal {
        if (amount == 0) return;

        (bool ok, ) =
            payable(msg.sender).call{value: amount}("");

        if (!ok) revert RefundFailed();
    }
}
