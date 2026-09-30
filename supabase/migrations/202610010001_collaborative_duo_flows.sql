-- Collaborative duo completion: every invited participant opts in, proves their own work,
-- and has their own virtual stake returned (or forfeited) independently.
BEGIN;

ALTER TABLE public.oaths ADD COLUMN IF NOT EXISTS anti_charity_destination TEXT;
UPDATE public.oaths SET consequence_type=CASE WHEN stake_amount>0 THEN 'fiat'::public.consequence_type ELSE 'mutual_destruction'::public.consequence_type END
WHERE oath_type='duo' AND consequence_type IN ('bounty_transfer','bounty_split');

-- Carry active legacy Duo challenges into the per-participant model without changing their
-- already-locked balances. Pending invitations have only the creator; accepted invitations
-- already have both independently funded participants.
INSERT INTO public.group_members(oath_id,user_id,stake_amount,status,votes_needed)
SELECT o.id,o.creator_id,o.stake_amount,'joined',1
FROM public.oaths o
WHERE o.oath_type='duo' AND o.status IN ('pending','active')
ON CONFLICT (oath_id,user_id) DO NOTHING;
INSERT INTO public.group_members(oath_id,user_id,stake_amount,status,votes_needed)
SELECT o.id,o.opponent_id,o.stake_amount,'joined',1
FROM public.oaths o
WHERE o.oath_type='duo' AND o.status='active' AND o.opponent_id IS NOT NULL
ON CONFLICT (oath_id,user_id) DO NOTHING;

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
  IF p_consequence_type <> 'fiat' AND p_stake_amount <> 0 THEN RAISE EXCEPTION 'Only financial consequences may use a positive virtual stake'; END IF;
  IF p_consequence_type = 'anti_charity' AND NULLIF(trim(p_social_ransom_message), '') IS NULL THEN RAISE EXCEPTION 'Choose an anti-charity destination'; END IF;
  IF p_oath_type = 'duo' AND (p_verification_method <> 'peer' OR p_consequence_type NOT IN ('fiat','mutual_destruction')) THEN
    RAISE EXCEPTION 'Duo challenges require peer verification and a supported shared consequence';
  END IF;
  IF p_oath_type = 'duo' AND p_consequence_type = 'fiat' AND p_stake_amount <= 0 THEN
    RAISE EXCEPTION 'Financial duo challenges require a positive individual virtual stake';
  END IF;
  IF p_oath_type = 'duo' AND p_consequence_type = 'mutual_destruction' AND p_stake_amount <> 0 THEN
    RAISE EXCEPTION 'No-money duo challenges cannot include a stake';
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
  IF p_oath_type = 'solo' AND (p_verification_method <> 'solo_lonely' OR p_consequence_type NOT IN ('fiat','public_shame','social_ransom','anti_charity')) THEN
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

  IF p_stake_amount > 0 THEN
    UPDATE public.wallets SET balance = balance - p_stake_amount,
      escrow_locked = escrow_locked + p_stake_amount, updated_at = now()
    WHERE user_id = v_user AND balance >= p_stake_amount
    RETURNING id INTO v_wallet_id;
    IF v_wallet_id IS NULL THEN RAISE EXCEPTION 'Insufficient available balance'; END IF;
  END IF;

  INSERT INTO public.oaths (creator_id, oath_statement, deadline, oath_type, verification_method,
    consequence_type, stake_amount, status, min_players, max_players, opponent_id, anti_charity_destination)
  VALUES (v_user, trim(p_oath_statement), p_deadline, p_oath_type, p_verification_method,
    p_consequence_type, p_stake_amount, CASE WHEN p_oath_type = 'squad' THEN 'pending'::public.oath_status
      WHEN p_oath_type = 'duo' THEN 'pending'::public.oath_status ELSE 'active'::public.oath_status END,
    greatest(1, coalesce(p_min_players, 1)), greatest(1, coalesce(p_max_players, 1)), p_opponent_id,
    CASE WHEN p_consequence_type = 'anti_charity' THEN left(trim(p_social_ransom_message),160) ELSE NULL END)
  RETURNING id INTO v_oath_id;

  UPDATE public.profiles SET
    oaths_created = coalesce(oaths_created, 0) + 1,
    total_staked = coalesce(total_staked, 0) + p_stake_amount,
    updated_at = now()
  WHERE id = v_user;

  IF (p_consequence_type = 'social_ransom' AND (p_social_ransom_phone IS NOT NULL OR p_social_ransom_message IS NOT NULL)) OR p_nominee_email IS NOT NULL THEN
    INSERT INTO public.oath_private_details (oath_id, social_ransom_phone, social_ransom_message, nominee_email)
    VALUES (v_oath_id, p_social_ransom_phone, p_social_ransom_message, p_nominee_email);
  END IF;
  IF p_oath_type = 'duo' THEN
    INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed)
    VALUES (v_oath_id, v_user, p_stake_amount, 'joined', 1);
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
  SELECT * INTO v_oath FROM public.oaths WHERE id=p_oath_id FOR UPDATE;
  IF NOT FOUND OR v_oath.oath_type <> 'duo' OR v_oath.status <> 'pending' THEN RAISE EXCEPTION 'Challenge is unavailable'; END IF;
  IF v_oath.creator_id=v_user OR (v_oath.opponent_id IS NOT NULL AND v_oath.opponent_id<>v_user) THEN RAISE EXCEPTION 'Challenge is not addressed to this account'; END IF;
  IF v_oath.deadline<=now() THEN RAISE EXCEPTION 'This challenge has expired'; END IF;
  IF v_oath.stake_amount>0 THEN
    UPDATE public.wallets SET balance=balance-v_oath.stake_amount,escrow_locked=escrow_locked+v_oath.stake_amount,updated_at=now()
      WHERE user_id=v_user AND balance>=v_oath.stake_amount RETURNING id INTO v_wallet_id;
    IF v_wallet_id IS NULL THEN RAISE EXCEPTION 'Insufficient available balance; accepting will lock your own virtual stake'; END IF;
  END IF;
  INSERT INTO public.group_members(oath_id,user_id,stake_amount,status,votes_needed)
    VALUES(p_oath_id,v_user,v_oath.stake_amount,'joined',1);
  UPDATE public.oaths SET opponent_id=v_user,status='active',updated_at=now() WHERE id=p_oath_id;
  UPDATE public.profiles SET total_staked=coalesce(total_staked,0)+v_oath.stake_amount,updated_at=now() WHERE id=v_user;
  IF v_wallet_id IS NOT NULL THEN
    INSERT INTO public.transactions(wallet_id,oath_id,type,amount,description)
      VALUES(v_wallet_id,p_oath_id,'escrow_lock',v_oath.stake_amount,'Duo individual virtual stake locked after acceptance');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_duo_challenge(p_oath_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_user UUID:=auth.uid(); v_oath public.oaths%ROWTYPE; v_wallet UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_oath FROM public.oaths WHERE id=p_oath_id FOR UPDATE;
  IF NOT FOUND OR v_oath.oath_type<>'duo' OR v_oath.status<>'pending' THEN RAISE EXCEPTION 'Only a pending duo challenge can be cancelled'; END IF;
  IF v_oath.creator_id<>v_user THEN RAISE EXCEPTION 'Only the challenge creator can cancel it'; END IF;
  IF v_oath.stake_amount>0 THEN
    UPDATE public.wallets SET balance=balance+v_oath.stake_amount,escrow_locked=escrow_locked-v_oath.stake_amount,updated_at=now()
      WHERE user_id=v_user AND escrow_locked>=v_oath.stake_amount RETURNING id INTO v_wallet;
    IF v_wallet IS NULL THEN RAISE EXCEPTION 'Creator escrow is inconsistent'; END IF;
    INSERT INTO public.transactions(wallet_id,oath_id,type,amount,description)
      VALUES(v_wallet,p_oath_id,'escrow_release',v_oath.stake_amount,'Duo invitation cancelled; virtual stake returned');
  END IF;
  UPDATE public.oaths SET status='cancelled',updated_at=now() WHERE id=p_oath_id;
END;
$$;

-- Legacy one-verdict settlement is solo-only. Duo participants are resolved independently by vote.
CREATE OR REPLACE FUNCTION public.settle_oath(p_oath_id UUID,p_success BOOLEAN,p_note TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, public, pg_temp AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.oaths WHERE id=p_oath_id AND oath_type='duo') THEN
    RAISE EXCEPTION 'Duo participants must be resolved individually by peer review';
  END IF;
  PERFORM public.settle_oath_atomically(p_oath_id,p_success,p_note,NULL,FALSE);
END;
$$;
CREATE OR REPLACE FUNCTION public.forfeit_oath(p_oath_id UUID,p_note TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, public, pg_temp AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.oaths WHERE id=p_oath_id AND oath_type='duo') THEN
    RAISE EXCEPTION 'Duo participants must be resolved individually by peer review';
  END IF;
  PERFORM public.settle_oath_atomically(p_oath_id,FALSE,p_note,NULL,TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.cast_squad_vote(p_oath_id UUID,p_member_id UUID,p_approve BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, public, pg_temp AS $$
DECLARE v_user UUID:=auth.uid(); v_member public.group_members%ROWTYPE; v_proof UUID; v_yes INTEGER; v_no INTEGER; v_wallet UUID; v_oath_type public.oath_type;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT o.oath_type INTO v_oath_type FROM public.oaths o WHERE o.id=p_oath_id AND o.status='active' FOR UPDATE;
  IF v_oath_type NOT IN ('duo','squad') THEN RAISE EXCEPTION 'This oath does not use participant voting'; END IF;
  SELECT * INTO v_member FROM public.group_members WHERE id=p_member_id AND oath_id=p_oath_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.group_members WHERE oath_id=p_oath_id AND user_id=v_user) THEN RAISE EXCEPTION 'Not a participant of this oath'; END IF;
  IF v_member.user_id=v_user THEN RAISE EXCEPTION 'You cannot vote on your own proof'; END IF;
  IF EXISTS(SELECT 1 FROM public.votes WHERE proof_id IN (SELECT id FROM public.proofs WHERE oath_id=p_oath_id AND submitted_by=v_member.user_id) AND voter_id=v_user) THEN RAISE EXCEPTION 'You have already voted on this proof'; END IF;
  IF v_member.status<>'joined' THEN RAISE EXCEPTION 'This member has already been resolved'; END IF;
  IF v_member.proof_submitted IS NOT TRUE THEN RAISE EXCEPTION 'Member has not submitted proof'; END IF;
  SELECT id INTO v_proof FROM public.proofs WHERE oath_id=p_oath_id AND submitted_by=v_member.user_id ORDER BY created_at DESC LIMIT 1;
  IF v_proof IS NULL THEN RAISE EXCEPTION 'No proof to vote on'; END IF;
  INSERT INTO public.votes(proof_id,voter_id,oath_id,vote) VALUES(v_proof,v_user,p_oath_id,p_approve);
  SELECT count(*) FILTER(WHERE vote),count(*) FILTER(WHERE NOT vote) INTO v_yes,v_no FROM public.votes WHERE proof_id=v_proof;
  IF v_yes>=greatest(1,v_member.votes_needed) THEN
    UPDATE public.group_members SET votes_received=v_yes,status='completed',is_winner=true WHERE id=v_member.id;
    UPDATE public.profiles SET oaths_completed=coalesce(oaths_completed,0)+1,updated_at=now() WHERE id=v_member.user_id;
    IF v_member.stake_amount>0 THEN
      UPDATE public.wallets SET balance=balance+v_member.stake_amount,escrow_locked=escrow_locked-v_member.stake_amount,updated_at=now()
        WHERE user_id=v_member.user_id AND escrow_locked>=v_member.stake_amount RETURNING id INTO v_wallet;
      IF v_wallet IS NULL THEN RAISE EXCEPTION 'Member escrow is inconsistent'; END IF;
      INSERT INTO public.transactions(wallet_id,oath_id,type,amount,description) VALUES(v_wallet,p_oath_id,'escrow_release',v_member.stake_amount,'Participant completed shared challenge; own virtual stake returned');
    END IF;
  ELSIF v_no>=greatest(1,v_member.votes_needed) THEN
    UPDATE public.group_members SET votes_received=v_yes,status='failed',is_winner=false WHERE id=v_member.id;
    UPDATE public.profiles SET oaths_failed=coalesce(oaths_failed,0)+1,total_lost=coalesce(total_lost,0)+v_member.stake_amount,updated_at=now() WHERE id=v_member.user_id;
    IF v_member.stake_amount>0 THEN
      UPDATE public.wallets SET total_lost=total_lost+v_member.stake_amount,escrow_locked=escrow_locked-v_member.stake_amount,updated_at=now()
        WHERE user_id=v_member.user_id AND escrow_locked>=v_member.stake_amount RETURNING id INTO v_wallet;
      IF v_wallet IS NULL THEN RAISE EXCEPTION 'Member escrow is inconsistent'; END IF;
      INSERT INTO public.transactions(wallet_id,oath_id,type,amount,description) VALUES(v_wallet,p_oath_id,'penalty',v_member.stake_amount,'Participant did not complete shared challenge');
    END IF;
  ELSE
    UPDATE public.group_members SET votes_received=v_yes WHERE id=v_member.id;
  END IF;
  IF v_oath_type='duo' AND NOT EXISTS(SELECT 1 FROM public.group_members WHERE oath_id=p_oath_id AND status='joined') THEN
    UPDATE public.oaths SET status=CASE WHEN EXISTS(SELECT 1 FROM public.group_members WHERE oath_id=p_oath_id AND status='failed') THEN 'failed'::public.oath_status ELSE 'completed'::public.oath_status END,
      completed_at=CASE WHEN NOT EXISTS(SELECT 1 FROM public.group_members WHERE oath_id=p_oath_id AND status='failed') THEN now() ELSE completed_at END,
      failed_at=CASE WHEN EXISTS(SELECT 1 FROM public.group_members WHERE oath_id=p_oath_id AND status='failed') THEN now() ELSE failed_at END,updated_at=now()
      WHERE id=p_oath_id;
  END IF;
END;
$$;



CREATE OR REPLACE FUNCTION public.submit_oath_proof(
  p_oath_id UUID,p_proof_type TEXT,p_proof_url TEXT DEFAULT NULL,p_proof_text TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_user UUID:=auth.uid(); v_id UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.oaths o WHERE o.id=p_oath_id AND o.status='active' AND o.deadline>now()
    AND (o.creator_id=v_user OR o.opponent_id=v_user OR EXISTS(SELECT 1 FROM public.group_members gm WHERE gm.oath_id=o.id AND gm.user_id=v_user))) THEN
    RAISE EXCEPTION 'Oath is closed, expired, or you are not an active participant';
  END IF;
  IF EXISTS(SELECT 1 FROM public.proofs WHERE oath_id=p_oath_id AND submitted_by=v_user) THEN RAISE EXCEPTION 'Proof already submitted; wait for the reviewer'; END IF;
  IF p_proof_type NOT IN ('photo','video','screenshot','link','text') THEN RAISE EXCEPTION 'Unsupported proof type'; END IF;
  IF p_proof_type IN ('photo','video','screenshot') THEN
    IF p_proof_url IS NULL OR p_proof_url NOT LIKE p_oath_id::text||'/'||v_user::text||'/%' THEN RAISE EXCEPTION 'Uploaded proof must use your private oath storage path'; END IF;
    IF NOT EXISTS(SELECT 1 FROM storage.objects so WHERE so.bucket_id='oath-proofs' AND so.name=p_proof_url) THEN RAISE EXCEPTION 'Proof file was not uploaded to private storage'; END IF;
  END IF;
  IF p_proof_type='link' AND (p_proof_url IS NULL OR p_proof_url !~ '^https?://[^[:space:]]+$') THEN RAISE EXCEPTION 'Proof link must be a valid HTTP(S) URL'; END IF;
  IF p_proof_type='text' AND (coalesce(length(trim(p_proof_text)),0)<10 OR length(p_proof_text)>5000) THEN RAISE EXCEPTION 'Proof text must be between 10 and 5000 characters'; END IF;
  INSERT INTO public.proofs(oath_id,submitted_by,proof_type,proof_url,proof_text) VALUES(p_oath_id,v_user,p_proof_type,p_proof_url,left(p_proof_text,5000)) RETURNING id INTO v_id;
  UPDATE public.group_members SET proof_submitted=true WHERE oath_id=p_oath_id AND user_id=v_user;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_squad_member(p_oath_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_user UUID:=auth.uid(); v_oath public.oaths%ROWTYPE; v_member public.group_members%ROWTYPE; v_wallet UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_oath FROM public.oaths WHERE id=p_oath_id AND oath_type IN ('squad','duo') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shared challenge not found'; END IF;
  IF v_oath.deadline>now() THEN RAISE EXCEPTION 'Challenge deadline has not passed'; END IF;
  SELECT * INTO v_member FROM public.group_members WHERE oath_id=p_oath_id AND user_id=v_user FOR UPDATE;
  IF NOT FOUND OR v_member.status<>'joined' THEN RAISE EXCEPTION 'No unresolved participant found'; END IF;
  IF v_member.proof_submitted IS TRUE OR EXISTS(SELECT 1 FROM public.proofs WHERE oath_id=p_oath_id AND submitted_by=v_user) THEN RAISE EXCEPTION 'A participant with submitted proof must be resolved by peer review'; END IF;
  UPDATE public.group_members SET status='failed',is_winner=false WHERE id=v_member.id;
  UPDATE public.profiles SET oaths_failed=coalesce(oaths_failed,0)+1,total_lost=coalesce(total_lost,0)+v_member.stake_amount,updated_at=now() WHERE id=v_user;
  IF v_member.stake_amount>0 THEN
    UPDATE public.wallets SET total_lost=total_lost+v_member.stake_amount,escrow_locked=escrow_locked-v_member.stake_amount,updated_at=now()
      WHERE user_id=v_user AND escrow_locked>=v_member.stake_amount RETURNING id INTO v_wallet;
    IF v_wallet IS NULL THEN RAISE EXCEPTION 'Member escrow is inconsistent'; END IF;
    INSERT INTO public.transactions(wallet_id,oath_id,type,amount,description)
      VALUES(v_wallet,p_oath_id,'penalty',v_member.stake_amount,CASE WHEN v_oath.oath_type='duo' THEN 'Duo participant missed the shared goal' ELSE 'Squad member missed the shared goal' END);
  END IF;
  IF v_oath.oath_type='duo' AND NOT EXISTS(SELECT 1 FROM public.group_members WHERE oath_id=p_oath_id AND status='joined') THEN
    UPDATE public.oaths SET status='failed',failed_at=now(),updated_at=now() WHERE id=p_oath_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_oath_private_details(p_oath_id UUID)
RETURNS TABLE(social_ransom_phone TEXT,social_ransom_message TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp SET row_security=off AS $$
  SELECT d.social_ransom_phone,d.social_ransom_message
  FROM public.oath_private_details d JOIN public.oaths o ON o.id=d.oath_id
  WHERE d.oath_id=p_oath_id AND o.creator_id=auth.uid() AND o.consequence_type='social_ransom'
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_my_oath_private_details(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_oath_private_details(UUID) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_oath_with_stake(TEXT,TIMESTAMPTZ,public.oath_type,public.verification_method,public.consequence_type,NUMERIC,TEXT,TEXT,TEXT,INTEGER,INTEGER,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_duo_challenge(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_duo_challenge(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_oath(UUID,BOOLEAN,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forfeit_oath(UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cast_squad_vote(UUID,UUID,BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_oath_proof(UUID,TEXT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fail_squad_member(UUID) TO authenticated;

COMMIT;
