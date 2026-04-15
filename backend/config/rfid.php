<?php

return [
    'shared_key' => env('RFID_SCAN_SHARED_KEY'),

    'mqtt' => [
        'enabled' => filter_var(env('RFID_MQTT_BRIDGE_ENABLED', false), FILTER_VALIDATE_BOOL),
        'host' => env('RFID_MQTT_HOST', ''),
        'port' => (int) env('RFID_MQTT_PORT', 8883),
        'username' => env('RFID_MQTT_USERNAME', ''),
        'password' => env('RFID_MQTT_PASSWORD', ''),
        'client_id_prefix' => env('RFID_MQTT_CLIENT_ID_PREFIX', 'edusmart-rfid-bridge'),
        'qos' => (int) env('RFID_MQTT_QOS', 1),
        'connect_timeout' => (int) env('RFID_MQTT_CONNECT_TIMEOUT', 20),
        'socket_timeout' => (int) env('RFID_MQTT_SOCKET_TIMEOUT', 5),
        'keep_alive' => (int) env('RFID_MQTT_KEEP_ALIVE', 20),
        'reconnect_delay_seconds' => (int) env('RFID_MQTT_RECONNECT_DELAY', 5),
        'mode_sync_interval_seconds' => (int) env('RFID_MQTT_MODE_SYNC_INTERVAL', 20),

        'use_tls' => filter_var(env('RFID_MQTT_USE_TLS', true), FILTER_VALIDATE_BOOL),
        'tls_verify_peer' => filter_var(env('RFID_MQTT_TLS_VERIFY_PEER', true), FILTER_VALIDATE_BOOL),
        'tls_verify_peer_name' => filter_var(env('RFID_MQTT_TLS_VERIFY_PEER_NAME', true), FILTER_VALIDATE_BOOL),
        'tls_allow_self_signed' => filter_var(env('RFID_MQTT_TLS_ALLOW_SELF_SIGNED', false), FILTER_VALIDATE_BOOL),

        'scan_topic_template' => env('RFID_MQTT_SCAN_TOPIC_TEMPLATE', 'edusmart/{tenant}/rfid/scan'),
        'scan_topic_filter' => env('RFID_MQTT_SCAN_TOPIC_FILTER', ''),
        'response_topic_template' => env('RFID_MQTT_RESPONSE_TOPIC_TEMPLATE', 'edusmart/{tenant}/rfid/response'),
        'mode_topic_template' => env('RFID_MQTT_MODE_TOPIC_TEMPLATE', 'edusmart/{tenant}/rfid/mode'),

        'default_tenant_slug' => env('RFID_MQTT_DEFAULT_TENANT_SLUG', ''),
        'device_tenant_map' => env('RFID_MQTT_DEVICE_TENANT_MAP', '{}'),
    ],
];
