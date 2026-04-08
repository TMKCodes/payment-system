<?php
/**
 * Plugin Name: HTN Gateway for WooCommerce
 * Description: Accept Hoosat Network (HTN) payments via a self-hosted HTN payment gateway.
 * Version: 0.1.0
 * Author: Toni Lukkaroinen
 * License: GPLv2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Requires at least: 6.0
 * Requires PHP: 8.0
 * WC requires at least: 8.0
 */

if (!defined('ABSPATH')) {
    exit;
}

function htn_hoosat_gateway_is_woocommerce_active(): bool {
    return class_exists('WooCommerce');
}

add_action('plugins_loaded', function () {
    if (!htn_hoosat_gateway_is_woocommerce_active()) {
        return;
    }

    if (!class_exists('WC_Payment_Gateway')) {
        return;
    }

    require_once __DIR__ . '/includes/class-wc-gateway-htn-hoosat.php';

    add_filter('woocommerce_payment_gateways', function (array $gateways): array {
        $gateways[] = 'WC_Gateway_HTN_Hoosat';
        return $gateways;
    });

    // REST-like callbacks via WC API (/?wc-api=...).
    add_action('woocommerce_api_htn_gateway_callback', ['WC_Gateway_HTN_Hoosat', 'handle_callback']);
    add_action('woocommerce_api_htn_gateway_return', ['WC_Gateway_HTN_Hoosat', 'handle_return']);

    // Register a Cart/Checkout Blocks integration when WooCommerce Blocks is available.
    add_action('woocommerce_blocks_loaded', function () {
        require_once __DIR__ . '/includes/class-wc-gateway-htn-hoosat-blocks.php';

        add_action('woocommerce_blocks_payment_method_type_registration', function ($payment_method_registry) {
            if (!class_exists('WC_Gateway_HTN_Hoosat_Blocks')) {
                return;
            }

            if (!is_object($payment_method_registry) || !method_exists($payment_method_registry, 'register')) {
                return;
            }

            $payment_method_registry->register(new WC_Gateway_HTN_Hoosat_Blocks());
        });
    });
});
