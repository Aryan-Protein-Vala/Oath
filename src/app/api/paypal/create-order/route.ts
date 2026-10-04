import { NextResponse } from "next/server";
import { createPayPalOrder } from "@/lib/paypal";

export async function POST(request: Request) {
  try {
    const { amount, currency = "USD" } = await request.json();

    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0 || isNaN(numericAmount)) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    if (numericAmount > 50000) {
      return NextResponse.json({ error: "Amount exceeds maximum deposit limit" }, { status: 400 });
    }

    // Create real PayPal order using PayPal REST API
    const order = await createPayPalOrder(numericAmount, currency, "OATH Wallet Deposit");

    const approveLink = order.links?.find((l: { rel: string; href: string }) => l.rel === "approve");

    return NextResponse.json({
      id: order.id,
      status: order.status,
      links: order.links,
      approveUrl: approveLink ? approveLink.href : null,
      amount: numericAmount,
      currency: currency || "USD",
    });
  } catch (error: unknown) {
    console.error("PayPal Order creation failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
