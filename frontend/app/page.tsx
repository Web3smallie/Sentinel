'use client';

import { useState, useEffect, useRef } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits } from 'viem';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Shield, Power, RefreshCw, TrendingUp, TrendingDown, X, Activity } from 'lucide-react';

interface TokenHolding { address: string; name: string; symbol: string; balance: string; value: number; }
interface Position { type: string; entryPrice: number; pnl: number; openedAt: number; }
interface AgentData {
  price: number; priceChange5m: number; grade: string; score: number; action: string;
  confidence: number; reason: string; signals: any[]; insuranceFund: number;
  position: string; positionData: Position | null; perpMarketId: number; perpPositionId: number;
}
interface FeedItem { time: string; message: string; type: 'info' | 'success' | 'warning' | 'error'; }

const API = 'https://sentinel-agent-production-0b37.up.railway.app';
const USDC_ADDRESS = '0x4B8eed87b61023F5BEcCeBd2868C058FEe6B7Ac7' as `0x${string}`;
const VAULT_ADDRESS = '0xf595E4d6645545bbf7aD4E94BA1e09c4bdb75A77' as `0x${string}`;
const TAKE_PROFIT_PCT = 0.02;
const STOP_LOSS_PCT = 0.05;

const USDC_ABI = [
  { name: 'approve', type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable' },
  { name: 'transfer', type: 'function', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable' },
] as const;

export default function Dashboard() {
  const { address, isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<'connect' | 'vault' | 'token' | 'settings' | 'dashboard'>('connect');
  const [selectedToken, setSelectedToken] = useState<TokenHolding | null>(null);
  const [walletTokens, setWalletTokens] = useState<TokenHolding[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [agentData, setAgentData] = useState<AgentData | null>(null);
  const [prevPosition, setPrevPosition] = useState('NONE');
  const [prevFund, setPrevFund] = useState(0);
  const [depositAmount, setDepositAmount] = useState('');
  const [exitLevels, setExitLevels] = useState([
    { multiplier: 200, percentage: 20 },
    { multiplier: 500, percentage: 30 },
    { multiplier: 1000, percentage: 30 },
  ]);
  const [stopLoss, setStopLoss] = useState(50);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [isEmergencyExiting, setIsEmergencyExiting] = useState(false);
  const [userType, setUserType] = useState<'holder' | 'creator' | null>(null);
  const [broadcastCopied, setBroadcastCopied] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [isClosingPosition, setIsClosingPosition] = useState(false);
  const [marketCreated, setMarketCreated] = useState(false);
  const [marketTxHash, setMarketTxHash] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [usdcBalance, setUsdcBalance] = useState('0.00');
  const [vaultBalance, setVaultBalance] = useState('0.00');
  const [isDepositing, setIsDepositing] = useState(false);
  const [depositStep, setDepositStep] = useState<'idle' | 'approving' | 'depositing' | 'done'>('idle');
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<any>(null);
  const candleSeries = useRef<any>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const ts = () => { const n = new Date(); return `${n.getHours()}:${String(n.getMinutes()).padStart(2,'0')}:${String(n.getSeconds()).padStart(2,'0')}`; };
  const addFeed = (message: string, type: FeedItem['type'] = 'info') => setFeed(f => [...f.slice(-100), { time: ts(), message, type }]);

  useEffect(() => setMounted(true), []);
  useEffect(() => { if (isConnected && step === 'connect') setStep('vault'); }, [isConnected]);
  useEffect(() => { if (!address || step !== 'vault') return; fetchBalances(); }, [address, step]);
  useEffect(() => { if (step !== 'token' || !address) return; loadWalletTokens(); }, [step, address]);
  useEffect(() => { if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight; }, [feed]);

  useEffect(() => {
    if (step !== 'dashboard' || !chartRef.current) return;
    const initChart = async () => {
      try {
        const { createChart } = await import('lightweight-charts');
        if (chartInstance.current) chartInstance.current.remove();
        const chart = createChart(chartRef.current!, {
          width: chartRef.current!.clientWidth, height: chartRef.current!.clientHeight,
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
        if (selectedToken?.address) {
          try {
            const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${selectedToken.address}`);
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
        }
      } catch {}
    };
    initChart();
    return () => { if (chartInstance.current) { chartInstance.current.remove(); chartInstance.current = null; } };
  }, [step, selectedToken]);

  useEffect(() => {
    if (!candleSeries.current || !agentData?.price) return;
    const now = Math.floor(Date.now() / 1000);
    const p = agentData.price;
    const v = p * 0.003;
    candleSeries.current.update({ time: now as any, open: p - v, high: p + v * 1.5, low: p - v * 1.5, close: p });
  }, [agentData?.price]);

  useEffect(() => {
    if (txSuccess && depositStep === 'approving') {
      setDepositStep('depositing');
      writeContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: 'transfer', args: [VAULT_ADDRESS, parseUnits(depositAmount, 18)] });
    }
    if (txSuccess && depositStep === 'depositing') {
      setDepositStep('done'); setIsDepositing(false); fetchBalances(); setDepositAmount('');
    }
  }, [txSuccess]);

  const fetchBalances = async () => {
    if (!address) return;
    try {
      const r = await fetch(`${API}/api/usdc-balance/${address}`);
      const d = await r.json();
      if (d.success) setUsdcBalance(parseFloat(d.balance).toFixed(2));
      const vr = await fetch(`${API}/api/vault/${address}`);
      const vd = await vr.json();
      if (vd.success && vd.hasVault) setVaultBalance(parseFloat(vd.balance).toFixed(2));
    } catch {}
  };

  const handleDeposit = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0 || !address) return;
    setIsDepositing(true); setDepositStep('approving');
    try { writeContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: 'approve', args: [VAULT_ADDRESS, parseUnits(depositAmount, 18)] }); }
    catch { setIsDepositing(false); setDepositStep('idle'); }
  };

  useEffect(() => {
    if (step !== 'dashboard') return;
    const fetchData = async () => {
      try {
        const res = await fetch(`${API}/api/status`);
        const data = await res.json();
        if (!data.success) return;
        const { token, analysis, position, insuranceFund, perpMarketId, perpPositionId } = data.data;

        setAgentData({
          price: token.price, priceChange5m: token.priceChange5m,
          grade: analysis.grade, score: Math.round(analysis.score),
          action: analysis.action, confidence: analysis.confidence,
          reason: analysis.reason, signals: analysis.signals,
          insuranceFund, position: position?.type || 'NONE',
          positionData: position, perpMarketId, perpPositionId,
        });

        // Live feed — every tick
        addFeed(`[SENTINEL] ${token.name} | $${token.price.toFixed(7)} | ${analysis.grade} ${Math.round(analysis.score)}/100 | ${analysis.action} | ${analysis.confidence}%`, 'info');
        if (position) {
          const pnlPct = position.type === 'LONG'
            ? ((token.price - position.entryPrice) / position.entryPrice * 100)
            : ((position.entryPrice - token.price) / position.entryPrice * 100);
          addFeed(`[HEDGER] Position: ${position.type} | PnL: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% | TP: +${TAKE_PROFIT_PCT * 100}% | SL: -${STOP_LOSS_PCT * 100}%`, pnlPct >= 0 ? 'success' : 'warning');
        }

        // Position opened
        if (position?.type && prevPosition === 'NONE') {
          addFeed(`[SENTINEL] 📈 ${position.type} opened @ $${position.entryPrice.toFixed(8)}`, 'success');
          addFeed(`[SENTINEL] 🎯 TP: $${(position.entryPrice * (1 + TAKE_PROFIT_PCT)).toFixed(8)} | SL: $${(position.entryPrice * (1 - STOP_LOSS_PCT)).toFixed(8)}`, 'info');
        }

        // Position closed
        if (!position && prevPosition !== 'NONE') {
          const profit = insuranceFund - prevFund;
          addFeed(`[HEDGER] Position closed | ${profit > 0 ? `Profit: +$${profit.toFixed(4)}` : 'Loss recorded'}`, profit > 0 ? 'success' : 'error');
          addFeed(`[SENTINEL] 💰 Insurance Fund: $${insuranceFund.toFixed(4)} USDC`, 'success');
        }

        setPrevPosition(position?.type || 'NONE');
        setPrevFund(insuranceFund);
      } catch {}
    };
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [step, prevPosition, prevFund]);

  const loadWalletTokens = async () => {
    if (!address) return;
    setLoadingTokens(true);
    try {
      const res = await fetch(`${API}/api/wallet-tokens/${address}`);
      const data = await res.json();
      setWalletTokens(data.success && data.tokens.length > 0 ? data.tokens : []);
    } catch { setWalletTokens([]); } finally { setLoadingTokens(false); }
  };

  const handleActivate = async () => {
    if (!selectedToken || !address) return;
    setIsActivating(true);
    try {
      await fetch(`${API}/api/set-token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tokenAddress: selectedToken.address, userWallet: address }) });
      const mr = await fetch(`${API}/api/create-market`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tokenAddress: selectedToken.address, tokenName: selectedToken.name }) });
      const md = await mr.json();
      if (md.success) { setMarketCreated(true); setMarketTxHash(md.txHash || ''); }
      addFeed(`[SENTINEL] 🛡️ Activated for ${selectedToken.name}`, 'success');
      addFeed(`[SENTINEL] Scanning with 8-signal AI engine...`, 'info');
      setStep('dashboard');
    } catch {} finally { setIsActivating(false); }
  };

  const handleClosePosition = async () => {
    setIsClosingPosition(true);
    try {
      await fetch(`${API}/api/emergency-exit`, { method: 'POST' });
      setAgentData(prev => prev ? { ...prev, position: 'NONE', positionData: null } : null);
      addFeed(`[USER] Position closed manually`, 'warning');
    } catch {} finally { setIsClosingPosition(false); }
  };

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

  if (!mounted) return null;

  // LANDING
  if (!isConnected || !userType) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6 font-mono">
        <div className="flex items-center gap-4 mb-4">
          <Shield className="text-green-400" size={56} />
          <div>
            <h1 className="text-5xl font-bold text-green-400">SENTINEL</h1>
            <p className="text-gray-400 text-sm mt-1">AI-Powered Perp Hedging for Meme Coins</p>
          </div>
        </div>
        <p className="text-gray-500 text-sm text-center max-w-md mb-8">The first autonomous AI agent that protects your meme coin positions 24/7 by opening perp hedges on BSC</p>

        <div className="grid grid-cols-2 gap-4 max-w-lg w-full mb-8">
          <button
            onClick={() => setUserType('holder')}
            className={`border rounded-xl p-6 text-left transition-all ${userType === 'holder' ? 'border-green-400 bg-green-400/10' : 'border-gray-800 bg-gray-900 hover:border-gray-600'}`}
          >
            <div className="text-3xl mb-3">👤</div>
            <p className="text-white font-bold text-sm mb-1">I'm a Holder</p>
            <p className="text-gray-500 text-xs">Protect my meme coin holdings with autonomous AI hedging</p>
            {userType === 'holder' && <p className="text-green-400 text-xs mt-2 font-bold">✓ Selected</p>}
          </button>
          <button
            onClick={() => setUserType('creator')}
            className={`border rounded-xl p-6 text-left transition-all ${userType === 'creator' ? 'border-green-400 bg-green-400/10' : 'border-gray-800 bg-gray-900 hover:border-gray-600'}`}
          >
            <div className="text-3xl mb-3">🚀</div>
            <p className="text-white font-bold text-sm mb-1">I'm a Creator</p>
            <p className="text-gray-500 text-xs">Protect my token & share live proof with my community via broadcast link</p>
            {userType === 'creator' && <p className="text-green-400 text-xs mt-2 font-bold">✓ Selected</p>}
          </button>
        </div>

        <ConnectButton />
        <div className="grid grid-cols-3 gap-4 mt-10 max-w-lg w-full">
          {[{ icon: '🛡️', title: 'Auto Protect', desc: 'AI monitors 24/7' }, { icon: '📈', title: 'Perp Hedge', desc: 'Permissionless markets' }, { icon: '📡', title: 'Broadcast', desc: 'Share live protection' }].map((f, i) => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
              <div className="text-2xl mb-2">{f.icon}</div>
              <p className="text-white text-xs font-bold">{f.title}</p>
              <p className="text-gray-500 text-xs">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // VAULT
  if (step === 'vault') {
    return (
      <div className="min-h-screen bg-black p-6 font-mono">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3"><Shield className="text-green-400" size={24} /><div><h1 className="text-lg font-bold text-green-400">SENTINEL</h1><p className="text-gray-600 text-xs">AI-Powered Perp Hedging for Meme Coins</p></div></div>
          <ConnectButton />
        </div>
        <div className="max-w-md mx-auto">
          <h2 className="text-white text-lg font-bold mb-2">Your Vault</h2>
          <p className="text-gray-500 text-sm mb-6">Deposit USDC as collateral for autonomous perp hedging</p>
          <div className="bg-gray-900 border border-green-400/30 rounded-xl p-6 mb-4">
            <div className="flex items-center gap-2 mb-4"><div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" /><span className="text-green-400 text-sm font-bold">Vault Ready</span></div>
            <p className="text-gray-500 text-xs mb-1">Connected Wallet</p>
            <p className="text-white text-xs break-all mb-4">{address}</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-800 rounded-lg p-3"><p className="text-gray-500 text-xs mb-1">Wallet USDC</p><p className="text-white font-bold">${usdcBalance}</p></div>
              <div className="bg-gray-800 rounded-lg p-3"><p className="text-gray-500 text-xs mb-1">Vault Balance</p><p className="text-green-400 font-bold">${vaultBalance}</p></div>
              <div className="bg-gray-800 rounded-lg p-3"><p className="text-gray-500 text-xs mb-1">Status</p><p className="text-green-400 font-bold">ACTIVE</p></div>
            </div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
            <p className="text-gray-400 text-sm font-bold mb-3">Deposit USDC Collateral</p>
            <div className="flex gap-2 mb-2">
              <input type="number" placeholder="Amount in USDC" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none" />
              <button onClick={handleDeposit} disabled={isDepositing || !depositAmount || isPending} className={`px-4 py-2 rounded-lg text-sm font-bold ${isDepositing || isPending ? 'bg-gray-600 text-gray-400' : 'bg-green-400 text-black'}`}>
                {depositStep === 'approving' ? 'Approving...' : depositStep === 'depositing' ? 'Depositing...' : 'Deposit'}
              </button>
            </div>
            {depositStep === 'approving' && <p className="text-yellow-400 text-xs">Step 1/2: Approve USDC in MetaMask...</p>}
            {depositStep === 'depositing' && <p className="text-yellow-400 text-xs">Step 2/2: Confirm deposit in MetaMask...</p>}
            {depositStep === 'done' && <p className="text-green-400 text-xs">✅ Deposit successful!</p>}
          </div>
          <button onClick={() => setStep('token')} className="w-full py-3 bg-green-400 text-black rounded-xl font-bold">Select Token to Protect →</button>
        </div>
      </div>
    );
  }

  // TOKEN SELECT
  if (step === 'token') {
    return (
      <div className="min-h-screen bg-black p-6 font-mono">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3"><Shield className="text-green-400" size={24} /><div><h1 className="text-lg font-bold text-green-400">SENTINEL</h1><p className="text-gray-600 text-xs">AI-Powered Perp Hedging for Meme Coins</p></div></div>
          <ConnectButton />
        </div>
        <div className="max-w-md mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-white text-lg font-bold">Select Token to Protect</h2>
            <button onClick={loadWalletTokens} className="text-gray-500 hover:text-green-400"><RefreshCw size={16} className={loadingTokens ? 'animate-spin' : ''} /></button>
          </div>
          {loadingTokens ? (
            <div className="text-center py-8"><div className="w-6 h-6 border-2 border-green-400 border-t-transparent rounded-full animate-spin mx-auto" /></div>
          ) : walletTokens.length > 0 ? (
            <div className="space-y-3 mb-6">
              {walletTokens.map(token => (
                <div key={token.address} onClick={() => setSelectedToken(token)} className={`bg-gray-900 border rounded-xl p-4 cursor-pointer transition-all ${selectedToken?.address === token.address ? 'border-green-400' : 'border-gray-800 hover:border-gray-600'}`}>
                  <div className="flex items-center justify-between">
                    <div><p className="text-white font-bold">{token.name}</p><p className="text-gray-500 text-xs">{token.symbol} • {token.address.slice(0, 8)}...{token.address.slice(-6)}</p></div>
                    <p className="text-green-400 text-sm font-bold">${token.value.toFixed(6)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-4">
              <p className="text-gray-500 text-sm mb-3 text-center">No Four.meme tokens found in your wallet</p>
              <p className="text-gray-600 text-xs mb-2">Enter token address manually:</p>
              <input type="text" placeholder="0x... BSC token address" value={manualAddress}
                onChange={async e => {
                  setManualAddress(e.target.value);
                  if (e.target.value.length === 42) {
                    try {
                      const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${e.target.value}`);
                      const d = await r.json();
                      const pair = d?.pairs?.[0];
                      setSelectedToken({ address: e.target.value, name: pair?.baseToken?.name || 'Custom Token', symbol: pair?.baseToken?.symbol || '???', balance: '0', value: parseFloat(pair?.priceUsd || '0') });
                    } catch { setSelectedToken({ address: e.target.value, name: 'Custom Token', symbol: '???', balance: '0', value: 0 }); }
                  }
                }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none" />
            </div>
          )}
          <button onClick={() => selectedToken && setStep('settings')} disabled={!selectedToken} className={`w-full py-3 rounded-xl font-bold ${selectedToken ? 'bg-green-400 text-black' : 'bg-gray-700 text-gray-500'}`}>
            {selectedToken ? `Protect ${selectedToken.name} →` : 'Select a token first'}
          </button>
        </div>
      </div>
    );
  }

  // SETTINGS
  if (step === 'settings') {
    return (
      <div className="min-h-screen bg-black p-6 font-mono">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3"><Shield className="text-green-400" size={24} /><div><h1 className="text-lg font-bold text-green-400">SENTINEL</h1><p className="text-gray-600 text-xs">AI-Powered Perp Hedging for Meme Coins</p></div></div>
          <ConnectButton />
        </div>
        <div className="max-w-md mx-auto">
          <h2 className="text-white text-lg font-bold mb-1">Configure Protection</h2>
          <p className="text-gray-500 text-sm mb-1">Protecting: <span className="text-green-400 font-bold">{selectedToken?.name}</span></p>
          <p className="text-gray-600 text-xs mb-6">{selectedToken?.address}</p>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
            <p className="text-green-400 text-sm font-bold mb-3">Take Profit Levels</p>
            {exitLevels.map((level, i) => (
              <div key={i} className="flex items-center gap-3 mb-3">
                <div className="flex-1"><p className="text-gray-500 text-xs mb-1">Price Target</p><div className="flex items-center gap-1"><input type="number" value={level.multiplier / 100} onChange={e => { const n = [...exitLevels]; n[i].multiplier = parseFloat(e.target.value) * 100; setExitLevels(n); }} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-sm outline-none" /><span className="text-gray-400 text-sm">x</span></div></div>
                <div className="flex-1"><p className="text-gray-500 text-xs mb-1">Sell %</p><div className="flex items-center gap-1"><input type="number" value={level.percentage} onChange={e => { const n = [...exitLevels]; n[i].percentage = parseInt(e.target.value); setExitLevels(n); }} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-sm outline-none" /><span className="text-gray-400 text-sm">%</span></div></div>
              </div>
            ))}
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
            <p className="text-red-400 text-sm font-bold mb-2">Stop Loss / Hedge Trigger</p>
            <div className="flex items-center gap-3"><p className="text-gray-400 text-sm">Trigger at</p><input type="number" value={stopLoss} onChange={e => setStopLoss(parseInt(e.target.value) || 50)} className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-sm outline-none" /><span className="text-gray-400 text-sm">% drop → open SHORT</span></div>
          </div>
          <div className="bg-yellow-400/5 border border-yellow-400/20 rounded-xl p-4 mb-6">
            <p className="text-yellow-400 text-xs font-bold mb-2">⚡ What SENTINEL does when activated:</p>
            <p className="text-gray-500 text-xs mb-1">1. Creates a permissionless perp market for {selectedToken?.name} on BSC</p>
            <p className="text-gray-500 text-xs mb-1">2. AI monitors price 24/7 using 8-signal scoring</p>
            <p className="text-gray-500 text-xs mb-1">3. Opens LONG/SHORT autonomously based on signals</p>
            <p className="text-gray-500 text-xs">4. Take profits flow to your Insurance Fund</p>
          </div>
          <button onClick={handleActivate} disabled={isActivating} className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 ${isActivating ? 'bg-gray-700 text-gray-400' : 'bg-green-400 text-black'}`}>
            {isActivating ? (<><div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />Creating Perp Market on BSC...</>) : '🛡️ Activate SENTINEL'}
          </button>
        </div>
      </div>
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // MAIN TRADING DASHBOARD
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return (
    <div className="h-screen bg-black text-white font-mono flex flex-col overflow-hidden">

      {/* TOP BAR — Row 1: Brand + Wallet */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800/50 bg-gray-950 shrink-0">
        <div className="flex items-center gap-3">
          <Shield className="text-green-400" size={20} />
          <div>
            <p className="text-green-400 font-bold text-base leading-none">SENTINEL</p>
            <p className="text-gray-500 text-xs">AI-Powered Perp Hedging for Meme Coins</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 px-2 py-1 rounded border border-green-400/30 bg-green-400/10">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-400 text-xs font-bold">LIVE</span>
          </div>
          {userType === 'creator' && selectedToken && (
            <button
              onClick={() => {
                const url = `${window.location.origin}/broadcast?token=${selectedToken.address}`;
                navigator.clipboard.writeText(url);
                setBroadcastCopied(true);
                setTimeout(() => setBroadcastCopied(false), 2000);
              }}
              className="flex items-center gap-1 px-3 py-1.5 bg-blue-500/10 border border-blue-500/30 rounded-lg text-blue-400 text-xs font-bold hover:bg-blue-500/20"
            >
              📡 {broadcastCopied ? 'Link Copied! ✓' : 'Share Broadcast'}
            </button>
          )}
          <ConnectButton />
        </div>
      </div>
      {/* TOP BAR — Row 2: Token stats */}
      <div className="flex items-center gap-5 px-4 py-2 border-b border-gray-800 bg-gray-950 shrink-0">
        <div>
          <span className="text-white font-bold text-sm">{selectedToken?.name || '—'}/USDC</span>
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
        {marketCreated && agentData?.perpMarketId ? (
          <>
            <div className="h-6 w-px bg-gray-700" />
            <a href={`https://testnet.bscscan.com/tx/${marketTxHash}`} target="_blank" rel="noopener noreferrer" className="text-green-400 text-xs underline">
              Perp Market #{agentData.perpMarketId} ↗
            </a>
          </>
        ) : null}
      </div>

      {/* MIDDLE — Two equal columns */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT — Chart */}
        <div className="w-1/2 border-r border-gray-800 flex flex-col">
          <div ref={chartRef} className="flex-1" style={{ background: '#0a0a0a' }} />
        </div>

        {/* RIGHT — AI Reasoning + Live Feed */}
        <div className="w-1/2 flex flex-col">

          {/* AI Reasoning — fixed small height */}
          <div className={`m-3 mb-2 border rounded-xl p-3 shrink-0 ${gradeBg}`}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-gray-400 text-xs font-bold">🤖 AI REASONING</p>
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${agentData?.action === 'LONG' ? 'bg-green-400/20 text-green-400' : agentData?.action === 'SHORT' ? 'bg-red-400/20 text-red-400' : 'bg-yellow-400/20 text-yellow-400'}`}>
                {agentData?.action || 'HOLD'} • {agentData?.confidence || 0}%
              </span>
            </div>
            <p className={`text-xs leading-relaxed ${gradeColor}`}>{agentData?.reason || 'Analyzing market conditions...'}</p>
          </div>

          {/* Live Feed — takes remaining space, compact */}
          <div className="flex-1 mx-3 mb-3 bg-gray-950 border border-gray-800 rounded-xl flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 shrink-0">
              <Activity size={11} className="text-green-400" />
              <span className="text-gray-400 text-xs font-bold">LIVE AGENT ACTIVITY</span>
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse ml-auto" />
            </div>
            <div ref={feedRef} className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
              {feed.length === 0 ? (
                <p className="text-gray-600 text-xs text-center mt-4">Waiting for agent activity...</p>
              ) : (
                feed.map((item, i) => (
                  <div key={i} className="flex gap-2 text-xs py-0.5">
                    <span className="text-gray-600 shrink-0 text-xs">{item.time}</span>
                    <span className={`${feedColor(item.type)} text-xs`}>{item.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* POSITION PANEL — full width */}
      <div className="shrink-0 border-t border-gray-800 px-4 py-3">
        {hasPosition ? (
          <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
              <div className="flex items-center gap-2">
                {agentData?.position === 'LONG' ? <TrendingUp className="text-green-400" size={14} /> : <TrendingDown className="text-red-400" size={14} />}
                <span className={`font-bold text-sm ${agentData?.position === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>{agentData?.position}</span>
                <span className="text-gray-500 text-xs">10x Leverage</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-600 text-xs">AGENT MANAGED</span>
                <button onClick={handleClosePosition} disabled={isClosingPosition} className="px-3 py-1 bg-red-500/20 border border-red-500/40 rounded text-red-400 text-xs font-bold flex items-center gap-1 hover:bg-red-500/30">
                  <X size={11} />{isClosingPosition ? 'Closing...' : 'Close Position'}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-6 divide-x divide-gray-800">
              <div className="p-3"><p className="text-gray-500 text-xs mb-1">Entry</p><p className="text-white font-bold text-xs">${entry.toFixed(8)}</p></div>
              <div className="p-3"><p className="text-gray-500 text-xs mb-1">Mark</p><p className="text-white font-bold text-xs">${cur.toFixed(8)}</p></div>
              <div className="p-3">
                <p className="text-gray-500 text-xs mb-1">PnL</p>
                <p className={`font-bold text-xs ${pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>{pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%</p>
              </div>
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

      {/* BOTTOM BAR */}
      <div className="shrink-0 border-t border-gray-800 bg-gray-950">
        {/* Protection settings + emergency exit */}
        <div className="px-4 py-2 flex items-center justify-between border-b border-gray-800/50">
          <div className="flex items-center gap-4 text-xs">
            <span className="text-gray-500">Protection:</span>
            {exitLevels.map((l, i) => (
              <span key={i} className="text-gray-400">{l.multiplier / 100}x→<span className="text-green-400">sell {l.percentage}%</span></span>
            ))}
            <span className="text-gray-400">SL-{stopLoss}%→<span className="text-red-400">SHORT hedge</span></span>
            {agentData?.signals && (
              <span className="text-gray-600 hidden lg:inline">| Signals: {agentData.signals.map(s => s.score).join('·')}</span>
            )}
          </div>
          <button
            onClick={async () => {
              setIsEmergencyExiting(true);
              try {
                await fetch(`${API}/api/emergency-exit`, { method: 'POST' });
                setAgentData(prev => prev ? { ...prev, position: 'NONE', positionData: null } : null);
                addFeed('[USER] 🚨 Emergency exit — all positions closed', 'error');
                setStep('vault');
              } catch {} finally { setIsEmergencyExiting(false); }
            }}
            disabled={isEmergencyExiting}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs font-bold hover:bg-red-500/20"
          >
            <Power size={12} />{isEmergencyExiting ? 'EXITING...' : 'EMERGENCY EXIT'}
          </button>
        </div>
        {/* Partner badges */}
        <div className="px-4 py-2 flex items-center justify-center gap-4">
          <span className="text-gray-600 text-xs">Powered by</span>
          <div className="flex items-center gap-1 px-3 py-1 bg-orange-500/10 border border-orange-500/20 rounded-full">
            <span className="text-orange-400 text-xs font-bold">🔥 Four.meme</span>
          </div>
          <span className="text-gray-700 text-xs">Partners</span>
          <div className="flex items-center gap-1 px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full">
            <span className="text-blue-400 text-xs font-bold">🤖 dGrid AI</span>
          </div>
          <div className="flex items-center gap-1 px-3 py-1 bg-purple-500/10 border border-purple-500/20 rounded-full">
            <span className="text-purple-400 text-xs font-bold">📈 MYX Finance</span>
          </div>
          <div className="flex items-center gap-1 px-3 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded-full">
            <span className="text-yellow-400 text-xs font-bold">⚡ BSC Chain</span>
          </div>
        </div>
      </div>
    </div>
  );
}