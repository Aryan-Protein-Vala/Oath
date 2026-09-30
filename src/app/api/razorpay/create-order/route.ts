import { NextResponse } from "next/server";
import Razorpay from "razorpay";

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

    if (!keyId || !keySecret) {
      // Return a simulated mock order for safe testing if keys are missing
      return NextResponse.json({
        id: `order_mock_${Date.now()}`,
        entity: "order",
        amount: Math.round(numericAmount * 100),
        currency,
        receipt: `receipt_${Date.now()}`,
        status: "created",
        is_mock: true,
      });
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
