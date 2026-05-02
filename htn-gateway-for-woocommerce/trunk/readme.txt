=== HTN Gateway for WooCommerce ===
Contributors: hoosat
Tags: woocommerce, payments, cryptocurrency, hoosat, htn
Requires at least: 6.0
Tested up to: 6.9
Requires PHP: 8.0
Stable tag: 0.1.1
License: GPLv2
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Accept Hoosat Network (HTN) payments in WooCommerce through your own self-hosted Hoopay payment gateway.

== Description ==
Hoopay for WooCommerce lets your store accept Hoosat Network (HTN) payments without relying on a third-party processor.

This plugin connects WooCommerce to a self-hosted Hoopay gateway instance and redirects the customer to a hosted payment page to complete the payment.

= Important =

This plugin does not work by itself. You must deploy and configure your own Hoopay / HTN Payment Gateway first:

https://github.com/HoosatNetwork/HTN-Payment-Gateway

Plugin features:

* Accept Hoosat Network (HTN) payments in WooCommerce.
* Redirect customers to a hosted payment session.
* Verify signed callbacks from your gateway.
* Confirm completed payments and update WooCommerce orders automatically.
* Support WooCommerce Cart and Checkout Blocks.
* Support live HTN conversion from configured fiat pricing currencies.

The plugin is intended for merchants who want to run their own payment infrastructure and keep control over gateway configuration, secrets, and payout flow.

== Installation ==
1. Install and activate WooCommerce.
2. Deploy your own Hoopay gateway instance by following the gateway project instructions:
	https://github.com/HoosatNetwork/HTN-Payment-Gateway
3. Upload and activate this plugin in WordPress.
4. Go to WooCommerce > Settings > Payments > HTN (Hoosat).
5. Enter your gateway base URL.
6. Enter the shared secret configured on your gateway.
7. Choose the pricing mode that matches your WooCommerce store currency, or use HTN pricing directly.
8. Save the settings and enable the gateway.

== Frequently Asked Questions ==

= Do I need to run my own gateway? =

Yes. This plugin requires a self-hosted Hoopay / HTN Payment Gateway instance. It will not process payments without one.

= Where do I get the gateway software? =

From the official repository:

https://github.com/HoosatNetwork/HTN-Payment-Gateway

= What settings are required in WooCommerce? =

At minimum, you must configure:

* Gateway Base URL
* Shared Secret
* Pricing Mode

The shared secret in WooCommerce must match the shared secret configured on your gateway.

= Does this support WooCommerce Blocks checkout? =

Yes. The plugin includes support for WooCommerce Cart and Checkout Blocks when the required WooCommerce Blocks integration is available.

= How does pricing work? =

You can price orders directly in HTN or use supported fiat currencies. When using fiat pricing, the plugin requests a live conversion rate from your gateway and calculates the required HTN amount for the order.

== Changelog ==
= 0.1.1 =
Initial public release