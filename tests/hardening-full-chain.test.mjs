import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { before, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

let db;
const ids = {
  admin: "26e5d445-0a36-4c77-a8e6-025dfb55af52",
  alice: "11111111-1111-4111-8111-111111111111",
  bob: "22222222-2222-4222-8222-222222222222",
  charlie: "33333333-3333-4333-8333-333333333333",
};

async function asUser(userId, sql, params = []) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.query("select set_config('request.jwt.claim.role', $1, false)", [userId ? "authenticated" : "service_role"]);
  return db.query(sql, params);
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb default '{}'::jsonb
    );
    CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT COALESCE(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT COALESCE(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated')
    $$;
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
      SELECT string_to_array(trim(both '/' from name), '/')
    $$;
    CREATE TABLE storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid());

    CREATE TYPE oath_type AS ENUM ('solo','duo','squad');
    CREATE TYPE oath_status AS ENUM ('pending','active','completed','failed','disputed','cancelled');
    CREATE TYPE verification_method AS ENUM ('nominee','peer','quorum','solo_lonely','app_blocking');
    CREATE TYPE consequence_type AS ENUM ('anti_charity','public_shame','bounty_transfer','physical_debt','mutual_destruction','deadweight_tag','bounty_split','squad_lockdown','fiat','social_ransom','app_blocking','combined');
    CREATE TYPE proof_status AS ENUM ('pending_review','verified','rejected','disputed');
    CREATE TYPE transaction_type AS ENUM ('deposit','withdrawal','escrow_lock','escrow_release','penalty','reward','house_cut');
    CREATE TYPE wall_type AS ENUM ('shame','honor');
    CREATE TABLE public.profiles (
      id uuid primary key, username text unique not null, display_name text, avatar_url text, phone text,
      oaths_created integer default 0, oaths_completed integer default 0, oaths_failed integer default 0,
      total_staked numeric(12,2) default 0, total_lost numeric(12,2) default 0, total_won numeric(12,2) default 0,
      reputation_score integer default 100, created_at timestamptz default now(), updated_at timestamptz default now()
    );
    CREATE TABLE public.wallets (
      id uuid primary key default gen_random_uuid(), user_id uuid unique not null references public.profiles(id) on delete cascade,
      balance numeric(12,2) not null default 0 check(balance>=0), escrow_locked numeric(12,2) not null default 0 check(escrow_locked>=0),
      total_deposited numeric(12,2) default 0, total_withdrawn numeric(12,2) default 0,
      total_lost numeric(12,2) default 0, total_won numeric(12,2) default 0,
      created_at timestamptz default now(), updated_at timestamptz default now()
    );
    CREATE TABLE public.oaths (
      id uuid primary key default gen_random_uuid(), creator_id uuid not null references public.profiles(id) on delete cascade,
      oath_statement text not null, deadline timestamptz not null, oath_type oath_type not null default 'solo',
      verification_method verification_method not null default 'solo_lonely', consequence_type consequence_type not null default 'fiat',
      stake_amount numeric(12,2) default 0, house_cut_percent numeric(4,2) default 10, social_ransom_phone text,
      social_ransom_message text, nominee_email text, status oath_status not null default 'pending',
      min_players integer default 1, max_players integer default 1, opponent_id uuid references public.profiles(id),
      completed_at timestamptz, failed_at timestamptz, failure_excuse text, created_at timestamptz default now(), updated_at timestamptz default now()
    );
    CREATE TABLE public.transactions (
      id uuid primary key default gen_random_uuid(), wallet_id uuid not null references public.wallets(id) on delete cascade, oath_id uuid references public.oaths(id) on delete set null,
      type transaction_type not null, amount numeric(12,2) not null check(amount>0), description text, created_at timestamptz default now()
    );
    CREATE TABLE public.nominees (
      id uuid primary key default gen_random_uuid(), oath_id uuid not null references public.oaths(id) on delete cascade, name text, email text, phone text,
      verification_token uuid default gen_random_uuid(), verified boolean default false, verdict text, verdict_note text,
      responded_at timestamptz, created_at timestamptz default now()
    );
    CREATE TABLE public.group_members (
      id uuid primary key default gen_random_uuid(), oath_id uuid not null references public.oaths(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade,
      stake_amount numeric(12,2) default 0, status text default 'joined' check(status in ('invited','joined','completed','failed','eliminated')),
      proof_submitted boolean default false, votes_received integer default 0, votes_needed integer default 0, is_winner boolean default false,
      joined_at timestamptz default now(), unique(oath_id,user_id)
    );
    CREATE TABLE public.proofs (
      id uuid primary key default gen_random_uuid(), oath_id uuid not null references public.oaths(id) on delete cascade, submitted_by uuid not null references public.profiles(id) on delete cascade,
      proof_type text not null, proof_url text, proof_text text, status proof_status default 'pending_review', reviewer_id uuid references public.profiles(id),
      review_note text, reviewed_at timestamptz, created_at timestamptz default now()
    );
    CREATE TABLE public.votes (
      id uuid primary key default gen_random_uuid(), proof_id uuid not null references public.proofs(id) on delete cascade, voter_id uuid not null references public.profiles(id) on delete cascade,
      oath_id uuid not null references public.oaths(id) on delete cascade, vote boolean not null, created_at timestamptz default now(), unique(proof_id,voter_id)
    );
    CREATE TABLE public.wall_entries (
      id uuid primary key default gen_random_uuid(), oath_id uuid not null references public.oaths(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade,
      wall_type wall_type not null, oath_statement text not null, stake_amount numeric(12,2) default 0, excuse text, username text, created_at timestamptz default now()
    );
    CREATE OR REPLACE FUNCTION create_wallet_for_user() RETURNS TRIGGER AS $$
    BEGIN
      INSERT INTO public.wallets (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;
    CREATE TRIGGER on_profile_created AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION create_wallet_for_user();
  `);

  const migrationsDir = new URL("../supabase/migrations/", import.meta.url);
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, migrationsDir), "utf8");
    await db.exec(sql);
  }

  await db.exec(`
    DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  `);

  await db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, 'admin@oath.app', '{"username":"owner_acc"}'::jsonb)`, [ids.admin]);
  await db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, 'alice@test.com', '{"username":"alice_user"}'::jsonb)`, [ids.alice]);
  await db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, 'bob@test.com', '{"username":"bob_user"}'::jsonb)`, [ids.bob]);
});

after(async () => {
  await db?.close();
});

test("Hardening 1: add_funds client RPC is removed; only credit_verified_payment credits wallets with strict idempotency", async () => {
  await assert.rejects(
    asUser(ids.alice, "SELECT public.add_funds(500)"),
    /function public\.add_funds.*does not exist/i
  );

  // Create a server-recorded payment order
  await db.query(`
    INSERT INTO public.payment_orders (provider, provider_order_id, user_id, gateway_amount, wallet_amount, currency)
    VALUES ('paypal', 'ORDER_123', $1, 50.00, 50.00, 'USD')
  `, [ids.alice]);

  // First credit succeeds
  const first = (await asUser(null, `
    SELECT public.credit_verified_payment('paypal', 'ORDER_123', 'CAPTURE_999', $1, 50.00, 'USD') AS res
  `, [ids.alice])).rows[0].res;
  assert.equal(first.success, true);
  assert.equal(first.already_credited, false);
  assert.equal(Number(first.wallet_amount), 50);

  // Replay with same payment ID is idempotent and does not double-credit
  const second = (await asUser(null, `
    SELECT public.credit_verified_payment('paypal', 'ORDER_123', 'CAPTURE_999', $1, 50.00, 'USD') AS res
  `, [ids.alice])).rows[0].res;
  assert.equal(second.already_credited, true);

  const wallet = (await db.query("SELECT balance FROM public.wallets WHERE user_id = $1", [ids.alice])).rows[0];
  assert.equal(Number(wallet.balance), 50);

  // Replay with different payment ID is rejected
  await assert.rejects(
    asUser(null, `SELECT public.credit_verified_payment('paypal', 'ORDER_123', 'CAPTURE_DIFF', $1, 50.00, 'USD')`, [ids.alice]),
    /already credited with a different provider payment/i
  );
});

test("Hardening 2: Reserved admin usernames cannot be claimed at signup or via update_username, and is_admin() rejects username spoofing", async () => {
  // Attempt to sign up with raw_user_meta_data username = 'admin'
  await db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, 'charlie@test.com', '{"username":"admin"}'::jsonb)`, [ids.charlie]);
  const charlieProfile = (await db.query("SELECT username, is_username_custom FROM public.profiles WHERE id = $1", [ids.charlie])).rows[0];
  assert.notEqual(charlieProfile.username, "admin");
  assert.equal(charlieProfile.is_username_custom, false);

  // Attempt to update_username to 'admin' or 'reaper_exe'
  const updateAttempt = (await asUser(ids.charlie, `SELECT public.update_username('admin') AS res`)).rows[0].res;
  assert.equal(updateAttempt.success, false);
  assert.match(updateAttempt.error, /reserved/i);

  const avail = (await asUser(ids.charlie, `SELECT public.check_username_available('reaper_exe') AS ok`)).rows[0].ok;
  assert.equal(avail, false);

  // Charlie is not admin, immutable admin UUID is admin
  const charlieAdmin = (await asUser(ids.charlie, `SELECT public.is_admin() AS ok`)).rows[0].ok;
  assert.equal(charlieAdmin, false);

  const realAdmin = (await asUser(ids.admin, `SELECT public.is_admin() AS ok`)).rows[0].ok;
  assert.equal(realAdmin, true);
});

test("Hardening 3: Single-signature settle_oath(UUID, TEXT) and verify_nominee(false) work across full migration chain", async () => {
  // Fund Alice and Bob via verified payment orders
  await db.query(`
    INSERT INTO public.payment_orders (provider, provider_order_id, user_id, gateway_amount, wallet_amount, currency)
    VALUES ('paypal', 'ORDER_ALICE_2', $1, 200.00, 200.00, 'USD'),
           ('paypal', 'ORDER_BOB_1', $2, 200.00, 200.00, 'USD')
  `, [ids.alice, ids.bob]);
  await asUser(null, `SELECT public.credit_verified_payment('paypal', 'ORDER_ALICE_2', 'CAP_A2', $1, 200.00, 'USD')`, [ids.alice]);
  await asUser(null, `SELECT public.credit_verified_payment('paypal', 'ORDER_BOB_1', 'CAP_B1', $1, 200.00, 'USD')`, [ids.bob]);

  // Ensure only 1 overload of settle_oath exists
  const overloads = (await db.query(`
    SELECT count(*)::int AS cnt FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname = 'settle_oath'
  `)).rows[0].cnt;
  assert.equal(overloads, 1);

  // Alice creates a single-deadline Solo Oath with Bob as nominee
  const soloId = (await asUser(ids.alice, `
    SELECT public.create_oath_with_stake(
      p_oath_statement := 'Read 50 pages',
      p_deadline := now() + interval '2 days',
      p_oath_type := 'solo',
      p_verification_method := 'nominee',
      p_consequence_type := 'fiat',
      p_stake_amount := 40,
      p_nominee_email := '@bob_user',
      p_cadence := 'once',
      p_timezone := 'Asia/Kolkata'
    ) AS id
  `)).rows[0].id;

  await asUser(ids.alice, `SELECT public.submit_oath_proof($1, 'text', NULL, 'Did not finish')`, [soloId]);
  const nomRes = (await asUser(ids.bob, `SELECT public.verify_nominee($1, false, 'Incomplete') AS res`, [soloId])).rows[0].res;
  assert.equal(nomRes.status, "failed");

  const aliceProfile = (await db.query("SELECT oaths_failed, total_lost FROM public.profiles WHERE id = $1", [ids.alice])).rows[0];
  assert.equal(Number(aliceProfile.oaths_failed), 1);
  assert.equal(Number(aliceProfile.total_lost), 40);
});

test("Hardening 4: Forfeit lifecycle cleans up Referee & Partner states across Solo, Weakest Link Duo, and Survival Duo", async () => {
  // 1. Solo Forfeit: Referee's nominee row is marked verified, pending verify_proof notifications are marked read, and referee gets oath_settled notice
  const soloForfeitId = (await asUser(ids.alice, `
    SELECT public.create_oath_with_stake(
      p_oath_statement := 'Solo Forfeit Referee Cleanup Test',
      p_deadline := now() + interval '2 days',
      p_oath_type := 'solo',
      p_verification_method := 'nominee',
      p_consequence_type := 'public_shame',
      p_stake_amount := 0,
      p_nominee_email := '@bob_user',
      p_cadence := 'daily',
      p_timezone := 'Asia/Kolkata'
    ) AS id
  `)).rows[0].id;

  await asUser(ids.alice, `SELECT public.submit_oath_proof($1, 'text', NULL, 'Submitting proof before forfeiting challenge')`, [soloForfeitId]);
  await asUser(ids.alice, `SELECT public.forfeit_oath($1, 'Giving up solo')`, [soloForfeitId]);

  const nomRow = (await db.query("SELECT verified, verdict FROM public.nominees WHERE oath_id = $1", [soloForfeitId])).rows[0];
  assert.equal(nomRow.verified, true);
  assert.equal(nomRow.verdict, "forfeited");

  const bobPendingVerify = (await db.query("SELECT count(*)::int AS cnt FROM public.notifications WHERE user_id = $1 AND oath_id = $2 AND type = 'verify_proof' AND status = 'pending'", [ids.bob, soloForfeitId])).rows[0].cnt;
  assert.equal(bobPendingVerify, 0);

  const bobSettledNotice = (await db.query("SELECT count(*)::int AS cnt FROM public.notifications WHERE user_id = $1 AND oath_id = $2 AND type = 'oath_settled'", [ids.bob, soloForfeitId])).rows[0].cnt;
  assert.equal(bobSettledNotice, 1);

  // 2. Weakest Link Duo Forfeit: One partner forfeiting immediately terminates the challenge (status = 'failed') and refunds the innocent partner's stake
  const bobBeforeWL = Number((await db.query("SELECT balance FROM public.wallets WHERE user_id = $1", [ids.bob])).rows[0].balance);
  const duoWLId = (await asUser(ids.alice, `
    SELECT public.create_oath_with_stake(
      p_oath_statement := 'Weakest Link Duo Forfeit Test',
      p_deadline := now() + interval '2 days',
      p_oath_type := 'duo',
      p_verification_method := 'peer',
      p_consequence_type := 'fiat',
      p_stake_amount := 20,
      p_opponent_id := $1,
      p_group_mode := 'weakest_link',
      p_cadence := 'daily',
      p_timezone := 'Asia/Kolkata'
    ) AS id
  `, [ids.bob])).rows[0].id;

  await asUser(ids.bob, `SELECT public.accept_duo_challenge($1, 'Asia/Kolkata')`, [duoWLId]);
  await asUser(ids.alice, `SELECT public.forfeit_oath($1, 'Alice forfeits weakest link')`, [duoWLId]);

  const wlOath = (await db.query("SELECT status FROM public.oaths WHERE id = $1", [duoWLId])).rows[0];
  assert.equal(wlOath.status, "failed");

  const bobAfterWL = Number((await db.query("SELECT balance FROM public.wallets WHERE user_id = $1", [ids.bob])).rows[0].balance);
  // Bob paid 20 stake + 2 fee = 22, and got his 20 stake refunded upon Alice's forfeit
  assert.equal(bobAfterWL, bobBeforeWL - 2);

  // 3. Survival Duo Forfeit: Clear Alice's 3-failure penalty box, then test Surviving partner continuing solo and auto-verifying without nagging the forfeited partner
  await db.query("UPDATE public.profiles SET loss_streak = 0, penalty_box_until = NULL WHERE id = $1", [ids.alice]);
  const duoSurvId = (await asUser(ids.alice, `
    SELECT public.create_oath_with_stake(
      p_oath_statement := 'Survival Duo Continuation Test',
      p_deadline := now() + interval '1 day',
      p_oath_type := 'duo',
      p_verification_method := 'peer',
      p_consequence_type := 'fiat',
      p_stake_amount := 20,
      p_opponent_id := $1,
      p_group_mode := 'survival',
      p_cadence := 'once',
      p_timezone := 'Asia/Kolkata'
    ) AS id
  `, [ids.bob])).rows[0].id;

  await asUser(ids.bob, `SELECT public.accept_duo_challenge($1, 'Asia/Kolkata')`, [duoSurvId]);
  await asUser(ids.alice, `SELECT public.forfeit_oath($1, 'Alice forfeits survival duo')`, [duoSurvId]);

  // Bob submits proof as the sole surviving member -> auto-verifies and completes the oath!
  await asUser(ids.bob, `SELECT public.submit_oath_proof($1, 'text', NULL, 'Bob completed the survival challenge solo!')`, [duoSurvId]);

  const survOath = (await db.query("SELECT status FROM public.oaths WHERE id = $1", [duoSurvId])).rows[0];
  assert.equal(survOath.status, "completed");

  const aliceNagCount = (await db.query("SELECT count(*)::int AS cnt FROM public.notifications WHERE user_id = $1 AND oath_id = $2 AND type = 'verify_proof' AND status = 'pending'", [ids.alice, duoSurvId])).rows[0].cnt;
  assert.equal(aliceNagCount, 0);
});

test("Hardening 5: Proof review, rejection (no premature oath erasure), and re-submission across Solo, Duo, and Squad", async () => {
  // Clear any penalty box
  await db.query("UPDATE public.profiles SET loss_streak = 0, penalty_box_until = NULL WHERE id IN ($1, $2)", [ids.alice, ids.bob]);

  // 1. Solo Daily Oath with Nominee
  const soloId = (await asUser(ids.alice, `
    SELECT public.create_oath_with_stake(
      p_oath_statement := 'Solo Daily Proof Rejection Test',
      p_deadline := now() + interval '5 days',
      p_oath_type := 'solo',
      p_verification_method := 'nominee',
      p_consequence_type := 'public_shame',
      p_stake_amount := 0,
      p_nominee_email := '@bob_user',
      p_cadence := 'daily',
      p_timezone := 'UTC'
    ) AS id
  `)).rows[0].id;

  const proof1 = (await asUser(ids.alice, `
    SELECT public.submit_oath_proof($1, 'text', NULL, 'Proof attempt 1 (blurry)') AS id
  `, [soloId])).rows[0].id;

  // Bob rejects proof 1 with p_fail_oath = false
  const rej1 = (await asUser(ids.bob, `
    SELECT public.reject_proof(p_oath_id := $1, p_proof_id := $2, p_reason := 'Blurry, please resubmit', p_fail_oath := false) AS res
  `, [soloId, proof1])).rows[0].res;
  assert.equal(rej1.success, true);
  assert.equal(rej1.status, "rejected");

  const soloAfterRej = (await db.query("SELECT status FROM public.oaths WHERE id = $1", [soloId])).rows[0];
  assert.equal(soloAfterRej.status, "active", "Oath MUST remain active after proof rejection!");

  const nomineeAfterRej = (await db.query("SELECT verified, verdict FROM public.nominees WHERE oath_id = $1", [soloId])).rows[0];
  assert.equal(nomineeAfterRej.verified, false, "Nominee verified must remain false so nominee can review resubmission!");

  // Alice submits proof attempt 2
  const proof2 = (await asUser(ids.alice, `
    SELECT public.submit_oath_proof($1, 'text', NULL, 'Proof attempt 2 (crystal clear)') AS id
  `, [soloId])).rows[0].id;

  // Bob approves proof 2 via pass_today_work
  const pass1 = (await asUser(ids.bob, `
    SELECT public.pass_today_work(p_oath_id := $1, p_note := 'Approved attempt 2', p_proof_id := $2) AS res
  `, [soloId, proof2])).rows[0].res;
  assert.equal(pass1.success, true);

  const nomineeAfterPass = (await db.query("SELECT verified, verdict FROM public.nominees WHERE oath_id = $1", [soloId])).rows[0];
  assert.equal(nomineeAfterPass.verified, false, "Nominee verified must be false for non-final day!");

  // Also test nominee verification token route
  const nomToken = (await db.query("SELECT verification_token FROM public.nominees WHERE oath_id = $1", [soloId])).rows[0].verification_token;
  // Day 2 proof submission & approval via token
  await asUser(ids.alice, `SELECT public.submit_oath_proof($1, 'text', NULL, 'Day 2 proof')`, [soloId]);
  const tokenVerify = (await db.query("SELECT public.verify_nominee($1, true, 'Token approved') AS res", [nomToken])).rows[0].res;
  assert.equal(tokenVerify.success, true);
  assert.equal(tokenVerify.current_day, 3);

  // 2. Duo Daily Challenge with Peer Rejection
  const duoId = (await asUser(ids.alice, `
    SELECT public.create_oath_with_stake(
      p_oath_statement := 'Duo Proof Rejection Flow Test',
      p_deadline := now() + interval '3 days',
      p_oath_type := 'duo',
      p_verification_method := 'peer',
      p_consequence_type := 'public_shame',
      p_stake_amount := 0,
      p_opponent_id := $1,
      p_cadence := 'daily',
      p_timezone := 'UTC'
    ) AS id
  `, [ids.bob])).rows[0].id;

  await asUser(ids.bob, `SELECT public.accept_duo_challenge($1)`, [duoId]);

  const duoProof1 = (await asUser(ids.alice, `
    SELECT public.submit_oath_proof($1, 'text', NULL, 'Alice gym photo (dark)') AS id
  `, [duoId])).rows[0].id;

  // Bob rejects proof 1
  const duoRej = (await asUser(ids.bob, `
    SELECT public.reject_proof(p_oath_id := $1, p_proof_id := $2, p_reason := 'Too dark to verify gym badge', p_fail_oath := false) AS res
  `, [duoId, duoProof1])).rows[0].res;
  assert.equal(duoRej.success, true);

  const duoOathAfter = (await db.query("SELECT status FROM public.oaths WHERE id = $1", [duoId])).rows[0];
  assert.equal(duoOathAfter.status, "active", "Duo oath MUST remain active on proof rejection!");

  const aliceMember = (await db.query("SELECT status, proof_submitted FROM public.group_members WHERE oath_id = $1 AND user_id = $2", [duoId, ids.alice])).rows[0];
  assert.equal(aliceMember.status, "joined", "Alice must remain joined!");
  assert.equal(aliceMember.proof_submitted, false, "proof_submitted must be reset so Alice can submit again!");

  // Alice resubmits
  const duoProof2 = (await asUser(ids.alice, `
    SELECT public.submit_oath_proof($1, 'text', NULL, 'Alice gym photo with badge visible') AS id
  `, [duoId])).rows[0].id;

  // Bob approves Alice's resubmitted proof
  const duoPass = (await asUser(ids.bob, `
    SELECT public.pass_today_work(p_oath_id := $1, p_note := 'Badge verified and clear', p_proof_id := $2) AS res
  `, [duoId, duoProof2])).rows[0].res;
  assert.equal(duoPass.success, true);

  // 3. Squad Quorum Flow
  const squadId = (await asUser(ids.alice, `
    SELECT public.create_oath_with_stake(
      p_oath_statement := 'Squad Quorum Proof Flow Test',
      p_deadline := now() + interval '3 days',
      p_oath_type := 'squad',
      p_verification_method := 'quorum',
      p_consequence_type := 'public_shame',
      p_stake_amount := 0,
      p_min_players := 2,
      p_max_players := 4,
      p_group_mode := 'survival',
      p_cadence := 'daily',
      p_timezone := 'UTC'
    ) AS id
  `)).rows[0].id;

  await asUser(ids.bob, `SELECT public.join_squad($1, 0, 'UTC')`, [squadId]);
  await db.query("UPDATE public.oaths SET status = 'active' WHERE id = $1", [squadId]);

  await asUser(ids.alice, `
    SELECT public.submit_oath_proof($1, 'text', NULL, 'Alice squad proof') AS id
  `, [squadId]);

  const aliceSquadMemberId = (await db.query("SELECT id FROM public.group_members WHERE oath_id = $1 AND user_id = $2", [squadId, ids.alice])).rows[0].id;

  // Bob casts quorum vote approving Alice
  const voteRes = (await asUser(ids.bob, `
    SELECT public.cast_squad_vote(p_oath_id := $1, p_member_id := $2, p_approve := true) AS res
  `, [squadId, aliceSquadMemberId])).rows[0].res;
  assert.equal(voteRes.success, true);
  assert.equal(voteRes.verdict, "approved");

  // 4. Test Final Day / Single-Deadline pass_today_work invoking handle_profile_completion
  const singleOathId = (await asUser(ids.alice, `
    SELECT public.create_oath_with_stake(
      p_oath_statement := 'Single Deadline Completion Test',
      p_deadline := now() + interval '1 day',
      p_oath_type := 'solo',
      p_verification_method := 'nominee',
      p_consequence_type := 'public_shame',
      p_stake_amount := 0,
      p_nominee_email := '@bob_user',
      p_cadence := 'once',
      p_timezone := 'UTC'
    ) AS id
  `)).rows[0].id;

  const singleProofId = (await asUser(ids.alice, `
    SELECT public.submit_oath_proof($1, 'text', NULL, 'Finished whole task!') AS id
  `, [singleOathId])).rows[0].id;

  // Bob clicks "Pass Today's Work"
  const passRes = (await asUser(ids.bob, `
    SELECT public.pass_today_work(p_oath_id := $1, p_note := 'Passed final work', p_proof_id := $2) AS res
  `, [singleOathId, singleProofId])).rows[0].res;
  assert.equal(passRes.success, true);

  const completedOath = (await db.query("SELECT status FROM public.oaths WHERE id = $1", [singleOathId])).rows[0];
  assert.equal(completedOath.status, "completed");

  const aliceAfterComp = (await db.query("SELECT oaths_completed FROM public.profiles WHERE id = $1", [ids.alice])).rows[0];
  assert.ok(Number(aliceAfterComp.oaths_completed) >= 1, "Alice oaths_completed must be incremented by handle_profile_completion!");
});

