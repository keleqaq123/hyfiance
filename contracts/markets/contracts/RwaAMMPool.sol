// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Constant-product AMM for one RWA demo token / externally issued ERC-20 quote token pair.
contract RwaAMMPool is ERC20 {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_BPS = 30;
    uint256 public constant BPS = 10_000;

    address public immutable assetToken;
    address public immutable quoteToken;
    uint8 public immutable assetDecimals;
    uint8 public immutable quoteDecimals;
    uint256 private immutable assetScaleTo18;
    uint256 private immutable quoteScaleTo18;
    uint112 private reserveAsset;
    uint112 private reserveQuote;

    event LiquidityAdded(address indexed provider, uint256 assetAmount, uint256 quoteAmount, uint256 liquidity);
    event LiquidityRemoved(address indexed provider, uint256 assetAmount, uint256 quoteAmount, uint256 liquidity);
    event Swap(address indexed sender, address indexed tokenIn, uint256 amountIn, uint256 amountOut, address indexed to);

    constructor(address assetToken_, address quoteToken_) ERC20("GIWA RWA LP", "gRWA-LP") {
        require(assetToken_ != address(0) && quoteToken_ != address(0) && assetToken_ != quoteToken_, "invalid tokens");
        assetToken = assetToken_;
        quoteToken = quoteToken_;
        assetDecimals = IERC20Metadata(assetToken_).decimals();
        quoteDecimals = IERC20Metadata(quoteToken_).decimals();
        require(assetDecimals <= 18 && quoteDecimals <= 18, "decimals > 18");
        assetScaleTo18 = 10 ** (18 - assetDecimals);
        quoteScaleTo18 = 10 ** (18 - quoteDecimals);
    }

    function getReserves() public view returns (uint112 assetReserve, uint112 quoteReserve) {
        return (reserveAsset, reserveQuote);
    }

    function getAmountOut(address tokenIn, uint256 amountIn) public view returns (uint256 amountOut) {
        require(amountIn > 0, "zero input");
        bool isAssetIn = tokenIn == assetToken;
        require(isAssetIn || tokenIn == quoteToken, "invalid token");
        (uint256 reserveIn, uint256 reserveOut, uint256 inputScale, uint256 outputScale) = isAssetIn
            ? (uint256(reserveAsset) * assetScaleTo18, uint256(reserveQuote) * quoteScaleTo18, assetScaleTo18, quoteScaleTo18)
            : (uint256(reserveQuote) * quoteScaleTo18, uint256(reserveAsset) * assetScaleTo18, quoteScaleTo18, assetScaleTo18);
        require(reserveIn > 0 && reserveOut > 0, "empty pool");
        uint256 amountIn18 = amountIn * inputScale;
        uint256 amountInWithFee = amountIn18 * (BPS - FEE_BPS);
        uint256 amountOut18 = (amountInWithFee * reserveOut) / (reserveIn * BPS + amountInWithFee);
        amountOut = amountOut18 / outputScale;
    }

    function addLiquidity(
        uint256 assetDesired,
        uint256 quoteDesired,
        uint256 assetMin,
        uint256 quoteMin,
        address to
    ) external returns (uint256 assetAmount, uint256 quoteAmount, uint256 liquidity) {
        require(to != address(0), "zero recipient");
        if (totalSupply() == 0) {
            assetAmount = assetDesired;
            quoteAmount = quoteDesired;
        } else {
            uint256 assetDesired18 = assetDesired * assetScaleTo18;
            uint256 quoteDesired18 = quoteDesired * quoteScaleTo18;
            uint256 reserveAsset18 = uint256(reserveAsset) * assetScaleTo18;
            uint256 reserveQuote18 = uint256(reserveQuote) * quoteScaleTo18;
            uint256 quoteOptimal18 = (assetDesired18 * reserveQuote18) / reserveAsset18;
            uint256 quoteOptimal = quoteOptimal18 / quoteScaleTo18;
            if (quoteOptimal <= quoteDesired) {
                require(quoteOptimal >= quoteMin, "quote slippage");
                assetAmount = assetDesired;
                quoteAmount = quoteOptimal;
            } else {
                uint256 assetOptimal = ((quoteDesired18 * reserveAsset18) / reserveQuote18) / assetScaleTo18;
                require(assetOptimal >= assetMin, "asset slippage");
                assetAmount = assetOptimal;
                quoteAmount = quoteDesired;
            }
        }
        require(assetAmount >= assetMin && quoteAmount >= quoteMin, "slippage");
        require(assetAmount > 0 && quoteAmount > 0, "zero liquidity");

        IERC20(assetToken).safeTransferFrom(msg.sender, address(this), assetAmount);
        IERC20(quoteToken).safeTransferFrom(msg.sender, address(this), quoteAmount);

        uint256 supply = totalSupply();
        uint256 assetAmount18 = assetAmount * assetScaleTo18;
        uint256 quoteAmount18 = quoteAmount * quoteScaleTo18;
        liquidity = supply == 0
            ? Math.sqrt(assetAmount18 * quoteAmount18)
            : Math.min(
                (assetAmount18 * supply) / (uint256(reserveAsset) * assetScaleTo18),
                (quoteAmount18 * supply) / (uint256(reserveQuote) * quoteScaleTo18)
            );
        require(liquidity > 0, "zero LP");
        _mint(to, liquidity);
        _updateReserves();
        emit LiquidityAdded(msg.sender, assetAmount, quoteAmount, liquidity);
    }

    function removeLiquidity(
        uint256 liquidity,
        uint256 assetMin,
        uint256 quoteMin,
        address to
    ) external returns (uint256 assetAmount, uint256 quoteAmount) {
        require(to != address(0) && liquidity > 0, "invalid request");
        uint256 supply = totalSupply();
        assetAmount = (liquidity * reserveAsset) / supply;
        quoteAmount = (liquidity * reserveQuote) / supply;
        require(assetAmount >= assetMin && quoteAmount >= quoteMin, "slippage");

        _burn(msg.sender, liquidity);
        IERC20(assetToken).safeTransfer(to, assetAmount);
        IERC20(quoteToken).safeTransfer(to, quoteAmount);
        _updateReserves();
        emit LiquidityRemoved(msg.sender, assetAmount, quoteAmount, liquidity);
    }

    function swapExactInput(address tokenIn, uint256 amountIn, uint256 minAmountOut, address to) external returns (uint256 amountOut) {
        require(to != address(0) && amountIn > 0, "invalid swap");
        require(tokenIn == assetToken || tokenIn == quoteToken, "invalid token");
        IERC20 input = IERC20(tokenIn);
        input.safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 actualIn = tokenIn == assetToken
            ? IERC20(assetToken).balanceOf(address(this)) - reserveAsset
            : IERC20(quoteToken).balanceOf(address(this)) - reserveQuote;
        amountOut = getAmountOut(tokenIn, actualIn);
        require(amountOut >= minAmountOut && amountOut > 0, "output slippage");

        address tokenOut = tokenIn == assetToken ? quoteToken : assetToken;
        IERC20(tokenOut).safeTransfer(to, amountOut);
        _updateReserves();
        emit Swap(msg.sender, tokenIn, actualIn, amountOut, to);
    }

    function _updateReserves() internal {
        uint256 assetBalance = IERC20(assetToken).balanceOf(address(this));
        uint256 quoteBalance = IERC20(quoteToken).balanceOf(address(this));
        require(assetBalance <= type(uint112).max && quoteBalance <= type(uint112).max, "reserve overflow");
        reserveAsset = uint112(assetBalance);
        reserveQuote = uint112(quoteBalance);
    }
}
