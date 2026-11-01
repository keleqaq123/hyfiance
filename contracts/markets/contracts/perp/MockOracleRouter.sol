// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IOracleRouter.sol";

/// @notice Deterministic local oracle used by the market integration tests.
/// @dev It deliberately ignores update payloads. Production/testnet deployments use
///      PythOracleRouter instead; this contract must never be used for real funds.
contract MockOracleRouter is Ownable, IOracleRouter {
    struct PriceData {
        uint256 price18;
        uint256 conf18;
        uint256 publishTime;
    }

    mapping(bytes32 => PriceData) public prices;
    uint256 public updateFee;

    error InvalidPrice();
    error StalePrice();
    error OracleFeeTooLow();
    error RefundFailed();

    event PriceUpdated(bytes32 indexed feedId, uint256 price18, uint256 conf18, uint256 publishTime);
    event UpdateFeeChanged(uint256 fee);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setPrice(
        bytes32 feedId,
        uint256 price18,
        uint256 conf18,
        uint256 publishTime
    ) external onlyOwner {
        if (feedId == bytes32(0) || price18 == 0) revert InvalidPrice();
        uint256 timestamp = publishTime == 0 ? block.timestamp : publishTime;
        prices[feedId] = PriceData(price18, conf18, timestamp);
        emit PriceUpdated(feedId, price18, conf18, timestamp);
    }

    function setUpdateFee(uint256 fee) external onlyOwner {
        updateFee = fee;
        emit UpdateFeeChanged(fee);
    }

    function getUpdateFee(bytes[] calldata) external view override returns (uint256) {
        return updateFee;
    }

    function updatePriceFeeds(bytes[] calldata) external payable override returns (uint256 feePaid) {
        feePaid = updateFee;
        if (msg.value < feePaid) revert OracleFeeTooLow();

        uint256 refund = msg.value - feePaid;
        if (refund > 0) {
            (bool ok, ) = payable(msg.sender).call{value: refund}("");
            if (!ok) revert RefundFailed();
        }
    }

    function getPrice18(bytes32 feedId, uint256 maxAge)
        external
        view
        override
        returns (uint256 price18, uint256 conf18, uint256 publishTime)
    {
        PriceData memory data = prices[feedId];
        if (data.price18 == 0) revert InvalidPrice();
        if (data.publishTime > block.timestamp || data.publishTime + maxAge < block.timestamp) {
            revert StalePrice();
        }
        return (data.price18, data.conf18, data.publishTime);
    }
}
