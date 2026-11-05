import { NextResponse } from "next/server";
import { createPayPalOrder } from "@/lib/paypal";
import { createAdminClient, createServerSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const { amount, currency = "USD" } = await request.json();
    const normalizedCurrency = String(currency).toUpperCase();

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }
    if (!Number.isInteger(numericAmount * 100) || numericAmount > 50000) {
      return NextResponse.json({ error: "Amount exceeds maximum deposit limit" }, { status: 400 });
    }
    if (normalizedCurrency !== "USD") {
      return NextResponse.json({ error: "PayPal deposits support USD only" }, { status: 400 });
    }

    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    const supabase = await createServerSupabaseClient(token);
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized. Sign in to deposit funds." }, { status: 401 });
    }

    const order = await createPayPalOrder(numericAmount, normalizedCurrency, "OATH Wallet Deposit");
    if (!order.id) {
      throw new Error("PayPal did not return an order identifier");
    }

    const admin = createAdminClient();
    const { error: orderError } = await admin.from("payment_orders").insert({
      provider: "paypal",
      provider_order_id: order.id,
      user_id: user.id,
      gateway_amount: numericAmount,
      wallet_amount: numericAmount,
      currency: normalizedCurrency,
    });
    if (orderError) {
      console.error("Could not persist PayPal order:", orderError);
      throw new Error("Could not prepare the payment securely. Please try again.");
    }

    const approveLink = order.links?.find((l: { rel: string; href: string }) => l.rel === "approve");

    return NextResponse.json({
      id: order.id,
      status: order.status,
      links: order.links,
      approveUrl: approveLink ? approveLink.href : null,
      amount: numericAmount,
      currency: normalizedCurrency,
    });
  } catch (error: unknown) {
    console.error("PayPal Order creation failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
