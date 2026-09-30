The advice you received is completely accurate and protects you from criminal liability under India’s 2025 Online Gaming Act. You cannot rely on "wordplay" if the mechanics still resemble a money game.

To execute this pivot and secure your app for a real launch, you must refactor your database security, schema, and Next.js frontend. Here is the exact technical execution plan to apply to your repository.

### 1. Database Security Lockdown (Supabase RLS)

Your current Row Level Security (RLS) policies allow client-side manipulation. If a user can edit their own wallet or transaction rows from the browser, your escrow system will be drained instantly.

Execute this SQL in your Supabase dashboard to lock down the tables:

```sql
-- 1. SECURE WALLETS: Users can only READ their balances.
DROP POLICY IF EXISTS "Users can update their own wallet" ON wallets;
CREATE POLICY "Users can view own wallet" 
  ON wallets FOR SELECT 
  USING (auth.uid() = user_id);
-- Note: ALL wallet updates must now happen exclusively in your Next.js API routes (/api/razorpay/verify) using the Supabase Service Role Key.

-- 2. SECURE TRANSACTIONS: Users cannot insert fake ledger entries.
DROP POLICY IF EXISTS "Users can insert own transactions" ON transactions;
CREATE POLICY "Users can view own transactions" 
  ON transactions FOR SELECT 
  USING (auth.uid() = user_id);

-- 3. SECURE NOMINEES: Prevent public reading/updating of verdicts and phone numbers.
DROP POLICY IF EXISTS "Anyone can read nominees" ON nominees;
DROP POLICY IF EXISTS "Anyone can update nominees" ON nominees;
CREATE POLICY "Oath creator can view nominees" 
  ON nominees FOR SELECT 
  USING (auth.uid() = creator_id);
-- Nominee updates (Pass/Fail) must use a secure token verified via a backend API route, not direct client-side DB updates.

```

### 2. Schema Refactoring (The Legal Pivot)

You must strip out all mechanics where one user profits from another's failure. We are shifting to the **Shared Oath / Survivor Model**.

Execute these structural changes to your database schema:

```sql
-- Erase all gambling/betting columns
ALTER TABLE oaths DROP COLUMN IF EXISTS prize_pool;
ALTER TABLE oaths DROP COLUMN IF EXISTS house_cut;
ALTER TABLE oaths DROP COLUMN IF EXISTS winnings;
ALTER TABLE oaths DROP COLUMN IF EXISTS loser_payout;

-- Add compliance columns
ALTER TABLE oaths ADD COLUMN commitment_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE oaths ADD COLUMN forfeiture_destination text DEFAULT 'Oath Platform';

-- Create the Shared Oath structure (replaces winner-takes-all squads)
CREATE TABLE shared_oaths (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    title text NOT NULL,
    completion_condition text NOT NULL,
    status text DEFAULT 'active' -- active, succeeded, forfeited
);

CREATE TABLE oath_participants (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    shared_oath_id uuid REFERENCES shared_oaths(id),
    user_id uuid REFERENCES users(id),
    commitment_amount numeric NOT NULL,
    participant_status text DEFAULT 'active' -- active, failed, completed
);

```

### 3. Codebase Terminology Purge

You must eliminate all casino/betting terminology from your codebase. Run a global search and replace across your `src/components`, `src/lib/types.ts`, and `src/app` directories.

**Delete these words entirely:**

* `Bet`, `Wager`, `Pot`, `Prize Pool`, `Winnings`, `House Cut`, `Winner`, `Loser`.



**Replace them with:**

* `commitment_amount` (instead of bet/pot).


* `oath_success` (instead of win).


* `oath_forfeiture` (instead of lose).


* `shared_oath` (instead of squad duel).


* `active_participant` (instead of surviving player).



### 4. Remove the Client-Side Admin Secret

Your `README.md` and environment variables contain a critical vulnerability.

* Remove `NEXT_PUBLIC_ADMIN_PASSWORD` immediately.


* **Never** prefix a secret with `NEXT_PUBLIC_` in Next.js, as this bundles the secret directly into the client-side JavaScript sent to the browser. Admin authentication should be handled strictly via secure HTTP-only cookies and backend verification.



### 5. Razorpay Payment Architecture

Because you are implementing Razorpay (seen in `src/app/api/razorpay/create-order/route.ts`), ensure that in a Shared Oath (Squad), **each user pays their own commitment amount** individually through the gateway.

Do not allow a "Squad Leader" to collect money offline and make a single lump-sum deposit to the platform. Your database must maintain a clean 1:1 audit trail linking an individual user's Razorpay transaction to their specific `commitment_amount` row in the database.