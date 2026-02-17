<?php

return [
    'default_slug' => env('TENANT_DEFAULT_SLUG', 'default'),
    'root_domain' => env('TENANT_ROOT_DOMAIN', ''),
    'admin_subdomain' => env('TENANT_ADMIN_SUBDOMAIN', 'admin'),
    'admin_hosts' => array_values(array_filter(array_map('trim', explode(',', env('TENANT_ADMIN_HOSTS', ''))))),
    'allow_root_for_super_admin' => filter_var(env('TENANT_ALLOW_ROOT_FOR_SUPER_ADMIN', false), FILTER_VALIDATE_BOOL),
    'allow_header_override' => filter_var(env('TENANT_ALLOW_HEADER_OVERRIDE', false), FILTER_VALIDATE_BOOL),
    'reserved_subdomains' => array_filter(array_map('trim', explode(',', env('TENANT_RESERVED', 'www,app,api,admin')))),
    'header' => env('TENANT_HEADER', 'X-Tenant'),
];
