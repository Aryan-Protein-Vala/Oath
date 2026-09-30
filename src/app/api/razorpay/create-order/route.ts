import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const ALLOWED_CURRENCIES = ["INR", "USD"];
const MAX_DEPOSIT_INR = 500000;
const MAX_DEPOSIT_USD = 10000;

export async function POST(request: Request) {
  try {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    const body = await request.json();
    const { amount, currency = "INR" } = body;

    const numericAmount = Number(amount);
    if (!numericAmount || isNaN(numericAmount) || numericAmount <= 0) {
      return NextResponse.json({ error: "A valid positive amount is required" }, { status: 400 });
    }

    if (!ALLOWED_CURRENCIES.includes(currency.toUpperCase())) {
      return NextResponse.json({ error: "Unsupported currency" }, { status: 400 });
    }

    const maxLimit = currency.toUpperCase() === "INR" ? MAX_DEPOSIT_INR : MAX_DEPOSIT_USD;
    if (numericAmount > maxLimit) {
      return NextResponse.json({ error: `Deposit exceeds maximum limit of ${maxLimit} ${currency}` }, { status: 400 });
    }

    if (!keyId || !keySecret) {
      // Return a simulated mock order for safe testing if keys are missing
      return NextResponse.json({
        id: `order_mock_${Date.now()}`,
        entity: "order",
        amount: Math.round(numericAmount * 100),
        currency: currency.toUpperCase(),
        receipt: `receipt_${Date.now()}`,
        status: "created",
        is_mock: true,
      });
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized. Sign in to deposit funds." }, { status: 401 });
    }

    const razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });

    const options = {
      amount: Math.round(numericAmount * 100), // amount in paise
      currency,
      receipt: `receipt_${Date.now()}`,
    };

    const order = await razorpay.orders.create(options);
    return NextResponse.json(order);
  } catch (error: unknown) {
    console.error("Razorpay order creation failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
