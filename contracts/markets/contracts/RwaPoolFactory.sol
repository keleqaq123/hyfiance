// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RwaAMMPool} from "./RwaAMMPool.sol";

/// @notice Deploys a single RwaAMMPool for each RWA token / quote token pair.
contract RwaPoolFactory {
    mapping(address => mapping(address => address)) public getPool;
    address[] public allPools;

    event PoolCreated(address indexed assetToken, address indexed quoteToken, address pool, uint256 poolCount);

    function createPool(address assetToken, address quoteToken) external returns (address pool) {
        require(assetToken != address(0) && quoteToken != address(0) && assetToken != quoteToken, "invalid tokens");
        require(getPool[assetToken][quoteToken] == address(0), "pool exists");
        pool = address(new RwaAMMPool(assetToken, quoteToken));
        getPool[assetToken][quoteToken] = pool;
        getPool[quoteToken][assetToken] = pool;
        allPools.push(pool);
        emit PoolCreated(assetToken, quoteToken, pool, allPools.length);
    }

    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }
}
