// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Demo representation of a verified asset. Its token has no legal claim by itself.
contract RwaAssetToken is ERC20, Ownable {
    bytes32 public immutable assetId;

    constructor(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        uint256 initialSupply,
        address issuer
    ) ERC20(name_, symbol_) Ownable(issuer) {
        require(issuer != address(0), "zero issuer");
        assetId = assetId_;
        _mint(issuer, initialSupply);
    }

    function issuerMint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
