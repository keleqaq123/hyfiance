// SPDX-License-Identifier: MIT
pragma solidity ^0.6.6;
pragma experimental ABIEncoderV2;

interface IERC20BridgeAsset {
    function balanceOf(address account) external view returns (uint256);
}

interface IBridgeMintable {
    function bridgeMint(address to, uint256 amount) external;
    function bridgeBurn(address from, uint256 amount) external;
}

/**
 * Testnet bridge asset. A bridge can burn on the source chain and mint on the
 * destination chain. The owner is only used to wire the bridge once during
 * deployment; it has no arbitrary mint authority after that.
 */
contract CustosBridgeToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    address public owner;
    address public bridge;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event BridgeSet(address indexed bridge);

    modifier onlyOwner() {
        require(msg.sender == owner, "OWNER_ONLY");
        _;
    }

    modifier onlyBridge() {
        require(msg.sender == bridge, "BRIDGE_ONLY");
        _;
    }

    constructor(string memory tokenName, string memory tokenSymbol, uint256 initialSupply, address initialHolder) public {
        require(initialHolder != address(0), "INVALID_HOLDER");
        name = tokenName;
        symbol = tokenSymbol;
        owner = msg.sender;
        _mint(initialHolder, initialSupply);
    }

    function setBridge(address nextBridge) external onlyOwner {
        require(nextBridge != address(0), "INVALID_BRIDGE");
        bridge = nextBridge;
        emit BridgeSet(nextBridge);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        require(currentAllowance >= amount, "INSUFFICIENT_ALLOWANCE");
        if (currentAllowance != uint256(-1)) {
            allowance[from][msg.sender] = currentAllowance - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function bridgeMint(address to, uint256 amount) external onlyBridge {
        _mint(to, amount);
    }

    function bridgeBurn(address from, uint256 amount) external onlyBridge {
        require(balanceOf[from] >= amount, "INSUFFICIENT_BALANCE");
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "INVALID_RECIPIENT");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "INVALID_RECIPIENT");
        require(balanceOf[from] >= amount, "INSUFFICIENT_BALANCE");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

/**
 * Message-passing bridge for a trusted-relayer testnet flow.
 *
 * Users burn a configured asset on the source chain. The contract emits a
 * complete message. An administrator/relayer reads that event and calls
 * executeMessage on the destination bridge, where the paired asset is minted.
 * Replay protection, trusted remote bridges and pair configuration all live on
 * chain; apps/relayer automates transport while retaining a manual fallback.
 */
contract CustosBridge {
    struct MessageData {
        uint256 sourceChainId;
        uint256 targetChainId;
        address sourceBridge;
        address targetBridge;
        address sourceToken;
        address targetToken;
        address recipient;
        uint256 amount;
        bytes32 payloadHash;
        uint256 nonce;
    }

    struct OutboundMessage {
        uint256 sourceChainId;
        uint256 targetChainId;
        address sourceBridge;
        address targetBridge;
        address sourceToken;
        address targetToken;
        address sender;
        address recipient;
        uint256 amount;
        bytes32 payloadHash;
        uint256 nonce;
    }

    address public admin;
    address public relayer;
    uint256 public localChainId;
    uint256 public nextNonce;
    bool public paused;

    mapping(uint256 => address) public trustedRemoteBridge;
    mapping(uint256 => mapping(address => address)) public remoteToken;
    mapping(bytes32 => bool) public processed;
    mapping(bytes32 => OutboundMessage) public outboundMessages;

    function _messageId(MessageData memory message) internal pure returns (bytes32) {
        return keccak256(abi.encode(message));
    }

    event TrustedRemoteSet(uint256 indexed chainId, address indexed remoteBridge);
    event TokenPairSet(uint256 indexed remoteChainId, address indexed localToken, address indexed remoteTokenAddress);
    event RelayerSet(address indexed relayer);
    event Paused(bool paused);
    event MessageSent(
        bytes32 indexed messageId,
        uint256 indexed sourceChainId,
        uint256 indexed targetChainId,
        address sourceBridge,
        address targetBridge,
        address sourceToken,
        address targetToken,
        address sender,
        address recipient,
        uint256 amount,
        bytes payload,
        uint256 nonce
    );
    event MessageExecuted(
        bytes32 indexed messageId,
        uint256 indexed sourceChainId,
        address indexed recipient,
        address sourceToken,
        address targetToken,
        uint256 amount,
        address executor
    );

    modifier onlyAdmin() {
        require(msg.sender == admin, "ADMIN_ONLY");
        _;
    }

    modifier onlyRelayer() {
        require(msg.sender == admin || msg.sender == relayer, "RELAYER_ONLY");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "BRIDGE_PAUSED");
        _;
    }

    constructor(address initialAdmin, address initialRelayer, uint256 initialChainId) public {
        require(initialAdmin != address(0), "INVALID_ADMIN");
        require(initialChainId > 0, "INVALID_CHAIN_ID");
        admin = initialAdmin;
        relayer = initialRelayer == address(0) ? initialAdmin : initialRelayer;
        localChainId = initialChainId;
    }

    function isAdmin(address account) external view returns (bool) {
        return account == admin;
    }

    function isRelayer(address account) external view returns (bool) {
        return account == admin || account == relayer;
    }

    function setRelayer(address nextRelayer) external onlyAdmin {
        require(nextRelayer != address(0), "INVALID_RELAYER");
        relayer = nextRelayer;
        emit RelayerSet(nextRelayer);
    }

    function setTrustedRemote(uint256 chainId, address remoteBridge) external onlyAdmin {
        require(remoteBridge != address(0), "INVALID_REMOTE_BRIDGE");
        trustedRemoteBridge[chainId] = remoteBridge;
        emit TrustedRemoteSet(chainId, remoteBridge);
    }

    function setTokenPair(uint256 remoteChainId, address localToken, address remoteTokenAddress) external onlyAdmin {
        require(localToken != address(0) && remoteTokenAddress != address(0), "INVALID_TOKEN_PAIR");
        remoteToken[remoteChainId][localToken] = remoteTokenAddress;
        emit TokenPairSet(remoteChainId, localToken, remoteTokenAddress);
    }

    function setPaused(bool nextPaused) external onlyAdmin {
        paused = nextPaused;
        emit Paused(nextPaused);
    }

    function bridgeOut(
        address token,
        uint256 targetChainId,
        address targetBridge,
        address recipient,
        uint256 amount,
        bytes calldata payload
    ) external whenNotPaused returns (bytes32 messageId) {
        address targetToken = remoteToken[targetChainId][token];
        require(targetToken != address(0), "TOKEN_PAIR_NOT_CONFIGURED");
        require(trustedRemoteBridge[targetChainId] == targetBridge, "REMOTE_NOT_TRUSTED");
        require(recipient != address(0) && amount > 0, "INVALID_BRIDGE_REQUEST");

        IBridgeMintable(token).bridgeBurn(msg.sender, amount);

        uint256 currentNonce = nextNonce++;
        bytes32 payloadHash = keccak256(payload);
        uint256 sourceChainId = localChainId;
        MessageData memory message = MessageData({
            sourceChainId: sourceChainId,
            targetChainId: targetChainId,
            sourceBridge: address(this),
            targetBridge: targetBridge,
            sourceToken: token,
            targetToken: targetToken,
            recipient: recipient,
            amount: amount,
            payloadHash: payloadHash,
            nonce: currentNonce
        });
        messageId = _messageId(message);

        OutboundMessage memory outbound = OutboundMessage({
            sourceChainId: message.sourceChainId,
            targetChainId: targetChainId,
            sourceBridge: address(this),
            targetBridge: targetBridge,
            sourceToken: token,
            targetToken: targetToken,
            sender: msg.sender,
            recipient: recipient,
            amount: amount,
            payloadHash: payloadHash,
            nonce: currentNonce
        });
        outboundMessages[messageId] = outbound;

        _emitMessageSent(messageId, outbound, payload);
    }

    function _emitMessageSent(
        bytes32 messageId,
        OutboundMessage memory outbound,
        bytes memory payload
    ) internal {
        emit MessageSent(
            messageId,
            outbound.sourceChainId,
            outbound.targetChainId,
            outbound.sourceBridge,
            outbound.targetBridge,
        outbound.sourceToken,
        outbound.targetToken,
            outbound.sender,
        outbound.recipient,
        outbound.amount,
            payload,
            outbound.nonce
        );
    }

    function executeMessage(
        bytes32 messageId,
        uint256 sourceChainId,
        address sourceBridge,
        address sourceToken,
        address recipient,
        uint256 amount,
        uint256 nonce,
        bytes calldata payload
    ) external onlyRelayer whenNotPaused {
        require(!processed[messageId], "MESSAGE_ALREADY_PROCESSED");
        require(trustedRemoteBridge[sourceChainId] == sourceBridge, "SOURCE_NOT_TRUSTED");
        address targetToken = remoteToken[sourceChainId][sourceToken];
        require(targetToken != address(0), "TOKEN_PAIR_NOT_CONFIGURED");
        require(recipient != address(0) && amount > 0, "INVALID_MESSAGE");

        MessageData memory message = MessageData({
            sourceChainId: sourceChainId,
            targetChainId: localChainId,
            sourceBridge: sourceBridge,
            targetBridge: address(this),
            sourceToken: sourceToken,
            targetToken: targetToken,
            recipient: recipient,
            amount: amount,
            payloadHash: keccak256(payload),
            nonce: nonce
        });
        require(_messageId(message) == messageId, "MESSAGE_ID_MISMATCH");

        processed[messageId] = true;
        IBridgeMintable(targetToken).bridgeMint(recipient, amount);

        emit MessageExecuted(messageId, sourceChainId, recipient, sourceToken, targetToken, amount, msg.sender);
    }
}
