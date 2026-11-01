// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Testnet synthetic representation of one unit of a real-world reference asset.
/// @dev It is NOT redeemable for the underlying asset. Only its assigned spot pool may mint/burn.
contract SyntheticRwaToken is ERC20, Ownable {
    address public pool;
    string public underlyingSymbol;
    string public unitLabel;

    error NotPool();
    error InvalidPool();
    error PoolAlreadySet();

    event PoolAssigned(address indexed pool);

    constructor(
        string memory name_,
        string memory symbol_,
        string memory underlyingSymbol_,
        string memory unitLabel_,
        address initialOwner
    ) ERC20(name_, symbol_) Ownable(initialOwner) {
        underlyingSymbol = underlyingSymbol_;
        unitLabel = unitLabel_;
    }

    modifier onlyPool() {
        if (msg.sender != pool) revert NotPool();
        _;
    }

    function setPool(address pool_) external onlyOwner {
        if (pool_ == address(0)) revert InvalidPool();
        if (pool != address(0)) revert PoolAlreadySet();
        pool = pool_;
        emit PoolAssigned(pool_);
    }

    function poolMint(address to, uint256 amount) external onlyPool {
        _mint(to, amount);
    }

    function poolBurn(uint256 amount) external onlyPool {
        _burn(msg.sender, amount);
    }
}
