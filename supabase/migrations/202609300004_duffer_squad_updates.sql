-- Update vote_on_proof and forfeit_squad_member to manage duffer_debt
CREATE OR REPLACE FUNCTION public.vote_on_proof(p_oath_id UUID, p_approve BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_user UUID := auth.uid();
  v_member RECORD;
  v_proof UUID;
  v_yes INT;
  v_no INT;
  v_wallet UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_member FROM public.group_members WHERE oath_id = p_oath_id AND user_id = v_user AND status = 'joined';
  IF NOT FOUND THEN RAISE EXCEPTION 'Not an active member of this squad'; END IF;
  SELECT id INTO v_proof FROM public.proofs WHERE oath_id = p_oath_id AND submitted_by = v_user AND status = 'pending_review' ORDER BY created_at DESC LIMIT 1;
  IF v_proof IS NULL THEN RAISE EXCEPTION 'No proof to vote on'; END IF;
  INSERT INTO public.votes (proof_id, voter_id, oath_id, vote) VALUES (v_proof, v_user, p_oath_id, p_approve);
  SELECT count(*) FILTER (WHERE vote), count(*) FILTER (WHERE NOT vote) INTO v_yes, v_no FROM public.votes WHERE proof_id = v_proof;
  
  IF v_yes >= greatest(1, v_member.votes_needed) THEN
    UPDATE public.group_members SET votes_received = v_yes, status = 'completed', is_winner = true WHERE id = v_member.id;
    UPDATE public.profiles SET oaths_completed = coalesce(oaths_completed,0) + 1, duffer_debt = greatest(0, duffer_debt - 1), updated_at = now() WHERE id = v_member.user_id;
    IF v_member.stake_amount > 0 THEN
      UPDATE public.wallets SET balance = balance + v_member.stake_amount, escrow_locked = escrow_locked - v_member.stake_amount, updated_at = now()
      WHERE user_id = v_member.user_id AND escrow_locked >= v_member.stake_amount RETURNING id INTO v_wallet;
      IF v_wallet IS NULL THEN RAISE EXCEPTION 'Member escrow is inconsistent'; END IF;
      INSERT INTO public.transactions(wallet_id, oath_id, type, amount, description)
      VALUES(v_wallet, p_oath_id, 'escrow_release', v_member.stake_amount, 'Squad oath completed');
    END IF;
  ELSIF v_no >= greatest(1, v_member.votes_needed) THEN
    UPDATE public.group_members SET votes_received = v_no, status = 'failed', is_winner = false WHERE id = v_member.id;
    UPDATE public.profiles SET oaths_failed = coalesce(oaths_failed,0) + 1, total_lost = coalesce(total_lost,0) + v_member.stake_amount, duffer_debt = duffer_debt + 2, updated_at = now() WHERE id = v_member.user_id;
    IF v_member.stake_amount > 0 THEN
      UPDATE public.wallets SET total_lost = total_lost + v_member.stake_amount, escrow_locked = escrow_locked - v_member.stake_amount, updated_at = now()
      WHERE user_id = v_member.user_id AND escrow_locked >= v_member.stake_amount RETURNING id INTO v_wallet;
      IF v_wallet IS NULL THEN RAISE EXCEPTION 'Member escrow is inconsistent'; END IF;
      INSERT INTO public.transactions(wallet_id, oath_id, type, amount, description)
      VALUES(v_wallet, p_oath_id, 'penalty', v_member.stake_amount, 'Squad stake forfeited');
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.forfeit_squad_member(p_oath_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_user UUID := auth.uid();
  v_member RECORD;
  v_wallet UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_member FROM public.group_members WHERE oath_id = p_oath_id AND user_id = v_user;
  IF NOT FOUND OR v_member.status <> 'joined' THEN RAISE EXCEPTION 'No unresolved squad membership found'; END IF;
  IF v_member.proof_submitted IS TRUE OR EXISTS (SELECT 1 FROM public.proofs WHERE oath_id = p_oath_id AND submitted_by = v_user) THEN
    RAISE EXCEPTION 'A member with submitted proof must be resolved by quorum';
  END IF;
  
  UPDATE public.group_members SET status = 'failed', is_winner = false WHERE id = v_member.id;
  UPDATE public.profiles SET oaths_failed = coalesce(oaths_failed,0) + 1, total_lost = coalesce(total_lost,0) + v_member.stake_amount, duffer_debt = duffer_debt + 2, updated_at = now()
    WHERE id = v_user;
    
  IF v_member.stake_amount > 0 THEN
    UPDATE public.wallets SET total_lost = total_lost + v_member.stake_amount, escrow_locked = escrow_locked - v_member.stake_amount, updated_at = now()
      WHERE user_id = v_user AND escrow_locked >= v_member.stake_amount RETURNING id INTO v_wallet;
    IF v_wallet IS NULL THEN RAISE EXCEPTION 'Member escrow is inconsistent'; END IF;
    INSERT INTO public.transactions(wallet_id, oath_id, type, amount, description)
      VALUES(v_wallet, p_oath_id, 'penalty', v_member.stake_amount, 'Squad stake forfeited manually');
  END IF;
END;
$$;
