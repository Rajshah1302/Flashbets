"use client";

type ActiveBet = {
  roundId: number;
  label: string;
  amount: number;
  pool: number;
  estPayout: number;
};

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

function formatUSD(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BetsTable({
  activeBets,
  betHistory,
}: {
  activeBets: ActiveBet[];
  betHistory: HistoryRow[];
}) {
  const dash = "—";
  const rows = [
    // Active (pending)
    ...activeBets.map((b) => ({
      key: `active-${b.roundId}`,
      roundId: b.roundId,
      label: b.label,
      you: b.amount,
      pool: b.pool,
      estOrPayout: b.estPayout,
      profit: null as number | null,
      changePct: null as number | null,
      price: null as number | null,
      status: "Pending",
      statusClass: "bg-amber-500/10 text-amber-300 border border-amber-500/30",
    })),
    // Past (settled)
    ...[...betHistory].reverse().map((h) => ({
      key: `hist-${h.roundId}-${h.result}`,
      roundId: h.roundId,
      label: h.label,
      you: h.amount,
      pool: null as number | null,
      estOrPayout: h.payout,
      profit: h.profit,
      changePct: h.changePct,
      price: h.price,
      status: h.result === "win" ? "Won" : "Lost",
      statusClass:
        h.result === "win"
          ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"
          : "bg-red-500/10 text-red-300 border border-red-500/30",
    })),
  ];

  if (rows.length === 0) {
    return <div className="text-xs text-gray-500">No bets yet.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="max-h-96 overflow-y-auto rounded-md">
        <table className="min-w-full text-xs">
          <thead className="text-gray-500 sticky top-0 z-10 bg-black/40 backdrop-blur">
            <tr className="[&>th]:text-left [&>th]:font-medium [&>th]:px-3 [&>th]:py-2">
              <th>Round</th>
              <th>Bucket</th>
              <th>You</th>
              <th>Pool</th>
              <th>Est./Payout</th>
              <th>Profit</th>
              <th>Δ%</th>
              <th>Price</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-gray-800/60">
                <td className="px-3 py-2 font-mono text-gray-400">#{r.roundId}</td>
                <td className="px-3 py-2">{r.label}</td>
                <td className="px-3 py-2 font-mono">${formatUSD(r.you)}</td>
                <td className="px-3 py-2 font-mono">{r.pool != null ? `$${formatUSD(r.pool)}` : dash}</td>
                <td className="px-3 py-2 font-mono">${formatUSD(r.estOrPayout)}</td>
                <td
                  className={`px-3 py-2 font-mono ${
                    r.profit == null ? "text-gray-400" : r.profit >= 0 ? "text-amber-300" : "text-red-300"
                  }`}
                >
                  {r.profit == null ? dash : `${r.profit >= 0 ? "+" : "-"}$${formatUSD(Math.abs(r.profit))}`}
                </td>
                <td
                  className={`px-3 py-2 font-mono ${
                    r.changePct == null ? "text-gray-400" : r.changePct >= 0 ? "text-emerald-300" : "text-red-300"
                  }`}
                >
                  {r.changePct == null ? dash : `${r.changePct >= 0 ? "+" : ""}${r.changePct.toFixed(2)}%`}
                </td>
                <td className="px-3 py-2 font-mono">{r.price == null ? dash : `$${formatUSD(r.price)}`}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded ${r.statusClass}`}>{r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
