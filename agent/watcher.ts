import dotenv from 'dotenv';
dotenv.config();

export interface TokenData {
  address: string;
  name: string;
  price: number;
  priceChange5m: number;
  priceChange1h: number;
  volume5m: number;
  holders: number;
  marketCap: number;
  bondingCurveProgress: number;
  timestamp: number;
}

const priceHistory: Map<string, number[]> = new Map();

export async function getTokenData(tokenAddress: string): Promise<TokenData> {
  try {
    // DexScreener as primary source
    const dexResponse = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`
    );
    const dexData = await dexResponse.json() as any;
    const pair = dexData?.pairs?.[0];

    if (pair) {
      const price = parseFloat(pair.priceUsd || '0');

      if (!priceHistory.has(tokenAddress)) {
        priceHistory.set(tokenAddress, []);
      }
      const history = priceHistory.get(tokenAddress)!;
      history.push(price);
      if (history.length > 12) history.shift();

      return {
        address: tokenAddress,
        name: pair.baseToken?.name || 'Unknown',
        price,
        priceChange5m: parseFloat(pair.priceChange?.m5 || '0'),
        priceChange1h: parseFloat(pair.priceChange?.h1 || '0'),
        volume5m: parseFloat(pair.volume?.m5 || '0'),
        holders: 0,
        marketCap: parseFloat(pair.marketCap || '0'),
        bondingCurveProgress: 0,
        timestamp: Date.now()
      };
    }

    // Fallback to Four.meme
    const response = await fetch(
      'https://four.meme/meme-api/v1/public/token/search',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenAddress, pageSize: 1, pageNum: 1 })
      }
    );
    const data = await response.json() as any;
    const token = data?.data?.list?.[0];

    if (token) {
      const price = parseFloat(token.price || '0');
      if (!priceHistory.has(tokenAddress)) priceHistory.set(tokenAddress, []);
      const history = priceHistory.get(tokenAddress)!;
      history.push(price);
      if (history.length > 12) history.shift();

      return {
        address: tokenAddress,
        name: token.tokenName || 'Unknown',
        price,
        priceChange5m: history.length >= 2 ? ((price - history[history.length - 2]) / (history[history.length - 2] || 1)) * 100 : 0,
        priceChange1h: history.length >= 12 ? ((price - history[0]) / (history[0] || 1)) * 100 : 0,
        volume5m: parseFloat(token.volume24h || '0'),
        holders: parseInt(token.holderCount || '0'),
        marketCap: parseFloat(token.marketCap || '0'),
        bondingCurveProgress: parseFloat(token.progress || '0'),
        timestamp: Date.now()
      };
    }

    throw new Error('Token not found');

  } catch (error) {
    console.error('[WATCHER] Error fetching token data:', error);
    throw error;
  }
}

export async function watchToken(
  tokenAddress: string,
  onData: (data: TokenData) => void,
  intervalMs: number = 10000
) {
  console.log(`[WATCHER] Starting watch on ${tokenAddress}`);
  console.log(`[WATCHER] Polling every ${intervalMs / 1000}s`);

  const initialData = await getTokenData(tokenAddress);
  onData(initialData);

  setInterval(async () => {
    try {
      const data = await getTokenData(tokenAddress);
      console.log(`[WATCHER] ${data.name} | Price: $${data.price} | 5m: ${data.priceChange5m.toFixed(2)}%`);
      onData(data);
    } catch (error) {
      console.error('[WATCHER] Poll error:', error);
    }
  }, intervalMs);
}