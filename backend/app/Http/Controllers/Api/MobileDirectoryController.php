<?php

namespace App\Http\Controllers\Api;

use App\Support\Tenancy\TenantDomainService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class MobileDirectoryController extends ApiController
{
    public function __construct(
        private readonly TenantDomainService $tenantDomainService
    ) {}

    public function schools(Request $request)
    {
        if (! Schema::hasTable('tenants')) {
            return $this->ok([]);
        }

        $search = strtolower(trim((string) $request->query('search', '')));
        $limit = max(1, min(30, (int) $request->query('limit', 12)));
        $defaultSlug = strtolower(trim((string) config('tenancy.default_slug', 'default')));
        $reservedSlugs = array_values(array_unique(array_filter(array_map(
            static fn ($item) => strtolower(trim((string) $item)),
            array_merge((array) config('tenancy.reserved_subdomains', []), [$defaultSlug])
        ))));

        $query = DB::table('tenants')
            ->select('id', 'name', 'slug', 'status')
            ->whereNotIn(DB::raw('LOWER(slug)'), $reservedSlugs)
            ->whereNotIn(DB::raw("LOWER(COALESCE(status, 'active'))"), [
                'archived',
                'disabled',
                'inactive',
                'nonaktif',
                'suspended',
            ])
            ->orderBy('name')
            ->orderBy('slug')
            ->limit($limit);

        if ($search !== '') {
            $like = '%'.str_replace(['%', '_'], ['\%', '\_'], $search).'%';
            $query->where(function ($subQuery) use ($like) {
                $subQuery
                    ->whereRaw('LOWER(name) LIKE ?', [$like])
                    ->orWhereRaw('LOWER(slug) LIKE ?', [$like]);
            });
        }

        $tenants = $query->get();
        if ($tenants->isEmpty()) {
            return $this->ok([]);
        }

        $settingsByTenant = $this->settingsByTenant($tenants->pluck('id')->map(fn ($id) => (string) $id)->all());
        $fallbackHost = (string) parse_url((string) config('app.frontend_url', config('app.url', '')), PHP_URL_HOST);

        return $this->ok($tenants->map(function ($tenant) use ($settingsByTenant, $fallbackHost) {
            $tenantId = (string) $tenant->id;
            $settings = $settingsByTenant[$tenantId] ?? null;
            $name = trim((string) ($settings?->nama_sekolah ?? $tenant->name));
            $host = $this->tenantDomainService->primaryTenantFrontendHost(
                $tenantId,
                (string) $tenant->slug,
                $fallbackHost
            );
            $url = $host !== '' ? $this->tenantDomainService->makeUrl($host) : null;

            return [
                'id' => $tenantId,
                'name' => $name !== '' ? $name : (string) $tenant->slug,
                'slug' => (string) $tenant->slug,
                'status' => (string) ($tenant->status ?? 'active'),
                'host' => $host !== '' ? $host : null,
                'apiBaseUrl' => $url,
                'logoUrl' => $this->publicLogoUrl($settings),
            ];
        })->values());
    }

    private function settingsByTenant(array $tenantIds): array
    {
        if (empty($tenantIds) || ! Schema::hasTable('settings') || ! Schema::hasColumn('settings', 'tenant_id')) {
            return [];
        }

        $columns = ['tenant_id'];
        foreach (['nama_sekolah', 'logo_url', 'logo_path'] as $column) {
            if (Schema::hasColumn('settings', $column)) {
                $columns[] = $column;
            }
        }

        return DB::table('settings')
            ->whereIn('tenant_id', $tenantIds)
            ->orderBy('id')
            ->get($columns)
            ->keyBy(fn ($row) => (string) $row->tenant_id)
            ->all();
    }

    private function publicLogoUrl(?object $settings): ?string
    {
        $raw = trim((string) ($settings?->logo_url ?? ''));
        if ($raw !== '' && preg_match('#^https?://#i', $raw)) {
            return $raw;
        }

        return null;
    }
}
