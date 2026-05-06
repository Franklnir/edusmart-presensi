<?php

$csv = static fn (string $key, string $default = ''): array => array_values(array_filter(array_map(
    static fn (string $value): string => trim($value),
    explode(',', (string) env($key, $default))
)));

return [
    'scanner_block' => [
        'enabled' => filter_var(env('SECURITY_SCANNER_BLOCK_ENABLED', true), FILTER_VALIDATE_BOOL),
        'audit' => filter_var(env('SECURITY_SCANNER_BLOCK_AUDIT', true), FILTER_VALIDATE_BOOL),
        'paths' => ['api/*', 'sanctum/*'],
        'blocked_ips' => $csv('SECURITY_BLOCKED_IPS'),
        'blocked_user_agents' => $csv(
            'SECURITY_BLOCKED_USER_AGENTS',
            'sqlmap,nikto,acunetix,nessus,nuclei,zgrab,masscan,dirbuster,gobuster,ffuf,wpscan'
        ),
    ],
];
