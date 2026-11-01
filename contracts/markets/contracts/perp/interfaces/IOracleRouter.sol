// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IOracleRouter {
    function getUpdateFee(bytes[] calldata updateData) external view returns (uint256);

    function updatePriceFeeds(bytes[] calldata updateData) external payable returns (uint256 feePaid);

    function getPrice18(bytes32 feedId, uint256 maxAge)
        external
        view
        returns (uint256 price18, uint256 conf18, uint256 publishTime);
}
