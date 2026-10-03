-- Migration: 202610030003_grant_nominees_select_rls.sql
-- Enables RLS on public.nominees and grants SELECT to authenticated and anon with strict ownership checks.
-- This allows oath creators to see their nominee, and assigned nominees to see the oaths they review,
-- without 403 permission denied errors breaking the active oaths query.

ALTER TABLE public.nominees ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.nominees TO authenticated, anon;

DROP POLICY IF EXISTS "Nominees viewable by oath participants or assigned nominee" ON public.nominees;
CREATE POLICY "Nominees viewable by oath participants or assigned nominee" ON public.nominees
FOR SELECT TO authenticated, anon
USING (
  nominee_user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.oaths o WHERE o.id = nominees.oath_id AND (o.creator_id = auth.uid() OR o.opponent_id = auth.uid()))
);
