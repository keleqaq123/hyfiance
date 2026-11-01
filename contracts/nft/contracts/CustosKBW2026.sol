// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Independent KBW 2026 community keepsake. Minting is permanently free.
contract CustosKBW2026 is ERC721, Ownable, ReentrancyGuard {
    uint256 public constant MAX_SUPPLY = 2026;
    uint256 public constant WALLET_LIMIT = 1;
    uint256 public constant mintPrice = 0;
    uint256 public totalSupply;
    bool public mintOpen = true;
    mapping(address => uint256) public mintedByWallet;
    string private collectionTokenURI;

    error MintClosed();
    error IncorrectQuantity();
    error SoldOut();
    error WalletLimitReached();
    error IncorrectPayment(uint256 expected, uint256 received);
    event Minted(address indexed minter, uint256 indexed tokenId);
    event MintStatusChanged(bool isOpen);
    event MetadataChanged(string uri);

    constructor(string memory metadataURI)
        ERC721("Custos - The Builder's Mark", "KBW2026")
        Ownable(msg.sender)
    {
        require(bytes(metadataURI).length > 0, "Metadata required");
        collectionTokenURI = metadataURI;
    }

    function publicMint(uint256 quantity) external payable nonReentrant {
        if (!mintOpen) revert MintClosed();
        if (quantity != 1) revert IncorrectQuantity();
        if (totalSupply >= MAX_SUPPLY) revert SoldOut();
        if (mintedByWallet[msg.sender] >= WALLET_LIMIT) revert WalletLimitReached();
        if (msg.value != 0) revert IncorrectPayment(0, msg.value);
        uint256 tokenId = ++totalSupply;
        mintedByWallet[msg.sender] = 1;
        _safeMint(msg.sender, tokenId);
        emit Minted(msg.sender, tokenId);
    }

    function setMintOpen(bool open) external onlyOwner {
        mintOpen = open;
        emit MintStatusChanged(open);
    }

    function setMetadataURI(string calldata uri) external onlyOwner {
        require(bytes(uri).length > 0, "Metadata required");
        collectionTokenURI = uri;
        emit MetadataChanged(uri);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return collectionTokenURI;
    }
}
