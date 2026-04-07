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
   GATEWAY_WALLET_PRIVATE_KEY=33a4a81ecd31615c51385299969121707897fb1e167634196f31bd311de5fe43

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

## Docker

This repo includes a production Dockerfile for the hosted Next.js payment gateway.

## Copy dockerfile to root project

```bash
cp docker/Dockerfile Dockerfile
```

### Build the image

```bash
docker build -t htn-payment-gateway .
```

### Run the container

```bash
docker run --rm -p 3000:3000 \
   -e GATEWAY_WALLET_PRIVATE_KEY=replace-me \
   -e MERCHANT_SWEEP_ADDRESS=hoosat:replace-me \
   -e HOOSAT_NODE_HOST=mainnet-node-1.hoosat.fi \
   -e HOOSAT_NODE_PORT=42420 \
   -e HOOSAT_NODE_TIMEOUT=10000 \
   -e LIVE_RATE_ADJUST_PERCENT=0 \
   -e WOOCOMMERCE_SHARED_SECRET=replace-me \
   -e WOOCOMMERCE_ALLOWED_ORIGINS=https://shop.example.com \
   htn-payment-gateway
```

The container listens on port `3000` and runs the standalone Next.js server with `HOSTNAME=0.0.0.0`.

## Usage

1. Enter the payment amount in HTN, or switch "Price in" to USD/EUR
2. (USD/EUR) The app loads the live USD/HTN rate automatically from `https://api.network.hoosat.fi/info/price?stringOnly=false`
   - The server applies `LIVE_RATE_ADJUST_PERCENT` (if set) to the live rate before showing it
3. (EUR) EUR/HTN is derived from USD/HTN using a USD→EUR FX rate
4. Optionally edit the conversion rate manually, or click "Refresh live rate"
5. Click "Generate Payment QR Code"
6. Display the QR code to the buyer
7. Buyer scans the QR code with their Hoosat wallet to complete the payment

## WooCommerce integration

This repo includes a WooCommerce payment gateway plugin that redirects the customer to a hosted payment page on this gateway.

### Gateway configuration

Add these variables to `.env.local` (or your deployment environment):

```bash
# Used by the gateway to sign WooCommerce callbacks
WOOCOMMERCE_SHARED_SECRET=replace-with-a-long-random-string

# Comma-separated list of allowed WooCommerce site origins for callback/return URLs
# Example:
# WOOCOMMERCE_ALLOWED_ORIGINS=https://shop.example.com,https://staging-shop.example.com
WOOCOMMERCE_ALLOWED_ORIGINS=https://shop.example.com
```

For Docker deployments, pass these values with `docker run -e ...` or via an env file.

### Install the WooCommerce plugin

- Plugin source: [woocommerce-plugin/htn-hoosat-gateway](woocommerce-plugin/htn-hoosat-gateway)
- Zip the folder and upload it in WordPress: **Plugins → Add New → Upload Plugin**

### Configure WooCommerce

1. WooCommerce → Settings → Payments → **HTN (Hoosat)**
2. Set:
   - **Gateway Base URL**: your deployed Next.js gateway (e.g. `https://gateway.example.com`)
   - **Pricing Mode**: `USD`, `EUR`, or `HTN` (for `USD`/`EUR`, your WooCommerce store currency must match)
   - **Shared Secret**: must match `WOOCOMMERCE_SHARED_SECRET`

### Flow (what happens)

- Checkout calls the plugin, which creates a gateway `sessionId` and redirects the buyer to:
  - `/pay/session/<sessionId>?amount=<htn>&order_id=...&order_key=...`
- The hosted page shows a QR code and polls `/api/check-payment` until the payment is confirmed.
- On confirmation, the gateway POSTs a signed callback to the shop and redirects the buyer back to WooCommerce.
- WooCommerce verifies the payment with the gateway and then triggers a **best-effort automatic sweep** by calling `/api/check-payment` with `action: "confirm-transaction"`.

## Built with

- Next.js
- TypeScript
- Tailwind CSS
- **Hoosat Web SDK** - Browser-compatible SDK for Hoosat blockchain integration.
- **Hoosat SDK** - Node-compatible SDK for Hoosat blockchain integration.
