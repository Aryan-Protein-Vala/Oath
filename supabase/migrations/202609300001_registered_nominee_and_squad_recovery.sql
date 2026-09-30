-- Registered nominee inbox and a private, two-step squad recovery flow.
-- Nominee credentials and recovery reflections stay behind authenticated RPCs.
BEGIN;

ALTER TABLE public.nominees
  ADD COLUMN IF NOT EXISTS nominee_user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS nominees_user_pending_idx
  ON public.nominees (nominee_user_id, created_at DESC) WHERE verified = false;

ALTER TABLE public.group_members
  ADD COLUMN IF NOT EXISTS recovery_acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recovered_at TIMESTAMPTZ;

-- Legacy squads used deadweight_tag with a positive stake. Reclassify those rows as the
-- explicit individual financial consequence without changing anyone's personal amount.
UPDATE public.oaths SET consequence_type = 'fiat'
WHERE oath_type = 'squad' AND consequence_type = 'deadweight_tag' AND stake_amount > 0;

CREATE TABLE IF NOT EXISTS public.squad_recoveries (
  group_member_id UUID PRIMARY KEY REFERENCES public.group_members(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reflection TEXT NOT NULL,
  next_checkin_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recovered_at TIMESTAMPTZ
);
ALTER TABLE public.squad_recoveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.squad_recoveries FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_oath_with_stake(
  p_oath_statement TEXT,
  p_deadline TIMESTAMPTZ,
  p_oath_type public.oath_type,
  p_verification_method public.verification_method,
  p_consequence_type public.consequence_type,
  p_stake_amount NUMERIC,
  p_social_ransom_phone TEXT DEFAULT NULL,
  p_social_ransom_message TEXT DEFAULT NULL,
  p_nominee_email TEXT DEFAULT NULL,
  p_min_players INTEGER DEFAULT 1,
  p_max_players INTEGER DEFAULT 1,
  p_opponent_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_user UUID := auth.uid();
  v_oath_id UUID;
  v_wallet_id UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF length(trim(p_oath_statement)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Oath statement must be 1–500 characters'; END IF;
  IF p_deadline IS NULL OR p_deadline <= now() THEN RAISE EXCEPTION 'Deadline must be in the future'; END IF;
  IF p_stake_amount IS NULL OR p_stake_amount < 0 OR round(p_stake_amount, 2) <> p_stake_amount THEN RAISE EXCEPTION 'Stake must be a non-negative amount with at most two decimals'; END IF;
  IF p_oath_type = 'duo' AND (p_stake_amount <= 0 OR p_consequence_type <> 'bounty_transfer' OR p_verification_method <> 'peer') THEN
    RAISE EXCEPTION 'Duo challenges require a positive stake and peer verification';
  END IF;
  IF p_oath_type = 'squad' AND (p_consequence_type NOT IN ('fiat','deadweight_tag') OR p_verification_method <> 'quorum') THEN
    RAISE EXCEPTION 'Squad challenges require quorum verification and an individual sandbox-loss or recovery consequence';
  END IF;
  IF p_oath_type = 'squad' AND p_consequence_type = 'fiat' AND p_stake_amount <= 0 THEN
    RAISE EXCEPTION 'Individual sandbox-loss squads require a positive virtual stake';
  END IF;
  IF p_oath_type = 'squad' AND p_consequence_type = 'deadweight_tag' AND p_stake_amount <> 0 THEN
    RAISE EXCEPTION 'Recovery-quest squads do not use a monetary stake';
  END IF;
  IF p_oath_type = 'squad' AND (coalesce(p_min_players,0) < 4 OR coalesce(p_max_players,0) < coalesce(p_min_players,0) OR p_max_players > 8) THEN
    RAISE EXCEPTION 'Squad size must be between 4 and 8 players, with minimum no greater than maximum';
  END IF;
  IF p_oath_type = 'solo' AND (p_verification_method <> 'solo_lonely' OR p_consequence_type NOT IN ('fiat','public_shame')) THEN
    RAISE EXCEPTION 'This solo consequence or verification method is not available';
  END IF;
  IF p_oath_type = 'solo' AND p_consequence_type = 'fiat' AND p_stake_amount <= 0 THEN
    RAISE EXCEPTION 'Financial oaths require a positive stake';
  END IF;
  IF p_oath_type = 'duo' AND p_opponent_id = v_user THEN RAISE EXCEPTION 'You cannot challenge yourself'; END IF;
  IF p_consequence_type = 'social_ransom' AND (NULLIF(trim(p_social_ransom_phone), '') IS NULL OR NULLIF(trim(p_social_ransom_message), '') IS NULL) THEN
    RAISE EXCEPTION 'Social consequence requires recipient and message';
  END IF;
  IF p_verification_method = 'nominee' THEN
    RAISE EXCEPTION 'Nominee delivery is not configured; choose another verification method';
  END IF;
  IF p_consequence_type = 'social_ransom' THEN
    RAISE EXCEPTION 'Automated message delivery is not configured';
  END IF;

  IF p_stake_amount > 0 THEN
    UPDATE public.wallets SET balance = balance - p_stake_amount,
      escrow_locked = escrow_locked + p_stake_amount, updated_at = now()
    WHERE user_id = v_user AND balance >= p_stake_amount
    RETURNING id INTO v_wallet_id;
    IF v_wallet_id IS NULL THEN RAISE EXCEPTION 'Insufficient available balance'; END IF;
  END IF;

  INSERT INTO public.oaths (creator_id, oath_statement, deadline, oath_type, verification_method,
    consequence_type, stake_amount, status, min_players, max_players, opponent_id)
  VALUES (v_user, trim(p_oath_statement), p_deadline, p_oath_type, p_verification_method,
    p_consequence_type, p_stake_amount, CASE WHEN p_oath_type = 'squad' THEN 'pending'::public.oath_status
      WHEN p_oath_type = 'duo' THEN 'pending'::public.oath_status ELSE 'active'::public.oath_status END,
    greatest(1, coalesce(p_min_players, 1)), greatest(1, coalesce(p_max_players, 1)), p_opponent_id)
  RETURNING id INTO v_oath_id;

  UPDATE public.profiles SET
    oaths_created = coalesce(oaths_created, 0) + 1,
    total_staked = coalesce(total_staked, 0) + p_stake_amount,
    updated_at = now()
  WHERE id = v_user;

  IF p_social_ransom_phone IS NOT NULL OR p_social_ransom_message IS NOT NULL OR p_nominee_email IS NOT NULL THEN
    INSERT INTO public.oath_private_details (oath_id, social_ransom_phone, social_ransom_message, nominee_email)
    VALUES (v_oath_id, p_social_ransom_phone, p_social_ransom_message, p_nominee_email);
  END IF;
  IF p_oath_type = 'squad' THEN
    INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed)
    VALUES (v_oath_id, v_user, p_stake_amount, 'joined', 3);
  END IF;
  IF v_wallet_id IS NOT NULL THEN
    INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
    VALUES (v_wallet_id, v_oath_id, 'escrow_lock', p_stake_amount, 'Stake locked for oath');
  END IF;
  RETURN v_oath_id;
END;
$$;


CREATE OR REPLACE FUNCTION public.create_oath_with_registered_nominee(
  p_oath_statement TEXT,
  p_deadline TIMESTAMPTZ,
  p_consequence_type public.consequence_type,
  p_stake_amount NUMERIC,
  p_nominee_user_id UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_user UUID := auth.uid();
  v_oath_id UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_nominee_user_id IS NULL OR p_nominee_user_id = v_user THEN RAISE EXCEPTION 'Choose another registered user as nominee'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_nominee_user_id) THEN RAISE EXCEPTION 'Registered nominee not found'; END IF;

  -- Use the already-hardened creator/escrow path, then bind the nominee to the oath.
  v_oath_id := public.create_oath_with_stake(
    p_oath_statement, p_deadline, 'solo', 'solo_lonely', p_consequence_type,
    p_stake_amount, NULL, NULL, NULL, 1, 1, NULL
  );
  UPDATE public.oaths SET verification_method = 'nominee' WHERE id = v_oath_id AND creator_id = v_user;
  INSERT INTO public.nominees (oath_id, nominee_user_id) VALUES (v_oath_id, p_nominee_user_id);
  RETURN v_oath_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_nominee_requests()
RETURNS TABLE (
  nominee_id UUID,
  oath_id UUID,
  oath_statement TEXT,
  deadline TIMESTAMPTZ,
  stake_amount NUMERIC,
  consequence_type public.consequence_type,
  creator_username TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET row_security = off AS $$
  SELECT n.id, o.id, o.oath_statement, o.deadline, o.stake_amount, o.consequence_type, p.username
  FROM public.nominees n
  JOIN public.oaths o ON o.id = n.oath_id
  JOIN public.profiles p ON p.id = o.creator_id
  WHERE n.nominee_user_id = auth.uid()
    AND n.verified = false
    AND o.status = 'active'
    AND o.verification_method = 'nominee'
  ORDER BY n.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.resolve_my_nominee_request(
  p_nominee_id UUID,
  p_success BOOLEAN,
  p_note TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_user UUID := auth.uid();
  v_oath_id UUID;
  v_token TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT n.oath_id, n.verification_token::text INTO v_oath_id, v_token
  FROM public.nominees n
  JOIN public.oaths o ON o.id = n.oath_id
  WHERE n.id = p_nominee_id AND n.nominee_user_id = v_user AND n.verified = false AND o.status = 'active'
  FOR UPDATE OF n;
  IF v_oath_id IS NULL THEN RAISE EXCEPTION 'Review request is unavailable or already resolved'; END IF;
  PERFORM public.settle_oath_atomically(v_oath_id, p_success, left(coalesce(p_note, ''), 500), v_token, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.acknowledge_squad_recovery(
  p_oath_id UUID,
  p_reflection TEXT
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_user UUID := auth.uid();
  v_member public.group_members%ROWTYPE;
  v_acknowledged_at TIMESTAMPTZ;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF length(trim(coalesce(p_reflection, ''))) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'Write a short reflection between 10 and 500 characters';
  END IF;
  SELECT * INTO v_member FROM public.group_members
    WHERE oath_id = p_oath_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND OR v_member.status <> 'failed' THEN RAISE EXCEPTION 'Only a failed squad member can start recovery'; END IF;
  IF v_member.recovered_at IS NOT NULL THEN RAISE EXCEPTION 'Recovery is already complete'; END IF;

  INSERT INTO public.squad_recoveries (group_member_id, user_id, reflection)
  VALUES (v_member.id, v_user, left(trim(p_reflection), 500))
  ON CONFLICT (group_member_id) DO UPDATE SET reflection = EXCLUDED.reflection;
  UPDATE public.group_members SET recovery_acknowledged_at = coalesce(recovery_acknowledged_at, now())
    WHERE id = v_member.id RETURNING recovery_acknowledged_at INTO v_acknowledged_at;
  RETURN v_acknowledged_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_squad_recovery(
  p_oath_id UUID,
  p_next_checkin_at TIMESTAMPTZ
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_user UUID := auth.uid();
  v_member public.group_members%ROWTYPE;
  v_recovered_at TIMESTAMPTZ;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_next_checkin_at IS NULL OR p_next_checkin_at <= now() OR p_next_checkin_at > now() + interval '90 days' THEN
    RAISE EXCEPTION 'Choose a check-in within the next 90 days';
  END IF;
  SELECT * INTO v_member FROM public.group_members
    WHERE oath_id = p_oath_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND OR v_member.status <> 'failed' THEN RAISE EXCEPTION 'Only a failed squad member can complete recovery'; END IF;
  IF v_member.recovery_acknowledged_at IS NULL THEN RAISE EXCEPTION 'Complete the reflection step first'; END IF;
  IF v_member.recovered_at IS NOT NULL THEN RAISE EXCEPTION 'Recovery is already complete'; END IF;
  UPDATE public.squad_recoveries SET next_checkin_at = p_next_checkin_at, recovered_at = now()
    WHERE group_member_id = v_member.id AND user_id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recovery reflection not found'; END IF;
  UPDATE public.group_members SET recovered_at = now() WHERE id = v_member.id RETURNING recovered_at INTO v_recovered_at;
  RETURN v_recovered_at;
END;
$$;

REVOKE ALL ON FUNCTION public.create_oath_with_registered_nominee(TEXT,TIMESTAMPTZ,public.consequence_type,NUMERIC,UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_nominee_requests() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_my_nominee_request(UUID,BOOLEAN,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.acknowledge_squad_recovery(UUID,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_squad_recovery(UUID,TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_oath_with_registered_nominee(TEXT,TIMESTAMPTZ,public.consequence_type,NUMERIC,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_nominee_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_my_nominee_request(UUID,BOOLEAN,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acknowledge_squad_recovery(UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_squad_recovery(UUID,TIMESTAMPTZ) TO authenticated;

COMMIT;
