import { NextResponse } from "next/server";
import crypto from "crypto";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const body = await request.json();
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json({ error: "Missing required payment fields" }, { status: 400 });
    }

    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    const supabase = await createServerSupabaseClient(token);
    const { data: { user } } = await supabase.auth.getUser(token);

    // Support mock order verification when testing in development or mock mode
    if (typeof razorpay_order_id === "string" && razorpay_order_id.startsWith("order_mock_")) {
      if (user && amount && Number(amount) > 0) {
        await supabase.rpc("add_funds", {
          p_amount: Number(amount),
          p_description: "Deposited funds (Demo Mode)"
        });
      }
      return NextResponse.json({ success: true, is_mock: true });
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

    // Credit verified deposit on server if amount and user are present
    if (user && amount && Number(amount) > 0) {
      const { error: depositError } = await supabase.rpc("add_funds", {
        p_amount: Number(amount),
        p_description: `Deposited funds via Razorpay (${razorpay_payment_id})`
      });
      if (depositError) {
        console.error("Failed to credit wallet after verified payment:", depositError);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Razorpay verification failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
