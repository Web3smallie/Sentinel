// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./SentinelVault.sol";

contract SentinelFactory {
    // USDC address on BSC
    address public immutable usdc;
    
    // SENTINEL agent address
    address public immutable agent;

    // Mapping from user address to their vault
    mapping(address => address) public userVault;

    // All vaults ever created
    address[] public allVaults;

    // Events
    event VaultCreated(address indexed user, address indexed vault);

    constructor(address _usdc, address _agent) {
        usdc = _usdc;
        agent = _agent;
    }

    // Create a personal vault for the caller
    function createVault() external returns (address) {
        require(userVault[msg.sender] == address(0), "Vault already exists");

        SentinelVault vault = new SentinelVault(usdc, agent, msg.sender);
        
        userVault[msg.sender] = address(vault);
        allVaults.push(address(vault));

        emit VaultCreated(msg.sender, address(vault));
        return address(vault);
    }

    // Get vault address for a user
    function getVault(address user) external view returns (address) {
        return userVault[user];
    }

    // Check if user has a vault
    function hasVault(address user) external view returns (bool) {
        return userVault[user] != address(0);
    }

    // Get total number of vaults
    function totalVaults() external view returns (uint256) {
        return allVaults.length;
    }
}