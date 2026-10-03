import assert from "node:assert/strict";
import { test, before } from "node:test";
import { PGlite } from "@electric-sql/pglite";

let db;
const ids = {
  alice: "11111111-1111-4111-8111-111111111111",
  bob: "22222222-2222-4222-8222-222222222222",
  cara: "33333333-3333-4333-8333-333333333333",
  dan: "44444444-4444-4444-8444-444444444444",
};

before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid primary key, email text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

    CREATE TYPE oath_type AS ENUM ('solo','duo','squad','lobby');
    CREATE TYPE oath_status AS ENUM ('pending','active','completed','failed','disputed','cancelled');
    CREATE TYPE verification_method AS ENUM ('nominee','peer','quorum','app_blocking');
    CREATE TYPE consequence_type AS ENUM ('anti_charity','public_shame','bounty_transfer','physical_debt','mutual_destruction','deadweight_tag','bounty_split','squad_lockdown','fiat','social_ransom','app_blocking','combined');
    CREATE TYPE proof_status AS ENUM ('pending_review','verified','rejected','disputed');
    CREATE TYPE transaction_type AS ENUM ('deposit','withdrawal','escrow_lock','escrow_release','penalty','reward','house_cut');
    CREATE TYPE wall_type AS ENUM ('shame','honor');

    CREATE TABLE public.profiles (
      id uuid primary key, username text unique not null, display_name text,
      oaths_created integer default 0, oaths_completed integer default 0, oaths_failed integer default 0,
      total_staked numeric(12,2) default 0, total_lost numeric(12,2) default 0, total_won numeric(12,2) default 0,
      created_at timestamptz default now(), updated_at timestamptz default now()
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
      verification_method verification_method not null default 'nominee', consequence_type consequence_type not null default 'fiat',
      stake_amount numeric(12,2) default 0, house_cut_percent numeric(4,2) default 10,
      status oath_status not null default 'active', min_players integer default 1, max_players integer default 1,
      opponent_id uuid references public.profiles(id), group_mode text default 'survival',
      created_at timestamptz default now(), updated_at timestamptz default now()
    );

    CREATE TABLE public.proofs (
      id uuid primary key default gen_random_uuid(), oath_id uuid not null references public.oaths(id),
      submitted_by uuid not null references public.profiles(id), proof_type text not null,
      proof_url text, proof_text text, status proof_status not null default 'pending_review',
      review_deadline timestamptz default (now() + interval '24 hours'),
      created_at timestamptz default now(), updated_at timestamptz default now()
    );

    CREATE TABLE public.group_members (
      id uuid primary key default gen_random_uuid(), oath_id uuid not null references public.oaths(id),
      user_id uuid not null references public.profiles(id), stake_amount numeric(12,2) default 0,
      status text not null default 'joined', votes_needed integer default 3, votes_received integer default 0,
      is_winner boolean default false, created_at timestamptz default now()
    );

    CREATE TABLE public.transactions (
      id uuid primary key default gen_random_uuid(), wallet_id uuid not null references public.wallets(id),
      oath_id uuid references public.oaths(id), type transaction_type not null, amount numeric(12,2) not null,
      description text, created_at timestamptz default now()
    );

    CREATE TABLE public.notifications (
      id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
      oath_id uuid references public.oaths(id), type text not null, title text not null,
      message text not null, status text default 'pending', created_at timestamptz default now()
    );
  `);

  for (const [name, uid] of Object.entries(ids)) {
    await db.query(`INSERT INTO public.profiles (id, username, display_name) VALUES ($1, $2, $3)`, [uid, name, name.toUpperCase()]);
    await db.query(`INSERT INTO public.wallets (user_id, balance, escrow_locked) VALUES ($1, 1000, 0)`, [uid]);
  }

  // Load airtight function
  await db.exec(`
    CREATE OR REPLACE FUNCTION public.auto_resolve_expired_oaths()
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp
    SET row_security = off
    AS $$
    DECLARE
      v_count INTEGER := 0;
      v_oath RECORD;
      v_member RECORD;
      v_creator_wallet UUID;
      v_creator_escrow NUMERIC;
      v_member_wallet UUID;
      v_member_escrow NUMERIC;
      v_release NUMERIC;
      v_creator_has_proof BOOLEAN;
      v_opponent_has_proof BOOLEAN;
      v_any_ghosted BOOLEAN;
      v_squad_total NUMERIC;
      v_house_cut NUMERIC;
      v_winner_reward NUMERIC;
    BEGIN
      -- 1. SOLO OATHS: Creator never submitted proof before deadline
      FOR v_oath IN
        SELECT o.*
        FROM public.oaths o
        WHERE o.status = 'active'
          AND o.oath_type = 'solo'
          AND o.deadline < now()
          AND NOT EXISTS (
            SELECT 1 FROM public.proofs p
            WHERE p.oath_id = o.id
              AND p.submitted_by = o.creator_id
          )
        FOR UPDATE SKIP LOCKED
      LOOP
        IF v_oath.stake_amount > 0 THEN
          SELECT id, coalesce(escrow_locked, 0)
          INTO v_creator_wallet, v_creator_escrow
          FROM public.wallets
          WHERE user_id = v_oath.creator_id
          FOR UPDATE;

          IF v_creator_wallet IS NOT NULL THEN
            v_release := least(v_creator_escrow, v_oath.stake_amount);
            IF v_release > 0 THEN
              UPDATE public.wallets
              SET escrow_locked = escrow_locked - v_release,
                  total_lost = coalesce(total_lost, 0) + v_release,
                  updated_at = now()
              WHERE id = v_creator_wallet;

              INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
              VALUES (v_creator_wallet, v_oath.id, 'penalty', v_release, 'Solo Oath Failed: Missed deadline without submitting proof');
            END IF;
          END IF;
        END IF;

        UPDATE public.profiles
        SET oaths_failed = coalesce(oaths_failed, 0) + 1,
            total_lost = coalesce(total_lost, 0) + coalesce(v_release, 0),
            updated_at = now()
        WHERE id = v_oath.creator_id;

        INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
        VALUES (
          v_oath.creator_id,
          v_oath.id,
          'system',
          'You Failed the Oath',
          'You failed to submit proof before the deadline. Your stake has been seized.',
          'pending'
        );

        UPDATE public.oaths
        SET status = 'failed', updated_at = now()
        WHERE id = v_oath.id;

        v_count := v_count + 1;
      END LOOP;

      -- 2. DUO OATHS: Leader pays 2x upfront, check creator and opponent submissions
      FOR v_oath IN
        SELECT o.*
        FROM public.oaths o
        WHERE o.status = 'active'
          AND o.oath_type = 'duo'
          AND o.deadline < now()
        FOR UPDATE SKIP LOCKED
      LOOP
        v_creator_has_proof := EXISTS (
          SELECT 1 FROM public.proofs p WHERE p.oath_id = v_oath.id AND p.submitted_by = v_oath.creator_id
        );
        v_opponent_has_proof := EXISTS (
          SELECT 1 FROM public.proofs p WHERE p.oath_id = v_oath.id AND p.submitted_by = v_oath.opponent_id
        );

        IF NOT v_creator_has_proof OR NOT v_opponent_has_proof THEN
          v_squad_total := v_oath.stake_amount * 2;

          -- Case A: BOTH ghosted
          IF NOT v_creator_has_proof AND NOT v_opponent_has_proof THEN
            SELECT id, coalesce(escrow_locked, 0) INTO v_creator_wallet, v_creator_escrow
            FROM public.wallets WHERE user_id = v_oath.creator_id FOR UPDATE;

            IF v_creator_wallet IS NOT NULL THEN
              v_release := least(v_creator_escrow, v_squad_total);
              IF v_release > 0 THEN
                UPDATE public.wallets
                SET escrow_locked = escrow_locked - v_release,
                    total_lost = coalesce(total_lost, 0) + v_release,
                    updated_at = now()
                WHERE id = v_creator_wallet;

                INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
                VALUES (v_creator_wallet, v_oath.id, 'penalty', v_release, 'Duo Duel Failed: Neither player submitted proof');
              END IF;
            END IF;

            UPDATE public.group_members SET status = 'failed', is_winner = false WHERE oath_id = v_oath.id;

            UPDATE public.profiles SET oaths_failed = coalesce(oaths_failed, 0) + 1, updated_at = now()
            WHERE id IN (v_oath.creator_id, v_oath.opponent_id);

            UPDATE public.profiles SET total_lost = coalesce(total_lost, 0) + coalesce(v_release, 0)
            WHERE id = v_oath.creator_id;

            INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
            VALUES
              (v_oath.creator_id, v_oath.id, 'system', 'Duel Expired', 'Neither player submitted proof in time. Total duel stake seized.', 'pending'),
              (v_oath.opponent_id, v_oath.id, 'system', 'Duel Expired', 'Neither player submitted proof in time for the duel.', 'pending');

            UPDATE public.oaths SET status = 'failed', updated_at = now() WHERE id = v_oath.id;
            v_count := v_count + 1;

          -- Case B: Creator submitted proof, Opponent ghosted -> Creator wins!
          ELSIF v_creator_has_proof AND NOT v_opponent_has_proof THEN
            UPDATE public.group_members SET status = 'failed', is_winner = false
            WHERE oath_id = v_oath.id AND user_id = v_oath.opponent_id;

            UPDATE public.group_members SET status = 'completed', is_winner = true
            WHERE oath_id = v_oath.id AND user_id = v_oath.creator_id;

            UPDATE public.profiles SET oaths_failed = coalesce(oaths_failed, 0) + 1, updated_at = now()
            WHERE id = v_oath.opponent_id;

            UPDATE public.profiles SET oaths_completed = coalesce(oaths_completed, 0) + 1, updated_at = now()
            WHERE id = v_oath.creator_id;

            SELECT id, coalesce(escrow_locked, 0) INTO v_creator_wallet, v_creator_escrow
            FROM public.wallets WHERE user_id = v_oath.creator_id FOR UPDATE;

            IF v_creator_wallet IS NOT NULL THEN
              v_release := least(v_creator_escrow, v_squad_total);
              IF v_release > 0 THEN
                UPDATE public.wallets
                SET balance = balance + v_release,
                    escrow_locked = escrow_locked - v_release,
                    total_won = coalesce(total_won, 0) + v_oath.stake_amount,
                    updated_at = now()
                WHERE id = v_creator_wallet;

                INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
                VALUES (v_creator_wallet, v_oath.id, 'reward', v_release, 'Opponent ghosted: Won duo challenge');
              END IF;
            END IF;

            INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
            VALUES
              (v_oath.creator_id, v_oath.id, 'system', 'You Won the Duel!', 'Your opponent failed to submit proof before the deadline. Pot unlocked!', 'pending'),
              (v_oath.opponent_id, v_oath.id, 'system', 'Duel Lost', 'You failed to submit proof in time for the duel.', 'pending');

            UPDATE public.oaths SET status = 'completed', updated_at = now() WHERE id = v_oath.id;
            v_count := v_count + 1;

          -- Case C: Opponent submitted proof, Creator ghosted -> Opponent wins!
          ELSIF NOT v_creator_has_proof AND v_opponent_has_proof THEN
            UPDATE public.group_members SET status = 'failed', is_winner = false
            WHERE oath_id = v_oath.id AND user_id = v_oath.creator_id;

            UPDATE public.group_members SET status = 'completed', is_winner = true
            WHERE oath_id = v_oath.id AND user_id = v_oath.opponent_id;

            UPDATE public.profiles SET oaths_failed = coalesce(oaths_failed, 0) + 1, updated_at = now()
            WHERE id = v_oath.creator_id;

            UPDATE public.profiles SET oaths_completed = coalesce(oaths_completed, 0) + 1, updated_at = now()
            WHERE id = v_oath.opponent_id;

            SELECT id, coalesce(escrow_locked, 0) INTO v_creator_wallet, v_creator_escrow
            FROM public.wallets WHERE user_id = v_oath.creator_id FOR UPDATE;

            IF v_creator_wallet IS NOT NULL THEN
              v_release := least(v_creator_escrow, v_squad_total);
              IF v_release > 0 THEN
                UPDATE public.wallets
                SET escrow_locked = escrow_locked - v_release,
                    total_lost = coalesce(total_lost, 0) + v_release,
                    updated_at = now()
                WHERE id = v_creator_wallet;

                INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
                VALUES (v_creator_wallet, v_oath.id, 'penalty', v_release, 'Missed deadline: Duel forfeited to opponent');

                v_house_cut := round(v_release * 0.10, 2);
                v_winner_reward := v_release - v_house_cut;

                SELECT id INTO v_member_wallet FROM public.wallets WHERE user_id = v_oath.opponent_id FOR UPDATE;
                IF v_member_wallet IS NOT NULL THEN
                  UPDATE public.wallets
                  SET balance = balance + v_winner_reward,
                      total_won = coalesce(total_won, 0) + v_winner_reward,
                      updated_at = now()
                  WHERE id = v_member_wallet;

                  INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
                  VALUES (v_member_wallet, v_oath.id, 'reward', v_winner_reward, 'Creator ghosted: Won duo challenge');
                END IF;

                UPDATE public.profiles SET total_won = coalesce(total_won, 0) + v_winner_reward WHERE id = v_oath.opponent_id;
                UPDATE public.profiles SET total_lost = coalesce(total_lost, 0) + v_release WHERE id = v_oath.creator_id;
              END IF;
            END IF;

            INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
            VALUES
              (v_oath.opponent_id, v_oath.id, 'system', 'You Won the Duel!', 'Creator failed to submit proof before the deadline. Pot awarded!', 'pending'),
              (v_oath.creator_id, v_oath.id, 'system', 'Duel Lost', 'You failed to submit proof in time. Duel stake seized.', 'pending');

            UPDATE public.oaths SET status = 'completed', updated_at = now() WHERE id = v_oath.id;
            v_count := v_count + 1;
          END IF;
        END IF;
      END LOOP;

      -- 3. SQUAD OATHS: Weakest Link & Survival
      FOR v_oath IN
        SELECT o.*
        FROM public.oaths o
        WHERE o.status = 'active'
          AND o.oath_type = 'squad'
          AND o.deadline < now()
        FOR UPDATE SKIP LOCKED
      LOOP
        IF v_oath.group_mode = 'weakest_link' THEN
          v_any_ghosted := EXISTS (
            SELECT 1 FROM public.group_members gm
            WHERE gm.oath_id = v_oath.id
              AND gm.status = 'joined'
              AND NOT EXISTS (
                SELECT 1 FROM public.proofs p WHERE p.oath_id = v_oath.id AND p.submitted_by = gm.user_id
              )
          );

          IF v_any_ghosted THEN
            v_squad_total := v_oath.stake_amount * v_oath.max_players;
            SELECT id, coalesce(escrow_locked, 0) INTO v_creator_wallet, v_creator_escrow
            FROM public.wallets WHERE user_id = v_oath.creator_id FOR UPDATE;

            IF v_creator_wallet IS NOT NULL THEN
              v_release := least(v_creator_escrow, v_squad_total);
              IF v_release > 0 THEN
                UPDATE public.wallets
                SET escrow_locked = escrow_locked - v_release,
                    total_lost = coalesce(total_lost, 0) + v_release,
                    updated_at = now()
                WHERE id = v_creator_wallet;

                INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
                VALUES (v_creator_wallet, v_oath.id, 'penalty', v_release, 'Weakest Link squad failed: Member(s) missed deadline without submitting proof');
              END IF;
            END IF;

            UPDATE public.group_members
            SET status = 'failed', is_winner = false
            WHERE oath_id = v_oath.id AND status = 'joined';

            UPDATE public.profiles SET oaths_failed = coalesce(oaths_failed, 0) + 1, updated_at = now()
            WHERE id = v_oath.creator_id;

            UPDATE public.oaths SET status = 'failed', updated_at = now() WHERE id = v_oath.id;

            INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
            SELECT gm.user_id, v_oath.id, 'system', 'Squad Failed', 'Weakest Link broken: A member failed to submit proof before the deadline.', 'pending'
            FROM public.group_members gm WHERE gm.oath_id = v_oath.id;

            v_count := v_count + 1;
          END IF;

        ELSE
          -- Survival squad: fail each ghosted member
          FOR v_member IN
            SELECT gm.id, gm.user_id
            FROM public.group_members gm
            WHERE gm.oath_id = v_oath.id
              AND gm.status = 'joined'
              AND NOT EXISTS (
                SELECT 1 FROM public.proofs p WHERE p.oath_id = v_oath.id AND p.submitted_by = gm.user_id
              )
          LOOP
            UPDATE public.group_members SET status = 'failed', is_winner = false WHERE id = v_member.id;
            UPDATE public.profiles SET oaths_failed = coalesce(oaths_failed, 0) + 1, updated_at = now() WHERE id = v_member.user_id;

            IF v_oath.stake_amount > 0 THEN
              SELECT id, coalesce(escrow_locked, 0) INTO v_creator_wallet, v_creator_escrow
              FROM public.wallets WHERE user_id = v_oath.creator_id FOR UPDATE;

              IF v_creator_wallet IS NOT NULL THEN
                v_release := least(v_creator_escrow, v_oath.stake_amount);
                IF v_release > 0 THEN
                  UPDATE public.wallets
                  SET escrow_locked = escrow_locked - v_release,
                      total_lost = coalesce(total_lost, 0) + v_release,
                      updated_at = now()
                  WHERE id = v_creator_wallet;

                  INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
                  VALUES (v_creator_wallet, v_oath.id, 'penalty', v_release, 'Squad member missed deadline without submitting proof');
                END IF;
              END IF;
            END IF;

            INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
            VALUES (v_member.user_id, v_oath.id, 'system', 'Squad Member Failed', 'You missed the deadline without submitting proof.', 'pending');

            v_count := v_count + 1;
          END LOOP;

          -- Check if all members resolved
          IF NOT EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = v_oath.id AND status = 'joined') THEN
            IF EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = v_oath.id AND status = 'completed') THEN
              UPDATE public.oaths SET status = 'completed', updated_at = now() WHERE id = v_oath.id;
            ELSE
              UPDATE public.oaths SET status = 'failed', updated_at = now() WHERE id = v_oath.id;
            END IF;
          END IF;
        END IF;
      END LOOP;

      -- 4. PUBLIC LOBBY OATHS
      FOR v_member IN
        SELECT gm.id, gm.oath_id, gm.user_id, o.stake_amount
        FROM public.group_members gm
        JOIN public.oaths o ON o.id = gm.oath_id
        WHERE o.status = 'active'
          AND o.oath_type = 'lobby'
          AND o.deadline < now()
          AND gm.status = 'joined'
          AND NOT EXISTS (
            SELECT 1 FROM public.proofs p WHERE p.oath_id = gm.oath_id AND p.submitted_by = gm.user_id
          )
        FOR UPDATE SKIP LOCKED
      LOOP
        UPDATE public.group_members SET status = 'failed', is_winner = false WHERE id = v_member.id;

        IF v_member.stake_amount > 0 THEN
          SELECT id, coalesce(escrow_locked, 0) INTO v_member_wallet, v_member_escrow
          FROM public.wallets WHERE user_id = v_member.user_id FOR UPDATE;

          IF v_member_wallet IS NOT NULL THEN
            v_release := least(v_member_escrow, v_member.stake_amount);
            IF v_release > 0 THEN
              UPDATE public.wallets
              SET escrow_locked = escrow_locked - v_release,
                  total_lost = coalesce(total_lost, 0) + v_release,
                  updated_at = now()
              WHERE id = v_member_wallet;

              INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
              VALUES (v_member_wallet, v_member.oath_id, 'penalty', v_release, 'Lobby Member Failed: Missed deadline without submitting proof');
            END IF;
          END IF;
        END IF;

        UPDATE public.profiles
        SET oaths_failed = coalesce(oaths_failed, 0) + 1,
            total_lost = coalesce(total_lost, 0) + coalesce(v_release, 0),
            updated_at = now()
        WHERE id = v_member.user_id;

        INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
        VALUES (v_member.user_id, v_member.oath_id, 'system', 'Lobby Failed', 'You missed the deadline without submitting proof. Stake seized.', 'pending');

        v_count := v_count + 1;
      END LOOP;

      FOR v_oath IN
        SELECT o.id
        FROM public.oaths o
        WHERE o.status = 'active'
          AND o.oath_type = 'lobby'
          AND o.deadline < now()
          AND NOT EXISTS (
            SELECT 1 FROM public.group_members gm WHERE gm.oath_id = o.id AND gm.status = 'joined'
          )
        FOR UPDATE SKIP LOCKED
      LOOP
        IF EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = v_oath.id AND status = 'completed') THEN
          UPDATE public.oaths SET status = 'completed', updated_at = now() WHERE id = v_oath.id;
        ELSE
          UPDATE public.oaths SET status = 'failed', updated_at = now() WHERE id = v_oath.id;
        END IF;
      END LOOP;

      RETURN v_count;
    END;
    $$;
  `);
});

test("Scenario 1: Solo oath creator ghosts -> Fails and seizes escrow", async () => {
  await db.query(`UPDATE public.wallets SET escrow_locked = 50, balance = balance - 50 WHERE user_id = $1`, [ids.alice]);
  const res = await db.query(`
    INSERT INTO public.oaths (creator_id, oath_statement, deadline, oath_type, stake_amount, status)
    VALUES ($1, 'Solo gym workout', now() - interval '1 hour', 'solo', 50, 'active')
    RETURNING id
  `, [ids.alice]);
  const oathId = res.rows[0].id;

  const count = (await db.query(`SELECT public.auto_resolve_expired_oaths() AS count`)).rows[0].count;
  assert.equal(count, 1);

  const oath = (await db.query(`SELECT status FROM public.oaths WHERE id = $1`, [oathId])).rows[0];
  assert.equal(oath.status, "failed");

  const wallet = (await db.query(`SELECT escrow_locked, total_lost FROM public.wallets WHERE user_id = $1`, [ids.alice])).rows[0];
  assert.equal(Number(wallet.escrow_locked), 0);
  assert.equal(Number(wallet.total_lost), 50);
});

test("Scenario 2: Duo challenge both ghost -> Creator full 2x escrow seized and both failed", async () => {
  await db.query(`UPDATE public.wallets SET escrow_locked = 100, balance = balance - 100 WHERE user_id = $1`, [ids.alice]);
  const res = await db.query(`
    INSERT INTO public.oaths (creator_id, opponent_id, oath_statement, deadline, oath_type, stake_amount, status)
    VALUES ($1, $2, 'Duel where both ghost', now() - interval '1 hour', 'duo', 50, 'active')
    RETURNING id
  `, [ids.alice, ids.bob]);
  const oathId = res.rows[0].id;

  await db.query(`INSERT INTO public.group_members (oath_id, user_id, stake_amount, status) VALUES ($1, $2, 50, 'joined')`, [oathId, ids.alice]);
  await db.query(`INSERT INTO public.group_members (oath_id, user_id, stake_amount, status) VALUES ($1, $2, 0, 'joined')`, [oathId, ids.bob]);

  const count = (await db.query(`SELECT public.auto_resolve_expired_oaths() AS count`)).rows[0].count;
  assert.equal(count, 1);

  const oath = (await db.query(`SELECT status FROM public.oaths WHERE id = $1`, [oathId])).rows[0];
  assert.equal(oath.status, "failed");

  const wallet = (await db.query(`SELECT escrow_locked, total_lost FROM public.wallets WHERE user_id = $1`, [ids.alice])).rows[0];
  assert.equal(Number(wallet.escrow_locked), 0);
  assert.equal(Number(wallet.total_lost), 150); // 50 from solo + 100 from duo
});

test("Scenario 3: Weakest Link squad member ghosts -> Entire squad fails and leader escrow seized", async () => {
  await db.query(`UPDATE public.wallets SET escrow_locked = 120, balance = balance - 120 WHERE user_id = $1`, [ids.alice]);
  const res = await db.query(`
    INSERT INTO public.oaths (creator_id, oath_statement, deadline, oath_type, group_mode, stake_amount, max_players, status)
    VALUES ($1, 'Weakest Link test', now() - interval '1 hour', 'squad', 'weakest_link', 40, 3, 'active')
    RETURNING id
  `, [ids.alice]);
  const oathId = res.rows[0].id;

  await db.query(`INSERT INTO public.group_members (oath_id, user_id, stake_amount, status) VALUES ($1, $2, 40, 'joined')`, [oathId, ids.alice]);
  await db.query(`INSERT INTO public.group_members (oath_id, user_id, stake_amount, status) VALUES ($1, $2, 0, 'joined')`, [oathId, ids.bob]);
  await db.query(`INSERT INTO public.group_members (oath_id, user_id, stake_amount, status) VALUES ($1, $2, 0, 'joined')`, [oathId, ids.cara]);

  // Alice and Bob submitted, Cara ghosted
  await db.query(`INSERT INTO public.proofs (oath_id, submitted_by, proof_type, status) VALUES ($1, $2, 'text', 'pending_review')`, [oathId, ids.alice]);
  await db.query(`INSERT INTO public.proofs (oath_id, submitted_by, proof_type, status) VALUES ($1, $2, 'text', 'pending_review')`, [oathId, ids.bob]);

  const count = (await db.query(`SELECT public.auto_resolve_expired_oaths() AS count`)).rows[0].count;
  assert.equal(count, 1);

  const oath = (await db.query(`SELECT status FROM public.oaths WHERE id = $1`, [oathId])).rows[0];
  assert.equal(oath.status, "failed");

  const wallet = (await db.query(`SELECT escrow_locked, total_lost FROM public.wallets WHERE user_id = $1`, [ids.alice])).rows[0];
  assert.equal(Number(wallet.escrow_locked), 0);
  assert.equal(Number(wallet.total_lost), 270); // 150 + 120
});

test("Scenario 4: Survival squad where all members ghosted -> Squad status becomes failed (NOT completed!)", async () => {
  await db.query(`UPDATE public.wallets SET escrow_locked = 60, balance = balance - 60 WHERE user_id = $1`, [ids.alice]);
  const res = await db.query(`
    INSERT INTO public.oaths (creator_id, oath_statement, deadline, oath_type, group_mode, stake_amount, max_players, status)
    VALUES ($1, 'Survival all ghost', now() - interval '1 hour', 'squad', 'survival', 30, 2, 'active')
    RETURNING id
  `, [ids.alice]);
  const oathId = res.rows[0].id;

  await db.query(`INSERT INTO public.group_members (oath_id, user_id, stake_amount, status) VALUES ($1, $2, 30, 'joined')`, [oathId, ids.alice]);
  await db.query(`INSERT INTO public.group_members (oath_id, user_id, stake_amount, status) VALUES ($1, $2, 0, 'joined')`, [oathId, ids.bob]);

  // Neither submitted proof
  const count = (await db.query(`SELECT public.auto_resolve_expired_oaths() AS count`)).rows[0].count;
  assert.equal(count, 2); // 2 members failed

  const oath = (await db.query(`SELECT status FROM public.oaths WHERE id = $1`, [oathId])).rows[0];
  assert.equal(oath.status, "failed", "Survival squad where all ghosted must be failed, NOT completed");
});
