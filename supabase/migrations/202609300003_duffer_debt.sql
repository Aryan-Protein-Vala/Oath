ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS duffer_debt INT NOT NULL DEFAULT 0;

-- Update verify_nominee and settle_oath functions to adjust duffer_debt
CREATE OR REPLACE FUNCTION public.settle_oath(p_oath_id UUID, p_success BOOLEAN, p_note TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_oath RECORD;
  v_payout NUMERIC := 0;
  v_winner UUID;
BEGIN
  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not active or not found'; END IF;

  IF v_oath.oath_type = 'duo' THEN
    IF v_oath.opponent_id IS NULL THEN RAISE EXCEPTION 'Duo oath lacks an opponent'; END IF;
    v_winner := CASE WHEN p_success THEN v_oath.creator_id ELSE v_oath.opponent_id END;
    v_payout := v_oath.stake_amount * 2 * 0.90;
    UPDATE public.wallets SET balance = balance + v_payout, total_won = coalesce(total_won, 0) + (v_payout - v_oath.stake_amount), updated_at = now()
    WHERE user_id = v_winner;
    UPDATE public.wallets SET total_lost = coalesce(total_lost, 0) + v_oath.stake_amount, updated_at = now()
    WHERE user_id = CASE WHEN p_success THEN v_oath.opponent_id ELSE v_oath.creator_id END;
    UPDATE public.wallets SET escrow_locked = escrow_locked - v_oath.stake_amount, updated_at = now()
    WHERE user_id IN (v_oath.creator_id, v_oath.opponent_id);
    INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
    SELECT id, p_oath_id, CASE WHEN user_id = v_winner THEN 'reward'::public.transaction_type ELSE 'penalty'::public.transaction_type END,
      CASE WHEN user_id = v_winner THEN v_payout ELSE v_oath.stake_amount END,
      CASE WHEN user_id = v_winner THEN 'Duo win' ELSE 'Duo loss' END
    FROM public.wallets WHERE user_id IN (v_oath.creator_id, v_oath.opponent_id);
  ELSE
    UPDATE public.wallets SET escrow_locked = escrow_locked - v_oath.stake_amount, updated_at = now()
    WHERE user_id = v_oath.creator_id;
    IF p_success THEN
      UPDATE public.wallets SET balance = balance + v_oath.stake_amount, updated_at = now() WHERE user_id = v_oath.creator_id;
      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      SELECT id, p_oath_id, 'escrow_release', v_oath.stake_amount, 'Oath completed successfully'
      FROM public.wallets WHERE user_id = v_oath.creator_id;
    ELSE
      UPDATE public.wallets SET total_lost = coalesce(total_lost, 0) + v_oath.stake_amount, updated_at = now() WHERE user_id = v_oath.creator_id;
      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      SELECT id, p_oath_id, 'penalty', v_oath.stake_amount, 'Oath failed - stake forfeited'
      FROM public.wallets WHERE user_id = v_oath.creator_id;
    END IF;
  END IF;

  UPDATE public.oaths SET status = CASE WHEN p_success THEN 'completed' ELSE 'failed' END,
    completed_at = CASE WHEN p_success THEN now() ELSE NULL END,
    failed_at = CASE WHEN p_success THEN failed_at ELSE now() END,
    failure_excuse = CASE WHEN p_success THEN NULL ELSE left(coalesce(p_note, 'Failed to complete oath.'), 500) END,
    updated_at = now() WHERE id = p_oath_id;

  IF v_oath.oath_type = 'duo' THEN
    UPDATE public.profiles SET
      oaths_completed = coalesce(oaths_completed,0) + CASE WHEN id = v_winner THEN 1 ELSE 0 END,
      oaths_failed = coalesce(oaths_failed,0) + CASE WHEN id <> v_winner THEN 1 ELSE 0 END,
      total_won = coalesce(total_won,0) + CASE WHEN id = v_winner THEN v_payout - v_oath.stake_amount ELSE 0 END,
      total_lost = coalesce(total_lost,0) + CASE WHEN id <> v_winner THEN v_oath.stake_amount ELSE 0 END,
      duffer_debt = CASE WHEN id = v_winner THEN greatest(0, duffer_debt - 1) ELSE duffer_debt + 2 END,
      updated_at = now()
    WHERE id IN (v_oath.creator_id,v_oath.opponent_id);
  ELSE
    UPDATE public.profiles SET
      oaths_completed = coalesce(oaths_completed,0) + CASE WHEN p_success THEN 1 ELSE 0 END,
      oaths_failed = coalesce(oaths_failed,0) + CASE WHEN p_success THEN 0 ELSE 1 END,
      total_won = coalesce(total_won,0) + CASE WHEN p_success THEN v_oath.stake_amount ELSE 0 END,
      total_lost = coalesce(total_lost,0) + CASE WHEN p_success THEN 0 ELSE v_oath.stake_amount END,
      duffer_debt = CASE WHEN p_success THEN greatest(0, duffer_debt - 1) ELSE duffer_debt + 2 END,
      updated_at = now()
    WHERE id = v_oath.creator_id;
  END IF;

  IF v_oath.consequence_type = 'public_shame' THEN
    INSERT INTO public.wall_entries (oath_id, user_id, wall_type, oath_statement, stake_amount, excuse, username)
    SELECT p_oath_id, creator_id, CASE WHEN p_success THEN 'honor'::public.wall_type ELSE 'shame'::public.wall_type END,
      oath_statement, stake_amount, CASE WHEN p_success THEN NULL ELSE coalesce(p_note, 'Failed to complete oath.') END,
      (SELECT username FROM public.profiles WHERE id = creator_id)
    FROM public.oaths WHERE id = p_oath_id;
  END IF;
END;
$$;
