-- OATH hardening migration (apply after the existing bootstrap schema).
-- All balance/escrow/status transitions are atomic server-side operations.

BEGIN;

ALTER TYPE public.consequence_type ADD VALUE IF NOT EXISTS 'shared_oath';

ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS total_won NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_lost NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.oath_private_details (
  oath_id UUID PRIMARY KEY REFERENCES public.oaths(id) ON DELETE CASCADE,
  social_ransom_phone TEXT,
  social_ransom_message TEXT,
  nominee_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


ALTER TABLE public.oaths
  DROP COLUMN IF EXISTS social_ransom_phone,
  DROP COLUMN IF EXISTS social_ransom_message,
  DROP COLUMN IF EXISTS nominee_email;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS phone;

-- Remove legacy status trigger: status and ledger are now changed in one RPC transaction.
DROP TRIGGER IF EXISTS on_oath_settled ON public.oaths;

-- Lock down direct table writes. RLS policies from the original schema are explicitly removed.
DROP POLICY IF EXISTS "Users can update own wallet" ON public.wallets;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "System can insert wallets" ON public.wallets;
DROP POLICY IF EXISTS "Users can insert own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Active oaths are viewable by participants" ON public.oaths;
DROP POLICY IF EXISTS "Users can create oaths" ON public.oaths;
DROP POLICY IF EXISTS "Creators and participants can update oaths" ON public.oaths;
DROP POLICY IF EXISTS "Nominees viewable by oath creator and via token" ON public.nominees;
DROP POLICY IF EXISTS "Oath creators can add nominees" ON public.nominees;
DROP POLICY IF EXISTS "Anyone can update nominee verdict via token" ON public.nominees;
DROP POLICY IF EXISTS "Group members are viewable by group participants" ON public.group_members;
DROP POLICY IF EXISTS "Users can join groups" ON public.group_members;
DROP POLICY IF EXISTS "Users can update own membership" ON public.group_members;
DROP POLICY IF EXISTS "Proofs viewable by oath participants" ON public.proofs;
DROP POLICY IF EXISTS "Users can submit proofs" ON public.proofs;
DROP POLICY IF EXISTS "Oath participants can update proof review" ON public.proofs;
DROP POLICY IF EXISTS "Votes viewable by squad members" ON public.votes;
DROP POLICY IF EXISTS "Squad members can vote" ON public.votes;
DROP POLICY IF EXISTS "Users can update own votes" ON public.votes;
DROP POLICY IF EXISTS "Users can insert wall entries" ON public.wall_entries;

CREATE POLICY "Wallet owner can read wallet" ON public.wallets
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Transaction owner can read ledger" ON public.transactions
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.wallets w WHERE w.id = wallet_id AND w.user_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.is_oath_member(p_oath_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET row_security = off AS $$
  SELECT EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.oath_id=p_oath_id AND gm.user_id=auth.uid())
      OR EXISTS (SELECT 1 FROM public.oaths o WHERE o.id=p_oath_id AND (o.creator_id=auth.uid() OR o.opponent_id=auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.is_oath_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_oath_member(UUID) TO authenticated;

CREATE POLICY "Participants and open squads can read safe oath rows" ON public.oaths
  FOR SELECT TO authenticated USING (
    creator_id = auth.uid()
    OR opponent_id = auth.uid()
    OR public.is_oath_member(oaths.id)
    OR (oath_type = 'squad' AND status IN ('pending', 'active'))
  );
DROP POLICY IF EXISTS "Pending duo invitations are readable" ON public.oaths;
CREATE POLICY "Pending duo invitations are readable" ON public.oaths
  FOR SELECT TO anon, authenticated USING (oath_type = 'duo' AND status = 'pending');

CREATE POLICY "Profiles are public identity only" ON public.profiles
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Group participants can read members" ON public.group_members
  FOR SELECT TO authenticated USING (
    public.is_oath_member(group_members.oath_id)
    OR EXISTS (SELECT 1 FROM public.oaths o WHERE o.id=group_members.oath_id AND o.oath_type='squad' AND o.status IN ('pending','active'))
  );
CREATE POLICY "Oath participants can read proofs" ON public.proofs
  FOR SELECT TO authenticated USING (submitted_by = auth.uid() OR public.is_oath_member(proofs.oath_id));
CREATE POLICY "Squad members can read votes" ON public.votes
  FOR SELECT TO authenticated USING (voter_id = auth.uid() OR public.is_oath_member(votes.oath_id));
CREATE POLICY "Public wall entries are readable" ON public.wall_entries
  FOR SELECT TO anon, authenticated USING (true);

-- No direct client access to nominee credentials or private details.
REVOKE ALL ON TABLE public.nominees, public.oath_private_details FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.wallets, public.transactions, public.oaths,
  public.group_members, public.proofs, public.votes, public.wall_entries FROM anon, authenticated;
GRANT SELECT ON public.wallets, public.transactions, public.oaths, public.group_members,
  public.proofs, public.votes, public.wall_entries, public.profiles TO anon, authenticated;


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
  IF p_oath_type = 'duo' AND (p_stake_amount <= 0 OR p_consequence_type <> 'shared_oath' OR p_verification_method <> 'peer') THEN
    RAISE EXCEPTION 'Duo challenges require a positive stake and peer verification';
  END IF;
  IF p_oath_type = 'squad' AND (p_stake_amount <= 0 OR p_consequence_type <> 'deadweight_tag' OR p_verification_method <> 'quorum') THEN
    RAISE EXCEPTION 'Squad challenges require a positive personal stake and quorum verification';
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

CREATE OR REPLACE FUNCTION public.accept_duo_challenge(p_oath_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_user UUID := auth.uid(); v_oath public.oaths%ROWTYPE; v_wallet_id UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND OR v_oath.oath_type <> 'duo' OR v_oath.status <> 'pending' THEN RAISE EXCEPTION 'Challenge is unavailable'; END IF;
  IF v_oath.creator_id = v_user OR (v_oath.opponent_id IS NOT NULL AND v_oath.opponent_id <> v_user) THEN RAISE EXCEPTION 'Challenge is not addressed to this account'; END IF;
  IF v_oath.deadline <= now() THEN RAISE EXCEPTION 'This challenge has expired'; END IF;
  UPDATE public.wallets SET balance = balance - v_oath.stake_amount,
    escrow_locked = escrow_locked + v_oath.stake_amount, updated_at = now()
  WHERE user_id = v_user AND balance >= v_oath.stake_amount RETURNING id INTO v_wallet_id;
  IF v_wallet_id IS NULL THEN RAISE EXCEPTION 'Insufficient available balance'; END IF;
  UPDATE public.oaths SET opponent_id = v_user, status = 'active', updated_at = now() WHERE id = p_oath_id;
  UPDATE public.profiles SET total_staked=coalesce(total_staked,0)+v_oath.stake_amount, updated_at=now() WHERE id=v_user;
  INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
  VALUES (v_wallet_id, p_oath_id, 'escrow_lock', v_oath.stake_amount, 'Duo challenge stake locked');
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_duo_challenge(p_oath_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_user UUID := auth.uid(); v_oath public.oaths%ROWTYPE; v_wallet UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_oath FROM public.oaths WHERE id=p_oath_id FOR UPDATE;
  IF NOT FOUND OR v_oath.oath_type <> 'duo' OR v_oath.status <> 'pending' THEN RAISE EXCEPTION 'Only a pending duo challenge can be cancelled'; END IF;
  IF v_oath.creator_id <> v_user THEN RAISE EXCEPTION 'Only the challenge creator can cancel it'; END IF;
  UPDATE public.wallets SET balance=balance+v_oath.stake_amount,
    escrow_locked=escrow_locked-v_oath.stake_amount,updated_at=now()
    WHERE user_id=v_user AND escrow_locked>=v_oath.stake_amount RETURNING id INTO v_wallet;
  IF v_wallet IS NULL THEN RAISE EXCEPTION 'Creator escrow is inconsistent'; END IF;
  UPDATE public.oaths SET status='cancelled',updated_at=now() WHERE id=p_oath_id;
  INSERT INTO public.transactions(wallet_id,oath_id,type,amount,description)
    VALUES(v_wallet,p_oath_id,'escrow_release',v_oath.stake_amount,'Duo invitation cancelled; stake returned');
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_oath_atomically(
  p_oath_id UUID, p_success BOOLEAN, p_note TEXT DEFAULT NULL, p_verification_token TEXT DEFAULT NULL, p_forfeit BOOLEAN DEFAULT FALSE
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_user UUID := auth.uid(); v_oath public.oaths%ROWTYPE; v_creator_wallet UUID; v_opponent_wallet UUID;
  v_creator_balance NUMERIC; v_creator_escrow NUMERIC; v_opponent_balance NUMERIC; v_opponent_escrow NUMERIC;
  v_cut NUMERIC := 0; v_payout NUMERIC := 0; v_winner UUID; v_next public.oath_status;
BEGIN
  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND OR v_oath.status <> 'active' THEN RAISE EXCEPTION 'Oath is not active or already settled'; END IF;

  IF p_verification_token IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.nominees n WHERE n.oath_id = p_oath_id
       AND n.verification_token::text = p_verification_token AND n.verified = false) THEN
      RAISE EXCEPTION 'Invalid or already used verification token';
    END IF;
  ELSIF p_forfeit THEN
    IF v_user IS NULL OR v_user <> v_oath.creator_id THEN RAISE EXCEPTION 'Only the oath creator can forfeit'; END IF;
  ELSIF v_oath.oath_type = 'duo' OR v_oath.verification_method = 'peer' THEN
    IF v_user IS NULL OR v_user <> v_oath.opponent_id THEN RAISE EXCEPTION 'Only the assigned verifier can settle this oath'; END IF;
  ELSIF v_oath.verification_method = 'nominee' THEN
    RAISE EXCEPTION 'A valid nominee token is required';
  ELSIF v_user IS NULL OR v_user <> v_oath.creator_id THEN
    RAISE EXCEPTION 'Only the oath creator can settle this solo oath';
  END IF;

  IF v_oath.oath_type = 'squad' THEN RAISE EXCEPTION 'Squad outcomes must be resolved by quorum voting'; END IF;
  IF NOT p_success AND NOT p_forfeit AND v_oath.deadline > now() THEN RAISE EXCEPTION 'A penalty can only be recorded after the deadline; use forfeit to fail early'; END IF;
  v_next := CASE WHEN p_success THEN 'completed'::public.oath_status ELSE 'failed'::public.oath_status END;
  SELECT id, balance, escrow_locked INTO v_creator_wallet, v_creator_balance, v_creator_escrow
    FROM public.wallets WHERE user_id = v_oath.creator_id FOR UPDATE;
  IF v_oath.stake_amount > 0 AND (v_creator_wallet IS NULL OR v_creator_escrow < v_oath.stake_amount) THEN RAISE EXCEPTION 'Creator escrow is inconsistent'; END IF;

  IF v_oath.oath_type = 'duo' THEN
    SELECT id, balance, escrow_locked INTO v_opponent_wallet, v_opponent_balance, v_opponent_escrow
      FROM public.wallets WHERE user_id = v_oath.opponent_id FOR UPDATE;
    IF v_opponent_wallet IS NULL OR v_opponent_escrow < v_oath.stake_amount THEN RAISE EXCEPTION 'Opponent escrow is inconsistent'; END IF;
    v_cut := round((v_oath.stake_amount * 2 * coalesce(v_oath.house_cut_percent, 10)) / 100, 2);
    v_payout := v_oath.stake_amount * 2 - v_cut;
    v_winner := CASE WHEN p_success THEN v_oath.creator_id ELSE v_oath.opponent_id END;
    UPDATE public.wallets SET escrow_locked = escrow_locked - v_oath.stake_amount,
      total_lost = total_lost + CASE WHEN (p_success AND user_id = v_oath.opponent_id) OR (NOT p_success AND user_id = v_oath.creator_id) THEN v_oath.stake_amount ELSE 0 END,
      total_won = total_won + CASE WHEN user_id = v_winner THEN v_payout - v_oath.stake_amount ELSE 0 END,
      balance = balance + CASE WHEN user_id = v_winner THEN v_payout ELSE 0 END,
      updated_at = now()
    WHERE user_id IN (v_oath.creator_id, v_oath.opponent_id);
    IF v_creator_wallet IS NOT NULL THEN
      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_creator_wallet, p_oath_id, CASE WHEN v_winner = v_oath.creator_id THEN 'escrow_release'::public.transaction_type ELSE 'penalty'::public.transaction_type END,
        CASE WHEN v_winner = v_oath.creator_id THEN v_payout ELSE v_oath.stake_amount END, CASE WHEN v_winner = v_oath.creator_id THEN 'Duo challenge won' ELSE 'Duo challenge lost' END);
    END IF;
    IF v_opponent_wallet IS NOT NULL THEN
      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_opponent_wallet, p_oath_id, CASE WHEN v_winner = v_oath.opponent_id THEN 'escrow_release'::public.transaction_type ELSE 'penalty'::public.transaction_type END,
        CASE WHEN v_winner = v_oath.opponent_id THEN v_payout ELSE v_oath.stake_amount END, CASE WHEN v_winner = v_oath.opponent_id THEN 'Duo challenge won' ELSE 'Duo challenge lost' END);
    END IF;
    IF v_cut > 0 THEN
      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description) VALUES (v_creator_wallet, p_oath_id, 'house_cut', v_cut, 'Duo challenge fee');
    END IF;
  ELSE
    UPDATE public.wallets SET escrow_locked = escrow_locked - v_oath.stake_amount,
      balance = balance + CASE WHEN p_success THEN v_oath.stake_amount ELSE 0 END,
      total_won = total_won + CASE WHEN p_success THEN v_oath.stake_amount ELSE 0 END,
      total_lost = total_lost + CASE WHEN p_success THEN 0 ELSE v_oath.stake_amount END,
      updated_at = now() WHERE user_id = v_oath.creator_id;
    IF v_oath.stake_amount > 0 THEN
      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_creator_wallet, p_oath_id, CASE WHEN p_success THEN 'escrow_release'::public.transaction_type ELSE 'penalty'::public.transaction_type END,
        v_oath.stake_amount, CASE WHEN p_success THEN 'Oath completed' ELSE 'Oath failed' END);
    END IF;
  END IF;

  UPDATE public.oaths SET status = v_next,
    completed_at = CASE WHEN p_success THEN now() ELSE completed_at END,
    failed_at = CASE WHEN p_success THEN failed_at ELSE now() END,
    failure_excuse = CASE WHEN p_success THEN NULL ELSE left(coalesce(p_note, 'Failed to complete oath.'), 500) END,
    updated_at = now() WHERE id = p_oath_id;

  IF v_oath.oath_type = 'duo' THEN
    UPDATE public.profiles SET
      oaths_completed = coalesce(oaths_completed,0) + CASE WHEN id = v_winner THEN 1 ELSE 0 END,
      oaths_failed = coalesce(oaths_failed,0) + CASE WHEN id <> v_winner THEN 1 ELSE 0 END,
      total_won = coalesce(total_won,0) + CASE WHEN id = v_winner THEN v_payout - v_oath.stake_amount ELSE 0 END,
      total_lost = coalesce(total_lost,0) + CASE WHEN id <> v_winner THEN v_oath.stake_amount ELSE 0 END,
      updated_at = now()
    WHERE id IN (v_oath.creator_id,v_oath.opponent_id);
  ELSE
    UPDATE public.profiles SET
      oaths_completed = coalesce(oaths_completed,0) + CASE WHEN p_success THEN 1 ELSE 0 END,
      oaths_failed = coalesce(oaths_failed,0) + CASE WHEN p_success THEN 0 ELSE 1 END,
      total_won = coalesce(total_won,0) + CASE WHEN p_success THEN v_oath.stake_amount ELSE 0 END,
      total_lost = coalesce(total_lost,0) + CASE WHEN p_success THEN 0 ELSE v_oath.stake_amount END,
      updated_at = now()
    WHERE id = v_oath.creator_id;
  END IF;

  IF p_verification_token IS NOT NULL THEN
    UPDATE public.nominees SET verified = true, verdict = CASE WHEN p_success THEN 'success' ELSE 'penalty' END,
      verdict_note = left(p_note, 500), responded_at = now()
    WHERE oath_id = p_oath_id AND verification_token::text = p_verification_token;
  END IF;
  INSERT INTO public.wall_entries (oath_id, user_id, wall_type, oath_statement, stake_amount, excuse, username)
  SELECT p_oath_id, creator_id, CASE WHEN p_success THEN 'honor'::public.wall_type ELSE 'shame'::public.wall_type END,
    oath_statement, stake_amount, CASE WHEN p_success THEN NULL ELSE coalesce(p_note, 'Failed to complete oath.') END,
    (SELECT username FROM public.profiles WHERE id = creator_id)
  FROM public.oaths WHERE id = p_oath_id AND consequence_type = 'public_shame';
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_oath(p_oath_id UUID, p_success BOOLEAN, p_note TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT public.settle_oath_atomically(p_oath_id, p_success, p_note, NULL, FALSE);
$$;
CREATE OR REPLACE FUNCTION public.forfeit_oath(p_oath_id UUID, p_note TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT public.settle_oath_atomically(p_oath_id, FALSE, p_note, NULL, TRUE);
$$;
CREATE OR REPLACE FUNCTION public.get_nominee_challenge(p_token TEXT)
RETURNS TABLE (
  oath_id UUID,
  oath_statement TEXT,
  deadline TIMESTAMPTZ,
  stake_amount NUMERIC,
  oath_type public.oath_type,
  challenge_status public.oath_status,
  creator_username TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT o.id,o.oath_statement,o.deadline,o.stake_amount,o.oath_type,o.status,p.username
  FROM public.nominees n
  JOIN public.oaths o ON o.id=n.oath_id
  JOIN public.profiles p ON p.id=o.creator_id
  WHERE n.verification_token::text=p_token AND n.verified=false AND o.status='active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.verify_nominee(p_token TEXT, p_success BOOLEAN, p_note TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_oath_id UUID;
BEGIN
  SELECT oath_id INTO v_oath_id FROM public.nominees
    WHERE verification_token::text=p_token AND verified=false FOR UPDATE;
  IF v_oath_id IS NULL THEN RAISE EXCEPTION 'Invalid or already used verification token'; END IF;
  PERFORM public.settle_oath_atomically(v_oath_id,p_success,p_note,p_token,FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_oath_proof(
  p_oath_id UUID, p_proof_type TEXT, p_proof_url TEXT DEFAULT NULL, p_proof_text TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_user UUID := auth.uid(); v_id UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.oaths o WHERE o.id = p_oath_id AND o.status = 'active' AND o.deadline > now()
    AND (o.creator_id = v_user OR o.opponent_id = v_user OR EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.oath_id=o.id AND gm.user_id=v_user))) THEN
    RAISE EXCEPTION 'Oath is closed, expired, or you are not an active participant';
  END IF;
  IF p_proof_type NOT IN ('photo','video','screenshot','link','text') THEN RAISE EXCEPTION 'Unsupported proof type'; END IF;
  IF p_proof_type IN ('photo','video','screenshot') THEN
    IF p_proof_url IS NULL OR p_proof_url NOT LIKE p_oath_id::text || '/' || v_user::text || '/%' THEN
      RAISE EXCEPTION 'Uploaded proof must use your private oath storage path';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id='oath-proofs' AND so.name=p_proof_url) THEN
      RAISE EXCEPTION 'Proof file was not uploaded to private storage';
    END IF;
  END IF;
  IF p_proof_type = 'link' AND (p_proof_url IS NULL OR p_proof_url !~ '^https?://[^[:space:]]+$') THEN RAISE EXCEPTION 'Proof link must be a valid HTTP(S) URL'; END IF;
  IF p_proof_type = 'text' AND (coalesce(length(trim(p_proof_text)),0) < 10 OR length(p_proof_text) > 5000) THEN RAISE EXCEPTION 'Proof text must be between 10 and 5000 characters'; END IF;
  INSERT INTO public.proofs (oath_id, submitted_by, proof_type, proof_url, proof_text)
  VALUES (p_oath_id, v_user, p_proof_type, p_proof_url, left(p_proof_text,5000)) RETURNING id INTO v_id;
  UPDATE public.group_members SET proof_submitted = true WHERE oath_id = p_oath_id AND user_id = v_user;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cast_squad_vote(p_oath_id UUID, p_member_id UUID, p_approve BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_user UUID := auth.uid(); v_member public.group_members%ROWTYPE; v_proof UUID; v_yes INTEGER; v_no INTEGER; v_wallet UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_member FROM public.group_members WHERE id=p_member_id AND oath_id=p_oath_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.group_members WHERE oath_id=p_oath_id AND user_id=v_user) THEN RAISE EXCEPTION 'Not a member of this squad'; END IF;
  IF v_member.user_id = v_user THEN RAISE EXCEPTION 'You cannot vote on your own proof'; END IF;
  IF EXISTS (SELECT 1 FROM public.votes WHERE proof_id IN (SELECT id FROM public.proofs WHERE oath_id=p_oath_id AND submitted_by=v_member.user_id) AND voter_id=v_user) THEN
    RAISE EXCEPTION 'You have already voted on this proof';
  END IF;
  IF v_member.status <> 'joined' THEN RAISE EXCEPTION 'This member has already been resolved'; END IF;
  IF v_member.proof_submitted IS NOT TRUE THEN RAISE EXCEPTION 'Member has not submitted proof'; END IF;
  SELECT id INTO v_proof FROM public.proofs WHERE oath_id=p_oath_id AND submitted_by=v_member.user_id ORDER BY created_at DESC LIMIT 1;
  IF v_proof IS NULL THEN RAISE EXCEPTION 'No proof to vote on'; END IF;
  INSERT INTO public.votes (proof_id, voter_id, oath_id, vote) VALUES (v_proof,v_user,p_oath_id,p_approve);
  SELECT count(*) FILTER (WHERE vote), count(*) FILTER (WHERE NOT vote) INTO v_yes,v_no FROM public.votes WHERE proof_id=v_proof;
  IF v_yes >= greatest(1,v_member.votes_needed) THEN
    UPDATE public.group_members SET votes_received=v_yes,status='completed',is_winner=true WHERE id=v_member.id;
    UPDATE public.profiles SET oaths_completed=coalesce(oaths_completed,0)+1,updated_at=now() WHERE id=v_member.user_id;
    IF v_member.stake_amount > 0 THEN
      UPDATE public.wallets SET balance=balance+v_member.stake_amount,escrow_locked=escrow_locked-v_member.stake_amount,updated_at=now()
      WHERE user_id=v_member.user_id AND escrow_locked>=v_member.stake_amount RETURNING id INTO v_wallet;
      IF v_wallet IS NULL THEN RAISE EXCEPTION 'Member escrow is inconsistent'; END IF;
      INSERT INTO public.transactions(wallet_id,oath_id,type,amount,description)
      VALUES(v_wallet,p_oath_id,'escrow_release',v_member.stake_amount,'Squad oath completed');
    END IF;
  ELSIF v_no >= greatest(1,v_member.votes_needed) THEN
    UPDATE public.group_members SET votes_received=v_yes,status='failed',is_winner=false WHERE id=v_member.id;
    UPDATE public.profiles SET oaths_failed=coalesce(oaths_failed,0)+1,total_lost=coalesce(total_lost,0)+v_member.stake_amount,updated_at=now() WHERE id=v_member.user_id;
    IF v_member.stake_amount > 0 THEN
      UPDATE public.wallets SET total_lost=total_lost+v_member.stake_amount,escrow_locked=escrow_locked-v_member.stake_amount,updated_at=now()
      WHERE user_id=v_member.user_id AND escrow_locked>=v_member.stake_amount RETURNING id INTO v_wallet;
      IF v_wallet IS NULL THEN RAISE EXCEPTION 'Member escrow is inconsistent'; END IF;
      INSERT INTO public.transactions(wallet_id,oath_id,type,amount,description)
      VALUES(v_wallet,p_oath_id,'penalty',v_member.stake_amount,'Squad proof rejected');
    END IF;
  ELSE
    UPDATE public.group_members SET votes_received=v_yes WHERE id=v_member.id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_squad(p_oath_id UUID, p_stake_amount NUMERIC) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_user UUID := auth.uid(); v_wallet UUID; v_member UUID; v_oath public.oaths%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_stake_amount IS NULL OR p_stake_amount < 0 OR round(p_stake_amount,2) <> p_stake_amount THEN RAISE EXCEPTION 'Invalid stake amount'; END IF;
  SELECT * INTO v_oath FROM public.oaths WHERE id=p_oath_id AND oath_type='squad' AND status IN ('pending','active') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Squad is not open'; END IF;
  IF v_oath.deadline <= now() THEN RAISE EXCEPTION 'Squad deadline has passed'; END IF;
  IF p_stake_amount <> v_oath.stake_amount THEN RAISE EXCEPTION 'Stake does not match this squad'; END IF;
  IF EXISTS (SELECT 1 FROM public.group_members WHERE oath_id=p_oath_id AND user_id=v_user) THEN RAISE EXCEPTION 'Already joined'; END IF;
  IF v_oath.max_players > 0 AND (SELECT count(*) FROM public.group_members WHERE oath_id=p_oath_id) >= v_oath.max_players THEN RAISE EXCEPTION 'Squad is full'; END IF;
  IF p_stake_amount > 0 THEN
    UPDATE public.wallets SET balance=balance-p_stake_amount, escrow_locked=escrow_locked+p_stake_amount, updated_at=now()
    WHERE user_id=v_user AND balance>=p_stake_amount RETURNING id INTO v_wallet;
    IF v_wallet IS NULL THEN RAISE EXCEPTION 'Insufficient available balance'; END IF;
  END IF;
  INSERT INTO public.group_members (oath_id,user_id,stake_amount,status,votes_needed) VALUES (p_oath_id,v_user,p_stake_amount,'joined',3) RETURNING id INTO v_member;
  UPDATE public.profiles SET total_staked=coalesce(total_staked,0)+p_stake_amount,updated_at=now() WHERE id=v_user;
  IF v_wallet IS NOT NULL THEN INSERT INTO public.transactions(wallet_id,oath_id,type,amount,description) VALUES(v_wallet,p_oath_id,'escrow_lock',p_stake_amount,'Squad stake locked'); END IF;
  UPDATE public.oaths SET status='active',updated_at=now()
    WHERE id=p_oath_id AND status='pending'
      AND (SELECT count(*) FROM public.group_members WHERE oath_id=p_oath_id) >= greatest(1,v_oath.min_players);
  RETURN v_member;
END;
$$;

-- Fail a squad member who reaches the deadline without submitting any proof.
CREATE OR REPLACE FUNCTION public.fail_squad_member(p_oath_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_user UUID := auth.uid(); v_oath public.oaths%ROWTYPE; v_member public.group_members%ROWTYPE; v_wallet UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_oath FROM public.oaths WHERE id=p_oath_id AND oath_type='squad' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Squad not found'; END IF;
  IF v_oath.deadline > now() THEN RAISE EXCEPTION 'Squad deadline has not passed'; END IF;
  SELECT * INTO v_member FROM public.group_members WHERE oath_id=p_oath_id AND user_id=v_user FOR UPDATE;
  IF NOT FOUND OR v_member.status <> 'joined' THEN RAISE EXCEPTION 'No unresolved squad membership found'; END IF;
  IF v_member.proof_submitted IS TRUE OR EXISTS (SELECT 1 FROM public.proofs WHERE oath_id=p_oath_id AND submitted_by=v_user) THEN
    RAISE EXCEPTION 'A member with submitted proof must be resolved by quorum';
  END IF;
  UPDATE public.group_members SET status='failed',is_winner=false WHERE id=v_member.id;
  UPDATE public.profiles SET oaths_failed=coalesce(oaths_failed,0)+1,total_lost=coalesce(total_lost,0)+v_member.stake_amount,updated_at=now()
    WHERE id=v_user;
  IF v_member.stake_amount > 0 THEN
    UPDATE public.wallets SET total_lost=total_lost+v_member.stake_amount,escrow_locked=escrow_locked-v_member.stake_amount,updated_at=now()
      WHERE user_id=v_user AND escrow_locked>=v_member.stake_amount RETURNING id INTO v_wallet;
    IF v_wallet IS NULL THEN RAISE EXCEPTION 'Member escrow is inconsistent'; END IF;
    INSERT INTO public.transactions(wallet_id,oath_id,type,amount,description)
      VALUES(v_wallet,p_oath_id,'penalty',v_member.stake_amount,'Squad deadline passed without proof');
  END IF;
END;
$$;

-- Storage is private; signed URLs are issued only to participants.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('oath-proofs', 'oath-proofs', false, 10485760, ARRAY['image/jpeg','image/png','image/webp','video/mp4','video/webm'])
ON CONFLICT (id) DO UPDATE SET public=false, file_size_limit=10485760;
DROP POLICY IF EXISTS "Public read for oath-proofs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload oath-proofs" ON storage.objects;
DROP POLICY IF EXISTS "Oath participants can read proof files" ON storage.objects;
DROP POLICY IF EXISTS "Users upload own oath proof files" ON storage.objects;
CREATE POLICY "Oath participants can read proof files" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='oath-proofs' AND EXISTS (SELECT 1 FROM public.oaths o WHERE o.id=(storage.foldername(name))[1]::uuid
    AND public.is_oath_member(o.id)));
CREATE POLICY "Users upload own oath proof files" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='oath-proofs' AND (storage.foldername(name))[2]=auth.uid()::text AND
  EXISTS (SELECT 1 FROM public.oaths o WHERE o.id=(storage.foldername(name))[1]::uuid AND o.status='active' AND
    (o.creator_id=auth.uid() OR o.opponent_id=auth.uid() OR public.is_oath_member(o.id))));

REVOKE ALL ON FUNCTION public.create_oath_with_stake(TEXT,TIMESTAMPTZ,public.oath_type,public.verification_method,public.consequence_type,NUMERIC,TEXT,TEXT,TEXT,INTEGER,INTEGER,UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_duo_challenge(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_duo_challenge(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.settle_oath_atomically(UUID,BOOLEAN,TEXT,TEXT,BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_oath(UUID,BOOLEAN,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.forfeit_oath(UUID,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_nominee(TEXT,BOOLEAN,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_nominee_challenge(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_oath_proof(UUID,TEXT,TEXT,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cast_squad_vote(UUID,UUID,BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.join_squad(UUID,NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fail_squad_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_oath_with_stake(TEXT,TIMESTAMPTZ,public.oath_type,public.verification_method,public.consequence_type,NUMERIC,TEXT,TEXT,TEXT,INTEGER,INTEGER,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_duo_challenge(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_duo_challenge(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_oath(UUID,BOOLEAN,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forfeit_oath(UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_nominee(TEXT,BOOLEAN,TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_nominee_challenge(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_oath_proof(UUID,TEXT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cast_squad_vote(UUID,UUID,BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_squad(UUID,NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fail_squad_member(UUID) TO authenticated;

COMMIT;
