<?php

if (!defined('ABSPATH')) {
    exit;
}

if (
    class_exists('Automattic\\WooCommerce\\Blocks\\Payments\\Integrations\\AbstractPaymentMethodType') &&
    !class_exists('WC_Gateway_HTN_Hoosat_Blocks_Base')
) {
    abstract class WC_Gateway_HTN_Hoosat_Blocks_Base extends \Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType {
    }
} elseif (
    class_exists('Automattic\\WooCommerce\\Blocks\\Payments\\Integration\\AbstractPaymentMethodType') &&
    !class_exists('WC_Gateway_HTN_Hoosat_Blocks_Base')
) {
    abstract class WC_Gateway_HTN_Hoosat_Blocks_Base extends \Automattic\WooCommerce\Blocks\Payments\Integration\AbstractPaymentMethodType {
    }
}

if (!class_exists('WC_Gateway_HTN_Hoosat_Blocks_Base') || class_exists('WC_Gateway_HTN_Hoosat_Blocks')) {
    return;
}

final class WC_Gateway_HTN_Hoosat_Blocks extends WC_Gateway_HTN_Hoosat_Blocks_Base {
    protected $name = 'htn_hoosat';

    /** @var array<string, mixed> */
    protected $settings = [];

    /** @var HTN_Gateway_For_WooCommerce_Gateway|null */
    private $gateway = null;

    public function initialize() {
        $this->settings = get_option('woocommerce_' . $this->name . '_settings', []);

        if (class_exists('HTN_Gateway_For_WooCommerce_Gateway')) {
            $this->gateway = new HTN_Gateway_For_WooCommerce_Gateway();
        }
    }

    public function is_active() {
        $enabled = $this->settings['enabled'] ?? 'no';
        return $enabled === 'yes';
    }

    public function get_payment_method_script_handles() {
        $script_handle = 'wc-htn-hoosat-blocks';
        $script_path = plugin_dir_path(dirname(__FILE__)) . 'assets/js/checkout-blocks.js';
        $script_url = plugin_dir_url(dirname(__FILE__)) . 'assets/js/checkout-blocks.js';

        wp_register_script(
            $script_handle,
            $script_url,
            ['wc-blocks-registry', 'wc-settings', 'wp-element', 'wp-html-entities'],
            file_exists($script_path) ? (string) filemtime($script_path) : '0.1.0',
            true
        );

        return [$script_handle];
    }

    public function get_payment_method_script_handles_for_admin() {
        return $this->get_payment_method_script_handles();
    }

    public function get_payment_method_data() {
        $gateway = $this->gateway;
        $is_available = $gateway ? $gateway->is_available() : false;

        return [
            'title' => $this->settings['title'] ?? 'Hoosat (HTN)',
            'description' => $this->settings['description'] ?? 'Pay with Hoosat (HTN). You will be redirected to complete payment.',
            'supports' => $gateway ? $gateway->supports : ['products'],
            'isAvailable' => $is_available,
        ];
    }
}