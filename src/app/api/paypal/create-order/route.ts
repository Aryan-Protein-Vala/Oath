import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { amount, currency } = await request.json();

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    // In a real app, you would call the PayPal REST API to create an order here:
    // const response = await fetch("https://api-m.sandbox.paypal.com/v2/checkout/orders", { ... })
    // For now, we simulate the order creation with a mock ID
    const mockOrderId = `PAYPAL_MOCK_ORDER_${Date.now()}`;

    return NextResponse.json({
      id: mockOrderId,
      amount: amount,
      currency: currency || "USD",
    });
  } catch (error: unknown) {
    console.error("PayPal Order creation failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
