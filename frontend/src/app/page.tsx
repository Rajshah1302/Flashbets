"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import { Wallet, Clock, Activity } from "lucide-react";

const VISIBLE_ROUNDS = 12; // total columns
const GRAPH_COLS = VISIBLE_ROUNDS / 2; // left half (6) = graph
const CURRENT_COL = GRAPH_COLS; // idx 6 is always the "current" round (locked)
const REVEAL_EVERY_SECONDS = 5;
const REVEAL_MS = REVEAL_EVERY_SECONDS * 1000;
const AMBER_HEX = "#f59e0b";

function formatUSD(n, opts = {}) {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...opts,
  });
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
      {
        id: 0,
        label: "Strong Up",
        bets: Math.floor(Math.random() * 500) + 100,
        userBet: null,
      },
      {
        id: 1,
        label: "Up",
        bets: Math.floor(Math.random() * 400) + 100,
        userBet: null,
      },
      {
        id: 2,
        label: "Down",
        bets: Math.floor(Math.random() * 400) + 100,
        userBet: null,
      },
      {
        id: 3,
        label: "Strong Down",
        bets: Math.floor(Math.random() * 500) + 100,
        userBet: null,
      },
    ],
  };
}

function seedRounds(startId) {
  return Array.from({ length: VISIBLE_ROUNDS }, (_, i) =>
    newRound(startId + i)
  );
}

// % → bucket (for payouts + band highlight)
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
    { id: 0, name: "BTC/USD", icon: "₿", price: 43567.82 },
    { id: 1, name: "ETH/USD", icon: "Ξ", price: 2289.45 },
    { id: 2, name: "SOL/USD", icon: "◎", price: 98.32 },
  ];

  const [selectedMarket, setSelectedMarket] = useState(0);
  const initialPrice = markets.find((m) => m.id === selectedMarket)?.price ?? 0;

  const [userBalance, setUserBalance] = useState(125.5);
  const initialBalanceRef = useRef(125.5);

  const [betAmount, setBetAmount] = useState(5);
  const [timeLeft, setTimeLeft] = useState(REVEAL_EVERY_SECONDS);

  // fixed 12 columns; left 6 = graph, index 6 = current (locked), right 5 = future (bettable)
  const [rounds, setRounds] = useState(() => seedRounds(10423));

  // stats
  const [wins, setWins] = useState(0);
  const [completedBets, setCompletedBets] = useState(0);

  // toast
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // fresh state refs + gating
  const latestPriceRef = useRef(initialPrice);
  const roundsRef = useRef(rounds);
  const intervalRef = useRef(null);
  const lastRevealAtRef = useRef(0);

  const [priceHistory, setPriceHistory] = useState([initialPrice]);
  useEffect(() => {
    latestPriceRef.current = priceHistory[priceHistory.length - 1];
  }, [priceHistory]);
  useEffect(() => {
    roundsRef.current = rounds;
  }, [rounds]);

  // reset on market change
  useEffect(() => {
    const base = markets.find((m) => m.id === selectedMarket)?.price ?? 0;
    setPriceHistory([base]);
    latestPriceRef.current = base;
    setRounds(seedRounds(10423));
    setTimeLeft(REVEAL_EVERY_SECONDS);
    lastRevealAtRef.current = 0;
  }, [selectedMarket]);

  // timer / reveal
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    intervalRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          const now = Date.now();
          if (now - lastRevealAtRef.current < REVEAL_MS - 50) {
            return REVEAL_EVERY_SECONDS;
          }
          lastRevealAtRef.current = now;

          const last = latestPriceRef.current;
          const changePct = (Math.random() - 0.5) * 1.2; // -0.6..+0.6
          const newPrice = last * (1 + changePct / 100);
          const winningBucket = bucketFromChange(changePct);

          // Settle current (index 6)
          const i = CURRENT_COL;
          const snapshot = roundsRef.current[i];
          if (snapshot && !snapshot.settled) {
            const totalPool = snapshot.buckets.reduce((s, b) => s + b.bets, 0);
            const winnerPool = snapshot.buckets[winningBucket].bets;
            const userBetBucket = snapshot.buckets.find(
              (b) => b.userBet != null
            );
            if (userBetBucket) {
              setCompletedBets((c) => c + 1);
              if (userBetBucket.id === winningBucket) {
                const payout = totalPool * (userBetBucket.userBet / winnerPool);
                setUserBalance((b) => b + payout);
                setWins((w) => w + 1);
                setToast({
                  type: "win",
                  amount: payout - userBetBucket.userBet,
                });
              } else {
                setToast({ type: "lose", amount: userBetBucket.userBet });
              }
            }
          }

          // reveal current, slide window
          setRounds((prev) => {
            let next = prev.slice();
            if (next[i]) {
              next[i] = {
                ...next[i],
                revealed: true,
                settled: true,
                price: newPrice,
                changePct,
                winningBucket,
              };
            }
            const lastId = next[next.length - 1].id;
            next = next.slice(1); // drop leftmost
            next.push(newRound(lastId + 1)); // add new future
            return next;
          });

          setPriceHistory((ph) => {
            const extended = [...ph, newPrice];
            while (extended.length > 64) extended.shift();
            latestPriceRef.current = extended[extended.length - 1];
            return extended;
          });

          return REVEAL_EVERY_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // bet handler — only future rounds (idx > CURRENT_COL)
  const handleBet = (roundIndex, bucketId) => {
    const r = rounds[roundIndex];
    if (!r || r.revealed) return;
    if (roundIndex <= CURRENT_COL) return; // lock past + current

    const amtRaw = Number.isFinite(betAmount) ? betAmount : 1;
    const amt = Math.max(1, Math.floor(Math.min(amtRaw, userBalance)));
    if (amt <= 0) return;

    setUserBalance((prev) => +(prev - amt).toFixed(2));
    setRounds((prev) => {
      const updated = prev.slice();
      const round = updated[roundIndex];
      const buckets = round.buckets.map((b) =>
        b.id === bucketId ? { ...b, userBet: amt, bets: b.bets + amt } : b
      );
      updated[roundIndex] = { ...round, buckets };
      return updated;
    });
  };

  const timerPct = (timeLeft / REVEAL_EVERY_SECONDS) * 100;
  const lastPrice = priceHistory[priceHistory.length - 1];
  const pnl = userBalance - initialBalanceRef.current;
  const winRate = completedBets ? (wins / completedBets) * 100 : 0;

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
                <button className="text-gray-400 hover:text-gray-200 transition">
                  Leaderboard
                </button>
                <button className="text-gray-400 hover:text-gray-200 transition">
                  History
                </button>
              </nav>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-xs text-gray-500">Balance</div>
                <div className="font-mono font-semibold">
                  ${formatUSD(userBalance)}
                </div>
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
          <div
            className="h-full bg-amber-500 transition-all duration-1000"
            style={{ width: `${timerPct}%` }}
          />
        </div>
      </header>

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50">
          <div
            className={`px-4 py-3 rounded-lg shadow-lg border backdrop-blur-md ${
              toast.type === "win"
                ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
                : "bg-red-500/10 border-red-500/30 text-red-300"
            }`}
          >
            <div className="text-sm font-semibold">
              {toast.type === "win" ? "You won!" : "You lost"}
            </div>
            <div className="text-xs opacity-80 mt-0.5">
              {toast.type === "win"
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
            {markets.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelectedMarket(m.id)}
                className={`px-6 py-4 text-sm font-medium transition relative ${
                  selectedMarket === m.id
                    ? "text-amber-400"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{m.icon}</span>
                  <span>{m.name}</span>
                  <span className="text-xs text-gray-500 font-mono">
                    $
                    {m.price.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
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
          </div>
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-2 flex items-center gap-3">
            <div>
              <div className="text-xs text-gray-400">Bet Amount</div>
              <input
                type="number"
                value={betAmount}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  const clamped = Number.isFinite(v)
                    ? Math.max(1, Math.floor(v))
                    : 1;
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
                  idx === CURRENT_COL ? "bg-amber-500/5" : ""
                }`}
              >
                <div className="font-mono font-semibold">#{round.id}</div>
                {idx === CURRENT_COL && (
                  <div className="text-amber-400 font-medium mt-1 flex items-center justify-center gap-1 animate-pulse">
                    <Clock className="w-3 h-3" />
                    {timeLeft}s
                  </div>
                )}
                {idx === CURRENT_COL && (
                  <div className="absolute inset-x-0 -bottom-px h-0.5 bg-gradient-to-r from-transparent via-amber-500 to-transparent" />
                )}
              </div>
            ))}
          </div>

          {/* Chart/Grid Area */}
          <div className="relative">
            {/* Row labels */}
            <div className="absolute left-0 top-0 bottom-0 w-23 border-r border-gray-800/50 bg-black/20 z-10">
              {[
                { id: 0, label: "Strong Up", threshold: "> +0.5%" },
                { id: 1, label: "Up", threshold: "+0.1 to +0.5%" },
                { id: 2, label: "Down", threshold: "-0.5 to -0.1%" },
                { id: 3, label: "Strong Down", threshold: "< -0.5%" },
              ].map((bucket) => (
                <div
                  key={bucket.id}
                  className="h-32 flex flex-col justify-center px-3 border-b border-gray-800/50 last:border-b-0"
                >
                  <div className="text-xs font-medium">{bucket.label}</div>
                  <div className="text-xs text-gray-500">
                    {bucket.threshold}
                  </div>
                </div>
              ))}
            </div>

            {/* Columns */}
            <div
              className="ml-23 grid grid-cols-12 relative"
              style={{ height: "512px" }}
            >
              {rounds.map((round, roundIdx) => {
                const isGraphSide = roundIdx < GRAPH_COLS;
                const isCurrent = roundIdx === CURRENT_COL;
                const isPastOrCurrent = roundIdx <= CURRENT_COL;

                return (
                  <div
                    key={round.id}
                    className="border-r border-gray-800/50 last:border-r-0 relative group"
                  >
                    {/* GRAPH SIDE (left 6): triangle per revealed round */}
                    {/* GRAPH SIDE (left 6): triangle per revealed round */}
                    {isGraphSide ? (
                      <div className="h-full relative">
                        {round.revealed &&
                          typeof round.winningBucket === "number" && (
                            <>
                              {/* Center baseline */}
                              <div
                                className="absolute left-0 right-0 h-px bg-gray-800"
                                style={{ top: "50%" }}
                              />

                              <svg
                                className="absolute inset-0 w-full h-full pointer-events-none"
                                viewBox="0 0 100 100"
                                preserveAspectRatio="none"
                              >
                                <defs>
                                  <linearGradient
                                    id={`grad-${round.id}`}
                                    x1="0%"
                                    y1="0%"
                                    x2="0%"
                                    y2="100%"
                                  >
                                    <stop
                                      offset="0%"
                                      stopColor={
                                        round.winningBucket <= 1
                                          ? "#10b981"
                                          : "#ef4444"
                                      }
                                      stopOpacity="0.15"
                                    />
                                    <stop
                                      offset="100%"
                                      stopColor={
                                        round.winningBucket <= 1
                                          ? "#10b981"
                                          : "#ef4444"
                                      }
                                      stopOpacity="0.05"
                                    />
                                  </linearGradient>
                                </defs>

                                <polygon
                                  points={`0,50 50,${bucketCenterY(
                                    round.winningBucket
                                  )} 100,50`}
                                  fill={`url(#grad-${round.id})`}
                                />

                                <polygon
                                  points={`0,50 50,${bucketCenterY(
                                    round.winningBucket
                                  )} 100,50`}
                                  fill="none"
                                  stroke={
                                    round.winningBucket <= 1
                                      ? "#10b981"
                                      : "#ef4444"
                                  }
                                  strokeWidth="1.5"
                                  vectorEffect="non-scaling-stroke"
                                  opacity="0.6"
                                />

                                {/* <circle cx="0" cy="50" r="2" fill="currentColor" className="text-gray-600" />
                              <circle cx="100" cy="50" r="2" fill="currentColor" className="text-gray-600" />
                              
                              <circle 
                                cx="50" 
                                cy={bucketCenterY(round.winningBucket)} 
                                r="3.5" 
                                fill={round.winningBucket <= 1 ? '#10b981' : '#ef4444'}
                              /> */}
                              </svg>

                              {typeof round.changePct === "number" && (
                                <div
                                  className="absolute left-0 right-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                  style={{
                                    top: `${bucketCenterY(
                                      round.winningBucket
                                    )}%`,
                                    zIndex: 30,
                                  }}
                                >
                                  <div
                                    className={`${
                                      round.changePct >= 0
                                        ? "bg-emerald-500/10 border-emerald-500/30"
                                        : "bg-red-500/10 border-red-500/30"
                                    } border rounded px-2 py-1 text-xs font-mono backdrop-blur-sm`}
                                  >
                                    <span
                                      className={
                                        round.changePct >= 0
                                          ? "text-emerald-400"
                                          : "text-red-400"
                                      }
                                    >
                                      {round.changePct >= 0 ? "+" : ""}
                                      {round.changePct.toFixed(2)}%
                                    </span>
                                    <span className="text-gray-400 ml-2">
                                      ${formatUSD(round.price)}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                      </div>
                    ) : (
                      // GRID SIDE (right 6): current locked; future bettable
                      <div className="h-full grid grid-rows-4">
                        {[0, 1, 2, 3].map((bucketId) => {
                          const cell = round.buckets[bucketId];
                          const hasBet = cell.userBet != null;
                          const disabled = isPastOrCurrent; // lock past + current
                          return (
                            <button
                              key={bucketId}
                              onClick={() => handleBet(roundIdx, bucketId)}
                              disabled={disabled}
                              className={`border-b border-gray-800/50 last:border-b-0 transition p-3 ${
                                hasBet
                                  ? "bg-amber-500/10 border-l-2 border-l-amber-500"
                                  : "hover:bg-amber-500/10"
                              } ${
                                disabled ? "opacity-50 cursor-not-allowed" : ""
                              }`}
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

                    {/* Current column underline */}
                    {isCurrent && (
                      <div className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 bg-gradient-to-r from-transparent via-amber-500 to-transparent" />
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
            <div className="text-xl font-mono font-semibold">
              ${formatUSD(lastPrice)}
            </div>
          </div>

          <div className="bg-gray-900/30 border border-gray-800/50 rounded-lg p-4">
            <div className="text-xs text-gray-500 mb-1">P/L</div>
            <div
              className={`text-xl font-mono font-semibold ${
                pnl >= 0 ? "text-amber-400" : "text-red-400"
              }`}
            >
              {pnl >= 0 ? "+" : "-"}${formatUSD(Math.abs(pnl))}
            </div>
          </div>

          <div className="bg-gray-900/30 border border-gray-800/50 rounded-lg p-4">
            <div className="text-xs text-gray-500 mb-1">Your Wins</div>
            <div className="text-xl font-mono font-semibold">{wins}</div>
          </div>

          <div className="bg-gray-900/30 border border-gray-800/50 rounded-lg p-4">
            <div className="text-xs text-gray-500 mb-1">Win Rate</div>
            <div className="text-xl font-mono font-semibold">
              {completedBets ? `${winRate.toFixed(1)}%` : "—"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
