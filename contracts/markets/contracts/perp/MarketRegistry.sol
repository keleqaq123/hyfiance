// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";

contract MarketRegistry is Ownable {
    struct MarketConfig {
        string symbol;
        bytes32 feedId;
        uint32 maxPriceAge;
        uint32 maxLeverageBps;        // 10000 = 1x
        uint32 maintenanceMarginBps;  // on notional
        uint32 maxConfidenceBps;      // max Pyth conf / price
        uint128 maxOpenInterestUsd;   // 1e18 USD units
        bool active;
        bool reduceOnly;
    }

    mapping(bytes32 => MarketConfig) private _markets;
    mapping(bytes32 => bool) public exists;
    bytes32[] public marketIds;

    event MarketConfigured(
        bytes32 indexed marketId,
        string symbol,
        bytes32 feedId,
        uint32 maxLeverageBps,
        bool active,
        bool reduceOnly
    );

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setMarket(bytes32 marketId, MarketConfig calldata config) external onlyOwner {
        require(marketId != bytes32(0), "ZERO_MARKET");
        require(config.feedId != bytes32(0), "ZERO_FEED");
        require(bytes(config.symbol).length > 0, "EMPTY_SYMBOL");
        require(config.maxPriceAge > 0, "ZERO_MAX_AGE");
        require(config.maxLeverageBps >= 10_000, "LEVERAGE_LT_1X");
        require(config.maintenanceMarginBps > 0, "ZERO_MM");
        require(config.maintenanceMarginBps < 10_000, "MM_TOO_HIGH");
        require(config.maxConfidenceBps > 0, "ZERO_CONF");
        require(config.maxOpenInterestUsd > 0, "ZERO_OI");

        if (!exists[marketId]) {
            exists[marketId] = true;
            marketIds.push(marketId);
        }

        _markets[marketId] = config;

        emit MarketConfigured(
            marketId,
            config.symbol,
            config.feedId,
            config.maxLeverageBps,
            config.active,
            config.reduceOnly
        );
    }

    function setTradingState(bytes32 marketId, bool active, bool reduceOnly) external onlyOwner {
        require(exists[marketId], "UNKNOWN_MARKET");
        _markets[marketId].active = active;
        _markets[marketId].reduceOnly = reduceOnly;

        MarketConfig memory m = _markets[marketId];
        emit MarketConfigured(
            marketId,
            m.symbol,
            m.feedId,
            m.maxLeverageBps,
            active,
            reduceOnly
        );
    }

    function getMarket(bytes32 marketId) external view returns (MarketConfig memory) {
        require(exists[marketId], "UNKNOWN_MARKET");
        return _markets[marketId];
    }

    function marketCount() external view returns (uint256) {
        return marketIds.length;
    }
}
