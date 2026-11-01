// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "../perp/interfaces/IOracleRouter.sol";
import "./SyntheticRwaToken.sol";

/// @notice Oracle-priced synthetic spot market backed by tUSDC liquidity.
/// @dev Price is anchored to Pyth; LPs provide tUSDC only and earn trading fees while underwriting price risk.
contract OracleSpotPool is ERC20, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;

    SyntheticRwaToken public immutable assetToken;
    IERC20 public immutable quoteToken;
    IOracleRouter public immutable oracle;
    bytes32 public immutable feedId;
    uint8 public immutable quoteDecimals;
    uint256 public immutable quoteScaleTo18;

    uint32 public maxPriceAge;
    uint32 public maxConfidenceBps;
    uint32 public feeBps;
    uint32 public minCollateralBps;
    uint256 public minInitialLiquidity;
    uint256 public totalFeesQuote;

    error InvalidConfig();
    error InvalidPrice();
    error ConfidenceTooWide();
    error AmountTooSmall();
    error Slippage();
    error Insolvent();
    error InsufficientLiquidity();
    error OracleFeeTooLow();
    error RefundFailed();

    event Bought(
        address indexed trader,
        uint256 quoteIn,
        uint256 assetOut,
        uint256 feeQuote,
        uint256 price18
    );
    event Sold(
        address indexed trader,
        uint256 assetIn,
        uint256 quoteOut,
        uint256 feeQuote,
        uint256 price18
    );
    event LiquidityAdded(address indexed provider, uint256 quoteIn, uint256 lpOut);
    event LiquidityRemoved(address indexed provider, uint256 lpIn, uint256 quoteOut);
    event RiskParamsUpdated(
        uint32 feeBps,
        uint32 minCollateralBps,
        uint32 maxPriceAge,
        uint32 maxConfidenceBps
    );

    constructor(
        address assetToken_,
        address quoteToken_,
        address oracle_,
        bytes32 feedId_,
        string memory lpName_,
        string memory lpSymbol_,
        address initialOwner
    ) ERC20(lpName_, lpSymbol_) Ownable(initialOwner) {
        if (
            assetToken_ == address(0) ||
            quoteToken_ == address(0) ||
            oracle_ == address(0) ||
            feedId_ == bytes32(0)
        ) revert InvalidConfig();

        uint8 decimals_ = IERC20Metadata(quoteToken_).decimals();
        if (decimals_ > 18) revert InvalidConfig();

        assetToken = SyntheticRwaToken(assetToken_);
        quoteToken = IERC20(quoteToken_);
        oracle = IOracleRouter(oracle_);
        feedId = feedId_;
        quoteDecimals = decimals_;
        quoteScaleTo18 = 10 ** (18 - decimals_);

        maxPriceAge = 120;
        maxConfidenceBps = 200;
        feeBps = 30;
        minCollateralBps = 12_500;
        minInitialLiquidity = 100 * (10 ** decimals_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setRiskParams(
        uint32 feeBps_,
        uint32 minCollateralBps_,
        uint32 maxPriceAge_,
        uint32 maxConfidenceBps_
    ) external onlyOwner {
        if (
            feeBps_ > 200 ||
            minCollateralBps_ < 10_500 ||
            maxPriceAge_ == 0 ||
            maxConfidenceBps_ == 0 ||
            maxConfidenceBps_ > 2_000
        ) revert InvalidConfig();

        feeBps = feeBps_;
        minCollateralBps = minCollateralBps_;
        maxPriceAge = maxPriceAge_;
        maxConfidenceBps = maxConfidenceBps_;

        emit RiskParamsUpdated(
            feeBps_,
            minCollateralBps_,
            maxPriceAge_,
            maxConfidenceBps_
        );
    }

    function setMinInitialLiquidity(uint256 amount) external onlyOwner {
        if (amount == 0) revert InvalidConfig();
        minInitialLiquidity = amount;
    }

    function getUpdateFee(bytes[] calldata updateData)
        external
        view
        returns (uint256)
    {
        return oracle.getUpdateFee(updateData);
    }

    function getPrice18()
        public
        view
        returns (uint256 price18, uint256 conf18, uint256 publishTime)
    {
        (price18, conf18, publishTime) =
            oracle.getPrice18(feedId, maxPriceAge);

        if (price18 == 0) revert InvalidPrice();
        if (conf18 * BPS > price18 * maxConfidenceBps) {
            revert ConfidenceTooWide();
        }
    }

    function quoteBuy(uint256 quoteIn)
        external
        view
        returns (uint256 assetOut, uint256 feeQuote, uint256 price18)
    {
        (price18, , ) = getPrice18();
        (assetOut, feeQuote) = _quoteBuy(quoteIn, price18);
    }

    function quoteSell(uint256 assetIn)
        external
        view
        returns (uint256 quoteOut, uint256 feeQuote, uint256 price18)
    {
        (price18, , ) = getPrice18();
        (quoteOut, feeQuote) = _quoteSell(assetIn, price18);
    }

    function previewAddLiquidity(uint256 quoteAmount)
        external
        view
        returns (uint256 lpOut)
    {
        (uint256 price18, , ) = getPrice18();
        uint256 supply = totalSupply();
        uint256 equityQuote = _equityQuote(price18);

        if (supply == 0) {
            return quoteAmount * quoteScaleTo18;
        }

        if (equityQuote == 0) return 0;
        return (quoteAmount * supply) / equityQuote;
    }

    function previewRemoveLiquidity(uint256 lpAmount)
        external
        view
        returns (uint256 quoteOut)
    {
        uint256 supply = totalSupply();
        if (supply == 0) return 0;
        (uint256 price18, , ) = getPrice18();
        uint256 equityQuote = _equityQuote(price18);
        return (lpAmount * equityQuote) / supply;
    }

    function getPoolState()
        external
        view
        returns (
            uint256 price18,
            uint256 quoteBalance,
            uint256 liabilityQuote,
            uint256 equityQuote,
            uint256 collateralBps,
            uint256 syntheticSupply,
            uint256 lpSupply
        )
    {
        (price18, , ) = getPrice18();
        quoteBalance = quoteToken.balanceOf(address(this));
        syntheticSupply = assetToken.totalSupply();
        liabilityQuote = _liabilityQuote(price18);
        equityQuote = quoteBalance > liabilityQuote
            ? quoteBalance - liabilityQuote
            : 0;
        collateralBps = liabilityQuote == 0
            ? type(uint256).max
            : (quoteBalance * BPS) / liabilityQuote;
        lpSupply = totalSupply();
    }

    function buyExactQuote(
        uint256 quoteIn,
        uint256 minAssetOut,
        bytes[] calldata updateData
    ) external payable nonReentrant whenNotPaused returns (uint256 assetOut) {
        if (quoteIn == 0) revert AmountTooSmall();

        (uint256 price18, uint256 feePaid) = _updateAndRead(updateData);
        uint256 feeQuote;
        (assetOut, feeQuote) = _quoteBuy(quoteIn, price18);
        if (assetOut == 0 || assetOut < minAssetOut) revert Slippage();
        totalFeesQuote += feeQuote;

        quoteToken.safeTransferFrom(msg.sender, address(this), quoteIn);
        assetToken.poolMint(msg.sender, assetOut);

        _requireCollateralized(price18);
        _refund(msg.value - feePaid);

        emit Bought(msg.sender, quoteIn, assetOut, feeQuote, price18);
    }

    function sellExactAsset(
        uint256 assetIn,
        uint256 minQuoteOut,
        bytes[] calldata updateData
    ) external payable nonReentrant whenNotPaused returns (uint256 quoteOut) {
        if (assetIn == 0) revert AmountTooSmall();

        (uint256 price18, uint256 feePaid) = _updateAndRead(updateData);
        uint256 feeQuote;
        (quoteOut, feeQuote) = _quoteSell(assetIn, price18);
        if (quoteOut == 0 || quoteOut < minQuoteOut) revert Slippage();
        totalFeesQuote += feeQuote;
        if (quoteToken.balanceOf(address(this)) < quoteOut) {
            revert InsufficientLiquidity();
        }

        IERC20(address(assetToken)).safeTransferFrom(
            msg.sender,
            address(this),
            assetIn
        );
        assetToken.poolBurn(assetIn);
        quoteToken.safeTransfer(msg.sender, quoteOut);

        _refund(msg.value - feePaid);

        emit Sold(msg.sender, assetIn, quoteOut, feeQuote, price18);
    }

    function addLiquidity(
        uint256 quoteAmount,
        uint256 minLpOut,
        bytes[] calldata updateData
    ) external payable nonReentrant whenNotPaused returns (uint256 lpOut) {
        if (quoteAmount == 0) revert AmountTooSmall();

        (uint256 price18, uint256 feePaid) = _updateAndRead(updateData);
        uint256 supply = totalSupply();
        uint256 equityBefore = _equityQuote(price18);

        if (supply == 0) {
            if (assetToken.totalSupply() != 0) revert Insolvent();
            if (quoteAmount < minInitialLiquidity) revert AmountTooSmall();
            lpOut = quoteAmount * quoteScaleTo18;
        } else {
            if (equityBefore == 0) revert Insolvent();
            lpOut = (quoteAmount * supply) / equityBefore;
        }

        if (lpOut == 0 || lpOut < minLpOut) revert Slippage();

        quoteToken.safeTransferFrom(msg.sender, address(this), quoteAmount);
        _mint(msg.sender, lpOut);

        _requireCollateralized(price18);
        _refund(msg.value - feePaid);

        emit LiquidityAdded(msg.sender, quoteAmount, lpOut);
    }

    function removeLiquidity(
        uint256 lpAmount,
        uint256 minQuoteOut,
        bytes[] calldata updateData
    ) external payable nonReentrant returns (uint256 quoteOut) {
        if (lpAmount == 0) revert AmountTooSmall();

        (uint256 price18, uint256 feePaid) = _updateAndRead(updateData);
        uint256 supply = totalSupply();
        uint256 equityQuote = _equityQuote(price18);
        if (supply == 0 || equityQuote == 0) revert InsufficientLiquidity();

        quoteOut = (lpAmount * equityQuote) / supply;
        if (quoteOut == 0 || quoteOut < minQuoteOut) revert Slippage();
        if (quoteToken.balanceOf(address(this)) < quoteOut) {
            revert InsufficientLiquidity();
        }

        _burn(msg.sender, lpAmount);
        quoteToken.safeTransfer(msg.sender, quoteOut);

        uint256 liabilityAfter = _liabilityQuote(price18);
        uint256 balanceAfter = quoteToken.balanceOf(address(this));
        if (
            liabilityAfter > 0 &&
            balanceAfter * BPS < liabilityAfter * minCollateralBps
        ) revert Insolvent();

        _refund(msg.value - feePaid);

        emit LiquidityRemoved(msg.sender, lpAmount, quoteOut);
    }

    function _quoteBuy(uint256 quoteIn, uint256 price18)
        internal
        view
        returns (uint256 assetOut, uint256 feeQuote)
    {
        feeQuote = (quoteIn * feeBps) / BPS;
        uint256 netQuote = quoteIn - feeQuote;
        assetOut = (netQuote * quoteScaleTo18 * 1e18) / price18;
    }

    function _quoteSell(uint256 assetIn, uint256 price18)
        internal
        view
        returns (uint256 quoteOut, uint256 feeQuote)
    {
        uint256 grossQuote =
            ((assetIn * price18) / 1e18) / quoteScaleTo18;
        feeQuote = (grossQuote * feeBps) / BPS;
        quoteOut = grossQuote - feeQuote;
    }

    function _liabilityQuote(uint256 price18)
        internal
        view
        returns (uint256)
    {
        uint256 value18 =
            (assetToken.totalSupply() * price18) / 1e18;
        return value18 / quoteScaleTo18;
    }

    function _equityQuote(uint256 price18)
        internal
        view
        returns (uint256)
    {
        uint256 balance = quoteToken.balanceOf(address(this));
        uint256 liability = _liabilityQuote(price18);
        return balance > liability ? balance - liability : 0;
    }

    function _requireCollateralized(uint256 price18) internal view {
        uint256 liability = _liabilityQuote(price18);
        if (liability == 0) return;

        uint256 balance = quoteToken.balanceOf(address(this));
        if (balance * BPS < liability * minCollateralBps) {
            revert Insolvent();
        }
    }

    function _updateAndRead(bytes[] calldata updateData)
        internal
        returns (uint256 price18, uint256 feePaid)
    {
        feePaid = oracle.getUpdateFee(updateData);
        if (msg.value < feePaid) revert OracleFeeTooLow();

        oracle.updatePriceFeeds{value: feePaid}(updateData);

        uint256 conf18;
        (price18, conf18, ) = oracle.getPrice18(feedId, maxPriceAge);
        if (price18 == 0) revert InvalidPrice();
        if (conf18 * BPS > price18 * maxConfidenceBps) {
            revert ConfidenceTooWide();
        }
    }

    function _refund(uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert RefundFailed();
    }
}
