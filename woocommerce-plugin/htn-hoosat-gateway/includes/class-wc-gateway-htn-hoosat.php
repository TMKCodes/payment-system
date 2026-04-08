<?php

if (!defined('ABSPATH')) {
    exit;
}

class WC_Gateway_HTN_Hoosat extends WC_Payment_Gateway {
    private const SUPPORTED_PRICING_CURRENCIES = [
        'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN',
        'BAM', 'BBD', 'BDT', 'BIF', 'BMD', 'BND', 'BOB', 'BRL', 'BSD', 'BWP', 'BYN', 'BZD',
        'CAD', 'CDF', 'CHF', 'CLP', 'CNY', 'COP', 'CRC', 'CVE', 'CZK',
        'DJF', 'DKK', 'DOP', 'DZD',
        'EGP', 'ETB', 'EUR',
        'FJD', 'FKP',
        'GBP', 'GEL', 'GIP', 'GMD', 'GNF',
        'GTQ', 'GYD',
        'HKD', 'HNL', 'HTG', 'HUF',
        'IDR', 'ILS', 'INR', 'ISK',
        'JMD', 'JPY',
        'KES', 'KGS', 'KHR', 'KMF', 'KRW', 'KYD', 'KZT',
        'LAK', 'LBP', 'LKR', 'LRD', 'LSL',
        'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MUR', 'MVR', 'MWK', 'MXN', 'MYR', 'MZN',
        'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD',
        'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG',
        'QAR',
        'RON', 'RSD', 'RUB', 'RWF',
        'SAR', 'SBD', 'SCR', 'SEK', 'SGD', 'SHP', 'SLE', 'SOS', 'SRD', 'STD', 'SZL',
        'THB', 'TJS', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS',
        'UAH', 'UGX', 'USD', 'UYU', 'UZS',
        'VND', 'VUV',
        'WST',
        'XAF', 'XCD', 'XCG', 'XOF', 'XPF',
        'YER',
        'ZAR', 'ZMW',
    ];

    public function __construct() {
        $this->id = 'htn_hoosat';
        $this->method_title = 'HTN (Hoosat)';
        $this->method_description = 'Pay with Hoosat (HTN) using an external hosted gateway page. You need to run self hosted HTN Payment Gateway and this plugin will connect to the payment gateway.';
        $this->has_fields = false;

        $this->supports = [
            'products',
        ];

        $this->init_form_fields();
        $this->init_settings();

        $this->title = (string) $this->get_option('title', 'Hoosat (HTN)');
        $this->description = (string) $this->get_option('description', 'Pay with Hoosat (HTN)');

        add_action('woocommerce_update_options_payment_gateways_' . $this->id, [$this, 'process_admin_options']);
    }

    public function init_form_fields() {
        $this->form_fields = [
            'enabled' => [
                'title' => 'Enable/Disable',
                'type' => 'checkbox',
                'label' => 'Enable HTN Hoosat Gateway',
                'default' => 'no',
            ],
            'title' => [
                'title' => 'Title',
                'type' => 'text',
                'description' => 'Title shown to customers at checkout.',
                'default' => 'Hoosat (HTN)',
                'desc_tip' => true,
            ],
            'description' => [
                'title' => 'Description',
                'type' => 'textarea',
                'description' => 'Description shown to customers at checkout.',
                'default' => 'Pay with Hoosat (HTN). You will be redirected to complete payment.',
                'desc_tip' => true,
            ],
            'gateway_url' => [
                'title' => 'Gateway Base URL',
                'type' => 'text',
                'description' => 'Example: https://gateway.example.com (no trailing slash recommended).',
                'default' => '',
                'desc_tip' => true,
            ],
            'pricing_mode' => [
                'title' => 'Pricing Mode',
                'type' => 'select',
                'description' => 'How to interpret the WooCommerce order total when converting to HTN.',
                'default' => 'USD',
                'options' => $this->pricing_mode_options(),
                'desc_tip' => true,
            ],
            'shared_secret' => [
                'title' => 'Shared Secret',
                'type' => 'password',
                'description' => 'Must match WOOCOMMERCE_SHARED_SECRET on the gateway. Used to verify signed callbacks.',
                'default' => '',
                'desc_tip' => true,
            ],
            'debug' => [
                'title' => 'Debug Log',
                'type' => 'checkbox',
                'label' => 'Enable logging',
                'default' => 'no',
                'description' => 'Logs to WooCommerce > Status > Logs.',
            ],
        ];
    }

    public function validate_gateway_url_field($key, $value) {
        $value = is_string($value) ? trim(wp_unslash($value)) : '';
        $value = esc_url_raw($value, ['http', 'https']);
        return rtrim($value, '/');
    }

    public function validate_shared_secret_field($key, $value) {
        $value = is_string($value) ? wp_unslash($value) : '';
        return sanitize_text_field($value);
    }

    private static function get_request_string(array $source, string $key): string {
        if (!isset($source[$key]) || !is_scalar($source[$key])) {
            return '';
        }

        return sanitize_text_field(wp_unslash((string) $source[$key]));
    }

    private function log(string $message, array $context = []): void {
        $debug = $this->get_option('debug', 'no') === 'yes';
        if (!$debug) {
            return;
        }

        $logger = wc_get_logger();
        $logger->info($message . (!empty($context) ? ' ' . wp_json_encode($context) : ''), ['source' => 'htn-hoosat-gateway']);
    }

    private function unavailable(string $reason, array $context = []): bool {
        $this->log('Gateway unavailable: ' . $reason, $context);
        return false;
    }

    private function gateway_base_url(): string {
        $raw = (string) $this->get_option('gateway_url', '');
        $raw = esc_url_raw(trim($raw), ['http', 'https']);
        return rtrim($raw, '/');
    }

    private function shared_secret(): string {
        return sanitize_text_field((string) $this->get_option('shared_secret', ''));
    }

    private function pricing_mode_options(): array {
        $options = [
            'USD' => 'USD (converted to HTN using gateway live rate)',
            'EUR' => 'EUR (converted to HTN using gateway live rate)',
        ];

        foreach (self::SUPPORTED_PRICING_CURRENCIES as $currency) {
            if (isset($options[$currency])) {
                continue;
            }

            $options[$currency] = $currency . ' (converted to HTN using gateway live rate)';
        }

        return $options;
    }

    private function supported_pricing_modes(): array {
        return array_merge(['HTN'], self::SUPPORTED_PRICING_CURRENCIES);
    }

    private function pricing_mode(): string {
        $mode = (string) $this->get_option('pricing_mode', 'USD');
        $mode = strtoupper(trim($mode));
        return in_array($mode, $this->supported_pricing_modes(), true) ? $mode : 'USD';
    }

    public function is_available(): bool {
        if (!parent::is_available()) {
            return $this->unavailable('parent gateway availability check failed');
        }

        $gatewayUrl = $this->gateway_base_url();
        if ($gatewayUrl === '') {
            return $this->unavailable('missing gateway base URL');
        }

        $secret = $this->shared_secret();
        if ($secret === '') {
            return $this->unavailable('missing shared secret');
        }

        // If using fiat conversion, the store currency should match the configured pricing mode.
        $mode = $this->pricing_mode();
        if ($mode !== 'HTN') {
            $currency = get_woocommerce_currency();
            if (strtoupper($currency) !== $mode) {
                return $this->unavailable('store currency does not match pricing mode', [
                    'store_currency' => strtoupper($currency),
                    'pricing_mode' => $mode,
                ]);
            }
        }

        return true;
    }

    public function process_payment($order_id) {
        $order = wc_get_order($order_id);
        if (!$order) {
            wc_add_notice('Order not found', 'error');
            return ['result' => 'failure'];
        }

        $gatewayUrl = $this->gateway_base_url();
        $secret = $this->shared_secret();
        if ($gatewayUrl === '' || $secret === '') {
            wc_add_notice('Payment gateway is not configured', 'error');
            return ['result' => 'failure'];
        }

        $mode = $this->pricing_mode();
        $total = (float) $order->get_total();

        $amountHtn = $this->convert_to_htn($total, $mode);
        if ($amountHtn === null || $amountHtn <= 0) {
            wc_add_notice('Failed to calculate HTN amount', 'error');
            return ['result' => 'failure'];
        }

        // Round UP to 8 decimals to avoid underpayment due to floating point.
        $amountHtnRounded = ceil($amountHtn * 100000000.0) / 100000000.0;
        $amountHtnStr = number_format($amountHtnRounded, 8, '.', '');

        $sessionId = wp_generate_uuid4();

        $order->update_meta_data('_htn_payment_session_id', $sessionId);
        $order->update_meta_data('_htn_amount_htn', $amountHtnStr);
        $order->update_meta_data('_htn_pricing_mode', $mode);
        $order->save();

        $order->update_status('on-hold', 'Awaiting HTN payment');

        $returnUrl = add_query_arg([
            'wc-api' => 'htn_gateway_return',
            'order_id' => $order->get_id(),
            'key' => $order->get_order_key(),
        ], home_url('/'));

        $callbackUrl = add_query_arg([
            'wc-api' => 'htn_gateway_callback',
        ], home_url('/'));

        $redirectUrl = $gatewayUrl . '/pay/session/' . rawurlencode($sessionId) . '?' . http_build_query([
            'amount' => $amountHtnStr,
            'order_id' => (string) $order->get_id(),
            'order_key' => (string) $order->get_order_key(),
            'return_url' => $returnUrl,
            'callback_url' => $callbackUrl,
            'label' => 'Order ' . $order->get_order_number(),
        ]);

        $this->log('Redirecting to hosted pay session', [
            'order_id' => $order->get_id(),
            'session_id' => $sessionId,
            'amount_htn' => $amountHtnStr,
        ]);

        return [
            'result' => 'success',
            'redirect' => $redirectUrl,
        ];
    }

    private function fetch_gateway_json(string $path, array $args = []): array {
        $url = $this->gateway_base_url() . $path;
        $defaults = [
            'timeout' => 15,
            'headers' => [
                'Accept' => 'application/json',
            ],
        ];
        $response = wp_remote_request($url, array_merge($defaults, $args));

        if (is_wp_error($response)) {
            throw new Exception($response->get_error_message());
        }

        $status = (int) wp_remote_retrieve_response_code($response);
        $body = (string) wp_remote_retrieve_body($response);

        if ($status < 200 || $status >= 300) {
            throw new Exception('Gateway request failed (' . $status . '): ' . substr($body, 0, 500));
        }

        $data = json_decode($body, true);
        if (!is_array($data)) {
            throw new Exception('Invalid gateway JSON response');
        }

        return $data;
    }

    private function convert_to_htn(float $total, string $mode): ?float {
        if ($mode === 'HTN') {
            return $total;
        }

        try {
            $price = $this->fetch_gateway_json('/api/price', [
                'method' => 'GET',
            ]);

            if (isset($price['pricesPerHtn']) && is_array($price['pricesPerHtn']) && isset($price['pricesPerHtn'][$mode])) {
                $rate = (float) $price['pricesPerHtn'][$mode];
                if ($rate <= 0) {
                    return null;
                }
                return $total / $rate;
            }

            return null;
        } catch (Exception $e) {
            $this->log('Failed to convert to HTN', ['error' => $e->getMessage()]);
            return null;
        }
    }

    private function fetch_merchant_address(): string {
        $data = $this->fetch_gateway_json('/api/merchant/address', ['method' => 'GET']);
        if (!isset($data['address']) || !is_string($data['address']) || $data['address'] === '') {
            throw new Exception('Gateway did not return an address');
        }
        return $data['address'];
    }

    private function check_payment_status(string $address, string $amountHtn, string $sessionId, ?string $action = null): array {
        $payload = [
            'address' => $address,
            'amount' => $amountHtn,
            'sessionId' => $sessionId,
        ];

        if (is_string($action) && $action !== '') {
            $payload['action'] = $action;
        }

        return $this->fetch_gateway_json('/api/check-payment', [
            'method' => 'POST',
            'headers' => [
                'Accept' => 'application/json',
                'Content-Type' => 'application/json',
            ],
            'body' => wp_json_encode($payload),
        ]);
    }

    private function verify_and_complete_order(WC_Order $order): bool {
        $sessionId = (string) $order->get_meta('_htn_payment_session_id', true);
        $amountHtn = (string) $order->get_meta('_htn_amount_htn', true);

        if ($sessionId === '' || $amountHtn === '') {
            return false;
        }

        $address = $this->fetch_merchant_address();

        // First verify the payment is complete.
        $status = $this->check_payment_status($address, $amountHtn, $sessionId);

        if (!isset($status['paymentStatus'])) {
            return false;
        }

        if ($status['paymentStatus'] !== 'completed') {
            return false;
        }

        // Attempt an automatic sweep to the merchant sweep address.
        // This is best-effort: sweep failures should not block order completion.
        try {
            $sweepStatus = $this->check_payment_status($address, $amountHtn, $sessionId, 'confirm-transaction');

            if (
                isset($sweepStatus['paymentDetails']['sweepTransactionHash']) &&
                is_string($sweepStatus['paymentDetails']['sweepTransactionHash']) &&
                $sweepStatus['paymentDetails']['sweepTransactionHash'] !== ''
            ) {
                $order->update_meta_data('_htn_sweep_transaction_hash', (string) $sweepStatus['paymentDetails']['sweepTransactionHash']);
            }
        } catch (Exception $e) {
            $this->log('Sweep attempt failed (non-blocking)', ['error' => $e->getMessage()]);
        }

        $txid = '';
        if (isset($status['paymentDetails']['transactionHash']) && is_string($status['paymentDetails']['transactionHash'])) {
            $txid = $status['paymentDetails']['transactionHash'];
        }

        if ($order->is_paid()) {
            return true;
        }

        $order->payment_complete($txid);
        $order->add_order_note('HTN payment confirmed' . ($txid !== '' ? (': ' . $txid) : ''));
        if ($txid !== '') {
            $order->update_meta_data('_htn_transaction_hash', $txid);
        }
        $order->save();

        return true;
    }

    private function verify_signature(string $rawBody, string $signatureHeader): bool {
        $secret = $this->shared_secret();
        if ($secret === '') {
            return false;
        }

        $sig = trim($signatureHeader);
        if (stripos($sig, 'sha256=') === 0) {
            $sig = substr($sig, 7);
        }

        if ($sig === '') {
            return false;
        }

        $computed = hash_hmac('sha256', $rawBody, $secret);

        // Use hash_equals to prevent timing attacks.
        return hash_equals($computed, $sig);
    }

    private static function get_gateway_instance(): ?self {
        if (class_exists(self::class)) {
            try {
                return new self();
            } catch (Exception $e) {
                // Fall through to the runtime registry lookup below.
            }
        }

        if (!function_exists('WC')) {
            return null;
        }
        $wc = WC();
        if (!$wc || !isset($wc->payment_gateways)) {
            return null;
        }
        $gateways = $wc->payment_gateways->payment_gateways();
        if (!isset($gateways['htn_hoosat'])) {
            return null;
        }
        $gateway = $gateways['htn_hoosat'];
        return ($gateway instanceof self) ? $gateway : null;
    }

    public static function handle_callback() {
        $gateway = self::get_gateway_instance();
        if (!$gateway) {
            status_header(500);
            echo esc_html__('Gateway not initialized', 'htn-hoosat-gateway');
            exit;
        }

        $rawBody = file_get_contents('php://input');
        $signatureHeader = self::get_request_string($_SERVER, 'HTTP_X_HTN_SIGNATURE');

        if (!$gateway->verify_signature((string) $rawBody, $signatureHeader)) {
            $gateway->log('Invalid callback signature');
            wp_send_json_error(['error' => 'Invalid signature'], 401);
        }

        $data = json_decode((string) $rawBody, true);
        if (!is_array($data)) {
            wp_send_json_error(['error' => 'Invalid JSON'], 400);
        }

        $orderId = isset($data['orderId']) ? (int) $data['orderId'] : 0;
        $orderKey = isset($data['orderKey']) ? (string) $data['orderKey'] : '';
        $paymentSessionId = isset($data['paymentSessionId']) ? (string) $data['paymentSessionId'] : '';

        if ($orderId <= 0 || $orderKey === '' || $paymentSessionId === '') {
            wp_send_json_error(['error' => 'Missing fields'], 400);
        }

        $order = wc_get_order($orderId);
        if (!$order) {
            wp_send_json_error(['error' => 'Order not found'], 404);
        }

        if ($order->get_order_key() !== $orderKey) {
            wp_send_json_error(['error' => 'Order key mismatch'], 403);
        }

        $storedSessionId = (string) $order->get_meta('_htn_payment_session_id', true);
        if ($storedSessionId !== $paymentSessionId) {
            wp_send_json_error(['error' => 'Session mismatch'], 403);
        }

        try {
            $completed = $gateway->verify_and_complete_order($order);
            if (!$completed) {
                wp_send_json_error(['error' => 'Payment not completed'], 409);
            }

            wp_send_json_success(['ok' => true]);
        } catch (Exception $e) {
            $gateway->log('Callback processing error', ['error' => $e->getMessage()]);
            wp_send_json_error(['error' => 'Internal callback processing error'], 500);
        }
    }

    public static function handle_return() {
        $gateway = self::get_gateway_instance();
        if (!$gateway) {
            status_header(500);
            echo esc_html__('Gateway not initialized', 'htn-hoosat-gateway');
            exit;
        }

        $orderId = absint(self::get_request_string($_GET, 'order_id'));
        $orderKey = self::get_request_string($_GET, 'key');
        $paymentSessionId = self::get_request_string($_GET, 'htn_session');
        $returnStatus = strtolower(self::get_request_string($_GET, 'htn_status'));

        if ($orderId <= 0 || $orderKey === '') {
            wc_add_notice('Invalid return parameters', 'error');
            wp_safe_redirect(wc_get_checkout_url());
            exit;
        }

        $order = wc_get_order($orderId);
        if (!$order) {
            wc_add_notice('Order not found', 'error');
            wp_safe_redirect(wc_get_checkout_url());
            exit;
        }

        if ($order->get_order_key() !== $orderKey) {
            wc_add_notice('Invalid order key', 'error');
            wp_safe_redirect(wc_get_checkout_url());
            exit;
        }

        if ($paymentSessionId !== '') {
            $storedSessionId = (string) $order->get_meta('_htn_payment_session_id', true);
            if ($storedSessionId !== '' && $storedSessionId !== $paymentSessionId) {
                wc_add_notice('Payment session mismatch', 'error');
                wp_safe_redirect($order->get_checkout_payment_url());
                exit;
            }
        }

        if ($returnStatus === 'cancel' || $returnStatus === 'cancelled') {
            $order->add_order_note('Buyer cancelled HTN payment on hosted gateway page.');
            wc_add_notice('HTN payment was cancelled. You can try again.', 'notice');
            wp_safe_redirect($order->get_checkout_payment_url());
            exit;
        }

        if ($order->is_paid()) {
            wp_safe_redirect($order->get_checkout_order_received_url());
            exit;
        }

        try {
            $completed = $gateway->verify_and_complete_order($order);
            if ($completed) {
                wp_safe_redirect($order->get_checkout_order_received_url());
                exit;
            }

            wc_add_notice('Payment not confirmed yet. Please wait a moment and refresh.', 'notice');
            wp_safe_redirect($order->get_checkout_payment_url());
            exit;
        } catch (Exception $e) {
            $gateway->log('Return handler error', ['error' => $e->getMessage()]);
            wc_add_notice('Error verifying payment. Please try again or contact support.', 'error');
            wp_safe_redirect($order->get_checkout_payment_url());
            exit;
        }
    }
}
