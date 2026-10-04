// ============================================================
// OATH — Type Definitions
// ============================================================

export type OathType = "solo" | "duo" | "squad" | "lobby";
export type OathStatus = "pending" | "active" | "completed" | "failed" | "disputed" | "cancelled";
export type VerificationMethod = "nominee" | "peer" | "quorum" | "app_blocking";
export type ConsequenceType = "fiat" | "social_ransom" | "app_blocking" | "combined" | "anti_charity" | "public_shame" | "shared_oath" | "physical_debt" | "mutual_destruction" | "deadweight_tag" | "squad_lockdown";
export type ProofStatus = "pending_review" | "verified" | "rejected" | "disputed" | "needs_more_proof";
export type ProofType = "photo" | "video" | "screenshot" | "link" | "text";
export type TransactionType = "deposit" | "withdrawal" | "escrow_lock" | "escrow_release" | "penalty" | "reward" | "house_cut";
export type WallType = "shame" | "honor";
export type GroupMode = "weakest_link" | "survival";

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  phone?: string;
  oaths_created: number;
  oaths_completed: number;
  oaths_failed: number;
  total_staked: number;
  total_lost: number;
  total_won: number;
  reputation_score: number;
  loss_streak: number;
  penalty_box_until?: string | null;
  created_at: string;
}

export interface Wallet {
  id: string;
  user_id: string;
  balance: number;
  escrow_locked: number;
  total_deposited: number;
  total_withdrawn: number;
  total_won?: number;
  total_lost?: number;
}

export interface Transaction {
  id: string;
  wallet_id: string;
  oath_id?: string;
  type: TransactionType;
  amount: number;
  description: string;
  created_at: string;
}

export interface Oath {
  id: string;
  creator_id: string;
  creator?: Profile;
  oath_statement: string;
  deadline: string;
  oath_type: OathType;
  verification_method: VerificationMethod;
  consequence_type: ConsequenceType;
  group_mode?: GroupMode;
  stake_amount: number;
  social_ransom_phone?: string;
  social_ransom_message?: string;
  nominee_email?: string;
  status: OathStatus;
  min_players: number;
  max_players: number;
  opponent_id?: string;
  opponent?: Profile;
  completed_at?: string;
  failed_at?: string;
  failure_excuse?: string;
  cadence?: string;
  total_days?: number;
  current_day?: number;
  current_streak?: number;
  daily_deadline?: string;
  created_at: string;
  updated_at: string;
  // Computed / UI-only
  time_remaining?: number;
  members?: GroupMember[];
  proofs?: Proof[];
  nominees?: Array<{ id: string; oath_id: string; email?: string; nominee_user_id?: string; verified: boolean; verification_token?: string }>;
}

export interface Nominee {
  id: string;
  oath_id: string;
  nominee_user_id?: string;
  name?: string;
  email?: string;
  phone?: string;
  verification_token: string;
  verified: boolean;
  verdict?: "success" | "penalty";
  verdict_note?: string;
  responded_at?: string;
  created_at: string;
}

export interface GroupMember {
  id: string;
  oath_id: string;
  user_id: string;
  user?: Profile;
  stake_amount: number;
  status: "invited" | "joined" | "completed" | "failed" | "eliminated";
  proof_submitted: boolean;
  votes_received: number;
  votes_needed: number;
  is_active_participant: boolean;
  voted_by?: string[];
  votes_rejected?: number;
  current_day?: number;
  day_streak?: number;
}

export interface Proof {
  id: string;
  oath_id: string;
  submitted_by: string;
  submitter?: Profile;
  proof_type: "photo" | "video" | "screenshot" | "link" | "text";
  proof_url?: string;
  proof_text?: string;
  status: ProofStatus;
  reviewer_id?: string;
  review_note?: string;
  reviewed_at?: string;
  review_deadline?: string;
  day_number?: number;
  created_at: string;
}

export interface Vote {
  id: string;
  proof_id: string;
  voter_id: string;
  oath_id: string;
  vote: boolean;
  created_at: string;
}

export interface WallEntry {
  id: string;
  oath_id: string;
  user_id: string;
  wall_type: WallType;
  oath_statement: string;
  stake_amount: number;
  excuse?: string;
  username: string;
  created_at: string;
}

// UI State types
export interface ToastMessage {
  id: string;
  message: string;
  type: "error" | "success" | "info";
  duration?: number;
}

export interface Message {
  id: string;
  oath_id: string;
  sender_id: string;
  content: string;
  type: "text" | "proof" | "system";
  proof_id?: string;
  created_at: string;
  sender?: Profile;
}

export interface Notification {
  id: string;
  user_id: string;
  type: "invite" | "invite_duo" | "invite_squad" | "invite_lobby" | "invite_nominee" | "verify_proof" | "system";
  title?: string;
  message?: string;
  oath_id?: string;
  proof_id?: string;
  actor_id?: string;
  status: "pending" | "accepted" | "rejected" | "read";
  created_at: string;
  actor?: Profile;
  oath?: Oath;
}

export interface AppState {
  currentView: "active" | "create" | "lobbies" | "wall_shame" | "wall_honor" | "verify";
  wallet: Wallet;
  activeOaths: Oath[];
  profile: Profile;
}

