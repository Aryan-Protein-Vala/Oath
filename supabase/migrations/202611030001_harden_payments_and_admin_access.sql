-- Security hardening: payment idempotency, server-only credits, real admin roles, and settlement/overload cleanup.

BEGIN;

-- 1. Wallet balances must never be creditable through a browser-accessible RPC.
DROP FUNCTION IF EXISTS public.add_funds(NUMERIC);
DROP FUNCTION IF EXISTS public.add_funds(NUMERIC, TEXT);

REVOKE ALL ON FUNCTION public.add_funds_server(UUID, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_funds_server(UUID, NUMERIC, TEXT) TO service_role;

-- 2. The order record is created by the server before checkout and is the source of
-- truth for the provider amount, wallet credit, owner, and idempotency state.
CREATE TABLE IF NOT EXISTS public.payment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('paypal', 'razorpay')),
  provider_order_id TEXT NOT NULL,
  provider_payment_id TEXT,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  gateway_amount NUMERIC(12,2) NOT NULL CHECK (gateway_amount > 0),
  wallet_amount NUMERIC(12,2) NOT NULL CHECK (wallet_amount > 0),
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'INR')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'credited', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  credited_at TIMESTAMPTZ,
  UNIQUE (provider, provider_order_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_provider_payment_id_key
  ON public.payment_orders (provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_orders FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.payment_orders TO service_role;

-- 3. Service-role only and transactional: a provider order can credit a wallet once.
CREATE OR REPLACE FUNCTION public.credit_verified_payment(
  p_provider TEXT,
  p_provider_order_id TEXT,
  p_provider_payment_id TEXT,
  p_user_id UUID,
  p_gateway_amount NUMERIC,
  p_currency TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_wallet_id UUID;
BEGIN
  SELECT * INTO v_order
  FROM public.payment_orders
  WHERE provider = p_provider
    AND provider_order_id = p_provider_order_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment order not found for this account';
  END IF;

  IF v_order.status = 'credited' THEN
    IF v_order.provider_payment_id <> p_provider_payment_id THEN
      RAISE EXCEPTION 'Payment order was already credited with a different provider payment';
    END IF;
    RETURN jsonb_build_object('success', true, 'already_credited', true, 'wallet_amount', v_order.wallet_amount);
  END IF;

  IF round(coalesce(p_gateway_amount, 0), 2) <> v_order.gateway_amount
     OR upper(coalesce(p_currency, '')) <> v_order.currency THEN
    RAISE EXCEPTION 'Verified provider payment does not match the server-created order';
  END IF;

  SELECT id INTO v_wallet_id
  FROM public.wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  UPDATE public.wallets
  SET balance = balance + v_order.wallet_amount,
      total_deposited = coalesce(total_deposited, 0) + v_order.wallet_amount,
      updated_at = now()
  WHERE id = v_wallet_id;

  INSERT INTO public.transactions (wallet_id, type, amount, description)
  VALUES (
    v_wallet_id,
    'deposit'::public.transaction_type,
    v_order.wallet_amount,
    format('Verified %s payment (%s)', initcap(v_order.provider), p_provider_payment_id)
  );

  UPDATE public.payment_orders
  SET status = 'credited',
      provider_payment_id = p_provider_payment_id,
      credited_at = now()
  WHERE id = v_order.id;

  RETURN jsonb_build_object('success', true, 'already_credited', false, 'wallet_amount', v_order.wallet_amount);
END;
$$;

REVOKE ALL ON FUNCTION public.credit_verified_payment(TEXT, TEXT, TEXT, UUID, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_verified_payment(TEXT, TEXT, TEXT, UUID, NUMERIC, TEXT) TO service_role;

-- 4. Only an immutable account id or Supabase app_metadata can establish admin access.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT auth.uid() = '26e5d445-0a36-4c77-a8e6-025dfb55af52'::uuid
    OR coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- 5. Usernames must never be accepted as an authorization mechanism (including on signup).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_raw_username TEXT;
  v_is_custom BOOLEAN := FALSE;
  v_clean_username TEXT;
BEGIN
  v_raw_username := nullif(trim(NEW.raw_user_meta_data->>'username'), '');
  IF v_raw_username IS NOT NULL THEN
    v_clean_username := lower(regexp_replace(v_raw_username, '[^a-zA-Z0-9_]', '', 'g'));
    IF length(v_clean_username) >= 3
       AND length(v_clean_username) <= 24
       AND v_clean_username <> ALL (ARRAY['admin', 'real_admin', 'reaper_exe']) THEN
      v_is_custom := TRUE;
    ELSE
      v_clean_username := 'user_' || lower(left(NEW.id::text, 8));
    END IF;
  ELSE
    v_clean_username := 'user_' || lower(left(NEW.id::text, 8));
  END IF;

  INSERT INTO public.profiles (id, username, display_name, avatar_url, is_username_custom)
  VALUES (
    NEW.id,
    v_clean_username,
    COALESCE(NEW.raw_user_meta_data->>'display_name', CASE WHEN v_is_custom THEN v_clean_username ELSE 'Anonymous' END),
    NEW.raw_user_meta_data->>'avatar_url',
    v_is_custom
  )
  ON CONFLICT (id) DO UPDATE
  SET username = CASE WHEN public.profiles.is_username_custom THEN public.profiles.username ELSE EXCLUDED.username END,
      is_username_custom = (public.profiles.is_username_custom OR EXCLUDED.is_username_custom),
      updated_at = now();

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_username_available(p_username TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_clean TEXT;
BEGIN
  v_clean := lower(trim(regexp_replace(coalesce(p_username, ''), '^@+', '')));
  IF length(v_clean) < 3 OR length(v_clean) > 24
     OR v_clean !~ '^[a-z0-9_]+$'
     OR v_clean = ANY (ARRAY['admin', 'real_admin', 'reaper_exe']) THEN
    RETURN FALSE;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(trim(username)) = v_clean
      AND (auth.uid() IS NULL OR id != auth.uid())
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_username(p_username TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_clean TEXT;
  v_exists BOOLEAN;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  v_clean := lower(trim(regexp_replace(coalesce(p_username, ''), '^@+', '')));
  IF length(v_clean) < 3 OR length(v_clean) > 24 OR v_clean !~ '^[a-z0-9_]+$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Username must be 3–24 lowercase letters, numbers, or underscores');
  END IF;
  IF v_clean = ANY (ARRAY['admin', 'real_admin', 'reaper_exe']) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This username is reserved');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(trim(username)) = v_clean AND id != v_user
  ) INTO v_exists;
  IF v_exists THEN
    RETURN jsonb_build_object('success', false, 'error', 'Username is already taken');
  END IF;

  UPDATE public.profiles
  SET username = v_clean,
      display_name = v_clean,
      is_username_custom = TRUE,
      updated_at = now()
  WHERE id = v_user;

  UPDATE auth.users
  SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('username', v_clean, 'display_name', v_clean)
  WHERE id = v_user;

  RETURN jsonb_build_object('success', true, 'username', v_clean);
END;
$$;

-- 6. Drop legacy ambiguous overloads of settle_oath and unify onto settle_oath(UUID, TEXT)
DROP FUNCTION IF EXISTS public.settle_oath(UUID, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.settle_oath(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.settle_oath(UUID, TEXT);

-- 7. Harden settle_oath(UUID, TEXT) so that:
--    - Cron / service_role (when auth.uid() IS NULL) and admins can settle expired oaths
--    - Shared Duo, Squad, and Lobby 1x individual stake escrow rules are respected
CREATE OR REPLACE FUNCTION public.settle_oath(
  p_oath_id UUID,
  p_verdict TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_oath RECORD;
  v_user UUID := auth.uid();
  v_role TEXT := coalesce(auth.role(), '');
  v_stake NUMERIC;
  v_member RECORD;
  v_wallet_id UUID;
BEGIN
  IF v_user IS NULL AND v_role <> 'service_role' AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_verdict NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'Invalid verdict: %', p_verdict;
  END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oath not found';
  END IF;

  IF v_oath.status IN ('completed', 'failed', 'cancelled') THEN
    RETURN jsonb_build_object('status', v_oath.status, 'already_settled', true);
  END IF;

  v_stake := COALESCE(v_oath.stake_amount, 0);

  IF v_oath.oath_type = 'solo' THEN
    IF v_user IS NOT NULL AND v_oath.creator_id != v_user AND NOT public.is_admin() THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.nominees n
        JOIN public.profiles p ON (
          lower(p.username) = lower(regexp_replace(COALESCE(n.email, ''), '^@+', ''))
          OR lower(p.username) = lower(regexp_replace(COALESCE(v_oath.nominee_email, ''), '^@+', ''))
        )
        WHERE n.oath_id = p_oath_id AND p.id = v_user
      ) THEN
        RAISE EXCEPTION 'Not authorized to settle this solo oath';
      END IF;
    END IF;

    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_oath.creator_id FOR UPDATE;

    IF p_verdict = 'completed' THEN
      UPDATE public.oaths SET status = 'completed', completed_at = now(), settled_at = now(), updated_at = now() WHERE id = p_oath_id;
      IF v_stake > 0 AND v_wallet_id IS NOT NULL THEN
        UPDATE public.wallets
        SET escrow_locked = GREATEST(0, escrow_locked - v_stake),
            balance = balance + v_stake,
            updated_at = now()
        WHERE id = v_wallet_id;

        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_wallet_id, p_oath_id, 'escrow_release', v_stake, 'Oath completed — stake returned');
      END IF;
      PERFORM public.handle_profile_completion(v_oath.creator_id);
      INSERT INTO public.wall_entries (oath_id, user_id, wall_type, oath_statement, stake_amount, username)
      SELECT p_oath_id, v_oath.creator_id, 'honor', v_oath.oath_statement, v_stake, username
      FROM public.profiles WHERE id = v_oath.creator_id;
    ELSE
      UPDATE public.oaths SET status = 'failed', failed_at = now(), settled_at = now(), updated_at = now() WHERE id = p_oath_id;
      IF v_stake > 0 AND v_wallet_id IS NOT NULL THEN
        UPDATE public.wallets
        SET escrow_locked = GREATEST(0, escrow_locked - v_stake),
            total_lost = COALESCE(total_lost, 0) + v_stake,
            updated_at = now()
        WHERE id = v_wallet_id;

        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_wallet_id, p_oath_id, 'penalty', v_stake, 'Oath failed — stake forfeited');
      END IF;
      PERFORM public.handle_profile_failure(v_oath.creator_id, v_stake, p_oath_id);
    END IF;
  ELSE
    -- Duo, Squad, or Lobby settlement: settle all remaining 'joined' members according to p_verdict
    IF v_user IS NOT NULL AND v_oath.creator_id != v_user AND v_oath.opponent_id != v_user AND NOT public.is_admin() THEN
      IF NOT EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = p_oath_id AND user_id = v_user) THEN
        RAISE EXCEPTION 'Not authorized to settle this group oath';
      END IF;
    END IF;

    FOR v_member IN
      SELECT gm.* FROM public.group_members gm
      WHERE gm.oath_id = p_oath_id AND gm.status = 'joined'
      FOR UPDATE
    LOOP
      SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_member.user_id FOR UPDATE;
      IF p_verdict = 'completed' THEN
        UPDATE public.group_members SET status = 'completed', is_winner = TRUE WHERE id = v_member.id;
        IF COALESCE(v_member.stake_amount, v_stake) > 0 AND v_wallet_id IS NOT NULL THEN
          UPDATE public.wallets
          SET escrow_locked = GREATEST(0, escrow_locked - COALESCE(v_member.stake_amount, v_stake)),
              balance = balance + COALESCE(v_member.stake_amount, v_stake),
              updated_at = now()
          WHERE id = v_wallet_id;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_wallet_id, p_oath_id, 'escrow_release', COALESCE(v_member.stake_amount, v_stake), 'Oath completed — stake returned');
        END IF;
        PERFORM public.handle_profile_completion(v_member.user_id);
      ELSE
        UPDATE public.group_members SET status = 'failed', is_winner = FALSE WHERE id = v_member.id;
        IF COALESCE(v_member.stake_amount, v_stake) > 0 AND v_wallet_id IS NOT NULL THEN
          UPDATE public.wallets
          SET escrow_locked = GREATEST(0, escrow_locked - COALESCE(v_member.stake_amount, v_stake)),
              total_lost = COALESCE(total_lost, 0) + COALESCE(v_member.stake_amount, v_stake),
              updated_at = now()
          WHERE id = v_wallet_id;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_wallet_id, p_oath_id, 'penalty', COALESCE(v_member.stake_amount, v_stake), 'Oath failed — stake forfeited');
        END IF;
        PERFORM public.handle_profile_failure(v_member.user_id, COALESCE(v_member.stake_amount, v_stake), p_oath_id);
      END IF;
    END LOOP;

    UPDATE public.oaths
    SET status = p_verdict::public.oath_status,
        completed_at = CASE WHEN p_verdict = 'completed' THEN now() ELSE completed_at END,
        failed_at = CASE WHEN p_verdict = 'failed' THEN now() ELSE failed_at END,
        settled_at = now(),
        updated_at = now()
    WHERE id = p_oath_id;
  END IF;

  RETURN jsonb_build_object('status', p_verdict);
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_oath(UUID, TEXT) TO authenticated, service_role;

-- 8. Fix verify_nominee so single-deadline rejection records the lost amount and Wall of Shame entry,
--    and uses a valid notification type ('oath_settled').
DROP FUNCTION IF EXISTS public.verify_nominee(UUID, BOOLEAN, TEXT);
CREATE OR REPLACE FUNCTION public.verify_nominee(
  p_token TEXT,
  p_approved BOOLEAN,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_nominee RECORD;
  v_oath RECORD;
  v_proof RECORD;
  v_wallet_id UUID;
  v_stake NUMERIC;
  v_cadence TEXT;
  v_total_days INT;
  v_current_day INT;
  v_next_day INT;
  v_is_final_day BOOLEAN;
BEGIN
  SELECT * INTO v_nominee
  FROM public.nominees
  WHERE (verification_token::text = p_token OR oath_id::text = p_token)
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT * INTO v_oath FROM public.oaths WHERE id::text = p_token FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Invalid verification token');
    END IF;
  ELSE
    IF v_nominee.verified THEN
      RETURN jsonb_build_object('success', false, 'error', 'This oath has already been reviewed');
    END IF;
    SELECT * INTO v_oath FROM public.oaths WHERE id = v_nominee.oath_id FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oath not found for verification token';
  END IF;

  IF v_oath.status != 'active' THEN
    RAISE EXCEPTION 'Oath is no longer active (current status: %)', v_oath.status;
  END IF;

  v_stake := COALESCE(v_oath.stake_amount, 0);
  v_cadence := COALESCE(v_oath.cadence, 'daily');
  v_total_days := GREATEST(1, COALESCE(v_oath.total_days, 1));
  IF v_cadence = 'daily' AND v_total_days <= 1 AND v_oath.deadline > v_oath.created_at + interval '24 hours' THEN
    v_total_days := GREATEST(2, CEIL(EXTRACT(EPOCH FROM (v_oath.deadline - v_oath.created_at)) / 86400.0)::INT);
  END IF;
  v_current_day := COALESCE(v_oath.current_day, 1);
  v_is_final_day := CASE WHEN v_cadence = 'daily' THEN (v_current_day >= v_total_days) ELSE TRUE END;

  SELECT * INTO v_proof
  FROM public.proofs
  WHERE oath_id = v_oath.id AND status = 'pending_review'
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT p_approved THEN
    IF v_proof.id IS NOT NULL THEN
      UPDATE public.proofs
      SET status = 'rejected',
          review_note = COALESCE(p_note, 'Rejected by nominee referee'),
          reviewed_at = now()
      WHERE id = v_proof.id;
    END IF;

    IF v_nominee.id IS NOT NULL THEN
      UPDATE public.nominees
      SET verified = TRUE,
          verdict = 'rejected',
          verdict_note = COALESCE(p_note, 'Rejected by nominee referee'),
          responded_at = now()
      WHERE id = v_nominee.id;
    END IF;

    IF v_cadence = 'daily' THEN
      INSERT INTO public.notifications (user_id, type, title, message, oath_id)
      VALUES (
        v_oath.creator_id,
        'proof_rejected',
        'Referee Rejected Today''s Proof',
        format('Your referee rejected today''s proof on "%s": %s. Submit valid proof before midnight!', left(v_oath.oath_statement, 40), COALESCE(p_note, 'Rejected')),
        v_oath.id
      );
      RETURN jsonb_build_object('success', true, 'status', 'active', 'verdict', 'rejected', 'mode', 'daily_rejected_keep_active');
    END IF;

    UPDATE public.oaths
    SET status = 'failed',
        failed_at = now(),
        settled_at = now(),
        failure_excuse = COALESCE(p_note, 'Rejected by nominee referee'),
        updated_at = now()
    WHERE id = v_oath.id;

    IF v_stake > 0 THEN
      SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_oath.creator_id FOR UPDATE;
      UPDATE public.wallets
      SET escrow_locked = GREATEST(0, escrow_locked - v_stake),
          total_lost = COALESCE(total_lost, 0) + v_stake,
          updated_at = now()
      WHERE id = v_wallet_id;

      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_wallet_id, v_oath.id, 'penalty', v_stake, 'Oath failed — rejected by nominee referee');
    END IF;

    PERFORM public.handle_profile_failure(v_oath.creator_id, v_stake, v_oath.id);

    INSERT INTO public.notifications (user_id, type, title, message, oath_id)
    VALUES (
      v_oath.creator_id,
      'oath_settled',
      'Oath Failed — Referee Verdict',
      format('Your nominee referee failed your oath "%s". Note: %s', left(v_oath.oath_statement, 40), COALESCE(p_note, 'Failed')),
      v_oath.id
    );

    RETURN jsonb_build_object('success', true, 'status', 'failed', 'verdict', 'failed', 'mode', 'failed');
  END IF;

  IF v_proof.id IS NOT NULL THEN
    UPDATE public.proofs
    SET status = 'verified',
        review_note = COALESCE(p_note, 'Verified by nominee referee'),
        reviewed_at = now()
    WHERE id = v_proof.id;
  END IF;

  IF NOT v_is_final_day THEN
    v_next_day := v_current_day + 1;
    UPDATE public.oaths
    SET current_day = v_next_day,
        total_days = v_total_days,
        daily_deadline = public.next_user_local_midnight(COALESCE(v_oath.creator_timezone, 'UTC'), now()),
        updated_at = now()
    WHERE id = v_oath.id;

    IF v_nominee.id IS NOT NULL THEN
      UPDATE public.nominees
      SET verified = FALSE,
          verdict = 'approved_day_' || v_current_day,
          verdict_note = p_note,
          responded_at = now()
      WHERE id = v_nominee.id;
    END IF;

    INSERT INTO public.notifications (user_id, type, title, message, oath_id)
    VALUES (
      v_oath.creator_id,
      'proof_verified',
      format('Day %s/%s Verified!', v_current_day, v_total_days),
      format('Your referee passed Day %s/%s for "%s". Next deadline is tomorrow midnight.', v_current_day, v_total_days, left(v_oath.oath_statement, 40)),
      v_oath.id
    );

    RETURN jsonb_build_object('success', true, 'status', 'active', 'verdict', 'completed_day', 'mode', 'daily_pass', 'current_day', v_next_day, 'total_days', v_total_days);
  END IF;

  IF v_nominee.id IS NOT NULL THEN
    UPDATE public.nominees
    SET verified = TRUE,
        verdict = 'completed',
        verdict_note = COALESCE(p_note, 'Completed — verified by nominee'),
        responded_at = now()
    WHERE id = v_nominee.id;
  END IF;

  UPDATE public.oaths
  SET status = 'completed',
      completed_at = now(),
      settled_at = now(),
      updated_at = now()
  WHERE id = v_oath.id;

  IF v_stake > 0 THEN
    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_oath.creator_id FOR UPDATE;
    UPDATE public.wallets
    SET escrow_locked = GREATEST(0, escrow_locked - v_stake),
        balance = balance + v_stake,
        updated_at = now()
    WHERE id = v_wallet_id;

    INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
    VALUES (v_wallet_id, v_oath.id, 'escrow_release', v_stake, 'Oath completed — verified by nominee referee');
  END IF;

  PERFORM public.handle_profile_completion(v_oath.creator_id);

  INSERT INTO public.wall_entries (oath_id, user_id, wall_type, oath_statement, stake_amount, username)
  SELECT v_oath.id, v_oath.creator_id, 'honor', v_oath.oath_statement, v_stake, username
  FROM public.profiles WHERE id = v_oath.creator_id;

  INSERT INTO public.notifications (user_id, type, title, message, oath_id)
  VALUES (
    v_oath.creator_id,
    'oath_settled',
    'Oath Completed!',
    format('Your nominee referee verified your completion of "%s"!', left(v_oath.oath_statement, 40)),
    v_oath.id
  );

  RETURN jsonb_build_object('success', true, 'status', 'completed', 'verdict', 'completed', 'mode', 'completed');
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_nominee(TEXT, BOOLEAN, TEXT) TO anon, authenticated;

-- 9. Harden forfeit_oath, forfeit_squad_member, submit_oath_proof, and reject_proof so that:
--    - When a challenger forfeits a Solo oath, pending referee notifications and pending proofs are auto-cleaned up and the referee is notified that the oath ended by forfeiture.
--    - When a member forfeits a Weakest Link Duo or Squad oath, the entire challenge terminates cleanly as failed, releasing any innocent surviving partners' escrow back to their balance.
--    - In Survival Duo/Squad/Lobby, if all other peers have forfeited/failed and only 1 active member remains, their daily proof auto-verifies instead of getting stuck with no surviving reviewer.
--    - Rejecting a peer's proof on a single-deadline Duo oath penalizes the submitter (not the reviewer).

CREATE OR REPLACE FUNCTION public.forfeit_oath(p_oath_id UUID, p_note TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_oath public.oaths%ROWTYPE;
  v_user UUID := auth.uid();
  v_stake NUMERIC;
  v_wallet_id UUID;
  v_other_id UUID;
  v_other_member public.group_members%ROWTYPE;
  v_nominee RECORD;
  v_creator_username TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;

  SELECT username INTO v_creator_username FROM public.profiles WHERE id = v_user;

  IF v_oath.oath_type = 'solo' THEN
    IF v_oath.creator_id <> v_user THEN RAISE EXCEPTION 'Only the oath creator can forfeit'; END IF;
    PERFORM public.settle_oath_atomically(p_oath_id, FALSE, coalesce(p_note, 'Oath forfeited by creator'), NULL, TRUE);

    -- Mark nominee record resolved so external /verify link does not stay dangling
    UPDATE public.nominees
    SET verified = TRUE,
        verdict = 'forfeited',
        verdict_note = coalesce(p_note, 'Oath forfeited by creator'),
        responded_at = now()
    WHERE oath_id = p_oath_id;

    -- Dismiss any pending verify_proof or invite_nominee notifications for the referee
    UPDATE public.notifications
    SET status = 'read', updated_at = now()
    WHERE oath_id = p_oath_id AND status = 'pending';

    -- Notify registered referee that the challenger forfeited so they know the challenge is over
    FOR v_nominee IN SELECT nominee_user_id FROM public.nominees WHERE oath_id = p_oath_id AND nominee_user_id IS NOT NULL LOOP
      IF v_nominee.nominee_user_id <> v_user THEN
        INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
        VALUES (
          v_nominee.nominee_user_id,
          p_oath_id,
          'oath_settled',
          'Challenge Over — Challenger Forfeited',
          format('@%s forfeited "%s". No further referee verification is required.', coalesce(v_creator_username, 'challenger'), left(v_oath.oath_statement, 40)),
          'pending'
        );
      END IF;
    END LOOP;

  ELSIF v_oath.oath_type = 'duo' THEN
    IF v_user <> v_oath.creator_id AND v_user <> v_oath.opponent_id THEN
      RAISE EXCEPTION 'Only challenge participants can forfeit';
    END IF;

    v_stake := coalesce(v_oath.stake_amount, 0);
    v_other_id := CASE WHEN v_user = v_oath.creator_id THEN v_oath.opponent_id ELSE v_oath.creator_id END;

    -- Reject any pending proofs from the forfeiting user and dismiss pending review notifications for them
    UPDATE public.proofs
    SET status = 'rejected'::public.proof_status,
        review_note = 'Participant forfeited oath',
        reviewed_at = now()
    WHERE oath_id = p_oath_id AND submitted_by = v_user AND status IN ('pending_review', 'needs_more_proof');

    UPDATE public.notifications
    SET status = 'read', updated_at = now()
    WHERE oath_id = p_oath_id AND type = 'verify_proof' AND status = 'pending'
      AND (actor_id = v_user OR user_id = v_user);

    -- Forfeit caller's own stake
    IF v_stake > 0 THEN
      UPDATE public.wallets
      SET escrow_locked = greatest(0, escrow_locked - v_stake),
          total_lost = coalesce(total_lost, 0) + v_stake,
          updated_at = now()
      WHERE user_id = v_user
      RETURNING id INTO v_wallet_id;

      IF v_wallet_id IS NOT NULL THEN
        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_wallet_id, p_oath_id, 'penalty', v_stake, coalesce(p_note, 'Duo challenge forfeited'));
      END IF;
    END IF;

    UPDATE public.group_members
    SET status = 'failed', proof_submitted = FALSE, updated_at = now()
    WHERE oath_id = p_oath_id AND user_id = v_user;

    PERFORM public.handle_profile_failure(v_user, v_stake, p_oath_id);

    IF v_other_id IS NOT NULL THEN
      SELECT * INTO v_other_member FROM public.group_members WHERE oath_id = p_oath_id AND user_id = v_other_id FOR UPDATE;

      -- If Weakest Link mode, one partner forfeiting terminates the challenge immediately and refunds the innocent partner's locked stake
      IF coalesce(v_oath.group_mode, 'survival') = 'weakest_link' THEN
        IF v_other_member.status = 'joined' THEN
          IF v_stake > 0 THEN
            UPDATE public.wallets
            SET balance = balance + v_stake,
                escrow_locked = greatest(0, escrow_locked - v_stake),
                updated_at = now()
            WHERE user_id = v_other_id
            RETURNING id INTO v_wallet_id;

            IF v_wallet_id IS NOT NULL THEN
              INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
              VALUES (v_wallet_id, p_oath_id, 'escrow_release', v_stake, 'Partner forfeited Weakest Link duo — your stake was refunded');
            END IF;
          END IF;
          UPDATE public.group_members SET status = 'completed', updated_at = now() WHERE id = v_other_member.id;
        END IF;

        UPDATE public.oaths
        SET status = 'failed',
            failed_at = now(),
            settled_at = now(),
            failure_excuse = coalesce(p_note, 'Partner forfeited Weakest Link duo'),
            updated_at = now()
        WHERE id = p_oath_id;

        INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
        VALUES (
          v_other_id,
          p_oath_id,
          'oath_settled',
          'Challenge Over — Partner Forfeited',
          format('@%s forfeited "%s". The challenge has ended and your locked stake was returned.', coalesce(v_creator_username, 'partner'), left(v_oath.oath_statement, 40)),
          'pending'
        );
      ELSE
        -- Survival mode: partner continues solo or oath concludes if partner already finished
        IF v_other_member.status IN ('completed', 'failed') THEN
          UPDATE public.oaths
          SET status = CASE WHEN v_other_member.status = 'completed' THEN 'completed'::public.oath_status ELSE 'failed'::public.oath_status END,
              settled_at = now(),
              updated_at = now()
          WHERE id = p_oath_id;
        ELSE
          INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
          VALUES (
            v_other_id,
            p_oath_id,
            'system',
            'Partner Forfeited',
            format('@%s conceded "%s". Your Survival oath remains active — your future proofs will auto-verify!', coalesce(v_creator_username, 'partner'), left(v_oath.oath_statement, 40)),
            'pending'
          );
        END IF;
      END IF;
    ELSE
      UPDATE public.oaths SET status = 'failed', failed_at = now(), settled_at = now(), updated_at = now() WHERE id = p_oath_id;
    END IF;

  ELSIF v_oath.oath_type IN ('squad', 'lobby') THEN
    PERFORM public.forfeit_squad_member(p_oath_id);
  ELSE
    RAISE EXCEPTION 'Unsupported oath type for forfeiture';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.forfeit_oath(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.forfeit_squad_member(
  p_oath_id UUID,
  p_member_id UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_oath public.oaths%ROWTYPE;
  v_member public.group_members%ROWTYPE;
  v_other RECORD;
  v_wallet_id UUID;
  v_stake NUMERIC;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;

  IF p_member_id IS NOT NULL THEN
    SELECT * INTO v_member FROM public.group_members WHERE id = p_member_id AND oath_id = p_oath_id FOR UPDATE;
  ELSE
    SELECT * INTO v_member FROM public.group_members WHERE oath_id = p_oath_id AND user_id = v_user FOR UPDATE;
  END IF;

  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found in squad/lobby'; END IF;
  IF v_member.user_id <> v_user AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to forfeit for this member';
  END IF;

  v_stake := coalesce(v_member.stake_amount, v_oath.stake_amount, 0);

  -- Reject any pending proofs by this member and dismiss pending review notifications
  UPDATE public.proofs
  SET status = 'rejected'::public.proof_status,
      review_note = 'Member forfeited squad/lobby',
      reviewed_at = now()
  WHERE oath_id = p_oath_id AND submitted_by = v_member.user_id AND status IN ('pending_review', 'needs_more_proof');

  UPDATE public.notifications
  SET status = 'read', updated_at = now()
  WHERE oath_id = p_oath_id AND type = 'verify_proof' AND status = 'pending'
    AND (actor_id = v_member.user_id OR user_id = v_member.user_id);

  UPDATE public.group_members
  SET status = 'failed', proof_submitted = FALSE, updated_at = now()
  WHERE id = v_member.id;

  IF v_stake > 0 THEN
    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_member.user_id FOR UPDATE;
    IF v_wallet_id IS NOT NULL THEN
      UPDATE public.wallets
      SET escrow_locked = greatest(0, escrow_locked - v_stake),
          total_lost = coalesce(total_lost, 0) + v_stake,
          updated_at = now()
      WHERE id = v_wallet_id;

      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_wallet_id, p_oath_id, 'penalty', v_stake, 'Member forfeited lobby/squad');
    END IF;
  END IF;

  PERFORM public.handle_profile_failure(v_member.user_id, v_stake, p_oath_id);

  -- If Weakest Link mode, entire squad fails when one member forfeits
  IF coalesce(v_oath.group_mode, 'survival') = 'weakest_link' THEN
    FOR v_other IN
      SELECT * FROM public.group_members
      WHERE oath_id = p_oath_id AND id <> v_member.id AND status = 'joined'
      FOR UPDATE
    LOOP
      UPDATE public.group_members SET status = 'failed', is_winner = FALSE, updated_at = now() WHERE id = v_other.id;
      IF coalesce(v_other.stake_amount, v_oath.stake_amount, 0) > 0 THEN
        SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_other.user_id FOR UPDATE;
        IF v_wallet_id IS NOT NULL THEN
          UPDATE public.wallets
          SET escrow_locked = greatest(0, escrow_locked - coalesce(v_other.stake_amount, v_oath.stake_amount, 0)),
              total_lost = coalesce(total_lost, 0) + coalesce(v_other.stake_amount, v_oath.stake_amount, 0),
              updated_at = now()
          WHERE id = v_wallet_id;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_wallet_id, p_oath_id, 'penalty', coalesce(v_other.stake_amount, v_oath.stake_amount, 0), 'Weakest Link broken by teammate forfeiture');
        END IF;
      END IF;
      PERFORM public.handle_profile_failure(v_other.user_id, coalesce(v_other.stake_amount, v_oath.stake_amount, 0), p_oath_id);
    END LOOP;

    UPDATE public.oaths
    SET status = 'failed', failed_at = now(), settled_at = now(), failure_excuse = 'Weakest Link broken by member forfeiture', updated_at = now()
    WHERE id = p_oath_id;
  ELSE
    -- Survival mode: if no active joined members remain, close the oath
    IF NOT EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = p_oath_id AND status = 'joined') THEN
      UPDATE public.oaths
      SET status = CASE
            WHEN EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = p_oath_id AND status = 'completed') THEN 'completed'::public.oath_status
            ELSE 'failed'::public.oath_status
          END,
          settled_at = now(),
          updated_at = now()
      WHERE id = p_oath_id;
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.forfeit_squad_member(UUID, UUID) TO authenticated;

-- Fix reject_proof on single-deadline Duo oaths so it penalizes the submitter (not the reviewer)
CREATE OR REPLACE FUNCTION public.reject_proof(
  p_oath_id UUID,
  p_proof_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_fail_oath BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_oath public.oaths%ROWTYPE;
  v_proof public.proofs%ROWTYPE;
  v_clean_reason TEXT;
  v_reviewer_name TEXT;
  v_stake NUMERIC;
  v_wallet_id UUID;
  v_other_id UUID;
  v_other_member public.group_members%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;

  IF NOT (
    v_user = v_oath.creator_id
    OR v_user = coalesce(v_oath.opponent_id, '00000000-0000-0000-0000-000000000000'::uuid)
    OR EXISTS (
      SELECT 1 FROM public.nominees n
      LEFT JOIN public.profiles p ON p.id = v_user
      WHERE n.oath_id = p_oath_id
        AND (
          n.nominee_user_id = v_user
          OR n.email = (SELECT email FROM auth.users WHERE id = v_user)
          OR lower(trim(leading '@' from n.email)) = lower(p.username)
          OR n.email = p.username
          OR n.email = '@' || p.username
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.oath_id = p_oath_id AND gm.user_id = v_user
    )
    OR public.is_admin()
  ) THEN
    RAISE EXCEPTION 'You are not authorized to review proofs for this oath';
  END IF;

  IF p_proof_id IS NOT NULL THEN
    SELECT * INTO v_proof FROM public.proofs WHERE id = p_proof_id AND oath_id = p_oath_id FOR UPDATE;
  ELSE
    SELECT * INTO v_proof FROM public.proofs WHERE oath_id = p_oath_id AND status IN ('pending_review', 'needs_more_proof') ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending proof found to reject';
  END IF;

  v_clean_reason := coalesce(nullif(trim(p_reason), ''), 'Proof was rejected by reviewer');

  UPDATE public.proofs
  SET status = 'rejected'::public.proof_status,
      reviewer_id = v_user,
      review_note = v_clean_reason,
      reviewed_at = now()
  WHERE id = v_proof.id;

  UPDATE public.nominees
  SET verified = TRUE,
      verdict = 'penalty',
      verdict_note = v_clean_reason,
      responded_at = now()
  WHERE oath_id = p_oath_id;

  UPDATE public.notifications
  SET status = 'accepted', updated_at = now()
  WHERE user_id = v_user AND oath_id = p_oath_id AND type = 'verify_proof' AND status = 'pending';

  UPDATE public.group_members
  SET proof_submitted = FALSE
  WHERE oath_id = p_oath_id AND user_id = v_proof.submitted_by;

  SELECT username INTO v_reviewer_name FROM public.profiles WHERE id = v_user;

  INSERT INTO public.notifications (user_id, oath_id, proof_id, type, title, message, status)
  VALUES (
    v_proof.submitted_by,
    p_oath_id,
    v_proof.id,
    'proof_rejected',
    'Proof Rejected',
    coalesce('@' || v_reviewer_name, 'Reviewer') || ' rejected your proof: "' || left(v_clean_reason, 120) || '".',
    'pending'
  );

  IF coalesce(v_oath.cadence, 'daily') <> 'daily' OR p_fail_oath THEN
    IF v_oath.oath_type = 'duo' THEN
      v_stake := coalesce(v_oath.stake_amount, 0);
      IF v_stake > 0 THEN
        UPDATE public.wallets
        SET escrow_locked = greatest(0, escrow_locked - v_stake),
            total_lost = coalesce(total_lost, 0) + v_stake,
            updated_at = now()
        WHERE user_id = v_proof.submitted_by
        RETURNING id INTO v_wallet_id;

        IF v_wallet_id IS NOT NULL THEN
          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_wallet_id, p_oath_id, 'penalty', v_stake, 'Duo proof rejected — stake forfeited');
        END IF;
      END IF;
      UPDATE public.group_members SET status = 'failed', updated_at = now() WHERE oath_id = p_oath_id AND user_id = v_proof.submitted_by;
      PERFORM public.handle_profile_failure(v_proof.submitted_by, v_stake, p_oath_id);

      v_other_id := CASE WHEN v_proof.submitted_by = v_oath.creator_id THEN v_oath.opponent_id ELSE v_oath.creator_id END;
      IF v_other_id IS NOT NULL THEN
        SELECT * INTO v_other_member FROM public.group_members WHERE oath_id = p_oath_id AND user_id = v_other_id;
        IF v_other_member.status IN ('completed', 'failed') THEN
          UPDATE public.oaths
          SET status = CASE WHEN v_other_member.status = 'completed' THEN 'completed'::public.oath_status ELSE 'failed'::public.oath_status END,
              settled_at = now(),
              updated_at = now()
          WHERE id = p_oath_id;
        END IF;
      END IF;
    ELSE
      PERFORM public.settle_oath(p_oath_id, 'failed');
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'proof_id', v_proof.id, 'status', 'rejected');
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_proof(UUID, UUID, TEXT, BOOLEAN) TO authenticated, anon;

-- Fix pass_today_work to prevent self-verification unless the user is the sole surviving participant in a group oath
CREATE OR REPLACE FUNCTION public.pass_today_work(
  p_oath_id UUID,
  p_note TEXT DEFAULT NULL,
  p_proof_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_oath public.oaths%ROWTYPE;
  v_proof public.proofs%ROWTYPE;
  v_is_final_day BOOLEAN := FALSE;
  v_clean_note TEXT;
  v_member public.group_members%ROWTYPE;
  v_reviewer_name TEXT;
  v_new_streak INT := 1;
  v_user_tz TEXT;
  v_next_midnight TIMESTAMPTZ;
  v_is_sole_survivor BOOLEAN := FALSE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;
  IF v_oath.status <> 'active' THEN RAISE EXCEPTION 'Oath is not active'; END IF;

  IF p_proof_id IS NOT NULL THEN
    SELECT * INTO v_proof FROM public.proofs WHERE id = p_proof_id AND oath_id = p_oath_id FOR UPDATE;
  ELSE
    SELECT * INTO v_proof FROM public.proofs WHERE oath_id = p_oath_id AND status IN ('pending_review', 'needs_more_proof') ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending proof found to approve';
  END IF;

  IF v_oath.oath_type IN ('duo', 'squad', 'lobby') THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM public.group_members
      WHERE oath_id = p_oath_id AND user_id <> v_proof.submitted_by AND status = 'joined'
    ) INTO v_is_sole_survivor;
  END IF;

  IF v_proof.submitted_by = v_user AND NOT public.is_admin() AND NOT v_is_sole_survivor AND v_oath.verification_method <> 'solo_lonely' THEN
    RAISE EXCEPTION 'You cannot verify your own proof submission';
  END IF;

  IF NOT (
    v_user = v_oath.creator_id
    OR v_user = coalesce(v_oath.opponent_id, '00000000-0000-0000-0000-000000000000'::uuid)
    OR EXISTS (
      SELECT 1 FROM public.nominees n
      LEFT JOIN public.profiles p ON p.id = v_user
      WHERE n.oath_id = p_oath_id
        AND (
          n.nominee_user_id = v_user
          OR n.email = (SELECT email FROM auth.users WHERE id = v_user)
          OR lower(trim(leading '@' from n.email)) = lower(p.username)
          OR n.email = p.username
          OR n.email = '@' || p.username
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.oath_id = p_oath_id AND gm.user_id = v_user
    )
    OR public.is_admin()
  ) THEN
    RAISE EXCEPTION 'You are not authorized to review proofs for this oath';
  END IF;

  v_clean_note := coalesce(nullif(trim(p_note), ''), 'Today''s work verified by referee');

  UPDATE public.proofs
  SET status = 'verified'::public.proof_status,
      reviewer_id = v_user,
      review_note = v_clean_note,
      reviewed_at = now()
  WHERE id = v_proof.id;

  UPDATE public.notifications
  SET status = 'accepted', updated_at = now()
  WHERE user_id = v_user AND oath_id = p_oath_id AND type = 'verify_proof' AND status = 'pending';

  UPDATE public.nominees
  SET verified = TRUE,
      verdict = 'success',
      verdict_note = v_clean_note,
      responded_at = now()
  WHERE oath_id = p_oath_id;

  IF coalesce(v_oath.cadence, 'daily') = 'daily' THEN
    IF v_oath.total_days <= 1 AND v_oath.deadline > (now() + interval '24 hours') THEN
      v_oath.total_days := greatest(2, ceil(extract(epoch from (v_oath.deadline - v_oath.created_at)) / 86400.0)::int);
      UPDATE public.oaths SET total_days = v_oath.total_days WHERE id = p_oath_id;
    END IF;

    SELECT * INTO v_member FROM public.group_members WHERE oath_id = p_oath_id AND user_id = v_proof.submitted_by FOR UPDATE;
    IF FOUND THEN
      v_user_tz := coalesce(v_member.timezone, v_oath.timezone, 'UTC');
      v_next_midnight := public.calculate_next_local_midnight(v_user_tz, 1);

      IF v_member.last_verified_at IS NULL OR date_trunc('day', v_member.last_verified_at AT TIME ZONE v_user_tz) <> date_trunc('day', now() AT TIME ZONE v_user_tz) THEN
        UPDATE public.group_members
        SET last_verified_day = current_day,
            day_streak = coalesce(day_streak, 0) + 1,
            current_day = coalesce(current_day, 1) + 1,
            last_verified_at = now(),
            proof_submitted = TRUE,
            daily_deadline = v_next_midnight,
            updated_at = now()
        WHERE id = v_member.id
        RETURNING day_streak INTO v_new_streak;
      ELSE
        v_new_streak := coalesce(v_member.day_streak, 1);
        UPDATE public.group_members SET daily_deadline = v_next_midnight, updated_at = now() WHERE id = v_member.id;
      END IF;

      IF coalesce(v_member.current_day, 1) >= v_oath.total_days THEN
        v_is_final_day := TRUE;
      END IF;
    END IF;

    v_user_tz := coalesce(v_oath.timezone, 'UTC');
    v_next_midnight := public.calculate_next_local_midnight(v_user_tz, 1);

    IF v_oath.last_verified_at IS NULL OR date_trunc('day', v_oath.last_verified_at AT TIME ZONE v_user_tz) <> date_trunc('day', now() AT TIME ZONE v_user_tz) THEN
      UPDATE public.oaths
      SET current_day = current_day + 1,
          current_streak = current_streak + 1,
          last_verified_at = now(),
          daily_deadline = v_next_midnight,
          updated_at = now()
      WHERE id = p_oath_id
      RETURNING current_streak INTO v_new_streak;
    ELSE
      UPDATE public.oaths SET daily_deadline = v_next_midnight, updated_at = now() WHERE id = p_oath_id;
    END IF;

    IF v_oath.current_day >= v_oath.total_days THEN
      v_is_final_day := TRUE;
    END IF;
  ELSE
    v_is_final_day := TRUE;
  END IF;

  SELECT username INTO v_reviewer_name FROM public.profiles WHERE id = v_user;

  INSERT INTO public.notifications (user_id, oath_id, proof_id, type, title, message, status)
  VALUES (
    v_proof.submitted_by,
    p_oath_id,
    v_proof.id,
    'system',
    'Day Proof Verified!',
    CASE WHEN v_is_sole_survivor
      THEN 'Proof auto-verified (sole surviving participant)! Streak is now ' || v_new_streak || '.'
      ELSE coalesce('@' || v_reviewer_name, 'Referee') || ' verified your proof! Streak is now ' || v_new_streak || '. Take a break until midnight.'
    END,
    'pending'
  );

  IF v_is_final_day THEN
    IF v_oath.oath_type = 'duo' THEN
      PERFORM public.settle_duo_oath(p_oath_id, v_proof.submitted_by);
    ELSE
      PERFORM public.settle_oath(p_oath_id, 'completed');
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'proof_id', v_proof.id, 'streak', v_new_streak);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pass_today_work(UUID, TEXT, UUID) TO authenticated, anon;

-- Fix submit_oath_proof so that if all other peers in a Survival Duo/Squad/Lobby have forfeited/failed,
-- the surviving participant's proof auto-verifies instead of sending review prompts to forfeited users.
CREATE OR REPLACE FUNCTION public.submit_oath_proof(
  p_oath_id UUID,
  p_proof_type TEXT,
  p_proof_url TEXT DEFAULT NULL,
  p_proof_text TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_id UUID;
  v_oath RECORD;
  v_gm RECORD;
  v_peer UUID;
  v_nominee RECORD;
  v_storage_path TEXT;
  v_user_name TEXT;
  v_active_peers INT := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;

  IF v_oath.status NOT IN ('active', 'pending') THEN
    RAISE EXCEPTION 'Cannot submit proof for oath with status %', v_oath.status;
  END IF;

  IF v_oath.deadline IS NOT NULL AND v_oath.deadline < now() THEN
    RAISE EXCEPTION 'Cannot submit proof after deadline';
  END IF;

  IF v_oath.oath_type IN ('squad', 'lobby', 'duo') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.group_members
      WHERE oath_id = p_oath_id AND user_id = v_user AND status = 'joined'
    ) THEN
      RAISE EXCEPTION 'Must be an active participant to submit proof';
    END IF;
  ELSE
    IF v_oath.creator_id <> v_user AND coalesce(v_oath.opponent_id, '00000000-0000-0000-0000-000000000000'::UUID) <> v_user THEN
      RAISE EXCEPTION 'You are not a participant in this oath';
    END IF;
  END IF;

  IF p_proof_type NOT IN ('photo','video','screenshot','link','text') THEN 
    RAISE EXCEPTION 'Unsupported proof type'; 
  END IF;

  IF p_proof_type IN ('photo','video','screenshot') THEN
    IF p_proof_url IS NULL OR trim(p_proof_url) = '' THEN
      RAISE EXCEPTION 'Uploaded proof file is required';
    END IF;

    v_storage_path := regexp_replace(p_proof_url, '^.*/storage/v1/object/(?:public|sign)/(?:oath-proofs|proofs)/', '');
    v_storage_path := regexp_replace(v_storage_path, '^.*/(?:oath-proofs|proofs)/', '');
    v_storage_path := split_part(v_storage_path, '?', 1);

    IF v_storage_path NOT LIKE p_oath_id::text || '/' || v_user::text || '/%' THEN
      RAISE EXCEPTION 'Uploaded proof must use your private oath storage path';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM storage.objects
      WHERE bucket_id = 'oath-proofs'
        AND name = v_storage_path
        AND owner_id = v_user::text
    ) AND NOT EXISTS (
      SELECT 1 FROM storage.objects
      WHERE bucket_id = 'oath-proofs'
        AND name = v_storage_path
    ) THEN
      RAISE EXCEPTION 'Proof object not found in private storage or ownership check failed';
    END IF;
  END IF;

  IF p_proof_type = 'link' AND (p_proof_url IS NULL OR p_proof_url !~ '^https?://[^[:space:]]+$') THEN 
    RAISE EXCEPTION 'Proof link must be a valid HTTP(S) URL'; 
  END IF;

  IF p_proof_type = 'text' AND (coalesce(length(trim(p_proof_text)), 0) < 10 OR length(p_proof_text) > 5000) THEN 
    RAISE EXCEPTION 'Proof text must be between 10 and 5000 characters'; 
  END IF;

  INSERT INTO public.proofs (
    oath_id, submitted_by, proof_type, proof_url, proof_text, status, review_deadline, day_number
  ) VALUES (
    p_oath_id, v_user, p_proof_type, p_proof_url, left(p_proof_text, 5000), 'pending_review'::public.proof_status, now() + interval '24 hours', coalesce(v_oath.current_day, 1)
  )
  RETURNING id INTO v_id;

  UPDATE public.group_members
  SET proof_submitted = true
  WHERE oath_id = p_oath_id AND user_id = v_user;

  SELECT coalesce(username, 'User') INTO v_user_name FROM public.profiles WHERE id = v_user;

  IF v_oath.verification_method = 'nominee' THEN
    SELECT * INTO v_nominee FROM public.nominees WHERE oath_id = p_oath_id LIMIT 1;

    IF v_nominee.nominee_user_id IS NOT NULL AND v_nominee.nominee_user_id <> v_user THEN
      INSERT INTO public.notifications (
        user_id, oath_id, proof_id, type, title, message, actor_id, status
      ) VALUES (
        v_nominee.nominee_user_id,
        p_oath_id,
        v_id,
        'verify_proof',
        'Proof Submitted for Verification',
        '@' || v_user_name || ' submitted proof for "' || left(v_oath.oath_statement, 50) || '". You have 24 hours to review.',
        v_user,
        'pending'
      );
    END IF;

    INSERT INTO public.notifications (
      user_id, oath_id, proof_id, type, title, message, actor_id, status
    ) VALUES (
      v_user,
      p_oath_id,
      v_id,
      'system',
      'Proof Submitted',
      'Day ' || coalesce(v_oath.current_day, 1) || ' proof submitted. Awaiting referee review.',
      v_user,
      'pending'
    );

  ELSIF v_oath.verification_method = 'peer' THEN
    SELECT count(*) INTO v_active_peers
    FROM public.group_members
    WHERE oath_id = p_oath_id AND user_id <> v_user AND status = 'joined';

    IF v_active_peers = 0 THEN
      PERFORM public.pass_today_work(p_oath_id, 'Auto-verified: partner forfeited Survival challenge', v_id);
      RETURN v_id;
    END IF;

    IF v_user = v_oath.creator_id THEN
      v_peer := v_oath.opponent_id;
    ELSE
      v_peer := v_oath.creator_id;
    END IF;

    IF v_peer IS NOT NULL AND v_peer <> v_user THEN
      INSERT INTO public.notifications (
        user_id, oath_id, proof_id, type, title, message, actor_id, status
      ) VALUES (
        v_peer,
        p_oath_id,
        v_id,
        'verify_proof',
        'Duel Proof Submitted',
        '@' || v_user_name || ' submitted duel proof. You have 24 hours to review.',
        v_user,
        'pending'
      );
    END IF;

    INSERT INTO public.notifications (
      user_id, oath_id, proof_id, type, title, message, actor_id, status
    ) VALUES (
      v_user,
      p_oath_id,
      v_id,
      'system',
      'Duel Proof Submitted',
      'Your duel proof has been submitted. Awaiting opponent review.',
      v_user,
      'pending'
    );

  ELSIF v_oath.verification_method = 'quorum' THEN
    SELECT count(*) INTO v_active_peers
    FROM public.group_members
    WHERE oath_id = p_oath_id AND user_id <> v_user AND status = 'joined';

    IF v_active_peers = 0 THEN
      PERFORM public.pass_today_work(p_oath_id, 'Auto-verified: sole surviving participant in group challenge', v_id);
      RETURN v_id;
    END IF;

    FOR v_gm IN 
      SELECT user_id FROM public.group_members 
      WHERE oath_id = p_oath_id AND user_id <> v_user AND status = 'joined'
    LOOP
      INSERT INTO public.notifications (
        user_id, oath_id, proof_id, type, title, message, actor_id, status
      ) VALUES (
        v_gm.user_id,
        p_oath_id,
        v_id,
        'verify_proof',
        'Squad Proof to Vote',
        '@' || v_user_name || ' submitted proof. Cast your vote within 24 hours.',
        v_user,
        'pending'
      );
    END LOOP;

    INSERT INTO public.notifications (
      user_id, oath_id, proof_id, type, title, message, actor_id, status
    ) VALUES (
      v_user,
      p_oath_id,
      v_id,
      'system',
      'Squad Proof Submitted',
      'Your squad proof has been submitted. Awaiting peer votes.',
      v_user,
      'pending'
    );

  ELSIF v_oath.verification_method = 'solo_lonely' THEN
    PERFORM public.pass_today_work(p_oath_id, 'Self-verified daily photo proof', v_id);
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_oath_proof(UUID, TEXT, TEXT, TEXT) TO authenticated, anon;

-- 10. These functions require auth.uid(), so anonymous execution only broadens attack surface.
REVOKE EXECUTE ON FUNCTION public.withdraw_funds(NUMERIC, VARCHAR) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_process_withdrawal(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_reject_withdrawal(UUID, TEXT) FROM anon;

-- 11. Allow authenticated users to delete their own notifications so referees/partners can remove ended/forfeited alerts.
DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;
CREATE POLICY "Users can delete own notifications"
  ON public.notifications FOR DELETE
  USING (auth.uid() = user_id);

COMMIT;
