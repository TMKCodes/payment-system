"use client";

import { useEffect, useState } from "react";

type WalletProvider = {
  connect?: () => Promise<unknown>;
  getAccounts?: () => Promise<unknown>;
  getAddresses?: () => Promise<unknown>;
  getPublicKey?: () => Promise<unknown>;
  signMessage?: (message: string) => Promise<unknown>;
  sign?: (message: string) => Promise<unknown>;
  request?: (input: { method: string; params?: unknown }) => Promise<unknown>;
};

type AuthChallengeResponse = {
  ok: boolean;
  requestId?: string;
  challengeId?: string;
  address?: string;
  nonce?: string;
  message?: string;
  expiresAt?: string;
  error?: string;
};

type AuthSessionResponse = {
  ok: boolean;
  authenticated?: boolean;
  session?: {
    address: string;
    publicKey: string;
    expiresAt: string;
  } | null;
  error?: string;
};

type MobileAuthStartResponse = {
  ok: boolean;
  requestId?: string;
  challengeId?: string;
  claimToken?: string;
  authUri?: string;
  qrDataUrl?: string;
  expiresAt?: string;
  error?: string;
};

type MobileAuthStatusResponse = AuthSessionResponse & {
  status?: "pending" | "expired" | "authenticated";
};

type WalletConnection = {
  address: string;
  publicKey: string | null;
};

const providerNames = ["hoosat", "hoosatWallet", "kaspa"] as const;

function getWalletProvider(): WalletProvider | null {
  if (typeof window === "undefined") {
    return null;
  }

  const walletWindow = window as unknown as Record<string, WalletProvider | undefined>;
  for (const providerName of providerNames) {
    const provider = walletWindow[providerName];
    if (provider) {
      return provider;
    }
  }

  return null;
}

function pickString(value: unknown, keys: string[]): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function pickFirstAccount(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  if (Array.isArray(record.accounts)) {
    return record.accounts[0] ?? null;
  }

  if (Array.isArray(record.addresses)) {
    return record.addresses[0] ?? null;
  }

  return value;
}

async function requestProvider(provider: WalletProvider, methods: string[], params?: unknown): Promise<unknown | null> {
  if (!provider.request) {
    return null;
  }

  for (const method of methods) {
    try {
      const result = await provider.request({ method, params });
      if (result !== undefined && result !== null) {
        return result;
      }
    } catch {
      // Different wallet builds expose different method names. Try the next supported shape.
    }
  }

  return null;
}

async function connectWallet(provider: WalletProvider): Promise<WalletConnection> {
  const connectResult =
    (provider.connect ? await provider.connect() : null) ??
    (await requestProvider(provider, ["hoosat_connect", "connect", "kaspa_connect"]));

  const accountsResult =
    connectResult ??
    (provider.getAccounts ? await provider.getAccounts() : null) ??
    (provider.getAddresses ? await provider.getAddresses() : null) ??
    (await requestProvider(provider, ["hoosat_accounts", "getAccounts", "kaspa_getAccounts", "getAddresses"]));

  const account = pickFirstAccount(accountsResult);
  const address = pickString(account, ["address", "walletAddress"]) ?? pickString(accountsResult, ["address", "walletAddress"]);

  if (!address) {
    throw new Error("Wallet connected, but no Hoosat address was returned.");
  }

  const publicKey =
    pickString(account, ["publicKey", "pubKey"]) ??
    pickString(accountsResult, ["publicKey", "pubKey"]) ??
    pickString(provider.getPublicKey ? await provider.getPublicKey() : null, ["publicKey", "pubKey"]) ??
    pickString(await requestProvider(provider, ["hoosat_getPublicKey", "getPublicKey", "kaspa_getPublicKey"], { address }), [
      "publicKey",
      "pubKey",
    ]);

  return { address, publicKey };
}

async function signGatewayMessage(provider: WalletProvider, message: string): Promise<string> {
  const directSignature =
    (provider.signMessage ? await provider.signMessage(message) : null) ??
    (provider.sign ? await provider.sign(message) : null) ??
    (await requestProvider(provider, ["hoosat_signMessage", "signMessage", "personal_sign", "kaspa_signMessage"], {
      message,
    }));

  const signature = pickString(directSignature, ["signature", "sig", "signatureHex"]) ?? pickString(directSignature, []);

  if (!signature) {
    throw new Error("Wallet did not return a message signature.");
  }

  return signature;
}

export default function GatewayAuthClient() {
  const [address, setAddress] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [session, setSession] = useState<AuthSessionResponse["session"]>(null);
  const [status, setStatus] = useState("Ready to authenticate with Hoosat wallet.");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [mobileAuth, setMobileAuth] = useState<{
    requestId: string;
    claimToken: string;
    authUri: string;
    qrDataUrl: string;
    expiresAt: string;
  } | null>(null);

  useEffect(() => {
    void fetch("/api/auth/session")
      .then((response) => response.json() as Promise<AuthSessionResponse>)
      .then((payload) => {
        if (payload.authenticated && payload.session) {
          setSession(payload.session);
          setAddress(payload.session.address);
          setPublicKey(payload.session.publicKey);
          setStatus("Gateway session is already active.");
        }
      })
      .catch(() => {
        // Session probing is best-effort. The login button still starts a fresh flow.
      });
  }, []);

  useEffect(() => {
    if (!mobileAuth || session) {
      return;
    }

    let stopped = false;
    const poll = async () => {
      try {
        const params = new URLSearchParams({
          requestId: mobileAuth.requestId,
          claimToken: mobileAuth.claimToken,
        });
        const response = await fetch(`/api/auth/mobile/status?${params.toString()}`, { cache: "no-store" });
        const payload = (await response.json()) as MobileAuthStatusResponse;

        if (stopped) {
          return;
        }

        if (payload.authenticated && payload.session) {
          setSession(payload.session);
          setAddress(payload.session.address);
          setPublicKey(payload.session.publicKey);
          setStatus("Authenticated with mobile wallet QR. No payment transaction was created.");
          setMobileAuth(null);
          return;
        }

        if (payload.status === "expired") {
          setError("Mobile wallet login expired. Start a new QR login.");
          setStatus("Mobile QR expired.");
          setMobileAuth(null);
        }
      } catch {
        // Keep polling. Temporary network hiccups should not cancel the mobile login attempt.
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), 2500);

    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [mobileAuth, session]);

  const authenticate = async () => {
    setIsBusy(true);
    setError(null);
    setStatus("Waiting for wallet extension...");

    try {
      const provider = getWalletProvider();
      if (!provider) {
        throw new Error("Hoosat wallet extension was not found in this browser.");
      }

      const wallet = await connectWallet(provider);
      setAddress(wallet.address);
      setPublicKey(wallet.publicKey);

      if (!wallet.publicKey) {
        throw new Error("Wallet public key is required for gateway signature verification.");
      }

      setStatus("Creating one-time gateway nonce...");
      const challengeResponse = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: wallet.address }),
      });
      const challenge = (await challengeResponse.json()) as AuthChallengeResponse;

      const requestId = challenge.requestId ?? challenge.challengeId;
      if (!challengeResponse.ok || !challenge.ok || !requestId || !challenge.nonce || !challenge.message) {
        throw new Error(challenge.error ?? "Failed to create gateway auth challenge.");
      }

      setStatus("Please sign the gateway login message in your wallet.");
      const signature = await signGatewayMessage(provider, challenge.message);

      setStatus("Verifying wallet signature...");
      const verifyResponse = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: wallet.address,
          requestId,
          challengeId: requestId,
          message: challenge.message,
          nonce: challenge.nonce,
          publicKey: wallet.publicKey,
          signature,
        }),
      });
      const verifyPayload = (await verifyResponse.json()) as AuthSessionResponse;

      if (!verifyResponse.ok || !verifyPayload.ok || !verifyPayload.session) {
        throw new Error(verifyPayload.error ?? "Gateway auth signature was rejected.");
      }

      setSession(verifyPayload.session);
      setStatus("Authenticated. No payment transaction was created.");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Gateway wallet authentication failed.");
      setStatus("Authentication failed.");
    } finally {
      setIsBusy(false);
    }
  };

  const signOut = async () => {
    setIsBusy(true);
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
      setSession(null);
      setStatus("Signed out.");
    } finally {
      setIsBusy(false);
    }
  };

  const startMobileAuth = async () => {
    setIsBusy(true);
    setError(null);
    setStatus("Creating mobile wallet QR challenge...");

    try {
      const response = await fetch("/api/auth/mobile/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const payload = (await response.json()) as MobileAuthStartResponse;

      if (
        !response.ok ||
        !payload.ok ||
        !(payload.requestId ?? payload.challengeId) ||
        !payload.claimToken ||
        !payload.authUri ||
        !payload.qrDataUrl ||
        !payload.expiresAt
      ) {
        throw new Error(payload.error ?? "Failed to create mobile QR login.");
      }

      setMobileAuth({
        requestId: payload.requestId ?? payload.challengeId!,
        claimToken: payload.claimToken,
        authUri: payload.authUri,
        qrDataUrl: payload.qrDataUrl,
        expiresAt: payload.expiresAt,
      });
      setStatus("Scan the QR with Hoosat mobile wallet and sign the login message.");
    } catch (mobileError) {
      setError(mobileError instanceof Error ? mobileError.message : "Mobile wallet QR login failed.");
      setStatus("Mobile QR login failed.");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#070a12] px-6 py-10 text-white">
      <section className="mx-auto max-w-5xl rounded-[32px] border border-cyan-400/25 bg-[#0e1625] p-8 shadow-2xl shadow-cyan-950/40">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.35em] text-cyan-300">HTN Gateway Auth</p>
        <h1 className="text-4xl font-black tracking-tight">Wallet signature login</h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
          Choose desktop extension login or mobile QR login. Both flows sign a one-time nonce and verify wallet
          ownership server-side. They do not create a payment, send a zero-value transaction, or charge a network fee.
        </p>

        <div className="mt-8 grid gap-4 rounded-2xl border border-white/10 bg-black/20 p-5 text-sm">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Status</p>
            <p className="mt-1 font-semibold text-slate-100">{status}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Wallet</p>
            <p className="mt-1 break-all font-mono text-slate-200">{address ?? "Not connected"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Public key</p>
            <p className="mt-1 break-all font-mono text-slate-200">{publicKey ?? "Not available yet"}</p>
          </div>
          {session ? (
            <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-4">
              <p className="font-bold text-emerald-200">Gateway session active</p>
              <p className="mt-1 text-xs text-emerald-100/80">Expires at {session.expiresAt}</p>
            </div>
          ) : null}
          {error ? (
            <div className="rounded-xl border border-red-400/25 bg-red-400/10 p-4 text-sm text-red-100">{error}</div>
          ) : null}
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <div className="rounded-3xl border border-cyan-300/20 bg-cyan-300/5 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-cyan-200">Option 1</p>
            <h2 className="mt-2 text-2xl font-black">Hoosat extension</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Use this on desktop when the Hoosat browser extension is installed. The extension signs the gateway nonce
              directly in this browser.
            </p>
            <button
              type="button"
              onClick={authenticate}
              disabled={isBusy}
              className="mt-5 rounded-full bg-cyan-300 px-6 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBusy ? "Working..." : "Connect extension and sign"}
            </button>
          </div>

          <div className="rounded-3xl border border-emerald-300/20 bg-emerald-300/5 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-emerald-200">Option 2</p>
            <h2 className="mt-2 text-2xl font-black">Mobile wallet QR</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Use this when the user signs from a mobile Hoosat wallet. Scan the QR, sign the login message, and this
              browser will receive the gateway session after verification.
            </p>
            <button
              type="button"
              onClick={startMobileAuth}
              disabled={isBusy}
              className="mt-5 rounded-full bg-emerald-300 px-6 py-3 text-sm font-black text-slate-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBusy ? "Working..." : "Show mobile QR"}
            </button>

            {mobileAuth ? (
              <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
                <img
                  src={mobileAuth.qrDataUrl}
                  alt="Hoosat mobile wallet login QR"
                  className="mx-auto h-64 w-64 rounded-2xl bg-white p-3"
                />
                <p className="mt-3 text-xs text-slate-400">
                  Expires at {mobileAuth.expiresAt}. The QR contains only the mobile signing request, not the browser
                  claim token.
                </p>
                <a
                  href={mobileAuth.authUri}
                  className="mt-3 inline-flex rounded-full border border-white/15 px-4 py-2 text-xs font-bold text-white hover:bg-white/10"
                >
                  Open mobile wallet link
                </a>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={signOut}
            disabled={isBusy || !session}
            className="rounded-full border border-white/15 px-6 py-3 text-sm font-bold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Sign out
          </button>
        </div>
      </section>
    </main>
  );
}
