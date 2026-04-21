import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import dotenv from "dotenv";
dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    bscMainnet: {
      type: "http",
      url: "https://bsc-dataseed1.binance.org",
      chainId: 56,
      accounts: process.env.AGENT_PRIVATE_KEY
        ? [process.env.AGENT_PRIVATE_KEY]
        : [],
    },
    bscTestnet: {
      type: "http",
      url: "https://data-seed-prebsc-1-s1.binance.org:8545",
      chainId: 97,
      accounts: process.env.AGENT_PRIVATE_KEY
        ? [process.env.AGENT_PRIVATE_KEY]
        : [],
    },
  },
};

export default config;