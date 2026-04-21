import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// BSC Mainnet USDC address
const USDC_BSC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";

// Your agent wallet address — replace with your actual agent wallet
const AGENT_ADDRESS = "0x1c6402accaa38386ce7ebc6dfa82ed2deafc7544";

const SentinelModule = buildModule("SentinelModule", (m) => {
  // Deploy SentinelFactory
  const factory = m.contract("SentinelFactory", [USDC_BSC, AGENT_ADDRESS]);

  return { factory };
});

export default SentinelModule;