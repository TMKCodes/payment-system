import { NextRequest, NextResponse } from "next/server";

import {
  AUTH_SESSION_COOKIE,
  readAuthSession,
  readCompletedAuthChallenge,
} from "../../../../lib/auth-state";

const SESSION_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const requestId = url.searchParams.get("requestId")?.trim() || url.searchParams.get("challengeId")?.trim();
  const claimToken = url.searchParams.get("claimToken")?.trim();

  if (!requestId || !claimToken) {
    return NextResponse.json(
      { ok: false, authenticated: false, error: "requestId and claimToken are required" },
      { status: 400 },
    );
  }

  const challenge = readCompletedAuthChallenge(requestId, claimToken);
  if (!challenge?.completedSessionId) {
    return NextResponse.json({ ok: true, authenticated: false, status: "pending" });
  }

  const session = readAuthSession(challenge.completedSessionId);
  if (!session) {
    return NextResponse.json({ ok: true, authenticated: false, status: "expired" });
  }

  const response = NextResponse.json({
    ok: true,
    authenticated: true,
    status: "authenticated",
    session: {
      address: session.address,
      publicKey: session.publicKey,
      identityKeyId: session.identityKeyId,
      identityPublicKey: session.identityPublicKey,
      createdAt: new Date(session.createdAt).toISOString(),
      expiresAt: new Date(session.expiresAt).toISOString(),
    },
  });

  response.cookies.set(AUTH_SESSION_COOKIE, session.sessionId, {
    httpOnly: true,
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
