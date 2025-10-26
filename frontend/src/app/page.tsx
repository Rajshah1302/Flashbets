/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Clock, Activity, ShieldCheck, Wallet as WalletIcon } from "lucide-react";
import LeaderboardCombinedChart, { LBPlayer } from "@/components/Leaderboard";
import NavBar from "@/components/Navbar";
import BetsTable from "@/components/HistoryTable";
import MarketViewToggle from "@/components/MarketViewToggle";
import usePythLatestREST from "@/hooks/usePyth";
import useWalletViem from "@/hooks/useWallet";
import type { Address } from "viem";
import {
  GRAPH_COLS,
  CURRENT_COL,
  REVEAL_EVERY_SECONDS,
  MIN_BET,
  QUICK_BETS,
  PYTH_IDS,
  canonId,
  fromCents,
  toCents,
  formatUSD,
  newRound,
  seedRounds,
  bucketFromChange,
  bucketCenterY,
  getPendingStakeTotal,
} from "@/lib/market";
import {
  createAuthRequestMessage,
  createAuthVerifyMessage,
  createEIP712AuthMessageSigner,
  parseAnyRPCResponse,
  RPCMethod,
  type AuthChallengeResponse,
  type AuthRequestParams,
  createECDSAMessageSigner,
  createGetLedgerBalancesMessage,
  type GetLedgerBalancesResponse,
  type BalanceUpdateResponse,
} from "@erc7824/nitrolite";
import {
  generateSessionKey,
  getStoredSessionKey,
  storeSessionKey,
  removeSessionKey,
  storeJWT,
  removeJWT,
  type SessionKey,
} from "@/lib/utils";
import { webSocketService, type WsStatus } from "@/lib/websocket";

/* -------------------------------------------------
   Small presentational helpers for a "premium" look
--------------------------------------------------*/

// Frosted / glass card with soft ring + subtle glow
function GlassCard({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={
        "relative rounded-2xl bg-white/[0.03] backdrop-blur-xl ring-1 ring-white/10 shadow-[0_30px_120px_-20px_rgba(0,0,0,0.8)] " +
        className
      }
    >
      {children}
    </div>
  );
}

// Soft background FX (radial brand glows + faint grid sheen)
function BackgroundFX() {
  return (
    <>
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(251,191,36,0.10)_0%,rgba(0,0,0,0)_60%)]" />
      <div className="pointer-events-none fixed inset-0 mix-blend-screen bg-[radial-gradient(circle_at_80%_20%,rgba(16,185,129,0.07)_0%,rgba(0,0,0,0)_60%)]" />
      <div className="pointer-events-none fixed inset-0 opacity-[0.07] [mask-image:radial-gradient(circle_at_center,black,transparent_70%)] bg-[repeating-conic-gradient(from_0deg,rgba(255,255,255,0.04)_0deg,rgba(255,255,255,0.04)_2deg,transparent_2deg,transparent_4deg)]" />
    </>
  );
}

export default function PredictionMarketUI() {
  // ---------------------------------------------
  // DATA / STATE (unchanged logic)
  // ---------------------------------------------

  const markets = [
    { id: 0, name: "BTC/USD", icon: "₿", priceId: canonId(PYTH_IDS.BTCUSD) },
    { id: 1, name: "ETH/USD", icon: "Ξ", priceId: canonId(PYTH_IDS.ETHUSD) },
    { id: 2, name: "SOL/USD", icon: "◎", priceId: canonId(PYTH_IDS.SOLUSD) },
  ] as const;

  const {
    account,
    walletClient,
    isConnecting,
    error,
    connectWallet,
    disconnect,
    setError,
  } = useWalletViem();
  const isWalletConnected = !!account;
  const formatAddress = (a: Address) => `${a.slice(0, 6)}...${a.slice(-4)}`;

  const [wsStatus, setWsStatus] = useState<WsStatus>("Disconnected");
  const [ledgerBalances, setLedgerBalances] = useState<any>(null);
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState(0);

  const pythPrices = usePythLatestREST(
    markets.map((m) => m.priceId),
    1000
  );
  const selectedPriceId = markets.find((m) => m.id === selectedMarket)!.priceId;
  const selectedLivePrice = pythPrices[selectedPriceId];

  const [userBalance, setUserBalance] = useState<number>(10);
  const userBalanceRef = useRef(userBalance);
  useEffect(() => {
    userBalanceRef.current = userBalance;
  }, [userBalance]);

  const initialBalanceRef = useRef<number>(userBalance);
  useEffect(() => {
    if (initialBalanceRef.current == null)
      initialBalanceRef.current = userBalance;
  }, []);

  const AUTH_SCOPE = "flashbets.com";
  const APP_NAME = "Flashbets";
  const SESSION_DURATION = 3600;
  const getAuthDomain = () => ({ name: "Flashbets" });

  const [betAmount, setBetAmount] = useState<number>(5);
  const [totalStaked, setTotalStaked] = useState(0);
  const [totalWinnings, setTotalWinnings] = useState(0);
  const [timeLeft, setTimeLeft] = useState(REVEAL_EVERY_SECONDS);
  const [rounds, setRounds] = useState(() => seedRounds(10423));
  const [wins, setWins] = useState(0);
  const [completedBets, setCompletedBets] = useState(0);

  const [sessionKey, setSessionKey] = useState<SessionKey | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sessionExpireTimestamp, setSessionExpireTimestamp] =
    useState<string>("");
  const [authStatus, setAuthStatus] = useState<
    "idle" | "pending" | "success" | "error"
  >("idle");
  const [authMessage, setAuthMessage] = useState("");

  type HistoryRow = {
    roundId: number;
    label: string;
    amount: number;
    payout: number;
    profit: number;
    result: "win" | "lose";
    price: number;
    changePct: number;
  };
  const [betHistory, setBetHistory] = useState<HistoryRow[]>([]);

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

  const latestPriceRef = useRef(0);
  const prevRevealPriceRef = useRef<number | null>(null);
  const prevWinBucketRef = useRef<number | null>(null);
  const roundsRef = useRef(rounds);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRevealAtRef = useRef(0);
  const [priceHistory, setPriceHistory] = useState([0]);

  useEffect(() => {
    if (typeof selectedLivePrice === "number" && selectedLivePrice > 0) {
      latestPriceRef.current = selectedLivePrice;
      if (priceHistory.length === 1 && priceHistory[0] === 0) {
        setPriceHistory([selectedLivePrice]);
        prevRevealPriceRef.current = selectedLivePrice;
      }
    }
  }, [selectedLivePrice]);
  useEffect(() => {
    roundsRef.current = rounds;
  }, [rounds]);

  const [viewMode, setViewMode] = useState<"betting" | "leaderboard">(
    "betting"
  );

  const leaderboardPlayers: LBPlayer[] = useMemo(
    () => [
      { id: "alpha", name: "Alpha", color: "#60a5fa", width: 1.8, z: 1 },
      { id: "blaze", name: "Blaze", color: "#f472b6", width: 1.8, z: 2 },
      { id: "nexus", name: "Nexus", color: "#34d399", width: 1.8, z: 3 },
      { id: "you", name: "You", color: "#f59e0b", width: 2.4, z: 4 },
    ],
    []
  );

  const othersPnlRef = useRef<Record<string, number>>({
    alpha: 8.5,
    blaze: 6.2,
    nexus: 5.1,
  });
  const [latestLeaderProfits, setLatestLeaderProfits] = useState<
    Record<string, number>
  >({
    alpha: othersPnlRef.current.alpha,
    blaze: othersPnlRef.current.blaze,
    nexus: othersPnlRef.current.nexus,
    you: 0,
  });
  const [settleCounter, setSettleCounter] = useState(0);

  // reset state when switching markets
  useEffect(() => {
    setPriceHistory([0]);
    latestPriceRef.current = 0;
    prevRevealPriceRef.current = null;
    prevWinBucketRef.current = null;
    setRounds(seedRounds(10423));
    setTimeLeft(REVEAL_EVERY_SECONDS);
    lastRevealAtRef.current = 0;
    setWins(0);
    setCompletedBets(0);
    setTotalStaked(0);
    setTotalWinnings(0);
    setBetHistory([]);
    othersPnlRef.current = { alpha: 8.5, blaze: 6.2, nexus: 5.1 };
    setLatestLeaderProfits({ ...othersPnlRef.current, you: 0 });
    setSettleCounter(0);
  }, [selectedMarket]);

  // interval tick for round resolution
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          const now = Date.now();
          if (
            now - lastRevealAtRef.current <
            REVEAL_EVERY_SECONDS * 1000 - 50
          )
            return REVEAL_EVERY_SECONDS;
          lastRevealAtRef.current = now;
          const spot = latestPriceRef.current || 0;
          const baseline = prevRevealPriceRef.current ?? spot;
          const changePct =
            baseline > 0 ? ((spot - baseline) / baseline) * 100 : 0;
          const winningBucket = bucketFromChange(
            changePct,
            prevWinBucketRef.current
          );
          const i = CURRENT_COL;
          const snapshot = roundsRef.current[i];
          let nextUserBalance = userBalanceRef.current;
          if (snapshot && !snapshot.settled) {
            const totalPool = snapshot.buckets.reduce(
              (s, b) => s + b.bets,
              0
            );
            const winnerPool = snapshot.buckets[winningBucket].bets;
            const userBetBucket = snapshot.buckets.find(
              (b) => b.userBet != null
            );
            if (userBetBucket) {
              const stake = userBetBucket.userBet!;
              setCompletedBets((c) => c + 1);
              if (userBetBucket.id === winningBucket) {
                const payout = totalPool * (stake / winnerPool);
                nextUserBalance = userBalanceRef.current + payout;
                setUserBalance(nextUserBalance);
                setWins((w) => w + 1);
                setToast({ type: "win", amount: payout - stake });
                setTotalWinnings((tw) => tw + payout);
              } else setToast({ type: "lose", amount: stake });
              setBetHistory((prevH) => [
                ...prevH.slice(-99),
                {
                  roundId: snapshot.id,
                  label: userBetBucket.label,
                  amount: stake,
                  payout:
                    userBetBucket.id === winningBucket
                      ? totalPool * (stake / winnerPool)
                      : 0,
                  profit:
                    userBetBucket.id === winningBucket
                      ? totalPool * (stake / winnerPool) -
                        stake
                      : -stake,
                  result:
                    userBetBucket.id === winningBucket
                      ? "win"
                      : "lose",
                  price: spot,
                  changePct,
                },
              ]);
            }
          }
          const nextRounds = (() => {
            let next = roundsRef.current.slice();
            if (next[i])
              next[i] = {
                ...next[i],
                revealed: true,
                settled: true,
                price: spot,
                changePct,
                winningBucket,
              };
            const lastId = next[next.length - 1].id;
            next = next.slice(1);
            next.push(newRound(lastId + 1));
            return next;
          })();
          setRounds(nextRounds);
          setPriceHistory((ph) => {
            const extended = [...ph, spot];
            while (extended.length > 64) extended.shift();
            return extended;
          });
          prevWinBucketRef.current = winningBucket;
          prevRevealPriceRef.current = spot;
          const drift = () => (Math.random() - 0.45) * 100;
          othersPnlRef.current.alpha += drift();
          othersPnlRef.current.blaze += drift();
          othersPnlRef.current.nexus += drift();
          const pendingAfter = getPendingStakeTotal(nextRounds);
          const youPnlExact =
            nextUserBalance +
            pendingAfter -
            initialBalanceRef.current;
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
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [selectedMarket]);

  const handleBet = async (roundIndex: number, bucketId: number) => {
    const r = rounds[roundIndex];
    if (!r || r.revealed) return;
    if (roundIndex <= CURRENT_COL) return;
    const alreadyPlaced = r.buckets.some(
      (b) => b.userBet != null && b.id !== bucketId
    );
    if (alreadyPlaced)
      return setToast({
        type: "info",
        message: "You already placed a bet this round.",
      });
    const v = Number.isFinite(betAmount) ? betAmount : MIN_BET;
    const clamped = Math.max(MIN_BET, Math.min(v, userBalance));
    const amt = fromCents(toCents(clamped));
    if (amt <= 0) return;
    setUserBalance((prev) => fromCents(toCents(prev) - toCents(amt)));
    setTotalStaked((ts) => ts + amt);
    setRounds((prevR) => {
      const updated = prevR.slice();
      const round = updated[roundIndex];
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
    // webSocketService.send("bet/place", {
    //   roundId: r.id,
    //   bucketId,
    //   amount: amt,
    //   market: markets[selectedMarket].name,
    //   address: account ?? null,
    // });
    setToast({ type: "info", message: "Bet placed (demo mode)" });
  };

  const pendingStakeTotal = useMemo(
    () => getPendingStakeTotal(rounds),
    [rounds]
  );
  const pnlDisplay =
    userBalance + pendingStakeTotal - initialBalanceRef.current;
  const roundProgress =
    (REVEAL_EVERY_SECONDS - timeLeft) / REVEAL_EVERY_SECONDS;
  const winRate = completedBets ? (wins / completedBets) * 100 : 0;
  const activeBets = useMemo(() => {
    return rounds
      .map((r, idx) => ({ r, idx }))
      .filter(({ r }) => !r.settled && r.buckets.some((b) => b.userBet != null))
      .map(({ r }) => {
        const b = r.buckets.find((bb) => bb.userBet != null)!;
        const totalPool = r.buckets.reduce(
          (s, bb) => s + bb.bets,
          0
        );
        const winnerPool = r.buckets[b.id].bets;
        const estPayout =
          totalPool * ((b.userBet ?? 0) / (winnerPool || 1));
        return {
          roundId: r.id,
          label: r.buckets[b.id].label,
          amount: b.userBet ?? 0,
          pool: totalPool,
          estPayout,
        };
      });
  }, [rounds]);

  // session + ws lifecycle
  useEffect(() => {
    const existingSessionKey = getStoredSessionKey();
    if (existingSessionKey) setSessionKey(existingSessionKey);
    else {
      const newSessionKey = generateSessionKey();
      storeSessionKey(newSessionKey);
      setSessionKey(newSessionKey);
    }
    webSocketService.addStatusListener(setWsStatus);
    webSocketService.connect();
    return () => webSocketService.removeStatusListener(setWsStatus);
  }, []);

  const accountRef = useRef<Address | null>(null);
  const walletClientRef = useRef<typeof walletClient>(null);
  const sessionKeyRef = useRef<SessionKey | null>(null);
  const isAuthenticatedRef = useRef(false);
  const sessionExpireRef = useRef<string>("");

  useEffect(() => {
    accountRef.current = account ?? null;
  }, [account]);
  useEffect(() => {
    walletClientRef.current = walletClient ?? null;
  }, [walletClient]);
  useEffect(() => {
    sessionKeyRef.current = sessionKey;
  }, [sessionKey]);
  useEffect(() => {
    isAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated]);
  useEffect(() => {
    sessionExpireRef.current = sessionExpireTimestamp;
  }, [sessionExpireTimestamp]);

  const authInFlightRef = useRef(false);
  const sentVerifyRef = useRef(false);
  const lastAuthKeyRef = useRef<string | null>(null);
  const balancesKeyRef = useRef<string | null>(null);

  // auth over ws
  useEffect(() => {
    if (wsStatus !== "Connected") return;
    if (!account || !walletClient || !sessionKey) return;
    if (isAuthenticatedRef.current || authInFlightRef.current) return;
    const expire = String(
      Math.floor(Date.now() / 1000) + SESSION_DURATION
    );
    const authKey = `${account}:${sessionKey.address}:${expire}`;
    if (lastAuthKeyRef.current === authKey) return;
    lastAuthKeyRef.current = authKey;
    authInFlightRef.current = true;
    sentVerifyRef.current = false;
    setSessionExpireTimestamp(expire);
    setAuthStatus("pending");
    setAuthMessage("Requesting challenge…");
    const authParams: AuthRequestParams = {
      address: account,
      session_key: sessionKey.address,
      app_name: APP_NAME,
      expire,
      scope: AUTH_SCOPE,
      application: account,
      allowances: [],
    };
    createAuthRequestMessage(authParams)
      .then((payload) => webSocketService.send(payload))
      .catch((err) => {
        console.error("[auth] request build failed:", err);
        authInFlightRef.current = false;
        setAuthStatus("error");
        setAuthMessage("Failed to build auth request");
      });
  }, [wsStatus, account, walletClient, sessionKey]);

  // ws message listener
  useEffect(() => {
    const handleMessage = async (data: any) => {
      let response: any;
      try {
        response = parseAnyRPCResponse(JSON.stringify(data));
      } catch {
        if (data?.method === "toast" && data?.params?.message)
          setToast({
            type: "info",
            message: String(data.params.message),
          });
        return;
      }
      switch (response.method) {
        case RPCMethod.AuthChallenge: {
          if (!authInFlightRef.current) return;
          const wc = walletClientRef.current,
            sk = sessionKeyRef.current,
            acc = accountRef.current,
            expire = sessionExpireRef.current;
          if (!wc || !sk || !acc || !expire) return;
          if (sentVerifyRef.current) return;
          setAuthStatus("pending");
          setAuthMessage("Signing challenge…");
          const authParams = {
            scope: AUTH_SCOPE,
            application: wc.account?.address as `0x${string}`,
            participant: sk.address as `0x${string}`,
            expire,
            allowances: [],
          };
          const signer = createEIP712AuthMessageSigner(
            wc,
            authParams,
            getAuthDomain()
          );
          try {
            sentVerifyRef.current = true;
            const verifyPayload = await createAuthVerifyMessage(
              signer,
              response as AuthChallengeResponse
            );
            webSocketService.send(verifyPayload);
          } catch (err) {
            console.error("[auth] verify failed:", err);
            sentVerifyRef.current = false;
            authInFlightRef.current = false;
            setAuthStatus("error");
            setAuthMessage("User rejected or sign error");
          }
          break;
        }
        case RPCMethod.AuthVerify: {
          if (response.params?.success) {
            setIsAuthenticated(true);
            if (response.params.jwtToken)
              storeJWT(response.params.jwtToken);
            setAuthStatus("success");
            setAuthMessage("");
            setToast({
              type: "info",
              message: "Authentication successful!",
            });
          } else {
            setIsAuthenticated(false);
            setAuthStatus("error");
            setAuthMessage(
              response.params?.error ?? "Auth failed"
            );
          }
          authInFlightRef.current = false;
          sentVerifyRef.current = false;
          break;
        }
        case RPCMethod.Error: {
          const errMsg =
            response.params?.error ?? "Unknown error";
          console.error("[ws] error response:", errMsg);
          if (!isAuthenticatedRef.current) {
            removeJWT();
            removeSessionKey();
            setIsAuthenticated(false);
            authInFlightRef.current = false;
            sentVerifyRef.current = false;
            setAuthStatus("error");
            setAuthMessage(errMsg);
          }
          break;
        }
        case RPCMethod.GetLedgerBalances: {
          const list =
            (response as GetLedgerBalancesResponse).params
              ?.ledgerBalances ?? [];
          const map = Object.fromEntries(
            list.map((b) => [b.asset, b.amount])
          );
          setLedgerBalances(map);
          setIsLoadingBalances(false);
          break;
        }
        case RPCMethod.BalanceUpdate: {
          const list =
            (response as BalanceUpdateResponse).params
              ?.balanceUpdates ?? [];
          setLedgerBalances((prev: any) => {
            const base = { ...(prev ?? {}) };
            for (const b of list) base[b.asset] = b.amount;
            return base;
          });
          break;
        }
        default: {
          if (
            response?.method === "toast" &&
            response?.params?.message
          )
            setToast({
              type: "info",
              message: String(response.params.message),
            });
        }
      }
    };
    webSocketService.addMessageListener(handleMessage);
    return () =>
      webSocketService.removeMessageListener(handleMessage);
  }, []);

  // fetch balances once authenticated
  useEffect(() => {
    if (!isAuthenticated || !sessionKey || !account) return;
    const key = `${account}:${sessionKey.address}`;
    if (balancesKeyRef.current === key) return;
    balancesKeyRef.current = key;
    setIsLoadingBalances(true);
    try {
      const signer = createECDSAMessageSigner(
        sessionKey.privateKey
      );
      createGetLedgerBalancesMessage(signer, account)
        .then((payload) => webSocketService.send(payload))
        .catch((err) => {
          console.error("[balances] request build failed:", err);
          setIsLoadingBalances(false);
        });
    } catch (err) {
      console.error("[balances] signer error:", err);
      setIsLoadingBalances(false);
    }
  }, [isAuthenticated, sessionKey, account]);

  // subscribe to market feed
  useEffect(() => {
    // if (wsStatus !== "Connected") return;
    // webSocketService.send("market/subscribe", {
    //   priceId: selectedPriceId,
    //   market: markets[selectedMarket].name,
    // });
  }, [wsStatus, selectedPriceId, selectedMarket]);

  // notify server wallet connected
  useEffect(() => {
    // if (account && wsStatus === "Connected")
    //   webSocketService.send("wallet/connected", {
    //     address: account,
    //   });
  }, [account, wsStatus]);

  // reset auth UI when disconnected wallet
  useEffect(() => {
    if (!account) {
      setIsAuthenticated(false);
      setIsLoadingBalances(false);
      setLedgerBalances(null);
      authInFlightRef.current = false;
      sentVerifyRef.current = false;
      lastAuthKeyRef.current = null;
      balancesKeyRef.current = null;
      setAuthStatus("idle");
      setAuthMessage("");
    }
  }, [account]);

  // gentle "connect wallet" toast
  useEffect(() => {
    if (!isWalletConnected) {
      setToast((prev) =>
        prev?.message ===
        "Connect your wallet to place bets."
          ? prev
          : {
              type: "info",
              message:
                "Connect your wallet to place bets.",
            }
      );
    }
  }, [isWalletConnected]);

  // prettier status dot (adds glow)
  const authBaseDotClass =
    authStatus === "success"
      ? "bg-emerald-400"
      : authStatus === "pending"
      ? "bg-amber-400"
      : authStatus === "error"
      ? "bg-red-500"
      : "bg-gray-500";
  const authDotClass =
    authBaseDotClass + " shadow-[0_0_8px_currentColor]";

  const authLabel =
    authStatus === "success"
      ? "OK"
      : authStatus === "pending"
      ? "Pending"
      : authStatus === "error"
      ? "Failed"
      : "Idle";

  // ---------------------------------------------
  // RENDER
  // ---------------------------------------------

  return (
    <div className="relative min-h-screen bg-black text-zinc-100 antialiased selection:bg-amber-400/20 selection:text-amber-200">
      <BackgroundFX />

      {/* Top nav (your existing NavBar component) */}
      {/* <NavBar /> */}

      {/* Market bar / status bar */}
      <div className="border-b border-white/5 bg-black/40 backdrop-blur-xl ring-1 ring-white/10 relative z-30">
        <div className="max-w-9xl mx-auto px-6">
          <div className="flex items-start md:items-center justify-between gap-4 py-3 flex-col md:flex-row">
            {/* Market selector */}
            <div className="flex flex-wrap gap-2">
              {markets.map((m) => {
                const active = selectedMarket === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelectedMarket(m.id)}
                    className={`relative flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition
                    ring-1 ring-white/10 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.8)]
                    ${
                      active
                        ? "bg-gradient-to-br from-amber-400/15 via-amber-400/5 to-transparent text-amber-300 ring-amber-400/40 shadow-[0_30px_120px_-10px_rgba(251,191,36,0.4)]"
                        : "bg-white/[0.02] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
                    }`}
                  >
                    <span className="text-lg leading-none">
                      {m.icon}
                    </span>
                    <span className="text-zinc-200 font-semibold">
                      {m.name}
                    </span>
                    <span className="text-[11px] text-zinc-500 font-mono">
                      {typeof pythPrices[m.priceId] === "number"
                        ? `$${pythPrices[
                            m.priceId
                          ].toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}`
                        : "—"}
                    </span>

                    {active && (
                      <span className="absolute -bottom-px left-2 right-2 h-[2px] bg-gradient-to-r from-transparent via-amber-400 to-transparent rounded-full" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Status + toggle */}
            <div className="flex flex-wrap items-center gap-3 text-[11px] font-medium text-zinc-400">
              {/* realtime status */}
              <div className="flex items-center gap-2 rounded-full bg-white/[0.03] px-3 py-1.5 ring-1 ring-white/10 shadow-[0_8px_30px_rgba(0,0,0,0.8)]">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    wsStatus === "Connected"
                      ? "bg-emerald-400"
                      : wsStatus === "Connecting"
                      ? "bg-amber-400"
                      : "bg-zinc-600"
                  } shadow-[0_0_8px_currentColor]`}
                />
                <div className="flex items-center gap-1">
                  <Activity className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Realtime: {wsStatus}</span>
                  {wsStatus === "Disconnected" && (
                    <button
                      onClick={() => webSocketService.connect()}
                      className="ml-1 underline text-amber-400 hover:text-amber-300"
                    >
                      Reconnect
                    </button>
                  )}
                </div>
              </div>

              {/* auth status */}
              <div className="flex items-center gap-2 rounded-full bg-white/[0.03] px-3 py-1.5 ring-1 ring-white/10 shadow-[0_8px_30px_rgba(0,0,0,0.8)]">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${authDotClass}`}
                />
                <div className="flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Auth: {authLabel}</span>
                  {authStatus === "error" && authMessage && (
                    <span className="text-red-400 ml-1 max-w-[200px] truncate">
                      ({authMessage})
                    </span>
                  )}
                </div>
              </div>

              {/* mode toggle pill */}
              <div className="rounded-full bg-white/[0.03] px-2 py-1 ring-1 ring-white/10 shadow-[0_8px_30px_rgba(0,0,0,0.8)]">
                <MarketViewToggle
                  mode={viewMode}
                  onChange={setViewMode}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="relative max-w-9xl mx-auto px-6 py-8">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* LEFT COLUMN: chart / grid / leaderboard */}
          <div className="flex-1 min-w-0">
            {/* betting / order-book style board */}
            <div className={viewMode === "betting" ? "block" : "hidden"}>
              <GlassCard className="overflow-hidden">
                {/* header row with rounds */}
                <div className="grid grid-cols-13 border-b border-white/5 bg-black/20">
                  <div className="col-span-1 p-3 text-[11px] font-semibold text-zinc-500 uppercase tracking-wide ring-1 ring-white/[0.03] bg-white/[0.02]">
                    Round
                  </div>
                  {rounds.map((round, idx) => (
                    <div
                      key={round.id}
                      className={`p-3 text-center text-[11px] border-r border-white/5 last:border-r-0 relative ${
                        idx === CURRENT_COL
                          ? "bg-amber-500/5"
                          : ""
                      }`}
                    >
                      <div className="font-mono font-semibold text-zinc-200">
                        #{round.id}
                      </div>
                      {idx === CURRENT_COL && (
                        <div className="text-amber-400 font-medium mt-1 flex items-center justify-center gap-1 animate-pulse">
                          <Clock className="w-3 h-3" /> {timeLeft}s
                        </div>
                      )}
                      {idx === CURRENT_COL && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
                      )}
                    </div>
                  ))}
                </div>

                {/* main prediction grid */}
                <div className="relative">
                  {/* left labels ("Strong Bull", etc.) */}
                  <div className="absolute left-0 top-0 bottom-0 w-23 border-r border-white/5 bg-black/30 backdrop-blur-sm z-10">
                    {[
                      { id: 0, label: "Strong Bull" },
                      { id: 1, label: "Bull" },
                      { id: 2, label: "Bear" },
                      { id: 3, label: "Strong Bear" },
                    ].map((bucket) => {
                      const isBull = bucket.label
                        .toLowerCase()
                        .includes("bull");
                      return (
                        <div
                          key={bucket.id}
                          className="h-32 flex items-center px-3 border-b border-white/5 last:border-b-0"
                        >
                          <div
                            className={`font-semibold text-base ${
                              isBull
                                ? "text-emerald-400"
                                : "text-red-400"
                            }`}
                          >
                            {bucket.label}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* rounds grid */}
                  <div
                    className="ml-23 grid grid-cols-12 relative"
                    style={{ height: "512px" }}
                  >
                    {rounds.map((round, roundIdx) => {
                      const isGraphSide = roundIdx < GRAPH_COLS;
                      const isCurrent = roundIdx === CURRENT_COL;
                      const isPastOrCurrent =
                        roundIdx <= CURRENT_COL;

                      return (
                        <div
                          key={round.id}
                          className={`relative group ${
                            isGraphSide
                              ? ""
                              : "border-r border-white/5 last:border-r-0"
                          }`}
                        >
                          {isGraphSide ? (
                            /* historical / live path viz */
                            <div className="h-full relative">
                              {round.revealed &&
                                typeof round.winningBucket ===
                                  "number" && (
                                  <>
                                    <div
                                      className="absolute left-0 right-0 h-px bg-white/10"
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
                                            stopColor="#fbbf24"
                                            stopOpacity="0.15"
                                          />
                                          <stop
                                            offset="100%"
                                            stopColor="#fbbf24"
                                            stopOpacity="0.05"
                                          />
                                        </linearGradient>
                                      </defs>

                                      {/* golden wedge toward winning bucket */}
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
                                        stroke="#fbbf24"
                                        strokeWidth="1.5"
                                        vectorEffect="non-scaling-stroke"
                                        opacity="0.6"
                                      />
                                      {isCurrent && (
                                        <circle
                                          cx="100"
                                          cy="50"
                                          r="3"
                                          fill="#fbbf24"
                                          style={{
                                            filter:
                                              "drop-shadow(0 0 4px rgba(251,191,36,0.8))",
                                          }}
                                        />
                                      )}
                                    </svg>

                                    {/* hover readout */}
                                    {typeof round.changePct ===
                                      "number" && (
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
                                          className={`backdrop-blur-sm border rounded px-2 py-1 text-[11px] font-mono ring-1 ${
                                            round.changePct >= 0
                                              ? "bg-emerald-500/10 border-emerald-500/30 ring-emerald-500/20"
                                              : "bg-red-500/10 border-red-500/30 ring-red-500/20"
                                          }`}
                                        >
                                          <span
                                            className={
                                              round.changePct >=
                                              0
                                                ? "text-emerald-400"
                                                : "text-red-400"
                                            }
                                          >
                                            {round.changePct >=
                                            0
                                              ? "+"
                                              : ""}
                                            {round.changePct.toFixed(
                                              4
                                            )}
                                            %
                                          </span>
                                          <span className="text-zinc-400 ml-2">
                                            $
                                            {formatUSD(
                                              round.price as number
                                            )}
                                          </span>
                                        </div>
                                      </div>
                                    )}
                                  </>
                                )}
                            </div>
                          ) : (
                            /* future bettable buckets */
                            <div className="h-full grid grid-rows-4">
                              {[0, 1, 2, 3].map((bucketId) => {
                                const cell =
                                  round.buckets[bucketId];
                                const hasBet =
                                  cell.userBet != null;
                                const disabled =
                                  isPastOrCurrent ||
                                  !isWalletConnected;

                                return (
                                  <button
                                    key={bucketId}
                                    onClick={() =>
                                      handleBet(
                                        roundIdx,
                                        bucketId
                                      )
                                    }
                                    disabled={disabled}
                                    className={`border-b border-white/5 last:border-b-0 transition p-3 text-left
                                      ${
                                        hasBet
                                          ? "bg-amber-500/10 ring-1 ring-amber-400/40"
                                          : "hover:bg-amber-500/5 hover:ring-1 hover:ring-amber-400/20"
                                      }
                                      ${
                                        disabled
                                          ? "opacity-40 cursor-not-allowed"
                                          : "cursor-pointer"
                                      }`}
                                  >
                                    <div className="text-[11px] font-mono font-semibold text-zinc-300">
                                      $
                                      {formatUSD(
                                        Number(
                                          cell.bets
                                        )
                                      )}
                                    </div>
                                    {hasBet && (
                                      <div className="text-[11px] text-amber-300 font-medium mt-1">
                                        You: $
                                        {formatUSD(
                                          cell.userBet!
                                        )}
                                      </div>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {isCurrent && (
                            <div className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 bg-gradient-to-r from-amber-300 via-amber-400" />
                          )}

                          {roundIdx === GRAPH_COLS - 1 && (
                            <>
                              <div
                                className="pointer-events-none absolute right-0 top-0 bottom-0 w-[2px] bg-amber-400"
                                style={{
                                  filter:
                                    "drop-shadow(0 0 6px rgba(251,191,36,0.7))",
                                  zIndex: 50,
                                }}
                              />
                              <div
                                className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 h-3 w-3 rounded-full bg-amber-400"
                                style={{
                                  filter:
                                    "drop-shadow(0 0 8px rgba(251,191,36,0.9))",
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
              </GlassCard>
            </div>

            {/* leaderboard / pnl race */}
            <div className={viewMode === "leaderboard" ? "block" : "hidden"}>
              <GlassCard className="p-4 lg:p-6">
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
              </GlassCard>
            </div>
          </div>

          {/* RIGHT COLUMN: bet panel */}
          <aside className="w-full lg:w-80 shrink-0">
            <div className="sticky top-6">
              <GlassCard className="p-5 space-y-6">
                {/* Panel Header */}
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
                  Bet Panel
                </h3>

                {/* Wallet / auth box */}
                <div className="p-4 rounded-xl bg-black/40 ring-1 ring-white/10 shadow-inner shadow-black/40">
                  <div className="flex items-start justify-between mb-3">
                    <span className="text-sm font-medium text-zinc-200 flex items-center gap-1.5">
                      <WalletIcon className="w-4 h-4 text-amber-400" />
                      Wallet
                    </span>
                    {account && (
                      <span className="text-[11px] text-zinc-500 font-mono">
                        {formatAddress(account as Address)}
                      </span>
                    )}
                  </div>

                  {!isWalletConnected || !isAuthenticated ? (
                    <button
                      onClick={connectWallet}
                      disabled={isConnecting}
                      className="w-full rounded-lg text-[13px] font-semibold leading-none text-black shadow-[0_20px_60px_-10px_rgba(251,191,36,0.6)]
                      bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-500 hover:via-amber-400 hover:to-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/60 focus:ring-offset-0"
                    >
                      <div className="px-3 py-2">
                        {!isWalletConnected
                          ? "Connect Wallet"
                          : !isAuthenticated
                          ? "Authenticating..."
                          : "Support"}
                      </div>
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={disconnect}
                        className="w-full rounded-lg bg-white/[0.04] hover:bg-white/[0.07] text-white text-[13px] font-medium leading-none ring-1 ring-white/10 px-3 py-2 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.8)]"
                      >
                        Disconnect
                      </button>
                    </div>
                  )}

                  {error && (
                    <div className="mt-3 text-[11px] rounded-lg bg-red-950/40 ring-1 ring-red-700/40 text-red-300 p-2">
                      {error}
                      <button
                        onClick={() => setError(null)}
                        className="ml-2 text-red-400 hover:text-red-300"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>

                {/* Quick amounts */}
                <div>
                  <div className="text-[11px] text-zinc-500 mb-2 font-medium uppercase tracking-wide">
                    Quick Amounts
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_BETS.map((amt) => (
                      <button
                        key={amt}
                        onClick={() => setBetAmount(amt)}
                        className={`px-3 py-1.5 rounded-lg text-[12px] font-mono font-medium transition
                        ring-1 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.8)]
                        ${
                          betAmount === amt
                            ? "bg-amber-500/10 text-amber-300 ring-amber-400/40 shadow-[0_30px_120px_-10px_rgba(251,191,36,0.4)]"
                            : "bg-white/[0.03] text-zinc-300 ring-white/10 hover:bg-white/[0.06]"
                        }`}
                      >
                        ${amt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom amount */}
                <div>
                  <div className="text-[11px] text-zinc-500 mb-2 font-medium uppercase tracking-wide">
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
                          ? Math.max(
                              MIN_BET,
                              Math.min(v, userBalance)
                            )
                          : MIN_BET;
                        setBetAmount(
                          fromCents(toCents(clamped))
                        );
                      }}
                      className="w-full bg-black/40 rounded-lg px-3 py-2 text-sm font-mono text-zinc-100 placeholder-zinc-500 ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                    />
                    <span className="text-[11px] text-zinc-500">
                      USD
                    </span>
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-1">
                    Click a future cell to place this amount.
                  </div>
                </div>

                <div className="h-px bg-white/10" />

                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-3 text-[11px]">
                  {/* Balance tile */}
                  <div className="bg-white/[0.02] rounded-xl ring-1 ring-white/10 p-3 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.8)]">
                    <div className="text-[10px] text-zinc-500 mb-1 font-medium uppercase tracking-wide">
                      Balance
                    </div>

                    {isAuthenticated ? (
                      <>
                        <div className="font-mono font-semibold text-zinc-100 text-sm leading-none">
                          {isLoadingBalances
                            ? "Loading..."
                            : (() => {
                                const usdcStr =
                                  ledgerBalances?.["USDC"] ??
                                  ledgerBalances?.[
                                    "usdc"
                                  ] ??
                                  "0";
                                const usdc =
                                  Number.parseFloat(
                                    usdcStr || "0"
                                  );
                                return `$${formatUSD(
                                  Number.isFinite(usdc)
                                    ? usdc
                                    : 0
                                )}`;
                              })()}
                        </div>
                        <div className="text-[10px] text-zinc-500 mt-1">
                          Nitrolite (USDC)
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="font-mono font-semibold text-zinc-100 text-sm leading-none">
                          ${formatUSD(userBalance)}
                        </div>
                        <button
                          onClick={() =>
                            setUserBalance((b) => b + 10)
                          }
                          className="mt-2 text-[10px] text-amber-300 hover:text-amber-200 font-medium"
                        >
                          + Add $10 demo funds
                        </button>
                      </>
                    )}
                  </div>

                  {/* P/L tile */}
                  <div className="bg-white/[0.02] rounded-xl ring-1 ring-white/10 p-3 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.8)]">
                    <div className="text-[10px] text-zinc-500 mb-1 font-medium uppercase tracking-wide">
                      P/L
                    </div>
                    <div
                      className={`font-mono font-semibold text-sm leading-none ${
                        pnlDisplay >= 0
                          ? "text-amber-300"
                          : "text-red-400"
                      }`}
                    >
                      {pnlDisplay >= 0 ? "+" : "-"}$
                      {formatUSD(Math.abs(pnlDisplay))}
                    </div>
                  </div>

                  {/* Total Winnings */}
                  <div className="bg-white/[0.02] rounded-xl ring-1 ring-white/10 p-3 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.8)]">
                    <div className="text-[10px] text-zinc-500 mb-1 font-medium uppercase tracking-wide">
                      Total Winnings
                    </div>
                    <div className="font-mono font-semibold text-emerald-300 text-sm leading-none">
                      ${formatUSD(totalWinnings)}
                    </div>
                  </div>

                  {/* Total Staked */}
                  <div className="bg-white/[0.02] rounded-xl ring-1 ring-white/10 p-3 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.8)]">
                    <div className="text-[10px] text-zinc-500 mb-1 font-medium uppercase tracking-wide">
                      Total Staked
                    </div>
                    <div className="font-mono font-semibold text-zinc-300 text-sm leading-none">
                      ${formatUSD(totalStaked)}
                    </div>
                  </div>

                  {/* Wins */}
                  <div className="bg-white/[0.02] rounded-xl ring-1 ring-white/10 p-3 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.8)]">
                    <div className="text-[10px] text-zinc-500 mb-1 font-medium uppercase tracking-wide">
                      Wins
                    </div>
                    <div className="font-mono font-semibold text-zinc-100 text-sm leading-none">
                      {wins}
                    </div>
                  </div>

                  {/* Win Rate */}
                  <div className="bg-white/[0.02] rounded-xl ring-1 ring-white/10 p-3 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.8)]">
                    <div className="text-[10px] text-zinc-500 mb-1 font-medium uppercase tracking-wide">
                      Win Rate
                    </div>
                    <div className="font-mono font-semibold text-zinc-100 text-sm leading-none">
                      {completedBets
                        ? `${winRate.toFixed(1)}%`
                        : "—"}
                    </div>
                  </div>
                </div>
              </GlassCard>
            </div>
          </aside>
        </div>

        {/* Bets / History Table */}
        <div className="mt-8">
          <GlassCard className="p-5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-3 flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
              Bets
            </h3>
            <BetsTable
              activeBets={activeBets}
              betHistory={betHistory}
            />
          </GlassCard>
        </div>
      </div>

      {/* Toast / ephemeral notifications */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100]">
          <div className="rounded-full bg-black/70 backdrop-blur-xl px-4 py-2 text-[13px] font-medium text-white ring-1 ring-white/20 shadow-[0_40px_120px_rgba(251,191,36,0.4)]">
            {toast.message ??
              (toast.type === "win"
                ? `Won $${formatUSD(
                    toast.amount ?? 0
                  )}`
                : toast.type === "lose"
                ? `Lost $${formatUSD(
                    toast.amount ?? 0
                  )}`
                : "")}
          </div>
        </div>
      )}
    </div>
  );
}
