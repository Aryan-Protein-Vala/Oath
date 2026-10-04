-- Migration: 202610040001_admin_rls_bypass.sql
-- Grants read access to all major tables for the admin (reaper_exe) so the dashboard populates correctly.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND username = 'reaper_exe'
  );
$$;

-- Add admin SELECT policies for all relevant tables
CREATE POLICY "Admin can view all wallets" ON public.wallets FOR SELECT USING (public.is_admin());
CREATE POLICY "Admin can view all oaths" ON public.oaths FOR SELECT USING (public.is_admin());
CREATE POLICY "Admin can view all transactions" ON public.transactions FOR SELECT USING (public.is_admin());
CREATE POLICY "Admin can view all feedbacks" ON public.feedbacks FOR SELECT USING (public.is_admin());
CREATE POLICY "Admin can view all group_members" ON public.group_members FOR SELECT USING (public.is_admin());
CREATE POLICY "Admin can view all proofs" ON public.proofs FOR SELECT USING (public.is_admin());
CREATE POLICY "Admin can view all nominees" ON public.nominees FOR SELECT USING (public.is_admin());

-- Allow admin to update profiles (e.g., blocking users)
CREATE POLICY "Admin can update all profiles" ON public.profiles FOR UPDATE USING (public.is_admin());
