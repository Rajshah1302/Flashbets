"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Flame } from "lucide-react";

const VISIBLE_ROUNDS = 12;
const GRAPH_COLS = VISIBLE_ROUNDS / 2; // left 6 = chart area
const CURRENT_COL = GRAPH_COLS; // index 6 is the center divider
const TARGET_FPS = 10; // ~50ms per update
const STEP_MS = 750 / TARGET_FPS;

type Player = {
  id: string;
  name: string;
  color: string; // stroke color
  width: number; // stroke width
  z: number; // z-index sort for drawing (higher drawn later)
};

type SeriesMap = Record<string, number[]>;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function seedSeries(points = 64, base = 100, jitter = 0.6) {
  const arr = [base];
  for (let i = 1; i < points; i++) {
    const prev = arr[i - 1];
    const step = (Math.random() - 0.5) * jitter;
    arr.push(prev + step);
  }
  return arr;
}

export default function LiveLeaderboardCompetitive() {
  // Top 3 + You
  const players: Player[] = useMemo(
    () => [
      { id: "p1", name: "Alpha", color: "#60a5fa", width: 1.5, z: 1 }, // blue
      { id: "p2", name: "Blaze", color: "#f472b6", width: 1.5, z: 2 }, // pink
      { id: "p3", name: "Nexus", color: "#34d399", width: 1.5, z: 3 }, // green
      { id: "you", name: "You", color: "#f59e0b", width: 2.2, z: 4 }, // amber (focus)
    ],
    []
  );

  // number of samples to fill the left-6 chart smoothly; last point aligns to center divider
  const POINTS = 64;

  const [series, setSeries] = useState<SeriesMap>(() => {
    const init: SeriesMap = {};
    players.forEach((p, i) => {
      init[p.id] = seedSeries(POINTS, 100 + i * 2, 0.6 - i * 0.05);
    });
    return init;
  });

  // Track ranks to flash when “You” overtakes or loses
  const prevRankRef = useRef<number | null>(null);
  const [youPulse, setYouPulse] = useState<"up" | "down" | null>(null);

  // Real-time animation loop (requestAnimationFrame, update ~20 FPS)
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const accRef = useRef(0);

  useEffect(() => {
    const loop = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = ts - lastTsRef.current;
      lastTsRef.current = ts;
      accRef.current += dt;

      while (accRef.current >= STEP_MS) {
        accRef.current -= STEP_MS;

        setSeries((prev) => {
          // compute global mean to add a tiny mean-reversion (keeps range tight/competitive)
          const allVals = Object.values(prev).flat();
          const mean =
            allVals.reduce((s, n) => s + n, 0) / Math.max(1, allVals.length);

          const next: SeriesMap = {};
          for (const pid of Object.keys(prev)) {
            const arr = prev[pid];
            const last = arr[arr.length - 1];

            // jitter & subtle reversion toward mean
            const baseJitter = pid === "you" ? 0.9 : 0.7;
            const noise = (Math.random() - 0.5) * baseJitter;
            const revert = (mean - last) * 0.0025; // tiny pull to center
            const newVal = last + noise + revert;

            // slide window & append
            next[pid] = [...arr.slice(1), newVal];
          }
          return next;
        });
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Shared min/max for scaling (with padding)
  const { minY, maxY, ranks, youRank } = useMemo(() => {
    let minV = Number.POSITIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;

    for (const arr of Object.values(series)) {
      for (const v of arr) {
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
    }
    if (!Number.isFinite(minV) || !Number.isFinite(maxV)) {
      minV = 0;
      maxV = 1;
    }
    const pad = (maxV - minV) * 0.1 + 0.5;
    const lo = minV - pad;
    const hi = maxV + pad;

    // rank by current value (desc)
    const latest = players.map((p) => ({
      id: p.id,
      name: p.name,
      val: series[p.id][series[p.id].length - 1],
      color: p.color,
    }));
    latest.sort((a, b) => b.val - a.val);
    const ranks = latest.map((l, idx) => ({
      ...l,
      rank: idx + 1,
    }));
    const youRank = ranks.find((r) => r.id === "you")?.rank ?? null;

    return { minY: lo, maxY: hi, ranks, youRank };
  }, [series, players]);

  // detect rank changes for “You” → pulse
  useEffect(() => {
    const prev = prevRankRef.current;
    if (youRank != null && prev != null && youRank !== prev) {
      setYouPulse(youRank < prev ? "up" : "down");
      const t = setTimeout(() => setYouPulse(null), 600);
      return () => clearTimeout(t);
    }
    prevRankRef.current = youRank ?? null;
  }, [youRank]);

  // map series to svg polylines on a 100x100 viewBox (left half)
  const lines = useMemo(() => {
    const toPts = (arr: number[]) => {
      const n = arr.length;
      return arr
        .map((v, i) => {
          const x = (i / (n - 1)) * 100; // 0..100 ends at middle divider
          const t = (v - minY) / (maxY - minY || 1);
          const y = clamp(100 - t * 100, 0, 100);
          return `${x},${y}`;
        })
        .join(" ");
    };
    const map: Record<string, string> = {};
    players.forEach((p) => (map[p.id] = toPts(series[p.id])));
    return map;
  }, [series, minY, maxY, players]);

  // convenience render helpers
  const valueToY = (val: number) => {
    const t = (val - minY) / (maxY - minY || 1);
    return clamp(100 - t * 100, 0, 100);
  };

  return (
    <div className="bg-gray-900/30 border border-gray-800/50 rounded-xl overflow-hidden">
      {/* Header (1 label + 12 columns, center highlighted) */}
      <div className="grid grid-cols-13 border-b border-gray-800/50 bg-black/20">
        <div className="col-span-1 p-3 text-xs font-medium text-gray-500 border-r border-gray-800/50">
          Live Leaderboard
        </div>
        {Array.from({ length: VISIBLE_ROUNDS }).map((_, idx) => (
          <div
            key={idx}
            className={`p-3 text-center text-xs border-r border-gray-800/50 last:border-r-0 relative ${
              idx === CURRENT_COL ? "bg-amber-500/5" : ""
            }`}
          >
            <div className="font-mono font-semibold">
              {idx < CURRENT_COL ? "" : idx === CURRENT_COL ? "NOW" : ""}
            </div>
            {idx === CURRENT_COL && (
              <>
                <div className="absolute inset-x-0 -bottom-px h-0.5 bg-gradient-to-r from-transparent via-amber-500 to-transparent" />
              </>
            )}
          </div>
        ))}
      </div>

      {/* Chart area (left 6 = shared chart, right 6 = empty to mirror layout) */}
      <div className="relative">
        {/* Left label rail with live ranks */}
        <div className="absolute left-0 top-0 bottom-0 w-23 border-r border-gray-800/50 bg-black/20 z-10">
          <div className="p-3">
            <div className="flex items-center gap-1 text-[11px] text-amber-300 mb-2">
              <Flame className="w-3 h-3" />
              LIVE
            </div>

            <div className="space-y-1">
              {ranks.map((r) => (
                <div
                  key={r.id}
                  className={`flex items-center justify-between text-xs px-2 py-1 rounded ${
                    r.id === "you"
                      ? "bg-amber-500/10 border border-amber-500/20"
                      : "bg-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: r.color }}
                    />
                    <span
                      className={`${
                        r.id === "you"
                          ? "text-amber-300 font-medium"
                          : "text-gray-300"
                      }`}
                    >
                      {r.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-gray-400">
                      {r.val.toFixed(1)}
                    </span>
                    <span
                      className={`w-5 text-center rounded text-[10px] ${
                        r.rank === 1
                          ? "bg-yellow-500/20 text-yellow-300"
                          : r.rank === 2
                          ? "bg-gray-500/20 text-gray-300"
                          : r.rank === 3
                          ? "bg-orange-500/20 text-orange-300"
                          : "bg-gray-700/20 text-gray-300"
                      }`}
                    >
                      {r.rank}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* scale hint */}
            <div className="mt-3 text-[10px] text-gray-500 font-mono">
              <div className="flex items-center justify-between">
                <span>{maxY.toFixed(0)}</span>
                <span>{minY.toFixed(0)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Columns */}
        <div
          className="ml-23 grid grid-cols-12 relative"
          style={{ height: "512px" }}
        >
          {/* Left 6 = shared chart */}
          <div className="col-span-6 relative">
            {/* background guides */}
            <div className="absolute inset-0">
              <div className="absolute left-0 right-0 top-1/2 h-px bg-gray-800" />
              <div className="absolute left-0 right-0 top-[25%] h-px bg-gray-900/60" />
              <div className="absolute left-0 right-0 top-[75%] h-px bg-gray-900/60" />
            </div>

            <svg
              className="absolute inset-0 w-full h-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              {/* draw lines (all together) */}
              {players
                .slice()
                .sort((a, b) => a.z - b.z)
                .map((p) => (
                  <polyline
                    key={p.id}
                    points={lines[p.id]}
                    fill="none"
                    stroke={p.color}
                    strokeWidth={p.width}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    opacity={p.id === "you" ? 0.98 : 0.88}
                  />
                ))}

              {/* end dots at middle, with competitive flair for “You” */}
              {players.map((p) => {
                const last = series[p.id][series[p.id].length - 1];
                const y = valueToY(last);
                const isYou = p.id === "you";
                return (
                  <g key={`${p.id}-dot`}>
                    <circle
                      cx="100"
                      cy={y}
                      r={isYou ? 2 : 1.6}
                      fill={p.color}
                    />
                    {/* small label bubble */}
                    <text
                      x={98}
                      y={y - 2.5}
                      textAnchor="end"
                      className={`text-[8px]`}
                      fill={p.color}
                    >
                      {p.name}
                    </text>
                    {isYou && youPulse === "up" && (
                      <circle
                        cx="100"
                        cy={y}
                        r={4}
                        fill="none"
                        stroke={p.color}
                        strokeWidth="0.6"
                        opacity="0.6"
                      >
                        <animate
                          attributeName="r"
                          from="2.5"
                          to="6"
                          dur="0.6s"
                          repeatCount="1"
                        />
                        <animate
                          attributeName="opacity"
                          from="0.9"
                          to="0"
                          dur="0.6s"
                          repeatCount="1"
                        />
                      </circle>
                    )}
                    {isYou && youPulse === "down" && (
                      <circle
                        cx="100"
                        cy={y}
                        r={4}
                        fill="none"
                        stroke="#ef4444"
                        strokeWidth="0.6"
                        opacity="0.6"
                      >
                        <animate
                          attributeName="r"
                          from="2.5"
                          to="6"
                          dur="0.6s"
                          repeatCount="1"
                        />
                        <animate
                          attributeName="opacity"
                          from="0.9"
                          to="0"
                          dur="0.6s"
                          repeatCount="1"
                        />
                      </circle>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Right 6 mirror area (keeps same footprint as your grid+chart layout) */}
        </div>
      </div>
    </div>
  );
}
