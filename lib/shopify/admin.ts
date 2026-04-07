import crypto from "crypto";

const DEFAULT_API_VERSION = "2025-01";

export function normalizeShopDomain(shop: string): string {
  const trimmed = shop.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/.test(trimmed)) {
    throw new Error("Invalid shop domain");
  }
  return trimmed;
}

export function verifyShopifyOAuthHmac(params: URLSearchParams, apiSecret: string): boolean {
  const provided = params.get("hmac");
  if (!provided) return false;

  const pairs: Array<[string, string]> = [];
  for (const [key, value] of params.entries()) {
    if (key === "hmac" || key === "signature") continue;
    pairs.push([key, value]);
  }
  pairs.sort(([a], [b]) => a.localeCompare(b));

  const message = pairs.map(([k, v]) => `${k}=${v}`).join("&");
  const digest = crypto.createHmac("sha256", apiSecret).update(message).digest("hex");

  // timing-safe compare
  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function verifyShopifyWebhookHmac(rawBody: string, hmacBase64: string | null, apiSecret: string): boolean {
  if (!hmacBase64) return false;
  const digest = crypto.createHmac("sha256", apiSecret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(hmacBase64, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function shopifyGraphql<T>(opts: {
  shop: string;
  accessToken: string;
  query: string;
  variables?: Record<string, unknown>;
}): Promise<T> {
  const apiVersion = process.env.SHOPIFY_API_VERSION ?? DEFAULT_API_VERSION;
  const url = `https://${opts.shop}/admin/api/${apiVersion}/graphql.json`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": opts.accessToken,
    },
    body: JSON.stringify({ query: opts.query, variables: opts.variables ?? {} }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Shopify GraphQL request failed (${response.status}): ${text}`);
  }

  const json = JSON.parse(text) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }

  if (!json.data) {
    throw new Error("Missing GraphQL data");
  }

  return json.data;
}
