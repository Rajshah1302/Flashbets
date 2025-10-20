"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import { Wallet, Clock, Activity } from "lucide-react";

const VISIBLE_ROUNDS = 12; // total columns
const GRAPH_COLS = VISIBLE_ROUNDS / 2; // left half (6) = graph
const CURRENT_COL = GRAPH_COLS; // idx 6 is always the "current" round (locked)
const REVEAL_EVERY_SECONDS = 5;
const REVEAL_MS = REVEAL_EVERY_SECONDS * 1000;
const AMBER_HEX = "#f59e0b";

// betting config
const MIN_BET = 0.25;
const QUICK_BETS = [0.25, 0.5, 1, 2, 5, 10, 25, 50];

function toCents(n: number) {
  return Math.round(n * 100);
}
function fromCents(c: number) {
  return c / 100;
}

function formatUSD(n: number, opts: Intl.NumberFormatOptions = {}) {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...opts,
  });
}

function newRound(id: number) {
  return {
    id,
    revealed: false,
    settled: false,
    price: null as number | null,
    changePct: null as number | null,
    winningBucket: null as number | null,
    buckets: [
      {
        id: 0,
        label: "Strong Bull",
        bets: Math.floor(Math.random() * 500) + 100,
        userBet: null as number | null,
      },
      {
        id: 1,
        label: "Bull",
        bets: Math.floor(Math.random() * 400) + 100,
        userBet: null as number | null,
      },
      {
        id: 2,
        label: "Bear",
        bets: Math.floor(Math.random() * 400) + 100,
        userBet: null as number | null,
      },
      {
        id: 3,
        label: "Strong Bear",
        bets: Math.floor(Math.random() * 500) + 100,
        userBet: null as number | null,
      },
    ],
  };
}

function seedRounds(startId: number) {
  return Array.from({ length: VISIBLE_ROUNDS }, (_, i) =>
    newRound(startId + i)
  );
}

// % → bucket (for payouts + band highlight)
function bucketFromChange(pct: number) {
  if (pct > 0.5) return 0;
  if (pct >= 0.1) return 1;
  if (pct <= -0.5) return 3;
  if (pct <= -0.1) return 2;
  return pct >= 0 ? 1 : 2;
}

// bucket → center Y (% of height)
const bucketCenterY = (bucket: number) => bucket * 25 + 12.5;

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

  // NEW: fractional bet amount with quick chips
  const [betAmount, setBetAmount] = useState<number>(5);

  // NEW: totals for the right panel
  const [totalStaked, setTotalStaked] = useState(0); // gross amount wagered
  const [totalWinnings, setTotalWinnings] = useState(0); // gross payouts collected

  const [timeLeft, setTimeLeft] = useState(REVEAL_EVERY_SECONDS);

  // fixed 12 columns; left 6 = graph, index 6 = current (locked), right 5 = future (bettable)
  const [rounds, setRounds] = useState(() => seedRounds(10423));

  // stats
  const [wins, setWins] = useState(0);
  const [completedBets, setCompletedBets] = useState(0);

  // toast
  const [toast, setToast] = useState<null | {
    type: "win" | "lose" | "info";
    amount?: number;
    message?: string;
  }>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // fresh state refs + gating
  const latestPriceRef = useRef(initialPrice);
  const roundsRef = useRef(rounds);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

    // reset stats tied to market if desired (keeping userBalance)
    setWins(0);
    setCompletedBets(0);
    setTotalStaked(0);
    setTotalWinnings(0);
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
                const payout =
                  totalPool * (userBetBucket.userBet! / winnerPool);
                setUserBalance((b) => b + payout);
                setWins((w) => w + 1);
                setToast({
                  type: "win",
                  amount: payout - userBetBucket.userBet!,
                });
                setTotalWinnings((tw) => tw + payout);
              } else {
                setToast({ type: "lose", amount: userBetBucket.userBet! });
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
  const handleBet = (roundIndex: number, bucketId: number) => {
    const r = rounds[roundIndex];
    if (!r || r.revealed) return;
    if (roundIndex <= CURRENT_COL) return; // lock past + current

    // prevent multiple buckets in same round to keep settlement simple
    const alreadyPlaced = r.buckets.some(
      (b) => b.userBet != null && b.id !== bucketId
    );
    if (alreadyPlaced) {
      setToast({
        type: "info",
        message: "You already placed a bet this round.",
      });
      return;
    }

    const v = Number.isFinite(betAmount) ? betAmount : MIN_BET;
    const clamped = Math.max(MIN_BET, Math.min(v, userBalance));
    const amt = fromCents(toCents(clamped)); // round to cents
    if (amt <= 0) return;

    // update balance + staking totals
    setUserBalance((prev) => fromCents(toCents(prev) - toCents(amt)));
    setTotalStaked((ts) => ts + amt);

    setRounds((prev) => {
      const updated = prev.slice();
      const round = updated[roundIndex];

      // accumulate if user repeats on same bucket
      const buckets = round.buckets.map((b) =>
        b.id === bucketId
          ? {
              ...b,
              userBet: (b.userBet ?? 0) + amt,
              bets: b.bets + amt,
            }
          : b
      );

      updated[roundIndex] = { ...round, buckets };
      return updated;
    });
  };

  const timerPct = (timeLeft / REVEAL_EVERY_SECONDS) * 100;
  const lastPrice = priceHistory[priceHistory.length - 1];
  const pnl = userBalance - initialBalanceRef.current;
  const winRate = completedBets ? (wins / completedBets) * 100 : 0;

  // derive active bets info for the right panel
  const activeBets = useMemo(() => {
    return rounds
      .map((r, idx) => ({ r, idx }))
      .filter(
        ({ idx, r }) =>
          idx > CURRENT_COL && r.buckets.some((b) => b.userBet != null)
      )
      .map(({ r, idx }) => {
        const b = r.buckets.find((bb) => bb.userBet != null)!;
        const totalPool = r.buckets.reduce((s, bb) => s + bb.bets, 0);
        const winnerPool = r.buckets[b.id].bets;
        const potentialPayout =
          totalPool * ((b.userBet ?? 0) / (winnerPool || 1));
        return {
          roundId: r.id,
          label: r.buckets[b.id].label,
          amount: b.userBet ?? 0,
          pool: totalPool,
          estPayout: potentialPayout,
        };
      });
  }, [rounds]);

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
                : toast.type === "lose"
                ? "bg-red-500/10 border-red-500/30 text-red-300"
                : "bg-gray-700/40 border-gray-600/50 text-gray-200"
            }`}
          >
            <div className="text-sm font-semibold">
              {toast.type === "win"
                ? "You won!"
                : toast.type === "lose"
                ? "You lost"
                : "Heads up"}
            </div>
            <div className="text-xs opacity-80 mt-0.5">
              {toast.type === "win" && typeof toast.amount === "number"
                ? `Profit +$${formatUSD(toast.amount)}`
                : toast.type === "lose" && typeof toast.amount === "number"
                ? `-$${formatUSD(toast.amount)} returned to the pool`
                : toast.message}
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
      <div className="max-w-9xl mx-auto px-6 py-8">
        {/* Chart + Right Panel */}
        <div className="flex gap-6">
          {/* Chart container (left) */}
          <div className="flex-1">
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
                    { id: 0, label: "Strong Bull" },
                    { id: 1, label: "Bull" },
                    { id: 2, label: "Bear" },
                    { id: 3, label: "Strong Bear" },
                  ].map((bucket) => {
                    const isBull = bucket.label.toLowerCase().includes("bull");
                    return (
                      <div
                        key={bucket.id}
                        className="h-32 flex items-center px-3 border-b border-gray-800/50 last:border-b-0"
                      >
                        <div
                          className={`font-semibold ${
                            isBull ? "text-emerald-400" : "text-red-400"
                          } text-base`}
                        >
                          {bucket.label}
                        </div>
                      </div>
                    );
                  })}
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
                        className={`relative group ${
                          isGraphSide
                            ? ""
                            : "border-r border-gray-800/50 last:border-r-0"
                        }`}
                      >
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
                                          stopColor={"yellow"}
                                          stopOpacity="0.15"
                                        />
                                        <stop
                                          offset="100%"
                                          stopColor={"yellow"}
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
                                      stroke={"yellow"}
                                      strokeWidth="1.5"
                                      vectorEffect="non-scaling-stroke"
                                      opacity="0.6"
                                    />

                                    {isCurrent && (
                                      <circle
                                        cx="100"
                                        cy="50"
                                        r="3"
                                        fill="yellow"
                                        style={{
                                          filter:
                                            "drop-shadow(0 0 4px rgba(255, 255, 0, 0.8))",
                                        }}
                                      />
                                    )}
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
                                          ${formatUSD(round.price as number)}
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
                                    disabled
                                      ? "opacity-50 cursor-not-allowed"
                                      : ""
                                  }`}
                                >
                                  <div className="text-xs font-mono font-semibold text-gray-400">
                                    ${formatUSD(Number(cell.bets))}
                                  </div>
                                  {hasBet && (
                                    <div className="text-xs text-amber-400 font-medium mt-1">
                                      You: ${formatUSD(cell.userBet!)}
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* Current column underline */}
                        {isCurrent && (
                          <div className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 bg-gradient-to-r from-amber-400 via-amber-500 " />
                        )}
                        {/* Yellow divider line + center dot between graph and grid */}
                        {roundIdx === GRAPH_COLS - 1 && (
                          <>
                            {/* vertical divider */}
                            <div
                              className="pointer-events-none absolute right-0 top-0 bottom-0 w-[2px] bg-yellow-400"
                              style={{
                                filter:
                                  "drop-shadow(0 0 6px rgba(255,255,0,0.7))",
                                zIndex: 50,
                              }}
                            />

                            {/* center dot on the divider */}
                            <div
                              className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 h-3 w-3 rounded-full bg-yellow-400"
                              style={{
                                filter:
                                  "drop-shadow(0 0 8px rgba(255,255,0,0.9))",
                                zIndex: 60,
                              }}
                            />
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT SIDEBAR: Betting & Stats */}
          <aside className="w-full md:w-80 shrink-0">
            <div className="bg-gray-900/30 border border-gray-800/50 rounded-xl p-4 sticky top-6">
              <h3 className="text-sm font-semibold text-gray-200 mb-3">
                Bet Panel
              </h3>

              {/* Quick amounts */}
              <div>
                <div className="text-xs text-gray-500 mb-2">Quick Amounts</div>
                <div className="flex flex-wrap gap-2">
                  {QUICK_BETS.map((amt) => (
                    <button
                      key={amt}
                      onClick={() => setBetAmount(amt)}
                      className={`px-3 py-1.5 rounded border text-xs font-mono transition ${
                        betAmount === amt
                          ? "border-amber-400 text-amber-300 bg-amber-500/10"
                          : "border-gray-700 hover:border-amber-500/40"
                      }`}
                    >
                      ${amt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom amount */}
              <div className="mt-4">
                <div className="text-xs text-gray-500 mb-2">
                  Custom Amount (USD)
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={MIN_BET}
                    step="0.25"
                    value={betAmount}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      const clamped = Number.isFinite(v)
                        ? Math.max(MIN_BET, Math.min(v, userBalance))
                        : MIN_BET;
                      // round to cents
                      setBetAmount(fromCents(toCents(clamped)));
                    }}
                    className="w-full bg-black/30 border border-gray-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-amber-500/60"
                  />
                  <span className="text-xs text-gray-500">USD</span>
                </div>
                <div className="text-[11px] text-gray-500 mt-1">
                  Click a future cell to place this amount.
                </div>
              </div>

              {/* Divider */}
              <div className="h-px bg-gray-800/60 my-4" />

              {/* Live / summary stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-black/20 border border-gray-800 rounded p-3">
                  <div className="text-[11px] text-gray-500 mb-1">Balance</div>
                  <div className="font-mono font-semibold">
                    ${formatUSD(userBalance)}
                  </div>
                </div>
                <div className="bg-black/20 border border-gray-800 rounded p-3">
                  <div className="text-[11px] text-gray-500 mb-1">P/L</div>
                  <div
                    className={`font-mono font-semibold ${
                      pnl >= 0 ? "text-amber-400" : "text-red-400"
                    }`}
                  >
                    {pnl >= 0 ? "+" : "-"}${formatUSD(Math.abs(pnl))}
                  </div>
                </div>
                <div className="bg-black/20 border border-gray-800 rounded p-3">
                  <div className="text-[11px] text-gray-500 mb-1">
                    Total Winnings
                  </div>
                  <div className="font-mono font-semibold text-emerald-300">
                    ${formatUSD(totalWinnings)}
                  </div>
                </div>
                <div className="bg-black/20 border border-gray-800 rounded p-3">
                  <div className="text-[11px] text-gray-500 mb-1">
                    Total Staked
                  </div>
                  <div className="font-mono font-semibold text-gray-300">
                    ${formatUSD(totalStaked)}
                  </div>
                </div>
                <div className="bg-black/20 border border-gray-800 rounded p-3">
                  <div className="text-[11px] text-gray-500 mb-1">Wins</div>
                  <div className="font-mono font-semibold">{wins}</div>
                </div>
                <div className="bg-black/20 border border-gray-800 rounded p-3">
                  <div className="text-[11px] text-gray-500 mb-1">Win Rate</div>
                  <div className="font-mono font-semibold">
                    {completedBets ? `${winRate.toFixed(1)}%` : "—"}
                  </div>
                </div>
              </div>

              {/* Next reveal */}
              <div className="mt-4 text-xs text-gray-400">
                Next reveal in{" "}
                <span className="text-amber-400 font-medium">{timeLeft}s</span>
              </div>

              {/* Active Bets */}
              <div className="mt-4">
                <div className="text-xs font-semibold text-gray-300 mb-2">
                  Active Bets
                </div>
                {activeBets.length === 0 ? (
                  <div className="text-xs text-gray-500">
                    No active bets yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activeBets.map((b) => (
                      <div
                        key={b.roundId}
                        className="border border-gray-800 rounded p-3 bg-black/20"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div className="font-mono text-gray-400">
                            Round #{b.roundId}
                          </div>
                          <div className="font-medium">{b.label}</div>
                        </div>
                        <div className="mt-1 grid grid-cols-3 gap-2 text-[11px]">
                          <div className="text-gray-500">You</div>
                          <div className="text-gray-500">Pool</div>
                          <div className="text-gray-500">Est. Win</div>
                          <div className="font-mono">
                            ${formatUSD(b.amount)}
                          </div>
                          <div className="font-mono">${formatUSD(b.pool)}</div>
                          <div className="font-mono">
                            ${formatUSD(b.estPayout)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>

        {/* REMOVED bottom Stats panel */}
      </div>
    </div>
  );
}
