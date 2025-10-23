/* eslint-disable @typescript-eslint/no-explicit-any */
/* ===== constants ===== */
export const VISIBLE_ROUNDS = 12;
export const GRAPH_COLS = VISIBLE_ROUNDS / 2;
export const CURRENT_COL = GRAPH_COLS;
export const REVEAL_EVERY_SECONDS = 5;
export const REVEAL_MS = REVEAL_EVERY_SECONDS * 1000;

export const MIN_BET = 0.25;
export const QUICK_BETS = [0.25, 0.5, 1, 2, 5, 10, 25, 50] as const;

/* ===== PYTH config ===== */
export const HERMES_HTTP = "https://hermes.pyth.network";
export const PYTH_IDS = {
  BTCUSD: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETHUSD: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  SOLUSD: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
} as const;

/* ===== helpers ===== */
export const canonId = (id: string) => id.toLowerCase().replace(/^0x/, "");

export function toCents(n: number) { return Math.round(n * 100); }
export function fromCents(c: number) { return c / 100; }
export function formatUSD(n: number, opts: Intl.NumberFormatOptions = {}) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2, ...opts });
}

/* Rounds */
export type Bucket = { id: number; label: string; bets: number; userBet: number | null };
export type Round = {
  id: number;
  revealed: boolean;
  settled: boolean;
  price: number | null;
  changePct: number | null;
  winningBucket: number | null;
  buckets: Bucket[];
};

export function newRound(id: number): Round {
  return {
    id,
    revealed: false,
    settled: false,
    price: null,
    changePct: null,
    winningBucket: null,
    buckets: [
      { id: 0, label: "Strong Bull", bets: Math.floor(Math.random() * 50) + 10, userBet: null },
      { id: 1, label: "Bull",        bets: Math.floor(Math.random() * 40) + 10, userBet: null },
      { id: 2, label: "Bear",        bets: Math.floor(Math.random() * 40) + 10, userBet: null },
      { id: 3, label: "Strong Bear", bets: Math.floor(Math.random() * 50) + 10, userBet: null },
    ],
  };
}
export function seedRounds(startId: number) {
  return Array.from({ length: VISIBLE_ROUNDS }, (_, i) => newRound(startId + i));
}

/* thresholds (basis points) */
const STRONG_BP = 0.5;
const WEAK_BP   = 0.015;
const STRONG_PCT = STRONG_BP * 0.01; // 0.005 %
const WEAK_PCT   = WEAK_BP   * 0.01; // 0.0015 %

export function bucketFromChange(pct: number, tieBucket: number | null) {
  if (pct >= STRONG_PCT)  return 0; // Strong Bull
  if (pct >= WEAK_PCT)    return 1; // Bull
  if (pct <= -STRONG_PCT) return 3; // Strong Bear
  if (pct <= -WEAK_PCT)   return 2; // Bear
  return tieBucket ?? 1; // flat-ish
}
export const bucketCenterY = (bucket: number) => bucket * 25 + 12.5;

/* Hermes latest parser */
export function pickPriceFromHermesObject(obj: any): { id?: string; price?: number } | null {
  if (!obj) return null;
  const pf = obj.price_feed ?? obj;
  const id = pf.id ?? pf.price_feed_id ?? pf.feed_id;
  const pObj = pf.price ?? pf.latest_price ?? pf.price_info;
  if (!pObj || pObj.price == null || pObj.expo == null) return null;
  const real = Number(pObj.price) * Math.pow(10, Number(pObj.expo));
  if (!Number.isFinite(real)) return null;
  return { id, price: real };
}

/* pending stake helper */
export function getPendingStakeTotal(rounds: Array<Round>) {
  let t = 0;
  for (const r of rounds) {
    if (!r.settled) {
      const ub = r.buckets.find((b) => b.userBet != null);
      if (ub) t += ub.userBet ?? 0;
    }
  }
  return t;
}
