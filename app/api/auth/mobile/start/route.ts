import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";

import { createAuthChallenge } from "../../../../lib/auth-state";

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

export async function POST(request: NextRequest) {
  try {
    const challenge = createAuthChallenge(null);
    const baseUrl = buildPublicBaseUrl(request);
    const callbackUrl = `${baseUrl}/api/auth/mobile/complete`;
    const requestUrl = `${baseUrl}/api/auth/mobile/request?requestId=${encodeURIComponent(challenge.challengeId)}`;
    const authUri = new URL("hoosat://auth/sign");
    authUri.searchParams.set("request", requestUrl);
    authUri.searchParams.set("expiresAt", new Date(challenge.expiresAt).toISOString());

    const qrDataUrl = await QRCode.toDataURL(authUri.toString(), {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 420,
    });

    return NextResponse.json({
      ok: true,
      requestId: challenge.challengeId,
      // Legacy alias kept so existing browser clients can keep polling.
      challengeId: challenge.challengeId,
      claimToken: challenge.claimToken,
      nonce: challenge.nonce,
      message: challenge.message,
      callbackUrl,
      requestUrl,
      authUri: authUri.toString(),
      qrDataUrl,
      expiresAt: new Date(challenge.expiresAt).toISOString(),
      note: "Scan this QR with Hoosat mobile wallet. The QR does not contain the browser claim token.",
    });
  } catch (error) {
    console.error("Mobile gateway auth start error:", error);
    return NextResponse.json({ ok: false, error: "Failed to start mobile wallet auth" }, { status: 500 });
  }
}
