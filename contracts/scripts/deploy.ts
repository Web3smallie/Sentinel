import { config } from "dotenv";
config();

import { createWalletClient, createPublicClient, http } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { join } from "path";

async function main() {
  const privateKey = process.env.AGENT_PRIVATE_KEY as `0x${string}`;
  const account = privateKeyToAccount(privateKey);

  console.log("Deploying with:", account.address);

  const publicClient = createPublicClient({
    chain: bscTestnet,
    transport: http("https://data-seed-prebsc-1-s1.binance.org:8545"),
  });

  const walletClient = createWalletClient({
    account,
    chain: bscTestnet,
    transport: http("https://data-seed-prebsc-1-s1.binance.org:8545"),
  });

  const USDC_TESTNET = "0x64544969ed7EBf5f083679233325356EbE738930";
  const AGENT_ADDRESS = account.address;

  // Deploy SentinelFactory
  const factoryArtifact = JSON.parse(
    readFileSync(
      join("artifacts", "contracts", "SentinelFactory.sol", "SentinelFactory.json"),
      "utf8"
    )
  );

  console.log("Deploying SentinelFactory...");
  const factoryHash = await walletClient.deployContract({
    abi: factoryArtifact.abi,
    bytecode: factoryArtifact.bytecode,
    args: [USDC_TESTNET, AGENT_ADDRESS],
  });
  const factoryReceipt = await publicClient.waitForTransactionReceipt({ hash: factoryHash });
  console.log("SentinelFactory deployed to:", factoryReceipt.contractAddress);

  // Deploy PerpFactory
  const perpArtifact = JSON.parse(
    readFileSync(
      join("artifacts", "contracts", "PerpFactory.sol", "PerpFactory.json"),
      "utf8"
    )
  );

  console.log("Deploying PerpFactory...");
  const perpHash = await walletClient.deployContract({
    abi: perpArtifact.abi,
    bytecode: perpArtifact.bytecode,
    args: [USDC_TESTNET],
  });
  const perpReceipt = await publicClient.waitForTransactionReceipt({ hash: perpHash });
  console.log("PerpFactory deployed to:", perpReceipt.contractAddress);
  console.log("SAVE BOTH ADDRESSES!");
}

main().catch(console.error);