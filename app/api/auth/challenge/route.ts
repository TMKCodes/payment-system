import { NextRequest, NextResponse } from "next/server";
import { HoosatUtils } from "hoosat-sdk";

import { createAuthChallenge } from "../../../lib/auth-state";

export async function POST(request: NextRequest) {
  try {
    const { address } = (await request.json()) as { address?: unknown };

    if (typeof address !== "string" || address.trim().length === 0) {
      return NextResponse.json({ ok: false, error: "Wallet address is required" }, { status: 400 });
    }

    const normalizedAddress = address.trim();
    if (!HoosatUtils.isValidAddress(normalizedAddress)) {
      return NextResponse.json({ ok: false, error: "Invalid Hoosat wallet address" }, { status: 400 });
    }

    const challenge = createAuthChallenge(normalizedAddress);

    return NextResponse.json({
      ok: true,
      requestId: challenge.challengeId,
      // Legacy alias kept so older wallets/clients can still authenticate.
      challengeId: challenge.challengeId,
      address: challenge.address,
      nonce: challenge.nonce,
      message: challenge.message,
      issuedAt: new Date(challenge.issuedAt).toISOString(),
      expiresAt: new Date(challenge.expiresAt).toISOString(),
      note: "Sign this message to prove wallet ownership. This does not authorize a payment.",
    });
  } catch (error) {
    console.error("Gateway auth challenge error:", error);
    return NextResponse.json({ ok: false, error: "Failed to create wallet auth challenge" }, { status: 500 });
  }
}
