// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IPythMinimal.sol";
import "./interfaces/IOracleRouter.sol";

/// @notice Thin Pyth Core pull-oracle adapter.
/// @dev PYTH address is owner-upgradeable because Pyth contract addresses can migrate.
contract PythOracleRouter is Ownable, IOracleRouter {
    struct FallbackPrice {
        uint256 price18;
        uint256 conf18;
        uint256 publishTime;
    }

    address public pyth;
    mapping(bytes32 => FallbackPrice) public fallbackPrices;

    error InvalidPyth();
    error InvalidFallbackPrice();
    error InsufficientOracleFee(uint256 required, uint256 supplied);
    error InvalidPrice();
    error UnsupportedExponent(int32 expo);
    error RefundFailed();

    event PythAddressUpdated(address indexed previousPyth, address indexed newPyth);
    event FallbackPriceUpdated(
        bytes32 indexed feedId,
        uint256 price18,
        uint256 conf18,
        uint256 publishTime
    );
    event FallbackPriceCleared(bytes32 indexed feedId);

    constructor(address initialPyth, address initialOwner) Ownable(initialOwner) {
        if (initialPyth == address(0)) revert InvalidPyth();
        pyth = initialPyth;
    }

    function setPyth(address newPyth) external onlyOwner {
        if (newPyth == address(0)) revert InvalidPyth();
        address previous = pyth;
        pyth = newPyth;
        emit PythAddressUpdated(previous, newPyth);
    }

    /// @notice Configure a testnet-only price for feeds the active Pyth
    /// entitlement cannot serve (for example gated equity feeds).
    /// @dev Pyth remains the first source whenever a fresh Pyth price exists.
    ///      A fallback has no expiry because it is an explicit owner-managed
    ///      testnet reference; callers should surface the fallback mode.
    function setFallbackPrice(
        bytes32 feedId,
        uint256 price18,
        uint256 conf18
    ) external onlyOwner {
        if (feedId == bytes32(0) || price18 == 0) {
            revert InvalidFallbackPrice();
        }

        uint256 publishTime = block.timestamp;
        fallbackPrices[feedId] = FallbackPrice({
            price18: price18,
            conf18: conf18,
            publishTime: publishTime
        });

        emit FallbackPriceUpdated(feedId, price18, conf18, publishTime);
    }

    function clearFallbackPrice(bytes32 feedId) external onlyOwner {
        delete fallbackPrices[feedId];
        emit FallbackPriceCleared(feedId);
    }

    function getUpdateFee(bytes[] calldata updateData) public view returns (uint256) {
        if (updateData.length == 0) return 0;
        return IPythMinimal(pyth).getUpdateFee(updateData);
    }

    function updatePriceFeeds(bytes[] calldata updateData)
        external
        payable
        returns (uint256 feePaid)
    {
        if (updateData.length == 0) {
            return 0;
        }

        feePaid = IPythMinimal(pyth).getUpdateFee(updateData);
        if (msg.value < feePaid) {
            revert InsufficientOracleFee(feePaid, msg.value);
        }

        IPythMinimal(pyth).updatePriceFeeds{value: feePaid}(updateData);

        uint256 refund = msg.value - feePaid;
        if (refund > 0) {
            (bool ok, ) = payable(msg.sender).call{value: refund}("");
            if (!ok) revert RefundFailed();
        }
    }

    function getPrice18(bytes32 feedId, uint256 maxAge)
        external
        view
        returns (uint256 price18, uint256 conf18, uint256 publishTime)
    {
        try IPythMinimal(pyth).getPriceNoOlderThan(feedId, maxAge) returns (
            IPythMinimal.Price memory p
        ) {
            if (p.price > 0) {
                price18 = _scaleTo18(uint256(uint64(p.price)), p.expo);
                conf18 = _scaleTo18(uint256(p.conf), p.expo);
                publishTime = p.publishTime;

                if (price18 > 0) return (price18, conf18, publishTime);
            }
        } catch {
            // Use the explicitly configured testnet fallback below.
        }

        FallbackPrice memory fallbackPrice = fallbackPrices[feedId];
        if (fallbackPrice.price18 == 0) revert InvalidPrice();
        return (
            fallbackPrice.price18,
            fallbackPrice.conf18,
            fallbackPrice.publishTime
        );
    }

    function _scaleTo18(uint256 value, int32 expo) internal pure returns (uint256) {
        int256 target = int256(18) + int256(expo);

        // Real Pyth feeds generally use negative exponents such as -8.
        // Bounds protect exponentiation from absurd values.
        if (target > 36 || target < -36) {
            revert UnsupportedExponent(expo);
        }

        if (target >= 0) {
            return value * (10 ** uint256(target));
        }

        return value / (10 ** uint256(-target));
    }
}
