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
  - 💸 **Financial Stake:** Lock in funds. Fail, and we take a 10% house cut (or all of it).
  - 📱 **Social Ransom:** Provide a friend's phone number and an embarrassing message. If you fail, the message is sent.
  - 🏛️ **Charitable/Anti-Charity:** If you fail, your money goes to a cause—maybe one you despise.
- **SQUAD POOLS:** Winner takes all. You and your friends put money in a pot. The ones who complete the challenge split the pot. Losers get nothing.
- **DUO DUELS (1v1):** Head-to-head accountability. You vs. your rival. 
- **PEER VERIFICATION:** You must submit proof (photo, video, link). Your peers vote to approve or reject your proof. 
- **BRUTALIST UI:** A highly premium, analog, and minimalist design. No distractions. Just your impending deadline.
- **REGIONAL LOCALIZATION:** Supports Global ($ USD) and India (₹ INR) currency localization out of the box.

## 🛠️ TECH STACK

- **Framework:** [Next.js 16 (App Router)](https://nextjs.org/)
- **Styling:** [Tailwind CSS v4](https://tailwindcss.com/)
- **Animations:** [Framer Motion](https://www.framer.com/motion/)
- **Database & Auth:** [Supabase](https://supabase.com/)
- **Icons:** [Lucide React](https://lucide.dev/)
- **Fonts:** Geist Sans & JetBrains Mono

## 🚀 GETTING STARTED

### Prerequisites
- Node.js (v18+)
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
   Create a `.env.local` file in the root directory and add your Supabase keys:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   NEXT_PUBLIC_ADMIN_EMAIL=your_admin_email
   NEXT_PUBLIC_ADMIN_PASSWORD=your_admin_password
   ```

4. **Initialize Database**
   Run the SQL scripts provided in `supabase-schema.sql` in your Supabase SQL Editor to set up the tables, Row Level Security (RLS) policies, and triggers.

5. **Run the Development Server**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) with your browser to see the app.

## 📐 ARCHITECTURE & DESIGN

Oath is designed around a **Monochrome, Brutalist** aesthetic. 
- **Themes:** Dark mode is heavily prioritized for the intense "hacker/analog" feel, but light mode offers a clean, sterile contrast.
- **State Management:** Handled via custom React Contexts (`AuthContext`, `RegionContext`) and real-time Supabase listeners.
- **Verification Logic:** Proofs are uploaded to Supabase Storage. Other users in the lobby review the proof and cast binary (Approve/Reject) votes. 

## ⚖️ THE HOUSE ALWAYS WINS

We aren't a bank. We are a contract enforcer.
When you stake funds on Oath, they are locked in escrow. 
- **Success:** You keep your dignity and your money.
- **Failure:** The contract executes. The House takes its cut, your social ransom is leaked, and your failure is immortalized on the public **Wall of Shame**.

---
*Created with sheer willpower. No excuses.*
