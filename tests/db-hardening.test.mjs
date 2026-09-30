import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

let db;
const ids = {
  alice: "11111111-1111-4111-8111-111111111111",
  bob: "22222222-2222-4222-8222-222222222222",
  cara: "33333333-3333-4333-8333-333333333333",
  dan: "44444444-4444-4444-8444-444444444444",
};

async function asUser(userId, sql, params = []) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  return db.query(sql, params);
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TABLE IF NOT EXISTS auth.users (id uuid primary key, email text);
    CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
      SELECT string_to_array(trim(both '/' from name), '/')
    $$;
    CREATE TABLE storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);

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
      id uuid primary key default gen_random_uuid(), user_id uuid unique not null references public.profiles(id),
      balance numeric(12,2) not null default 0 check(balance>=0), escrow_locked numeric(12,2) not null default 0 check(escrow_locked>=0),
      total_deposited numeric(12,2) default 0, total_withdrawn numeric(12,2) default 0,
      total_lost numeric(12,2) default 0, total_won numeric(12,2) default 0,
      created_at timestamptz default now(), updated_at timestamptz default now()
    );
    CREATE TABLE public.oaths (
      id uuid primary key default gen_random_uuid(), creator_id uuid not null references public.profiles(id),
      oath_statement text not null, deadline timestamptz not null, oath_type oath_type not null default 'solo',
      verification_method verification_method not null default 'solo_lonely', consequence_type consequence_type not null default 'fiat',
      stake_amount numeric(12,2) default 0, house_cut_percent numeric(4,2) default 10, social_ransom_phone text,
      social_ransom_message text, nominee_email text, status oath_status not null default 'pending',
      min_players integer default 1, max_players integer default 1, opponent_id uuid references public.profiles(id),
      completed_at timestamptz, failed_at timestamptz, failure_excuse text, created_at timestamptz default now(), updated_at timestamptz default now()
    );
    CREATE TABLE public.transactions (
      id uuid primary key default gen_random_uuid(), wallet_id uuid not null references public.wallets(id), oath_id uuid references public.oaths(id),
      type transaction_type not null, amount numeric(12,2) not null check(amount>0), description text, created_at timestamptz default now()
    );
    CREATE TABLE public.nominees (
      id uuid primary key default gen_random_uuid(), oath_id uuid not null references public.oaths(id), name text, email text, phone text,
      verification_token uuid default gen_random_uuid(), verified boolean default false, verdict text, verdict_note text,
      responded_at timestamptz, created_at timestamptz default now()
    );
    CREATE TABLE public.group_members (
      id uuid primary key default gen_random_uuid(), oath_id uuid not null references public.oaths(id), user_id uuid not null references public.profiles(id),
      stake_amount numeric(12,2) default 0, status text default 'joined' check(status in ('invited','joined','completed','failed','eliminated')),
      proof_submitted boolean default false, votes_received integer default 0, votes_needed integer default 0, is_winner boolean default false,
      joined_at timestamptz default now(), unique(oath_id,user_id)
    );
    CREATE TABLE public.proofs (
      id uuid primary key default gen_random_uuid(), oath_id uuid not null references public.oaths(id), submitted_by uuid not null references public.profiles(id),
      proof_type text not null, proof_url text, proof_text text, status proof_status default 'pending_review', reviewer_id uuid references public.profiles(id),
      review_note text, reviewed_at timestamptz, created_at timestamptz default now()
    );
    CREATE TABLE public.votes (
      id uuid primary key default gen_random_uuid(), proof_id uuid not null references public.proofs(id), voter_id uuid not null references public.profiles(id),
      oath_id uuid not null references public.oaths(id), vote boolean not null, created_at timestamptz default now(), unique(proof_id,voter_id)
    );
    CREATE TABLE public.wall_entries (
      id uuid primary key default gen_random_uuid(), oath_id uuid not null references public.oaths(id), user_id uuid not null references public.profiles(id),
      wall_type wall_type not null, oath_statement text not null, stake_amount numeric(12,2) default 0, excuse text, username text, created_at timestamptz default now()
    );
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.oaths ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.nominees ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.proofs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.wall_entries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated;
    GRANT ALL ON ALL TABLES IN SCHEMA public, storage TO anon, authenticated;
    INSERT INTO public.profiles(id,username,display_name) VALUES
      ('${ids.alice}','alice','Alice'),('${ids.bob}','bob','Bob'),('${ids.cara}','cara','Cara'),('${ids.dan}','dan','Dan');
    INSERT INTO public.wallets(user_id,balance) VALUES
      ('${ids.alice}',500),('${ids.bob}',500),('${ids.cara}',500),('${ids.dan}',500);
  `);

  const migrationFiles = [
    "202609290001_harden_oath_flows.sql",
    "202609300000_wallet_funding_rpc.sql",
    "202609300001_update_withdraw_rpc.sql",
    "202609300002_anti_charity_cause.sql",
    "202609300003_duffer_debt.sql",
    "202609300004_duffer_squad_updates.sql",
    "202609300005_duo_squad_modes.sql",
    "202609300006_squad_settlement_modes.sql",
    "202609300007_chat_notifications_lobby.sql",
    "202609300008_fix_settlement_and_modes.sql",
    "202609300009_admin_features.sql",
    "202609300010_fix_lobby_and_invites.sql",
    "202609300015_fix_rls_and_duo_lobby_flows.sql",
    "202609300016_referee_tokens_and_cancellation.sql",
    "202610010001_complete_readiness.sql",
    "202610010002_apply_readiness_fixes.sql"
  ];

  for (const file of migrationFiles) {
    const sql = await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
    await db.exec(sql);
  }
});

after(async () => {
  await db?.close();
});

test("solo creation, forfeiture, and duplicate settlement preserve escrow and ledger invariants", async () => {
  const created = await asUser(ids.alice, `SELECT public.create_oath_with_stake(
    'Run every day', now()+interval '2 days', 'solo','solo_lonely','fiat',100)`);
  const oathId = created.rows[0].create_oath_with_stake;
  let profile = (await db.query("SELECT oaths_created,oaths_completed,oaths_failed,total_staked,total_lost FROM profiles WHERE id=$1", [ids.alice])).rows[0];
  assert.equal(profile.oaths_created, 1);
  assert.equal(Number(profile.total_staked), 100);
  let wallet = (await db.query("SELECT balance,escrow_locked FROM wallets WHERE user_id=$1", [ids.alice])).rows[0];
  assert.equal(Number(wallet.balance), 400);
  assert.equal(Number(wallet.escrow_locked), 100);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM transactions WHERE oath_id=$1", [oathId])).rows[0].n, 1);

  await asUser(ids.alice, "SELECT public.forfeit_oath($1,'missed it')", [oathId]);
  await assert.rejects(asUser(ids.alice, "SELECT public.settle_oath($1,true,NULL)", [oathId]), /not active or already settled/i);
  wallet = (await db.query("SELECT balance,escrow_locked,total_lost FROM wallets WHERE user_id=$1", [ids.alice])).rows[0];
  assert.equal(Number(wallet.balance), 400);
  assert.equal(Number(wallet.escrow_locked), 0);
  assert.equal(Number(wallet.total_lost), 100);
  profile = (await db.query("SELECT oaths_failed,total_lost FROM profiles WHERE id=$1", [ids.alice])).rows[0];
  assert.equal(profile.oaths_failed, 1);
  assert.equal(Number(profile.total_lost), 100);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM transactions WHERE oath_id=$1", [oathId])).rows[0].n, 2);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM wall_entries WHERE oath_id=$1", [oathId])).rows[0].n, 0, "private fiat failure must not be published");
});

test("public-shame zero-stake oath creates a public failure entry without touching the wallet", async () => {
  const oathId = (await asUser(ids.alice, `SELECT public.create_oath_with_stake(
    'Write a journal entry', now()+interval '2 days', 'solo','solo_lonely','public_shame',0)`)).rows[0].create_oath_with_stake;
  await asUser(ids.alice, "SELECT public.forfeit_oath($1,'not completed')", [oathId]);
  const entry = (await db.query("SELECT wall_type,stake_amount,excuse FROM wall_entries WHERE oath_id=$1", [oathId])).rows[0];
  assert.equal(entry.wall_type, "shame");
  assert.equal(Number(entry.stake_amount), 0);
  assert.equal(entry.excuse, "not completed");
  const wallet = (await db.query("SELECT balance,escrow_locked FROM wallets WHERE user_id=$1", [ids.alice])).rows[0];
  assert.equal(Number(wallet.balance), 400);
  assert.equal(Number(wallet.escrow_locked), 0);
});

test("duo acceptance is free under Leader-Pays-All and settlement pays the winner correctly", async () => {
  const profileBefore = await db.query("SELECT id,oaths_completed,oaths_failed,total_won,total_lost FROM profiles WHERE id = ANY($1::uuid[])", [[ids.alice, ids.bob]]);
  // Alice creates Duo challenge with $100 stake. Leader pays all: $200 locked from Alice's wallet
  const oathId = (await asUser(ids.alice, `SELECT public.create_oath_with_stake(
    'Train 4 times weekly', now()+interval '3 days', 'duo','peer','fiat',100)`)).rows[0].create_oath_with_stake;
  
  // Alice has 400 balance left from test 1.
  // Alice wallet: 400 - 200 = 200 balance, 200 escrow_locked
  let creatorWallet = (await db.query("SELECT balance,escrow_locked FROM wallets WHERE user_id=$1", [ids.alice])).rows[0];
  assert.equal(Number(creatorWallet.balance), 200);
  assert.equal(Number(creatorWallet.escrow_locked), 200);

  // Self-acceptance fails
  await assert.rejects(asUser(ids.alice, "SELECT public.accept_duo_challenge($1)", [oathId]), /own challenge|not addressed/i);

  // Bob accepts challenge FREE (0 stake deducted from Bob)
  await asUser(ids.bob, "SELECT public.accept_duo_challenge($1)", [oathId]);
  let opponentWallet = (await db.query("SELECT balance,escrow_locked FROM wallets WHERE user_id=$1", [ids.bob])).rows[0];
  assert.equal(Number(opponentWallet.balance), 500); // Intact! Free entry
  assert.equal(Number(opponentWallet.escrow_locked), 0);

  // Non-participant cannot settle
  await assert.rejects(asUser(ids.cara, "SELECT public.settle_oath($1,true,NULL)", [oathId]), /assigned verifier/i);

  // Bob settles: Alice won (true)
  await asUser(ids.bob, "SELECT public.settle_oath($1,true,NULL)", [oathId]);

  creatorWallet = (await db.query("SELECT balance,escrow_locked,total_won FROM wallets WHERE user_id=$1", [ids.alice])).rows[0];
  opponentWallet = (await db.query("SELECT balance,escrow_locked,total_lost FROM wallets WHERE user_id=$1", [ids.bob])).rows[0];
  const profileAfter = await db.query("SELECT id,oaths_completed,oaths_failed,total_won,total_lost FROM profiles WHERE id = ANY($1::uuid[])", [[ids.alice, ids.bob]]);
  const beforeById = new Map(profileBefore.rows.map((row) => [row.id, row]));
  const afterById = new Map(profileAfter.rows.map((row) => [row.id, row]));

  // Alice: pot is $200 - 10% fee ($20) = $180 payout. Alice balance was 200 + 180 = 380. Net won = 80.
  assert.equal(afterById.get(ids.alice).oaths_completed, beforeById.get(ids.alice).oaths_completed + 1);
  assert.equal(afterById.get(ids.bob).oaths_failed, beforeById.get(ids.bob).oaths_failed + 1);
  assert.equal(Number(afterById.get(ids.alice).total_won - beforeById.get(ids.alice).total_won), 80);
  assert.equal(Number(afterById.get(ids.bob).total_lost), 0, "opponent paid nothing so incurs 0 financial loss");
  assert.equal(Number(creatorWallet.balance), 380);
  assert.equal(Number(creatorWallet.escrow_locked), 0);
  assert.equal(Number(opponentWallet.balance), 500);
  assert.equal(Number(opponentWallet.escrow_locked), 0);

  // Duplicate settlement fails
  await assert.rejects(asUser(ids.bob, "SELECT public.settle_oath($1,false,NULL)", [oathId]), /not active or already settled/i);
});

test("creator can cancel a pending duo invite and recover 2x escrow exactly once", async () => {
  const before = (await db.query("SELECT balance,escrow_locked FROM wallets WHERE user_id=$1", [ids.alice])).rows[0];
  const oathId = (await asUser(ids.alice, `SELECT public.create_oath_with_stake(
    'Do a study session', now()+interval '3 days', 'duo','peer','fiat',50)`)).rows[0].create_oath_with_stake;
  
  // During pending, 2x stake ($100) was locked:
  const mid = (await db.query("SELECT balance,escrow_locked FROM wallets WHERE user_id=$1", [ids.alice])).rows[0];
  assert.equal(Number(mid.balance), Number(before.balance) - 100);
  assert.equal(Number(mid.escrow_locked), Number(before.escrow_locked) + 100);

  await asUser(ids.alice, "SELECT public.cancel_duo_challenge($1)", [oathId]);
  await assert.rejects(asUser(ids.alice, "SELECT public.cancel_duo_challenge($1)", [oathId]), /pending duo|pending challenge/i);
  await assert.rejects(asUser(ids.bob, "SELECT public.accept_duo_challenge($1)", [oathId]), /unavailable/i);
  
  // Full refund:
  const after = (await db.query("SELECT balance,escrow_locked FROM wallets WHERE user_id=$1", [ids.alice])).rows[0];
  assert.equal(Number(after.balance), Number(before.balance));
  assert.equal(Number(after.escrow_locked), Number(before.escrow_locked));
});

test("squad proof requires membership; quorum approvals release member stake under Leader-Pays-All", async () => {
  const beforeAlice = (await db.query("SELECT balance,escrow_locked FROM wallets WHERE user_id=$1", [ids.alice])).rows[0];
  // 4 players, 25 stake = 100 locked from Alice
  const oathId = (await asUser(ids.alice, `SELECT public.create_oath_with_stake(
    'Finish a 5k', now()+interval '4 days', 'squad','quorum','deadweight_tag',25, 4, 4)`)).rows[0].create_oath_with_stake;
  
  const midAlice = (await db.query("SELECT balance,escrow_locked FROM wallets WHERE user_id=$1", [ids.alice])).rows[0];
  assert.equal(Number(midAlice.balance), Number(beforeAlice.balance) - 100);
  assert.equal(Number(midAlice.escrow_locked), Number(beforeAlice.escrow_locked) + 100);

  // Members join FREE
  await asUser(ids.bob, "SELECT public.join_squad($1,25)", [oathId]);
  await asUser(ids.cara, "SELECT public.join_squad($1,25)", [oathId]);
  await asUser(ids.dan, "SELECT public.join_squad($1,25)", [oathId]);

  // Bob balance unchanged (joined free):
  const bobWallet = (await db.query("SELECT balance,escrow_locked FROM wallets WHERE user_id=$1", [ids.bob])).rows[0];
  assert.equal(Number(bobWallet.balance), 500);
  assert.equal(Number(bobWallet.escrow_locked), 0);

  const proofId = (await asUser(ids.alice, "SELECT public.submit_oath_proof($1,'text',NULL,'Finished the five kilometer run')", [oathId])).rows[0].submit_oath_proof;
  assert.ok(proofId);
  const memberId = (await db.query("SELECT id FROM group_members WHERE oath_id=$1 AND user_id=$2", [oathId, ids.alice])).rows[0].id;
  await assert.rejects(asUser(ids.alice, "SELECT public.cast_squad_vote($1,$2,true)", [oathId, memberId]), /own proof/i);
  await asUser(ids.bob, "SELECT public.cast_squad_vote($1,$2,true)", [oathId, memberId]);
  await assert.rejects(asUser(ids.bob, "SELECT public.cast_squad_vote($1,$2,false)", [oathId, memberId]), /already voted/i);
  for (const voter of [ids.cara, ids.dan]) await asUser(voter, "SELECT public.cast_squad_vote($1,$2,true)", [oathId, memberId]);
  const member = (await db.query("SELECT status,votes_received,is_winner FROM group_members WHERE id=$1", [memberId])).rows[0];
  assert.equal(member.status, "completed");
  assert.equal(member.votes_received, 3);
  assert.equal(member.is_winner, true);
  
  // In survival mode, Alice's 25 stake is refunded to balance
  const afterAlice = (await db.query("SELECT balance,escrow_locked FROM wallets WHERE user_id=$1", [ids.alice])).rows[0];
  assert.equal(Number(afterAlice.balance), Number(midAlice.balance) + 25);
  assert.equal(Number(afterAlice.escrow_locked), Number(midAlice.escrow_locked) - 25);
});

test("authenticated clients cannot mutate balances, write ledger rows, or read another nominee token", async () => {
  const oathId = (await asUser(ids.alice, `SELECT public.create_oath_with_stake(
    'Private run', now()+interval '1 day', 'solo','solo_lonely','fiat',10)`)).rows[0].create_oath_with_stake;
  await db.query("INSERT INTO nominees(oath_id,email) VALUES($1,'private@example.test')", [oathId]);
  await db.exec("SET ROLE authenticated");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [ids.alice]);
  await assert.rejects(db.query("UPDATE wallets SET balance=100000 WHERE user_id=$1", [ids.alice]), /permission denied|row-level security/i);
  await assert.rejects(db.query("INSERT INTO transactions(wallet_id,type,amount) SELECT id,'deposit',1000 FROM wallets WHERE user_id=$1", [ids.alice]), /permission denied|row-level security/i);
  await assert.rejects(db.query("SELECT * FROM nominees"), /permission denied/i);
  const ownWallet = await db.query("SELECT balance FROM wallets WHERE user_id=$1", [ids.alice]);
  assert.equal(ownWallet.rows.length, 1);
  const otherWallet = await db.query("SELECT balance FROM wallets WHERE user_id=$1", [ids.bob]);
  assert.equal(otherWallet.rows.length, 0, "wallet row-level policy hides another person's balance");
  await db.exec("RESET ROLE");
});

test("nominee token is private, anonymous verification is one-time, and public shame is explicit opt-in", async () => {
  const oathId = (await asUser(ids.alice, `SELECT public.create_oath_with_stake(
    'Review my study log', now()+interval '2 days', 'solo','solo_lonely','public_shame',0)`)).rows[0].create_oath_with_stake;
  const token = (await db.query("INSERT INTO nominees(oath_id,email) VALUES($1,'referee@example.test') RETURNING verification_token", [oathId])).rows[0].verification_token;
  await db.exec("SET ROLE anon");
  await assert.rejects(db.query("SELECT * FROM nominees"), /permission denied/i);
  const challenge = (await db.query("SELECT * FROM public.get_nominee_challenge($1)", [String(token)])).rows[0];
  assert.equal(challenge.oath_id, oathId);
  assert.equal(challenge.oath_statement, "Review my study log");
  assert.equal(challenge.creator_username, "alice");
  assert.equal("verification_token" in challenge, false, "resolver never returns the bearer token");
  await db.query("SELECT public.verify_nominee($1,true,'verified by referee')", [String(token)]);
  await assert.rejects(db.query("SELECT public.verify_nominee($1,true,'replay')", [String(token)]), /invalid or already used/i);
  await db.exec("RESET ROLE");
  assert.equal((await db.query("SELECT status FROM oaths WHERE id=$1", [oathId])).rows[0].status, "completed");
  assert.equal((await db.query("SELECT verified FROM nominees WHERE verification_token=$1", [token])).rows[0].verified, true);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.get_nominee_challenge($1)", [String(token)])).rows[0].n, 0);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM wall_entries WHERE oath_id=$1", [oathId])).rows[0].n, 1);
});

test("private proof storage requires oath participation and validates uploaded objects", async () => {
  const oathId = (await asUser(ids.alice, `SELECT public.create_oath_with_stake(
    'Practice keyboard scales', now()+interval '2 days', 'solo','solo_lonely','public_shame',0)`)).rows[0].create_oath_with_stake;
  const objectPath = `${oathId}/${ids.alice}/proof.png`;
  await db.exec("SET ROLE authenticated");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [ids.alice]);
  await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('oath-proofs',$1)", [objectPath]);
  await db.query("SELECT public.submit_oath_proof($1,'photo',$2,NULL)", [oathId, objectPath]);
  await assert.rejects(db.query("SELECT public.submit_oath_proof($1,'photo',$2,NULL)", [oathId, `${oathId}/${ids.alice}/missing.png`]), /not uploaded/i);
  const aliceFile = await db.query("SELECT name FROM storage.objects WHERE bucket_id='oath-proofs'");
  assert.equal(aliceFile.rows.length, 1);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [ids.bob]);
  const bobFile = await db.query("SELECT name FROM storage.objects WHERE bucket_id='oath-proofs'");
  assert.equal(bobFile.rows.length, 0, "non-participants cannot read private proof objects");
  await assert.rejects(db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('oath-proofs',$1)", [`${oathId}/${ids.alice}/forged.png`]), /row-level security|permission denied/i);
  await db.exec("RESET ROLE");
});

test("quorum rejection in survival mode fails only the member and penalizes only their portion", async () => {
  const escrowBefore = Number((await db.query("SELECT escrow_locked FROM wallets WHERE user_id=$1", [ids.alice])).rows[0].escrow_locked);
  const totalLostBefore = Number((await db.query("SELECT total_lost FROM wallets WHERE user_id=$1", [ids.alice])).rows[0].total_lost);
  const oathId = (await asUser(ids.alice, `SELECT public.create_oath_with_stake(
    'Complete a language lesson', now()+interval '2 days', 'squad','quorum','deadweight_tag',20, 4, 4)`)).rows[0].create_oath_with_stake;
  
  // 4 * 20 = 80 locked from Alice
  for (const member of [ids.bob, ids.cara, ids.dan]) await asUser(member, "SELECT public.join_squad($1,20)", [oathId]);
  const proofId = (await asUser(ids.alice, "SELECT public.submit_oath_proof($1,'text',NULL,'Completed one lesson today')", [oathId])).rows[0].submit_oath_proof;
  const memberId = (await db.query("SELECT id FROM group_members WHERE oath_id=$1 AND user_id=$2", [oathId, ids.alice])).rows[0].id;
  for (const voter of [ids.bob, ids.cara, ids.dan]) await asUser(voter, "SELECT public.cast_squad_vote($1,$2,false)", [oathId, memberId]);
  
  const member = (await db.query("SELECT status,votes_received FROM group_members WHERE id=$1", [memberId])).rows[0];
  assert.equal(member.status, "failed");
  assert.equal(member.votes_received, 0);
  assert.ok(proofId);

  // Escrow was 80 higher initially, then decreased by 20 on Alice failure (survival penalty)
  const wallet = (await db.query("SELECT escrow_locked,total_lost FROM wallets WHERE user_id=$1", [ids.alice])).rows[0];
  assert.equal(Number(wallet.escrow_locked), escrowBefore + 60); // 80 - 20 = 60 remaining for other 3 members
  assert.equal(Number(wallet.total_lost), totalLostBefore + 20);
});

test("expired oaths reject late proofs and squad joins; invalid squad bounds fail closed", async () => {
  await assert.rejects(asUser(ids.alice, `SELECT public.create_oath_with_stake(
    'Invalid squad range', now()+interval '2 days', 'squad','quorum','deadweight_tag',10, 8, 4)`), /squad size/i);

  const soloId = (await asUser(ids.alice, `SELECT public.create_oath_with_stake(
    'Submit evidence before the deadline', now()+interval '2 days', 'solo','solo_lonely','fiat',10)`)).rows[0].create_oath_with_stake;
  await db.query("UPDATE public.oaths SET deadline=now()-interval '1 second' WHERE id=$1", [soloId]);
  await assert.rejects(asUser(ids.alice, "SELECT public.submit_oath_proof($1,'text',NULL,'This proof is late')", [soloId]), /expired/i);

  const squadId = (await asUser(ids.alice, `SELECT public.create_oath_with_stake(
    'Join before the deadline', now()+interval '2 days', 'squad','quorum','deadweight_tag',10, 4, 6)`)).rows[0].create_oath_with_stake;
  await db.query("UPDATE public.oaths SET deadline=now()-interval '1 second' WHERE id=$1", [squadId]);
  await assert.rejects(asUser(ids.bob, "SELECT public.join_squad($1,10)", [squadId]), /deadline has passed/i);
});

test("expired squad members without proof can be failed after deadline without wiping creator global escrow", async () => {
  const oathId = (await asUser(ids.alice, `SELECT public.create_oath_with_stake(
    'Close the weekly review', now()+interval '2 days', 'squad','quorum','deadweight_tag',15, 4, 4)`)).rows[0].create_oath_with_stake;
  for (const member of [ids.bob, ids.cara, ids.dan]) await asUser(member, "SELECT public.join_squad($1,15)", [oathId]);
  await assert.rejects(asUser(ids.alice, "SELECT public.fail_squad_member($1)", [oathId]), /deadline has not passed/i);

  const beforeWallet = (await db.query("SELECT escrow_locked,total_lost FROM wallets WHERE user_id=$1", [ids.alice])).rows[0];
  await db.query("UPDATE public.oaths SET deadline=now()-interval '1 second' WHERE id=$1", [oathId]);
  await asUser(ids.alice, "SELECT public.fail_squad_member($1)", [oathId]);
  await assert.rejects(asUser(ids.alice, "SELECT public.fail_squad_member($1)", [oathId]), /no unresolved squad membership|already been resolved/i);

  const member = (await db.query("SELECT status FROM group_members WHERE oath_id=$1 AND user_id=$2", [oathId, ids.alice])).rows[0];
  assert.equal(member.status, "failed");
  const wallet = (await db.query("SELECT escrow_locked,total_lost FROM wallets WHERE user_id=$1", [ids.alice])).rows[0];
  assert.equal(Number(wallet.escrow_locked), Number(beforeWallet.escrow_locked) - 15);
  assert.equal(Number(wallet.total_lost), Number(beforeWallet.total_lost) + 15);
});

test("weakest link mode forfeits full squad stake if any single member fails without wiping unrelated oaths", async () => {
  // Test wallet deposit RPC
  await asUser(ids.alice, "SELECT public.add_funds(500)");

  // Alice creates an independent solo oath with $50 stake
  const soloOathId = (await asUser(ids.alice, `SELECT public.create_oath_with_stake(
    'Independent solo run', now()+interval '2 days', 'solo','solo_lonely','fiat',50)`)).rows[0].create_oath_with_stake;

  const aliceBeforeSquad = (await db.query("SELECT balance,escrow_locked,total_lost FROM wallets WHERE user_id=$1", [ids.alice])).rows[0];

  // Alice creates Weakest Link squad (4 players x $25 = $100 locked)
  const squadId = (await asUser(ids.alice, `SELECT public.create_oath_with_stake(
    'Weakest Link study marathon', now()+interval '2 days', 'squad','quorum','fiat',25, 4, 4, NULL, NULL, NULL, NULL, NULL, 'weakest_link')`)).rows[0].create_oath_with_stake;

  for (const member of [ids.bob, ids.cara, ids.dan]) await asUser(member, "SELECT public.join_squad($1,25)", [squadId]);

  // Bob forfeits
  await asUser(ids.bob, "SELECT public.forfeit_squad_member($1)", [squadId]);

  // Squad oath status is failed
  const squadRow = (await db.query("SELECT status FROM oaths WHERE id=$1", [squadId])).rows[0];
  assert.equal(squadRow.status, "failed");

  // Alice's wallet: lost $100 for the squad, but her $50 escrow for the solo oath is UNTOUCHED!
  const aliceAfter = (await db.query("SELECT balance,escrow_locked,total_lost FROM wallets WHERE user_id=$1", [ids.alice])).rows[0];
  assert.equal(Number(aliceAfter.escrow_locked), Number(aliceBeforeSquad.escrow_locked)); // Exactly preserved!
  assert.equal(Number(aliceAfter.total_lost), Number(aliceBeforeSquad.total_lost) + 100);
});

test("unsupported nominee and social delivery fail closed", async () => {
  await assert.rejects(asUser(ids.alice, `SELECT public.create_oath_with_stake(
    'Nominee test', now()+interval '1 day', 'solo','nominee','fiat',1)`), /nominee verification requires/i);
  await assert.rejects(asUser(ids.alice, `SELECT public.create_oath_with_stake(
    'Social test', now()+interval '1 day', 'solo','solo_lonely','social_ransom',1)`), /social ransom requires/i);
});
