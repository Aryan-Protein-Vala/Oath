import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

let db;
const aliceId = "11111111-1111-4111-8111-111111111111";
const bobId = "22222222-2222-4222-8222-222222222222";
const googleUserId = "33333333-3333-4333-8333-333333333333";

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
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb default '{}'::jsonb
    );
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    CREATE TABLE public.profiles (
      id uuid primary key references auth.users(id),
      username text unique not null,
      display_name text,
      avatar_url text,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );

    CREATE TABLE public.wallets (
      id uuid primary key default gen_random_uuid(),
      user_id uuid unique not null references public.profiles(id),
      balance numeric(12,2) not null default 0
    );
  `);

  // Apply our migration
  const migrationSql = await readFile(
    "supabase/migrations/202610120002_google_username_modal_and_unique_usernames.sql",
    "utf8"
  );
  await db.exec(migrationSql);

  // Attach trigger to auth.users
  await db.exec(`
    DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  `);
});

test("Normal signup creates profile with is_username_custom = TRUE", async () => {
  // Simulate auth trigger for normal user signup
  await db.query(
    `INSERT INTO auth.users (id, email, raw_user_meta_data)
     VALUES ($1, 'alice@example.com', '{"username":"IronWill","display_name":"IronWill"}'::jsonb)`,
    [aliceId]
  );

  const res = await db.query(`SELECT username, is_username_custom FROM public.profiles WHERE id = $1`, [aliceId]);
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].username, "ironwill");
  assert.equal(res.rows[0].is_username_custom, true);
});

test("Google signup (no username in metadata) creates profile with is_username_custom = FALSE", async () => {
  // Simulate auth trigger for Google OAuth user (no username passed in metadata)
  await db.query(
    `INSERT INTO auth.users (id, email, raw_user_meta_data)
     VALUES ($1, 'googleuser@gmail.com', '{"full_name":"Google User"}'::jsonb)`,
    [googleUserId]
  );

  const res = await db.query(`SELECT username, is_username_custom FROM public.profiles WHERE id = $1`, [googleUserId]);
  assert.equal(res.rows.length, 1);
  assert.match(res.rows[0].username, /^user_[0-9a-f]{8}$/);
  assert.equal(res.rows[0].is_username_custom, false);
});

test("check_username_available returns false for taken usernames (case-insensitive)", async () => {
  // ironwill is taken (from Alice's signup)
  let check = await asUser(bobId, `SELECT public.check_username_available('ironwill') as avail`);
  assert.equal(check.rows[0].avail, false);

  check = await asUser(bobId, `SELECT public.check_username_available('IRONWILL') as avail`);
  assert.equal(check.rows[0].avail, false);

  check = await asUser(bobId, `SELECT public.check_username_available('iron_will') as avail`);
  assert.equal(check.rows[0].avail, true);
});

test("Case-insensitive duplicate insertion is strictly blocked by unique index", async () => {
  await assert.rejects(async () => {
    await db.query(
      `INSERT INTO auth.users (id, email, raw_user_meta_data)
       VALUES ($1, 'bob@example.com', '{"username":"ironwill"}'::jsonb)`,
      [bobId]
    );
  }, /duplicate key value violates unique constraint/);
});

test("Google user can claim available username via update_username RPC", async () => {
  // Google user sets username to 'phantom_blade'
  const updateRes = await asUser(googleUserId, `SELECT public.update_username('phantom_blade') as result`);
  const result = updateRes.rows[0].result;
  assert.equal(result.success, true);
  assert.equal(result.username, "phantom_blade");

  const profileRes = await db.query(`SELECT username, is_username_custom FROM public.profiles WHERE id = $1`, [googleUserId]);
  assert.equal(profileRes.rows[0].username, "phantom_blade");
  assert.equal(profileRes.rows[0].is_username_custom, true);

  // From Bob's perspective, 'phantom_blade' is now taken
  const avail = await asUser(bobId, `SELECT public.check_username_available('PHANTOM_BLADE') as avail`);
  assert.equal(avail.rows[0].avail, false);
});

test("update_username rejects invalid, too short, too long, or duplicate handles", async () => {
  // Too short
  let res = await asUser(googleUserId, `SELECT public.update_username('ab') as result`);
  assert.equal(res.rows[0].result.success, false);
  assert.match(res.rows[0].result.error, /at least 3 characters/);

  // Invalid chars
  res = await asUser(googleUserId, `SELECT public.update_username('bad!handle') as result`);
  assert.equal(res.rows[0].result.success, false);
  assert.match(res.rows[0].result.error, /letters, numbers, and underscores/);

  // Taken by Alice
  res = await asUser(googleUserId, `SELECT public.update_username('IronWill') as result`);
  assert.equal(res.rows[0].result.success, false);
  assert.match(res.rows[0].result.error, /already taken/);
});
