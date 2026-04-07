# HTN payment gateway

A minimal HTN payment gateway for Hoosat cryptocurrency. Allows merchants to create payment requests and display QR codes for buyers to scan and pay.

## Features

- Create payment requests with custom amounts
- Generate QR codes containing Hoosat payment URIs
- **Real payment confirmation checking** via Hoosat blockchain using the official Hoosat SDK
- **Seperate payment gateway** - all payments go to your configured payment gateway wallet
- Automatic payment confirmation when funds are received and sweeped upwards to merchants configured wallet
- Live fiat pricing (USD/HTN from Hoosat network API; EUR/HTN derived via USD→EUR FX rate)

## Setup

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Configure merchant wallet:**

   Create a `.env.local` file in the project root:

   ```bash
   # Payment Gateway Wallet Configuration
   # Replace this with your actual Hoosat private key (64-character hex string) can be generated with genkeypair
   MERCHANT_PRIVATE_KEY=33a4a81ecd31615c51385299969121707897fb1e167634196f31bd311de5fe43

   # Destination address for sweeping payment gateway funds after payment confirmation
   MERCHANT_SWEEP_ADDRESS=hoosat:qzemxtcz54tvjcd5pwvh8d494997k762md4t8q9aw3kxjy4qjtmtsqtdlw3gh

   # Hoosat SDK node configuration
   HOOSAT_NODE_HOST=mainnet-node-1.hoosat.fi
   HOOSAT_NODE_PORT=42420
   HOOSAT_NODE_TIMEOUT=10000

   # (Optional) Default conversion rates when pricing in USD or EUR
   # UI expects "USD per HTN" and "EUR per HTN" (examples only)
   NEXT_PUBLIC_USD_PER_HTN=0.12
   NEXT_PUBLIC_EUR_PER_HTN=0.11

   # (Optional) Automatically adjust fetched live rates by a percentage
   # Example: 2.5 increases USD/HTN and EUR/HTN by 2.5%
   # Example: -1 applies a 1% discount
   LIVE_RATE_ADJUST_PERCENT=0

   # Legacy (supported): previous direction ("HTN per USD/EUR")
   # NEXT_PUBLIC_USD_TO_HTN_RATE=12.5
   # NEXT_PUBLIC_EUR_TO_HTN_RATE=13.1
   ```

3. **Run the development server:**
   ```bash
   npm run dev
   ```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the merchant interface.

## Shopify integration (self-hosted gateway)

This repo can also act as a self-hosted crypto gateway for Shopify by using a **manual payment method** that sends customers to a hosted payment page on this app.

### What you get

- A hosted payment page at `/pay/<orderId>?shop=<shop-domain>` that shows a Hoosat QR for the exact order total (USD/EUR → HTN using live rates).
- Automatic on-chain polling (via `/api/check-payment`) and a button/auto-attempt to mark the Shopify order as paid once confirmed.

### Shopify prerequisites

- Shopify Partner account
- A Shopify App (custom app or public app) with Admin API access
- A public URL for your gateway (use a tunnel like `cloudflared` or `ngrok` in dev)

### Environment variables

Add these to `.env.local`:

```bash
# Required for Shopify OAuth install flow
SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...

# Public base URL of this app (must match Shopify redirect URLs)
# Example (dev tunnel): https://your-subdomain.ngrok.app
SHOPIFY_APP_URL=https://your-gateway.example

# Optional: scopes used during install
SHOPIFY_SCOPES=read_orders,write_orders

# Optional: Shopify API version (defaults in code)
SHOPIFY_API_VERSION=2025-01

# "Single-shop" mode (no OAuth) - useful for local self-run demos
# If set, the app can access your store without installing via /api/shopify/install
SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_...
```

### Install (OAuth) flow

1. Create an app in Shopify Partners.
2. Set the app URL to `SHOPIFY_APP_URL`.
3. Add redirect URL:
   - `${SHOPIFY_APP_URL}/api/shopify/callback`
4. Start install:
   - `GET /api/shopify/install?shop=your-store.myshopify.com`

Tokens are stored locally in `.data/shopify-tokens.json` for development.

### Configure Shopify to use HTN as a manual payment method

In your Shopify admin:

1. Go to **Settings → Payments**.
2. In **Manual payment methods**, add a new method (e.g. "HTN Crypto").
3. In the instructions, include a link to the hosted payment page:

```
Pay your order with HTN here:
https://YOUR_GATEWAY_HOST/pay/{{ order.id }}?shop=YOUR_SHOP_DOMAIN
```

Notes:

- `{{ order.id }}` is the numeric Shopify order id.
- `YOUR_SHOP_DOMAIN` is usually `your-store.myshopify.com`.

### End-to-end customer flow

1. Customer checks out and chooses the manual method ("HTN Crypto").
2. Customer clicks the payment link and pays via QR.
3. The page polls the Hoosat chain; when confirmed it calls `/api/shopify/mark-paid` to mark the order paid.

### Key endpoints

- `GET /api/shopify/order-payment?shop=...&orderId=...` (builds the HTN amount + initializes the payment session)
- `POST /api/check-payment` (polls on-chain state)
- `POST /api/shopify/mark-paid` (marks the order paid when the on-chain payment is complete)
- `GET /pay/<orderId>?shop=...` (hosted customer payment page)

## Usage

1. Enter the payment amount in HTN, or switch "Price in" to USD/EUR
2. (USD/EUR) The app loads the live USD/HTN rate automatically from `https://api.network.hoosat.fi/info/price?stringOnly=false`
   - The server applies `LIVE_RATE_ADJUST_PERCENT` (if set) to the live rate before showing it
3. (EUR) EUR/HTN is derived from USD/HTN using a USD→EUR FX rate
4. Optionally edit the conversion rate manually, or click "Refresh live rate"
5. Click "Generate Payment QR Code"
6. Display the QR code to the buyer
7. Buyer scans the QR code with their Hoosat wallet to complete the payment

## Built with

- Next.js
- TypeScript
- Tailwind CSS
- **Hoosat Web SDK** - Browser-compatible SDK for Hoosat blockchain integration.
- **Hoosat SDK** - Node-compatible SDK for Hoosat blockchain integration.
