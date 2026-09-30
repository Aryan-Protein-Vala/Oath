# OATH

OATH is an accountability prototype built with Next.js, React, TypeScript, and Supabase. **This build uses a sandbox ledger only:** it does not accept payments, pay out money, send SMS/email notifications, or block apps. Registered nominee reviews are in-app only. Do not use it to hold or transfer real value.

## Local setup

```bash
npm ci
cp .env.example .env.local
npm run dev
```

To explore the local-only demo, set `NEXT_PUBLIC_OATH_DEMO_MODE=true` in `.env.local` and restart `npm run dev`. Demo sign-in is intentionally unavailable in production. Demo balances and activity are browser-local virtual data and have no cash value. If Supabase is not configured, live authentication and mutations return clear errors rather than displaying sample account data. Set `NEXT_PUBLIC_SITE_URL` to the public site origin when deploying so social metadata uses the correct absolute URLs.

For a real Supabase staging project, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`. Never expose a service-role key in browser code. New projects: run [`supabase-schema.sql`](./supabase-schema.sql) once in the Supabase SQL editor. Existing installations: back up the database, then apply [`202609290001_harden_oath_flows.sql`](./supabase/migrations/202609290001_harden_oath_flows.sql) followed by [`202609300001_registered_nominee_and_squad_recovery.sql`](./supabase/migrations/202609300001_registered_nominee_and_squad_recovery.sql). These migrations secure private oath fields and ledger operations, add a per-user nominee inbox, and add private two-step squad recovery. Test both on staging before production. Social-message delivery, charity payments, and real-money processing are not configured; the UI keeps those consequences unavailable and does not claim anything was sent or donated.

## Implemented in this prototype

- Oaths with optional zero-money public-shame mode, future deadlines, and server-side stake locking in the sandbox ledger.
- Duo challenge invitations that lock each participant's virtual stake atomically when accepted.
- Squad membership, proof submission, quorum voting, optional no-stake recovery quests, and private two-step recovery after a recorded failure. Financial squad loss is per-member sandbox forfeiture; it is not redistributed.
- Registered @username nominee selection with an authenticated Referee Inbox and account-scoped yes/no verdicts. Reviews are in-app only; no email notification is sent.
- Private proof object storage with participant-scoped signed URLs.
- Public walls only for oaths that explicitly choose the public-shame consequence.

## Not available yet

- Payment collection, cash withdrawals, real-money escrow, or payout settlement.
- Social Ransom staff dispatch, nominee email notifications, charitable disbursement, mobile app blocking, or biometric/live-proof verification.
- The UI disables unsupported consequences rather than suggesting they have happened. The corresponding RPCs reject unsupported operations as well.

## Checks

```bash
npm run lint
npx tsc --noEmit
npm test
```

A staging Supabase project is required to verify SQL migrations, RLS behavior, storage policies, and real authentication. The local demo and PGlite database tests cannot substitute for that environment. No browser-driven end-to-end test has run in this environment.
