import { NextRequest, NextResponse } from "next/server";

import { getAuthChallenge } from "../../../../lib/auth-state";

function buildPublicBaseUrl(request: NextRequest) {
  const configured = process.env.GATEWAY_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (configured) {
    return configured;
  }

  const url = new URL(request.url);
  if (url.hostname === "0.0.0.0" || url.hostname === "::") {
    url.hostname = "127.0.0.1";
  }
  return url.origin;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const requestId = url.searchParams.get("requestId")?.trim() || url.searchParams.get("challengeId")?.trim();

  if (!requestId) {
    return NextResponse.json({ ok: false, error: "requestId is required" }, { status: 400 });
  }

  const challenge = getAuthChallenge(requestId);
  if (!challenge) {
    return NextResponse.json({ ok: false, error: "Auth request is expired, used, or unknown" }, { status: 404 });
  }

  const baseUrl = buildPublicBaseUrl(request);

  return NextResponse.json({
    ok: true,
    protocol: "htn-gateway-auth-v1",
    requestId: challenge.challengeId,
    nonce: challenge.nonce,
    message: challenge.message,
    callback: `${baseUrl}/api/auth/mobile/complete`,
    expiresAt: new Date(challenge.expiresAt).toISOString(),
  });
}
