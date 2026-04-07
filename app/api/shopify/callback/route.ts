import { NextRequest, NextResponse } from "next/server";

import { verifyShopifyOAuthHmac, normalizeShopDomain } from "@/lib/shopify/admin";
import { requireShopifyEnv, setShopAccessToken } from "@/lib/shopify/shopStore";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const apiKey = requireShopifyEnv("SHOPIFY_API_KEY");
    const apiSecret = requireShopifyEnv("SHOPIFY_API_SECRET");

    const shop = normalizeShopDomain(request.nextUrl.searchParams.get("shop") ?? "");
    const code = request.nextUrl.searchParams.get("code") ?? "";
    const state = request.nextUrl.searchParams.get("state") ?? "";

    if (!code) {
      return NextResponse.json({ error: "Missing code" }, { status: 400 });
    }

    const stateCookie = request.cookies.get("shopify_oauth_state")?.value;
    if (!stateCookie || !state || stateCookie !== state) {
      return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
    }

    if (!verifyShopifyOAuthHmac(request.nextUrl.searchParams, apiSecret)) {
      return NextResponse.json({ error: "Invalid HMAC" }, { status: 401 });
    }

    const tokenUrl = `https://${shop}/admin/oauth/access_token`;
    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: apiKey, client_secret: apiSecret, code }),
    });

    const tokenText = await tokenResponse.text();
    if (!tokenResponse.ok) {
      return NextResponse.json(
        { error: `Token exchange failed (${tokenResponse.status}): ${tokenText}` },
        { status: 502 },
      );
    }

    const tokenJson = JSON.parse(tokenText) as { access_token?: string };
    if (!tokenJson.access_token) {
      return NextResponse.json({ error: "Missing access_token" }, { status: 502 });
    }

    await setShopAccessToken(shop, tokenJson.access_token);

    const appUrl = process.env.SHOPIFY_APP_URL ?? request.nextUrl.origin;
    const payExample = new URL("/pay/ORDER_ID?shop=" + encodeURIComponent(shop), appUrl).toString();

    return new NextResponse(
      `<!doctype html><html><head><meta charset="utf-8"><title>HTN Gateway Installed</title></head><body style="font-family: system-ui; padding: 24px;">
        <h1>HTN Gateway installed</h1>
        <p>Shop: <code>${shop}</code></p>
        <p>Next step: set your Shopify manual payment method instructions to link customers to:</p>
        <pre style="background:#f6f8fa;padding:12px;border-radius:8px;overflow:auto;">${payExample}</pre>
      </body></html>`,
      {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message ?? "Shopify callback failed" }, { status: 400 });
  }
}
