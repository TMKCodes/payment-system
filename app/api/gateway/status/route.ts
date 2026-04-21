import { NextResponse } from "next/server";
import { findAnyActiveSession, pruneExpiredSessions } from "../../../lib/gateway-state";

export async function GET() {
  const now = Date.now();
  pruneExpiredSessions(now);

  const active = findAnyActiveSession({ now });

  return NextResponse.json({
    busy: Boolean(active),
    activeSessionId: active?.sessionId ?? null,
    lastActivityAt: active ? new Date(active.session.updatedAt).toISOString() : null,
  });
}
