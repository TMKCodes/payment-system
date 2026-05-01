import { NextRequest, NextResponse } from "next/server";

import { AUTH_SESSION_COOKIE, deleteAuthSession, readAuthSession } from "../../../lib/auth-state";

export async function GET(request: NextRequest) {
  const sessionId = request.cookies.get(AUTH_SESSION_COOKIE)?.value;
  const session = readAuthSession(sessionId);

  if (!session) {
    return NextResponse.json({ ok: true, authenticated: false, session: null });
  }

  return NextResponse.json({
    ok: true,
    authenticated: true,
    session: {
      address: session.address,
      publicKey: session.publicKey,
      createdAt: new Date(session.createdAt).toISOString(),
      expiresAt: new Date(session.expiresAt).toISOString(),
    },
  });
}

export async function DELETE(request: NextRequest) {
  const sessionId = request.cookies.get(AUTH_SESSION_COOKIE)?.value;
  deleteAuthSession(sessionId);

  const response = NextResponse.json({ ok: true, authenticated: false, session: null });
  response.cookies.set(AUTH_SESSION_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}

