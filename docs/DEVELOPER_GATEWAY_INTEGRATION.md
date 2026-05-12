# HTN Payment Gateway — Developer Integration Tutorial

This tutorial explains how to integrate the **HTN (Hoosat)** payment gateway into your own system (custom backend, e-commerce site, or app).

The gateway is a Next.js service that:

- exposes an address for a configured **gateway wallet**
- provides live fiat pricing via the gateway API
- tracks an individual checkout via a **payment session**
- watches the Hoosat network and reports `waiting_for_payment` → `pending_confirmation` → `completed`
- optionally emits an **HMAC-signed callback** to your system when payment is completed

> Important: This gateway currently stores payment sessions in-memory. If you run multiple replicas, you must add a shared session store (or sticky sessions) to avoid inconsistent status.

---

## 1) Gateway deployment configuration

Set these variables in your gateway deployment:

```bash
# REQUIRED: gateway wallet (receives customer payments)
GATEWAY_WALLET_PRIVATE_KEY=<64 hex chars>

# REQUIRED: sweep destination (where the gateway wallet sweeps funds after confirmation)
MERCHANT_SWEEP_ADDRESS=hoosat:...

# Hoosat node (defaults exist)
HOOSAT_NODE_HOST=mainnet-node-1.hoosat.fi
HOOSAT_NODE_PORT=42420
HOOSAT_NODE_TIMEOUT=10000

# Session locking behavior (optional)
# How long an inactive checkout blocks other checkouts (default 300000 = 5m)
PAYMENT_GATEWAY_ACTIVE_LOCK_TTL_MS=300000

# Hard max age for a checkout even if still polling (default 900000 = 15m)
PAYMENT_GATEWAY_SESSION_MAX_AGE_MS=900000
```

If you want the gateway to POST completion callbacks to your system (recommended), also set:

```bash
# REQUIRED for signed callbacks via /api/woocommerce/notify
WOOCOMMERCE_SHARED_SECRET=<long random string>

# REQUIRED: comma-separated list of callback URL origins your gateway is allowed to call
# Example: https://shop.example.com,https://staging.shop.example.com
WOOCOMMERCE_ALLOWED_ORIGINS=https://shop.example.com
```

Notes:

- The variable names say “WooCommerce”, but the callback mechanism is generic: it’s just a signed POST to your endpoint.
- The allowlist matches exact `origin` (scheme + host + port). Paths are allowed, but the origin must match.

---

## 2) Concepts and API surface

### Merchant / gateway address

The gateway wallet address is exposed via:

- `GET /api/merchant/address`

Response:

```json
{ "address": "hoosat:...", "success": true }
```

### Live pricing

To convert fiat totals to HTN (or show rate information), use:

- `GET /api/price`

Response shape:

```json
{
  "pricesPerHtn": {
    "USD": 0.12,
    "EUR": 0.11,
    "GBP": 0.095
  }
}
```

Meaning: `pricesPerHtn["USD"]` is **USD per 1 HTN**.

So:

- `htnAmount = fiatAmount / pricesPerHtn[currency]`

### Payment sessions

A payment session is just a unique string you generate (usually a UUID) and pass to the gateway when checking payment status.

- `POST /api/check-payment`

Request body:

```json
{
  "address": "hoosat:...",
  "amount": "1.2345",
  "sessionId": "your-unique-session-id",
  "action": "confirm-transaction",
  "forceTakeover": false
}
```

Fields:

- `address` (required): the gateway wallet address returned by `/api/merchant/address`
- `amount` (required): expected HTN amount (string/number accepted)
- `sessionId` (required): your unique ID for this checkout
- `action` (optional):
  - `"cancel-session"` removes the session from the gateway
  - `"confirm-transaction"` triggers a best-effort sweep after confirmation
  - `"force-takeover-session"` forces the gateway to expire another active session
- `forceTakeover` (optional boolean): same behavior as `action: "force-takeover-session"` during initialization

Response (success):

```json
{
  "paymentStatus": "waiting_for_payment" | "pending_confirmation" | "completed" | "gateway_in_use" | "expired",
  "paymentDetails": {
    "transactionHash": "...",
    "amountHtn": "...",
    "confirmations": 2,
    "sweepTransactionHash": "..."
  },
  "expectedAmountHtn": "1.2345",
  "sessionInitialized": false
}
```

Status notes:

- `waiting_for_payment`: no matching transfer seen yet.
- `pending_confirmation`: transfer seen, waiting for confirmations.
- `completed`: payment is confirmed (the gateway requires `> 1` confirmations).
- `gateway_in_use`: another active session is holding the gateway lock. Retry after a delay, or take over if you own the UX.
- `expired`: the session timed out (HTTP `410`). Create a new session.

### Gateway busy status

You can check if the gateway is currently locked by another session:

- `GET /api/gateway/status`

---

## 3) Integration option A (recommended): Redirect to hosted payment page

This option keeps your app simple: you create a session ID and redirect the buyer to the gateway’s hosted page.

### 3.1 Build the payment URL

Hosted page URL shape:

```text
https://<gateway-host>/pay/session/<paymentSessionId>?amount=<htn>&label=<label>&return_url=<url>&callback_url=<url>&order_id=<id>&order_key=<key>
```

Required:

- `paymentSessionId`: you generate it (UUID recommended)
- `amount`: HTN amount as a decimal string

Optional (recommended):

- `return_url`: where the gateway should send the user after success/cancel/expiry
- `callback_url`: your server webhook endpoint to receive a signed completion event (requires `order_id` + `order_key` too)
- `label`: displayed in the wallet payment request
- `order_id` / `order_key`: opaque identifiers that your system uses to correlate callbacks

The gateway will append to `return_url`:

- `htn_session=<paymentSessionId>`
- `htn_status=<paid|cancelled|...>`
- `order_id=<order_id>` (if provided)

### 3.2 Handle the user return

When the buyer returns to your site, **do not trust query params alone**.

On your backend:

1. Load the expected HTN amount and the gateway address for that order.
2. Call `POST /api/check-payment` using the `sessionId` you issued.
3. Only mark the order paid if `paymentStatus === "completed"`.

Notes:

- The hosted page currently uses `htn_status=paid` on successful payment and `htn_status=cancelled` when the buyer cancels.
- Treat `htn_status` as a UX hint only; your backend should always verify via `/api/check-payment`.

---

## 4) Integration option B: Keep checkout on your site (embed QR + poll)

If you want to render the QR yourself and keep the buyer in your UI:

1. Call `GET /api/merchant/address`
2. Generate a Hoosat payment URI or QR
3. Call `POST /api/check-payment` repeatedly (polling) until `completed`

### 4.1 Generate a QR code

The repo uses `hoosat-sdk-web` to generate a payment QR.

Example (browser):

```ts
import { HoosatQR } from "hoosat-sdk-web";

const qrDataUrl = await HoosatQR.generatePaymentQR({
  address: merchantAddress,
  amount: Number(amountHtn),
  label: "Order #123",
});
```

### 4.2 Poll payment status

Example (TypeScript / Node or browser):

```ts
type CheckPaymentResponse = {
  paymentStatus: "completed" | "pending_confirmation" | "waiting_for_payment" | "gateway_in_use" | "expired";
  expectedAmountHtn: string;
  paymentDetails: null | {
    transactionHash?: string;
    confirmations?: number;
    sweepTransactionHash?: string;
  };
  sessionInitialized: boolean;
};

async function checkPayment(baseUrl: string, address: string, amountHtn: string, sessionId: string) {
  const res = await fetch(`${baseUrl}/api/check-payment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, amount: amountHtn, sessionId }),
  });

  if (res.status === 410) {
    throw new Error("Session expired");
  }

  if (res.status === 409) {
    // gateway_in_use: wait and retry, or offer takeover
    return { paymentStatus: "gateway_in_use" } as const;
  }

  if (!res.ok) {
    throw new Error(`Gateway error ${res.status}`);
  }

  return (await res.json()) as CheckPaymentResponse;
}
```

### 4.3 Optional: trigger sweep

After you have verified the payment is confirmed, you can ask the gateway to submit a sweep transaction:

```ts
await fetch(`${baseUrl}/api/check-payment`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    address,
    amount: amountHtn,
    sessionId,
    action: "confirm-transaction",
  }),
});
```

This is best-effort:

- sweep only runs after the gateway sees `> 1` confirmations
- sweep requires `GATEWAY_WALLET_PRIVATE_KEY` and `MERCHANT_SWEEP_ADDRESS`

---

## 5) Receiving signed callbacks (webhooks)

If you pass `callback_url` + `order_id` + `order_key` to the hosted page, the gateway can POST a completion event to your server by calling:

- `POST /api/woocommerce/notify` (internal gateway endpoint)

It forwards a signed request to your `callback_url` with header:

```text
X-HTN-Signature: sha256=<hex>
```

The signature is:

- `HMAC-SHA256(secret, JSON.stringify(payload))`

Payload shape (example):

```json
{
  "orderId": "123",
  "orderKey": "wc_order_key_or_any_nonce",
  "paymentSessionId": "uuid",
  "amountHtn": "1.2345",
  "address": "hoosat:...",
  "paymentDetails": { "transactionHash": "...", "confirmations": 2 },
  "event": "payment_completed",
  "emittedAt": "2026-05-12T12:00:00.000Z"
}
```

### 5.1 Example webhook verifier (Node/TypeScript)

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

function hmacSha256Hex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function htnWebhook(req: Request, res: Response) {
  const secret = process.env.WOOCOMMERCE_SHARED_SECRET!;

  // IMPORTANT: use the raw body string, not a re-serialized object
  const rawBody = (req as any).rawBody as string;

  const sigHeader = String(req.header("x-htn-signature") ?? "");
  const sig = sigHeader.startsWith("sha256=") ? sigHeader.slice("sha256=".length) : sigHeader;

  const expected = hmacSha256Hex(secret, rawBody);
  if (!sig || !safeEqualHex(sig, expected)) {
    res.status(401).send("invalid signature");
    return;
  }

  const payload = JSON.parse(rawBody);

  // Always verify on the server before fulfilling the order:
  // POST <gateway>/api/check-payment with payload.paymentSessionId

  res.status(200).send("ok");
}
```

> Even with a valid signature, it’s still a best practice to verify completion by calling the gateway `/api/check-payment` from your backend.

---

## 6) Minimal end-to-end flow (checklist)

1. (Optional) Convert fiat → HTN using `GET /api/price`.
2. Create a unique `paymentSessionId` (UUID).
3. Redirect buyer to `/pay/session/<paymentSessionId>?amount=<htn>&return_url=...&callback_url=...`.
4. On return and/or callback, your backend calls `POST /api/check-payment`.
5. If `paymentStatus === "completed"`, mark the order paid and deliver the product.

---

## 7) Troubleshooting

### Gateway says `gateway_in_use`

The gateway enforces a short-lived “active session” lock to prevent concurrent checkouts from interfering.

Options:

- Wait and retry (recommended default).
- Offer a “take over” button in your UI if you’re sure the other session is stale.

### Session expired (HTTP 410)

Start a new checkout with a new `paymentSessionId`.

### Callback rejected (403)

Your callback URL’s origin must be listed in `WOOCOMMERCE_ALLOWED_ORIGINS`.

### Pricing seems off

Rates from `/api/price` are **fiat per HTN**. To compute HTN, divide: `fiat / (fiatPerHtn)`.
