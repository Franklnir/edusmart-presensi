<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class DenyRootDomainAuthAccess
{
    public function handle(Request $request, Closure $next): Response
    {
        if ($this->isRootMarketingHost((string) $request->getHost())) {
            return response()->json([
                'error' => 'Login hanya bisa diakses dari subdomain sekolah atau subdomain admin resmi.',
                'code' => 'ROOT_DOMAIN_AUTH_DISABLED',
            ], 403);
        }

        return $next($request);
    }

    private function isRootMarketingHost(string $host): bool
    {
        $host = $this->normalizeHost($host);
        $root = $this->normalizeHost((string) config('tenancy.root_domain', ''));
        if ($host === '' || $root === '') {
            return false;
        }

        return $host === $root || $host === 'www.'.$root;
    }

    private function normalizeHost(string $host): string
    {
        $host = strtolower(trim($host));
        if ($host === '') {
            return '';
        }

        if (str_contains($host, '://')) {
            $host = (string) parse_url($host, PHP_URL_HOST);
        }

        $host = preg_replace('#/.*$#', '', $host) ?: $host;
        $host = preg_replace('/:\d+$/', '', $host) ?: $host;

        return trim($host, '.');
    }
}
