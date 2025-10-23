"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Clock, Wallet, Zap } from "lucide-react";
import LeaderboardCombinedChart, { LBPlayer } from "@/components/Leaderboard";
import NavBar from "@/components/Navbar";
import BetsTable from "@/components/HistoryTable";
import { useYellowSDKWagmi } from "@/lib/useYellowSDKWagmi";

// Simple toggle component for switching between market views.
// Kept inline to avoid adding a new file/import and to resolve the missing identifier.
function MarketViewToggle({
  mode,
  onChange,
}: {
  mode: "betting" | "leaderboard";
  onChange: (m: "betting" | "leaderboard") => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onChange("betting")}
        className={`px-3 py-1 rounded text-sm font-medium transition ${
          mode === "betting" ? "text-amber-400" : "text-gray-400 hover:text-gray-200"
        }`}
        aria-pressed={mode === "betting"}
      >
        Betting
      </button>
      <button
        onClick={() => onChange("leaderboard")}
        className={`px-3 py-1 rounded text-sm font-medium transition ${
          mode === "leaderboard" ? "text-amber-400" : "text-gray-400 hover:text-gray-200"
        }`}
        aria-pressed={mode === "leaderboard"}
      >
        Leaderboard
      </button>
    </div>
  );
}

/* ===== constants ===== */
const VISIBLE_ROUNDS = 12;
const GRAPH_COLS = VISIBLE_ROUNDS / 2;
const CURRENT_COL = GRAPH_COLS;
const REVEAL_EVERY_SECONDS = 5;
const REVEAL_MS = REVEAL_EVERY_SECONDS * 1000;

const MIN_BET = 0.25;
const QUICK_BETS = [0.25, 0.5, 1, 2, 5, 10, 25, 50];

/* ===== PYTH config ===== */
const HERMES_HTTP = "https://hermes.pyth.network";
const PYTH_IDS = {
  BTCUSD: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETHUSD: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  SOLUSD: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
} as const;

/* ===== helpers ===== */
const canonId = (id: string) => id.toLowerCase().replace(/^0x/, ""); // normalize to no-0x lowercase

function toCents(n: number) { return Math.round(n * 100); }
function fromCents(c: number) { return c / 100; }
function formatUSD(n: number, opts: Intl.NumberFormatOptions = {}) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2, ...opts });
}
function newRound(id: number) {
  return {
    id,
    revealed: false,
    settled: false,
    price: null as number | null,
    changePct: null as number | null, // percent units (e.g. 0.005 means 0.005%)
    winningBucket: null as number | null,
    buckets: [
      { id: 0, label: "Strong Bull", bets: Math.floor(Math.random() * 50) + 10, userBet: null as number | null },
      { id: 1, label: "Bull",        bets: Math.floor(Math.random() * 40) + 10, userBet: null as number | null },
      { id: 2, label: "Bear",        bets: Math.floor(Math.random() * 40) + 10, userBet: null as number | null },
      { id: 3, label: "Strong Bear", bets: Math.floor(Math.random() * 50) + 10, userBet: null as number | null },
    ],
  };
}
function seedRounds(startId: number) { return Array.from({ length: VISIBLE_ROUNDS }, (_, i) => newRound(startId + i)); }

/* ===== very small thresholds (basis points) =====
   1 bp = 0.01%
   STRONG_BP = 0.5  -> 0.005%
   WEAK_BP   = 0.15 -> 0.0015% */
const STRONG_BP = 0.5;
const WEAK_BP   = 0.015;
const STRONG_PCT = STRONG_BP * 0.01; // => 0.005 (% units)
const WEAK_PCT   = WEAK_BP   * 0.01; // => 0.0015 (% units)

function bucketFromChange(pct: number, tieBucket: number | null) {
  if (pct >= STRONG_PCT)  return 0; // Strong Bull
  if (pct >= WEAK_PCT)    return 1; // Bull
  if (pct <= -STRONG_PCT) return 3; // Strong Bear
  if (pct <= -WEAK_PCT)   return 2; // Bear
  // Flat-ish: stick with previous bucket if we have one; otherwise pick Bull (1)
  return tieBucket ?? 1;
}
const bucketCenterY = (bucket: number) => bucket * 25 + 12.5;

/* ===== Hermes latest parser ===== */
function pickPriceFromHermesObject(obj: any): { id?: string; price?: number } | null {
  if (!obj) return null;
  const pf = obj.price_feed ?? obj;
  const id = pf.id ?? pf.price_feed_id ?? pf.feed_id;
  const pObj = pf.price ?? pf.latest_price ?? pf.price_info;
  if (!pObj || pObj.price == null || pObj.expo == null) return null;
  const real = Number(pObj.price) * Math.pow(10, Number(pObj.expo)); // price * 10^expo
  if (!Number.isFinite(real)) return null;
  return { id, price: real };
}

/* ===== REST poller (no SDK needed) ===== */
function usePythLatestREST(feedIdsCanonical: string[], intervalMs = 1000) {
  const [prices, setPrices] = useState<Record<string, number>>({}); // canonical keys

  useEffect(() => {
    if (!feedIdsCanonical.length) return;
    let timer: ReturnType<typeof setInterval> | undefined;

    const fetchOnce = async () => {
      try {
        const u = new URL("/v2/updates/price/latest", HERMES_HTTP);
        for (const id of feedIdsCanonical) u.searchParams.append("ids[]", "0x" + canonId(id));
        u.searchParams.set("parsed", "true");

        const res = await fetch(u.toString(), { cache: "no-store" });
        if (!res.ok) {
          console.warn("[pyth] HTTP", res.status, await res.text());
          return;
        }
        const data = await res.json();
        const parsed = Array.isArray(data?.parsed) ? data.parsed : data?.price_feeds || data?.feeds || [];
        setPrices((prev) => {
          const next = { ...prev };
          for (const entry of parsed) {
            const pr = pickPriceFromHermesObject(entry);
            if (pr?.id && typeof pr.price === "number") next[canonId(pr.id)] = pr.price;
          }
          return next;
        });
      } catch (e) {
        console.warn("[pyth] fetch error", e);
      }
    };

    fetchOnce();
    timer = setInterval(fetchOnce, intervalMs);
    return () => { if (timer) clearInterval(timer); };
  }, [JSON.stringify(feedIdsCanonical), intervalMs]);

  return prices;
}

/* ===== pending stake helper ===== */
function getPendingStakeTotal(rounds: Array<ReturnType<typeof newRound>>) {
  let t = 0;
  for (const r of rounds) {
    if (!r.settled) {
      const ub = r.buckets.find((b) => b.userBet != null);
      if (ub) t += ub.userBet ?? 0;
    }
  }
  return t;
}

export default function PredictionMarketUI() {
  // Use canonical ids (no-0x) for internal lookups
  const markets = [
    { id: 0, name: "BTC/USD", icon: "₿", priceId: canonId(PYTH_IDS.BTCUSD) },
    { id: 1, name: "ETH/USD", icon: "Ξ", priceId: canonId(PYTH_IDS.ETHUSD) },
    { id: 2, name: "SOL/USD", icon: "◎", priceId: canonId(PYTH_IDS.SOLUSD) },
  ] as const;

  const [selectedMarket, setSelectedMarket] = useState(0);

  // Live prices via REST polling
  const pythPrices = usePythLatestREST(markets.map((m) => m.priceId), 1000);
  const selectedPriceId = markets.find((m) => m.id === selectedMarket)!.priceId;
  const selectedLivePrice = pythPrices[selectedPriceId];

  // Yellow SDK integration
  const {
    isConnected: isYellowConnected,
    isConnecting: isYellowConnecting,
    userAddress: yellowUserAddress,
    balance: yellowBalance,
    isLoading: isYellowLoading,
    error: yellowError,
    connectWallet,
    connectToClearnode,
    disconnect,
    requestTestTokens,
    executeFlashTrade,
    withdrawProfit,
    settleSession,
    refreshBalance,
    clearError,
  } = useYellowSDKWagmi();

  // Use Yellow Network balance if connected, otherwise local demo balance
  const [userBalance, setUserBalance] = useState(0);
  const userBalanceRef = useRef(userBalance);
  useEffect(() => { userBalanceRef.current = userBalance; }, [userBalance]);
  useEffect(() => { setUserBalance(isYellowConnected ? yellowBalance : 10); }, [isYellowConnected, yellowBalance]);

  const initialBalanceRef = useRef(0);

  const [betAmount, setBetAmount] = useState<number>(5);
  const [totalStaked, setTotalStaked] = useState(0);
  const [totalWinnings, setTotalWinnings] = useState(0);
  const [timeLeft, setTimeLeft] = useState(REVEAL_EVERY_SECONDS);
  const [rounds, setRounds] = useState(() => seedRounds(10423));
  const [wins, setWins] = useState(0);
  const [completedBets, setCompletedBets] = useState(0);

  type HistoryRow = {
    roundId: number; label: string; amount: number; payout: number; profit: number;
    result: "win" | "lose"; price: number; changePct: number; // percent units
  };
  const [betHistory, setBetHistory] = useState<HistoryRow[]>([]);

  const [toast, setToast] = useState<null | { type: "win" | "lose" | "info"; amount?: number; message?: string; }>(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2200); return () => clearTimeout(t); }, [toast]);

  // live refs
  const latestPriceRef = useRef(0);                 // the most recent live tick
  const prevRevealPriceRef = useRef<number | null>(null); // baseline for 5s change (previous reveal close)
  const prevWinBucketRef = useRef<number | null>(null);   // tie-breaker bucket
  const roundsRef = useRef(rounds);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRevealAtRef = useRef(0);

  const [priceHistory, setPriceHistory] = useState([0]);

  // update latest price from REST
  useEffect(() => {
    if (typeof selectedLivePrice === "number" && selectedLivePrice > 0) {
      latestPriceRef.current = selectedLivePrice;
      if (priceHistory.length === 1 && priceHistory[0] === 0) {
        setPriceHistory([selectedLivePrice]);
        prevRevealPriceRef.current = selectedLivePrice; // seed baseline on first tick
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLivePrice]);

  useEffect(() => { roundsRef.current = rounds; }, [rounds]);

  /* ===== keep both views mounted; just hide/show ===== */
  const [viewMode, setViewMode] = useState<"betting" | "leaderboard">("betting");

  /* ===== leaderboard ===== */
  const leaderboardPlayers: LBPlayer[] = useMemo(
    () => [
      { id: "alpha", name: "Alpha", color: "#60a5fa", width: 1.8, z: 1 },
      { id: "blaze", name: "Blaze", color: "#f472b6", width: 1.8, z: 2 },
      { id: "nexus", name: "Nexus", color: "#34d399", width: 1.8, z: 3 },
      { id: "you",  name: "You",   color: "#f59e0b", width: 2.4, z: 4 },
    ],
    []
  );

  const othersPnlRef = useRef<Record<string, number>>({ alpha: 8.5, blaze: 6.2, nexus: 5.1 });
  const [latestLeaderProfits, setLatestLeaderProfits] = useState<Record<string, number>>({
    alpha: othersPnlRef.current.alpha, blaze: othersPnlRef.current.blaze, nexus: othersPnlRef.current.nexus, you: 0,
  });

  const [settleCounter, setSettleCounter] = useState(0);

  // reset on market change
  useEffect(() => {
    setPriceHistory([0]);
    latestPriceRef.current = 0;
    prevRevealPriceRef.current = null;
    prevWinBucketRef.current = null;

    setRounds(seedRounds(10423));
    setTimeLeft(REVEAL_EVERY_SECONDS);
    lastRevealAtRef.current = 0;

    setWins(0); setCompletedBets(0); setTotalStaked(0); setTotalWinnings(0); setBetHistory([]);

    othersPnlRef.current = { alpha: 8.5, blaze: 6.2, nexus: 5.1 };
    setLatestLeaderProfits({ ...othersPnlRef.current, you: 0 });
    setSettleCounter(0);
  }, [selectedMarket]);

  // timer / reveal (use previous reveal price as baseline)
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    intervalRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          const now = Date.now();
          if (now - lastRevealAtRef.current < REVEAL_MS - 50) return REVEAL_EVERY_SECONDS;
          lastRevealAtRef.current = now;

          const spot = latestPriceRef.current || 0;
          let baseline = prevRevealPriceRef.current ?? spot; // previous reveal close; seed with first spot
          // percent units, tiny numbers matter
          const changePct = baseline > 0 ? ((spot - baseline) / baseline) * 100 : 0;

          // choose bucket with tie-breaker
          const winningBucket = bucketFromChange(changePct, prevWinBucketRef.current);

          // settle current index (middle column)
          const i = CURRENT_COL;
          const snapshot = roundsRef.current[i];
          let nextUserBalance = userBalanceRef.current;

          if (snapshot && !snapshot.settled) {
            const totalPool = snapshot.buckets.reduce((s, b) => s + b.bets, 0);
            const winnerPool = snapshot.buckets[winningBucket].bets;
            const userBetBucket = snapshot.buckets.find((b) => b.userBet != null);

            if (userBetBucket) {
              const stake = userBetBucket.userBet!;
              setCompletedBets((c) => c + 1);

              if (userBetBucket.id === winningBucket) {
                const payout = totalPool * (stake / winnerPool);
                nextUserBalance = userBalanceRef.current + payout; // stake already deducted at bet time
                setUserBalance(nextUserBalance);
                setWins((w) => w + 1);
                setToast({ type: "win", amount: payout - stake });
                setTotalWinnings((tw) => tw + payout);
              } else {
                setToast({ type: "lose", amount: stake });
              }

              setBetHistory((prev) => [
                ...prev.slice(-99),
                {
                  roundId: snapshot.id,
                  label: userBetBucket.label,
                  amount: stake,
                  payout: userBetBucket.id === winningBucket ? totalPool * (stake / winnerPool) : 0,
                  profit: userBetBucket.id === winningBucket ? totalPool * (stake / winnerPool) - stake : -stake,
                  result: userBetBucket.id === winningBucket ? "win" : "lose",
                  price: spot,
                  changePct,
                },
              ]);
            }
          }

          // next rounds window
          const nextRounds = (() => {
            let next = roundsRef.current.slice();
            if (next[i])
              next[i] = { ...next[i], revealed: true, settled: true, price: spot, changePct, winningBucket };
            const lastId = next[next.length - 1].id;
            next = next.slice(1);
            next.push(newRound(lastId + 1));
            return next;
          })();

          setRounds(nextRounds);

          // price history slide
          setPriceHistory((ph) => {
            const extended = [...ph, spot];
            while (extended.length > 64) extended.shift();
            return extended;
          });

          // update tie-break & new baseline for next round
          prevWinBucketRef.current = winningBucket;
          prevRevealPriceRef.current = spot;

          // leaderboard pnl
          const drift = () => (Math.random() - 0.45) * 100;
          othersPnlRef.current.alpha += drift();
          othersPnlRef.current.blaze += drift();
          othersPnlRef.current.nexus += drift();

          const pendingAfter = getPendingStakeTotal(nextRounds);
          const youPnlExact = nextUserBalance + pendingAfter - initialBalanceRef.current;

          setLatestLeaderProfits({
            alpha: +othersPnlRef.current.alpha,
            blaze: +othersPnlRef.current.blaze,
            nexus: +othersPnlRef.current.nexus,
            you: youPnlExact,
          });

          setSettleCounter((c) => c + 1);
          return REVEAL_EVERY_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);

    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [selectedMarket]);

  // place bet
  const handleBet = async (roundIndex: number, bucketId: number) => {
    const r = rounds[roundIndex];
    if (!r || r.revealed) return;
    if (roundIndex <= CURRENT_COL) return;

    const alreadyPlaced = r.buckets.some((b) => b.userBet != null && b.id !== bucketId);
    if (alreadyPlaced) { setToast({ type: "info", message: "You already placed a bet this round." }); return; }

    const v = Number.isFinite(betAmount) ? betAmount : MIN_BET;
    const clamped = Math.max(MIN_BET, Math.min(v, userBalance));
    const amt = fromCents(toCents(clamped));
    if (amt <= 0) return;

    if (isYellowConnected) {
      try {
        const currentPrice = latestPriceRef.current || 0;
        const direction = bucketId <= 1 ? "up" : "down";
        const tradeResult = await executeFlashTrade({
          fromAsset: "YELLOW_TEST_USD",
          toAsset: "YELLOW_TEST_USD",
          amount: amt,
          price: currentPrice,
          direction,
          expiryTime: Math.floor(Date.now() / 1000) + REVEAL_EVERY_SECONDS * 12,
        });
        if (!tradeResult.success) {
          setToast({ type: "info", message: tradeResult.error || "Failed to place bet" });
          return;
        }
        if (tradeResult.balance) setUserBalance(tradeResult.balance.unified);
      } catch {
        setToast({ type: "info", message: "Failed to execute bet through Yellow Network" });
        return;
      }
    } else {
      setUserBalance((prev) => fromCents(toCents(prev) - toCents(amt)));
    }

    setTotalStaked((ts) => ts + amt);

    setRounds((prev) => {
      const updated = prev.slice();
      const round = updated[roundIndex];
      const buckets = round.buckets.map((b) =>
        b.id === bucketId ? { ...b, userBet: (b.userBet ?? 0) + amt, bets: b.bets + amt } : b
      );
      updated[roundIndex] = { ...round, buckets };
      return updated;
    });

    setToast({ type: "info", message: isYellowConnected ? "Bet placed via Yellow Network (zero gas fees!)" : "Bet placed locally" });
  };

  // derived: pending stakes
  const pendingStakeTotal = useMemo(() => getPendingStakeTotal(rounds), [rounds]);

  // displayed PnL
  const pnlDisplay = userBalance + pendingStakeTotal - initialBalanceRef.current;

  const roundProgress = (REVEAL_EVERY_SECONDS - timeLeft) / REVEAL_EVERY_SECONDS;
  const winRate = completedBets ? (wins / completedBets) * 100 : 0;

  // Active bets for table
  const activeBets = useMemo(() => {
    return rounds
      .map((r, idx) => ({ r, idx }))
      .filter(({ r }) => !r.settled && r.buckets.some((b) => b.userBet != null))
      .map(({ r }) => {
        const b = r.buckets.find((bb) => bb.userBet != null)!;
        const totalPool = r.buckets.reduce((s, bb) => s + bb.bets, 0);
        const winnerPool = r.buckets[b.id].bets;
        const estPayout = totalPool * ((b.userBet ?? 0) / (winnerPool || 1));
        return { roundId: r.id, label: r.buckets[b.id].label, amount: b.userBet ?? 0, pool: totalPool, estPayout };
      });
  }, [rounds]);

  return (
    <div className="min-h-screen bg-black text-gray-100">
      <NavBar />

      {/* Market Selector + Toggle */}
      <div className="border-b border-gray-800/50 bg-gray-900/20">
        <div className="max-w-9xl mx-auto px-6">
          <div className="flex items-center justify-between gap-4 py-2">
            <div className="flex gap-1">
              {markets.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedMarket(m.id)}
                  className={`px-6 py-3 text-sm font-medium transition relative ${
                    selectedMarket === m.id ? "text-amber-400" : "text-gray-400 hover:text-gray-200"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{m.icon}</span>
                    <span>{m.name}</span>
                    <span className="text-xs text-gray-500 font-mono">
                      {typeof pythPrices[m.priceId] === "number"
                        ? `$${(pythPrices[m.priceId]).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : "—"}
                    </span>
                  </div>
                  {selectedMarket === m.id && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500" />}
                </button>
              ))}
            </div>

            <MarketViewToggle mode={viewMode} onChange={setViewMode} />
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="max-w-9xl mx-auto px-6 py-8">
        <div className="flex gap-6">
          {/* LEFT */}
          <div className="flex-1">
            {/* Betting view */}
            <div className={viewMode === "betting" ? "block" : "hidden"}>
              <div className="bg-gray-900/30 border border-gray-800/50 rounded-xl overflow-hidden">
                {/* Header */}
                <div className="grid grid-cols-13 border-b border-gray-800/50 bg-black/20">
                  <div className="col-span-1 p-3 text-xs font-medium text-gray-500 border-r border-gray-800/50">Round</div>
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
                          <Clock className="w-3 h-3" /> {timeLeft}s
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
                        <div key={bucket.id} className="h-32 flex items-center px-3 border-b border-gray-800/50 last:border-b-0">
                          <div className={`font-semibold ${isBull ? "text-emerald-400" : "text-red-400"} text-base`}>{bucket.label}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Columns */}
                  <div className="ml-23 grid grid-cols-12 relative" style={{ height: "512px" }}>
                    {rounds.map((round, roundIdx) => {
                      const isGraphSide = roundIdx < GRAPH_COLS;
                      const isCurrent = roundIdx === CURRENT_COL;
                      const isPastOrCurrent = roundIdx <= CURRENT_COL;

                      return (
                        <div key={round.id} className={`relative group ${isGraphSide ? "" : "border-r border-gray-800/50 last:border-r-0"}`}>
                          {isGraphSide ? (
                            <div className="h-full relative">
                              {round.revealed && typeof round.winningBucket === "number" && (
                                <>
                                  <div className="absolute left-0 right-0 h-px bg-gray-800" style={{ top: "50%" }} />
                                  <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                                    <defs>
                                      <linearGradient id={`grad-${round.id}`} x1="0%" y1="0%" x2="0%" y2="100%">
                                        <stop offset="0%" stopColor={"yellow"} stopOpacity="0.15" />
                                        <stop offset="100%" stopColor={"yellow"} stopOpacity="0.05" />
                                      </linearGradient>
                                    </defs>
                                    <polygon
                                      points={`0,50 50,${bucketCenterY(round.winningBucket)} 100,50`}
                                      fill={`url(#grad-${round.id})`}
                                    />
                                    <polygon
                                      points={`0,50 50,${bucketCenterY(round.winningBucket)} 100,50`}
                                      fill="none"
                                      stroke={"yellow"}
                                      strokeWidth="1.5"
                                      vectorEffect="non-scaling-stroke"
                                      opacity="0.6"
                                    />
                                    {isCurrent && <circle cx="100" cy="50" r="3" fill="yellow" style={{ filter: "drop-shadow(0 0 4px rgba(255, 255, 0, 0.8))" }} />}
                                  </svg>

                                  {typeof round.changePct === "number" && (
                                    <div
                                      className="absolute left-0 right-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                      style={{ top: `${bucketCenterY(round.winningBucket)}%`, zIndex: 30 }}
                                    >
                                      <div
                                        className={`${round.changePct >= 0 ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30"} border rounded px-2 py-1 text-xs font-mono backdrop-blur-sm`}
                                      >
                                        <span className={round.changePct >= 0 ? "text-emerald-400" : "text-red-400"}>
                                          {round.changePct >= 0 ? "+" : ""}
                                          {round.changePct.toFixed(4)}%
                                        </span>
                                        <span className="text-gray-400 ml-2">${formatUSD(round.price as number)}</span>
                                      </div>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          ) : (
                            <div className="h-full grid grid-rows-4">
                              {[0, 1, 2, 3].map((bucketId) => {
                                const cell = round.buckets[bucketId];
                                const hasBet = cell.userBet != null;
                                const disabled = isPastOrCurrent;
                                return (
                                  <button
                                    key={bucketId}
                                    onClick={() => handleBet(roundIdx, bucketId)}
                                    disabled={disabled}
                                    className={`border-b border-gray-800/50 last:border-b-0 transition p-3 ${
                                      hasBet ? "bg-amber-500/10 border-l-2 border-l-amber-500" : "hover:bg-amber-500/10"
                                    } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                                  >
                                    <div className="text-xs font-mono font-semibold text-gray-400">
                                      ${formatUSD(Number(cell.bets))}
                                    </div>
                                    {hasBet && <div className="text-xs text-amber-400 font-medium mt-1">You: ${formatUSD(cell.userBet!)}</div>}
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {isCurrent && <div className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 bg-gradient-to-r from-amber-400 via-amber-500 " />}
                          {roundIdx === GRAPH_COLS - 1 && (
                            <>
                              <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-[2px] bg-yellow-400" style={{ filter: "drop-shadow(0 0 6px rgba(255,255,0,0.7))", zIndex: 50 }} />
                              <div className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 h-3 w-3 rounded-full bg-yellow-400" style={{ filter: "drop-shadow(0 0 8px rgba(255,255,0,0.9))", zIndex: 60 }} />
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Leaderboard view */}
            <div className={viewMode === "leaderboard" ? "block" : "hidden"}>
              <LeaderboardCombinedChart
                players={leaderboardPlayers}
                latestProfits={latestLeaderProfits}
                settleSignal={settleCounter}
                roundProgress={roundProgress}
                points={64}
                ema={0.85}
                height={420}
                stepIds={["you"]}
                tweenOthers={true}
                tweenMs={700}
                persistKey={`lb-pnl-${selectedMarket}`}
              />
            </div>
          </div>

          {/* RIGHT: Stats / Bet controls */}
          <aside className="w-full md:w-80 shrink-0">
            <div className="bg-gray-900/30 border border-gray-800/50 rounded-xl p-4 sticky top-6">
              <h3 className="text-sm font-semibold text-gray-200 mb-3">Bet Panel</h3>

              {/* Yellow Network Connection */}
              <div className="mb-6 p-4 bg-gray-800/50 rounded-lg border border-gray-700/50">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="h-4 w-4 text-yellow-500" />
                  <span className="text-sm font-medium text-gray-200">Yellow Network</span>
                  <div className={`w-2 h-2 rounded-full ${isYellowConnected ? "bg-green-500" : "bg-gray-500"}`} />
                </div>

                {!isYellowConnected ? (
                  <div>
                    <p className="text-xs text-gray-400 mb-3">Connect to Yellow Network for zero gas fee betting</p>
                    <button
                      onClick={async () => {
                        const walletConnected = await connectWallet();
                        if (walletConnected) await connectToClearnode();
                      }}
                      disabled={isYellowConnecting}
                      className="w-full bg-yellow-500 hover:bg-yellow-600 text-black px-3 py-2 rounded text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {isYellowConnecting ? (
                        <>
                          <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                          Connecting...
                        </>
                      ) : (
                        <>
                          <Wallet className="h-4 w-4" />
                          Connect to Yellow Network
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-gray-400">Connected</span>
                      <button onClick={disconnect} className="text-xs text-red-400 hover:text-red-300">Disconnect</button>
                    </div>
                    <p className="text-xs text-gray-400 mb-2">
                      {yellowUserAddress ? `${yellowUserAddress.slice(0, 6)}...${yellowUserAddress.slice(-4)}` : "Connected"}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">Balance:</span>
                      <span className="text-sm font-medium text-yellow-400">{yellowBalance.toFixed(2)} YELLOW_TEST_USD</span>
                    </div>

                    {/* Profit/Loss */}
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-gray-400">Profit/Loss:</span>
                      <span className={`text-sm font-medium ${pnlDisplay >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {pnlDisplay >= 0 ? "+" : ""}${formatUSD(pnlDisplay)}
                      </span>
                    </div>
                    {yellowBalance === 0 && (
                      <button
                        onClick={() => requestTestTokens(10)}
                        disabled={isYellowLoading}
                        className="w-full mt-2 bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded text-xs disabled:opacity-50"
                      >
                        {isYellowLoading ? "Requesting..." : "Request Test Tokens"}
                      </button>
                    )}

                    {yellowBalance > 0 && (
                      <div className="mt-3 space-y-2">
                        <button
                          onClick={async () => {
                            const result = await withdrawProfit(yellowBalance * 0.5);
                            setToast({
                              type: "info",
                              message: result.success
                                ? `Withdrawn ${(yellowBalance * 0.5).toFixed(2)} YELLOW_TEST_USD to your wallet`
                                : result.error || "Withdrawal failed",
                            });
                          }}
                          disabled={isYellowLoading}
                          className="w-full bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded text-xs disabled:opacity-50"
                        >
                          {isYellowLoading ? "Withdrawing..." : "Withdraw 50%"}
                        </button>

                        <button
                          onClick={async () => {
                            const result = await settleSession();
                            setToast({
                              type: "info",
                              message: result.success
                                ? "Session settled! All profits withdrawn to your wallet."
                                : result.error || "Session settlement failed",
                            });
                          }}
                          disabled={isYellowLoading}
                          className="w-full bg-purple-500 hover:bg-purple-600 text-white px-3 py-1 rounded text-xs disabled:opacity-50"
                        >
                          {isYellowLoading ? "Settling..." : "Settle Session"}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {yellowError && (
                  <div className="mt-2 p-2 bg-red-900/30 border border-red-700/50 rounded text-xs text-red-300">
                    {yellowError}
                    <button onClick={clearError} className="ml-2 text-red-400 hover:text-red-300">×</button>
                  </div>
                )}
              </div>

              {/* Quick amounts */}
              <div>
                <div className="text-xs text-gray-500 mb-2">Quick Amounts</div>
                <div className="flex flex-wrap gap-2">
                  {QUICK_BETS.map((amt) => (
                    <button
                      key={amt}
                      onClick={() => setBetAmount(amt)}
                      className={`px-3 py-1.5 rounded border text-xs font-mono transition ${
                        betAmount === amt ? "border-amber-400 text-amber-300 bg-amber-500/10" : "border-gray-700 hover:border-amber-500/40"
                      }`}
                    >
                      ${amt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom amount */}
              <div className="mt-4">
                <div className="text-xs text-gray-500 mb-2">Custom Amount (USD)</div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={MIN_BET}
                    step="0.25"
                    value={betAmount}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      const clamped = Number.isFinite(v) ? Math.max(MIN_BET, Math.min(v, userBalance)) : MIN_BET;
                      setBetAmount(fromCents(toCents(clamped)));
                    }}
                    className="w-full bg-black/30 border border-gray-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-amber-500/60"
                  />
                  <span className="text-xs text-gray-500">USD</span>
                </div>
                <div className="text-[11px] text-gray-500 mt-1">Click a future cell to place this amount.</div>
              </div>

              {/* Divider */}
              <div className="h-px bg-gray-800/60 my-4" />

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-black/20 border border-gray-800 rounded p-3">
                  <div className="text-[11px] text-gray-500 mb-1">{isYellowConnected ? "Yellow Balance" : "Balance"}</div>
                  <div className="font-mono font-semibold">${formatUSD(userBalance)}</div>
                  {isYellowConnected && (
                    <div className="text-[10px] text-yellow-400 flex items-center gap-1 mt-1">
                      <Zap className="h-3 w-3" /> Zero gas fees
                    </div>
                  )}
                </div>
                <div className="bg-black/20 border border-gray-800 rounded p-3">
                  <div className="text-[11px] text-gray-500 mb-1">P/L</div>
                  <div className={`font-mono font-semibold ${pnlDisplay >= 0 ? "text-amber-400" : "text-red-400"}`}>
                    {pnlDisplay >= 0 ? "+" : "-"}${formatUSD(Math.abs(pnlDisplay))}
                  </div>
                </div>
                <div className="bg-black/20 border border-gray-800 rounded p-3">
                  <div className="text-[11px] text-gray-500 mb-1">Total Winnings</div>
                  <div className="font-mono font-semibold text-emerald-300">${formatUSD(totalWinnings)}</div>
                </div>
                <div className="bg-black/20 border border-gray-800 rounded p-3">
                  <div className="text-[11px] text-gray-500 mb-1">Total Staked</div>
                  <div className="font-mono font-semibold text-gray-300">${formatUSD(totalStaked)}</div>
                </div>
                <div className="bg-black/20 border border-gray-800 rounded p-3">
                  <div className="text-[11px] text-gray-500 mb-1">Wins</div>
                  <div className="font-mono font-semibold">{wins}</div>
                </div>
                <div className="bg-black/20 border border-gray-800 rounded p-3">
                  <div className="text-[11px] text-gray-500 mb-1">Win Rate</div>
                  <div className="font-mono font-semibold">{completedBets ? `${winRate.toFixed(1)}%` : "—"}</div>
                </div>
              </div>
            </div>
          </aside>
        </div>

        {/* Bets table */}
        <div className="mt-8">
          <section className="bg-gray-900/30 border border-gray-800/50 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-200 mb-3">Bets</h3>
            <BetsTable activeBets={activeBets} betHistory={betHistory} />
          </section>
        </div>
      </div>
    </div>
  );
}
