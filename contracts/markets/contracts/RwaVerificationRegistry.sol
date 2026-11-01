// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Stores verifiable demo RWA metadata. This is not a legal registry of ownership.
contract RwaVerificationRegistry is Ownable {
    enum AssetStatus {
        None,
        Submitted,
        Verified,
        Paused,
        Matured
    }

    struct AssetRecord {
        bytes32 documentHash;
        address issuer;
        address verifier;
        uint64 maturityDate;
        uint8 riskScore;
        AssetStatus status;
        string metadataURI;
    }

    mapping(bytes32 => AssetRecord) private assets;
    mapping(address => bool) public verifiers;

    event VerifierUpdated(address indexed account, bool enabled);
    event AssetRegistered(bytes32 indexed assetId, address indexed issuer, bytes32 documentHash, string metadataURI);
    event AssetStatusUpdated(bytes32 indexed assetId, AssetStatus status, address indexed verifier);

    modifier onlyVerifier() {
        require(verifiers[msg.sender] || msg.sender == owner(), "not verifier");
        _;
    }

    constructor() Ownable(msg.sender) {
        verifiers[msg.sender] = true;
    }

    function setVerifier(address account, bool enabled) external onlyOwner {
        require(account != address(0), "zero verifier");
        verifiers[account] = enabled;
        emit VerifierUpdated(account, enabled);
    }

    function registerAsset(
        bytes32 assetId,
        bytes32 documentHash,
        string calldata metadataURI,
        uint64 maturityDate,
        uint8 riskScore
    ) external {
        require(assetId != bytes32(0) && documentHash != bytes32(0), "invalid proof");
        require(assets[assetId].issuer == address(0), "asset exists");
        require(riskScore <= 99, "risk > 99");

        assets[assetId] = AssetRecord({
            documentHash: documentHash,
            issuer: msg.sender,
            verifier: address(0),
            maturityDate: maturityDate,
            riskScore: riskScore,
            status: AssetStatus.Submitted,
            metadataURI: metadataURI
        });
        emit AssetRegistered(assetId, msg.sender, documentHash, metadataURI);
    }

    function setAssetStatus(bytes32 assetId, AssetStatus status) external onlyVerifier {
        AssetRecord storage asset = assets[assetId];
        require(asset.issuer != address(0), "unknown asset");
        require(status != AssetStatus.None && status != AssetStatus.Submitted, "invalid status");
        asset.status = status;
        asset.verifier = msg.sender;
        emit AssetStatusUpdated(assetId, status, msg.sender);
    }

    function isVerified(bytes32 assetId) external view returns (bool) {
        return assets[assetId].status == AssetStatus.Verified;
    }

    function getAsset(bytes32 assetId) external view returns (AssetRecord memory) {
        require(assets[assetId].issuer != address(0), "unknown asset");
        return assets[assetId];
    }
}
