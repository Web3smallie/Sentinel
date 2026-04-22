'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Shield, Activity, TrendingUp, TrendingDown } from 'lucide-react';

interface AgentData {
  price: number;
  priceChange5m: number;
  grade: string;
  score: number;
  action: string;
  confidence: number;
  reason: string;
  signals: any[];
  insuranceFund: number;
  position: string;
  positionData: any;
  perpMarketId: number;
}

interface FeedItem {
  time: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

const API = 'https://sentinel-agent-production-0b37.up.railway.app';
const TAKE_PROFIT_PCT = 0.02;
const STOP_LOSS_PCT = 0.05;

function BroadcastContent() {
  const searchParams = useSearchParams();
  const tokenAddress = searchParams.get('token') || '';
  const [agentData, setAgentData] = useState<AgentData | null>(null);
  const [tokenName, setTokenName] = useState('');
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [prevPosition, setPrevPosition] = useState('NONE');
  const [prevFund, setPrevFund] = useState(0);
  const [notFound, setNotFound] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<any>(null);
  const candleSeries = useRef<any>(null);

  const ts = () => { const n = new Date(); return `${n.getHours()}:${String(n.getMinutes()).padStart(2,'0')}:${String(n.getSeconds()).padStart(2,'0')}`; };
  const addFeed = (message: string, type: FeedItem['type'] = 'info') => setFeed(f => [...f.slice(-100), { time: ts(), message, type }]);

  useEffect(() => { if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight; }, [feed]);

  // Fetch token name from DexScreener
  useEffect(() => {
    if (!tokenAddress) return;
    fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`)
      .then(r => r.json())
      .then(d => {
        const pair = d?.pairs?.[0];
        if (pair) setTokenName(pair.baseToken?.name || 'Unknown Token');
      })
      .catch(() => {});
  }, [tokenAddress]);

  // Init chart
  useEffect(() => {
    if (!chartRef.current || !tokenAddress) return;
    const initChart = async () => {
      try {
        const { createChart } = await import('lightweight-charts');
        if (chartInstance.current) chartInstance.current.remove();
        const chart = createChart(chartRef.current!, {
          width: chartRef.current!.clientWidth,
          height: chartRef.current!.clientHeight,
          layout: { background: { color: '#0a0a0a' }, textColor: '#9ca3af' },
          grid: { vertLines: { color: '#1a1a2e' }, horzLines: { color: '#1a1a2e' } },
          crosshair: { mode: 1 },
          rightPriceScale: { borderColor: '#374151' },
          timeScale: { borderColor: '#374151', timeVisible: true },
        });
        const series = chart.addCandlestickSeries({
          upColor: '#4ade80', downColor: '#f87171',
          borderUpColor: '#4ade80', borderDownColor: '#f87171',
          wickUpColor: '#4ade80', wickDownColor: '#f87171',
        });
        chartInstance.current = chart;
        candleSeries.current = series;
        try {
          const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
          const d = await r.json();
          const pair = d?.pairs?.[0];
          if (pair) {
            const now = Math.floor(Date.now() / 1000);
            const base = parseFloat(pair.priceUsd || '0');
            const candles = Array.from({ length: 60 }, (_, i) => {
              const t = (now - (60 - i) * 30) as any;
              const v = base * 0.015;
              const o = base + (Math.random() - 0.5) * v;
              const c = base + (Math.random() - 0.5) * v;
              return { time: t, open: o, high: Math.max(o, c) + Math.random() * v * 0.3, low: Math.min(o, c) - Math.random() * v * 0.3, close: c };
            });
            series.setData(candles);
          }
        } catch {}
      } catch {}
    };
    initChart();
    return () => { if (chartInstance.current) { chartInstance.current.remove(); chartInstance.current = null; } };
  }, [tokenAddress]);

  // Update chart
  useEffect(() => {
    if (!candleSeries.current || !agentData?.price) return;
    const now = Math.floor(Date.now() / 1000);
    const p = agentData.price;
    const v = p * 0.003;
    candleSeries.current.update({ time: now as any, open: p - v, high: p + v * 1.5, low: p - v * 1.5, close: p });
  }, [agentData?.price]);

  // Poll agent status
  useEffect(() => {
    if (!tokenAddress) return;

    // First set the token on the server
    fetch(`${API}/api/set-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenAddress, userWallet: '' })
    }).catch(() => {});

    const fetchData = async () => {
      try {
        const res = await fetch(`${API}/api/status`);
        const data = await res.json();
        if (!data.success) { setNotFound(true); return; }
        setNotFound(false);

        const { token, analysis, position, insuranceFund, perpMarketId } = data.data;

        setAgentData({
          price: token.price, priceChange5m: token.priceChange5m,
          grade: analysis.grade, score: Math.round(analysis.score),
          action: analysis.action, confidence: analysis.confidence,
          reason: analysis.reason, signals: analysis.signals,
          insuranceFund, position: position?.type || 'NONE',
          positionData: position, perpMarketId,
        });

        // Live feed
        addFeed(`[SENTINEL] ${token.name} | $${token.price.toFixed(7)} | ${analysis.grade} ${Math.round(analysis.score)}/100 | ${analysis.action} | ${analysis.confidence}%`, 'info');
        if (position) {
          const pnlPct = position.type === 'LONG'
            ? ((token.price - position.entryPrice) / position.entryPrice * 100)
            : ((position.entryPrice - token.price) / position.entryPrice * 100);
          addFeed(`[HEDGER] Position: ${position.type} | PnL: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% | TP: +${TAKE_PROFIT_PCT * 100}% | SL: -${STOP_LOSS_PCT * 100}%`, pnlPct >= 0 ? 'success' : 'warning');
        }
        if (position?.type && prevPosition === 'NONE') {
          addFeed(`[SENTINEL] 📈 ${position.type} opened @ $${position.entryPrice.toFixed(8)}`, 'success');
          addFeed(`[SENTINEL] 🎯 TP: $${(position.entryPrice * (1 + TAKE_PROFIT_PCT)).toFixed(8)} | SL: $${(position.entryPrice * (1 - STOP_LOSS_PCT)).toFixed(8)}`, 'info');
        }
        if (!position && prevPosition !== 'NONE') {
          const profit = insuranceFund - prevFund;
          addFeed(`[HEDGER] Position closed | ${profit > 0 ? `Profit: +$${profit.toFixed(4)}` : 'Loss recorded'}`, profit > 0 ? 'success' : 'error');
          addFeed(`[SENTINEL] 💰 Insurance Fund: $${insuranceFund.toFixed(4)} USDC`, 'success');
        }
        setPrevPosition(position?.type || 'NONE');
        setPrevFund(insuranceFund);
      } catch { setNotFound(true); }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [tokenAddress, prevPosition, prevFund]);

  const gradeColor = agentData?.grade === 'GREEN' ? 'text-green-400' : agentData?.grade === 'RED' ? 'text-red-400' : 'text-yellow-400';
  const gradeBg = agentData?.grade === 'GREEN' ? 'bg-green-400/10 border-green-400/30' : agentData?.grade === 'RED' ? 'bg-red-400/10 border-red-400/30' : 'bg-yellow-400/10 border-yellow-400/30';
  const entry = agentData?.positionData?.entryPrice || 0;
  const cur = agentData?.price || 0;
  const pnlPct = agentData?.position !== 'NONE' && entry > 0 ? (agentData?.position === 'LONG' ? (cur - entry) / entry : (entry - cur) / entry) * 100 : 0;
  const tpPrice = entry * (1 + TAKE_PROFIT_PCT);
  const slPrice = agentData?.position === 'LONG' ? entry * (1 - STOP_LOSS_PCT) : entry * (1 + STOP_LOSS_PCT);
  const liqPrice = agentData?.position === 'LONG' ? entry * 0.9 : entry * 1.1;
  const hasPosition = agentData?.position && agentData.position !== 'NONE';
  const feedColor = (t: FeedItem['type']) => t === 'success' ? 'text-green-400' : t === 'error' ? 'text-red-400' : t === 'warning' ? 'text-yellow-400' : 'text-gray-400';

  if (!tokenAddress) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center font-mono">
        <div className="text-center">
          <Shield className="text-green-400 mx-auto mb-4" size={48} />
          <h1 className="text-green-400 text-2xl font-bold mb-2">SENTINEL Broadcast</h1>
          <p className="text-gray-500 text-sm">No token address provided.</p>
          <p className="text-gray-600 text-xs mt-2">URL format: /broadcast?token=0x...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-black text-white font-mono flex flex-col overflow-hidden">

      {/* TOP BAR Row 1 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800/50 bg-gray-950 shrink-0">
        <div className="flex items-center gap-3">
          <Shield className="text-green-400" size={20} />
          <div>
            <p className="text-green-400 font-bold text-base leading-none">SENTINEL</p>
            <p className="text-gray-500 text-xs">AI-Powered Perp Hedging for Meme Coins</p>
          </div>
          <div className="ml-4 px-3 py-1 bg-green-400/10 border border-green-400/30 rounded-full">
            <span className="text-green-400 text-xs font-bold">🛡️ PROTECTED BY SENTINEL</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 px-2 py-1 rounded border border-green-400/30 bg-green-400/10">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-400 text-xs font-bold">LIVE</span>
          </div>
          <span className="text-gray-600 text-xs">Read-only broadcast</span>
        </div>
      </div>

      {/* TOP BAR Row 2 */}
      <div className="flex items-center gap-5 px-4 py-2 border-b border-gray-800 bg-gray-950 shrink-0">
        <div>
          <span className="text-white font-bold text-sm">{tokenName || 'Loading...'}/USDC</span>
          <span className="text-white font-bold text-xl ml-3">${agentData?.price?.toFixed(8) || '—'}</span>
          <span className={`text-sm font-bold ml-2 ${(agentData?.priceChange5m || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {(agentData?.priceChange5m || 0) >= 0 ? '▲' : '▼'}{Math.abs(agentData?.priceChange5m || 0).toFixed(2)}% 5m
          </span>
        </div>
        <div className="h-6 w-px bg-gray-700" />
        <div className={`px-3 py-1 rounded text-xs font-bold border ${agentData?.grade === 'GREEN' ? 'text-green-400 border-green-400/30 bg-green-400/10' : agentData?.grade === 'RED' ? 'text-red-400 border-red-400/30 bg-red-400/10' : 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10'}`}>
          {agentData?.grade || 'SCANNING'} {agentData?.score || '—'}/100
        </div>
        <div className="h-6 w-px bg-gray-700" />
        <div>
          <span className="text-gray-500 text-xs">INS. FUND</span>
          <span className="text-green-400 font-bold text-sm ml-2">${(agentData?.insuranceFund || 0).toFixed(2)} USDC</span>
        </div>
        <div className="h-6 w-px bg-gray-700" />
        <div>
          <span className="text-gray-500 text-xs">TOKEN</span>
          <span className="text-gray-400 text-xs ml-2">{tokenAddress.slice(0, 8)}...{tokenAddress.slice(-6)}</span>
        </div>
        {agentData?.perpMarketId ? (
          <>
            <div className="h-6 w-px bg-gray-700" />
            <span className="text-green-400 text-xs">Perp Market #{agentData.perpMarketId}</span>
          </>
        ) : null}
      </div>

      {/* MIDDLE — Two equal columns */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT — Chart */}
        <div className="w-1/2 border-r border-gray-800">
          <div ref={chartRef} className="w-full h-full" style={{ background: '#0a0a0a' }} />
        </div>

        {/* RIGHT — AI Reasoning + Live Feed */}
        <div className="w-1/2 flex flex-col">
          <div className={`m-3 mb-2 border rounded-xl p-3 shrink-0 ${gradeBg}`}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-gray-400 text-xs font-bold">🤖 AI REASONING</p>
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${agentData?.action === 'LONG' ? 'bg-green-400/20 text-green-400' : agentData?.action === 'SHORT' ? 'bg-red-400/20 text-red-400' : 'bg-yellow-400/20 text-yellow-400'}`}>
                {agentData?.action || 'HOLD'} • {agentData?.confidence || 0}%
              </span>
            </div>
            <p className={`text-xs leading-relaxed ${gradeColor}`}>{agentData?.reason || 'Analyzing market conditions...'}</p>
          </div>

          {/* 8 Signals */}
          {agentData?.signals && agentData.signals.length > 0 && (
            <div className="mx-3 mb-2 bg-gray-900 border border-gray-800 rounded-xl p-3 shrink-0">
              <p className="text-gray-400 text-xs font-bold mb-2">8 SIGNAL BREAKDOWN</p>
              <div className="grid grid-cols-2 gap-1">
                {agentData.signals.map((signal: any, i: number) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-gray-600 text-xs w-20 shrink-0">{signal.name}</span>
                    <div className="flex-1 bg-gray-800 rounded-full h-1">
                      <div className={`h-1 rounded-full ${signal.score >= 7 ? 'bg-green-400' : signal.score >= 4 ? 'bg-yellow-400' : 'bg-red-400'}`} style={{ width: `${signal.score * 10}%` }} />
                    </div>
                    <span className={`text-xs w-4 shrink-0 ${signal.score >= 7 ? 'text-green-400' : signal.score >= 4 ? 'text-yellow-400' : 'text-red-400'}`}>{signal.score}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live Feed */}
          <div className="flex-1 mx-3 mb-3 bg-gray-950 border border-gray-800 rounded-xl flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 shrink-0">
              <Activity size={11} className="text-green-400" />
              <span className="text-gray-400 text-xs font-bold">LIVE AGENT ACTIVITY</span>
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse ml-auto" />
            </div>
            <div ref={feedRef} className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
              {feed.length === 0 ? (
                <p className="text-gray-600 text-xs text-center mt-4">Connecting to agent...</p>
              ) : (
                feed.map((item, i) => (
                  <div key={i} className="flex gap-2 text-xs py-0.5">
                    <span className="text-gray-600 shrink-0">{item.time}</span>
                    <span className={`${feedColor(item.type)} text-xs`}>{item.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* POSITION PANEL */}
      <div className="shrink-0 border-t border-gray-800 px-4 py-3">
        {hasPosition ? (
          <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
              <div className="flex items-center gap-2">
                {agentData?.position === 'LONG' ? <TrendingUp className="text-green-400" size={14} /> : <TrendingDown className="text-red-400" size={14} />}
                <span className={`font-bold text-sm ${agentData?.position === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>{agentData?.position}</span>
                <span className="text-gray-500 text-xs">10x Leverage</span>
              </div>
              <span className="text-gray-600 text-xs">AGENT MANAGED — READ ONLY</span>
            </div>
            <div className="grid grid-cols-6 divide-x divide-gray-800">
              <div className="p-3"><p className="text-gray-500 text-xs mb-1">Entry</p><p className="text-white font-bold text-xs">${entry.toFixed(8)}</p></div>
              <div className="p-3"><p className="text-gray-500 text-xs mb-1">Mark</p><p className="text-white font-bold text-xs">${cur.toFixed(8)}</p></div>
              <div className="p-3"><p className="text-gray-500 text-xs mb-1">PnL</p><p className={`font-bold text-xs ${pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>{pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%</p></div>
              <div className="p-3"><p className="text-gray-500 text-xs mb-1">Take Profit</p><p className="text-green-400 font-bold text-xs">${tpPrice.toFixed(8)}</p><p className="text-green-400 text-xs">+{TAKE_PROFIT_PCT * 100}%</p></div>
              <div className="p-3"><p className="text-gray-500 text-xs mb-1">Stop Loss</p><p className="text-red-400 font-bold text-xs">${slPrice.toFixed(8)}</p><p className="text-red-400 text-xs">-{STOP_LOSS_PCT * 100}%</p></div>
              <div className="p-3"><p className="text-gray-500 text-xs mb-1">Liq. Price</p><p className="text-orange-400 font-bold text-xs">${liqPrice.toFixed(8)}</p><p className="text-orange-400 text-xs">-10%</p></div>
            </div>
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm font-bold">No Open Position</p>
              <p className="text-gray-600 text-xs">Agent is monitoring — will open LONG/SHORT when signal triggers</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
              <span className="text-yellow-400 text-xs font-bold">SCANNING</span>
            </div>
          </div>
        )}
      </div>

      {/* BOTTOM BADGES */}
      <div className="shrink-0 border-t border-gray-800 px-4 py-2 flex items-center justify-between bg-gray-950">
        <div className="flex items-center gap-3">
          <span className="text-gray-600 text-xs">Powered by</span>
          <div className="px-3 py-1 bg-orange-500/10 border border-orange-500/20 rounded-full">
            <span className="text-orange-400 text-xs font-bold">🔥 Four.meme</span>
          </div>
          <span className="text-gray-700 text-xs">Partners</span>
          <div className="px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full">
            <span className="text-blue-400 text-xs font-bold">🤖 dGrid AI</span>
          </div>
          <div className="px-3 py-1 bg-purple-500/10 border border-purple-500/20 rounded-full">
            <span className="text-purple-400 text-xs font-bold">📈 MYX Finance</span>
          </div>
          <div className="px-3 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded-full">
            <span className="text-yellow-400 text-xs font-bold">⚡ BSC Chain</span>
          </div>
        </div>
        <div className="text-gray-600 text-xs">
          sentinel.app/broadcast?token={tokenAddress.slice(0, 8)}...{tokenAddress.slice(-6)}
        </div>
      </div>
    </div>
  );
}

export default function BroadcastPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center font-mono">
        <div className="text-center">
          <Shield className="text-green-400 mx-auto mb-4 animate-pulse" size={48} />
          <p className="text-green-400 text-sm">Loading SENTINEL broadcast...</p>
        </div>
      </div>
    }>
      <BroadcastContent />
    </Suspense>
  );
}
