import { NextResponse } from "next/server";

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
    const body = await request.json();
    const { amount, currency = "USD", receiverEmail } = body;

    const numericAmount = Number(amount);
    if (!numericAmount || isNaN(numericAmount) || numericAmount <= 0) {
      return NextResponse.json({ error: "A valid positive amount is required" }, { status: 400 });
    }

    if (!receiverEmail) {
      return NextResponse.json({ error: "PayPal receiver email is required" }, { status: 400 });
    }

    const accessToken = await getAccessToken();

    // PayPal Payouts request body
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
            value: numericAmount.toFixed(2), // PayPal requires exactly 2 decimal places usually
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

    const data = await payoutResponse.json();

    if (!payoutResponse.ok) {
      console.error("PayPal Payout Error:", data);
      throw new Error(data.message || data.name || "Failed to process PayPal payout");
    }

    return NextResponse.json({ success: true, batch_id: data.batch_header.payout_batch_id });
  } catch (error: unknown) {
    console.error("PayPal payout failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
