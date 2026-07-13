<?php

$adminSubdomain = strtolower(trim((string) env('TENANT_ADMIN_SUBDOMAIN', 'admin26')));
$reservedSubdomains = array_values(array_unique(array_filter(array_map(
    static fn ($item) => strtolower(trim((string) $item)),
    array_merge(
        explode(',', (string) env('TENANT_RESERVED', 'www,app,api,admin')),
        [$adminSubdomain]
    )
))));

return [
    'default_slug' => env('TENANT_DEFAULT_SLUG', 'default'),
    'root_domain' => env('TENANT_ROOT_DOMAIN', ''),
    'admin_subdomain' => $adminSubdomain,
    'admin_hosts' => array_values(array_filter(array_map('trim', explode(',', env('TENANT_ADMIN_HOSTS', ''))))),
    'allow_root_for_super_admin' => filter_var(env('TENANT_ALLOW_ROOT_FOR_SUPER_ADMIN', false), FILTER_VALIDATE_BOOL),
    'allow_header_override' => filter_var(env('TENANT_ALLOW_HEADER_OVERRIDE', false), FILTER_VALIDATE_BOOL),
    'reserved_subdomains' => $reservedSubdomains,
    'header' => env('TENANT_HEADER', 'X-Tenant'),
    'edge_proxy_secret' => env('TENANT_EDGE_PROXY_SECRET', ''),
    'require_edge_proxy' => filter_var(env('TENANT_REQUIRE_EDGE_PROXY', false), FILTER_VALIDATE_BOOL),
    'edge_origin_host' => env('TENANT_EDGE_ORIGIN_HOST', ''),
    'edge_secret_header' => env('TENANT_EDGE_SECRET_HEADER', 'X-Sismu-Edge-Secret'),
    'edge_forwarded_host_header' => env('TENANT_EDGE_FORWARDED_HOST_HEADER', 'X-Sismu-Forwarded-Host'),
    'public_scheme' => env('TENANT_PUBLIC_SCHEME', parse_url((string) env('APP_URL', 'https://localhost'), PHP_URL_SCHEME) ?: 'https'),
    'dns_a_record' => env('TENANT_DNS_A_RECORD', ''),
    'dns_cname_target' => env('TENANT_DNS_CNAME_TARGET', parse_url((string) env('APP_URL', ''), PHP_URL_HOST) ?: ''),
];
