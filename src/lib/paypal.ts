export function getPayPalApiBaseUrl(): string {
  return process.env.PAYPAL_MODE === "sandbox"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";
}

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getPayPalAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;

  if (!clientId || !secret) {
    throw new Error("Missing PayPal API credentials");
  }

  const auth = Buffer.from(`${clientId}:${secret}`).toString("base64");
  const baseUrl = getPayPalApiBaseUrl();

  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("PayPal token error:", errorText);
    throw new Error(`Failed to obtain PayPal access token: ${response.statusText}`);
  }

  const data = await response.json();
  const token = data.access_token;
  const expiresIn = (data.expires_in || 3600) - 60;
  cachedToken = { token, expiresAt: Date.now() + expiresIn * 1000 };

  return token;
}

export async function createPayPalOrder(
  amount: number,
  currency: string = "USD",
  description: string = "OATH Wallet Deposit",
  origin?: string
) {
  const token = await getPayPalAccessToken();
  const baseUrl = getPayPalApiBaseUrl();
  const appUrl = origin || process.env.NEXT_PUBLIC_APP_URL || "https://oath-phi.vercel.app";

  const response = await fetch(`${baseUrl}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: currency,
            value: amount.toFixed(2),
          },
          description,
        },
      ],
      application_context: {
        brand_name: "OATH",
        landing_page: "NO_PREFERENCE",
        user_action: "PAY_NOW",
        return_url: `${appUrl}/api/paypal/capture`,
        cancel_url: `${appUrl}`,
      },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || data.details?.[0]?.description || "Failed to create PayPal order");
  }

  return data;
}

export async function capturePayPalOrder(orderId: string) {
  const token = await getPayPalAccessToken();
  const baseUrl = getPayPalApiBaseUrl();

  const response = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const data = await response.json();
  if (!response.ok) {
    // If order is already captured, fetch order status
    if (data.name === "UNPROCESSABLE_ENTITY" && data.details?.[0]?.issue === "ORDER_ALREADY_CAPTURED") {
      return getPayPalOrder(orderId);
    }
    throw new Error(data.message || data.details?.[0]?.description || "Failed to capture PayPal order");
  }

  return data;
}

export async function getPayPalOrder(orderId: string) {
  const token = await getPayPalAccessToken();
  const baseUrl = getPayPalApiBaseUrl();

  const response = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Failed to fetch PayPal order");
  }

  return data;
}
