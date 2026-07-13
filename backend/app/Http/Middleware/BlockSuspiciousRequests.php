<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class BlockSuspiciousRequests
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! (bool) config('security.scanner_block.enabled', true) || ! $this->shouldInspect($request)) {
            return $next($request);
        }

        $reason = $this->blockReason($request);
        if ($reason === null) {
            return $next($request);
        }

        $this->recordBlockedRequest($request, $reason);

        return response()->json([
            'message' => 'Permintaan diblokir oleh proteksi keamanan.',
        ], 403);
    }

    private function shouldInspect(Request $request): bool
    {
        if ($request->isMethod('OPTIONS')) {
            return false;
        }

        foreach ($this->configList('security.scanner_block.paths') as $path) {
            if ($path !== '' && $request->is($path)) {
                return true;
            }
        }

        return false;
    }

    private function blockReason(Request $request): ?array
    {
        $ip = (string) $request->ip();
        foreach ($this->configList('security.scanner_block.blocked_ips') as $blockedIp) {
            if ($this->ipMatches($ip, $blockedIp)) {
                return ['type' => 'ip', 'matched' => $blockedIp];
            }
        }

        $userAgent = strtolower((string) $request->userAgent());
        if ($userAgent === '') {
            return null;
        }

        foreach ($this->configList('security.scanner_block.blocked_user_agents') as $signature) {
            $signature = strtolower($signature);
            if ($signature !== '' && str_contains($userAgent, $signature)) {
                return ['type' => 'user_agent', 'matched' => $signature];
            }
        }

        return null;
    }

    private function recordBlockedRequest(Request $request, array $reason): void
    {
        if (! (bool) config('security.scanner_block.audit', true)) {
            return;
        }

        try {
            $auditKey = 'security-block-audit|'.$request->ip().'|'.sha1(($reason['type'] ?? '').'|'.($reason['matched'] ?? ''));
            if (RateLimiter::tooManyAttempts($auditKey, 10)) {
                return;
            }
            RateLimiter::hit($auditKey, 60);

            $payload = [
                'table_name' => 'security_events',
                'record_id' => (string) Str::uuid(),
                'action' => 'INSERT',
                'old_data' => null,
                'new_data' => json_encode([
                    'event' => 'security_blocked_request',
                    'reason' => $reason['type'] ?? 'unknown',
                    'matched' => $reason['matched'] ?? null,
                    'ip' => $request->ip(),
                    'host' => strtolower(trim((string) $request->getHost())),
                    'path' => '/'.ltrim($request->path(), '/'),
                    'method' => $request->method(),
                    'user_agent' => (string) $request->userAgent(),
                ]),
                'user_id' => null,
                'user_role' => null,
                'timestamp' => now(),
            ];

            $tenantId = $request->attributes->get('tenant_id');
            if ($tenantId) {
                $payload['tenant_id'] = $tenantId;
            }

            DB::table('audit_log')->insert($payload);
        } catch (\Throwable $e) {
            // Security blocking must keep working even if audit storage is unavailable.
        }
    }

    private function configList(string $key): array
    {
        $value = config($key, []);
        if (is_string($value)) {
            $value = explode(',', $value);
        }

        return array_values(array_filter(array_map(
            static fn ($item): string => trim((string) $item),
            is_array($value) ? $value : []
        )));
    }

    private function ipMatches(string $ip, string $candidate): bool
    {
        $candidate = trim($candidate);
        if ($candidate === '') {
            return false;
        }

        if (! str_contains($candidate, '/')) {
            return hash_equals($candidate, $ip);
        }

        [$subnet, $bits] = array_pad(explode('/', $candidate, 2), 2, null);
        $bits = filter_var($bits, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
        if ($bits === false || $bits === null) {
            return false;
        }

        $ipBin = @inet_pton($ip);
        $subnetBin = @inet_pton($subnet);
        if ($ipBin === false || $subnetBin === false || strlen($ipBin) !== strlen($subnetBin)) {
            return false;
        }

        $maxBits = strlen($ipBin) * 8;
        if ($bits > $maxBits) {
            return false;
        }

        $bytes = intdiv($bits, 8);
        $remainder = $bits % 8;

        if ($bytes > 0 && substr($ipBin, 0, $bytes) !== substr($subnetBin, 0, $bytes)) {
            return false;
        }

        if ($remainder === 0) {
            return true;
        }

        $mask = (0xFF << (8 - $remainder)) & 0xFF;

        return (ord($ipBin[$bytes]) & $mask) === (ord($subnetBin[$bytes]) & $mask);
    }
}
