import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

const getPayPalUrl = () => {
  return process.env.PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
};

async function getAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;
  if (!clientId || !secret) {
    throw new Error("PayPal credentials missing");
  }

  const auth = Buffer.from(`${clientId}:${secret}`).toString("base64");
  const response = await fetch(`${getPayPalUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Failed to get PayPal access token: ${errorData}`);
  }

  const data = await response.json();
  return data.access_token;
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (!user || authError) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in to withdraw funds." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { amount, currency = "USD", receiverEmail } = body;

    const numericAmount = Number(amount);
    if (!numericAmount || isNaN(numericAmount) || numericAmount <= 0) {
      return NextResponse.json({ error: "A valid positive amount is required" }, { status: 400 });
    }

    if (!receiverEmail || !receiverEmail.includes("@")) {
      return NextResponse.json({ error: "A valid PayPal receiver email is required" }, { status: 400 });
    }

    // 1. Deduct from user's wallet via atomic SECURITY DEFINER RPC
    const destination = `PayPal (${receiverEmail})`;
    const { error: withdrawError } = await supabase.rpc("withdraw_funds", {
      p_amount: numericAmount,
      p_destination: destination,
    });

    if (withdrawError) {
      return NextResponse.json(
        { error: withdrawError.message || "Insufficient funds" },
        { status: 400 }
      );
    }

    // 2. Execute PayPal Payout
    let data;
    try {
      const accessToken = await getAccessToken();

      const payoutBody = {
        sender_batch_header: {
          sender_batch_id: `Payouts_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          email_subject: "You have a payout from OATH!",
          email_message: "Here are your withdrawn funds from OATH. Stay true.",
        },
        items: [
          {
            recipient_type: "EMAIL",
            amount: {
              value: numericAmount.toFixed(2),
              currency: currency,
            },
            note: "Withdrawal from OATH",
            sender_item_id: `item_${Date.now()}`,
            receiver: receiverEmail,
          },
        ],
      };

      const payoutResponse = await fetch(`${getPayPalUrl()}/v1/payments/payouts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payoutBody),
      });

      data = await payoutResponse.json();

      if (!payoutResponse.ok) {
        console.error("PayPal Payout API Error:", data);
        throw new Error(data.message || data.name || "Failed to process PayPal payout");
      }
    } catch (payoutError) {
      // Revert wallet deduction if PayPal payout fails
      console.error("PayPal transfer failed, reverting wallet deduction:", payoutError);
      
      const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );
      
      await supabaseAdmin.rpc("add_funds_server", { 
        p_user_id: user.id,
        p_amount: numericAmount, 
        p_description: "Refund: Failed PayPal withdrawal" 
      });
      throw payoutError;
    }

    return NextResponse.json({ success: true, batch_id: data?.batch_header?.payout_batch_id });
  } catch (error: unknown) {
    console.error("PayPal payout failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
