"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

/* ---------- Types ---------- */
export type LBPlayer = { id: string; name: string; color: string; width?: number; z?: number };

type Props = {
  players: LBPlayer[];
  /** latest absolute profit/loss per player (e.g., { you: 12.5, alpha: 9.2 }) */
  latestProfits: Record<string, number>;
  /** increment this when a round settles (keeps chart in sync with your 5s cadence) */
  settleSignal: number;
  /** window length */
  points?: number;
  /** EMA smoothing factor [0..1], higher = smoother (applies to non-step ids) */
  ema?: number;
  /** chart height */
  height?: number | string;
  /** show crosshair + tooltip */
  interactive?: boolean;
  /** players that should step instantly to raw value on settle (no EMA, no tween) */
  stepIds?: string[];
  /** tween only the non-step lines */
  tweenOthers?: boolean;
  /** tween duration for non-step lines */
  tweenMs?: number;
};

/* ---------- Utils ---------- */
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function niceTicks(min: number, max: number, count = 5) {
  if (!isFinite(min) || !isFinite(max)) return [0, 1];
  if (min === max) max = min + 1;
  const span = max - min;
  const step0 = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const err = step0 / mag;
  const step = err >= 7 ? 10 * mag : err >= 3 ? 5 * mag : err >= 1.5 ? 2 * mag : mag;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + 1e-9; v += step) ticks.push(v);
  return ticks;
}

function toSmoothPath(points: Array<{ x: number; y: number }>, tension = 0.55) {
  if (points.length < 2) return "";
  const t = tension / 6;
  const path: string[] = [`M ${points[0].x},${points[0].y}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || points[i + 1];
    const c1x = p1.x + (p2.x - p0.x) * t;
    const c1y = p1.y + (p2.y - p0.y) * t;
    const c2x = p2.x - (p3.x - p1.x) * t;
    const c2y = p2.y - (p3.y - p1.y) * t;
    path.push(`C ${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`);
  }
  return path.join(" ");
}

function lerpSeries(a: number[], b: number[], t: number) {
  const n = Math.min(a.length, b.length);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

/* ---------- Component ---------- */
export default function LeaderboardCombinedChart({
  players,
  latestProfits,
  settleSignal,
  points = 64,
  ema = 0.85,
  height = 420,
  interactive = true,
  stepIds = ["you"],
  tweenOthers = true,
  tweenMs = 700,
}: Props) {
  // init window using current profits (or 0 if missing)
  const [series, setSeries] = useState<Record<string, number[]>>(() => {
    const init: Record<string, number[]> = {};
    players.forEach((p) => {
      const base = latestProfits[p.id] ?? 0;
      init[p.id] = Array.from({ length: points }, () => base);
    });
    return init;
  });

  // ensure new players have a series
  useEffect(() => {
    setSeries((prev) => {
      const next: Record<string, number[]> = { ...prev };
      players.forEach((p) => {
        if (!next[p.id]) {
          const base = latestProfits[p.id] ?? 0;
          next[p.id] = Array.from({ length: points }, () => base);
        }
      });
      return next;
    });
  }, [players, points, latestProfits]);

  // EMA state (for non-step ids)
  const emaRef = useRef<Record<string, number>>({});
  useEffect(() => {
    const init: Record<string, number> = {};
    players.forEach((p) => (init[p.id] = series[p.id]?.[series[p.id].length - 1] ?? 0));
    emaRef.current = init;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // once at mount

  // tween state
  const fromRef = useRef<Record<string, number[]>>(series);
  const toRef = useRef<Record<string, number[]>>(series);
  const tRef = useRef(1);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  // on each settle: push latest profits; stepIds go raw (no EMA) and no tween
  useEffect(() => {
    const stepSet = new Set(stepIds);

    // compute new target series
    const target: Record<string, number[]> = {};
    players.forEach((p) => {
      const pid = p.id;
      const arr = series[pid] ?? Array.from({ length: points }, () => 0);
      const prevSmooth = emaRef.current[pid] ?? arr[arr.length - 1] ?? 0;
      const raw = latestProfits[pid] ?? prevSmooth;

      // if this pid should step, use raw; else EMA
      const nextVal = stepSet.has(pid) ? raw : ema * prevSmooth + (1 - ema) * raw;
      if (!stepSet.has(pid)) emaRef.current[pid] = nextVal;

      const tail = arr.slice(1);
      tail.push(nextVal);
      target[pid] = tail;
    });

    // if tween is disabled for others entirely, just set immediately
    if (!tweenOthers) {
      setSeries(target);
      fromRef.current = target;
      toRef.current = target;
      tRef.current = 1;
      return;
    }

    // otherwise tween only non-step ids; step ids jump instantly
    fromRef.current = series;
    toRef.current = target;
    tRef.current = 0;

    const DURATION = Math.max(0, tweenMs);
    const loop = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = ts - lastTsRef.current;
      lastTsRef.current = ts;

      if (tRef.current < 1) {
        tRef.current = Math.min(1, tRef.current + (DURATION ? dt / DURATION : 1));
        const eased = easeOutCubic(tRef.current);

        const blended: Record<string, number[]> = {};
        for (const pid of Object.keys(toRef.current)) {
          if (stepSet.has(pid)) {
            // step lines: snap to target immediately
            blended[pid] = toRef.current[pid];
          } else {
            blended[pid] = DURATION ? lerpSeries(fromRef.current[pid], toRef.current[pid], eased) : toRef.current[pid];
          }
        }
        setSeries(blended);
        rafRef.current = requestAnimationFrame(loop);
      } else {
        setSeries(toRef.current);
        lastTsRef.current = null;
      }
    };

    rafRef.current && cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settleSignal, players, latestProfits, ema, points, tweenOthers, tweenMs, stepIds]);

  // y domain & standings
  const { minY, maxY, latest } = useMemo(() => {
    let minV = Number.POSITIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;
    Object.values(series).forEach((arr) => {
      for (const v of arr) {
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
    });
    if (!isFinite(minV) || !isFinite(maxV)) { minV = 0; maxV = 1; }
    const pad = (maxV - minY0(minV, maxV)) * 0.12 + 0.6; // guard against tiny ranges
    const lo = minV - pad;
    const hi = Math.max(lo + 1, maxV + pad);

    const latest = players
      .map((p) => ({ ...p, val: series[p.id]?.[series[p.id].length - 1] ?? 0 }))
      .sort((a, b) => b.val - a.val);

    return { minY: lo, maxY: hi, latest };
  }, [series, players]);

  function minY0(minV: number, maxV: number) {
    return Number.isFinite(minV) && Number.isFinite(maxV) ? minV : 0;
  }

  const valueToY = (val: number) => {
    const t = (val - minY) / (maxY - minY || 1);
    return clamp(100 - t * 100, 0, 100);
  };

  const paths = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of players) {
      const arr = series[p.id] ?? [];
      const n = arr.length || 1;
      const pts = arr.map((v, i) => ({ x: (i / (n - 1)) * 100, y: valueToY(v) }));
      map[p.id] = toSmoothPath(pts, 0.55);
    }
    return map;
  }, [series, players, minY, maxY]);

  // hover
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const onMove = (e: React.MouseEvent) => {
    if (!interactive || !chartRef.current) return;
    const rect = chartRef.current.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left, 0, rect.width);
    const id0 = players[0]?.id ?? "";
    const len = series[id0]?.length ?? points;
    const idx = Math.round((x / rect.width) * (len - 1));
    setHoverIdx(idx);
  };
  const onLeave = () => setHoverIdx(null);

  const hoverRows = useMemo(() => {
    if (hoverIdx == null) return null;
    const rows = players.map((p) => ({ ...p, val: series[p.id]?.[hoverIdx] ?? 0 }));
    rows.sort((a, b) => b.val - a.val);
    return rows;
  }, [hoverIdx, series, players]);

  const ticks = useMemo(() => niceTicks(minY, maxY, 5), [minY, maxY]);

  const seriesLen = series[players[0]?.id ?? ""]?.length ?? points;

  return (
    <div className="relative bg-gray-900/30 border border-gray-800/60 rounded-xl overflow-hidden">
      <div
        ref={chartRef}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        className="relative"
        style={{ height: typeof height === "number" ? `${height}px` : height }}
      >
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          role="img"
          aria-label="Leaderboard PnL chart"
        >
          <defs>
            {players.map((p) => (
              <linearGradient key={p.id} id={`grad-${p.id}`} x1="0" x2="100" y1="0" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor={p.color} stopOpacity="0.25" />
                <stop offset="70%" stopColor={p.color} stopOpacity="0.9" />
                <stop offset="100%" stopColor={p.color} stopOpacity="1" />
              </linearGradient>
            ))}
            <filter id="glow-you">
              <feGaussianBlur stdDeviation="1.2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* grid */}
          {ticks.map((t, i, arr) => {
            const y = clamp(100 - ((t - minY) / (maxY - minY || 1)) * 100, 0, 100);
            const edge = i === 0 || i === arr.length - 1;
            return (
              <g key={i}>
                <line x1="0" x2="100" y1={y} y2={y} stroke={edge ? "#1f2937" : "#111827"} strokeWidth="0.5" />
                <text x="0.8" y={y - 1} fontSize="2.6" fill="#9CA3AF">{t.toFixed(0)}</text>
              </g>
            );
          })}

          {/* NOW divider at right */}
          <line x1="100" x2="100" y1="0" y2="100" stroke="#9CA3AF" strokeWidth="0.6" strokeDasharray="1.4 1.4" opacity="0.7" />

          {/* lines */}
          {players
            .slice()
            .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
            .map((p) => (
              <path
                key={p.id}
                d={paths[p.id]}
                fill="none"
                stroke={`url(#grad-${p.id})`}
                strokeWidth={p.width ?? 1.8}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                opacity={p.id === "you" ? 1 : 0.92}
                filter={p.id === "you" ? "url(#glow-you)" : undefined}
              />
            ))}

          {/* end dots + labels */}
          {players.map((p) => {
            const last = series[p.id]?.[seriesLen - 1] ?? 0;
            const y = valueToY(last);
            const isYou = p.id === "you";
            return (
              <g key={`${p.id}-dot`}>
                <circle cx="100" cy={y} r={isYou ? 2.3 : 1.8} fill={p.color} />
                <text x="98" y={y - 2.5} textAnchor="end" fontSize="3" fill={p.color}>
                  {p.name}
                </text>
              </g>
            );
          })}

          {/* hover */}
          {interactive && hoverIdx != null && (
            <line
              x1={(hoverIdx / (seriesLen - 1)) * 100}
              x2={(hoverIdx / (seriesLen - 1)) * 100}
              y1="0"
              y2="100"
              stroke="#F59E0B"
              strokeOpacity="0.35"
              strokeWidth="0.5"
              strokeDasharray="1.2 1.2"
            />
          )}
        </svg>

        {/* tooltip */}
        {interactive && hoverRows && (
          <div className="absolute top-2 left-2 rounded-md bg-black/60 backdrop-blur px-2.5 py-2 ring-1 ring-white/5">
            <div className="text-[10px] text-gray-400 mb-1 font-mono">
              t-{(seriesLen - 1 - (hoverIdx ?? 0)).toString().padStart(2, "0")}
            </div>
            <div className="space-y-1">
              {hoverRows.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="inline-block h-2 w-2 rounded-full ring-1 ring-black/20" style={{ background: r.color }} />
                    <span className={r.id === "you" ? "text-amber-300" : "text-gray-200"}>{r.name}</span>
                  </div>
                  <span className="font-mono text-xs text-gray-300">{r.val.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* mini standings footer */}
      <div className="px-3 py-2 border-t border-gray-800/60 bg-black/20">
        <div className="flex flex-wrap gap-3 text-xs">
          {latest.map((l, i) => (
            <div key={l.id} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full ring-1 ring-black/20" style={{ background: l.color }} />
              <span className={l.id === "you" ? "text-amber-300 font-medium" : "text-gray-300"}>
                {i + 1}. {l.name}
              </span>
              <span className="font-mono text-gray-400">{l.val.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
