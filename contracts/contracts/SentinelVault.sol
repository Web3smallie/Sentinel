// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SentinelVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    address public agent;
    address public owner;
    uint256 public balance;
    bool public agentActive;
    address public hedgedToken;

    // User defined exit levels
    struct ExitLevel {
        uint256 priceMultiplier; // e.g. 200 = 2x, 500 = 5x
        uint256 sellPercentage;  // e.g. 20 = 20%
        bool triggered;
    }

    struct StopLoss {
        uint256 dropPercentage; // e.g. 50 = 50% drop
        bool triggered;
    }

    ExitLevel[] public exitLevels;
    StopLoss public stopLoss;
    uint256 public entryPrice; // set when user activates agent

    // Spot token approvals
    mapping(address => bool) public approvedTokens;

    // Events
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event AgentAuthorized(address indexed agent);
    event AgentDeactivated();
    event HedgedTokenSet(address indexed token);
    event EmergencyExit(address indexed user);
    event AgentSpend(uint256 amount, string reason);
    event ExitLevelSet(uint256 multiplier, uint256 percentage);
    event StopLossSet(uint256 dropPercentage);
    event TokenApproved(address indexed token);
    event TokenApprovalRevoked(address indexed token);
    event ExitLevelTriggered(uint256 multiplier, uint256 percentage);
    event StopLossTriggered(uint256 dropPercentage);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not vault owner");
        _;
    }

    modifier onlyAgent() {
        require(msg.sender == agent, "Not authorized agent");
        require(agentActive, "Agent not active");
        _;
    }

    constructor(address _usdc, address _agent, address _owner) {
        usdc = IERC20(_usdc);
        agent = _agent;
        owner = _owner;
        agentActive = false;
    }

    // Deposit USDC
    function deposit(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        balance += amount;
        emit Deposited(msg.sender, amount);
    }

    // Withdraw USDC
    function withdraw(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        require(amount <= balance, "Insufficient balance");
        require(!agentActive, "Stop agent before withdrawing");
        balance -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // Set token to hedge
    function setHedgedToken(address token) external onlyOwner {
        hedgedToken = token;
        emit HedgedTokenSet(token);
    }

    // Set entry price
    function setEntryPrice(uint256 price) external onlyOwner {
        entryPrice = price;
    }

    // Add exit level
    function addExitLevel(
        uint256 priceMultiplier,
        uint256 sellPercentage
    ) external onlyOwner {
        require(sellPercentage <= 100, "Cannot exceed 100%");
        exitLevels.push(ExitLevel({
            priceMultiplier: priceMultiplier,
            sellPercentage: sellPercentage,
            triggered: false
        }));
        emit ExitLevelSet(priceMultiplier, sellPercentage);
    }

    // Clear all exit levels
    function clearExitLevels() external onlyOwner {
        delete exitLevels;
    }

    // Set stop loss
    function setStopLoss(uint256 dropPercentage) external onlyOwner {
        require(dropPercentage <= 100, "Cannot exceed 100%");
        stopLoss = StopLoss({
            dropPercentage: dropPercentage,
            triggered: false
        });
        emit StopLossSet(dropPercentage);
    }

    // Approve token for agent to manage spot
    function approveTokenForAgent(address token) external onlyOwner {
        approvedTokens[token] = true;
        emit TokenApproved(token);
    }

    // Revoke token approval
    function revokeTokenApproval(address token) external onlyOwner {
        approvedTokens[token] = false;
        emit TokenApprovalRevoked(token);
    }

    // Authorize agent
    function authorizeAgent() external onlyOwner {
        require(balance > 0, "Deposit USDC first");
        require(hedgedToken != address(0), "Set hedged token first");
        require(entryPrice > 0, "Set entry price first");
        agentActive = true;
        emit AgentAuthorized(agent);
    }

    // Emergency exit
    function emergencyExit() external onlyOwner {
        agentActive = false;
        emit EmergencyExit(msg.sender);
        emit AgentDeactivated();
    }

    // Agent marks exit level as triggered
    function markExitLevelTriggered(uint256 index) external onlyAgent {
        require(index < exitLevels.length, "Invalid index");
        exitLevels[index].triggered = true;
        emit ExitLevelTriggered(
            exitLevels[index].priceMultiplier,
            exitLevels[index].sellPercentage
        );
    }

    // Agent marks stop loss as triggered
    function markStopLossTriggered() external onlyAgent {
        stopLoss.triggered = true;
        emit StopLossTriggered(stopLoss.dropPercentage);
    }

    // Agent spends USDC for trading
    function agentSpend(
        uint256 amount,
        address recipient,
        string calldata reason
    ) external onlyAgent nonReentrant {
        require(amount <= balance, "Insufficient vault balance");
        balance -= amount;
        usdc.safeTransfer(recipient, amount);
        emit AgentSpend(amount, reason);
    }

    // Agent returns USDC to vault
    function agentReturn(uint256 amount) external onlyAgent nonReentrant {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        balance += amount;
    }

    // Get exit levels
    function getExitLevels() external view returns (ExitLevel[] memory) {
        return exitLevels;
    }

    // Get vault info
    function getVaultInfo() external view returns (
        address _owner,
        address _agent,
        uint256 _balance,
        bool _agentActive,
        address _hedgedToken,
        uint256 _entryPrice
    ) {
        return (owner, agent, balance, agentActive, hedgedToken, entryPrice);
    }

    // Check if token is approved for agent
    function isTokenApproved(address token) external view returns (bool) {
        return approvedTokens[token];
    }
}