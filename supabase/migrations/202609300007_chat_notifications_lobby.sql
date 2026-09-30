-- supabase-disable-transaction
-- 202609300007_chat_notifications_lobby.sql
-- Add 'lobby' to oath_type, create messages and notifications tables.

-- 1. Add 'lobby' to oath_type enum
ALTER TYPE public.oath_type ADD VALUE IF NOT EXISTS 'lobby';

-- 1.5 Add nominee_user_id to nominees for internal user verification
ALTER TABLE public.nominees ADD COLUMN IF NOT EXISTS nominee_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 2. Create messages table for integrated chats
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  oath_id UUID NOT NULL REFERENCES public.oaths(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'text', -- 'text', 'proof', 'system'
  proof_id UUID REFERENCES public.proofs(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Create notifications table to replace challenges modal
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL, -- 'invite_duo', 'invite_squad', 'verify_proof', 'system'
  title TEXT,
  message TEXT,
  oath_id UUID REFERENCES public.oaths(id) ON DELETE CASCADE,
  proof_id UUID REFERENCES public.proofs(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'rejected', 'read'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Enable RLS
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for Messages
-- Anyone involved in the oath (creator, member, opponent, nominee) can read and insert messages
CREATE POLICY "Users can view messages for oaths they are part of"
ON public.messages FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.oaths o WHERE o.id = messages.oath_id AND (o.creator_id = auth.uid() OR o.opponent_id = auth.uid())
  ) OR EXISTS (
    SELECT 1 FROM public.group_members gm WHERE gm.oath_id = messages.oath_id AND gm.user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.nominees n WHERE n.oath_id = messages.oath_id AND n.nominee_user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.oaths o WHERE o.id = messages.oath_id AND o.oath_type::text = 'lobby'
  )
);

CREATE POLICY "Users can insert messages into their oaths"
ON public.messages FOR INSERT
WITH CHECK (
  auth.uid() = sender_id AND (
    EXISTS (
      SELECT 1 FROM public.oaths o WHERE o.id = messages.oath_id AND (o.creator_id = auth.uid() OR o.opponent_id = auth.uid())
    ) OR EXISTS (
      SELECT 1 FROM public.group_members gm WHERE gm.oath_id = messages.oath_id AND gm.user_id = auth.uid()
    ) OR EXISTS (
      SELECT 1 FROM public.nominees n WHERE n.oath_id = messages.oath_id AND n.nominee_user_id = auth.uid()
    ) OR EXISTS (
      SELECT 1 FROM public.oaths o WHERE o.id = messages.oath_id AND o.oath_type::text = 'lobby'
    )
  )
);

-- 6. RLS Policies for Notifications
CREATE POLICY "Users can view their own notifications"
ON public.notifications FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notifications"
ON public.notifications FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert notifications"
ON public.notifications FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- 7. Add Realtime
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;
