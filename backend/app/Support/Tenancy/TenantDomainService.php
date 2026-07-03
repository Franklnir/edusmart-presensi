<?php

namespace App\Support\Tenancy;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use RuntimeException;

class TenantDomainService
{
    public const TYPE_TENANT = 'tenant';

    public const TYPE_ADMIN = 'admin';

    public const STATUS_PENDING = 'pending';

    public const STATUS_READY = 'ready';

    public const STATUS_DISABLED = 'disabled';

    public function tableAvailable(): bool
    {
        try {
            return Schema::hasTable('tenant_domains');
        } catch (\Throwable $e) {
            return false;
        }
    }

    public function normalizeHost(?string $host): string
    {
        $value = strtolower(trim((string) ($host ?? '')));
        if ($value === '') {
            return '';
        }

        if (str_contains($value, '://')) {
            $parsedHost = parse_url($value, PHP_URL_HOST);
            $value = strtolower(trim((string) $parsedHost));
        } else {
            $value = preg_replace('#/.*$#', '', $value) ?: $value;
            $value = preg_replace('/:\d+$/', '', $value) ?: $value;
        }

        return trim($value, '.');
    }

    public function trustedRequestHost(Request $request): string
    {
        $host = $this->normalizeHost((string) $request->getHost());
        $secret = trim((string) config('tenancy.edge_proxy_secret', ''));
        if ($secret === '') {
            return $host;
        }

        $secretHeader = trim((string) config('tenancy.edge_secret_header', 'X-Sismu-Edge-Secret'));
        $forwardedHostHeader = trim((string) config('tenancy.edge_forwarded_host_header', 'X-Sismu-Forwarded-Host'));
        if ($secretHeader === '' || $forwardedHostHeader === '') {
            return $host;
        }

        $receivedSecret = (string) $request->headers->get($secretHeader, '');
        if ($receivedSecret === '' || ! hash_equals($secret, $receivedSecret)) {
            return $host;
        }

        $forwardedHost = $this->normalizeHost((string) $request->headers->get($forwardedHostHeader, ''));
        if ($forwardedHost === '' || ! $this->isWithinConfiguredRoot($forwardedHost)) {
            return $host;
        }

        return $forwardedHost;
    }

    public function publicScheme(): string
    {
        $configured = strtolower(trim((string) config('tenancy.public_scheme', '')));
        if (in_array($configured, ['http', 'https'], true)) {
            return $configured;
        }

        $appUrlScheme = strtolower(trim((string) parse_url((string) config('app.url', ''), PHP_URL_SCHEME)));

        return in_array($appUrlScheme, ['http', 'https'], true) ? $appUrlScheme : 'https';
    }

    public function isAdminHost(?string $host): bool
    {
        $normalizedHost = $this->normalizeHost($host);
        if ($normalizedHost === '') {
            return false;
        }

        if ($this->isConfiguredAdminHost($normalizedHost)) {
            return true;
        }

        if (! $this->tableAvailable()) {
            return false;
        }

        try {
            return DB::table('tenant_domains')
                ->where('domain_type', self::TYPE_ADMIN)
                ->where('host', $normalizedHost)
                ->where('status', '!=', self::STATUS_DISABLED)
                ->exists();
        } catch (\Throwable $e) {
            return false;
        }
    }

    public function adminHostMessage(): string
    {
        $configured = $this->defaultAdminHost();
        if ($configured !== '') {
            return 'Panel super admin hanya bisa diakses dari '.$configured;
        }

        if ($this->tableAvailable()) {
            try {
                $customHost = (string) DB::table('tenant_domains')
                    ->where('domain_type', self::TYPE_ADMIN)
                    ->where('status', '!=', self::STATUS_DISABLED)
                    ->orderByDesc('is_primary')
                    ->orderBy('host')
                    ->value('host');
                if ($customHost !== '') {
                    return 'Panel super admin hanya bisa diakses dari '.$customHost;
                }
            } catch (\Throwable $e) {
                // ignore
            }
        }

        return 'Panel super admin hanya bisa diakses dari domain admin.';
    }

    public function resolveTenantForHost(?string $host): ?object
    {
        $normalizedHost = $this->normalizeHost($host);
        if ($normalizedHost === '' || $this->isAdminHost($normalizedHost)) {
            return null;
        }

        $mapped = $this->resolveMappedTenant($normalizedHost);
        if ($mapped) {
            return $mapped;
        }

        $slug = $this->deriveSlugFromConfiguredRoot($normalizedHost);
        if ($slug === null) {
            return null;
        }

        try {
            return DB::table('tenants')
                ->where('slug', $slug)
                ->first();
        } catch (\Throwable $e) {
            return null;
        }
    }

    public function platformOverview(): array
    {
        $rootDomain = $this->normalizedRootDomain();
        $adminHost = $this->defaultAdminHost();
        $evolutionHost = $this->evolutionDisplayHost();

        return [
            'public_scheme' => $this->publicScheme(),
            'root_domain' => $rootDomain,
            'default_admin_host' => $adminHost,
            'default_admin_url' => $adminHost !== '' ? $this->makeUrl($adminHost) : null,
            'evolution_host' => $evolutionHost !== '' ? $evolutionHost : null,
            'evolution_url' => $evolutionHost !== '' ? $this->makeUrl($evolutionHost) : null,
            'wildcard_example' => $rootDomain !== '' ? '*.'.$rootDomain : null,
            'dns_records' => $this->defaultPlatformDnsRecords($rootDomain),
            'manual_dns_mode' => true,
            'notes' => [
                'DNS registrar tetap perlu diarahkan dari panel domain kamu. Aplikasi akan memverifikasi host dan readiness-nya dari sini.',
                'Untuk HTTPS production, wildcard SSL atau reverse proxy otomatis seperti Caddy/Traefik tetap diperlukan di level server.',
                'Kalau registrar/DNS provider punya API publik, otomasi penuh bisa ditambahkan nanti tanpa mengubah alur tenant di aplikasi.',
            ],
        ];
    }

    public function listAdminDomains(): array
    {
        if (! $this->tableAvailable()) {
            return [];
        }

        return DB::table('tenant_domains')
            ->where('domain_type', self::TYPE_ADMIN)
            ->orderByDesc('is_primary')
            ->orderBy('host')
            ->get()
            ->map(fn ($row) => $this->decorateDomainRow($row))
            ->values()
            ->all();
    }

    public function listTenantDomains(string $tenantId): array
    {
        if (! $this->tableAvailable()) {
            return [];
        }

        return DB::table('tenant_domains')
            ->where('tenant_id', $tenantId)
            ->where('domain_type', self::TYPE_TENANT)
            ->orderByDesc('is_primary')
            ->orderBy('host')
            ->get()
            ->map(fn ($row) => $this->decorateDomainRow($row))
            ->values()
            ->all();
    }

    public function defaultTenantHost(string $tenantSlug): string
    {
        return $this->deriveTenantHostFromFallback(
            (string) parse_url((string) config('app.frontend_url', config('app.url', '')), PHP_URL_HOST),
            $tenantSlug
        );
    }

    public function defaultTenantUrl(string $tenantSlug): ?string
    {
        $host = $this->defaultTenantHost($tenantSlug);

        return $host !== '' ? $this->makeUrl($host) : null;
    }

    public function authorizesTlsForHost(?string $host): bool
    {
        $normalizedHost = $this->normalizeHost($host);
        if ($normalizedHost === '') {
            return false;
        }

        if ($this->isAdminHost($normalizedHost)) {
            return true;
        }

        $evolutionHost = $this->normalizeHost((string) config('services.caddy.evolution_host', ''));
        if ($evolutionHost !== '' && $normalizedHost === $evolutionHost) {
            return true;
        }

        $mqttHost = $this->normalizeHost((string) config('rfid.mosquitto.public_host', ''));
        if ($mqttHost !== '' && $normalizedHost === $mqttHost) {
            return true;
        }

        $edgeOriginHost = $this->normalizeHost((string) config('tenancy.edge_origin_host', ''));
        if ($edgeOriginHost !== '' && $normalizedHost === $edgeOriginHost) {
            return true;
        }

        if ($this->resolveMappedTenant($normalizedHost)) {
            return true;
        }

        $slug = $this->deriveSlugFromConfiguredRoot($normalizedHost);
        if ($slug === null) {
            return false;
        }

        return $this->tenantSlugExists($slug);
    }

    protected function evolutionDisplayHost(): string
    {
        $publicUrlHost = $this->normalizeHost((string) config('services.evolution_api.public_url', ''));
        if ($publicUrlHost !== '') {
            return $publicUrlHost;
        }

        return $this->normalizeHost((string) config('services.caddy.evolution_host', ''));
    }

    public function createTenantDomain(string $tenantId, array $payload): array
    {
        return $this->createDomain(self::TYPE_TENANT, $payload, $tenantId);
    }

    public function createAdminDomain(array $payload): array
    {
        return $this->createDomain(self::TYPE_ADMIN, $payload, null);
    }

    public function checkDomain(string $domainId): array
    {
        $row = $this->findDomainOrFail($domainId);

        $expectedRecords = $this->expectedDnsRecords($row->host, $row->dns_record_type, $row->dns_record_value);
        $observedRecords = $this->lookupDnsRecords($row->host);
        $matchesExpected = $this->matchesExpectedRecords($expectedRecords, $observedRecords);

        $dnsStatus = empty($observedRecords)
            ? 'missing'
            : ($matchesExpected ? 'ready' : 'mismatch');
        $dnsError = match ($dnsStatus) {
            'ready' => null,
            'missing' => 'Record DNS belum ditemukan atau belum terpropagasi.',
            default => 'Record DNS belum mengarah ke target yang diharapkan.',
        };

        DB::table('tenant_domains')
            ->where('id', $row->id)
            ->update([
                'last_checked_at' => now(),
                'last_dns_status' => $dnsStatus,
                'last_dns_error' => $dnsError,
                'last_dns_records' => json_encode($observedRecords),
                'verified_at' => $matchesExpected ? now() : null,
                'status' => $row->status === self::STATUS_DISABLED
                    ? self::STATUS_DISABLED
                    : ($matchesExpected ? self::STATUS_READY : self::STATUS_PENDING),
                'updated_at' => now(),
            ]);

        $fresh = $this->findDomainOrFail($domainId);

        return $this->decorateDomainRow($fresh);
    }

    public function deleteDomain(string $domainId): void
    {
        if (! $this->tableAvailable()) {
            return;
        }

        DB::table('tenant_domains')->where('id', $domainId)->delete();
    }

    public function primaryTenantFrontendHost(?string $tenantId, ?string $tenantSlug, string $fallbackHost): string
    {
        $tenantId = trim((string) ($tenantId ?? ''));
        $tenantSlug = strtolower(trim((string) ($tenantSlug ?? '')));

        if ($tenantId !== '' && $this->tableAvailable()) {
            try {
                $mappedHost = (string) DB::table('tenant_domains')
                    ->where('tenant_id', $tenantId)
                    ->where('domain_type', self::TYPE_TENANT)
                    ->where('status', '!=', self::STATUS_DISABLED)
                    ->orderByDesc('is_primary')
                    ->orderBy('host')
                    ->value('host');
                if ($mappedHost !== '') {
                    return $mappedHost;
                }
            } catch (\Throwable $e) {
                // ignore and fallback
            }
        }

        return $this->deriveTenantHostFromFallback($fallbackHost, $tenantSlug);
    }

    public function makeUrl(string $host): string
    {
        return $this->publicScheme().'://'.$this->normalizeHost($host);
    }

    private function createDomain(string $domainType, array $payload, ?string $tenantId): array
    {
        if (! $this->tableAvailable()) {
            throw new RuntimeException('Fitur domain belum aktif. Jalankan migrasi terbaru terlebih dahulu.');
        }

        $host = $this->normalizeHost($payload['host'] ?? '');
        if (! $this->isValidHost($host)) {
            throw new RuntimeException('Host domain tidak valid.');
        }

        if ($domainType === self::TYPE_TENANT && $this->isAdminHost($host)) {
            throw new RuntimeException('Host ini dipakai untuk panel admin. Gunakan host lain untuk tenant.');
        }

        if ($this->isConfiguredAdminHost($host)) {
            throw new RuntimeException('Host ini sudah aktif dari konfigurasi platform dan tidak perlu didaftarkan lagi.');
        }

        if ($domainType === self::TYPE_TENANT && $this->isBuiltInTenantHost($host)) {
            throw new RuntimeException('Host ini sudah tercakup oleh routing subdomain bawaan. Gunakan slug tenant atau domain kustom di luar root domain utama.');
        }

        if ($domainType === self::TYPE_ADMIN) {
            $tenantMapped = $this->resolveMappedTenant($host);
            if ($tenantMapped) {
                throw new RuntimeException('Host ini sudah dipakai oleh tenant lain.');
            }

            if ($this->isBuiltInTenantHost($host)) {
                throw new RuntimeException('Host ini bentrok dengan subdomain tenant bawaan. Gunakan domain admin khusus di luar root domain tenant.');
            }
        }

        $exists = DB::table('tenant_domains')->where('host', $host)->exists();
        if ($exists) {
            throw new RuntimeException('Host domain sudah terdaftar.');
        }

        $dnsRecordType = strtoupper(trim((string) ($payload['dns_record_type'] ?? '')));
        $dnsRecordValue = trim((string) ($payload['dns_record_value'] ?? ''));
        $defaultRecord = $this->defaultDnsTarget();

        if (! in_array($dnsRecordType, ['A', 'CNAME'], true)) {
            $dnsRecordType = $defaultRecord['type'];
        }
        if ($dnsRecordValue === '') {
            $dnsRecordValue = $defaultRecord['value'];
        }

        $isPrimary = (bool) ($payload['is_primary'] ?? false);
        $notes = trim((string) ($payload['notes'] ?? ''));
        $domainId = (string) Str::uuid();

        DB::transaction(function () use (
            $domainId,
            $tenantId,
            $host,
            $domainType,
            $isPrimary,
            $dnsRecordType,
            $dnsRecordValue,
            $notes
        ): void {
            if ($isPrimary) {
                $query = DB::table('tenant_domains')->where('domain_type', $domainType);
                if ($domainType === self::TYPE_TENANT) {
                    $query->where('tenant_id', $tenantId);
                }
                $query->update([
                    'is_primary' => false,
                    'updated_at' => now(),
                ]);
            }

            DB::table('tenant_domains')->insert([
                'id' => $domainId,
                'tenant_id' => $tenantId,
                'host' => $host,
                'domain_type' => $domainType,
                'status' => self::STATUS_PENDING,
                'is_primary' => $isPrimary,
                'dns_record_type' => $dnsRecordType,
                'dns_record_value' => $dnsRecordValue,
                'notes' => $notes !== '' ? $notes : null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });

        return $this->checkDomain($domainId);
    }

    private function findDomainOrFail(string $domainId): object
    {
        if (! $this->tableAvailable()) {
            throw new RuntimeException('Fitur domain belum aktif.');
        }

        $row = DB::table('tenant_domains')->where('id', $domainId)->first();
        if (! $row) {
            throw new RuntimeException('Domain tidak ditemukan.');
        }

        return $row;
    }

    private function decorateDomainRow(object $row): array
    {
        $observedRecords = [];
        if (! empty($row->last_dns_records)) {
            $decoded = json_decode((string) $row->last_dns_records, true);
            if (is_array($decoded)) {
                $observedRecords = $decoded;
            }
        }

        $expectedRecords = $this->expectedDnsRecords(
            (string) $row->host,
            (string) ($row->dns_record_type ?? ''),
            (string) ($row->dns_record_value ?? '')
        );

        return [
            'id' => (string) $row->id,
            'tenant_id' => $row->tenant_id ? (string) $row->tenant_id : null,
            'host' => (string) $row->host,
            'domain_type' => (string) $row->domain_type,
            'status' => (string) ($row->status ?? self::STATUS_PENDING),
            'is_primary' => (bool) ($row->is_primary ?? false),
            'dns_record_type' => (string) ($row->dns_record_type ?? ''),
            'dns_record_value' => (string) ($row->dns_record_value ?? ''),
            'verified_at' => $row->verified_at,
            'last_checked_at' => $row->last_checked_at,
            'last_dns_status' => (string) ($row->last_dns_status ?? ''),
            'last_dns_error' => $row->last_dns_error,
            'observed_records' => $observedRecords,
            'expected_records' => $expectedRecords,
            'notes' => $row->notes,
            'url' => $this->makeUrl((string) $row->host),
            'created_at' => $row->created_at,
            'updated_at' => $row->updated_at,
        ];
    }

    private function defaultPlatformDnsRecords(string $rootDomain): array
    {
        if ($rootDomain === '') {
            return [];
        }

        $defaultTarget = $this->defaultDnsTarget();
        $records = [];

        if ($defaultTarget['value'] !== '') {
            $records[] = [
                'host' => $rootDomain,
                'type' => $defaultTarget['type'],
                'value' => $defaultTarget['value'],
                'label' => 'Root domain',
            ];
            $records[] = [
                'host' => '*.'.$rootDomain,
                'type' => $defaultTarget['type'],
                'value' => $defaultTarget['value'],
                'label' => 'Wildcard tenant subdomain',
            ];
        }

        $adminHost = $this->defaultAdminHost();
        if ($adminHost !== '' && $adminHost !== $rootDomain) {
            $records[] = [
                'host' => $adminHost,
                'type' => $defaultTarget['type'],
                'value' => $defaultTarget['value'],
                'label' => 'Admin host',
            ];
        }

        return $records;
    }

    private function expectedDnsRecords(string $host, string $recordType = '', string $recordValue = ''): array
    {
        $type = strtoupper(trim($recordType));
        $value = trim($recordValue);

        if (! in_array($type, ['A', 'CNAME'], true) || $value === '') {
            $default = $this->defaultDnsTarget();
            $type = $default['type'];
            $value = $default['value'];
        }

        if ($type === '' || $value === '') {
            return [];
        }

        return [[
            'host' => $host,
            'type' => $type,
            'value' => $value,
        ]];
    }

    private function lookupDnsRecords(string $host): array
    {
        $normalizedHost = $this->normalizeHost($host);
        if ($normalizedHost === '') {
            return [];
        }

        $records = [];
        foreach ([DNS_A => 'A', DNS_CNAME => 'CNAME'] as $flag => $type) {
            try {
                $items = dns_get_record($normalizedHost, $flag);
            } catch (\Throwable $e) {
                $items = false;
            }

            if (! is_array($items)) {
                continue;
            }

            foreach ($items as $item) {
                $value = $type === 'A'
                    ? (string) ($item['ip'] ?? '')
                    : $this->normalizeHost((string) ($item['target'] ?? ''));
                if ($value === '') {
                    continue;
                }
                $records[] = [
                    'type' => $type,
                    'value' => $value,
                ];
            }
        }

        return $records;
    }

    private function matchesExpectedRecords(array $expectedRecords, array $observedRecords): bool
    {
        if (empty($expectedRecords) || empty($observedRecords)) {
            return false;
        }

        foreach ($expectedRecords as $expected) {
            $expectedType = strtoupper(trim((string) ($expected['type'] ?? '')));
            $expectedValue = $this->normalizeRecordValue($expectedType, (string) ($expected['value'] ?? ''));

            foreach ($observedRecords as $observed) {
                $observedType = strtoupper(trim((string) ($observed['type'] ?? '')));
                $observedValue = $this->normalizeRecordValue($observedType, (string) ($observed['value'] ?? ''));
                if ($expectedType === $observedType && $expectedValue === $observedValue) {
                    return true;
                }
            }
        }

        return false;
    }

    private function normalizeRecordValue(string $recordType, string $value): string
    {
        $normalized = trim($value);
        if ($recordType === 'CNAME') {
            return $this->normalizeHost($normalized);
        }

        return $normalized;
    }

    private function defaultDnsTarget(): array
    {
        $configuredA = trim((string) config('tenancy.dns_a_record', ''));
        if ($configuredA !== '') {
            return ['type' => 'A', 'value' => $configuredA];
        }

        $configuredCname = $this->normalizeHost((string) config('tenancy.dns_cname_target', ''));
        if ($configuredCname !== '') {
            return ['type' => 'CNAME', 'value' => $configuredCname];
        }

        $appHost = $this->normalizeHost((string) parse_url((string) config('app.url', ''), PHP_URL_HOST));
        if ($appHost === 'localhost' || $appHost === '127.0.0.1') {
            return ['type' => 'A', 'value' => '127.0.0.1'];
        }

        if (filter_var($appHost, FILTER_VALIDATE_IP)) {
            return ['type' => 'A', 'value' => $appHost];
        }

        return ['type' => 'CNAME', 'value' => $appHost];
    }

    private function deriveTenantHostFromFallback(string $fallbackHost, string $tenantSlug): string
    {
        $normalizedHost = $this->normalizeHost($fallbackHost);
        $slug = strtolower(trim($tenantSlug));
        if ($normalizedHost === '' || $slug === '') {
            return $normalizedHost;
        }

        $defaultSlug = strtolower(trim((string) config('tenancy.default_slug', 'default')));
        if ($this->isLocalSubdomainHost($normalizedHost)) {
            return $slug.'.localhost';
        }

        $rootDomain = $this->normalizedRootDomain();
        if ($rootDomain !== '' && ($normalizedHost === $rootDomain || str_ends_with($normalizedHost, '.'.$rootDomain))) {
            if ($slug === $defaultSlug) {
                return $rootDomain;
            }

            return $slug.'.'.$rootDomain;
        }

        return $normalizedHost;
    }

    private function resolveMappedTenant(string $host): ?object
    {
        if (! $this->tableAvailable()) {
            return null;
        }

        try {
            return DB::table('tenant_domains as td')
                ->join('tenants as t', 't.id', '=', 'td.tenant_id')
                ->where('td.domain_type', self::TYPE_TENANT)
                ->where('td.status', '!=', self::STATUS_DISABLED)
                ->where('td.host', $host)
                ->select('t.*')
                ->first();
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function deriveSlugFromConfiguredRoot(string $host): ?string
    {
        if ($this->isLocalHost($host)) {
            return strtolower(trim((string) config('tenancy.default_slug', 'default')));
        }

        $rootDomain = $this->normalizedRootDomain();
        if ($rootDomain === '') {
            return null;
        }

        if ($host === $rootDomain) {
            return strtolower(trim((string) config('tenancy.default_slug', 'default')));
        }

        if (! str_ends_with($host, '.'.$rootDomain)) {
            return null;
        }

        $subdomain = trim(substr($host, 0, -strlen('.'.$rootDomain)), '.');
        if ($subdomain === '') {
            return strtolower(trim((string) config('tenancy.default_slug', 'default')));
        }

        $parts = explode('.', $subdomain);
        $slug = strtolower(trim((string) ($parts[0] ?? '')));
        if ($slug === '' || $this->isReservedSlug($slug)) {
            return null;
        }

        return $slug;
    }

    private function isBuiltInTenantHost(string $host): bool
    {
        $normalizedHost = $this->normalizeHost($host);
        if ($normalizedHost === '') {
            return false;
        }

        if ($this->isConfiguredAdminHost($normalizedHost)) {
            return false;
        }

        return $this->deriveSlugFromConfiguredRoot($normalizedHost) !== null;
    }

    private function tenantSlugExists(string $slug): bool
    {
        try {
            return DB::table('tenants')->where('slug', strtolower(trim($slug)))->exists();
        } catch (\Throwable $e) {
            return false;
        }
    }

    private function isConfiguredAdminHost(string $host): bool
    {
        $adminHosts = array_map(
            fn ($item) => $this->normalizeHost($item),
            (array) config('tenancy.admin_hosts', [])
        );
        if (in_array($host, array_filter($adminHosts), true)) {
            return true;
        }

        $root = $this->normalizedRootDomain();
        $adminSubdomain = strtolower(trim((string) config('tenancy.admin_subdomain', 'admin26')));
        $allowRoot = (bool) config('tenancy.allow_root_for_super_admin', false);

        if ($root !== '') {
            $adminHost = $adminSubdomain !== '' ? ($adminSubdomain.'.'.$root) : $root;
            if ($host === $adminHost) {
                return true;
            }
            if ($allowRoot && $host === $root) {
                return true;
            }
        }

        if ($host === $adminSubdomain.'.localhost' || $host === $adminSubdomain.'.127.0.0.1') {
            return true;
        }

        return $allowRoot && in_array($host, ['localhost', '127.0.0.1'], true);
    }

    private function defaultAdminHost(): string
    {
        $root = $this->normalizedRootDomain();
        $adminSubdomain = strtolower(trim((string) config('tenancy.admin_subdomain', 'admin26')));

        if ($root === '') {
            return '';
        }

        return $adminSubdomain !== '' ? ($adminSubdomain.'.'.$root) : $root;
    }

    private function normalizedRootDomain(): string
    {
        $rootDomain = strtolower(trim((string) config('tenancy.root_domain', '')));
        $rootDomain = ltrim($rootDomain, '.');

        return trim((string) preg_replace('#^https?://#', '', $rootDomain), '/');
    }

    private function isWithinConfiguredRoot(string $host): bool
    {
        $host = $this->normalizeHost($host);
        $root = $this->normalizedRootDomain();
        if ($host === '' || $root === '') {
            return false;
        }

        return $host === $root || str_ends_with($host, '.'.$root);
    }

    private function isReservedSlug(string $slug): bool
    {
        $reserved = array_map('strtolower', (array) config('tenancy.reserved_subdomains', []));
        $adminSubdomain = strtolower(trim((string) config('tenancy.admin_subdomain', 'admin26')));
        if ($adminSubdomain !== '') {
            $reserved[] = $adminSubdomain;
        }

        return in_array(strtolower(trim($slug)), $reserved, true);
    }

    private function isLocalSubdomainHost(string $host): bool
    {
        return $host === 'localhost' || str_ends_with($host, '.localhost');
    }

    private function isLocalHost(string $host): bool
    {
        if ($host === 'localhost' || $host === '127.0.0.1') {
            return true;
        }

        return str_ends_with($host, '.localhost');
    }

    private function isValidHost(string $host): bool
    {
        if ($host === 'localhost' || $host === '127.0.0.1' || str_ends_with($host, '.localhost')) {
            return true;
        }

        return filter_var($host, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME) !== false;
    }
}
