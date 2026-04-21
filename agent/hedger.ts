import { ethers } from 'ethers';
import dotenv from 'dotenv';
import { AnalysisResult } from './analyzer';
dotenv.config();

const provider = new ethers.JsonRpcProvider(process.env.BSC_RPC_URL);
const agentWallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY!, provider);

const TOKEN_MANAGER_ABI = [
  'function buyTokenAMAP(address token, uint256 funds, uint256 minAmount) external payable',
  'function sellToken(address token, uint256 amount, uint256 minFunds) external',
  'function trySell(address token, uint256 amount) external view returns (address tokenManager, address quote, uint256 funds, uint256 fee)',
];

const TOKEN_MANAGER_ADDRESS = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

export interface Position {
  type: 'LONG' | 'SHORT';
  entryPrice: number;
  size: number;
  orderId: string;
  openedAt: number;
  pnl: number;
  highestPrice: number;
  lowestPrice: number;
}

export interface ExitLevel {
  priceMultiplier: number;
  sellPercentage: number;
  triggered: boolean;
}

let currentPosition: Position | null = null;
let insuranceFund: number = 0;

// For demo — take profit at 2%, stop loss at 5%
const TAKE_PROFIT_PCT = 0.02;
const STOP_LOSS_PCT = 0.05;
const TRAILING_STOP_PCT = 0.03;

// Minimum time before checking exits (30 seconds)
const MIN_HOLD_TIME_MS = 30000;

export function getCurrentPosition(): Position | null {
  return currentPosition;
}

export function getInsuranceFund(): number {
  return insuranceFund;
}

export async function openPosition(
  action: 'LONG' | 'SHORT',
  currentPrice: number,
  analysis: AnalysisResult
): Promise<boolean> {
  try {
    if (currentPosition) {
      console.log('[HEDGER] Position already open — skipping');
      return false;
    }

    if (currentPrice === 0) {
      console.log('[HEDGER] Price is 0 — cannot open position');
      return false;
    }

    console.log(`[HEDGER] 📈 Opening ${action} at $${currentPrice}`);
    console.log(`[HEDGER] Reason: ${analysis.reason}`);
    console.log(`[HEDGER] Confidence: ${analysis.confidence}%`);

    currentPosition = {
      type: action,
      entryPrice: currentPrice,
      size: 100,
      orderId: `ORDER_${Date.now()}`,
      openedAt: Date.now(),
      pnl: 0,
      highestPrice: currentPrice,
      lowestPrice: currentPrice,
    };

    console.log(`[HEDGER] ✅ ${action} position opened @ $${currentPrice}`);
    console.log(`[HEDGER] Take Profit: +${TAKE_PROFIT_PCT * 100}% | Stop Loss: -${STOP_LOSS_PCT * 100}%`);
    return true;

  } catch (error) {
    console.error('[HEDGER] Failed to open position:', error);
    return false;
  }
}

export async function closePosition(
  currentPrice: number,
  reason: string
): Promise<boolean> {
  try {
    if (!currentPosition) {
      console.log('[HEDGER] No position to close');
      return false;
    }

    const pnlPct = currentPosition.type === 'LONG'
      ? (currentPrice - currentPosition.entryPrice) / currentPosition.entryPrice
      : (currentPosition.entryPrice - currentPrice) / currentPosition.entryPrice;

    const pnlUSDC = pnlPct * currentPosition.size;

    console.log(`\n[HEDGER] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`[HEDGER] Closing ${currentPosition.type} position`);
    console.log(`[HEDGER] Entry: $${currentPosition.entryPrice.toFixed(8)}`);
    console.log(`[HEDGER] Exit:  $${currentPrice.toFixed(8)}`);
    console.log(`[HEDGER] PnL:   ${pnlUSDC >= 0 ? '+' : ''}$${pnlUSDC.toFixed(4)} USDC (${(pnlPct * 100).toFixed(2)}%)`);
    console.log(`[HEDGER] Reason: ${reason}`);

    if (pnlUSDC > 0) {
      insuranceFund += pnlUSDC;
      console.log(`[HEDGER] 💰 Insurance Fund: $${insuranceFund.toFixed(4)} USDC`);
    }

    console.log(`[HEDGER] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    currentPosition = null;
    return true;

  } catch (error) {
    console.error('[HEDGER] Failed to close position:', error);
    return false;
  }
}

export async function checkTrailingStop(currentPrice: number): Promise<boolean> {
  if (!currentPosition) return false;

  // Don't check exits too early
  const holdTime = Date.now() - currentPosition.openedAt;
  if (holdTime < MIN_HOLD_TIME_MS) {
    console.log(`[HEDGER] Position too new — holding for ${Math.round((MIN_HOLD_TIME_MS - holdTime) / 1000)}s more`);
    return false;
  }

  // Update highest/lowest price for trailing stop
  if (currentPosition.type === 'LONG') {
    if (currentPrice > currentPosition.highestPrice) {
      currentPosition.highestPrice = currentPrice;
    }
  } else {
    if (currentPrice < currentPosition.lowestPrice) {
      currentPosition.lowestPrice = currentPrice;
    }
  }

  const pnlPct = currentPosition.type === 'LONG'
    ? (currentPrice - currentPosition.entryPrice) / currentPosition.entryPrice
    : (currentPosition.entryPrice - currentPrice) / currentPosition.entryPrice;

  // Update PnL
  currentPosition.pnl = pnlPct * currentPosition.size;

  console.log(`[HEDGER] Position: ${currentPosition.type} | PnL: ${pnlPct >= 0 ? '+' : ''}${(pnlPct * 100).toFixed(2)}% | TP: +${TAKE_PROFIT_PCT * 100}% | SL: -${STOP_LOSS_PCT * 100}%`);

  // Take profit
  if (pnlPct >= TAKE_PROFIT_PCT) {
    console.log(`[HEDGER] 🎯 TAKE PROFIT HIT at +${(pnlPct * 100).toFixed(2)}%`);
    await closePosition(currentPrice, `Take profit triggered at +${(pnlPct * 100).toFixed(2)}%`);
    return true;
  }

  // Hard stop loss
  if (pnlPct <= -STOP_LOSS_PCT) {
    console.log(`[HEDGER] 🛑 STOP LOSS HIT at ${(pnlPct * 100).toFixed(2)}%`);
    await closePosition(currentPrice, `Stop loss triggered at ${(pnlPct * 100).toFixed(2)}%`);
    return true;
  }

  // Trailing stop — only when in profit
  if (pnlPct > 0) {
    const trailingPnl = currentPosition.type === 'LONG'
      ? (currentPrice - currentPosition.highestPrice) / currentPosition.highestPrice
      : (currentPosition.lowestPrice - currentPrice) / currentPosition.lowestPrice;

    if (trailingPnl < -TRAILING_STOP_PCT) {
      console.log(`[HEDGER] 🔄 TRAILING STOP HIT`);
      await closePosition(currentPrice, 'Trailing stop triggered — locking in profits');
      return true;
    }
  }

  return false;
}

export async function sellSpotTokens(
  tokenAddress: string,
  userWallet: string,
  percentage: number
): Promise<boolean> {
  try {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, agentWallet);
    const tokenManager = new ethers.Contract(TOKEN_MANAGER_ADDRESS, TOKEN_MANAGER_ABI, agentWallet);
    const balance = await tokenContract.balanceOf(userWallet);
    const amountToSell = balance * BigInt(percentage) / BigInt(100);
    if (amountToSell === BigInt(0)) return false;
    const allowance = await tokenContract.allowance(userWallet, TOKEN_MANAGER_ADDRESS);
    if (allowance < amountToSell) {
      const approveTx = await tokenContract.approve(TOKEN_MANAGER_ADDRESS, ethers.MaxUint256);
      await approveTx.wait();
    }
    const quote = await tokenManager.trySell(tokenAddress, amountToSell);
    const minFunds = quote.funds * BigInt(95) / BigInt(100);
    const tx = await tokenManager.sellToken(tokenAddress, amountToSell, minFunds);
    const receipt = await tx.wait();
    console.log(`[HEDGER] ✅ Spot sell executed: ${receipt.hash}`);
    return true;
  } catch (error) {
    console.error('[HEDGER] Spot sell failed:', error);
    return false;
  }
}

export async function buySpotTokens(
  tokenAddress: string,
  bnbAmount: string
): Promise<boolean> {
  try {
    const tokenManager = new ethers.Contract(TOKEN_MANAGER_ADDRESS, TOKEN_MANAGER_ABI, agentWallet);
    const funds = ethers.parseEther(bnbAmount);
    const tx = await tokenManager.buyTokenAMAP(tokenAddress, funds, BigInt(0), { value: funds });
    const receipt = await tx.wait();
    console.log(`[HEDGER] ✅ Spot buy executed: ${receipt.hash}`);
    return true;
  } catch (error) {
    console.error('[HEDGER] Spot buy failed:', error);
    return false;
  }
}

export async function emergencyExit(currentPrice: number): Promise<void> {
  console.log('[HEDGER] 🚨 EMERGENCY EXIT TRIGGERED');
  if (currentPosition) {
    await closePosition(currentPrice, 'Emergency exit by user');
  }
  console.log('[HEDGER] All positions closed. Waiting for user to reactivate.');
}
