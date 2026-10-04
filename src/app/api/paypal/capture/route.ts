import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const token = searchParams.get("token"); // PayPal Order ID

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Payment Approved — OATH</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
          background: #09090b;
          color: #f4f4f5;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
          text-align: center;
        }
        .card {
          border: 2px solid #27272a;
          padding: 2rem;
          background: #18181b;
          max-width: 400px;
        }
        h2 { font-weight: 900; letter-spacing: -0.05em; text-transform: uppercase; margin-bottom: 0.5rem; }
        p { color: #a1a1aa; font-size: 0.875rem; font-family: monospace; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>Payment Approved</h2>
        <p>Finalizing your OATH deposit...</p>
      </div>
      <script>
        const orderId = "${token || ""}";
        if (window.opener) {
          window.opener.postMessage({ type: "PAYPAL_APPROVED", orderId: orderId }, "*");
          setTimeout(() => {
            window.close();
          }, 800);
        } else {
          window.location.href = "/?paypal_success=true&order_id=" + encodeURIComponent(orderId);
        }
      </script>
    </body>
    </html>
  `;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html",
    },
  });
}
