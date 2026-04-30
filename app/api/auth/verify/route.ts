import { NextRequest, NextResponse } from "next/server";
import { HoosatSigner } from "hoosat-sdk";

import { AUTH_SESSION_COOKIE, consumeAuthChallenge, createAuthSession } from "../../../lib/auth-state";

type VerifyWalletAuthBody = {
  requestId?: unknown;
  challengeId?: unknown;
  address?: unknown;
  nonce?: unknown;
  message?: unknown;
  signature?: unknown;
  publicKey?: unknown;
};

const SESSION_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

function asRequiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as VerifyWalletAuthBody;
    const requestId = asRequiredString(body.requestId) ?? asRequiredString(body.challengeId);
    const address = asRequiredString(body.address);
    const nonce = asRequiredString(body.nonce);
    const message = asRequiredString(body.message);
    const signature = asRequiredString(body.signature);
    const publicKey = asRequiredString(body.publicKey);

    if (!requestId || !address || !nonce || !message || !signature || !publicKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "requestId, address, nonce, message, signature and publicKey are required",
          code: "AUTH_SIGNATURE_PAYLOAD_INCOMPLETE",
        },
        { status: 400 },
      );
    }

    const challenge = consumeAuthChallenge(requestId, { address, nonce, message });
    if (!challenge) {
      return NextResponse.json(
        { ok: false, error: "Auth challenge is invalid, expired, already used, or mismatched", code: "AUTH_CHALLENGE_INVALID" },
        { status: 401 },
      );
    }

    const verification = HoosatSigner.verifySignedMessage(
      {
        address,
        appId: "htn-payment-gateway",
        message: challenge.message,
        nonce: challenge.nonce,
        publicKey,
        signature,
        timestamp: new Date().toISOString(),
      },
      "mainnet",
    );

    if (!verification.isValid || verification.recoveredAddress !== address) {
      return NextResponse.json(
        {
          ok: false,
          error: verification.error ?? "Wallet signature verification failed",
          code: "AUTH_SIGNATURE_INVALID",
        },
        { status: 401 },
      );
    }

    const session = createAuthSession({ address, publicKey });
    const response = NextResponse.json({
      ok: true,
      session: {
        address: session.address,
        publicKey: session.publicKey,
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
  } catch (error) {
    console.error("Gateway auth verify error:", error);
    return NextResponse.json({ ok: false, error: "Failed to verify wallet auth signature" }, { status: 500 });
  }
}
