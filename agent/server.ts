import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { getTokenData } from './watcher';
import { analyzeToken } from './analyzer';
import { getCurrentPosition, getInsuranceFund, emergencyExit, openPosition, checkTrailingStop } from './hedger';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const provider = new ethers.JsonRpcProvider(process.env.BSC_RPC_URL);
const testnetProvider = new ethers.JsonRpcProvider(process.env.BSC_TESTNET_RPC);
const agentWalletTestnet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY!, testnetProvider);

const PERP_FACTORY_ABI = [
  'function createMarket(address tokenAddress, string calldata tokenName) external returns (uint256)',
  'function openPosition(uint256 marketId, bool isLong, uint256 collateral, uint256 entryPrice) external returns (uint256)',
  'function closePosition(uint256 positionId, uint256 exitPrice) external',
  'function getMarketId(address tokenAddress) external view returns (uint256)',
  'function getPosition(uint256 positionId) external view returns (tuple(address trader, uint256 marketId, bool isLong, uint256 size, uint256 collateral, uint256 entryPrice, uint256 openedAt, bool isOpen, int256 pnl))',
  'function getMarket(uint256 marketId) external view returns (tuple(address tokenAddress, string tokenName, uint256 createdAt, bool active, uint256 totalLongs, uint256 totalShorts, uint256 totalFees))',
  'function getTraderPositions(address trader) external view returns (uint256[])',
];

const USDC_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) external returns (bool)',
];

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

let currentTokenAddress = '';
let currentUserWallet = '';
let currentPerpMarketId = 0;
let currentPerpPositionId = 0;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUTONOMOUS TRADING LOOP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
setInterval(async () => {
  if (!currentTokenAddress) return;
  try {
    const data = await getTokenData(currentTokenAddress);
    if (data.price === 0) return;

    const position = getCurrentPosition();

    // Check trailing stop if position open
    if (position) {
      await checkTrailingStop(data.price);
    }

    const analysis = await analyzeToken(data, position?.type || null);

    console.log(`[SENTINEL] ${data.name} | $${data.price} | ${analysis.grade} ${analysis.score.toFixed(0)}/100 | ${analysis.action} | ${analysis.confidence}%`);

    if (!position) {
      if (analysis.action === 'LONG' && analysis.confidence >= 0) {
        console.log('[SENTINEL] Opening LONG position...');
        await openPosition('LONG', data.price, analysis);
      } else if (analysis.action === 'SHORT' && analysis.confidence >= 0) {
        console.log('[SENTINEL] Opening SHORT position...');
        await openPosition('SHORT', data.price, analysis);
      }
    } else {
      // Flip position if signal reverses
      if (
        (position.type === 'LONG' && analysis.action === 'SHORT') ||
        (position.type === 'SHORT' && analysis.action === 'LONG')
      ) {
        const { closePosition } = await import('./hedger');
        await closePosition(data.price, 'Signal reversal');
        await openPosition(analysis.action as 'LONG' | 'SHORT', data.price, analysis);
      }
    }
  } catch (e) {
    console.error('[SENTINEL] Loop error:', e);
  }
}, 10000);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/api/status', async (req, res) => {
  try {
    if (!currentTokenAddress) {
      return res.json({ success: false, error: 'No token selected' });
    }
    const tokenData = await getTokenData(currentTokenAddress);
    const analysis = await analyzeToken(tokenData, getCurrentPosition()?.type || null);
    const position = getCurrentPosition();

    res.json({
      success: true,
      data: {
        token: {
          address: currentTokenAddress,
          name: tokenData.name,
          price: tokenData.price,
          priceChange5m: tokenData.priceChange5m,
          priceChange1h: tokenData.priceChange1h,
          volume5m: tokenData.volume5m,
          holders: tokenData.holders,
          marketCap: tokenData.marketCap,
          bondingCurveProgress: tokenData.bondingCurveProgress,
        },
        analysis: {
          score: analysis.score,
          grade: analysis.grade,
          action: analysis.action,
          confidence: analysis.confidence,
          reason: analysis.reason,
          signals: analysis.signals,
        },
        position: position ? {
          type: position.type,
          entryPrice: position.entryPrice,
          pnl: position.pnl,
          openedAt: position.openedAt,
        } : null,
        insuranceFund: getInsuranceFund(),
        agentRunning: true,
        perpMarketId: currentPerpMarketId,
        perpPositionId: currentPerpPositionId,
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/api/usdc-balance/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const usdc = new ethers.Contract(process.env.USDC_TESTNET!, USDC_ABI, testnetProvider);
    const balance = await usdc.balanceOf(address);
    const formatted = ethers.formatUnits(balance, 18);
    res.json({ success: true, balance: formatted });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/api/vault/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const factoryABI = [
      'function hasVault(address user) external view returns (bool)',
      'function getVault(address user) external view returns (address)',
    ];
    const vaultABI = [
      'function getVaultInfo() external view returns (address _owner, address _agent, uint256 _balance, bool _agentActive, address _hedgedToken, uint256 _entryPrice)',
    ];
    const factory = new ethers.Contract(process.env.FACTORY_ADDRESS!, factoryABI, testnetProvider);
    const hasVault = await factory.hasVault(address);
    if (!hasVault) return res.json({ success: true, hasVault: false });
    const vaultAddress = await factory.getVault(address);
    const vault = new ethers.Contract(vaultAddress, vaultABI, testnetProvider);
    const info = await vault.getVaultInfo();
    const usdc = new ethers.Contract(process.env.USDC_TESTNET!, USDC_ABI, testnetProvider);
    const usdcBalance = await usdc.balanceOf(address);
    res.json({
      success: true, hasVault: true, vaultAddress,
      balance: ethers.formatUnits(info._balance, 6),
      agentActive: info._agentActive,
      hedgedToken: info._hedgedToken,
      usdcBalance: ethers.formatUnits(usdcBalance, 6),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/api/wallet-tokens/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const response = await fetch('https://four.meme/meme-api/v1/public/token/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageSize: 50, pageNum: 1, orderBy: 'created_time' })
    });
    const data = await response.json() as any;
    const allTokens = data?.data?.list || [];
    const userTokens = [];
    for (const token of allTokens.slice(0, 20)) {
      try {
        if (!token.tokenAddress) continue;
        const contract = new ethers.Contract(token.tokenAddress, ERC20_ABI, provider);
        const balance = await contract.balanceOf(address);
        if (balance > BigInt(0)) {
          const decimals = await contract.decimals().catch(() => 18);
          const formattedBalance = ethers.formatUnits(balance, decimals);
          userTokens.push({
            address: token.tokenAddress,
            name: token.tokenName || token.name || 'Unknown',
            symbol: token.symbol || '???',
            balance: formattedBalance,
            value: parseFloat(token.price || '0') * parseFloat(formattedBalance),
          });
        }
      } catch { continue; }
    }
    res.json({ success: true, tokens: userTokens });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/api/set-token', async (req, res) => {
  try {
    const { tokenAddress, userWallet } = req.body;
    currentTokenAddress = tokenAddress;
    currentUserWallet = userWallet;
    console.log(`[SERVER] Now watching: ${tokenAddress} for user: ${userWallet}`);
    res.json({ success: true, message: 'Token updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/api/create-market', async (req, res) => {
  try {
    const { tokenAddress, tokenName } = req.body;
    const perpFactory = new ethers.Contract(process.env.PERP_FACTORY_ADDRESS!, PERP_FACTORY_ABI, agentWalletTestnet);
    const existingMarketId = await perpFactory.getMarketId(tokenAddress);
    if (existingMarketId > BigInt(0)) {
      currentPerpMarketId = Number(existingMarketId);
      return res.json({ success: true, marketId: currentPerpMarketId, existing: true });
    }
    console.log(`[SERVER] Creating perp market for ${tokenName}...`);
    const tx = await perpFactory.createMarket(tokenAddress, tokenName);
    const receipt = await tx.wait();
    const marketId = await perpFactory.getMarketId(tokenAddress);
    currentPerpMarketId = Number(marketId);
    console.log(`[SERVER] Market created: ID ${currentPerpMarketId} | TX: ${receipt.hash}`);
    res.json({ success: true, marketId: currentPerpMarketId, txHash: receipt.hash });
  } catch (error) {
    console.error('[SERVER] Create market error:', error);
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/api/open-position', async (req, res) => {
  try {
    const { marketId, isLong, collateralAmount, entryPrice } = req.body;
    const perpFactory = new ethers.Contract(process.env.PERP_FACTORY_ADDRESS!, PERP_FACTORY_ABI, agentWalletTestnet);
    const usdc = new ethers.Contract(process.env.USDC_TESTNET!, USDC_ABI, agentWalletTestnet);
    const collateral = ethers.parseUnits(collateralAmount.toString(), 6);
    const priceScaled = BigInt(Math.floor(entryPrice * 1e18));
    const approveTx = await usdc.approve(process.env.PERP_FACTORY_ADDRESS!, collateral);
    await approveTx.wait();
    const tx = await perpFactory.openPosition(marketId, isLong, collateral, priceScaled);
    const receipt = await tx.wait();
    res.json({ success: true, txHash: receipt.hash });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/api/close-position', async (req, res) => {
  try {
    const { positionId, exitPrice } = req.body;
    const perpFactory = new ethers.Contract(process.env.PERP_FACTORY_ADDRESS!, PERP_FACTORY_ABI, agentWalletTestnet);
    const priceScaled = BigInt(Math.floor(exitPrice * 1e18));
    const tx = await perpFactory.closePosition(positionId, priceScaled);
    const receipt = await tx.wait();
    res.json({ success: true, txHash: receipt.hash });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/api/emergency-exit', async (req, res) => {
  try {
    const tokenData = await getTokenData(currentTokenAddress);
    await emergencyExit(tokenData.price);
    if (currentPerpPositionId > 0) {
      const perpFactory = new ethers.Contract(process.env.PERP_FACTORY_ADDRESS!, PERP_FACTORY_ABI, agentWalletTestnet);
      const priceScaled = BigInt(Math.floor(tokenData.price * 1e18));
      await perpFactory.closePosition(currentPerpPositionId, priceScaled);
      currentPerpPositionId = 0;
    }
    res.json({ success: true, message: 'Emergency exit executed' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[SERVER] SENTINEL API running on port ${PORT}`);
  console.log(`[SERVER] Trading loop active — polling every 10s`);
});

export default app;
