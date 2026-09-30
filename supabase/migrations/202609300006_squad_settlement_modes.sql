-- 202609300006_squad_settlement_modes.sql
-- Update squad settlement logic for Survival and Weakest Link modes.

BEGIN;

CREATE OR REPLACE FUNCTION public.cast_squad_vote(p_oath_id UUID, p_member_id UUID, p_approve BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE 
  v_user UUID := auth.uid(); v_member public.group_members%ROWTYPE; v_proof UUID; 
  v_yes INTEGER; v_no INTEGER; v_wallet UUID; v_oath public.oaths%ROWTYPE;
  v_pending_count INTEGER;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND OR v_oath.status <> 'active' THEN RAISE EXCEPTION 'Oath is not active'; END IF;
  
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
    -- SUCCESS
    UPDATE public.group_members SET votes_received=v_yes,status='completed',is_winner=true WHERE id=v_member.id;
    UPDATE public.profiles SET oaths_completed=coalesce(oaths_completed,0)+1,updated_at=now() WHERE id=v_member.user_id;
    
    IF v_oath.group_mode = 'survival' THEN
      -- Release only this stake to the creator
      UPDATE public.wallets SET balance=balance+v_oath.stake_amount,escrow_locked=escrow_locked-v_oath.stake_amount,updated_at=now()
      WHERE user_id=v_oath.creator_id AND escrow_locked>=v_oath.stake_amount RETURNING id INTO v_wallet;
      IF v_wallet IS NOT NULL THEN
        INSERT INTO public.transactions(wallet_id,oath_id,type,amount,description) VALUES(v_wallet,p_oath_id,'escrow_release',v_oath.stake_amount,'Squad member succeeded (Survival)');
      END IF;
    END IF;

  ELSIF v_no >= greatest(1,v_member.votes_needed) THEN
    -- FAILURE
    UPDATE public.group_members SET votes_received=v_yes,status='failed',is_winner=false WHERE id=v_member.id;
    UPDATE public.profiles SET oaths_failed=coalesce(oaths_failed,0)+1,updated_at=now() WHERE id=v_member.user_id;
    
    IF v_oath.group_mode = 'survival' THEN
      UPDATE public.wallets SET total_lost=total_lost+v_oath.stake_amount,escrow_locked=escrow_locked-v_oath.stake_amount,updated_at=now()
      WHERE user_id=v_oath.creator_id AND escrow_locked>=v_oath.stake_amount RETURNING id INTO v_wallet;
      IF v_wallet IS NOT NULL THEN
        INSERT INTO public.transactions(wallet_id,oath_id,type,amount,description) VALUES(v_wallet,p_oath_id,'penalty',v_oath.stake_amount,'Squad member failed (Survival)');
      END IF;
    ELSIF v_oath.group_mode = 'weakest_link' THEN
      -- Drain ALL remaining escrow from the creator
      UPDATE public.wallets SET total_lost=total_lost+escrow_locked, escrow_locked=0, updated_at=now()
      WHERE user_id=v_oath.creator_id RETURNING id INTO v_wallet;
      IF v_wallet IS NOT NULL THEN
        INSERT INTO public.transactions(wallet_id,oath_id,type,amount,description) VALUES(v_wallet,p_oath_id,'penalty',v_oath.stake_amount * v_oath.max_players,'Weakest link failed, total forfeiture');
      END IF;
      UPDATE public.oaths SET status='failed', updated_at=now() WHERE id=p_oath_id;
    END IF;
    
  ELSE
    UPDATE public.group_members SET votes_received=v_yes WHERE id=v_member.id;
  END IF;

  -- Final cleanup check: Are there any pending members left?
  SELECT count(*) INTO v_pending_count FROM public.group_members WHERE oath_id=p_oath_id AND status='joined';
  IF v_pending_count = 0 AND (SELECT status FROM public.oaths WHERE id=p_oath_id) = 'active' THEN
    -- Everyone has resolved.
    UPDATE public.oaths SET status='completed', updated_at=now() WHERE id=p_oath_id;
    -- If weakest link, they survived! Release the entire remaining escrow.
    IF v_oath.group_mode = 'weakest_link' THEN
      UPDATE public.wallets SET balance=balance+escrow_locked, escrow_locked=0, updated_at=now()
      WHERE user_id=v_oath.creator_id RETURNING id INTO v_wallet;
      IF v_wallet IS NOT NULL THEN
        INSERT INTO public.transactions(wallet_id,oath_id,type,amount,description) VALUES(v_wallet,p_oath_id,'escrow_release',v_oath.stake_amount * v_oath.max_players,'Weakest link survived');
      END IF;
    END IF;
  END IF;

END;
$$;


CREATE OR REPLACE FUNCTION public.forfeit_squad_member(p_oath_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_user UUID := auth.uid(); v_oath public.oaths%ROWTYPE; v_member public.group_members%ROWTYPE; v_wallet UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_oath FROM public.oaths WHERE id=p_oath_id FOR UPDATE;
  IF NOT FOUND OR v_oath.status <> 'active' THEN RAISE EXCEPTION 'Squad not active'; END IF;
  SELECT * INTO v_member FROM public.group_members WHERE oath_id=p_oath_id AND user_id=v_user FOR UPDATE;
  IF NOT FOUND OR v_member.status <> 'joined' THEN RAISE EXCEPTION 'No unresolved membership found'; END IF;
  
  UPDATE public.group_members SET status='failed',is_winner=false WHERE id=v_member.id;
  UPDATE public.profiles SET oaths_failed=coalesce(oaths_failed,0)+1,updated_at=now() WHERE id=v_user;

  IF v_oath.group_mode = 'survival' THEN
    UPDATE public.wallets SET total_lost=total_lost+v_oath.stake_amount,escrow_locked=escrow_locked-v_oath.stake_amount,updated_at=now()
    WHERE user_id=v_oath.creator_id AND escrow_locked>=v_oath.stake_amount RETURNING id INTO v_wallet;
    IF v_wallet IS NOT NULL THEN
      INSERT INTO public.transactions(wallet_id,oath_id,type,amount,description) VALUES(v_wallet,p_oath_id,'penalty',v_oath.stake_amount,'Squad member forfeited (Survival)');
    END IF;
  ELSIF v_oath.group_mode = 'weakest_link' THEN
    UPDATE public.wallets SET total_lost=total_lost+escrow_locked, escrow_locked=0, updated_at=now()
    WHERE user_id=v_oath.creator_id RETURNING id INTO v_wallet;
    IF v_wallet IS NOT NULL THEN
      INSERT INTO public.transactions(wallet_id,oath_id,type,amount,description) VALUES(v_wallet,p_oath_id,'penalty',v_oath.stake_amount * v_oath.max_players,'Weakest link forfeited, total forfeiture');
    END IF;
    UPDATE public.oaths SET status='failed', updated_at=now() WHERE id=p_oath_id;
  END IF;
END;
$$;


CREATE OR REPLACE FUNCTION public.fail_squad_member(p_oath_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_user UUID := auth.uid(); v_oath public.oaths%ROWTYPE; v_member public.group_members%ROWTYPE; v_wallet UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_oath FROM public.oaths WHERE id=p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Squad not found'; END IF;
  IF v_oath.deadline > now() THEN RAISE EXCEPTION 'Squad deadline has not passed'; END IF;
  SELECT * INTO v_member FROM public.group_members WHERE oath_id=p_oath_id AND user_id=v_user FOR UPDATE;
  IF NOT FOUND OR v_member.status <> 'joined' THEN RAISE EXCEPTION 'No unresolved squad membership found'; END IF;
  IF v_member.proof_submitted IS TRUE OR EXISTS (SELECT 1 FROM public.proofs WHERE oath_id=p_oath_id AND submitted_by=v_user) THEN
    RAISE EXCEPTION 'A member with submitted proof must be resolved by quorum';
  END IF;
  
  UPDATE public.group_members SET status='failed',is_winner=false WHERE id=v_member.id;
  UPDATE public.profiles SET oaths_failed=coalesce(oaths_failed,0)+1,updated_at=now() WHERE id=v_user;

  IF v_oath.group_mode = 'survival' THEN
    UPDATE public.wallets SET total_lost=total_lost+v_oath.stake_amount,escrow_locked=escrow_locked-v_oath.stake_amount,updated_at=now()
    WHERE user_id=v_oath.creator_id AND escrow_locked>=v_oath.stake_amount RETURNING id INTO v_wallet;
    IF v_wallet IS NOT NULL THEN
      INSERT INTO public.transactions(wallet_id,oath_id,type,amount,description) VALUES(v_wallet,p_oath_id,'penalty',v_oath.stake_amount,'Squad deadline passed without proof (Survival)');
    END IF;
  ELSIF v_oath.group_mode = 'weakest_link' THEN
    UPDATE public.wallets SET total_lost=total_lost+escrow_locked, escrow_locked=0, updated_at=now()
    WHERE user_id=v_oath.creator_id RETURNING id INTO v_wallet;
    IF v_wallet IS NOT NULL THEN
      INSERT INTO public.transactions(wallet_id,oath_id,type,amount,description) VALUES(v_wallet,p_oath_id,'penalty',v_oath.stake_amount * v_oath.max_players,'Weakest link deadline passed, total forfeiture');
    END IF;
    UPDATE public.oaths SET status='failed', updated_at=now() WHERE id=p_oath_id;
  END IF;
END;
$$;

COMMIT;
