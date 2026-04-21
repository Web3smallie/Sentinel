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

  const publicClient = createPublicClient({
    chain: bscTestnet,
    transport: http("https://data-seed-prebsc-1-s1.binance.org:8545"),
  });

  const walletClient = createWalletClient({
    account,
    chain: bscTestnet,
    transport: http("https://data-seed-prebsc-1-s1.binance.org:8545"),
  });

  const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS as `0x${string}`;

  const factoryArtifact = JSON.parse(
    readFileSync(
      join("artifacts", "contracts", "SentinelFactory.sol", "SentinelFactory.json"),
      "utf8"
    )
  );

  console.log("Creating vault for:", account.address);

  const hash = await walletClient.writeContract({
    address: FACTORY_ADDRESS,
    abi: factoryArtifact.abi,
    functionName: "createVault",
    args: [],
  });

  console.log("Transaction hash:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("Vault created successfully!");
  console.log("Transaction:", receipt.transactionHash);

  // Get vault address
  const vaultAddress = await publicClient.readContract({
    address: FACTORY_ADDRESS,
    abi: factoryArtifact.abi,
    functionName: "getVault",
    args: [account.address],
  });

  console.log("Your vault address:", vaultAddress);
  console.log("SAVE THIS ADDRESS!");
}

main().catch(console.error);