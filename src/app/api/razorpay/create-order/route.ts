import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import { randomUUID } from "crypto";
import { createAdminClient, createServerSupabaseClient } from "@/lib/supabase/server";

const ALLOWED_CURRENCIES = ["INR"];
const MAX_DEPOSIT_INR = 500000;
const INR_PER_USD = 90;

export async function POST(request: Request) {
  try {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    const supabase = await createServerSupabaseClient(token);
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized. Sign in to deposit funds." }, { status: 401 });
    }

    const body = await request.json();
    const { amount, currency = "INR" } = body;
    const normalizedCurrency = String(currency).toUpperCase();

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !Number.isInteger(numericAmount * 100)) {
      return NextResponse.json({ error: "A valid positive amount is required" }, { status: 400 });
    }

    if (!ALLOWED_CURRENCIES.includes(normalizedCurrency)) {
      return NextResponse.json({ error: "Unsupported currency" }, { status: 400 });
    }

    if (numericAmount > MAX_DEPOSIT_INR) {
      return NextResponse.json({ error: `Deposit exceeds maximum limit of ${MAX_DEPOSIT_INR} INR` }, { status: 400 });
    }

    if (!keyId || !keySecret) {
      return NextResponse.json({ error: "Razorpay is not configured" }, { status: 503 });
    }

    const razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });

    const receipt = `oath_${randomUUID().replaceAll("-", "").slice(0, 30)}`;
    const options = {
      amount: Math.round(numericAmount * 100), // amount in paise
      currency: normalizedCurrency,
      receipt,
    };

    const order = await razorpay.orders.create(options);
    const walletAmount = Math.round((numericAmount / INR_PER_USD) * 100) / 100;
    const admin = createAdminClient();
    const { error: paymentOrderError } = await admin.from("payment_orders").insert({
      provider: "razorpay",
      provider_order_id: order.id,
      user_id: user.id,
      gateway_amount: numericAmount,
      wallet_amount: walletAmount,
      currency: normalizedCurrency,
    });
    if (paymentOrderError) {
      console.error("Could not persist Razorpay order:", paymentOrderError);
      throw new Error("Could not prepare the payment securely. Please try again.");
    }
    return NextResponse.json(order);
  } catch (error: unknown) {
    console.error("Razorpay order creation failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
