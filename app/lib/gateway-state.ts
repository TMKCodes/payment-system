type PaymentSessionLike = {
  address: string;
  amountSompi?: string;
  completedPayment: unknown | null;
  updatedAt: number;
};

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

// Separate from SESSION_TTL_MS: this controls how long a session blocks other sessions
// if the client stops polling / abandons the payment.
const ACTIVE_LOCK_TTL_MS = Number.parseInt(process.env.PAYMENT_GATEWAY_ACTIVE_LOCK_TTL_MS ?? "900000", 10);

// Remember expired session IDs for a while so clients that keep polling don't
// accidentally re-initialize the same session after timeout.
const expiredSessionIds = new Map<string, number>();

export const paymentSessions = new Map<string, PaymentSessionLike>();

export function getActiveLockTtlMs(): number {
  return Number.isFinite(ACTIVE_LOCK_TTL_MS) && ACTIVE_LOCK_TTL_MS > 0 ? ACTIVE_LOCK_TTL_MS : 15 * 60 * 1000;
}

export function isSessionExpired(sessionId: string, now = Date.now()): boolean {
  const until = expiredSessionIds.get(sessionId);
  if (!until) return false;
  if (now > until) {
    expiredSessionIds.delete(sessionId);
    return false;
  }
  return true;
}

export function clearExpiredSession(sessionId: string) {
  expiredSessionIds.delete(sessionId);
}

function markSessionExpired(sessionId: string, now: number, ttlMs: number) {
  const clampedTtlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : getActiveLockTtlMs();
  expiredSessionIds.set(sessionId, now + clampedTtlMs);
}

export function pruneExpiredSessions(now = Date.now()) {
  const lockTtlMs = getActiveLockTtlMs();

  for (const [sessionId, session] of paymentSessions.entries()) {
    if (!session.completedPayment && now - session.updatedAt > lockTtlMs) {
      paymentSessions.delete(sessionId);
      markSessionExpired(sessionId, now, lockTtlMs);
      continue;
    }

    if (now - session.updatedAt > SESSION_TTL_MS) {
      paymentSessions.delete(sessionId);
    }
  }

  for (const [sessionId, until] of expiredSessionIds.entries()) {
    if (now > until) {
      expiredSessionIds.delete(sessionId);
    }
  }
}

export function findActiveSessionForAddress(
  address: string,
  options: { ignoreSessionId?: string; now?: number } = {},
): { sessionId: string; session: PaymentSessionLike } | null {
  const now = options.now ?? Date.now();
  const ignoreSessionId = options.ignoreSessionId;
  const lockTtlMs = getActiveLockTtlMs();

  let best: { sessionId: string; session: PaymentSessionLike } | null = null;

  for (const [sessionId, session] of paymentSessions.entries()) {
    if (ignoreSessionId && sessionId === ignoreSessionId) continue;
    if (session.address !== address) continue;
    if (session.completedPayment) continue;

    // Treat the session as active only if we have seen recent activity.
    if (now - session.updatedAt > lockTtlMs) continue;

    if (!best || session.updatedAt > best.session.updatedAt) {
      best = { sessionId, session };
    }
  }

  return best;
}

export function findAnyActiveSession(
  options: { now?: number } = {},
): { sessionId: string; session: PaymentSessionLike } | null {
  const now = options.now ?? Date.now();
  const lockTtlMs = getActiveLockTtlMs();

  let best: { sessionId: string; session: PaymentSessionLike } | null = null;

  for (const [sessionId, session] of paymentSessions.entries()) {
    if (session.completedPayment) continue;
    if (now - session.updatedAt > lockTtlMs) continue;

    if (!best || session.updatedAt > best.session.updatedAt) {
      best = { sessionId, session };
    }
  }

  return best;
}

export function findActiveSessionForAddressAndAmount(
  address: string,
  amountSompi: string,
  options: { ignoreSessionId?: string; now?: number } = {},
): { sessionId: string; session: PaymentSessionLike } | null {
  const now = options.now ?? Date.now();
  const ignoreSessionId = options.ignoreSessionId;
  const lockTtlMs = getActiveLockTtlMs();

  let best: { sessionId: string; session: PaymentSessionLike } | null = null;

  for (const [sessionId, session] of paymentSessions.entries()) {
    if (ignoreSessionId && sessionId === ignoreSessionId) continue;
    if (session.address !== address) continue;
    if (session.amountSompi !== amountSompi) continue;
    if (session.completedPayment) continue;
    if (now - session.updatedAt > lockTtlMs) continue;

    if (!best || session.updatedAt > best.session.updatedAt) {
      best = { sessionId, session };
    }
  }

  return best;
}
