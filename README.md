# OATH — STAKE EVERYTHING.

> **Execution is a choice. We make the alternative unbearable.**

**Oath** is a ruthlessly minimalist, brutalist commitment platform. It forces you to accomplish your goals by holding something you care about hostage—your money, your reputation, or your pride. You set a goal, lock in a stake, and if you fail, you face the consequences. No excuses. No refunds.

![Oath Banner](https://via.placeholder.com/1200x400/09090b/fafafa?text=OATH+%E2%80%94+STAKE+EVERYTHING)

## 🩸 THE HARSH REALITY

Willpower is a myth. Without skin in the game, your goals are just suggestions. 
But what if you stand to lose $500? What if a humiliating message gets texted to your crush if you fail? What if your hard-earned funds get donated to an anti-charity you hate? Suddenly, you'll find the time. 

Oath weaponizes loss aversion to guarantee your success.

## ⚡ FEATURES

- **SOLO OATHS:** Bet against yourself.
  - 💸 **Financial Stake:** Lock in funds (1x stake + 10% upfront protocol fee). Complete your oath and 100% of your locked stake is returned; fail and your stake is forfeited.
  - 📱 **Social Ransom (Honor-Code Ledger):** Record a contact and confession that are revealed on your failure ledger and Wall of Shame if you fold (manual honor-code enforcement; no automated SMS is sent).
  - 🏛️ **Anti-Charity (Honor-Code Ledger):** Pledge an ideological penalty to an opposing cause recorded permanently on your public failure profile and Wall of Shame.
- **SQUAD POOLS & PUBLIC LOBBIES:** Individual buy-in accountability challenges (`Survival` or `Weakest Link` modes) verified by peer quorum.
- **DUO DUELS (1v1):** Head-to-head accountability challenges verified by your partner.
- **PEER & REFEREE VERIFICATION:** Submit daily or single-deadline proof (photo, video, screenshot, link, or text) reviewed by your Nominee Referee, Duo Partner, or Squad Quorum.
- **BRUTALIST UI (MOBILE-FIRST & DESKTOP):** High-contrast analog brutalist aesthetic with thumb-zone bottom navigation and bottom-sheet drawers on mobile.
- **REGIONAL LOCALIZATION:** Supports Global ($ USD via PayPal) and India (₹ INR via Razorpay) currency localization out of the box.

## 🛠️ TECH STACK

- **Framework:** [Next.js 16 (App Router)](https://nextjs.org/)
- **Styling:** [Tailwind CSS v4](https://tailwindcss.com/)
- **Animations:** [Framer Motion](https://www.framer.com/motion/)
- **Database & Auth:** [Supabase](https://supabase.com/) (PostgreSQL + RLS + Realtime)
- **Icons:** [Lucide React](https://lucide.dev/)
- **Fonts:** Inter & JetBrains Mono

## 🚀 GETTING STARTED

### Prerequisites
- Node.js (v20+)
- A Supabase Project

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Aryan-Protein-Vala/Oath.git
   cd Oath
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up Environment Variables**
   Create a `.env.local` file in the root directory (never prefix server secrets with `NEXT_PUBLIC_`):
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   CRON_SECRET=your_random_cron_secret
   PAYPAL_CLIENT_ID=your_paypal_client_id
   PAYPAL_SECRET=your_paypal_secret
   PAYPAL_MODE=sandbox
   RAZORPAY_KEY_ID=your_razorpay_key_id
   RAZORPAY_KEY_SECRET=your_razorpay_key_secret
   ```

4. **Apply Database Migrations**
   Push the migration chain in `supabase/migrations/` (66 migrations including payment idempotency, RLS hardening, and timezone-aware cadence) to your linked Supabase database:
   ```bash
   npx supabase db push
   ```

5. **Run the Development Server & Test Suite**
   ```bash
   npm run dev
   npm test
   ```
   Open [http://localhost:3000](http://localhost:3000) with your browser to see the app.

## 📐 ARCHITECTURE & DESIGN

Oath is designed around a **Monochrome, Brutalist** aesthetic. 
- **Themes:** Light and Dark mode support with responsive mobile bottom-sheet ergonomics.
- **State Management:** Handled via React Contexts (`AuthContext`, `RegionContext`) and real-time Supabase (`postgres_changes`) subscriptions.
- **Verification & Settlement Logic:** Proofs are uploaded to private Supabase Storage paths (`oath-proofs`). Referees, Duo partners, or Squad Quorums review submissions, while server-authenticated cron sweeps (`/api/cron/sweep`) resolve expired deadlines.
- **Withdrawals:** User withdrawal requests lock balance into a pending ledger entry that is reviewed and paid out via the protected Admin dashboard (`/admin`, restricted via `is_admin()` UUID/JWT `app_metadata` role check). 

## ⚖️ THE HOUSE ALWAYS WINS

We aren't a bank. We are a contract enforcer.
When you stake funds on Oath, they are locked in escrow. 
- **Success:** You keep your dignity and your money.
- **Failure:** The contract executes. The House takes its cut, your social ransom is leaked, and your failure is immortalized on the public **Wall of Shame**.

---
*Created with sheer willpower. No excuses.*
