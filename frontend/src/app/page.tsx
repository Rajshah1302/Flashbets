'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Wallet, Clock, Activity } from 'lucide-react';

const VISIBLE_ROUNDS = 12;
const MIN_FUTURE_BETTABLE = 5;
const MID_INDEX = Math.max(MIN_FUTURE_BETTABLE, Math.floor(VISIBLE_ROUNDS / 2));
const REVEAL_EVERY_SECONDS = 5;
const REVEAL_MS = REVEAL_EVERY_SECONDS * 1000;
const AMBER_HEX = '#f59e0b';

function formatUSD(n, opts = {}) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2, ...opts });
}

function newRound(id) {
  return {
    id,
    revealed: false,
    settled: false,
    price: null,
    changePct: null,
    winningBucket: null,
    buckets: [
      { id: 0, label: 'Strong Up',   bets: Math.floor(Math.random() * 500) + 100, userBet: null },
      { id: 1, label: 'Up',          bets: Math.floor(Math.random() * 400) + 100, userBet: null },
      { id: 2, label: 'Down',        bets: Math.floor(Math.random() * 400) + 100, userBet: null },
      { id: 3, label: 'Strong Down', bets: Math.floor(Math.random() * 500) + 100, userBet: null },
    ],
  };
}

function seedRounds(startId) {
  return Array.from({ length: VISIBLE_ROUNDS }, (_, i) => newRound(startId + i));
}

// % → bucket
function bucketFromChange(pct) {
  if (pct > 0.5) return 0;
  if (pct >= 0.1) return 1;
  if (pct <= -0.5) return 3;
  if (pct <= -0.1) return 2;
  return pct >= 0 ? 1 : 2;
}

// bucket → center Y (% of height)
const bucketCenterY = (bucket) => bucket * 25 + 12.5;

export default function PredictionMarketUI() {
  const markets = [
    { id: 0, name: 'BTC/USD', icon: '₿', price: 43567.82 },
    { id: 1, name: 'ETH/USD', icon: 'Ξ', price: 2289.45 },
    { id: 2, name: 'SOL/USD', icon: '◎', price: 98.32 },
  ];

  const [selectedMarket, setSelectedMarket] = useState(0);
  const initialPrice = markets.find(m => m.id === selectedMarket)?.price ?? 0;

  const [userBalance, setUserBalance] = useState(125.50);
  const initialBalanceRef = useRef(125.50);

  const [betAmount, setBetAmount] = useState(5);
  const [timeLeft, setTimeLeft] = useState(REVEAL_EVERY_SECONDS);

  // Rolling window
  const [rounds, setRounds] = useState(() => seedRounds(10423));
  const [currentRoundIndex, setCurrentRoundIndex] = useState(0); // anchors at MID_INDEX

  // Price points for stats; chart uses per-round % buckets
  const [priceHistory, setPriceHistory] = useState([initialPrice]);

  // Stats
  const [wins, setWins] = useState(0);
  const [completedBets, setCompletedBets] = useState(0);

  // Toast
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // Refs for fresh state + single-interval gating
  const latestPriceRef = useRef(initialPrice);
  const roundsRef = useRef(rounds);
  const currentIdxRef = useRef(currentRoundIndex);
  const intervalRef = useRef(null);
  const lastRevealAtRef = useRef(0);

  useEffect(() => { latestPriceRef.current = priceHistory[priceHistory.length - 1]; }, [priceHistory]);
  useEffect(() => { roundsRef.current = rounds; }, [rounds]);
  useEffect(() => { currentIdxRef.current = currentRoundIndex; }, [currentRoundIndex]);

  // Reset on market change
  useEffect(() => {
    const base = markets.find(m => m.id === selectedMarket)?.price ?? 0;
    setPriceHistory([base]);
    latestPriceRef.current = base;
    setRounds(seedRounds(10423));
    setCurrentRoundIndex(0);
    currentIdxRef.current = 0;
    setTimeLeft(REVEAL_EVERY_SECONDS);
    lastRevealAtRef.current = 0;
  }, [selectedMarket]);

  // Timer: one reveal per 5s (Strict Mode safe)
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    intervalRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          const now = Date.now();
          if (now - lastRevealAtRef.current < REVEAL_MS - 50) {
            return REVEAL_EVERY_SECONDS; // prevent accidental double reveal
          }
          lastRevealAtRef.current = now;

          const last = latestPriceRef.current;
          const changePct = (Math.random() - 0.5) * 1.2; // -0.6..+0.6
          const newPrice = last * (1 + changePct / 100);
          const winningBucket = bucketFromChange(changePct);

          // Settle current round
          const i = currentIdxRef.current;
          const snapshot = roundsRef.current[i];
          if (snapshot && !snapshot.settled) {
            const totalPool = snapshot.buckets.reduce((s, b) => s + b.bets, 0);
            const winnerPool = snapshot.buckets[winningBucket].bets;
            const userBetBucket = snapshot.buckets.find(b => b.userBet != null);
            if (userBetBucket) {
              setCompletedBets(c => c + 1);
              if (userBetBucket.id === winningBucket) {
                const payout = totalPool * (userBetBucket.userBet / winnerPool);
                setUserBalance(b => b + payout);
                setWins(w => w + 1);
                setToast({ type: 'win', amount: payout - userBetBucket.userBet });
              } else {
                setToast({ type: 'lose', amount: userBetBucket.userBet });
              }
            }
          }

          const nextIndex = i >= MID_INDEX ? MID_INDEX : i + 1;

          // Reveal + slide at/after middle
          setRounds(prev => {
            let next = prev.slice();
            if (next[i]) {
              next[i] = { ...next[i], revealed: true, settled: true, price: newPrice, changePct, winningBucket };
            }
            if (i >= MID_INDEX) {
              const lastId = next[next.length - 1].id;
              next = next.slice(1);
              next.push(newRound(lastId + 1));
            }
            return next;
          });

          // Anchor index
          setCurrentRoundIndex(nextIndex);
          currentIdxRef.current = nextIndex;

          // Price history for stats; limit so chart stops at current col
          setPriceHistory(ph => {
            const extended = [...ph, newPrice];
            const targetLen = nextIndex + 1;
            while (extended.length > targetLen) extended.shift();
            latestPriceRef.current = extended[extended.length - 1];
            return extended;
          });

          return REVEAL_EVERY_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);

    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  // Bets
  const handleBet = (roundIndex, bucketId) => {
    const r = rounds[roundIndex];
    if (!r || r.revealed) return;
    if (r.buckets.some(b => b.userBet != null)) return;

    const amtRaw = Number.isFinite(betAmount) ? betAmount : 1;
    const amt = Math.max(1, Math.floor(Math.min(amtRaw, userBalance)));
    if (amt <= 0) return;

    setUserBalance(prev => +(prev - amt).toFixed(2));
    setRounds(prev => {
      const updated = prev.slice();
      const round = updated[roundIndex];
      const buckets = round.buckets.map(b =>
        b.id === bucketId ? { ...b, userBet: amt, bets: b.bets + amt } : b
      );
      updated[roundIndex] = { ...round, buckets };
      return updated;
    });
  };

  // Chart helpers (% buckets)
  const changePcts = useMemo(() => rounds.map(r => r.changePct), [rounds]);
  const xUnit = 100 / VISIBLE_ROUNDS;
  const timerPct = (timeLeft / REVEAL_EVERY_SECONDS) * 100;
  const lastPrice = priceHistory[priceHistory.length - 1];
  const pnl = userBalance - initialBalanceRef.current;
  const winRate = completedBets ? (wins / completedBets) * 100 : 0;

  const yForIdx = (idx) => {
    const pct = changePcts[idx];
    if (pct == null) return null;
    const bucket = bucketFromChange(pct);
    return bucketCenterY(bucket);
  };

  return (
    <div className="min-h-screen bg-black text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800/50 bg-gradient-to-r from-black via-gray-900/40 to-black backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-8">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center justify-center">
                  <Activity className="w-4 h-4 text-amber-400" />
                </div>
                <span className="font-semibold text-lg">PredictX</span>
              </div>

              <nav className="hidden md:flex items-center gap-6 text-sm">
                <button className="text-amber-400 font-medium">Markets</button>
                <button className="text-gray-400 hover:text-gray-200 transition">Leaderboard</button>
                <button className="text-gray-400 hover:text-gray-200 transition">History</button>
              </nav>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-xs text-gray-500">Balance</div>
                <div className="font-mono font-semibold">${formatUSD(userBalance)}</div>
              </div>
              <button className="bg-amber-500/10 border border-amber-500/20 text-amber-400 px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-500/20 transition flex items-center gap-2">
                <Wallet className="w-4 h-4" />
                0x742d...3f9a
              </button>
            </div>
          </div>
        </div>

        {/* Timer progress */}
        <div className="h-1.5 bg-gray-800/60">
          <div className="h-full bg-amber-500 transition-all duration-1000" style={{ width: `${timerPct}%` }} />
        </div>
      </header>

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50">
          <div className={`px-4 py-3 rounded-lg shadow-lg border backdrop-blur-md ${
            toast.type === 'win'
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}>
            <div className="text-sm font-semibold">
              {toast.type === 'win' ? 'You won!' : 'You lost'}
            </div>
            <div className="text-xs opacity-80 mt-0.5">
              {toast.type === 'win'
                ? `Profit +$${formatUSD(toast.amount)}`
                : `-$${formatUSD(toast.amount)} returned to the pool`}
            </div>
          </div>
        </div>
      )}

      {/* Market Selector */}
      <div className="border-b border-gray-800/50 bg-gray-900/20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex gap-1">
            {markets.map(m => (
              <button
                key={m.id}
                onClick={() => setSelectedMarket(m.id)}
                className={`px-6 py-4 text-sm font-medium transition relative ${
                  selectedMarket === m.id ? 'text-amber-400' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{m.icon}</span>
                  <span>{m.name}</span>
                  <span className="text-xs text-gray-500 font-mono">
                    ${m.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                {selectedMarket === m.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold mb-1">Live Prediction Chart</h2>
            <p className="text-sm text-gray-500">
              Anchored at the middle with {MIN_FUTURE_BETTABLE}+ future rounds • New price every {REVEAL_EVERY_SECONDS}s
            </p>
          </div>
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-2 flex items-center gap-3">
            <div>
              <div className="text-xs text-gray-400">Bet Amount</div>
              <input
                type="number"
                value={betAmount}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  const clamped = Number.isFinite(v) ? Math.max(1, Math.floor(v)) : 1;
                  setBetAmount(clamped);
                }}
                className="w-24 bg-transparent border-none font-mono text-lg focus:outline-none"
                min="1"
                step="1"
              />
            </div>
            <span className="text-gray-500">USD</span>
          </div>
        </div>

        {/* Hybrid Chart/Grid */}
        <div className="bg-gray-900/30 border border-gray-800/50 rounded-xl overflow-hidden">
          {/* Header (1 label + 12 columns) */}
          <div className="grid grid-cols-13 border-b border-gray-800/50 bg-black/20">
            <div className="col-span-1 p-3 text-xs font-medium text-gray-500 border-r border-gray-800/50">
              Round
            </div>
            {rounds.map((round, idx) => (
              <div
                key={round.id}
                className={`p-3 text-center text-xs border-r border-gray-800/50 last:border-r-0 relative ${
                  idx === currentRoundIndex ? 'bg-amber-500/5' : ''
                }`}
              >
                <div className="font-mono font-semibold">#{round.id}</div>
                {idx === currentRoundIndex && (
                  <div className="text-amber-400 font-medium mt-1 flex items-center justify-center gap-1 animate-pulse">
                    <Clock className="w-3 h-3" />
                    {timeLeft}s
                  </div>
                )}
                {idx === currentRoundIndex && (
                  <div className="absolute inset-x-0 -bottom-px h-0.5 bg-gradient-to-r from-transparent via-amber-500 to-transparent" />
                )}
              </div>
            ))}
          </div>

          {/* Chart/Grid Area */}
          <div className="relative">
            {/* Row labels */}
            <div className="absolute left-0 top-0 bottom-0 w-32 border-r border-gray-800/50 bg-black/20 z-10">
              {[
                { id: 0, label: 'Strong Up',   threshold: '> +0.5%' },
                { id: 1, label: 'Up',          threshold: '+0.1 to +0.5%' },
                { id: 2, label: 'Down',        threshold: '-0.5 to -0.1%' },
                { id: 3, label: 'Strong Down', threshold: '< -0.5%' },
              ].map((bucket) => (
                <div key={bucket.id} className="h-32 flex flex-col justify-center px-3 border-b border-gray-800/50 last:border-b-0">
                  <div className="text-xs font-medium mb-1">{bucket.label}</div>
                  <div className="text-xs text-gray-500">{bucket.threshold}</div>
                </div>
              ))}
            </div>

            {/* Columns + Chart */}
            <div className="ml-32 grid grid-cols-12 relative" style={{ height: '512px' }}>
              {/* SVG Chart — now includes the very first revealed column (idx 0) */}
              <svg className="absolute inset-0 pointer-events-none z-20" style={{ width: '100%', height: '100%' }}>
                {/* lines: connect 0→1, 1→2, ... only if both are revealed */}
                {Array.from({ length: currentRoundIndex }, (_, i) => {
                  const idx1 = i;
                  const idx2 = i + 1;
                  const y1 = yForIdx(idx1);
                  const y2 = yForIdx(idx2);
                  if (y1 == null || y2 == null) return null;
                  const x1 = idx1 * xUnit;
                  const x2 = idx2 * xUnit;
                  return (
                    <line key={`l-${idx1}-${idx2}`} x1={`${x1}%`} y1={`${y1}%`} x2={`${x2}%`} y2={`${y2}%`} stroke={AMBER_HEX} strokeWidth="2" />
                  );
                })}
                {/* dots: draw for all revealed idx, including 0 */}
                {Array.from({ length: currentRoundIndex + 1 }, (_, i) => {
                  const y = yForIdx(i);
                  if (y == null) return null;
                  const x = i * xUnit;
                  return <circle key={`c-${i}`} cx={`${x}%`} cy={`${y}%`} r="4" fill={AMBER_HEX} />;
                })}
              </svg>

              {/* Cells */}
              {rounds.map((round, roundIdx) => {
                const isPast = roundIdx < currentRoundIndex;
                const isCurrent = roundIdx === currentRoundIndex;
                return (
                  <div key={round.id} className="border-r border-gray-800/50 last:border-r-0 relative group">
                    {round.revealed ? (
                      <div className="h-full relative bg-gray-900/20">
                        {/* Winning band */}
                        {typeof round.winningBucket === 'number' && (
                          <div
                            className={`absolute left-0 right-0 bg-amber-500/10 border-y border-amber-500/30 ${isCurrent ? 'animate-pulse' : ''}`}
                            style={{ top: `${round.winningBucket * 25}%`, height: '25%' }}
                          />
                        )}

                        {/* Hidden info chip — appears on hover */}
                        {typeof round.changePct === 'number' && (
                          <div
                            className="absolute left-0 right-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                            style={{ top: `${bucketCenterY(bucketFromChange(round.changePct))}%`, zIndex: 30 }}
                          >
                            <div className="bg-amber-500/20 border border-amber-500/40 rounded px-2 py-1 text-xs font-mono backdrop-blur-sm">
                              Δ {round.changePct >= 0 ? '+' : ''}{round.changePct.toFixed(2)}%
                              <span className="ml-1 text-[10px] opacity-75">${formatUSD(round.price)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      // Betting grid (past locked, current+future open)
                      <div className="h-full grid grid-rows-4">
                        {[0, 1, 2, 3].map((bucketId) => {
                          const cell = round.buckets[bucketId];
                          const hasBet = cell.userBet != null;
                          const disabled = isPast;
                          return (
                            <button
                              key={bucketId}
                              onClick={() => handleBet(roundIdx, bucketId)}
                              disabled={disabled}
                              className={`border-b border-gray-800/50 last:border-b-0 transition p-3 ${
                                hasBet ? 'bg-amber-500/10 border-l-2 border-l-amber-500' : 'hover:bg-amber-500/10'
                              } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                              <div className="text-xs font-mono font-semibold text-gray-400">
                                ${formatUSD(Number(cell.bets))}
                              </div>
                              {hasBet && (
                                <div className="text-xs text-amber-400 font-medium mt-1">
                                  You: ${formatUSD(cell.userBet)}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mt-6">
          <div className="bg-gray-900/30 border border-gray-800/50 rounded-lg p-4">
            <div className="text-xs text-gray-500 mb-1">Current Price</div>
            <div className="text-xl font-mono font-semibold">${formatUSD(lastPrice)}</div>
          </div>

          <div className="bg-gray-900/30 border border-gray-800/50 rounded-lg p-4">
            <div className="text-xs text-gray-500 mb-1">P/L</div>
            <div className={`text-xl font-mono font-semibold ${pnl >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
              {pnl >= 0 ? '+' : '-'}${formatUSD(Math.abs(pnl))}
            </div>
          </div>

          <div className="bg-gray-900/30 border border-gray-800/50 rounded-lg p-4">
            <div className="text-xs text-gray-500 mb-1">Your Wins</div>
            <div className="text-xl font-mono font-semibold">{wins}</div>
          </div>

          <div className="bg-gray-900/30 border border-gray-800/50 rounded-lg p-4">
            <div className="text-xs text-gray-500 mb-1">Win Rate</div>
            <div className="text-xl font-mono font-semibold">
              {completedBets ? `${winRate.toFixed(1)}%` : '—'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
