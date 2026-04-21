import OpenAI from 'openai';
import dotenv from 'dotenv';
import { TokenData } from './watcher';
dotenv.config();

const dgrid = new OpenAI({
  baseURL: 'https://api.dgrid.ai/v1',
  apiKey: process.env.DGRID_API_KEY,
});

export interface SignalScore {
  name: string;
  score: number;
  weight: number;
  detail: string;
}

export interface AnalysisResult {
  score: number;
  grade: 'GREEN' | 'AMBER' | 'RED';
  action: 'LONG' | 'SHORT' | 'HOLD' | 'CLOSE';
  confidence: number;
  reason: string;
  signals: SignalScore[];
  timestamp: number;
}

// Signal 1: Price Momentum (5m) — HIGH weight
function scorePriceMomentum(data: TokenData): SignalScore {
  const c = data.priceChange5m;
  let score = 5;
  let detail = '';

  if (c > 20) { score = 10; detail = 'Explosive pump +20%'; }
  else if (c > 10) { score = 9; detail = 'Strong pump detected'; }
  else if (c > 5) { score = 7; detail = 'Bullish momentum'; }
  else if (c > 1) { score = 6; detail = 'Slight upward movement'; }
  else if (c < -20) { score = 1; detail = 'Severe crash -20%'; }
  else if (c < -10) { score = 2; detail = 'Heavy sell pressure'; }
  else if (c < -5) { score = 3; detail = 'Bearish momentum'; }
  else if (c < -1) { score = 4; detail = 'Slight downward movement'; }
  else { score = 5; detail = 'Price neutral'; }

  return { name: 'Price Momentum', score, weight: 4, detail };
}

// Signal 2: 1h Trend — HIGH weight
function scoreTrend(data: TokenData): SignalScore {
  const c = data.priceChange1h;
  let score = 5;
  let detail = '';

  if (c > 100) { score = 10; detail = '100%+ 1h gain'; }
  else if (c > 50) { score = 9; detail = 'Strong 1h uptrend'; }
  else if (c > 20) { score = 7; detail = 'Positive trend'; }
  else if (c > 5) { score = 6; detail = 'Slight uptrend'; }
  else if (c < -50) { score = 1; detail = 'Severe downtrend — likely rug'; }
  else if (c < -20) { score = 2; detail = 'Strong downtrend'; }
  else if (c < -5) { score = 3; detail = 'Bearish 1h trend'; }
  else { score = 5; detail = 'Trend neutral'; }

  return { name: '1h Trend', score, weight: 3, detail };
}

// Signal 3: Volume — MEDIUM weight
function scoreVolume(data: TokenData): SignalScore {
  const v = data.volume5m;
  let score = 5;
  let detail = '';

  if (v > 100000) { score = 10; detail = 'Massive volume'; }
  else if (v > 50000) { score = 9; detail = 'Very high volume'; }
  else if (v > 10000) { score = 7; detail = 'Good volume'; }
  else if (v > 1000) { score = 5; detail = 'Moderate volume'; }
  else if (v > 100) { score = 3; detail = 'Low volume'; }
  else { score = 2; detail = 'Near zero volume'; }

  return { name: 'Volume', score, weight: 3, detail };
}

// Signal 4: Market Cap — MEDIUM weight
function scoreMarketCap(data: TokenData): SignalScore {
  const mc = data.marketCap;
  let score = 5;
  let detail = '';

  if (mc > 5000000) { score = 9; detail = 'Large cap meme'; }
  else if (mc > 1000000) { score = 8; detail = 'Strong market cap'; }
  else if (mc > 100000) { score = 6; detail = 'Growing market cap'; }
  else if (mc > 10000) { score = 5; detail = 'Small cap'; }
  else if (mc > 1000) { score = 3; detail = 'Micro cap'; }
  else { score = 2; detail = 'Near zero market cap'; }

  return { name: 'Market Cap', score, weight: 2, detail };
}

// Signal 5: Bonding Curve — LOW weight for graduated tokens
function scoreBondingCurve(data: TokenData): SignalScore {
  const progress = data.bondingCurveProgress;
  let score = 5;
  let detail = '';

  // If bondingCurveProgress is 0 it means token is graduated or data unavailable
  // Treat 0 as neutral not bad
  if (progress === 0) { score = 6; detail = 'Graduated or data unavailable'; }
  else if (progress >= 80) { score = 9; detail = 'Near graduation'; }
  else if (progress >= 50) { score = 7; detail = 'Good progress'; }
  else if (progress >= 20) { score = 5; detail = 'Early stage'; }
  else { score = 4; detail = 'Very early stage'; }

  return { name: 'Bonding Curve', score, weight: 1, detail };
}

// Signal 6: Holders — LOW weight, DexScreener doesn't return this
function scoreHolders(data: TokenData): SignalScore {
  const h = data.holders;
  let score = 5;
  let detail = '';

  // If 0 it means data unavailable from DexScreener — treat as neutral
  if (h === 0) { score = 5; detail = 'Holder data unavailable'; }
  else if (h > 5000) { score = 10; detail = 'Massive holder base'; }
  else if (h > 1000) { score = 8; detail = 'Strong holder base'; }
  else if (h > 500) { score = 7; detail = 'Good distribution'; }
  else if (h > 100) { score = 5; detail = 'Growing community'; }
  else if (h > 10) { score = 3; detail = 'Very few holders'; }
  else { score = 2; detail = 'Almost no holders'; }

  return { name: 'Holders', score, weight: 1, detail };
}

// Signal 7: Market Context (BNB)
async function scoreMarketContext(): Promise<SignalScore> {
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd&include_24hr_change=true'
    );
    const data = await response.json() as any;
    const bnbChange = data?.binancecoin?.usd_24h_change || 0;
    let score = 5;
    let detail = '';

    if (bnbChange > 5) { score = 8; detail = 'BNB bullish'; }
    else if (bnbChange > 0) { score = 6; detail = 'BNB slightly up'; }
    else if (bnbChange < -5) { score = 3; detail = 'BNB bearish'; }
    else { score = 4; detail = 'BNB slightly down'; }

    return { name: 'Market Context', score, weight: 1, detail };
  } catch {
    return { name: 'Market Context', score: 5, weight: 1, detail: 'Unavailable' };
  }
}

// Signal 8: Liquidity
function scoreLiquidity(data: TokenData): SignalScore {
  const liquidity = data.marketCap * 0.15;
  let score = 5;
  let detail = '';

  if (liquidity > 100000) { score = 10; detail = 'Very deep liquidity'; }
  else if (liquidity > 50000) { score = 8; detail = 'Deep liquidity'; }
  else if (liquidity > 10000) { score = 6; detail = 'Good liquidity'; }
  else if (liquidity > 1000) { score = 5; detail = 'Moderate liquidity'; }
  else if (liquidity > 100) { score = 3; detail = 'Thin liquidity'; }
  else { score = 2; detail = 'No liquidity'; }

  return { name: 'Liquidity', score, weight: 1, detail };
}

function computeWeightedScore(signals: SignalScore[]): number {
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const weightedSum = signals.reduce((sum, s) => sum + (s.score * s.weight), 0);
  return (weightedSum / (totalWeight * 10)) * 100;
}

function getGrade(score: number): 'GREEN' | 'AMBER' | 'RED' {
  if (score >= 40) return 'GREEN';
  if (score >= 35) return 'AMBER';
  return 'RED';
}

function getAction(grade: string, currentPosition: string | null): 'LONG' | 'SHORT' | 'HOLD' | 'CLOSE' {
  if (grade === 'GREEN') return 'LONG';
  if (grade === 'RED') return 'SHORT';
  if (grade === 'AMBER' && currentPosition) return 'CLOSE';
  return 'HOLD';
}

export async function analyzeToken(
  data: TokenData,
  currentPosition: string | null = null
): Promise<AnalysisResult> {
  try {
    const signals: SignalScore[] = [
      scorePriceMomentum(data),
      scoreTrend(data),
      scoreVolume(data),
      scoreMarketCap(data),
      scoreBondingCurve(data),
      scoreHolders(data),
      await scoreMarketContext(),
      scoreLiquidity(data),
    ];

    const score = computeWeightedScore(signals);
    const grade = getGrade(score);
    const action = getAction(grade, currentPosition);

    try {
      const signalSummary = signals.map(s => `${s.name}: ${s.score}/10 (${s.detail})`).join('\n');
      const response = await dgrid.chat.completions.create({
        model: 'anthropic/claude-sonnet-4.6',
        messages: [
          { role: 'system', content: 'You are SENTINEL, an autonomous meme coin protection agent. Return ONLY a JSON object. No extra text.' },
          { role: 'user', content: `Analyze this meme coin:\nToken: ${data.name}\nPrice: $${data.price}\n5m change: ${data.priceChange5m}%\n1h change: ${data.priceChange1h}%\nGrade: ${grade} (${score.toFixed(0)}/100)\n\nSignals:\n${signalSummary}\n\nReturn JSON only:\n{\n  "reason": "one sentence explaining the key risk or opportunity based on the actual signals",\n  "confidence": 0-100\n}` }
        ]
      });
      const content = response.choices[0].message.content || '';
      const cleaned = content.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return { score, grade, action, confidence: parsed.confidence, reason: parsed.reason, signals, timestamp: Date.now() };
    } catch {
      const topSignal = [...signals].sort((a, b) => (b.weight * Math.abs(b.score - 5)) - (a.weight * Math.abs(a.score - 5)))[0];
      return { score, grade, action, confidence: grade === 'AMBER' ? 55 : 75, reason: `${grade} signal — ${topSignal.name}: ${topSignal.detail}`, signals, timestamp: Date.now() };
    }
  } catch (error) {
    console.error('[ANALYZER] Error:', error);
    throw error;
  }
}
