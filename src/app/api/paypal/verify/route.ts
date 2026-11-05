import { NextResponse } from "next/server";
import { createServerSupabaseClient, createAdminClient } from "@/lib/supabase/server";
import { capturePayPalOrder } from "@/lib/paypal";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { paypal_order_id } = body;

    if (!paypal_order_id) {
      return NextResponse.json({ error: "Missing required payment fields" }, { status: 400 });
    }

    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    const supabase = await createServerSupabaseClient(token);
    const { data: { user } } = await supabase.auth.getUser(token);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (typeof paypal_order_id !== "string" || paypal_order_id.startsWith("PAYPAL_MOCK_ORDER_")) {
      return NextResponse.json({ error: "Invalid PayPal order" }, { status: 400 });
    }

    const supabaseAdmin = createAdminClient();
    const { data: recordedOrder, error: recordedOrderError } = await supabaseAdmin
      .from("payment_orders")
      .select("provider_order_id, provider_payment_id, status")
      .eq("provider", "paypal")
      .eq("provider_order_id", paypal_order_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (recordedOrderError || !recordedOrder) {
      return NextResponse.json({ error: "Unknown payment order" }, { status: 404 });
    }
    if (recordedOrder.status === "credited") {
      return NextResponse.json({ success: true, already_credited: true, captureId: recordedOrder.provider_payment_id });
    }

    // Capture the real PayPal order
    const captureData = await capturePayPalOrder(paypal_order_id);

    // Verify order is COMPLETED
    if (captureData.status !== "COMPLETED") {
      return NextResponse.json({
        error: `PayPal order not completed. Current status: ${captureData.status}`
      }, { status: 400 });
    }

    // Extract captured amount from purchase units
    interface PayPalPurchaseUnit {
      payments?: {
        captures?: Array<{
          id: string;
          amount?: {
            value: string;
            currency_code: string;
          };
        }>;
      };
    }
    const purchaseUnit = captureData.purchase_units?.[0] as PayPalPurchaseUnit | undefined;
    const captureObj = purchaseUnit?.payments?.captures?.[0];
    const capturedValue = captureObj?.amount?.value ? Number(captureObj.amount.value) : NaN;
    const capturedCurrency = captureObj?.amount?.currency_code;

    if (capturedCurrency !== "USD") {
      return NextResponse.json({ error: `Unsupported currency: ${capturedCurrency}` }, { status: 400 });
    }

    if (!Number.isFinite(capturedValue) || capturedValue <= 0) {
      return NextResponse.json({ error: "Invalid capture amount" }, { status: 400 });
    }

    const captureId = captureObj?.id || paypal_order_id;
    const { data: creditResult, error: creditError } = await supabaseAdmin.rpc("credit_verified_payment", {
      p_provider: "paypal",
      p_provider_order_id: paypal_order_id,
      p_provider_payment_id: captureId,
      p_user_id: user.id,
      p_gateway_amount: capturedValue,
      p_currency: capturedCurrency,
    });

    if (creditError) {
      console.error("Failed to credit wallet after verified PayPal payment:", creditError);
      return NextResponse.json({ error: "Failed to credit wallet" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      captureId,
      amount: creditResult?.wallet_amount,
      already_credited: creditResult?.already_credited ?? false,
      status: "COMPLETED"
    });
  } catch (error: unknown) {
    console.error("PayPal verification failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
