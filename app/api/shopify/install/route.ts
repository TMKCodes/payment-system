import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { requireShopifyEnv } from "@/lib/shopify/shopStore";
import { normalizeShopDomain } from "@/lib/shopify/admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const apiKey = requireShopifyEnv("SHOPIFY_API_KEY");
    const appUrl = requireShopifyEnv("SHOPIFY_APP_URL");
    const scopes = process.env.SHOPIFY_SCOPES ?? "read_orders,write_orders";

    const shopParam = request.nextUrl.searchParams.get("shop") ?? "";
    const shop = normalizeShopDomain(shopParam);

    const state = crypto.randomBytes(16).toString("hex");

    const redirectUri = new URL("/api/shopify/callback", appUrl).toString();
    const installUrl = new URL(`https://${shop}/admin/oauth/authorize`);
    installUrl.searchParams.set("client_id", apiKey);
    installUrl.searchParams.set("scope", scopes);
    installUrl.searchParams.set("redirect_uri", redirectUri);
    installUrl.searchParams.set("state", state);

    const response = NextResponse.redirect(installUrl.toString());
    response.cookies.set("shopify_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: appUrl.startsWith("https://"),
      path: "/",
      maxAge: 10 * 60,
    });

    return response;
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message ?? "Failed to start Shopify install" }, { status: 400 });
  }
}
