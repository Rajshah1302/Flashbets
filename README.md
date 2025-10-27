<h1 align="center">FlashBets</h1>

<p align="center">
  <em>High-frequency, zero-gas, instant prediction markets — powered by the Yellow Network and designed for real-time UX.</em>
</p>

<p align="center">
  <a href="https://drive.google.com/file/d/1neRsoBcB0M4ycVp2mboEcPpTXbovOiBm/view?usp=sharing" target="_blank">
    <img
      src="https://img.shields.io/badge/FlashBets-Technical_Whitepaper-black?style=for-the-badge&logo=readthedocs&logoColor=white"
      alt="FlashBets Technical Whitepaper"
    />
  </a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=5V4hTXVp0pE" target="_blank">
    <img src="https://img.youtube.com/vi/5V4hTXVp0pE/0.jpg" alt="FlashBets Demo Video" width="560" />
  </a>
</p>

---

## Table of Contents

* [1. What is FlashBets?](#1-what-is-flashbets)
* [2. Key Features](#2-key-features)
* [3. Architecture Overview](#3-architecture-overview)
* [4. Project Structure](#4-project-structure)
* [5. Core Modules](#5-core-modules)

  * [5.1 UI / Trading Loop (`page.tsx`)](#51-ui--trading-loop-pagetsx)
  * [5.2 Wallet & Chain Layer (wagmi + viem)](#52-wallet--chain-layer-wagmi--viem)
  * [5.3 Yellow Network Integration Layer](#53-yellow-network-integration-layer)
  * [5.4 State Tracking, P/L, and Settlement](#54-state-tracking-pl-and-settlement)
  * [5.5 Visualization & Analytics](#55-visualization--analytics)
* [6. Getting Started (Local Dev)](#6-getting-started-local-dev)
* [7. Environment Variables](#7-environment-variables)
* [8. Deployment / CI-CD](#8-deployment--ci-cd)
* [9. Security & Disclaimer](#9-security--disclaimer)
* [10. Roadmap](#10-roadmap)
* [11. Contributing](#11-contributing)
* [12. Glossary](#12-glossary)
* [13. License](#13-license)
* [14. Acknowledgements](#14-acknowledgements)
* [15. Screenshots / Demo](#15-screenshots--demo)

---

## 1. What is FlashBets?

FlashBets is an high-speed prediction market frontend focused on “flash bets”: low-latency, high-frequency micro-bets on short-term price movement.

Instead of pushing every interaction fully on-chain (and forcing users to pay gas each time they click), FlashBets integrates with the **Yellow Network** to simulate an off-chain “state channel” style experience:

* connect a wallet,
* open a session with Yellow’s Clearnode,
* request test liquidity from a faucet,
* place rapid-fire directional bets with effectively zero gas,
* settle your P&L and withdraw back to your wallet at the end.

Under the hood, the app is a modern Next.js 15 / React 19, fully client-driven trading UI with live round timers, payout math, P/L tracking, leaderboards, and payout & risk breakdown cards.

![Meme](https://github.com/user-attachments/assets/e40d11c7-d15d-41c3-9964-fd25714bb1bf)

---

## 2. Key Features

### ⚡ Real-time “flash” prediction rounds

* The UI continuously spins short rounds (e.g. 5s demo intervals).
* Each round asks a binary-ish question: “Will price go up or down?”
* Users can instantly allocate stake toward sentiment buckets like `Strong Bull`, `Bull`, `Bear`, `Strong Bear`.
* At the end of the round, the market "reveals", picks a winning side, and distributes winnings at pre-defined payout rates (e.g. ~1.95× for correct calls).

### 🧠 Integrated P/L tracking

* Tracks **current balance**, **total staked**, **lifetime P/L**, **win rate**, and **active exposure**.
* Shows **risk cards** and **potential payout cards** before you confirm a bet.
* Records round history and outcome resolution so you can audit what just happened.


### 🟡 Yellow Network session layer

* A dedicated Yellow SDK wrapper (`YellowSDKWagmiService`) simulates a **unified balance** in an off-chain “clearnode session.”
* The app models what production will do:

  * connect to Yellow’s Clearnode node,
  * mint test credit from a faucet,
  * execute “flash trades” with zero on-chain gas,
  * and settle / withdraw profit back to your wallet.
* All of this is abstracted behind ergonomic React hooks (`useYellowSDKWagmi`).

### 📊 Visual analytics & trading context

* Built-in live leaderboard and combined chart view using `recharts`.
* Shows simulated market sentiment, bet distribution, and recent “price action.”
* Renders your relative performance in the leaderboard.

---

## 3. Architecture Overview

FlashBets is intentionally split into three main layers:

1. **UI / Game Loop (Next.js + React + Tailwind)**

   * All the live trading panels, timers, bet buttons, charts, history tables, etc.
   * Written in TypeScript/React 19 and rendered via Next.js App Router (`src/app/page.tsx`).

2. **Session & Wallet Layer (wagmi / viem / React Query)**

   * `wagmi` handles wallet connectors (MetaMask, WalletConnect, etc.) and chain info.
   * A wrapper component (`WagmiProviderWrapper`) injects both Wagmi and TanStack React Query globally.
   * Exposes account, balance data, and connection state to the rest of the UI.

3. **Yellow Network Integration Layer**

   * `YellowSDKWagmiService` and `useYellowSDKWagmi` sit between the UI and any settlement / liquidity logic.
   * Responsibilities:

     * connect to Yellow Clearnode,
     * request test liquidity (faucet),
     * execute “flash trades” with effectively zero gas,
     * simulate withdrawals / settlement back to the user's wallet.
   * All external-facing calls (request tokens, execute trade, withdraw, settle) are centralized here so production logic can be swapped in without rewriting the UI.

High-level data flow:

```txt
User clicks "Bet ↑ 10"
  ↓
PredictionMarketUI (page.tsx) calls executeFlashTrade(...)
  ↓
useYellowSDKWagmi hook
  ↓
YellowSDKWagmiService
  ↓
(Prototype) Simulated trade execution, balance debit, tx hash
  ↓
Hook updates React state + QueryClient
  ↓
UI refreshes P/L, balance, history, leaderboard
```

---

## 4. Project Structure

```txt
Flashbets/
├─ .github/
│  └─ workflows/
│     └─ nextjs.yml          # GitHub Actions: build & deploy to GitHub Pages
│
├─ README.md                 # (You are here)
│
└─ frontend/
   ├─ package.json
   ├─ package-lock.json
   ├─ WAGMI_INTEGRATION_EXPLANATION.md
   ├─ YELLOW_SDK_INTEGRATION.md        # Deep dive into Yellow Network integration
   ├─ public/                          # Static assets (logos, etc.)
   └─ src/
      ├─ app/
      │  ├─ layout.tsx                 # Root layout, wraps app in WagmiProviderWrapper
      │  ├─ page.tsx                   # Main trading / prediction UI (PredictionMarketUI)
      │  └─ globals.css                # Tailwind/global styles, font setup
      │
      ├─ components/
      │  ├─ WagmiProvider.tsx          # Provides Wagmi + React Query context
      │  ├─ Navbar.tsx                 # Top navigation / status, wallet connect CTA
      │  ├─ HistoryTable.tsx           # Resolved rounds, outcomes, payouts
      │  ├─ Leaderboard.tsx            # LeaderboardCombinedChart, sentiment/volume charts
      │  └─ ... other UI atoms         # Buttons, cards, metrics, etc.
      │
      ├─ lib/
      │  ├─ wagmi-config.ts            # Chain list, connectors, WalletConnect project ID
      │  ├─ yellow-sdk-wagmi.ts        # YellowSDKWagmiService (session, faucet, trade, withdraw)
      │  ├─ useYellowSDKWagmi.ts       # React hook used by the UI
      │  ├─ yellow-sdk.ts              # (earlier version using Nitrolite RPC directly)
      │  └─ useYellowSDK.ts            # (earlier hook before wagmi refactor)
      │
      ├─ utils/
      │  └─ format.ts                  # Helpers like formatUSD(), % change, etc.
      │
      └─ (charts, icons, etc.)
```

### Technology stack (from `frontend/package.json`)

* **Next.js** `^15.x` (App Router)
* **React / React DOM** `19.x`
* **TypeScript** `^5.x`
* **Tailwind CSS** `^3.x`
* **Lucide React** (icon set)
* **Recharts** (visualization)
* **wagmi** `^2.x` + **viem** `^2.x` (wallets, chain data, contract IO)
* **@tanstack/react-query** `^5.x` (async state & caching)
* **@erc7824/nitrolite** `^0.4.0` (Yellow Network / state channel client primitives)
* **ethers** `^6.x` (general Ethereum-compatible tooling)

---

## 5. Core Modules

### 5.1 UI / Trading Loop (`page.tsx`)

`frontend/src/app/page.tsx` renders the main `PredictionMarketUI` component:

* Maintains all high-frequency, round-based state in React (`useState`, `useEffect`, refs).
* Simulates an orderbook of sentiment buckets:

  * `Strong Bull`, `Bull`, `Bear`, `Strong Bear`
  * Each bucket tracks total stake and autopopulates “pool size”.
* Drives a timer for each round (`REVEAL_EVERY_SECONDS` in the prototype is 5s; in production this could be 30s, 60s, etc.).
* Freezes the round, determines a “winner bucket,” calculates payout (≈1.95× for winning bets), updates user P/L, and appends the result to local history.
* Renders:

  * **Live chart / leaderboard** (`LeaderboardCombinedChart`)
  * **Stats cards** (Balance, P/L, Win Rate, Total Staked)
  * **Bet entry panel** with:

    * Quick amounts (1 / 5 / 10 / 25 / 50)
    * Manual input
    * Directional choice (↑ Bullish / ↓ Bearish)
    * Immediate projected Payout & Risk
  * **Session controls**:

    * “Request Test Tokens”
    * “Withdraw 50%”
    * “Settle Session”
    * Connection status to wallet and to Yellow Network.

The UI also surfaces toast-style feedback (success, error, status updates) for critical actions like withdrawals or faucet mints.

#### Responsiveness

Tailwind utility classes drive responsive layouts:

* Cards collapse into vertical stacks on mobile.
* High-signal info (timer, balance, P/L) is always visible.
* Heavy visualizations (leaderboard chart, deep history table) gracefully hide or scroll on smaller screens.

---

### 5.2 Wallet & Chain Layer (wagmi + viem)

**Files:**

* `frontend/src/components/WagmiProvider.tsx`
* `frontend/src/lib/wagmi-config.ts`

**What it does:**

* Creates a global `WagmiProviderWrapper` that wraps the app in:

  * `WagmiProvider config={config}`
  * `QueryClientProvider` from React Query
* Injected at the root layout (`frontend/src/app/layout.tsx`), so every page/component can access:

  * the connected wallet address,
  * current chain info,
  * balances,
  * connector metadata (MetaMask, WalletConnect, etc.).

**`wagmi-config.ts`**

* Declares the supported EVM chains:

  ```ts
  import { mainnet, sepolia, base, baseSepolia, arbitrum, arbitrumSepolia } from 'wagmi/chains'
  ```
* Registers connectors:

  ```ts
  import { injected, metaMask, walletConnect } from 'wagmi/connectors'

  export const config = createConfig({
    chains: [mainnet, sepolia, base, baseSepolia, arbitrum, arbitrumSepolia],
    connectors: [
      injected(),
      metaMask(),
      walletConnect({ projectId }),
    ],
    transports: {
      [mainnet.id]: http(),
      [sepolia.id]: http(),
      [base.id]: http(),
      [baseSepolia.id]: http(),
      [arbitrum.id]: http(),
      [arbitrumSepolia.id]: http(),
    },
  })
  ```
* Pulls `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` so WalletConnect works in user browsers without leaking private keys.

**Result in the UI:**

* “Connect Wallet / Connect to Yellow Network” button actually triggers a real wallet connection flow (MetaMask popup, etc.).
* The connected address and chain become available to the rest of the system.
* The app can eventually route withdrawals to a specific chain (Sepolia, Base Sepolia, Arbitrum Sepolia, etc.).

---

### 5.3 Yellow Network Integration Layer

**Files (post-wagmi refactor):**

* `frontend/src/lib/yellow-sdk-wagmi.ts`
* `frontend/src/lib/useYellowSDKWagmi.ts`
* Documentation:

  * `frontend/WAGMI_INTEGRATION_EXPLANATION.md`
  * `frontend/YELLOW_SDK_INTEGRATION.md`

This layer models how FlashBets will interact with the Yellow Network:

#### YellowSDKWagmiService

Class that encapsulates the session state with Yellow:

* Tracks whether we’re connected to Yellow Clearnode.
* Holds a **unified balance** (single liquidity balance abstracted across supported chains).
* Exposes async operations:

  * `connectToClearnode()`
  * `requestTestTokens(amount)`
  * `executeFlashTrade(params)`
  * `withdrawProfit(amount)`
  * `settleSession()`
  * `getUnifiedBalance()`
  * `disconnect()`

In development:

* These methods **simulate** behavior (e.g. generate pseudo transaction hashes like `withdrawal_<timestamp>`).
* Balance mutations (debit on bet, credit on faucet, withdraw on settle) update in-memory state and then sync back to React.

In production:

* `connectToClearnode()` will initialize a Nitrolite RPC client and open a state-channel-like session with a Yellow Clearnode.
* `executeFlashTrade()` will submit an off-chain order / prediction bet without paying L1 gas.
* `withdrawProfit()` and `settleSession()` will post actual settlement transactions and route funds back on-chain to the user’s preferred chain.

> TL;DR: This class is where “zero-gas micro bets over fast, private channels” becomes real.

#### useYellowSDKWagmi()

A typed React hook that:

* Wraps `YellowSDKWagmiService` and exposes it to components in a React-friendly, declarative way.
* Keeps derived UI state:

  ```ts
  {
    isConnected,
    isConnecting,
    userAddress,
    balance,
    isLoading,
    error,
  }
  ```
* Surfaces high-level actions for the page component:

  ```ts
  {
    connectWallet,
    connectToClearnode,
    requestTestTokens,
    executeFlashTrade,
    withdrawProfit,
    settleSession,
    refreshBalance,
    disconnect,
    clearError
  }
  ```

This is how `page.tsx` can stay mostly presentation-focused instead of juggling RPC details or chain logic.

---

### 5.4 State Tracking, P/L, and Settlement

FlashBets tracks player economics in near-real time:

* **User balance:**

  * If connected to Yellow Network → uses `yellowBalance` from `YellowSDKWagmiService`.
  * If *not* connected yet → falls back to a small local demo balance (e.g. 10 test tokens).
    This makes the UI usable before onboarding.

* **Round engine:**

  * Each round has:

    * visible countdown,
    * per-bucket pools,
    * a “winning bucket” revealed at round end.
  * After reveal, payouts are calculated and appended to trade history.

* **Payout logic / expected value panel:**

  * Before confirmation, the UI shows:

    * stake amount,
    * expected return if you’re right,
    * downside if you’re wrong.
  * This is visualized in compact “Risk” and “Payout” cards.

* **History & Leaderboard:**

  * Each completed round is logged into a table with:

    * timestamp,
    * market sentiment,
    * winning side,
    * pool sizes,
    * payout multiplier.
  * A combined chart component (`LeaderboardCombinedChart`) uses `recharts` to display simulated volume, trend, and user performance rank.

* **Session settlement:**

  * “Withdraw 50%” calls `withdrawProfit(balance * 0.5)`.
  * “Settle Session” calls `settleSession()`, simulating “close channel, withdraw everything, reset balance.”
  * Toast messaging clearly indicates success/failure in human terms (“Withdrawn 12.50 YELLOW_TEST_USD to your wallet”).

---

### 5.5 Visualization & Analytics

**Leaderboard / Combined Chart**

* Renders simulated trader leaderboard (`LBPlayer[]`) alongside price/volume data.
* Highlights top performers and gives social proof / competitive energy.

**HistoryTable**

* Tabular view of previously resolved rounds.
* Helps users understand that outcomes are rule-driven, not arbitrary.

**Navbar / Status bar**

* Shows wallet connection status + Yellow Network status (with colored indicators).
* Gives quick access to faucet, withdraw, and settle.

**Utilities**

* Formatting helpers like `formatUSD()` and percentage formatters live in `frontend/src/utils/format.ts` for consistent money-like display.

---

## 6. Getting Started (Local Dev)

> Prereqs:
>
> * Node.js 20+
> * npm (the repo/workflow assumes npm if `yarn.lock` is not present)
> * A browser wallet (MetaMask, Coinbase Wallet, or WalletConnect-compatible)

### 1. Clone and install

```bash
git clone https://github.com/Rajshah1302/Flashbets.git
cd Flashbets/frontend

# install deps
npm install
```

### 2. Configure environment

Create `frontend/.env.local` (see [Environment Variables](#7-environment-variables)).

At minimum you'll want:

```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_walletconnect_cloud_project_id
```

Optionally you can also expose testnet URLs and faucet endpoints if/when those are externalized.

### 3. Run the dev server

```bash
npm run dev
```

By default Next.js will serve at `http://localhost:3000`.

### 4. Connect your wallet

* Click **Connect Wallet / Connect to Yellow Network** in the UI.
* Approve in MetaMask (or your chosen connector).
* You should see your wallet address and a `connected` indicator.

### 5. Request test tokens (demo)

* Click **Request Test Tokens**.
* The hook will call the faucet endpoint (in dev this is mocked / simulated), update the unified balance and unlock betting.

### 6. Place a flash bet

* Choose `↑ Bullish` or `↓ Bearish`.
* Select a quick amount or type your own.
* Confirm.
* Watch the current round complete and see if you win.

---

## 7. Environment Variables

FlashBets expects some runtime configuration, especially around wallet connectivity and (eventually) Yellow endpoints.

### `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`

* Used in `wagmi-config.ts` to initialize the WalletConnect connector.
* This **must** be public (Next.js `NEXT_PUBLIC_` prefix) because it’s consumed client-side.
* You can get one from walletconnect.com’s dashboard in real usage; for development you can use a placeholder.

```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your-project-id
```

### Yellow Network endpoints (future-proofing)

In `yellow-sdk-wagmi.ts` we currently hardcode:

```ts
export const YELLOW_CONFIG = {
  CLEARNODE_WS_URL: 'wss://clearnet-sandbox.yellow.com/ws',
  FAUCET_URL: 'https://clearnet-sandbox.yellow.com/faucet/requestTokens',
  SUPPORTED_CHAINS: {
    SEPOLIA: '0xaa36a7',
    BASE_SEPOLIA: '0x14a33',
    ARBITRUM_SEPOLIA: '0x66eee',
  },
  TEST_TOKEN_SYMBOL: 'YELLOW_TEST_USD',
}
```

In production these should be moved into environment variables (e.g. `.env.local`, `.env.production`) so you can:

* point dev builds at sandbox / faucet,
* point prod builds at real Clearnode / settlement infra,
* rotate endpoints without redeploying code.

Suggested future keys:

```bash
NEXT_PUBLIC_YELLOW_CLEARNODE_WS_URL=wss://...
NEXT_PUBLIC_YELLOW_FAUCET_URL=https://...
NEXT_PUBLIC_SUPPORTED_CHAIN_SEPOLIA=0xaa36a7
...
```

---

## 8. Deployment / CI-CD

FlashBets ships with a GitHub Actions workflow at:
`./.github/workflows/nextjs.yml`

### What it does

* Runs on every push to `main` (and can be triggered manually from the Actions tab).
* Detects your package manager (prefers `yarn` if `yarn.lock` exists, otherwise `npm ci`).
* Sets up Node.js 20.x with dependency caching.
* Runs a production `next build`.
* Uploads the exported static site (`./out`) as an artifact.
* Deploys that artifact to GitHub Pages.

### Implications

* You get automated preview/production hosting on GitHub Pages just by pushing to `main`.
* The workflow uses `actions/configure-pages@v5` with `static_site_generator: next`, so it will handle the Next.js static export + Pages-friendly basePath tweaks for you.
* You must enable GitHub Pages in the repo settings with “GitHub Actions” as the source for this to go live.

> Note: If you introduce server-only routes / dynamic server actions that cannot be statically exported, you’ll need a different deployment target (Vercel, custom Node server, etc.). The current workflow assumes a static-compatible build.

---

## 9. Security & Disclaimer

* **Prototype only.**
  The “trading”, “faucet”, “withdrawal”, and “settlement” logic in `YellowSDKWagmiService` is intentionally **simulated**.
  Balances live in React state. Transactions are represented with mock hashes (e.g. `withdrawal_169...`).

* **Do not treat demo balance as real funds.**
  The unified balance shown in the UI is not on-chain money in this prototype.

* **No production settlement yet.**
  The code paths for `connectToClearnode()`, `executeFlashTrade()`, `withdrawProfit()`, and `settleSession()` are written to mirror how real Yellow Clearnode / Nitrolite state channels would behave, but they are not final audited implementations.

* **No guarantees.**
  Until the Yellow Network integration is wired to audited smart contracts / state channels and tested end-to-end on real testnets, you should assume this UI is for demonstration and UX validation only.

In other words: **don’t point mainnet funds at this.**

---

## 10. Roadmap

The repo already documents future work in `WAGMI_INTEGRATION_EXPLANATION.md` and `YELLOW_SDK_INTEGRATION.md`. Consolidating the major next steps:

### A. Production Yellow Network integration

* Replace simulated in-memory balances with live calls to Nitrolite RPC / Yellow Clearnode.
* Persist unified balances across sessions.
* Add authenticated per-user sessions and proper cleanup/close flows.

### B. Real settlement & withdrawals

* Actually perform cross-chain settlement back to the user’s wallet on their chosen chain.
* Handle partial vs full withdrawal with confirmations.
* Present transaction status (pending / confirmed / failed) and final hashes.

### C. Transaction history & audit trail

* Persist completed rounds and trades on a backend or on-chain log.
* Show them in `HistoryTable` with verifiable refs (block hash / commit hash / session id).

### D. Advanced risk controls

* Enforce max exposure per round and per user.
* Add cooldowns, rate limiting, and circuit breakers.
* Make payout curves configurable.

### E. Better UX polish

* Skeleton loaders / shimmer states during connection & faucet requests.
* Clear inline error states (not just console logging).
* Tooltips explaining odds, payout multipliers, and implied probability.
* Mobile-optimized bet ticket flow.

### F. Security hardening

* Input validation on bet size / direction.
* Replay protection and nonce management for off-chain orders.
* Session timeout + auto-settlement on inactivity.

---

## 11. Contributing

Contributions are welcome — the point of this prototype is to stress-test the UX and the session model before locking in protocol-level assumptions.

### Development style

* **TypeScript first.** Prefer strong types for all hook return values and service method signatures.
* **Separation of concerns.** Don’t jam business logic directly into `page.tsx`; extend `YellowSDKWagmiService` / `useYellowSDKWagmi` where appropriate.
* **Deterministic UI.** Components should render purely from props + hook state. Side effects (timers, async calls, etc.) live in hooks or services.

### Suggested workflow

1. Fork the repo.
2. Create a feature branch (`feature/better-faucet-flow`).
3. Make changes under `frontend/src/...`.
4. Add/update docs in `frontend/WAGMI_INTEGRATION_EXPLANATION.md` or `frontend/YELLOW_SDK_INTEGRATION.md` if you touch integration logic.
5. Submit a pull request to `main`.

When you open a PR:

* Describe what changed at a high level (UX improvement? protocol integration? refactor?).
* Call out security-relevant changes (anything that touches balance, withdrawal, or settlement logic).
* Include screenshots / GIFs for UI-facing changes whenever possible.

---

## 12. Glossary

**Flash Bet**
A very short-term prediction (seconds/minutes) on directional movement or sentiment. Think “Will it go ↑ in the next 30 seconds?”

**Round**
A discrete betting window with:

* a countdown timer,
* a pool of bets per sentiment bucket,
* a resolution step that chooses a winner and pays out.

**Bucket / Sentiment Bucket**
One of `Strong Bull`, `Bull`, `Bear`, `Strong Bear`. Conceptually like picking your side in a binary options round, but with finer granularity on confidence.

**Unified Balance**
A session-level “balance” maintained by the Yellow Network layer. In production, this is off-chain collateral you deploy once, then re-use across multiple micro-bets without paying L1 gas each time.

**Clearnode**
A Yellow Network node that coordinates these low-latency trades / bets, provides liquidity, and later settles results.

**Settle Session**
End-of-session action that (in production) closes your state channel, reconciles P/L, and withdraws funds back to your on-chain wallet.

---

## 13. License

No explicit license file is currently committed to this repository.

* If you intend this project to be open-source, consider adding a standard license (MIT, Apache-2.0, GPL, etc.) at the repo root as `LICENSE`.
* Until a license is added, assume **all rights reserved** by the repository owner.

---

## 14. Acknowledgements

* **Next.js / React** – Application framework and rendering runtime.
* **Tailwind CSS** – Utility-first styling.
* **lucide-react** – Consistent, modern iconography.
* **recharts** – Lightweight charting for leaderboard / sentiment visualizations.
* **wagmi + viem** – Wallet connection, chain awareness, typed contract IO.
* **@tanstack/react-query** – Query cache and async state management.
* **@erc7824/nitrolite** – Client primitives for Yellow Network’s state-channel-style trading model.
* **Yellow Network / Clearnode** – The conceptual backbone of the “zero-gas micro bet” flow.

---

### Final Notes

FlashBets is not “just a dApp UI.” It’s a reference for what **instant, gasless, high-frequency prediction markets** can feel like when:

* wallet connection is first-class,
* pricing/round logic is transparent,
* and settlement is offloaded to a fast state-channel layer (Yellow Network) instead of forcing an on-chain transaction for every micro-bet.

The codebase is deliberately structured so that:

* the visual layer can evolve independently (Tailwind + components),
* wallet/session plumbing can be swapped (wagmi),
* and the liquidity / settlement layer (YellowSDKWagmiService) can graduate from “simulated” to “production-grade” without rewriting the UI.

