### Creative Consequences Matrix

Financial stakes work, but psychological friction—reputation, digital isolation, and physical labor—hits harder when money alone does not motivate.

| Mode | Consequence Category | Specific Consequence Mechanic | How It Triggers | Psychological Leverage |
| --- | --- | --- | --- | --- |
| **Solo** *(vs House)* | **Social Ransom** | **The Scheduled Confession:** User writes an embarrassing confession and enters an adversarial contact's phone number (ex, strict parent, boss). | Backend fires SMS via Twilio at deadline if proof is missing. | Pure social panic; loss of reputation. |
| **Solo** *(vs House)* | **Digital Lockout** | **7-Day Blackout:** Complete blocking of Instagram, YouTube, TikTok, or Reddit. | Native app flips local OS profile restriction. | Dopamine withdrawal; forced focus. |
| **Solo** *(vs House)* | **Anti-Charity Donation** | User picks a cause or political ideology they despise. Failing forfeits stake directly to that entity. | Automated payment webhook charges card/wallet to anti-charity. | Ideological pain; users prefer losing money to anything else. |
| **Solo** *(vs House)* | **Public Humiliation** | **Wall of Shame Broadcast:** Automated posting of the user's headshot, missed task, and excuse to the public feed. | Server marks task failed ➔ creates public record in app feed. | Ego destruction; public exposure. |
| **Duo** *(vs Mate)* | **Bounty Transfer** | **Direct Bounty:** $20 or ₹500 transfers directly to the friend's account upon failure. | Wallet ledger debits loser, credits winner (minus 10% platform fee). | Spite; refusing to let a rival benefit from laziness. |
| **Duo** *(vs Mate)* | **Physical Debt** | **The Servant Clause:** Missed workout requires completing 100 burpees on video or buying the winner's meals for a week. | Winner reviews debt fulfillment inside the app before unfreezing account. | Immediate physical fatigue / direct submission. |
| **Duo** *(vs Mate)* | **Mutual Assured Destruction (MAD)** | Both deposit stakes. If **either** fails, the house seizes 100% of both deposits. | Escrow pool liquidates both balances to the house. | Extreme peer pressure; neither wants to be the traitor. |
| **Squad** *(Group Pool)* | **The Deadweight Tag** | User who breaks the squad's collective streak is publicly tagged with a "Deadweight" badge in the squad log. | Automated flag assigned on failure; visible in group interface. | Tribe rejection; fear of letting down the group. |
| **Squad** *(Group Pool)* | **The Bounty Split** | 5 to 8 members buy in. Losers forfeit their buy-in; total pot is distributed equally among finishers (minus 10%). | Smart split executed on server upon contract expiration. | High viral incentive; financial upside for disciplined members. |
| **Squad** *(Group Pool)* | **Squad Lockdown** | If any squad member fails their daily target, all squad members have their recreation apps blocked for 24 hours. | Group trigger broadcasts local block instruction to all enrolled devices. | Collective responsibility; peer policing. |

---

### Proof & Verification Mechanisms

Verification must cost near zero to operate at scale while preventing fraud.

```text
PROOFS ARCHITECTURE
├── 1. Solo Verification
│   ├── Programmatic (Free): GPS radius check / HealthKit step/workout sync
│   ├── Nominee Link (Zero-Cost): Webhook sends magic link to a friend to tap "Pass" or "Fail"
│   └── Solo Lonely Review: Async queue for user uploads (Batch-processed or community audits)
│
├── 2. Duo Verification
│   ├── Direct Rival Confirmation: Opponent approves/rejects video proof inside app
│   └── Dispute Escalation: If rival maliciously rejects, routed to peer tribunal
│
└── 3. Squad Verification
    ├── Quorum Voting: Video/photo drops into feed; requires >50% majority approval within 60 min
    └── Silent Pass: If no objections are raised within 2 hours, proof auto-clears

```

| Verification Method | Suitable Modes | How It Works | Operating Cost to You | Fraud Vector & Mitigation |
| --- | --- | --- | --- | --- |
| **Nominee Magic Link** | Solo / Duo | App texts/emails a one-time URL to a chosen referee. Referee clicks Pass/Fail without needing the app. | Near zero (SMS API cost only, or free via WhatsApp/Email). | Friends lie for friends. Mitigation: Acceptable for casual stakes; prohibited for public high-stakes pools. |
| **Quorum Voting** | Squad Pools | User posts a 5-second video/photo. Squad members have 60 minutes to vote "Accept" or "Fraud". | Zero (Peer-validated). | Sybil attacks / cartels. Mitigation: Strangers are algorithmically randomized into lobbies; no custom invites in competitive pools. |
| **GPS Geo-Fencing** | Solo / Duo / Squad | User must physically ping within 50 meters of registered gym/office coordinates for at least 45 minutes. | Zero (Device GPS API). | Location spoofers. Mitigation: Require live device altitude + network BSSID validation on native OS. |
| **OS Activity Sync** | Solo | Native HealthKit / Google Health Connect integration to check active calories, heart rate spike, or workout logs. | Zero (Local device APIs). | Manual entry abuse in Apple Health. Mitigation: Only read cryptographically signed workout records from verified hardware. |
| **Time-Lapse Video** | Solo Lonely | High-speed 10-second compressed time-lapse showing completion of a work block or reading session. | Marginal (S3 storage + CDN). | Pre-recorded video uploads. Mitigation: Disable gallery uploads; camera must record live directly inside the app shell. |

---

### Platform Capability: Mobile vs. Browser

Web applications are strictly sandboxed by browser security models. Native applications are required for OS-level control.

| Capability / Feature | Web App (Desktop / Mobile Browser / PWA) | Native Android (Kotlin / React Native) | Native iOS (Swift / React Native) | Execution Strategy |
| --- | --- | --- | --- | --- |
| **App Blocking (Instagram, etc.)** | **Impossible** | **Yes** (UsageStatsManager + Accessibility Service) | **Yes** (Screen Time API / ManagedSettings) | Blocked on Web. Show toast: *"Mobile app required for digital lockouts."* |
| **Apple Health / Google Fit** | **Impossible** (No Web API access) | **Yes** (Health Connect API) | **Yes** (HealthKit SDK) | Web accepts manual proof; Native auto-syncs. |
| **Live Camera Enforcement** | Partial (HTML5 input allows camera, but users can bypass on desktop) | **Full Control** (CameraX API prevents gallery injection) | **Full Control** (AVFoundation prevents gallery injection) | Force live capture; reject pre-recorded gallery files on native. |
| **Background Location / Geo-fence** | **Impossible** (Requires active open tab) | **Yes** (GeofencingClient runs continuously) | **Yes** (CoreLocation background monitoring) | Web requires manual check-in button; Native auto-detects arrival. |
| **SMS / Social Ransom** | **Yes** (Backend triggers Twilio API) | **Yes** (Backend triggers Twilio API) | **Yes** (Backend triggers Twilio API) | Platform agnostic (handled entirely on your server). |
| **Group Quorum & Voting** | **Yes** (Real-time WebSockets / Supabase) | **Yes** | **Yes** | Full feature parity across all platforms. |
| **Escrow Payments & Wallets** | **Yes** (Standard Razorpay / Stripe gateway) | **Yes** (Native SDK or Webview checkout) | **High Risk** (Apple requires In-App Purchase 30% cut if flagged) | Route all wallet deposits through a responsive Web checkout to protect margins. |

```text
PLATFORM BOUNDARY
┌────────────────────────────────────────────────────────────┐
│                        WEB APP                             │
│  - Financial Escrow & Deposits                             │
│  - Squad Matchmaking & Voting Feeds                        │
│  - Social Ransom (SMS Gateway)                             │
│  - Nominee Web Portal                                      │
└─────────────────────────────┬──────────────────────────────┘
                              │ Requires OS Privileges
                              ▼
┌────────────────────────────────────────────────────────────┐
│                   NATIVE OS (ANDROID / iOS)                │
│  - App Blocking (Screen Time / Accessibility)               │
│  - Background GPS Geofencing                               │
│  - Biometric Sync (HealthKit / Health Connect)             │
│  - Secure Camera Capture (Anti-Spoof)                      │
└────────────────────────────────────────────────────────────┘

```