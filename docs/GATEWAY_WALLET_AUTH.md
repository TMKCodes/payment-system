# Hoosat Wallet Authentication Gateway

This document describes the project-agnostic wallet authentication flow provided by the HTN gateway.

The flow proves Hoosat wallet ownership by signing an off-chain message. It does not create a payment transaction, does not send a zero-value transfer, and does not charge a network fee.

## Goal

Provide reusable Hoosat wallet-auth primitives for any external application:

1. The application opens the gateway login page or calls the gateway auth API.
2. The gateway creates a single-use auth request.
3. The wallet signs a human-readable login message.
4. The gateway verifies the signature against the wallet public key and address.
5. The gateway creates an HTTP-only auth session cookie for the gateway origin.
6. The integrating application can consume the verified wallet identity through its own redirect/session bridge.

The same gateway supports two signing clients:

- Hoosat browser extension.
- Hoosat mobile wallet through `hoosat://auth/sign` QR/deep-link requests.

## Generic request naming

New integrations should use `requestId`.

`challengeId` is still accepted and returned as a legacy alias for older clients and older mobile wallet builds. It represents the same value as `requestId` and should not be interpreted as an application-specific trading challenge.

## Configuration

Set these environment variables per deployment:

```env
GATEWAY_PUBLIC_BASE_URL=https://gateway.example.com
GATEWAY_AUTH_APP_NAME=Example App
GATEWAY_AUTH_SESSION_COOKIE=example_app_auth_session
```

- `GATEWAY_PUBLIC_BASE_URL` must be reachable by mobile devices because the mobile wallet posts the signed callback there.
- `GATEWAY_AUTH_APP_NAME` appears in the signed message, for example `Example App Wallet Login`.
- `GATEWAY_AUTH_SESSION_COOKIE` lets each project isolate its auth cookie name.

## Security properties

- No payment transaction is created for login.
- The nonce is single-use and expires after 5 minutes.
- The signed message explicitly says it does not authorize a payment.
- Replay protection is enforced by `requestId + nonce + exact message`.
- The session cookie is HTTP-only, `sameSite=lax`, and `secure` in production.
- Wallet public key is required so the gateway can verify both signature and address derivation.
- Mobile QR does not contain the browser claim token, so a photographed QR cannot claim the browser session by itself.

## API

### Create auth request

`POST /api/auth/challenge`

Request:

```json
{
  "address": "hoosat:..."
}
```

Response:

```json
{
  "ok": true,
  "requestId": "uuid",
  "challengeId": "uuid",
  "address": "hoosat:...",
  "nonce": "single-use nonce",
  "message": "Example App Wallet Login\nAddress: ...",
  "issuedAt": "2026-04-29T00:00:00.000Z",
  "expiresAt": "2026-04-29T00:05:00.000Z",
  "note": "Sign this message to prove wallet ownership. This does not authorize a payment."
}
```

`challengeId` is a legacy alias for `requestId`.

### Verify signed auth request

`POST /api/auth/verify`

Request:

```json
{
  "requestId": "uuid",
  "address": "hoosat:...",
  "nonce": "single-use nonce",
  "message": "exact message returned by /api/auth/challenge",
  "signature": "hex encoded ECDSA signature",
  "publicKey": "compressed public key hex"
}
```

Legacy clients may send `challengeId` instead of `requestId`.

Response:

```json
{
  "ok": true,
  "session": {
    "address": "hoosat:...",
    "publicKey": "compressed public key hex",
    "createdAt": "2026-04-29T00:00:00.000Z",
    "expiresAt": "2026-04-30T00:00:00.000Z"
  }
}
```

The response also sets:

```text
Set-Cookie: <GATEWAY_AUTH_SESSION_COOKIE>=...; HttpOnly; SameSite=Lax; Path=/
```

### Read auth session

`GET /api/auth/session`

Response when authenticated:

```json
{
  "ok": true,
  "authenticated": true,
  "session": {
    "address": "hoosat:...",
    "publicKey": "compressed public key hex",
    "createdAt": "2026-04-29T00:00:00.000Z",
    "expiresAt": "2026-04-30T00:00:00.000Z"
  }
}
```

Response when unauthenticated:

```json
{
  "ok": true,
  "authenticated": false,
  "session": null
}
```

### Clear auth session

`DELETE /api/auth/session`

Clears the HTTP-only session cookie and removes the in-memory gateway session.

## Browser integration page

The gateway includes a reference page:

```text
/auth/login
```

This page demonstrates the expected extension integration:

1. Find a wallet provider exposed as `window.hoosat`, `window.hoosatWallet`, or `window.kaspa`.
2. Connect the wallet and read address/public key.
3. Request a gateway nonce.
4. Ask the wallet to sign the exact message.
5. Submit signature and public key to the gateway.

The same page also includes the mobile QR login option.

## Mobile wallet QR API

### Start mobile auth

`POST /api/auth/mobile/start`

Response:

```json
{
  "ok": true,
  "requestId": "uuid",
  "challengeId": "uuid",
  "claimToken": "browser-only secret",
  "nonce": "single-use nonce",
  "message": "Example App Wallet Login\nRequest: ...",
  "callbackUrl": "https://gateway.example.com/api/auth/mobile/complete",
  "authUri": "hoosat://auth/sign?...",
  "qrDataUrl": "data:image/png;base64,...",
  "expiresAt": "2026-04-29T00:05:00.000Z"
}
```

The `authUri` contains:

```text
hoosat://auth/sign?protocol=htn-gateway-auth-v1&requestId=...&nonce=...&message=...&callback=...&expiresAt=...
```

For compatibility, the gateway also includes `challengeId=...` in the QR. New clients should read and submit `requestId`.

The `claimToken` must stay in the browser. It is intentionally not included in `authUri` or QR data.

### Mobile wallet callback

`POST /api/auth/mobile/complete`

The mobile wallet submits:

```json
{
  "requestId": "uuid",
  "address": "hoosat:...",
  "nonce": "single-use nonce",
  "message": "exact message from QR",
  "signedMessage": "exact signed message",
  "messageHash": "hex encoded message hash",
  "signature": "hex encoded Schnorr signature",
  "publicKey": "stable identity public key hex",
  "identityKeyId": "schnorr:<publicKey>",
  "addressPublicKey": "selected display address public key hex",
  "signatureScheme": "hoosat-mobile-identity-schnorr-blake3-v2"
}
```

The gateway accepts `challengeId` as a legacy alias for `requestId`.

### Browser status polling

`GET /api/auth/mobile/status?requestId=...&claimToken=...`

Legacy clients may use `challengeId=...`.

Pending response:

```json
{
  "ok": true,
  "authenticated": false,
  "status": "pending"
}
```

Authenticated response:

```json
{
  "ok": true,
  "authenticated": true,
  "status": "authenticated",
  "session": {
    "address": "hoosat:...",
    "publicKey": "compressed public key hex",
    "identityKeyId": "schnorr:<publicKey>",
    "identityPublicKey": "stable identity public key hex",
    "createdAt": "2026-04-29T00:00:00.000Z",
    "expiresAt": "2026-04-30T00:00:00.000Z"
  }
}
```

This response also sets the configured HTTP-only session cookie in the browser.

## Mobile wallet auth/sign contract

The official mobile wallet should support scanning this URI shape:

```text
hoosat://auth/sign?protocol=htn-gateway-auth-v1&requestId=...&nonce=...&message=...&callback=...&expiresAt=...
```

After user approval, it POSTs the signed payload to `callback`.

Supported protocol values:

- `htn-gateway-auth-v1` for project-agnostic wallet login.
- `hoosat-signed-intent-v1` for generic non-payment wallet intent signatures.

## Browser extension contract

The official browser wallet extension should expose:

- a connect method returning the active wallet address
- a public key getter
- a message signing method that signs arbitrary UTF-8 text using the same ECDSA scheme used by `hoosat-sdk`

Preferred method names:

```ts
window.hoosat.connect()
window.hoosat.getPublicKey()
window.hoosat.signMessage(message)
```

The reference client also tries several compatibility method names, but the official extension should standardize the three methods above.

## Important distinction from payment flow

Wallet authentication proves wallet ownership only.

Project payment flows must stay separate from auth:

```text
Payment -> Verify -> Continue
```

Do not use a zero-value transaction for login. It creates unnecessary chain noise, fee ambiguity, and avoidable UX friction.
