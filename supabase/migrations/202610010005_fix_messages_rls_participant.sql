-- Migration 202610010005: Security Definer helper for oath participation to prevent nominees table permission denial in messages RLS

CREATE OR REPLACE FUNCTION public.is_oath_participant(p_oath_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR p_oath_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.oaths o
    WHERE o.id = p_oath_id
      AND (
        o.creator_id = p_user_id
        OR o.opponent_id = p_user_id
        OR o.oath_type::text = 'lobby'
      )
  ) OR EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.oath_id = p_oath_id
      AND gm.user_id = p_user_id
  ) OR EXISTS (
    SELECT 1 FROM public.nominees n
    WHERE n.oath_id = p_oath_id
      AND n.nominee_user_id = p_user_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_oath_participant(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_oath_participant(UUID, UUID) TO anon;

DROP POLICY IF EXISTS "Users can view messages for oaths they are part of" ON public.messages;
DROP POLICY IF EXISTS "Users can insert messages into their oaths" ON public.messages;

CREATE POLICY "Users can view messages for oaths they are part of"
ON public.messages FOR SELECT
TO authenticated
USING (
  public.is_oath_participant(messages.oath_id, auth.uid())
);

CREATE POLICY "Users can insert messages into their oaths"
ON public.messages FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = sender_id
  AND public.is_oath_participant(messages.oath_id, auth.uid())
);
