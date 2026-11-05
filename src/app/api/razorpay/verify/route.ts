import { NextResponse } from "next/server";
import crypto from "crypto";
import Razorpay from "razorpay";
import { createServerSupabaseClient, createAdminClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const body = await request.json();
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json({ error: "Missing required payment fields" }, { status: 400 });
    }

    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    const supabase = await createServerSupabaseClient(token);
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (typeof razorpay_order_id !== "string" || razorpay_order_id.startsWith("order_mock_")) {
      return NextResponse.json({ error: "Invalid Razorpay order" }, { status: 400 });
    }

    if (!keySecret) {
      return NextResponse.json({ error: "Razorpay secret key not configured on server" }, { status: 500 });
    }

    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac("sha256", keySecret)
      .update(sign.toString())
      .digest("hex");

    const expectedBuffer = Buffer.from(expectedSign, "utf8");
    const signatureBuffer = Buffer.from(razorpay_signature, "utf8");

    if (
      expectedBuffer.length !== signatureBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
    ) {
      return NextResponse.json({ error: "Invalid payment signature" }, { status: 400 });
    }

    const supabaseAdmin = createAdminClient();
    const { data: recordedOrder, error: recordedOrderError } = await supabaseAdmin
      .from("payment_orders")
      .select("gateway_amount, currency, status, provider_payment_id")
      .eq("provider", "razorpay")
      .eq("provider_order_id", razorpay_order_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (recordedOrderError || !recordedOrder) {
      return NextResponse.json({ error: "Unknown payment order" }, { status: 404 });
    }
    if (recordedOrder.status === "credited") {
      return NextResponse.json({ success: true, already_credited: true });
    }

    const razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID!, key_secret: keySecret });
    let payment = await razorpay.payments.fetch(razorpay_payment_id);
    const expectedMinorAmount = Math.round(Number(recordedOrder.gateway_amount) * 100);
    if (
      payment.order_id !== razorpay_order_id ||
      payment.currency !== recordedOrder.currency ||
      Number(payment.amount) !== expectedMinorAmount
    ) {
      return NextResponse.json({ error: "Verified payment does not match this order" }, { status: 400 });
    }
    if (payment.status === "authorized") {
      payment = await razorpay.payments.capture(razorpay_payment_id, expectedMinorAmount, recordedOrder.currency);
    }
    if (payment.status !== "captured") {
      return NextResponse.json({ error: "Payment has not been captured" }, { status: 400 });
    }

    const { data: creditResult, error: creditError } = await supabaseAdmin.rpc("credit_verified_payment", {
      p_provider: "razorpay",
      p_provider_order_id: razorpay_order_id,
      p_provider_payment_id: razorpay_payment_id,
      p_user_id: user.id,
      p_gateway_amount: Number(recordedOrder.gateway_amount),
      p_currency: recordedOrder.currency,
    });
    if (creditError) {
      console.error("Failed to credit wallet after verified payment:", creditError);
      return NextResponse.json({ error: "Failed to credit wallet" }, { status: 500 });
    }

    return NextResponse.json({ success: true, already_credited: creditResult?.already_credited ?? false });
  } catch (error: unknown) {
    console.error("Razorpay verification failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
