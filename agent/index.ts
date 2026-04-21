import dotenv from 'dotenv';
dotenv.config();

import { watchToken, TokenData } from './watcher';
import { analyzeToken } from './analyzer';
import {
  openPosition,
  closePosition,
  checkTrailingStop,
  getCurrentPosition,
  getInsuranceFund,
  emergencyExit,
} from './hedger';

const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || '';
let isRunning = true;

async function onTokenData(data: TokenData) {
  if (!isRunning) return;
  if (data.price === 0) return;

  try {
    const position = getCurrentPosition();

    if (position) {
      const stopped = await checkTrailingStop(data.price);
      if (stopped) return;
    }

    const analysis = await analyzeToken(data, position?.type || null);

    console.log(`[SENTINEL] ${data.name} | $${data.price} | ${analysis.grade} ${analysis.score.toFixed(0)}/100 | ${analysis.action} | ${analysis.confidence}%`);
    console.log(`[SENTINEL] Insurance Fund: $${getInsuranceFund().toFixed(4)}`);

    if (!position) {
      if (analysis.action === 'LONG') {
        await openPosition('LONG', data.price, analysis);
      } else if (analysis.action === 'SHORT') {
        await openPosition('SHORT', data.price, analysis);
      }
    } else {
      if (
        (position.type === 'LONG' && analysis.action === 'SHORT') ||
        (position.type === 'SHORT' && analysis.action === 'LONG')
      ) {
        await closePosition(data.price, 'Signal reversal');
        await openPosition(analysis.action as 'LONG' | 'SHORT', data.price, analysis);
      }
    }
  } catch (error) {
    console.error('[SENTINEL] Error:', error);
  }
}

async function main() {
  if (!TOKEN_ADDRESS) {
    console.log('[SENTINEL] No token — running via server.ts only');
    return;
  }

  process.on('SIGINT', async () => {
    isRunning = false;
    await emergencyExit(0);
    process.exit(0);
  });

  await watchToken(TOKEN_ADDRESS, onTokenData, 10000);
}

main().catch(console.error);