# OATH

OATH is an accountability prototype built with Next.js, React, TypeScript, and Supabase. **This build uses a sandbox ledger only:** it does not accept payments, pay out money, send SMS/email notifications, or block apps. Registered nominee reviews are in-app only. Do not use it to hold or transfer real value.

## Local setup

```bash
npm ci
cp .env.example .env.local
npm run dev
```

To explore the local-only demo, set `NEXT_PUBLIC_OATH_DEMO_MODE=true` in `.env.local` and restart `npm run dev`. Demo sign-in is intentionally unavailable in production. Demo balances and activity are browser-local virtual data and have no cash value. If Supabase is not configured, live authentication and mutations return clear errors rather than displaying sample account data. Set `NEXT_PUBLIC_SITE_URL` to the public site origin when deploying so social metadata uses the correct absolute URLs.

For a real Supabase staging project, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`. Never expose a service-role key in browser code. New projects: run [`supabase-schema.sql`](./supabase-schema.sql) once in the Supabase SQL editor. Existing installations: back up the database, then apply [`202609290001_harden_oath_flows.sql`](./supabase/migrations/202609290001_harden_oath_flows.sql), [`202609300001_registered_nominee_and_squad_recovery.sql`](./supabase/migrations/202609300001_registered_nominee_and_squad_recovery.sql), and [`202610010001_collaborative_duo_flows.sql`](./supabase/migrations/202610010001_collaborative_duo_flows.sql) in order. The latest migration adds the collaborative per-person Duo flow, updates active legacy Duo rows, enables zero-stake manual consequences, and secures creator-only access to Social Ransom contact details. Test migrations on staging before production. Social-message delivery, charity payments, and real-money processing are not configured; manual choices do not send or pay anything.

## Implemented in this prototype

- Solo oaths with zero-stake nonfinancial consequences or an individual FIAT-labelled sandbox stake; only financial consequences require a positive stake.
- Shared Duo goals with separate proof and peer review for each person. The creator locks their own virtual stake on creation; an invited participant locks only their own stake after explicitly accepting. Successful completion returns that participant's own stake, with no winner-takes-pot payout.
- Shared Squad membership, proof review, quorum voting, per-person sandbox loss, no-stake recovery quests, and private two-step recovery after a recorded failure. A Squad joiner opts in before their own virtual stake is locked.
- Registered @username nominee selection with an authenticated Referee Inbox and account-scoped yes/no verdicts. Reviews are in-app only; no email notification is sent.
- Private proof object storage with participant-scoped signed URLs and visible evidence during participant review.
- Manual Social Ransom contact/message fields, stored privately and displayed only to the oath creator; no SMS or email is sent.
- Selectable Anti-Charity reminders; no donation or payment is made by OATH.
- Public walls only for oaths that explicitly choose the public-shame consequence.

## Not available yet

- Payment collection, cash withdrawals, real-money escrow, or payout settlement.
- Automated Social Ransom delivery, nominee email notifications, charitable disbursement, mobile app blocking, or biometric/live-proof verification.
- Real-money deposits, escrow, deductions, payouts, or withdrawals. The virtual balance is only a sandbox ledger and must not be treated as stored value.

## Checks

```bash
npm run lint
npx tsc --noEmit
npm test
```

A staging Supabase project is required to verify SQL migrations, RLS behavior, storage policies, and real authentication. The local demo and PGlite database tests cannot substitute for that environment. No browser-driven end-to-end test has run in this environment.
