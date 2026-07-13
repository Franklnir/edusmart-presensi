<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class WebVitalsController extends ApiController
{
    private const TABLE = 'web_vital_events';

    private const RANGE_DAYS = [
        '24h' => 1,
        '7d' => 7,
        '30d' => 30,
    ];

    private const METRIC_COLUMNS = [
        'lcp_ms',
        'ttfb_ms',
        'inp_ms',
        'cls',
        'fcp_ms',
        'route_ready_ms',
    ];

    public function store(Request $request)
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['data' => ['stored' => false, 'reason' => 'table_not_ready']], 202);
        }

        $validator = Validator::make($request->all(), [
            'route_path' => ['required', 'string', 'max:191'],
            'url_host' => ['nullable', 'string', 'max:191'],
            'role' => ['nullable', 'string', 'max:32'],
            'navigation_type' => ['nullable', 'string', 'max:32'],
            'device_type' => ['nullable', 'string', 'max:24'],
            'effective_connection_type' => ['nullable', 'string', 'max:24'],
            'viewport_width' => ['nullable', 'integer', 'min:0', 'max:20000'],
            'viewport_height' => ['nullable', 'integer', 'min:0', 'max:20000'],
            'measured_at' => ['nullable', 'date'],
            'metrics' => ['required', 'array'],
            'metrics.lcp_ms' => ['nullable', 'numeric', 'min:0', 'max:600000'],
            'metrics.ttfb_ms' => ['nullable', 'numeric', 'min:0', 'max:600000'],
            'metrics.inp_ms' => ['nullable', 'numeric', 'min:0', 'max:600000'],
            'metrics.cls' => ['nullable', 'numeric', 'min:0', 'max:20'],
            'metrics.fcp_ms' => ['nullable', 'numeric', 'min:0', 'max:600000'],
            'metrics.route_ready_ms' => ['nullable', 'numeric', 'min:0', 'max:600000'],
            'metadata' => ['nullable', 'array'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'message' => 'Payload Web Vitals tidak valid',
                'errors' => $validator->errors(),
            ], 422);
        }

        $validated = $validator->validated();
        $metrics = $validated['metrics'] ?? [];
        $hasMetric = collect(self::METRIC_COLUMNS)->contains(
            fn (string $column) => array_key_exists($column, $metrics) && $metrics[$column] !== null
        );

        if (! $hasMetric) {
            return response()->json(['data' => ['stored' => false, 'reason' => 'empty_metrics']], 202);
        }

        $profile = $this->profile($request);
        $tenantId = $profile?->tenant_id ? (string) $profile->tenant_id : $this->tenantId($request);
        $role = $profile?->role ?: ($validated['role'] ?? 'guest');

        $measuredAt = null;
        if (! empty($validated['measured_at'])) {
            try {
                $measuredAt = Carbon::parse($validated['measured_at']);
                if ($measuredAt->greaterThan(now()->addMinutes(5))) {
                    $measuredAt = now();
                }
            } catch (\Throwable) {
                $measuredAt = null;
            }
        }

        DB::table(self::TABLE)->insert([
            'tenant_id' => $tenantId ?: null,
            'profile_id' => $profile?->id ? (string) $profile->id : null,
            'role' => Str::limit(Str::lower((string) $role), 32, ''),
            'route_path' => $this->normalizeRoutePath($validated['route_path']),
            'url_host' => Str::limit((string) ($validated['url_host'] ?? ''), 191, '') ?: null,
            'navigation_type' => Str::limit((string) ($validated['navigation_type'] ?? ''), 32, '') ?: null,
            'device_type' => Str::limit((string) ($validated['device_type'] ?? ''), 24, '') ?: null,
            'effective_connection_type' => Str::limit((string) ($validated['effective_connection_type'] ?? ''), 24, '') ?: null,
            'viewport_width' => $validated['viewport_width'] ?? null,
            'viewport_height' => $validated['viewport_height'] ?? null,
            'lcp_ms' => $this->metricValue($metrics, 'lcp_ms'),
            'ttfb_ms' => $this->metricValue($metrics, 'ttfb_ms'),
            'inp_ms' => $this->metricValue($metrics, 'inp_ms'),
            'cls' => $this->metricValue($metrics, 'cls'),
            'fcp_ms' => $this->metricValue($metrics, 'fcp_ms'),
            'route_ready_ms' => $this->metricValue($metrics, 'route_ready_ms'),
            'metadata' => json_encode($this->metadata($request, $validated['metadata'] ?? [])),
            'measured_at' => $measuredAt?->toDateTimeString(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return response()->json(['data' => ['stored' => true]], 201);
    }

    public function summary(Request $request)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        if (! Schema::hasTable(self::TABLE)) {
            return $this->ok($this->emptySummary($request));
        }

        $range = $this->normalizeRange($request->query('range', '24h'));
        $start = now()->subDays(self::RANGE_DAYS[$range]);

        $query = DB::table(self::TABLE.' as w')
            ->leftJoin('tenants as t', 't.id', '=', 'w.tenant_id')
            ->select([
                'w.tenant_id',
                't.name as tenant_name',
                't.slug as tenant_slug',
                'w.role',
                'w.route_path',
                'w.device_type',
                'w.effective_connection_type',
                'w.lcp_ms',
                'w.ttfb_ms',
                'w.inp_ms',
                'w.cls',
                'w.fcp_ms',
                'w.route_ready_ms',
                'w.created_at',
            ])
            ->where('w.created_at', '>=', $start)
            ->orderByDesc('w.created_at')
            ->limit(5000);

        $tenantId = trim((string) $request->query('tenant_id', ''));
        if ($tenantId !== '') {
            $query->where('w.tenant_id', $tenantId);
        }

        $role = trim((string) $request->query('role', ''));
        if ($role !== '') {
            $query->where('w.role', $role);
        }

        $device = trim((string) $request->query('device', ''));
        if ($device !== '') {
            $query->where('w.device_type', $device);
        }

        $route = trim((string) $request->query('route', ''));
        if ($route !== '') {
            $query->where('w.route_path', 'like', '%'.$route.'%');
        }

        $events = $query->get();

        return $this->ok([
            'generated_at' => now()->toISOString(),
            'range' => $range,
            'since' => $start->toISOString(),
            'limits' => [
                'lcp_ms' => ['good' => 2500, 'needs_attention' => 4000],
                'ttfb_ms' => ['good' => 800, 'needs_attention' => 1800],
                'inp_ms' => ['good' => 200, 'needs_attention' => 500],
                'cls' => ['good' => 0.1, 'needs_attention' => 0.25],
                'route_ready_ms' => ['good' => 2500, 'needs_attention' => 4000],
            ],
            'filters' => [
                'tenants' => $this->tenantOptions(),
            ],
            'summary' => $this->summarizeGroup($events),
            'routes' => $this->groupRows($events, 'route_path', 'route_path', 30),
            'tenants' => $this->groupRows($events, 'tenant_id', 'tenant_name', 20),
            'roles' => $this->groupRows($events, 'role', 'role', 12),
            'devices' => $this->groupRows($events, 'device_type', 'device_type', 8),
            'recent' => $events->take(25)->map(fn ($row) => $this->eventRow($row))->values(),
        ]);
    }

    private function normalizeRoutePath(string $value): string
    {
        $route = trim($value) ?: '/';
        if (! str_starts_with($route, '/')) {
            $route = '/'.$route;
        }

        return Str::limit($route, 191, '');
    }

    private function metricValue(array $metrics, string $key): ?float
    {
        if (! array_key_exists($key, $metrics) || $metrics[$key] === null || $metrics[$key] === '') {
            return null;
        }

        return round((float) $metrics[$key], $key === 'cls' ? 4 : 2);
    }

    private function metadata(Request $request, array $metadata): array
    {
        $allowed = collect($metadata)
            ->only(['reason', 'collector_version', 'language', 'visibility_state'])
            ->map(fn ($value) => is_scalar($value) ? Str::limit((string) $value, 120, '') : null)
            ->filter(fn ($value) => $value !== null)
            ->all();

        return array_merge($allowed, [
            'user_agent' => Str::limit((string) $request->userAgent(), 255, ''),
        ]);
    }

    private function normalizeRange(mixed $value): string
    {
        $range = trim((string) $value);

        return array_key_exists($range, self::RANGE_DAYS) ? $range : '24h';
    }

    private function emptySummary(Request $request): array
    {
        $range = $this->normalizeRange($request->query('range', '24h'));

        return [
            'generated_at' => now()->toISOString(),
            'range' => $range,
            'since' => now()->subDays(self::RANGE_DAYS[$range])->toISOString(),
            'limits' => [],
            'filters' => ['tenants' => $this->tenantOptions()],
            'summary' => $this->summarizeGroup(collect()),
            'routes' => [],
            'tenants' => [],
            'roles' => [],
            'devices' => [],
            'recent' => [],
        ];
    }

    private function tenantOptions(): array
    {
        if (! Schema::hasTable('tenants')) {
            return [];
        }

        $query = DB::table('tenants')
            ->select('id', 'name', 'slug');

        if (Schema::hasColumn('tenants', 'status')) {
            $query->where(function ($statusQuery) {
                $statusQuery
                    ->whereNull('status')
                    ->orWhereNotIn('status', ['deleted', 'archived']);
            });
        }

        return $query
            ->orderBy('name')
            ->limit(200)
            ->get()
            ->map(fn ($row) => [
                'id' => (string) $row->id,
                'name' => $row->name ?: ($row->slug ?: 'Sekolah tanpa nama'),
                'slug' => $row->slug,
            ])
            ->values()
            ->all();
    }

    private function groupRows(Collection $events, string $key, string $labelKey, int $limit): array
    {
        return $events
            ->groupBy(fn ($row) => (string) ($row->{$key} ?? ''))
            ->map(function (Collection $rows, string $groupKey) use ($labelKey) {
                $summary = $this->summarizeGroup($rows);
                $first = $rows->first();

                return array_merge($summary, [
                    'key' => $groupKey ?: 'unknown',
                    'label' => $first?->{$labelKey} ?: ($groupKey ?: 'Unknown'),
                    'tenant_slug' => $first?->tenant_slug ?? null,
                ]);
            })
            ->sortByDesc(fn (array $row) => ($this->statusWeight($row['status'] ?? 'unknown') * 1000000) + (float) ($row['p75']['lcp_ms'] ?? 0))
            ->take($limit)
            ->values()
            ->all();
    }

    private function summarizeGroup(Collection $events): array
    {
        $metrics = [];
        foreach (self::METRIC_COLUMNS as $column) {
            $values = $events
                ->map(fn ($row) => $row->{$column} ?? null)
                ->filter(fn ($value) => $value !== null)
                ->map(fn ($value) => (float) $value)
                ->values()
                ->all();

            $metrics[$column] = [
                'avg' => $this->average($values),
                'p75' => $this->percentile($values, 0.75),
            ];
        }

        $p75 = collect($metrics)->mapWithKeys(fn ($value, $key) => [$key => $value['p75']])->all();
        $avg = collect($metrics)->mapWithKeys(fn ($value, $key) => [$key => $value['avg']])->all();
        $status = $this->overallStatus($p75);

        return [
            'samples' => $events->count(),
            'status' => $status,
            'score' => $this->score($p75),
            'avg' => $avg,
            'p75' => $p75,
            'badges' => [
                'good' => $events->filter(fn ($row) => $this->overallStatus($this->eventP75Shape($row)) === 'good')->count(),
                'needs_attention' => $events->filter(fn ($row) => $this->overallStatus($this->eventP75Shape($row)) === 'needs_attention')->count(),
                'poor' => $events->filter(fn ($row) => $this->overallStatus($this->eventP75Shape($row)) === 'poor')->count(),
            ],
        ];
    }

    private function eventP75Shape(object $row): array
    {
        return [
            'lcp_ms' => $row->lcp_ms === null ? null : (float) $row->lcp_ms,
            'ttfb_ms' => $row->ttfb_ms === null ? null : (float) $row->ttfb_ms,
            'inp_ms' => $row->inp_ms === null ? null : (float) $row->inp_ms,
            'cls' => $row->cls === null ? null : (float) $row->cls,
            'route_ready_ms' => $row->route_ready_ms === null ? null : (float) $row->route_ready_ms,
        ];
    }

    private function average(array $values): ?float
    {
        if ($values === []) {
            return null;
        }

        return round(array_sum($values) / count($values), 2);
    }

    private function percentile(array $values, float $percentile): ?float
    {
        $count = count($values);
        if ($count === 0) {
            return null;
        }

        sort($values, SORT_NUMERIC);
        $index = ($count - 1) * $percentile;
        $lower = (int) floor($index);
        $upper = (int) ceil($index);
        if ($lower === $upper) {
            return round((float) $values[$lower], 2);
        }

        $weight = $index - $lower;

        return round(((float) $values[$lower] * (1 - $weight)) + ((float) $values[$upper] * $weight), 2);
    }

    private function overallStatus(array $metrics): string
    {
        $statuses = [
            $this->metricStatus('lcp_ms', $metrics['lcp_ms'] ?? null),
            $this->metricStatus('ttfb_ms', $metrics['ttfb_ms'] ?? null),
            $this->metricStatus('inp_ms', $metrics['inp_ms'] ?? null),
            $this->metricStatus('cls', $metrics['cls'] ?? null),
            $this->metricStatus('route_ready_ms', $metrics['route_ready_ms'] ?? null),
        ];

        if (in_array('poor', $statuses, true)) {
            return 'poor';
        }

        if (in_array('needs_attention', $statuses, true)) {
            return 'needs_attention';
        }

        return in_array('good', $statuses, true) ? 'good' : 'unknown';
    }

    private function metricStatus(string $metric, ?float $value): string
    {
        if ($value === null) {
            return 'unknown';
        }

        $thresholds = [
            'lcp_ms' => [2500, 4000],
            'ttfb_ms' => [800, 1800],
            'inp_ms' => [200, 500],
            'cls' => [0.1, 0.25],
            'route_ready_ms' => [2500, 4000],
        ][$metric] ?? [INF, INF];

        if ($value <= $thresholds[0]) {
            return 'good';
        }

        if ($value <= $thresholds[1]) {
            return 'needs_attention';
        }

        return 'poor';
    }

    private function score(array $metrics): int
    {
        $score = 100;
        foreach (['lcp_ms', 'ttfb_ms', 'inp_ms', 'cls', 'route_ready_ms'] as $metric) {
            $status = $this->metricStatus($metric, $metrics[$metric] ?? null);
            if ($status === 'needs_attention') {
                $score -= 10;
            } elseif ($status === 'poor') {
                $score -= 25;
            }
        }

        return max(0, $score);
    }

    private function statusWeight(string $status): int
    {
        return [
            'poor' => 3,
            'needs_attention' => 2,
            'unknown' => 1,
            'good' => 0,
        ][$status] ?? 1;
    }

    private function eventRow(object $row): array
    {
        return [
            'tenant_id' => $row->tenant_id,
            'tenant_name' => $row->tenant_name,
            'tenant_slug' => $row->tenant_slug,
            'role' => $row->role,
            'route_path' => $row->route_path,
            'device_type' => $row->device_type,
            'effective_connection_type' => $row->effective_connection_type,
            'lcp_ms' => $row->lcp_ms === null ? null : (float) $row->lcp_ms,
            'ttfb_ms' => $row->ttfb_ms === null ? null : (float) $row->ttfb_ms,
            'inp_ms' => $row->inp_ms === null ? null : (float) $row->inp_ms,
            'cls' => $row->cls === null ? null : (float) $row->cls,
            'route_ready_ms' => $row->route_ready_ms === null ? null : (float) $row->route_ready_ms,
            'created_at' => $row->created_at,
            'status' => $this->overallStatus($this->eventP75Shape($row)),
        ];
    }
}
