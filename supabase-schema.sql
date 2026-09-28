-- ============================================================
-- OATH PLATFORM — SUPABASE SCHEMA
-- ============================================================
-- Run this in Supabase SQL Editor to bootstrap the database.
-- ============================================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE oath_type AS ENUM ('solo', 'duo', 'squad');
CREATE TYPE oath_status AS ENUM ('pending', 'active', 'completed', 'failed', 'disputed', 'cancelled');
CREATE TYPE verification_method AS ENUM ('nominee', 'peer', 'quorum', 'solo_lonely', 'app_blocking');
CREATE TYPE consequence_type AS ENUM ('fiat', 'social_ransom', 'app_blocking', 'combined');
CREATE TYPE proof_status AS ENUM ('pending_review', 'verified', 'rejected', 'disputed');
CREATE TYPE transaction_type AS ENUM ('deposit', 'withdrawal', 'escrow_lock', 'escrow_release', 'penalty', 'reward', 'house_cut');
CREATE TYPE wall_type AS ENUM ('shame', 'honor');

-- ============================================================
-- PROFILES (extends Supabase auth.users)
-- ============================================================

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  phone TEXT,
  oaths_created INTEGER DEFAULT 0,
  oaths_completed INTEGER DEFAULT 0,
  oaths_failed INTEGER DEFAULT 0,
  total_staked NUMERIC(12,2) DEFAULT 0,
  total_lost NUMERIC(12,2) DEFAULT 0,
  total_won NUMERIC(12,2) DEFAULT 0,
  reputation_score INTEGER DEFAULT 100,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- WALLETS (Simulated Fiat Ledger)
-- ============================================================

CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  balance NUMERIC(12,2) DEFAULT 0 CHECK (balance >= 0),
  escrow_locked NUMERIC(12,2) DEFAULT 0 CHECK (escrow_locked >= 0),
  total_deposited NUMERIC(12,2) DEFAULT 0,
  total_withdrawn NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ============================================================
-- TRANSACTIONS (Ledger entries)
-- ============================================================

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  oath_id UUID, -- linked later via FK
  type transaction_type NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- OATHS (Core entity)
-- ============================================================

CREATE TABLE oaths (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- The oath itself
  oath_statement TEXT NOT NULL,        -- "I swear to..."
  deadline TIMESTAMPTZ NOT NULL,       -- "...by [date]"
  
  -- Type & mechanics
  oath_type oath_type NOT NULL DEFAULT 'solo',
  verification_method verification_method NOT NULL DEFAULT 'solo_lonely',
  consequence_type consequence_type NOT NULL DEFAULT 'fiat',
  
  -- Stakes
  stake_amount NUMERIC(12,2) DEFAULT 0,
  house_cut_percent NUMERIC(4,2) DEFAULT 10.00 CHECK (house_cut_percent >= 5 AND house_cut_percent <= 15),
  
  -- Social ransom
  social_ransom_phone TEXT,
  social_ransom_message TEXT,
  
  -- Status
  status oath_status NOT NULL DEFAULT 'pending',
  
  -- Squad config
  min_players INTEGER DEFAULT 1,
  max_players INTEGER DEFAULT 1,
  
  -- Opponent (duo)
  opponent_id UUID REFERENCES profiles(id),
  
  -- Result
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_excuse TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add FK from transactions to oaths
ALTER TABLE transactions ADD CONSTRAINT fk_transactions_oath 
  FOREIGN KEY (oath_id) REFERENCES oaths(id) ON DELETE SET NULL;

-- ============================================================
-- NOMINEES (Third-party verifiers)
-- ============================================================

CREATE TABLE nominees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  oath_id UUID NOT NULL REFERENCES oaths(id) ON DELETE CASCADE,
  name TEXT,
  email TEXT,
  phone TEXT,
  verification_token UUID DEFAULT uuid_generate_v4(),
  verified BOOLEAN DEFAULT FALSE,
  verdict TEXT, -- 'success' or 'penalty'
  verdict_note TEXT,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- GROUP MEMBERS (Squad pools)
-- ============================================================

CREATE TABLE group_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  oath_id UUID NOT NULL REFERENCES oaths(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  stake_amount NUMERIC(12,2) DEFAULT 0,
  status TEXT DEFAULT 'joined' CHECK (status IN ('invited', 'joined', 'completed', 'failed', 'eliminated')),
  proof_submitted BOOLEAN DEFAULT FALSE,
  votes_received INTEGER DEFAULT 0,
  votes_needed INTEGER DEFAULT 0,
  is_winner BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(oath_id, user_id)
);

-- ============================================================
-- PROOFS (Evidence uploads)
-- ============================================================

CREATE TABLE proofs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  oath_id UUID NOT NULL REFERENCES oaths(id) ON DELETE CASCADE,
  submitted_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  proof_type TEXT NOT NULL CHECK (proof_type IN ('photo', 'video', 'screenshot', 'link', 'text')),
  proof_url TEXT,
  proof_text TEXT,
  status proof_status DEFAULT 'pending_review',
  reviewer_id UUID REFERENCES profiles(id),
  review_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- VOTES (Quorum voting for squads)
-- ============================================================

CREATE TABLE votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  proof_id UUID NOT NULL REFERENCES proofs(id) ON DELETE CASCADE,
  voter_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  oath_id UUID NOT NULL REFERENCES oaths(id) ON DELETE CASCADE,
  vote BOOLEAN NOT NULL, -- true = verify, false = reject
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(proof_id, voter_id)
);

-- ============================================================
-- WALL OF SHAME / HONOR
-- ============================================================

CREATE TABLE wall_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  oath_id UUID NOT NULL REFERENCES oaths(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  wall_type wall_type NOT NULL,
  oath_statement TEXT NOT NULL,
  stake_amount NUMERIC(12,2) DEFAULT 0,
  excuse TEXT,
  username TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_oaths_creator ON oaths(creator_id);
CREATE INDEX idx_oaths_status ON oaths(status);
CREATE INDEX idx_oaths_type ON oaths(oath_type);
CREATE INDEX idx_oaths_deadline ON oaths(deadline);
CREATE INDEX idx_transactions_wallet ON transactions(wallet_id);
CREATE INDEX idx_proofs_oath ON proofs(oath_id);
CREATE INDEX idx_group_members_oath ON group_members(oath_id);
CREATE INDEX idx_group_members_user ON group_members(user_id);
CREATE INDEX idx_wall_entries_type ON wall_entries(wall_type);
CREATE INDEX idx_wall_entries_created ON wall_entries(created_at DESC);
CREATE INDEX idx_nominees_token ON nominees(verification_token);

-- ============================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================

-- Profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public profiles are viewable by everyone"
  ON profiles FOR SELECT USING (true);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Wallets
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own wallet"
  ON wallets FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own wallet"
  ON wallets FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "System can insert wallets"
  ON wallets FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Transactions
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transactions"
  ON transactions FOR SELECT 
  USING (wallet_id IN (SELECT id FROM wallets WHERE user_id = auth.uid()));

-- Oaths
ALTER TABLE oaths ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active oaths are viewable by participants"
  ON oaths FOR SELECT USING (
    creator_id = auth.uid() 
    OR opponent_id = auth.uid()
    OR id IN (SELECT oath_id FROM group_members WHERE user_id = auth.uid())
    OR status IN ('active', 'completed', 'failed')
  );

CREATE POLICY "Users can create oaths"
  ON oaths FOR INSERT WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Creators can update own oaths"
  ON oaths FOR UPDATE USING (auth.uid() = creator_id);

-- Nominees
ALTER TABLE nominees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Nominees viewable by oath creator and via token"
  ON nominees FOR SELECT USING (
    oath_id IN (SELECT id FROM oaths WHERE creator_id = auth.uid())
    OR true -- public verification links
  );

CREATE POLICY "Oath creators can add nominees"
  ON nominees FOR INSERT WITH CHECK (
    oath_id IN (SELECT id FROM oaths WHERE creator_id = auth.uid())
  );

CREATE POLICY "Anyone can update nominee verdict via token"
  ON nominees FOR UPDATE USING (true);

-- Group Members
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Group members are viewable by group participants"
  ON group_members FOR SELECT USING (
    user_id = auth.uid()
    OR oath_id IN (SELECT oath_id FROM group_members gm WHERE gm.user_id = auth.uid())
  );

CREATE POLICY "Users can join groups"
  ON group_members FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own membership"
  ON group_members FOR UPDATE USING (auth.uid() = user_id);

-- Proofs
ALTER TABLE proofs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Proofs viewable by oath participants"
  ON proofs FOR SELECT USING (
    submitted_by = auth.uid()
    OR oath_id IN (SELECT id FROM oaths WHERE creator_id = auth.uid() OR opponent_id = auth.uid())
    OR oath_id IN (SELECT oath_id FROM group_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can submit proofs"
  ON proofs FOR INSERT WITH CHECK (auth.uid() = submitted_by);

-- Votes
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Votes viewable by squad members"
  ON votes FOR SELECT USING (
    voter_id = auth.uid()
    OR oath_id IN (SELECT oath_id FROM group_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Squad members can vote"
  ON votes FOR INSERT WITH CHECK (
    auth.uid() = voter_id
    AND oath_id IN (SELECT oath_id FROM group_members WHERE user_id = auth.uid())
  );

-- Wall Entries
ALTER TABLE wall_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Wall entries are public"
  ON wall_entries FOR SELECT USING (true);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-create wallet on profile creation
CREATE OR REPLACE FUNCTION create_wallet_for_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO wallets (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_profile_created
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION create_wallet_for_user();

-- Auto-create profile on auth signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, username, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || LEFT(NEW.id::text, 8)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', 'Anonymous'),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_timestamp
  BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_wallets_timestamp
  BEFORE UPDATE ON wallets FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_oaths_timestamp
  BEFORE UPDATE ON oaths FOR EACH ROW EXECUTE FUNCTION update_updated_at();
