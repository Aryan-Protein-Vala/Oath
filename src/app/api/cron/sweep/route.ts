import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    // Vercel Cron must be configured with a secret. A signed-in administrator
    // may also trigger a manual sweep from the protected admin dashboard.
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    let authorized = Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);

    if (!authorized && authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const requester = await createServerSupabaseClient(token);
      const { data: { user } } = await requester.auth.getUser(token);
      if (user) {
        const { data: isAdmin } = await requester.rpc("is_admin");
        authorized = isAdmin === true;
      }
    }
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: "Supabase configuration missing on server" },
        { status: 500 }
      );
    }

    // 2. Initialize Supabase Client
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // 3. Trigger auto_resolve_ghosted_proofs()
    // Resolves proofs where review_deadline < now() and executes brutal peer forfeiture
    const { data: resolvedCount, error: rpcError } = await supabase.rpc(
      "auto_resolve_ghosted_proofs"
    );

    if (rpcError) {
      console.error("[CRON] Error executing auto_resolve_ghosted_proofs:", rpcError);
      return NextResponse.json(
        {
          error: "Failed to execute auto_resolve_ghosted_proofs",
        },
        { status: 500 }
      );
    }

    // 4. Trigger auto_resolve_expired_oaths()
    // Resolves oaths where deadline < now() and user NEVER submitted any proof
    const { data: expiredCount, error: expiredError } = await supabase.rpc(
      "auto_resolve_expired_oaths"
    );

    if (expiredError) {
      console.error("[CRON] Error executing auto_resolve_expired_oaths:", expiredError);
      return NextResponse.json(
        {
          error: "Failed to execute auto_resolve_expired_oaths",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      resolved_ghosted_proofs: resolvedCount ?? 0,
      resolved_expired_oaths: expiredCount ?? 0,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    console.error("[CRON] Unexpected error in /api/cron/sweep:", err);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
