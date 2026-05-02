import { NextRequest, NextResponse } from "next/server";
import { hashMessage, HoosatSigner } from "hoosat-sdk";

import { completeAuthChallenge, consumeAuthChallenge, createAuthSession } from "../../../../lib/auth-state";
import { verifyMobileSchnorrAuth } from "../../../../lib/schnorr-auth";

type MobileCompleteBody = {
  requestId?: unknown;
  challengeId?: unknown;
  address?: unknown;
  nonce?: unknown;
  message?: unknown;
  signature?: unknown;
  publicKey?: unknown;
  identityKeyId?: unknown;
  addressPublicKey?: unknown;
  signedMessage?: unknown;
  messageHash?: unknown;
  signatureScheme?: unknown;
};

function asRequiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as MobileCompleteBody;
    const requestId = asRequiredString(body.requestId) ?? asRequiredString(body.challengeId);
    const address = asRequiredString(body.address);
    const nonce = asRequiredString(body.nonce);
    const message = asRequiredString(body.message);
    const signature = asRequiredString(body.signature);
    const publicKey = asRequiredString(body.publicKey);
    const identityKeyId = asRequiredString(body.identityKeyId);
    const addressPublicKey = asRequiredString(body.addressPublicKey);
    const signedMessage = asRequiredString(body.signedMessage);
    const messageHash = asRequiredString(body.messageHash);
    const signatureScheme = asRequiredString(body.signatureScheme);

    if (!requestId || !address || !nonce || !message || !signature || !publicKey) {
      return NextResponse.json(
        {
          ok: false,
          code: "MOBILE_AUTH_PAYLOAD_INCOMPLETE",
          error: "requestId, address, nonce, message, signature and publicKey are required",
        },
        { status: 400 },
      );
    }

    const challenge = consumeAuthChallenge(requestId, { address, nonce, message });
    if (!challenge) {
      return NextResponse.json(
        { ok: false, code: "MOBILE_AUTH_CHALLENGE_INVALID", error: "Challenge is expired, used, or mismatched" },
        { status: 401 },
      );
    }

    const isMobileIdentitySchnorr = signatureScheme === "hoosat-mobile-identity-schnorr-blake3-v2";
    const isMobileSchnorr = signatureScheme === "hoosat-mobile-schnorr-blake3-v1";
    const expectedIdentityKeyId = `schnorr:${publicKey}`;
    const expectedSignedMessage = [
      challenge.message,
      `Identity Key: ${expectedIdentityKeyId}`,
      `Display Address: ${address}`,
    ].join("\n");
    const expectedMessage = isMobileIdentitySchnorr ? expectedSignedMessage : challenge.message;
    const expectedMessageHash = hashMessage(expectedMessage).toString("hex");
    const verification = isMobileSchnorr
      ? {
          isValid:
            !!messageHash &&
            messageHash === expectedMessageHash &&
            verifyMobileSchnorrAuth({
              address,
              messageHashHex: messageHash,
              publicKeyHex: publicKey,
              addressPublicKeyHex: addressPublicKey ?? publicKey,
              signatureHex: signature,
            }),
          recoveredAddress: address,
          error: "Mobile Schnorr signature verification failed",
        }
      : isMobileIdentitySchnorr
        ? {
            isValid:
              !!messageHash &&
              !!signedMessage &&
              !!identityKeyId &&
              identityKeyId === expectedIdentityKeyId &&
              signedMessage === expectedSignedMessage &&
              messageHash === expectedMessageHash &&
              verifyMobileSchnorrAuth({
                address,
                messageHashHex: messageHash,
                publicKeyHex: publicKey,
                addressPublicKeyHex: addressPublicKey ?? undefined,
                signatureHex: signature,
              }),
            recoveredAddress: address,
            error: "Mobile identity Schnorr signature verification failed",
          }
      : HoosatSigner.verifySignedMessage(
          {
            address,
            appId: "htn-payment-gateway-mobile",
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
          code: "MOBILE_AUTH_SIGNATURE_INVALID",
          error: verification.error ?? "Mobile wallet signature verification failed",
        },
        { status: 401 },
      );
    }

    const session = createAuthSession({
      address,
      publicKey,
      identityKeyId: identityKeyId ?? expectedIdentityKeyId,
      identityPublicKey: publicKey,
    });
    const completed = completeAuthChallenge(requestId, session.sessionId);
    if (!completed) {
      return NextResponse.json(
        { ok: false, code: "MOBILE_AUTH_COMPLETION_FAILED", error: "Challenge completion failed" },
        { status: 409 },
      );
    }

    return NextResponse.json({
      ok: true,
      accepted: true,
      address: session.address,
      identityKeyId: session.identityKeyId,
      expiresAt: new Date(session.expiresAt).toISOString(),
      note: "Mobile signature accepted. Return to the browser that displayed the QR code.",
    });
  } catch (error) {
    console.error("Mobile gateway auth complete error:", error);
    return NextResponse.json({ ok: false, error: "Failed to complete mobile wallet auth" }, { status: 500 });
  }
}
