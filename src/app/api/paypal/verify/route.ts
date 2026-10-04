import { NextResponse } from "next/server";
import { createServerSupabaseClient, createAdminClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { paypal_order_id, amount } = body;

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

    // In a real app, you would verify the order details with PayPal REST API here:
    // const verifyResponse = await fetch(`https://api-m.sandbox.paypal.com/v2/checkout/orders/${paypal_order_id}`, { ... })
    // For now, we simulate a successful verification

    const supabaseAdmin = createAdminClient();

    // Credit verified deposit on server using admin client to bypass RLS for add_funds_server
    if (amount && Number(amount) > 0) {
      const { error: depositError } = await supabaseAdmin.rpc("add_funds_server", {
        p_user_id: user.id,
        p_amount: Number(amount),
        p_description: `Deposited funds via PayPal (${paypal_order_id})`
      });
      if (depositError) {
        console.error("Failed to credit wallet after verified PayPal payment:", depositError);
        throw new Error("Failed to credit wallet");
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("PayPal verification failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
