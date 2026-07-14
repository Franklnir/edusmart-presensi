<?php

namespace App\Services\Organization;

use App\Services\Academic\AcademicPeriodLifecycleService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class OrganizationContextService
{
    public function __construct(
        private readonly AcademicPeriodLifecycleService $academicPeriods
    ) {}

    /**
     * Build the small tenant-scoped context shared by navigation and shell UI.
     *
     * @return array<string, mixed>
     */
    public function show(string $tenantId, string $userId, string $role): array
    {
        $settings = Schema::hasTable('settings')
            ? DB::table('settings')
                ->where('tenant_id', $tenantId)
                ->orderBy('id')
                ->first([
                    'nama_sekolah',
                    'logo_path',
                    'logo_url',
                    'updated_at',
                ])
            : null;

        $tenantName = Schema::hasTable('tenants')
            ? DB::table('tenants')->where('id', $tenantId)->value('name')
            : null;

        $academicContext = $this->academicPeriods->currentContext($tenantId);
        $activeYear = (string) ($academicContext['tahun_ajaran'] ?? '');

        $classIds = [];
        $isWaliKelas = false;
        if (
            $role === 'guru'
            && $userId !== ''
            && Schema::hasTable('kelas_struktur')
        ) {
            $waliQuery = DB::table('kelas_struktur')
                ->where('tenant_id', $tenantId)
                ->where('wali_guru_id', $userId);

            if ($activeYear !== '' && Schema::hasColumn('kelas_struktur', 'tahun_ajaran')) {
                $waliQuery->where('tahun_ajaran', $activeYear);
            }

            $classIds = $waliQuery
                ->pluck('kelas_id')
                ->filter(fn ($id) => $id !== null && trim((string) $id) !== '')
                ->map(fn ($id) => (string) $id)
                ->unique()
                ->values()
                ->all();
            $isWaliKelas = $classIds !== [];
        }

        $delegatedFeatures = [];
        if (
            $role === 'guru'
            && $userId !== ''
            && Schema::hasTable('admin_feature_permissions')
        ) {
            $delegatedFeatures = DB::table('admin_feature_permissions')
                ->where('tenant_id', $tenantId)
                ->where('target_teacher_id', $userId)
                ->where('is_active', true)
                ->orderBy('feature_key')
                ->pluck('feature_key')
                ->filter(fn ($feature) => is_string($feature) && trim($feature) !== '')
                ->map(fn ($feature) => trim($feature))
                ->unique()
                ->values()
                ->all();
        }

        return [
            'organization' => [
                'name' => trim((string) ($settings->nama_sekolah ?? '')) ?: (string) ($tenantName ?: ''),
                // Keep a path reference only. The browser resolves it through
                // the authorized attachment/storage flow already in use.
                'logo_path' => trim((string) ($settings->logo_path ?? $settings->logo_url ?? '')) ?: null,
                'updated_at' => $settings?->updated_at,
            ],
            'membership' => [
                'is_wali_kelas' => $isWaliKelas,
                'class_ids' => $classIds,
            ],
            'delegated_features' => $delegatedFeatures,
            'academic_context' => $academicContext !== []
                ? [
                    'tahun_ajaran' => $academicContext['tahun_ajaran'] ?? null,
                    'semester' => $academicContext['semester'] ?? null,
                ]
                : null,
        ];
    }
}
