⚡ SENTINEL — Instant Long/Short Markets for Meme Coins

«An autonomous system that enables immediate LONG/SHORT trading for newly launched meme coins using AI-driven decision-making and permissionless perpetual markets.»

Hackathon: Four.meme AI Sprint
Network: BNB Chain (Testnet)
Live Demo: https://sentinel-sigma-lac.vercel.app
Agent API: https://sentinel-agent-production-0b37.up.railway.app
Builder:   Web3smallie

---

🧠 The Problem

When a meme coin launches on Four.meme:

- Users can only buy (long exposure)
- There is no way to short or hedge
- Risk is entirely one-sided

This leads to extreme volatility, inability to protect capital, and poor trading infrastructure compared to mature assets.

---

💥 The Solution

SENTINEL introduces instant two-sided markets (LONG/SHORT) for meme coins the moment they launch.

«For the first time, a meme coin can be traded both directions (LONG/SHORT) immediately after launch — without waiting for listings or liquidity providers.»

It combines:

- Real-time market monitoring via DexScreener
- AI-driven 8-signal scoring engine
- Permissionless perp market creation on BSC
- Autonomous position management with take profit and stop loss

«Result: Meme coins become tradeable like professional assets from the moment they launch.»

---

🏆 Key Innovation

SENTINEL is not just a trading bot.

It demonstrates a new capability — permissionless, instant derivatives markets for newly launched tokens.

Using a PerpFactory architecture, any token can immediately support:

- LONG positions (bullish)
- SHORT positions (bearish)

There are two types of users:

- Holders — protect their meme coin holdings with autonomous AI hedging
- Creators — protect their token and share a live broadcast link with their community as proof of professional AI hedging

---

🏗️ Architecture

Frontend (Next.js Dashboard — Vercel)
            ↓
System Layer (Node.js/TypeScript — Railway)
  ┌──────────────────────────────────┐
  │  Watcher │ Analyzer │  Hedger   │
  │ DexScreen│ 8-Signal │  TP/SL/   │
  │   price  │ + dGrid  │ Trailing  │
  └──────────────────────────────────┘
            ↓
Smart Contracts (BSC Testnet)
  SentinelFactory │ UserVault │ PerpFactory

---

📦 Smart Contracts

Contract| Address
SentinelFactory| "0x42f77df082583d37bb4e1fb9b1b40375949a6cf5"
PerpFactory| "0x859604798e11b7df00c5e955adfba62395fd4887"
USDC (Testnet)| "0x4B8eed87b61023F5BEcCeBd2868C058FEe6B7Ac7"

---

⚙️ Core Components

1️⃣ Watcher

Fetches real-time data from DexScreener and Four.meme every 10 seconds. Tracks price, volume, market cap, liquidity, and holder growth.

2️⃣ Analyzer — 8-Signal AI Scoring Engine

Signal| Weight| Description
Price Momentum| 4| 5-minute price change
1h Trend| 3| Hourly price direction
Volume| 3| Trading activity
Market Cap| 2| Token size
Bonding Curve| 1| Four.meme launch progression
Holders| 1| Adoption signal
Market Context| 1| BNB 24h trend
Liquidity| 1| Depth proxy

Score Interpretation:

- Score ≥ 40 → LONG (bullish)
- Score 35–40 → HOLD / WAIT
- Score < 35 → SHORT (bearish)

After scoring, the system calls dGrid AI (powered by Claude) to generate a human-readable explanation of the market conditions, displayed live on the dashboard.

3️⃣ Hedger — Execution Engine

Parameter| Value
Take Profit| +2% from entry
Stop Loss| -5% from entry
Trailing Stop| -3% from peak
Min Hold Time| 30 seconds

Adaptive Logic:

IF loss > 5%        → EXIT (stop loss)
IF profit > 2%      → TAKE PROFIT
IF signal flips     → EXIT + REVERSE

Profits from successful trades flow to the user's Insurance Fund — a running balance displayed live on the dashboard.

4️⃣ PerpFactory — Core Innovation

Custom smart contract that:

- Creates perpetual markets for any BSC token instantly
- Supports LONG and SHORT positions
- Tracks entry price, collateral, and PnL on-chain

«This simulates the permissionless market creation model expected in MYX Finance V2.»

5️⃣ UserVault

Each user gets an isolated on-chain collateral vault, controlled by the SENTINEL system wallet. Stores USDC, tracks system status, and records the hedged token and entry price.

---

📈 Example Trading Flows

Scenario A — Bullish Token:
Token launches → Strong momentum → System opens LONG → Price rises +2% → Take profit → Insurance Fund grows

Scenario B — Bearish Token:
Weak liquidity + dump → System opens SHORT → Price drops → Take profit → Insurance Fund grows

Scenario C — Wrong Call:
SHORT opened → Price pumps → Stop loss at -5% → EXIT → Re-evaluates → Opens LONG → Recovery

«This demonstrates adaptive intelligence, not blind automation.»

---

🖥️ Frontend Dashboard

Built with Next.js on Vercel. Features:

- Two-column layout — candlestick chart left, AI reasoning + live feed right
- Real-time candlestick chart — powered by lightweight-charts v4
- Live Activity Feed — every decision made by the system shown in real time
- Position Panel — Entry, Mark Price, PnL, Take Profit, Stop Loss, Liquidation Price
- Insurance Fund — live accumulated profits display
- Wallet Connect — RainbowKit with BSC Testnet support
- Broadcast Page — shareable read-only link for token creators ("/broadcast?token=0x...")

---

📡 API Endpoints

Endpoint| Method| Description
"/api/status"| GET| Token data, AI analysis, position, insurance fund
"/api/usdc-balance/:address"| GET| Real USDC balance from BSC testnet
"/api/vault/:address"| GET| User vault info
"/api/wallet-tokens/:address"| GET| User's Four.meme holdings
"/api/set-token"| POST| Set token to watch
"/api/create-market"| POST| Create permissionless perp market
"/api/open-position"| POST| Open perp position
"/api/close-position"| POST| Close perp position
"/api/emergency-exit"| POST| Emergency close all positions

---

🔮 MYX Finance V2 Integration

SENTINEL is designed with MYX Finance V2 as its natural infrastructure layer.

The "PerpFactory" contract we built is a reference implementation of the permissionless perp market factory that MYX V2 will introduce.

When MYX V2 launches:

1. SENTINEL migrates from our custom PerpFactory to native MYX V2 perp infrastructure
2. Every meme coin on Four.meme gets access to deep institutional liquidity for hedging
3. Users benefit from MYX's existing liquidity pools and competitive funding rates
4. The system upgrade is a drop-in replacement, no frontend or logic changes needed

«SENTINEL demonstrates exactly how MYX V2 can turn any newly launched token into a fully tradable derivatives market within minutes.»

---

🛠️ Tech Stack

Layer| Technology
Frontend| Next.js 14, TailwindCSS, RainbowKit, wagmi, viem
Charts| lightweight-charts v4.1.3
System| Node.js, TypeScript, ethers.js v6
AI| dGrid AI API (Claude Sonnet)
Price Data| DexScreener API
Contracts| Solidity, Hardhat
Frontend Hosting| Vercel
System Hosting| Railway
Chain| BNB Smart Chain (Testnet)

---

🧪 Hackathon Notes

- Built on BNB Chain Testnet (confirmed acceptable by Four.meme admin)
- PerpFactory built as MYX V2 reference implementation since permissionless markets were not yet live at  submission
- Insurance Fund reached $85+ USDC from successful autonomous trades during testing
- System successfully opened and closed multiple LONG positions with take profit confirmed on BSCScan

---

🏁 Conclusion

SENTINEL transforms meme coin trading from:

one-sided speculation → two-sided autonomous markets

«In today’s market, every new token is a gamble — SENTINEL turns it into a trade.»

It is not just an agent; it is an autonomous market layer for newly launched assets, ready to plug into MYX V2 the moment permissionless perp markets go live.


📄 License

MIT