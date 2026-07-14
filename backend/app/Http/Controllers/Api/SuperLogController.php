<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\SuperLogResource;
use App\Models\FrontendErrorLog;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;

class SuperLogController extends ApiController
{
    private const MAX_BYTES_PER_FILE = 4194304;

    private const MAX_PARSED_ENTRIES = 5000;

    private const SENSITIVE_KEYS = [
        'app_key',
        'password',
        'passwd',
        'secret',
        'token',
        'access_token',
        'refresh_token',
        'api_key',
        'apikey',
        'authorization',
        'cookie',
        'session',
        'xsrf',
        'csrf',
        'database_url',
        'db_password',
        'env',
        'environment',
        'credential',
        'credentials',
        'key',
    ];

    public function index(Request $request)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $filters = $this->normalizeFilters($request);
        $page = max(1, (int) $request->query('page', 1));
        $perPage = min(100, max(10, (int) $request->query('per_page', 20)));

        $entries = $this->readEntries($filters);
        $total = count($entries);
        $items = array_slice($entries, ($page - 1) * $perPage, $perPage);

        return $this->ok([
            'summary' => $this->todaySummary(),
            'rows' => SuperLogResource::collection($items)->resolve($request),
            'pagination' => [
                'page' => $page,
                'per_page' => $perPage,
                'total' => $total,
                'last_page' => max(1, (int) ceil($total / $perPage)),
            ],
            'filters' => [
                'levels' => ['emergency', 'alert', 'critical', 'error', 'warning', 'notice', 'info', 'debug'],
                'endpoints' => $this->endpointOptions(),
            ],
            'generated_at' => now()->toIso8601String(),
        ]);
    }

    public function show(Request $request, string $id)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        foreach ($this->readEntries([], self::MAX_PARSED_ENTRIES) as $entry) {
            if (($entry['id'] ?? '') === $id) {
                return $this->ok((new SuperLogResource($entry))->resolve($request));
            }
        }

        return response()->json(['message' => 'Log tidak ditemukan atau sudah ter-rotate.'], 404);
    }

    private function normalizeFilters(Request $request): array
    {
        $from = $this->parseDateInput($request->query('from'));
        $to = $this->parseDateInput($request->query('to'));
        if ($to) {
            $to = $to->endOfDay();
        }

        return [
            'from' => $from,
            'to' => $to,
            'level' => Str::lower((string) $request->query('level', '')),
            'endpoint' => trim((string) $request->query('endpoint', '')),
            'q' => Str::lower(trim((string) $request->query('q', ''))),
        ];
    }

    private function parseDateInput($value): ?Carbon
    {
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }

        try {
            return Carbon::parse($value, config('app.timezone'));
        } catch (\Throwable) {
            return null;
        }
    }

    private function todaySummary(): array
    {
        $today = now()->startOfDay();
        $entries = $this->readEntries([
            'from' => $today,
            'to' => $today->copy()->endOfDay(),
            'level' => '',
            'endpoint' => '',
            'q' => '',
        ], self::MAX_PARSED_ENTRIES);

        $summary = [
            'errors' => 0,
            'warnings' => 0,
            'critical' => 0,
            'total' => count($entries),
        ];

        foreach ($entries as $entry) {
            $level = Str::lower((string) ($entry['level'] ?? ''));
            if ($level === 'error') {
                $summary['errors']++;
            }
            if ($level === 'warning') {
                $summary['warnings']++;
            }
            if (in_array($level, ['critical', 'alert', 'emergency'], true)) {
                $summary['critical']++;
            }
        }

        return $summary;
    }

    private function endpointOptions(): array
    {
        $entries = $this->readEntries([], 500);

        return collect($entries)
            ->pluck('endpoint')
            ->filter(fn ($endpoint) => is_string($endpoint) && $endpoint !== '' && $endpoint !== '-')
            ->unique()
            ->take(50)
            ->values()
            ->all();
    }

    private function readEntries(array $filters = [], int $maxEntries = self::MAX_PARSED_ENTRIES): array
    {
        $entries = [];
        foreach ($this->logFiles() as $file) {
            foreach ($this->parseLogFile($file) as $entry) {
                if (! $this->passesFilters($entry, $filters)) {
                    continue;
                }

                $entries[] = $entry;
                if (count($entries) >= $maxEntries) {
                    break 2;
                }
            }
        }

        foreach ($this->frontendEntries($filters, $maxEntries) as $entry) {
            $entries[] = $entry;
        }

        usort($entries, fn ($left, $right) => strcmp((string) ($right['timestamp'] ?? ''), (string) ($left['timestamp'] ?? '')));

        return array_slice($entries, 0, $maxEntries);
    }

    /**
     * Browser errors are persisted separately from Laravel's rotating files.
     * Normalize them into the same monitor contract so a super admin does not
     * need DevTools or direct database access for an application incident.
     */
    private function frontendEntries(array $filters, int $maxEntries): array
    {
        try {
            $query = FrontendErrorLog::query()->orderByDesc('created_at');
            if (($filters['from'] ?? null) !== null) {
                $query->where('created_at', '>=', $filters['from']);
            }
            if (($filters['to'] ?? null) !== null) {
                $query->where('created_at', '<=', $filters['to']);
            }
            if (($filters['level'] ?? '') !== '') {
                $query->where('level', $filters['level']);
            }
            if (($filters['endpoint'] ?? '') !== '') {
                $query->where('url', 'like', '%'.$filters['endpoint'].'%');
            }
            if (($filters['q'] ?? '') !== '') {
                $needle = '%'.$filters['q'].'%';
                $query->where(function ($builder) use ($needle): void {
                    $builder
                        ->whereRaw('LOWER(message) LIKE ?', [$needle])
                        ->orWhereRaw('LOWER(COALESCE(url, \'\')) LIKE ?', [$needle]);
                });
            }

            return $query
                ->limit($maxEntries)
                ->get()
                ->map(function (FrontendErrorLog $log): array {
                    return [
                        'id' => 'frontend-'.$log->id,
                        'timestamp' => $log->created_at?->toIso8601String(),
                        'level' => Str::lower((string) $log->level),
                        'endpoint' => $this->sanitizeUrl((string) ($log->url ?: '-')),
                        'message' => $this->sanitizeText((string) $log->message, 700),
                        'user' => (string) ($log->user_id ?: '-'),
                        'method' => 'BROWSER',
                        'ip_address' => (string) ($log->ip_address ?: '-'),
                        'file' => '-',
                        'line' => null,
                        'stack_trace' => '-',
                        'context' => $this->sanitizeValue($log->context ?: []),
                    ];
                })
                ->all();
        } catch (\Throwable) {
            // Monitoring must not fail just because the optional browser-log
            // table has not been migrated on an older environment yet.
            return [];
        }
    }

    private function logFiles(): array
    {
        $path = storage_path('logs');
        if (! is_dir($path)) {
            return [];
        }

        $files = File::glob($path.DIRECTORY_SEPARATOR.'laravel*.log') ?: [];
        usort($files, fn ($left, $right) => filemtime($right) <=> filemtime($left));

        return array_slice($files, 0, 14);
    }

    private function parseLogFile(string $file): array
    {
        $content = $this->readLogTail($file);
        if ($content === '') {
            return [];
        }

        $entries = [];
        $current = null;
        $lineNumber = 0;

        foreach (preg_split("/\r\n|\n|\r/", $content) as $line) {
            $lineNumber++;
            if (preg_match('/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]\s+([A-Za-z0-9_-]+)\.([A-Za-z]+):\s?(.*)$/', $line, $matches)) {
                if ($current) {
                    $entries[] = $this->normalizeEntry($file, $current);
                }

                $current = [
                    'start_line' => $lineNumber,
                    'timestamp' => $matches[1],
                    'environment' => $matches[2],
                    'level' => Str::lower($matches[3]),
                    'lines' => [$matches[4]],
                ];
            } elseif ($current) {
                $current['lines'][] = $line;
            }
        }

        if ($current) {
            $entries[] = $this->normalizeEntry($file, $current);
        }

        return array_reverse($entries);
    }

    private function readLogTail(string $file): string
    {
        try {
            $size = filesize($file);
            if ($size === false || $size <= self::MAX_BYTES_PER_FILE) {
                return (string) File::get($file);
            }

            $handle = fopen($file, 'rb');
            if (! $handle) {
                return '';
            }
            fseek($handle, -self::MAX_BYTES_PER_FILE, SEEK_END);
            $content = stream_get_contents($handle);
            fclose($handle);

            $firstEntry = strpos((string) $content, "\n[");
            if ($firstEntry !== false) {
                $content = substr((string) $content, $firstEntry + 1);
            }

            return (string) $content;
        } catch (\Throwable) {
            return '';
        }
    }

    private function normalizeEntry(string $file, array $entry): array
    {
        $raw = implode("\n", $entry['lines'] ?? []);
        [$message, $context] = $this->splitMessageAndContext($raw);
        $exception = $this->stringFromPath($context, ['exception']) ?: $raw;
        [$sourceFile, $line] = $this->extractFileLine($exception);

        $normalized = [
            'id' => sha1(basename($file).'|'.($entry['start_line'] ?? 0).'|'.($entry['timestamp'] ?? '').'|'.($entry['level'] ?? '')),
            'timestamp' => $this->formatTimestamp($entry['timestamp'] ?? null),
            'level' => Str::lower((string) ($entry['level'] ?? 'info')),
            'endpoint' => $this->resolveEndpoint($message, $context),
            'message' => $this->sanitizeText($message ?: $raw, 700),
            'user' => $this->resolveUser($context),
            'method' => $this->resolveMethod($context),
            'ip_address' => $this->resolveIp($context),
            'file' => $this->sanitizePath($sourceFile ?: '-'),
            'line' => $line,
            'stack_trace' => $this->sanitizeText($this->resolveStackTrace($exception, $raw), 12000),
            'context' => $this->sanitizeValue($context),
        ];

        return $normalized;
    }

    private function splitMessageAndContext(string $raw): array
    {
        $firstLine = trim(Str::before($raw, "\n"));
        $message = $firstLine;
        $context = [];

        if (preg_match('/^(.*?)\s+(\{.*\})$/s', $raw, $matches)) {
            $decoded = json_decode($matches[2], true);
            if (is_array($decoded)) {
                $message = trim($matches[1]);
                $context = $decoded;
            }
        }

        return [$message, $context];
    }

    private function passesFilters(array $entry, array $filters): bool
    {
        $timestamp = isset($entry['timestamp']) ? Carbon::parse($entry['timestamp']) : null;
        if (($filters['from'] ?? null) && $timestamp && $timestamp->lt($filters['from'])) {
            return false;
        }
        if (($filters['to'] ?? null) && $timestamp && $timestamp->gt($filters['to'])) {
            return false;
        }

        if (($filters['level'] ?? '') !== '' && Str::lower((string) $entry['level']) !== $filters['level']) {
            return false;
        }

        if (($filters['endpoint'] ?? '') !== '') {
            $endpoint = Str::lower((string) ($entry['endpoint'] ?? ''));
            if (! str_contains($endpoint, Str::lower($filters['endpoint']))) {
                return false;
            }
        }

        if (($filters['q'] ?? '') !== '') {
            $needle = $filters['q'];
            $haystack = Str::lower(implode(' ', [
                $entry['message'] ?? '',
                $entry['endpoint'] ?? '',
                $entry['user'] ?? '',
                $entry['file'] ?? '',
                $entry['stack_trace'] ?? '',
            ]));
            if (! str_contains($haystack, $needle)) {
                return false;
            }
        }

        return true;
    }

    private function formatTimestamp(?string $timestamp): ?string
    {
        if (! $timestamp) {
            return null;
        }

        try {
            return Carbon::parse($timestamp, config('app.timezone'))->toIso8601String();
        } catch (\Throwable) {
            return $timestamp;
        }
    }

    private function resolveEndpoint(string $message, array $context): string
    {
        $value = $this->stringFromPath($context, ['url'])
            ?: $this->stringFromPath($context, ['request_url'])
            ?: $this->stringFromPath($context, ['full_url'])
            ?: $this->stringFromPath($context, ['request', 'url'])
            ?: $this->stringFromPath($context, ['request', 'path'])
            ?: $this->stringFromPath($context, ['endpoint'])
            ?: $this->stringFromPath($context, ['path']);

        if (! $value && preg_match('#\b(?:GET|POST|PUT|PATCH|DELETE)\s+(/[^\s]+)#i', $message, $matches)) {
            $value = $matches[1];
        }

        if (! $value && preg_match('#https?://[^\s"\']+#', $message, $matches)) {
            $value = $matches[0];
        }

        return $this->sanitizeUrl($value ?: '-');
    }

    private function resolveMethod(array $context): string
    {
        $method = $this->stringFromPath($context, ['method'])
            ?: $this->stringFromPath($context, ['http_method'])
            ?: $this->stringFromPath($context, ['request', 'method']);

        $method = strtoupper((string) $method);

        return in_array($method, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'], true) ? $method : '-';
    }

    private function resolveUser(array $context): string
    {
        $user = $this->stringFromPath($context, ['user_id'])
            ?: $this->stringFromPath($context, ['userId'])
            ?: $this->stringFromPath($context, ['auth_id'])
            ?: $this->stringFromPath($context, ['user', 'id'])
            ?: $this->stringFromPath($context, ['email'])
            ?: $this->stringFromPath($context, ['user', 'email']);

        return $this->sanitizeText($user ?: '-', 120);
    }

    private function resolveIp(array $context): string
    {
        $ip = $this->stringFromPath($context, ['ip'])
            ?: $this->stringFromPath($context, ['ip_address'])
            ?: $this->stringFromPath($context, ['request', 'ip']);

        return $this->sanitizeText($ip ?: '-', 80);
    }

    private function resolveStackTrace(string $exception, string $raw): string
    {
        if (str_contains($exception, '[stacktrace]')) {
            return trim(Str::after($exception, '[stacktrace]'));
        }

        return trim($exception ?: $raw);
    }

    private function extractFileLine(string $text): array
    {
        if (preg_match('/ at ([^\n:]+):(\d+)/', $text, $matches)) {
            return [$matches[1], (int) $matches[2]];
        }

        if (preg_match('/\(([^()\n]+):(\d+)\)/', $text, $matches)) {
            return [$matches[1], (int) $matches[2]];
        }

        return [null, null];
    }

    private function stringFromPath(array $value, array $path): string
    {
        $cursor = $value;
        foreach ($path as $segment) {
            if (! is_array($cursor) || ! array_key_exists($segment, $cursor)) {
                return '';
            }
            $cursor = $cursor[$segment];
        }

        return is_scalar($cursor) ? (string) $cursor : '';
    }

    private function sanitizeValue($value)
    {
        if (is_array($value)) {
            $clean = [];
            foreach ($value as $key => $item) {
                if ($this->isSensitiveKey((string) $key)) {
                    $clean[$key] = '[disembunyikan]';

                    continue;
                }
                $clean[$key] = $this->sanitizeValue($item);
            }

            return $clean;
        }

        if (is_string($value)) {
            return $this->sanitizeText($value, 4000);
        }

        return $value;
    }

    private function sanitizeText($value, int $limit = 2000): string
    {
        $text = (string) $value;
        $text = preg_replace('/(Bearer\s+)[A-Za-z0-9._\-~+\/]+=*/i', '$1[disembunyikan]', $text) ?? $text;
        $text = preg_replace('/([?&](?:token|key|api_key|access_token|secret|password)=)[^&\s]+/i', '$1[disembunyikan]', $text) ?? $text;
        $text = preg_replace('/((?:password|secret|token|api[_-]?key|app[_-]?key|authorization|cookie|session)\s*[=:]\s*)[^\s,"\']+/i', '$1[disembunyikan]', $text) ?? $text;

        return Str::limit($text, $limit, '...');
    }

    private function sanitizeUrl(string $url): string
    {
        $url = $this->sanitizeText($url, 300);
        if ($url === '-') {
            return $url;
        }

        $parts = parse_url($url);
        if (! is_array($parts) || empty($parts['path'])) {
            return $url;
        }

        $path = $parts['path'];
        if (! empty($parts['query'])) {
            parse_str($parts['query'], $query);
            foreach ($query as $key => $value) {
                if ($this->isSensitiveKey((string) $key)) {
                    $query[$key] = '[disembunyikan]';
                }
            }
            $path .= '?'.http_build_query($query);
        }

        return $path;
    }

    private function sanitizePath(string $path): string
    {
        if ($path === '-' || $path === '') {
            return '-';
        }

        $base = base_path();
        if (str_starts_with($path, $base)) {
            return Str::after($path, $base.DIRECTORY_SEPARATOR);
        }

        return basename($path);
    }

    private function isSensitiveKey(string $key): bool
    {
        $normalized = Str::lower(str_replace(['-', '.'], '_', $key));

        foreach (self::SENSITIVE_KEYS as $needle) {
            if ($normalized === $needle || str_contains($normalized, $needle)) {
                return true;
            }
        }

        return false;
    }
}
