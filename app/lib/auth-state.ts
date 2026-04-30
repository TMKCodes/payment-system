import { randomBytes, randomUUID } from "node:crypto";

export const AUTH_SESSION_COOKIE =
  process.env.GATEWAY_AUTH_SESSION_COOKIE?.trim() || "htn_gateway_auth_session";

const AUTH_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const AUTH_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const AUTH_APP_NAME = process.env.GATEWAY_AUTH_APP_NAME?.trim() || "HTN Gateway";

export type GatewayAuthChallenge = {
  challengeId: string;
  address: string | null;
  claimToken: string;
  nonce: string;
  message: string;
  issuedAt: number;
  expiresAt: number;
  usedAt: number | null;
  completedAt: number | null;
  completedSessionId: string | null;
};

export type GatewayAuthSession = {
  sessionId: string;
  address: string;
  publicKey: string;
  identityKeyId: string;
  identityPublicKey: string;
  createdAt: number;
  expiresAt: number;
};

const authChallenges = new Map<string, GatewayAuthChallenge>();
const authSessions = new Map<string, GatewayAuthSession>();

function normalizeAddress(address: string): string {
  return address.trim();
}

function buildLoginMessage(input: {
  address?: string | null;
  challengeId: string;
  nonce: string;
  issuedAtIso: string;
}): string {
  const lines = [
    `${AUTH_APP_NAME} Wallet Login`,
    `Request: ${input.challengeId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAtIso}`,
    "This signature proves wallet ownership and does not authorize a payment.",
  ];

  if (input.address) {
    lines.splice(1, 0, `Address: ${input.address}`);
  }

  return lines.join("\n");
}

export function pruneAuthState(now = Date.now()) {
  for (const [challengeId, challenge] of authChallenges.entries()) {
    if (challenge.expiresAt <= now) {
      authChallenges.delete(challengeId);
    }
  }

  for (const [sessionId, session] of authSessions.entries()) {
    if (session.expiresAt <= now) {
      authSessions.delete(sessionId);
    }
  }
}

export function createAuthChallenge(address?: string | null, now = Date.now()): GatewayAuthChallenge {
  pruneAuthState(now);

  const normalizedAddress = address ? normalizeAddress(address) : null;
  const challengeId = randomUUID();
  const claimToken = `${randomUUID()}.${randomBytes(24).toString("hex")}`;
  const nonce = `${randomUUID()}.${randomBytes(16).toString("hex")}`;
  const issuedAtIso = new Date(now).toISOString();
  const challenge: GatewayAuthChallenge = {
    challengeId,
    address: normalizedAddress,
    claimToken,
    nonce,
    message: buildLoginMessage({
      address: normalizedAddress,
      challengeId,
      nonce,
      issuedAtIso,
    }),
    issuedAt: now,
    expiresAt: now + AUTH_CHALLENGE_TTL_MS,
    usedAt: null,
    completedAt: null,
    completedSessionId: null,
  };

  authChallenges.set(challengeId, challenge);
  return challenge;
}

export function getAuthChallenge(challengeId: string, now = Date.now()): GatewayAuthChallenge | null {
  pruneAuthState(now);

  const challenge = authChallenges.get(challengeId);
  if (!challenge || challenge.expiresAt <= now || challenge.usedAt !== null) {
    return null;
  }

  return challenge;
}

export function consumeAuthChallenge(
  challengeId: string,
  input: { address: string; nonce: string; message: string },
  now = Date.now(),
): GatewayAuthChallenge | null {
  const challenge = getAuthChallenge(challengeId, now);
  if (!challenge) {
    return null;
  }

  if (
    (challenge.address !== null && challenge.address !== normalizeAddress(input.address)) ||
    challenge.nonce !== input.nonce ||
    challenge.message !== input.message
  ) {
    return null;
  }

  challenge.usedAt = now;
  authChallenges.set(challengeId, challenge);
  return challenge;
}

export function completeAuthChallenge(challengeId: string, sessionId: string, now = Date.now()) {
  const challenge = authChallenges.get(challengeId);
  if (!challenge || challenge.expiresAt <= now || challenge.completedSessionId) {
    return null;
  }

  challenge.completedAt = now;
  challenge.completedSessionId = sessionId;
  authChallenges.set(challengeId, challenge);
  return challenge;
}

export function readCompletedAuthChallenge(
  challengeId: string,
  claimToken: string,
  now = Date.now(),
): GatewayAuthChallenge | null {
  pruneAuthState(now);

  const challenge = authChallenges.get(challengeId);
  if (
    !challenge ||
    challenge.expiresAt <= now ||
    challenge.claimToken !== claimToken ||
    !challenge.completedSessionId
  ) {
    return null;
  }

  return challenge;
}

export function createAuthSession(
  input: {
    address: string;
    publicKey: string;
    identityKeyId?: string;
    identityPublicKey?: string;
  },
  now = Date.now(),
): GatewayAuthSession {
  pruneAuthState(now);

  const identityPublicKey = (input.identityPublicKey ?? input.publicKey).trim();
  const session: GatewayAuthSession = {
    sessionId: `${randomUUID()}.${randomBytes(24).toString("hex")}`,
    address: normalizeAddress(input.address),
    publicKey: input.publicKey.trim(),
    identityKeyId: (input.identityKeyId ?? `schnorr:${identityPublicKey}`).trim(),
    identityPublicKey,
    createdAt: now,
    expiresAt: now + AUTH_SESSION_TTL_MS,
  };

  authSessions.set(session.sessionId, session);
  return session;
}

export function readAuthSession(sessionId: string | undefined, now = Date.now()): GatewayAuthSession | null {
  if (!sessionId) {
    return null;
  }

  pruneAuthState(now);

  const session = authSessions.get(sessionId);
  if (!session || session.expiresAt <= now) {
    return null;
  }

  return session;
}

export function deleteAuthSession(sessionId: string | undefined) {
  if (sessionId) {
    authSessions.delete(sessionId);
  }
}
