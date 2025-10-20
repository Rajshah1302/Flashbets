"use client";

import { Activity, Wallet } from "lucide-react";

export default function NavBar() {
  return (
    <header className="border-b border-gray-800/50 bg-gradient-to-r from-black via-gray-900/40 to-black backdrop-blur-md">
      <div className="max-w-9xl mx-auto px-6 py-4">
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
              <div className="font-mono font-semibold">$125.50</div>
            </div>
            <button className="bg-amber-500/10 border border-amber-500/20 text-amber-400 px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-500/20 transition flex items-center gap-2">
              <Wallet className="w-4 h-4" />
              0x742d...3f9a
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
