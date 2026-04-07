import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

type NotifyRequestBody = {
  callbackUrl?: string;
  orderId?: string;
  orderKey?: string;
  paymentSessionId?: string;
  amountHtn?: string;
  address?: string;
  paymentDetails?: unknown;
};

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

function parseAllowedOrigins(raw: string | undefined): Set<string> {
  if (!raw) return new Set();

  return new Set(
    raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map(normalizeOrigin),
  );
}

function isAllowedUrl(url: URL, allowedOrigins: Set<string>): boolean {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return false;
  }

  if (allowedOrigins.size === 0) {
    return false;
  }

  return allowedOrigins.has(normalizeOrigin(url.origin));
}

function hmacSha256Hex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

function safeCompareHex(a: string, b: string): boolean {
  try {
    const left = Buffer.from(a, "hex");
    const right = Buffer.from(b, "hex");
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.WOOCOMMERCE_SHARED_SECRET;
    const allowedOrigins = parseAllowedOrigins(process.env.WOOCOMMERCE_ALLOWED_ORIGINS);

    if (!secret) {
      return NextResponse.json({ error: "WOOCOMMERCE_SHARED_SECRET is not configured" }, { status: 500 });
    }

    const body = (await request.json()) as NotifyRequestBody;

    const callbackUrlRaw = body.callbackUrl;
    const orderId = body.orderId;
    const orderKey = body.orderKey;
    const paymentSessionId = body.paymentSessionId;
    const amountHtn = body.amountHtn;

    if (!callbackUrlRaw || typeof callbackUrlRaw !== "string") {
      return NextResponse.json({ error: "callbackUrl is required" }, { status: 400 });
    }
    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json({ error: "orderId is required" }, { status: 400 });
    }
    if (!orderKey || typeof orderKey !== "string") {
      return NextResponse.json({ error: "orderKey is required" }, { status: 400 });
    }
    if (!paymentSessionId || typeof paymentSessionId !== "string") {
      return NextResponse.json({ error: "paymentSessionId is required" }, { status: 400 });
    }
    if (!amountHtn || typeof amountHtn !== "string") {
      return NextResponse.json({ error: "amountHtn is required" }, { status: 400 });
    }

    let callbackUrl: URL;
    try {
      callbackUrl = new URL(callbackUrlRaw);
    } catch {
      return NextResponse.json({ error: "callbackUrl is invalid" }, { status: 400 });
    }

    if (!isAllowedUrl(callbackUrl, allowedOrigins)) {
      return NextResponse.json(
        {
          error: "callbackUrl origin not allowed. Set WOOCOMMERCE_ALLOWED_ORIGINS (comma-separated origins).",
        },
        { status: 403 },
      );
    }

    const payload = {
      orderId,
      orderKey,
      paymentSessionId,
      amountHtn,
      address: typeof body.address === "string" ? body.address : undefined,
      paymentDetails: body.paymentDetails ?? undefined,
      event: "payment_completed",
      emittedAt: new Date().toISOString(),
    };

    const payloadJson = JSON.stringify(payload);
    const signatureHex = hmacSha256Hex(secret, payloadJson);

    const response = await fetch(callbackUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-HTN-Signature": `sha256=${signatureHex}`,
      },
      body: payloadJson,
    });

    const responseText = await response.text();

    if (!response.ok) {
      return NextResponse.json(
        {
          error: `WooCommerce callback returned ${response.status}`,
          response: responseText.slice(0, 5000),
        },
        { status: 502 },
      );
    }

    // Optional: If WooCommerce echoes back the signature, we can verify it.
    const echoed = response.headers.get("x-htn-signature");
    if (echoed) {
      const echoedHex = echoed.startsWith("sha256=") ? echoed.slice("sha256=".length) : echoed;
      if (echoedHex && !safeCompareHex(echoedHex, signatureHex)) {
        return NextResponse.json({ error: "WooCommerce signature echo mismatch" }, { status: 502 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("WooCommerce notify error:", error);
    return NextResponse.json({ error: (error as Error).message ?? "Failed to notify WooCommerce" }, { status: 500 });
  }
}
