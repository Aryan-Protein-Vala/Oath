import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

let db;
const ids = {
  creator: "11111111-1111-4111-8111-111111111111",
  opponent: "22222222-2222-4222-8222-222222222222",
  squadMember1: "33333333-3333-4333-8333-333333333333",
  squadMember2: "44444444-4444-4444-8444-444444444444",
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
      ('${ids.creator}','creator','Aryan'),
      ('${ids.opponent}','opponent','Sam'),
      ('${ids.squadMember1}','member1','Rohan'),
      ('${ids.squadMember2}','member2','Priya');
    INSERT INTO public.wallets(user_id,balance) VALUES
      ('${ids.creator}',1000),
      ('${ids.opponent}',500),
      ('${ids.squadMember1}',200),
      ('${ids.squadMember2}',100);
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
    "202609300009_fix_lobby_and_invites.sql"
  ];

  for (const file of migrationFiles) {
    const sql = await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
    await db.exec(sql);
  }
});

after(async () => {
  await db?.close();
});

test("Real User Journey 1: Wallet Deposit & UPI / PayPal Withdrawal", async () => {
  // Deposit ₹500
  await asUser(ids.creator, "SELECT public.add_funds(500)");
  let wallet = (await db.query("SELECT balance, escrow_locked, total_deposited FROM wallets WHERE user_id=$1", [ids.creator])).rows[0];
  assert.equal(Number(wallet.balance), 1500);
  assert.equal(Number(wallet.total_deposited), 500);

  // Withdraw via UPI
  await asUser(ids.creator, "SELECT public.withdraw_funds(200, 'UPI: aryan@okhdfcbank')");
  wallet = (await db.query("SELECT balance, total_withdrawn FROM wallets WHERE user_id=$1", [ids.creator])).rows[0];
  assert.equal(Number(wallet.balance), 1300);
  assert.equal(Number(wallet.total_withdrawn), 200);

  // Withdraw via PayPal
  await asUser(ids.creator, "SELECT public.withdraw_funds(100, 'PayPal (aryan@example.com)')");
  wallet = (await db.query("SELECT balance, total_withdrawn FROM wallets WHERE user_id=$1", [ids.creator])).rows[0];
  assert.equal(Number(wallet.balance), 1200);
  assert.equal(Number(wallet.total_withdrawn), 300);

  // Check transaction history
  const txs = (await db.query("SELECT type, amount, description FROM transactions WHERE wallet_id=(SELECT id FROM wallets WHERE user_id=$1) ORDER BY created_at ASC", [ids.creator])).rows;
  assert.equal(txs.length, 3);
  assert.equal(txs[0].type, "deposit");
  assert.equal(txs[1].description, "Withdrawal to UPI: aryan@okhdfcbank");
  assert.equal(txs[2].description, "Withdrawal to PayPal (aryan@example.com)");

  // Attempt overdraft fails
  await assert.rejects(asUser(ids.creator, "SELECT public.withdraw_funds(99999, 'UPI')"), /insufficient funds/i);
});

test("Real User Journey 2: Duo Challenge E2E (Leader Pays All + Opponent Joins Free)", async () => {
  // Creator challenges Opponent with $100 stake.
  // Under Leader-Pays-All, creator locks $200 (2x) upfront.
  const oathId = (await asUser(ids.creator, `SELECT public.create_oath_with_stake(
    'No caffeine for 7 days', now()+interval '7 days', 'duo', 'peer', 'fiat', 100, 2, 2, '${ids.opponent}', NULL, NULL, NULL, NULL, 'survival'
  )`)).rows[0].create_oath_with_stake;

  const creatorWallet = (await db.query("SELECT balance, escrow_locked FROM wallets WHERE user_id=$1", [ids.creator])).rows[0];
  assert.equal(Number(creatorWallet.balance), 1000); // 1200 - 200 = 1000
  assert.equal(Number(creatorWallet.escrow_locked), 200);

  // Opponent accepts the challenge for FREE
  const opponentBefore = (await db.query("SELECT balance, escrow_locked FROM wallets WHERE user_id=$1", [ids.opponent])).rows[0];
  await asUser(ids.opponent, "SELECT public.accept_duo_challenge($1)", [oathId]);
  const opponentAfter = (await db.query("SELECT balance, escrow_locked FROM wallets WHERE user_id=$1", [ids.opponent])).rows[0];
  assert.equal(Number(opponentAfter.balance), Number(opponentBefore.balance)); // $0 charged
  assert.equal(Number(opponentAfter.escrow_locked), 0);

  // Challenge status is now active
  const oath = (await db.query("SELECT status, opponent_id FROM oaths WHERE id=$1", [oathId])).rows[0];
  assert.equal(oath.status, "active");
  assert.equal(oath.opponent_id, ids.opponent);

  // Opponent (verifier) settles: Creator succeeded!
  // Creator receives $200 pot - $20 platform fee = $180
  await asUser(ids.opponent, "SELECT public.settle_oath($1, true, NULL)", [oathId]);

  const creatorFinal = (await db.query("SELECT balance, escrow_locked, total_won FROM wallets WHERE user_id=$1", [ids.creator])).rows[0];
  assert.equal(Number(creatorFinal.balance), 1180); // 1000 + 180 = 1180
  assert.equal(Number(creatorFinal.escrow_locked), 0);
  assert.equal(Number(creatorFinal.total_won), 80); // Net profit: 180 - 100 = 80
});

test("Real User Journey 3: Squad Flow (Quorum Approvals & Realtime Chat Integration)", async () => {
  // Creator forms a 3-person squad with $50 stake ($150 total locked)
  const oathId = (await asUser(ids.creator, `SELECT public.create_oath_with_stake(
    'Ship the product MVP', now()+interval '5 days', 'squad', 'quorum', 'deadweight_tag', 50, 3, 3, NULL, NULL, NULL, NULL, NULL, 'survival'
  )`)).rows[0].create_oath_with_stake;

  const creatorWallet = (await db.query("SELECT balance, escrow_locked FROM wallets WHERE user_id=$1", [ids.creator])).rows[0];
  assert.equal(Number(creatorWallet.balance), 1030); // 1180 - 150 = 1030
  assert.equal(Number(creatorWallet.escrow_locked), 150);

  // Squad members join FREE
  await asUser(ids.squadMember1, "SELECT public.join_squad($1, 50)", [oathId]);
  await asUser(ids.squadMember2, "SELECT public.join_squad($1, 50)", [oathId]);

  // Messages table: Squad members chat in oath room
  await asUser(ids.creator, `INSERT INTO public.messages (oath_id, sender_id, content) VALUES ($1, $2, 'Welcome team!')`, [oathId, ids.creator]);
  await asUser(ids.squadMember1, `INSERT INTO public.messages (oath_id, sender_id, content) VALUES ($1, $2, 'Ready to build')`, [oathId, ids.squadMember1]);

  const messages = (await db.query("SELECT count(*)::int AS count FROM messages WHERE oath_id=$1", [oathId])).rows[0].count;
  assert.equal(messages, 2);

  // Member 1 submits proof
  const proofId = (await asUser(ids.squadMember1, "SELECT public.submit_oath_proof($1, 'text', NULL, 'MVP is deployed to production!')", [oathId])).rows[0].submit_oath_proof;
  assert.ok(proofId);

  // Creator & Member 2 cast quorum approvals
  const member1Row = (await db.query("SELECT id FROM group_members WHERE oath_id=$1 AND user_id=$2", [oathId, ids.squadMember1])).rows[0];
  await asUser(ids.creator, "SELECT public.cast_squad_vote($1, $2, true)", [oathId, member1Row.id]);
  
  // Member 1 status
  const member1Mid = (await db.query("SELECT status, votes_received FROM group_members WHERE id=$1", [member1Row.id])).rows[0];
  assert.equal(member1Mid.votes_received, 1);
});

test("Real User Journey 4: Public Lobby Flow (Individual Buy-In, Member Escrow Isolation & Forfeit)", async () => {
  // 1. Creator opens a public lobby with $30 individual buy-in
  const creatorInitial = (await db.query("SELECT balance, escrow_locked FROM wallets WHERE user_id=$1", [ids.creator])).rows[0];
  const lobbyId = (await asUser(ids.creator, `SELECT public.create_oath_with_stake(
    'Daily 10k steps challenge', now()+interval '3 days', 'lobby', 'peer', 'fiat', 30, 2, 4, NULL, NULL, NULL, NULL, NULL, 'survival'
  )`)).rows[0].create_oath_with_stake;

  const creatorAfter = (await db.query("SELECT balance, escrow_locked FROM wallets WHERE user_id=$1", [ids.creator])).rows[0];
  // Creator only paid their OWN $30 buy-in (not 4x)
  assert.equal(Number(creatorAfter.balance), Number(creatorInitial.balance) - 30);
  assert.equal(Number(creatorAfter.escrow_locked), Number(creatorInitial.escrow_locked) + 30);

  // Status is pending until min_players (2) is reached
  const lobbyRow = (await db.query("SELECT status, min_players, max_players FROM oaths WHERE id=$1", [lobbyId])).rows[0];
  assert.equal(lobbyRow.status, "pending");
  assert.equal(lobbyRow.min_players, 2);
  assert.equal(lobbyRow.max_players, 4);

  // 2. Member 1 joins with their own $30 buy-in
  const m1Initial = (await db.query("SELECT balance, escrow_locked FROM wallets WHERE user_id=$1", [ids.squadMember1])).rows[0];
  const m1Id = (await asUser(ids.squadMember1, "SELECT public.join_squad($1, 30)", [lobbyId])).rows[0].join_squad;
  assert.ok(m1Id);

  const m1AfterJoin = (await db.query("SELECT balance, escrow_locked FROM wallets WHERE user_id=$1", [ids.squadMember1])).rows[0];
  assert.equal(Number(m1AfterJoin.balance), Number(m1Initial.balance) - 30);
  assert.equal(Number(m1AfterJoin.escrow_locked), Number(m1Initial.escrow_locked) + 30);

  // Status transitions to active because min_players (2) is reached!
  const lobbyActive = (await db.query("SELECT status FROM oaths WHERE id=$1", [lobbyId])).rows[0];
  assert.equal(lobbyActive.status, "active");

  // 3. Member 1 forfeits from the lobby
  // In a lobby, the penalty is deducted from Member 1's escrow, NOT Creator's escrow!
  await asUser(ids.squadMember1, "SELECT public.forfeit_squad_member($1)", [lobbyId]);

  const m1AfterForfeit = (await db.query("SELECT balance, escrow_locked, total_lost FROM wallets WHERE user_id=$1", [ids.squadMember1])).rows[0];
  assert.equal(Number(m1AfterForfeit.balance), Number(m1AfterJoin.balance)); // Balance remains deducted
  assert.equal(Number(m1AfterForfeit.escrow_locked), Number(m1Initial.escrow_locked)); // Escrow unlocked
  assert.equal(Number(m1AfterForfeit.total_lost), 30); // Penalty recorded against member 1!

  // Creator's escrow is completely UNTOUCHED by Member 1's forfeit!
  const creatorAfterForfeit = (await db.query("SELECT balance, escrow_locked FROM wallets WHERE user_id=$1", [ids.creator])).rows[0];
  assert.equal(Number(creatorAfterForfeit.escrow_locked), Number(creatorAfter.escrow_locked));
  assert.equal(Number(creatorAfterForfeit.balance), Number(creatorAfter.balance));
});

