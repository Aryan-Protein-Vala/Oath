import { NextResponse } from "next/server";

// Withdrawals are deliberately handled as reviewed requests in the admin flow.
// This endpoint used to debit a wallet and send a payout without durable provider
// reconciliation, which could create duplicate payouts after a network timeout.
export async function POST() {
  return NextResponse.json(
    { error: "Automatic PayPal payouts are disabled. Submit a withdrawal request instead." },
    { status: 410 },
  );
}
