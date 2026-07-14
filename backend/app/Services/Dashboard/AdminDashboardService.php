<?php

namespace App\Services\Dashboard;

use App\Services\Admin\AdminPageCacheService;
use Illuminate\Support\Arr;

class AdminDashboardService
{
    private const ANNOUNCEMENT_LIMIT = 20;

    public function __construct(private readonly AdminPageCacheService $pageCache) {}

    /**
     * Build the small, read-only payload needed by the admin landing page.
     * Larger catalogues such as teachers, announcements, and extracurriculars
     * remain their own paginated domain resources.
     *
     * @return array<string, mixed>
     */
    public function show(string $tenantId, ?string $academicYear = null): array
    {
        $bootstrap = $this->pageCache->homeBootstrap($tenantId, array_filter([
            'tahun_ajaran' => $academicYear,
        ]));

        return [
            'settings' => $this->academicContext($bootstrap['settings'] ?? []),
            'academic_period' => $this->academicPeriod($bootstrap['academic_period'] ?? []),
            'summary' => $this->summary($bootstrap['summary'] ?? []),
            'announcements' => array_slice(array_map(
                fn (array $item): array => Arr::only($item, [
                    'id', 'judul', 'keterangan', 'target', 'created_at', 'updated_at',
                ]),
                array_filter((array) ($bootstrap['pengumuman'] ?? []), 'is_array')
            ), 0, self::ANNOUNCEMENT_LIMIT),
            'generated_at' => $bootstrap['generated_at'] ?? now()->toISOString(),
            'cache_status' => (string) ($bootstrap['cache_status'] ?? 'miss'),
        ];
    }

    /** @param array<string, mixed> $settings */
    private function academicContext(array $settings): array
    {
        return Arr::only($settings, [
            'id',
            'tahun_ajaran',
            'semester_aktif',
            'periode_mulai',
            'periode_selesai',
            'periode_ganjil_mulai',
            'periode_ganjil_selesai',
            'periode_genap_mulai',
            'periode_genap_selesai',
            'max_ekskul_per_siswa',
            'updated_at',
        ]);
    }

    /** @param array<string, mixed> $period */
    private function academicPeriod(array $period): array
    {
        return Arr::only($period, [
            'tahun_ajaran',
            'semester',
            'periode_mulai',
            'periode_selesai',
        ]);
    }

    /** @param array<string, mixed> $summary */
    private function summary(array $summary): array
    {
        $counts = [];
        foreach (['siswa', 'guru', 'admin', 'kelas', 'absensi', 'pengumuman', 'eskul'] as $key) {
            $counts[$key] = max(0, (int) ($summary[$key] ?? 0));
        }

        $counts['tahun_ajaran'] = isset($summary['tahun_ajaran'])
            ? (string) $summary['tahun_ajaran']
            : null;
        $counts['generated_at'] = $summary['generated_at'] ?? null;

        return $counts;
    }
}
