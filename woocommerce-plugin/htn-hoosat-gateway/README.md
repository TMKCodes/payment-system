# HTN Hoosat Gateway (WooCommerce)

This plugin adds a **Hoosat (HTN)** payment method to WooCommerce and redirects customers to a hosted payment page on your HTN gateway.

It supports both the classic WooCommerce checkout and the Cart/Checkout Blocks checkout.

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

If the gateway is enabled in admin but missing at checkout, the most common causes are:

- the checkout page is using WooCommerce Blocks and the plugin version does not include Blocks support
- **Gateway Base URL** is empty
- **Shared Secret** is empty
- **Pricing Mode** is `USD` or `EUR`, but the WooCommerce store currency does not match

Enable **Debug Log** to record availability failures in WooCommerce → Status → Logs under `htn-hoosat-gateway`.

## How orders are completed

- Checkout redirects to the gateway hosted page `/pay/session/<sessionId>`.
- The gateway notifies WooCommerce via `/?wc-api=htn_gateway_callback` (signed HMAC).
- The buyer is redirected back via `/?wc-api=htn_gateway_return&order_id=...&key=...`.

WooCommerce always verifies completion by querying the gateway `/api/check-payment` before marking the order paid.
