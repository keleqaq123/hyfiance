// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title GIWA Genesis
/// @notice A small, fixed-supply GIWA Sepolia collectible for early builders.
contract GiwaGenesis is ERC721, Ownable, ReentrancyGuard {
    uint256 public constant MAX_SUPPLY = 1111;
    uint256 public constant WALLET_LIMIT = 1;

    uint256 public immutable mintPrice;
    uint256 public totalSupply;
    bool public mintOpen = true;

    string private baseTokenURI;
    mapping(address => uint256) public mintedByWallet;

    error MintClosed();
    error IncorrectQuantity();
    error SoldOut();
    error WalletLimitReached();
    error IncorrectPayment(uint256 expected, uint256 received);
    error WithdrawalFailed();

    event Minted(address indexed minter, uint256 indexed tokenId);
    event MintStatusChanged(bool isOpen);
    event BaseURIChanged(string newBaseURI);
    event Withdrawal(address indexed recipient, uint256 amount);

    constructor(uint256 mintPriceWei, string memory initialBaseURI)
        ERC721("GIWA Genesis", "GIWA")
        Ownable(msg.sender)
    {
        require(mintPriceWei > 0, "Price must be positive");
        mintPrice = mintPriceWei;
        baseTokenURI = initialBaseURI;
    }

    /// @notice Mint exactly one NFT per wallet with native GIWA test ETH.
    function publicMint(uint256 quantity) external payable nonReentrant {
        if (!mintOpen) revert MintClosed();
        if (quantity != 1) revert IncorrectQuantity();
        if (totalSupply >= MAX_SUPPLY) revert SoldOut();
        if (mintedByWallet[msg.sender] >= WALLET_LIMIT) revert WalletLimitReached();
        if (msg.value != mintPrice) revert IncorrectPayment(mintPrice, msg.value);

        uint256 tokenId = totalSupply + 1;
        totalSupply = tokenId;
        mintedByWallet[msg.sender] += 1;
        _safeMint(msg.sender, tokenId);

        emit Minted(msg.sender, tokenId);
    }

    function setMintOpen(bool isOpen) external onlyOwner {
        mintOpen = isOpen;
        emit MintStatusChanged(isOpen);
    }

    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        baseTokenURI = newBaseURI;
        emit BaseURIChanged(newBaseURI);
    }

    function baseURI() external view returns (string memory) {
        return baseTokenURI;
    }

    function withdraw() external onlyOwner nonReentrant {
        uint256 amount = address(this).balance;
        (bool sent, ) = owner().call{value: amount}("");
        if (!sent) revert WithdrawalFailed();
        emit Withdrawal(owner(), amount);
    }

    function _baseURI() internal view override returns (string memory) {
        return baseTokenURI;
    }
}
