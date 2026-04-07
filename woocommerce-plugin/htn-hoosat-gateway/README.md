# HTN Hoosat Gateway (WooCommerce)

This plugin adds a **Hoosat (HTN)** payment method to WooCommerce and redirects customers to a hosted payment page on your HTN gateway.

## Install

1. Zip the folder `htn-hoosat-gateway/`.
2. In WordPress: **Plugins → Add New → Upload Plugin**.
3. Activate the plugin.

## Configure

WooCommerce → Settings → Payments → **HTN (Hoosat)**

- **Gateway Base URL**: `https://<your-gateway-host>`
- **Pricing Mode**:
  - `USD` or `EUR`: converts the order total to HTN using the gateway `/api/price` rate (store currency must match)
  - `HTN`: treats the order total as already being HTN
- **Shared Secret**: must match `WOOCOMMERCE_SHARED_SECRET` on the gateway

## How orders are completed

- Checkout redirects to the gateway hosted page `/pay/session/<sessionId>`.
- The gateway notifies WooCommerce via `/?wc-api=htn_gateway_callback` (signed HMAC).
- The buyer is redirected back via `/?wc-api=htn_gateway_return&order_id=...&key=...`.

WooCommerce always verifies completion by querying the gateway `/api/check-payment` before marking the order paid.
