// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RwaAssetToken} from "./RwaAssetToken.sol";
import {RwaVerificationRegistry} from "./RwaVerificationRegistry.sol";

/// @notice Mints one demo ERC-20 market token for each verified registry asset.
contract RwaAssetFactory {
    RwaVerificationRegistry public immutable registry;
    mapping(bytes32 => address) public assetToken;

    event AssetTokenCreated(bytes32 indexed assetId, address indexed issuer, address token, string symbol);

    constructor(address registry_) {
        require(registry_ != address(0), "zero registry");
        registry = RwaVerificationRegistry(registry_);
    }

    function createAssetToken(
        bytes32 assetId,
        string calldata name,
        string calldata symbol,
        uint256 initialSupply
    ) external returns (address token) {
        require(registry.isVerified(assetId), "asset not verified");
        require(assetToken[assetId] == address(0), "token exists");
        require(initialSupply > 0, "zero supply");

        token = address(new RwaAssetToken(name, symbol, assetId, initialSupply, msg.sender));
        assetToken[assetId] = token;
        emit AssetTokenCreated(assetId, msg.sender, token, symbol);
    }
}
