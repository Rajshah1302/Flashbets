"use client";

export default function MarketViewToggle({
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
