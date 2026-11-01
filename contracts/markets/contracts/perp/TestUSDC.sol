// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Testnet-only collateral for Custos Finance on GIWA Sepolia.
/// @dev Not USDC, not fiat-backed, not redeemable.
contract TestUSDC is ERC20, Ownable {
    uint256 public faucetAmount = 10_000 * 1e6;
    uint256 public faucetCooldown = 24 hours;

    mapping(address => uint256) public nextFaucetAt;

    event FaucetClaimed(address indexed account, uint256 amount, uint256 nextClaimAt);
    event FaucetConfigUpdated(uint256 amount, uint256 cooldown);

    constructor(address initialOwner)
        ERC20("Custos Test USD Coin", "tUSDC")
        Ownable(initialOwner)
    {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function faucet() external {
        require(block.timestamp >= nextFaucetAt[msg.sender], "FAUCET_COOLDOWN");
        nextFaucetAt[msg.sender] = block.timestamp + faucetCooldown;
        _mint(msg.sender, faucetAmount);
        emit FaucetClaimed(msg.sender, faucetAmount, nextFaucetAt[msg.sender]);
    }

    function ownerMint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function setFaucetConfig(uint256 amount, uint256 cooldown) external onlyOwner {
        require(amount > 0, "ZERO_AMOUNT");
        require(cooldown >= 1 hours, "COOLDOWN_TOO_SHORT");
        faucetAmount = amount;
        faucetCooldown = cooldown;
        emit FaucetConfigUpdated(amount, cooldown);
    }
}
