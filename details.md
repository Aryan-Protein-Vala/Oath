# OATH — Complete App Details

> **"Your words mean absolutely nothing if there are no consequences."**  
> OATH is a financial and social accountability platform that forces you to put real skin in the game — money, reputation, or dignity — before you commit to a goal.

---

## Table of Contents

1. [What Is OATH?](#what-is-oath)
2. [The Core Idea](#the-core-idea)
3. [The Three Modes](#the-three-modes)
4. [Penalty Types](#penalty-types)
5. [Verification Methods](#verification-methods)
6. [Proof & Daily Cadence](#proof--daily-cadence)
7. [The Penalty Box](#the-penalty-box)
8. [The Wall of Shame & Wall of Honor](#the-wall-of-shame--wall-of-honor)
9. [Notifications & Real-time Updates](#notifications--real-time-updates)
10. [Wallet System](#wallet-system)
11. [Payment Gateways](#payment-gateways)
12. [Admin Panel](#admin-panel)
13. [Platform Economics (The 10% Fee)](#platform-economics-the-10-fee)
14. [Region Support (India + Global)](#region-support-india--global)
15. [Tech Stack](#tech-stack)
16. [App Architecture](#app-architecture)
17. [Database & Backend](#database--backend)
18. [API Routes](#api-routes)
19. [Pages & Routes](#pages--routes)
20. [Components Breakdown](#components-breakdown)
21. [Design System](#design-system)
22. [Security & RLS](#security--rls)
23. [Cron Jobs & Auto-Resolution](#cron-jobs--auto-resolution)
24. [Simplicity in a Nutshell](#simplicity-in-a-nutshell)

---

## What Is OATH?

OATH is a **real-consequence accountability app**. It is not a productivity tracker. It is not a habit app with streaks and points. It is a platform where you commit to a goal, stake real consequences behind it, and either prove you delivered — or face the music.

The premise is simple: humans follow through on things when failure is genuinely painful. Not "I'll feel bad about it" painful. Actually, concretely, irrevocably painful.

OATH operationalizes that pain.

---

## The Core Idea

1. You **write an Oath** — a specific, time-bound commitment. E.g., *"I will ship the MVP of my app by Friday 11:59 PM."*
2. You **lock a Penalty** behind it — financial loss, social embarrassment, or a physical consequence.
3. You **set a Deadline** and optionally pick a daily or one-time proof cadence.
4. At the deadline, you either **submit proof** that you did it, or the penalty is **automatically executed**.

No soft landings. No "I'll try harder next time." The penalty happens.

---

## The Three Modes

OATH supports three ways to play:

### 1. Solo Mode
You vs. yourself. You create an oath, pick a referee (a nominee), and lock a penalty. The referee (someone you trust — or fear) judges your proof and either approves or triggers the penalty.

- Fully customizable stake and penalty type
- Can nominate an in-app user or just an email address for the referee
- Supports both daily check-in cadence and one-time proof

### 2. Duo Challenge
Head-to-head commitment. You challenge another user on the app to a mutual oath. Both sides stake the same amount. The stakes are locked in escrow. The peer verifies each other's proof.

- If one person fails and the other succeeds → the winner gets their stake back, loser loses theirs
- **Mutual Assured Destruction (MAD):** If both fail, both lose everything — neither gets out clean
- Opponent must accept the invitation before the oath goes live

### 3. Squad Pool / Lobby
Group accountability, up to 8 players. Can be private (invite-only squad) or public (open lobbies anyone can join).

Two settlement modes:
- **Survival Mode:** Each member completes independently. Failures lose their stake; survivors get theirs back.
- **Weakest Link Mode (Squad Lockdown):** If *any* one person fails, *everyone* in the squad loses their stake. Total collective accountability.

Public lobbies appear in the **Community & Lobbies** tab where anyone can browse and join open commitment pools.

---

## Penalty Types

When creating an oath, you choose what happens if you fail:

| Penalty | What Happens |
|---|---|
| **Fiat (Money)** | Funds locked in escrow are forfeited. Platform takes 10%, rest is burned/redistributed. |
| **Anti-Charity** | Your money gets donated to a cause or political party you despise. You specify the cause. |
| **Social Ransom** | A pre-written embarrassing message gets sent to your boss, mom, ex, or whoever you nominated. |
| **Physical Debt** | You must complete 100 burpees on camera before your account unlocks (native mobile app feature). |
| **Public Shame** | Your failure and excuse are posted publicly to the Wall of Shame. |
| **Deadweight Tag** | In a squad, the person who fails gets publicly branded as the deadweight of the group. |
| **Combined** | Multiple penalty types stacked together. |

---

## Verification Methods

Each oath uses one of the following verification mechanisms:

| Method | How It Works |
|---|---|
| **Nominee (Referee)** | You nominate a specific person (on-app or by email) who reviews your proof and gives a pass/fail verdict. |
| **Peer Review** | In duo or squad mode, your partner/squad members vote on whether your proof is valid. |
| **Quorum** | In squad mode, more than 50% of active members must vote "verified" for a proof to pass. Dynamic quorum adjusts based on squad size. |
| **App Blocking** | (Upcoming native app feature) The app locks certain functionality until proof is verified. |

---

## Proof & Daily Cadence

When you create an oath, you choose a **cadence**:

- **Once:** You submit one final proof before the deadline. It either passes or fails.
- **Daily:** You check in every day with proof. Each day is a separate submission. The system tracks your streak, current day, and total days.

### Proof Types
- Photo
- Video
- Screenshot
- Link (e.g., to a GitHub commit, a published article, a Strava run)
- Text explanation

### Proof Submission Flow
1. Submitter uploads proof (file stored in Supabase Storage, or a URL/text)
2. Referee/peer receives a notification to review
3. Reviewer can: **Verify**, **Reject**, or **Request More Proof**
4. If the reviewer doesn't respond within the review window, the system auto-resolves (anti-ghosting logic)

---

## The Penalty Box

If a user fails **3 consecutive oaths**, they get placed in the **Penalty Box**:

- A global banner appears on their account
- They **cannot create new oaths**
- They **cannot join lobbies or squads**
- The lockout has a set expiry time
- This prevents serial quitters from gaming the system with throwaway oaths

---

## The Wall of Shame & Wall of Honor

A public, real-time feed of oath outcomes.

### Wall of Shame
- Displays every failed oath publicly
- Shows the user's username, oath statement, stake amount lost, and their excuse (expandable)
- Sorted by recency; formatted for maximum cringe

### Wall of Honor
- Displays every completed oath publicly
- Shows username, oath statement, and amount earned/kept
- Celebrates those who kept their word under real pressure

Both walls are accessible under the **Community** tab.

---

## Notifications & Real-time Updates

The app uses **Supabase Realtime** (Postgres Changes) for live notifications:

| Type | Trigger |
|---|---|
| `invite` | General squad invite |
| `invite_duo` | Duo challenge sent |
| `invite_squad` | Private squad invite |
| `invite_lobby` | Public lobby invite |
| `invite_nominee` | You have been nominated as a referee |
| `verify_proof` | A proof submission is waiting for your review |
| `system` | Platform-level messages |

Notifications show in a slide-in panel (bell icon in top nav) with an unread badge count that updates live. Accept/Reject actions can be performed directly from the panel.

---

## Wallet System

Every user has an in-app wallet with:

| Field | Description |
|---|---|
| `balance` | Available funds (free to withdraw or stake) |
| `escrow_locked` | Funds currently locked behind active oaths |
| `total_deposited` | All-time deposits |
| `total_withdrawn` | All-time withdrawals |
| `total_won` | Total earned from successful oaths |
| `total_lost` | Total forfeited from failed oaths |

### How Funds Flow
1. User deposits funds via Razorpay (India) or PayPal (Global)
2. When creating an oath with a financial penalty, the stake + 10% platform fee is **deducted upfront** and locked in escrow
3. On success → stake is released back to available balance
4. On failure → stake is forfeited; platform keeps the house cut

Transaction types tracked: `deposit`, `withdrawal`, `escrow_lock`, `escrow_release`, `penalty`, `reward`, `house_cut`.

---

## Payment Gateways

### Razorpay (India)
- Used for INR deposits
- Razorpay checkout modal opens in-app
- `/api/razorpay/create-order` creates the order
- `/api/razorpay/verify` validates the payment signature and credits the wallet

### PayPal (Global)
- Used for USD deposits
- Create order → redirect to PayPal hosted page → return with success params
- `/api/paypal/create-order` creates the order
- `/api/paypal/verify` captures and finalizes the deposit
- `/api/paypal/payout` handles withdrawal payouts

---

## Admin Panel

A full admin dashboard at `/admin`, protected by Supabase admin-level RLS bypass. Sections:

### Platform Stats (Live)
- Total users, active users (7 days), total/active/completed/failed oaths
- Success rate, total escrow locked, total money lost, total deposited, total withdrawn
- **Platform Revenue** (sum of all house_cut transactions)

### User Management
- Search users by username or email
- View wallet balance and stats per user
- Manually adjust wallet balance (credit/deduct)
- Send custom notifications to individual users
- Ban/unban users

### Oath Management
- View all oaths across all users
- Filter by status and type
- Force-resolve any oath
- Cancel oaths
- View proof submissions

### Dispute Resolution
- View all disputed oaths
- Manually adjudicate: resolve in favor of swearer or counterparty

### Feature Flags
- Toggle modes on/off: Duo Mode, Squad Mode, Lobby Mode, Anti-Charity, Social Ransom

### Cron Control
- Manually trigger the daily sweep cron
- See last run results: ghosted proofs handled, expired oaths resolved

### Broadcast
- Send a system notification to all users at once

### Audit Log
- Timestamped record of all admin actions

---

## Platform Economics (The 10% Fee)

OATH charges a **10% protocol fee** on all financial stakes, collected **upfront** when an oath is created.

**Example:**
- You create a $100 solo oath
- $110 is deducted from your wallet ($100 stake + $10 fee)
- If you succeed → $100 is returned to your wallet
- If you fail → $100 is forfeited; $10 was already kept as the platform cut

This means:
- The platform earns regardless of outcome
- There is no incentive for the app to sabotage your oath
- The fee is transparent and shown in the creation wizard before you confirm

---

## Region Support (India + Global)

The app auto-detects the user's region:

1. Checks for a saved preference in `localStorage`
2. Checks browser timezone (`Asia/Kolkata` → India)
3. Falls back to an IP-based check via `ipapi.co`

If India is detected, amounts display in **INR (₹)** at a fixed rate of 1 USD = 90 INR. Otherwise, **USD ($)**.

Users can manually toggle region from the top nav. Quick deposit amounts adjust automatically:
- **India:** ₹500, ₹1K, ₹2.5K, ₹5K, ₹10K, ₹25K
- **Global:** $25, $50, $100, $250, $500, $1K

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.3.6 (App Router, Turbopack) |
| Language | TypeScript 5 |
| UI | React 19 |
| Styling | Tailwind CSS v4 |
| Animations | Framer Motion 13 |
| Icons | Lucide React |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email/password) |
| Realtime | Supabase Realtime (Postgres Changes) |
| Storage | Supabase Storage (proof uploads) |
| Payments (India) | Razorpay |
| Payments (Global) | PayPal REST API |
| Deployment | Vercel |
| Theme | next-themes (light/dark, defaults to light) |
| Fonts | Inter (body), JetBrains Mono (labels/numbers) |
| Testing | Node.js built-in test runner |
| Unique IDs | uuid |

---

## App Architecture

Single-page application with client-side view switching — no full-page navigations for the main dashboard.

```
/ (root page)
├── Not logged in → <LandingView /> (marketing page)
└── Logged in → App shell:
    ├── <TopNav />
    ├── [Penalty Box Banner] (if active)
    ├── <ActiveOathsView />   — "Active" tab
    ├── <CreateOathView />    — "Create" tab
    ├── <CommunityView />     — "Community & Lobbies" tab
    │   ├── <LobbiesView />
    │   ├── <WallView type="shame" />
    │   └── <WallView type="honor" />
    ├── <ProfileView />       — profile tab
    ├── <WalletModal />       — overlay
    └── <NotificationsPanel /> — overlay
```

**State management:** React Context only. No Redux, no Zustand.
- `AuthContext` — user, profile, wallet, sign in/out
- `RegionContext` — region (global/India) + currency formatter
- `ThemeProvider` — light/dark via next-themes

Data fetching: custom hooks in `data-hooks.ts` calling Supabase directly from the client.

---

## Database & Backend

PostgreSQL via Supabase. 47 migration files. Core tables:

| Table | Purpose |
|---|---|
| `profiles` | User profiles (username, stats, reputation, penalty box) |
| `wallets` | Per-user wallet (balance, escrow, totals) |
| `transactions` | Full financial ledger |
| `oaths` | All oath records |
| `group_members` | Members of squad/duo/lobby oaths |
| `nominees` | Referee nominations with secure token |
| `proofs` | Proof submissions |
| `votes` | Peer votes on proofs |
| `wall_entries` | Public Wall of Shame/Honor entries |
| `messages` | In-oath chat messages |
| `notifications` | User notification queue |
| `disputes` | Disputed oaths pending admin review |
| `feature_flags` | Admin-controlled feature toggles |
| `admin_audit_log` | Admin action log |

### Key Supabase RPCs (Stored Procedures)
Business logic lives in PostgreSQL functions for atomicity:
- `settle_atomically` — settles an oath, handles escrow, penalties, wall entries, notifications
- `add_funds_to_wallet` — credits wallet after verified payment
- `withdraw_funds` — handles withdrawal with balance checks
- `join_squad` — joins a lobby/squad with stake deduction
- `forfeit_oath` — creator voluntarily forfeits
- `accept_duo_challenge` — opponent accepts a duo invite
- `pass_daily_work` — referee marks a daily check-in as passed
- `cast_vote` — records a quorum vote
- `trigger_penalty_box` — locks user after 3 consecutive failures
- `generate_nominee_token` — creates secure UUID token for external referee link

---

## API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/razorpay/create-order` | POST | Creates Razorpay payment order |
| `/api/razorpay/verify` | POST | Verifies signature + credits wallet |
| `/api/paypal/create-order` | POST | Creates PayPal order |
| `/api/paypal/capture` | POST | Captures PayPal payment |
| `/api/paypal/verify` | POST | Verifies and finalizes PayPal deposit |
| `/api/paypal/payout` | POST | Sends PayPal payout (withdrawal) |
| `/api/cron/sweep` | GET | Daily cron: resolves expired oaths, sweeps ghosted proofs |

Cron runs daily at midnight UTC via Vercel Cron (`vercel.json`).

---

## Pages & Routes

| Route | Type | Description |
|---|---|---|
| `/` | SPA (client) | Main app shell (landing or dashboard) |
| `/auth` | Client | Sign in / Sign up |
| `/admin` | Client | Full admin panel |
| `/challenge/[id]` | Dynamic | Public challenge share page |
| `/verify` | Client | External nominee verification via token |
| `/disclaimer` | Static | Legal disclaimer |
| `/privacy` | Static | Privacy policy |
| `/terms` | Static | Terms of service |
| `/refund` | Static | Refund policy |
| `/simplified` | Static | Simplified rules/explainer |

---

## Components Breakdown

| Component | What It Does |
|---|---|
| `LandingView.tsx` | Full marketing landing page. Hero, How It Works, penalty picker, battlefield modes, testimonials, CTA. Framer Motion animations throughout. |
| `TopNav.tsx` | Sticky nav: logo, tabs (desktop + mobile bottom bar), wallet balance, bell icon, theme toggle, region toggle, profile avatar |
| `ActiveOathsView.tsx` | Split-panel dashboard. Left: filterable oath list. Right: detail card with proof submission, chat, referee verdict actions. |
| `CreateOathView.tsx` | 3-step wizard: (1) Statement + mode, (2) Schedule + verification, (3) Stakes + consequence. Live cost breakdown with 10% fee. |
| `CommunityView.tsx` | Tab container for Lobbies, Wall of Shame, Wall of Honor |
| `LobbiesView.tsx` | Browse and join public lobbies. Shows size, stake, cadence, deadline. Inline proof voting. |
| `WallView.tsx` | Public feed of shame/honor with expandable excuses |
| `ProfileView.tsx` | User stats: completion rate, W/L ratio, reputation tier (STALWART/RELIABLE/PARIAH), transactions, penalty box |
| `WalletModal.tsx` | Deposit/withdraw overlay. Balance, escrow, transaction history. Razorpay + PayPal flows. |
| `NotificationsPanel.tsx` | Real-time slide-in notification list with accept/reject for invites and referee requests |
| `ProofUploadModal.tsx` | File upload for proof. Photo/video/link/text. Uploads to Supabase Storage. |
| `ChatRoom.tsx` | Per-oath group chat. Real-time via Supabase Realtime. |
| `ConfirmationModal.tsx` | Global confirmation dialog for destructive actions |
| `DuoChallengeModal.tsx` | Duo challenge creation/management |
| `CreateLobbyModal.tsx` | Create a new public lobby |
| `NomineeVerificationBar.tsx` | Referee UI for submitting a pass/fail verdict |
| `Toast.tsx` | Global toast notification system (success/error/info) |
| `Loader.tsx` | Reusable loading spinner |
| `ThemeProvider.tsx` | Thin wrapper around next-themes |

---

## Design System

Design language: **Brutalist · Monochrome · Analog · Premium**

### Visual Identity
- **Palette:** Zinc (near-black/white) + Red (`#dc2626`) as the only accent
- **No rounded corners** — everything square/sharp (neo-brutalist)
- **Hard box shadows** — offset solid shadows, not blurred
- **Heavy borders** — `border-2` to `border-4` throughout
- **Monospace for labels** — JetBrains Mono for all data/status text
- **ALL CAPS** for status labels, step counters, CTAs

### Special CSS Effects
- **Noise grain overlay** — SVG-based film grain texture globally applied
- **Scanline overlay** — CRT scanline effect layered on top
- **Stake number class** — tabular number formatting for financial amounts
- **fade-in animation** — staggered entry animation for list items
- **Full dark mode** — near-black `#09090b` background, adjusted zinc palette

### Typography
- Body/UI: Inter (variable, via next/font)
- Code/labels/numbers: JetBrains Mono (variable, via next/font)

### Responsive Strategy
- Mobile-first with `sm:` and `lg:` breakpoints
- Desktop: horizontal top nav with split-panel layouts
- Mobile: bottom tab bar, single-panel with back navigation

---

## Security & RLS

Supabase Row-Level Security on all tables:

- Users can only read/write their own `profiles`, `wallets`, `transactions`
- Oath members can read oaths they participate in
- Nominees can read their assigned oath
- Proof submissions readable by oath participants and nominees
- Quorum votes readable by all oath participants
- Notifications are strictly per-user
- Wall entries are publicly readable (no auth required)
- Messages restricted to oath participants
- Admin bypass via special RLS policy checking `auth.uid()` against a hardcoded admin UID
- Sensitive RPCs (`add_funds_to_wallet`, `settle_atomically`) protected against client-side manipulation
- External nominees access via **secure UUID token** (single-use, tied to specific oath)

---

## Cron Jobs & Auto-Resolution

Daily cron at `00:00 UTC` via Vercel Cron:

### `/api/cron/sweep`

1. **Ghost Proof Sweep:** Referee hasn't responded within the review window → auto-resolve that proof (anti-ghosting mechanic)

2. **Expired Oath Resolution:** Deadline passed + no manual settlement:
   - Proof submitted and verified → success, escrow released
   - No proof or rejected → failure, penalty executed
   - Calls `settle_atomically` → handles escrow, wall entries, notifications, penalty box check

The system is self-running. No manual admin intervention needed for routine resolution.

---

## Simplicity in a Nutshell

Despite all the features:

- **Single codebase** — Next.js monorepo, no microservices
- **No custom backend** — Supabase handles auth, database, storage, realtime
- **No state management library** — React Context only
- **No component library** — pure Tailwind CSS with custom design system
- **19 React components** — all in one `/components` folder
- **47 SQL migrations** — all business logic in PostgreSQL, not application code
- **2 payment gateways** — self-contained, no third-party payment SDK framework
- **1 cron job** — handles all automated settlement
- **0 external queues, workers, or schedulers** beyond Vercel Cron

The entire app was built by a single developer.

---

## Summary Stats

| Metric | Value |
|---|---|
| Framework | Next.js 16 (App Router) |
| React components | 19 |
| Pages/routes | 11 |
| API routes | 7 |
| Database migrations | 47 |
| Oath modes | 3 (Solo, Duo, Squad/Lobby) |
| Penalty types | 7+ |
| Verification methods | 4 |
| Payment gateways | 2 (Razorpay, PayPal) |
| Supported regions | 2 (India/INR, Global/USD) |
| Platform fee | 10% (upfront) |
| Cron frequency | Daily at midnight UTC |
| Built by | 1 developer |

---

*Last updated: October 2026*
