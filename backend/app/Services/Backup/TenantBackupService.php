<?php

namespace App\Services\Backup;

use App\Models\TenantGoogleDriveFile;
use App\Services\GoogleDrive\GoogleDriveService;
use App\Support\AcademicPeriod;
use App\Traits\HasTenantBackupLogic;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class TenantBackupService
{
    use HasTenantBackupLogic;

    public function __construct(private readonly GoogleDriveService $googleDriveService) {}

    public function buildPayload(string $tenantId, array $input = [], string $userId = '', ?string $role = null): array
    {
        $tenantId = trim($tenantId);
        $mode = $this->normalizeBackupMode($input['mode'] ?? null);
        $periodScope = $this->normalizeBackupPeriodScope($tenantId, $input);

        $tables = match ($mode) {
            'students' => $this->buildStudentBackupTables($tenantId, $periodScope),
            'teachers' => $this->buildTeacherBackupTables($tenantId, $periodScope),
            'classes' => $this->buildClassBackupTables($tenantId, $periodScope),
            default => $this->buildFullBackupTables($tenantId, $periodScope),
        };

        $totalRows = 0;
        foreach ($tables as $tableInfo) {
            $totalRows += (int) ($tableInfo['row_count'] ?? 0);
        }

        $tenant = $this->tenantSnapshot($tenantId);

        return [
            'tenant' => $tenant,
            'exported_at' => now()->toIso8601String(),
            'mode' => $mode,
            'mode_label' => $this->backupModeLabel($mode),
            'period' => $this->backupPeriodPayload($periodScope),
            'summary' => [
                'table_count' => count($tables),
                'total_rows' => $totalRows,
            ],
            'manifest' => [
                'version' => 3,
                'backup_type' => 'tenant_database',
                'tenant_scoped' => true,
                'contains_storage_files' => false,
                'contains_storage_metadata' => true,
                'contains_linked_users' => true,
                'restore_strategy' => 'id_or_unique_key_upsert',
                'notes' => [
                    'Backup berisi seluruh data database tenant dan metadata file storage/Drive, bukan isi file biner.',
                    'Restore mengarah ke tenant target yang dipilih, bukan memindahkan tenant asal.',
                    'File storage Neva S3 dan Google Drive tetap tersimpan pada provider masing-masing.',
                ],
            ],
            'tables' => $tables,
            'formats_supported' => ['xlsx', 'json', 'csv', 'html'],
            'generated_by' => [
                'user_id' => $userId,
                'role' => $role,
            ],
        ];
    }

    public function savePayloadToGoogleDrive(string $tenantId, string $userId, array $payload, string $fileName = ''): array
    {
        return $this->googleDriveService->uploadTenantBackupJson($tenantId, $userId, $payload, $fileName);
    }

    public function buildMonthlyPayload(string $tenantId, string $monthKey, string $userId = 'system', ?string $role = 'system'): array
    {
        $month = $this->findAcademicMonth($tenantId, $monthKey);
        if (! $month) {
            throw new \RuntimeException('Bulan backup tidak berada dalam periode aktif sekolah.');
        }

        $payload = $this->buildPayload($tenantId, [
            'mode' => 'full',
            'period_type' => 'date_range',
            'start_date' => $month['start_date'],
            'end_date' => $month['end_date'],
        ], $userId, $role);

        $payload['period']['type'] = 'monthly';
        $payload['period']['label'] = 'Backup Bulanan '.$month['label'];
        $payload['period']['month_key'] = $month['value'];
        $payload['period']['month_label'] = $month['label'];
        $payload['period']['tahun_ajaran'] = $this->activeAcademicYear($tenantId);
        $payload['manifest']['scheduled_backup'] = true;

        return $payload;
    }

    public function saveMonthlyBackupToGoogleDrive(string $tenantId, string $monthKey, string $userId = 'system', bool $force = false): array
    {
        $month = $this->findAcademicMonth($tenantId, $monthKey);
        if (! $month) {
            throw new \RuntimeException('Bulan backup tidak berada dalam periode aktif sekolah.');
        }

        $fileName = $this->monthlyBackupFileName($tenantId, $month['value']);
        if (! $force && $this->monthlyBackupRecord($tenantId, $month['value'])) {
            throw new \RuntimeException('Backup bulan '.$month['label'].' sudah tersedia di Google Drive.');
        }

        $payload = $this->buildMonthlyPayload($tenantId, $month['value'], $userId, $userId === 'system' ? 'system' : 'admin');

        return $this->savePayloadToGoogleDrive($tenantId, $userId, $payload, $fileName);
    }

    public function monthlyStatus(string $tenantId): array
    {
        $tenantId = trim($tenantId);
        $active = $this->tenantActiveAcademicPeriod($tenantId);
        $year = $this->activeAcademicYear($tenantId);
        $months = $this->academicYearMonths($year);

        $items = [];
        foreach ($months as $month) {
            $record = $this->monthlyBackupRecord($tenantId, (string) $month['value']);
            $items[] = [
                'key' => (string) $month['value'],
                'label' => (string) $month['label'],
                'short_label' => (string) $month['short_label'],
                'start_date' => (string) $month['start_date'],
                'end_date' => (string) $month['end_date'],
                'status' => $record ? 'backed_up' : 'pending',
                'is_backed_up' => (bool) $record,
                'drive_file' => $record ? $this->driveRecordPayload($record) : null,
            ];
        }

        $backedUp = count(array_filter($items, static fn ($item) => (bool) ($item['is_backed_up'] ?? false)));

        return [
            'tenant' => $this->tenantSnapshot($tenantId),
            'schedule' => [
                'enabled' => true,
                'timezone' => 'Asia/Jakarta',
                'runs_at' => '23:59',
                'rule' => 'Akhir bulan pada periode aktif sekolah',
                'mode' => 'full',
                'destination' => 'Google Drive sekolah',
            ],
            'academic_period' => [
                'tahun_ajaran' => $year,
                'semester' => $active['semester'] ?? null,
                'label' => 'Tahun ajaran '.$year,
                'range_label' => ($months[0]['label'] ?? '').' - '.($months[count($months) - 1]['label'] ?? ''),
            ],
            'summary' => [
                'total_months' => count($items),
                'backed_up_months' => $backedUp,
                'pending_months' => max(0, count($items) - $backedUp),
            ],
            'months' => $items,
        ];
    }

    public function tenantsEligibleForMonthlyBackup(): array
    {
        if (! Schema::hasTable('tenant_google_drive_configs')) {
            return [];
        }

        return DB::table('tenant_google_drive_configs')
            ->where('is_enabled', true)
            ->where('status', GoogleDriveService::STATUS_CONNECTED)
            ->whereNotNull('refresh_token')
            ->pluck('tenant_id')
            ->filter()
            ->map(fn ($value) => (string) $value)
            ->values()
            ->all();
    }

    public function currentMonthKey(): string
    {
        return now('Asia/Jakarta')->format('Y-m');
    }

    public function monthlyBackupFileName(string $tenantId, string $monthKey): string
    {
        $tenant = $this->tenantSnapshot($tenantId);
        $slug = Str::slug((string) ($tenant['slug'] ?? $tenant['name'] ?? 'tenant')) ?: 'tenant';

        return 'backup-'.$slug.'-full-monthly-'.$monthKey.'.json';
    }

    private function tenantSnapshot(string $tenantId): array
    {
        $tenant = null;
        try {
            if (Schema::hasTable('tenants')) {
                $tenant = DB::table('tenants')
                    ->where('id', $tenantId)
                    ->first(['id', 'name', 'slug', 'status', 'created_at', 'updated_at']);
            }
        } catch (\Throwable $e) {
            $tenant = null;
        }

        $schoolName = null;
        try {
            if ($this->hasTable('settings') && $this->tableHasColumn('settings', 'tenant_id')) {
                $schoolName = DB::table('settings')
                    ->where('tenant_id', $tenantId)
                    ->orderBy('id')
                    ->value('nama_sekolah');
            }
        } catch (\Throwable $e) {
            $schoolName = null;
        }

        return [
            'id' => $tenantId,
            'name' => $schoolName ?: (string) ($tenant->name ?? 'Sekolah'),
            'slug' => (string) ($tenant->slug ?? ''),
            'status' => (string) ($tenant->status ?? ''),
            'created_at' => $tenant->created_at ?? null,
            'updated_at' => $tenant->updated_at ?? null,
        ];
    }

    private function activeAcademicYear(string $tenantId): string
    {
        $active = $this->tenantActiveAcademicPeriod($tenantId);

        return AcademicPeriod::normalizeAcademicYear($active['tahun_ajaran'] ?? null)
            ?: AcademicPeriod::current()['tahun_ajaran'];
    }

    private function academicYearMonths(string $academicYear): array
    {
        $ganjil = AcademicPeriod::semesterMonths($academicYear, AcademicPeriod::SEMESTER_GANJIL);
        $genap = AcademicPeriod::semesterMonths($academicYear, AcademicPeriod::SEMESTER_GENAP);

        return array_values(array_merge($ganjil, $genap));
    }

    private function findAcademicMonth(string $tenantId, string $monthKey): ?array
    {
        $monthKey = trim($monthKey);
        if (! preg_match('/^\d{4}-\d{2}$/', $monthKey)) {
            return null;
        }

        foreach ($this->academicYearMonths($this->activeAcademicYear($tenantId)) as $month) {
            if ((string) ($month['value'] ?? '') === $monthKey) {
                return $month;
            }
        }

        return null;
    }

    private function monthlyBackupRecord(string $tenantId, string $monthKey): ?TenantGoogleDriveFile
    {
        if (! Schema::hasTable('tenant_google_drive_files')) {
            return null;
        }

        $sourcePath = 'backup/'.$this->monthlyBackupFileName($tenantId, $monthKey);

        return TenantGoogleDriveFile::query()
            ->where('tenant_id', $tenantId)
            ->where('bucket', 'backups')
            ->where(function ($query) use ($monthKey, $sourcePath) {
                $query->where('source_path', $sourcePath)
                    ->orWhere('drive_file_name', 'like', '%monthly-'.$monthKey.'%')
                    ->orWhere('source_path', 'like', '%monthly-'.$monthKey.'%');
            })
            ->latest('uploaded_at')
            ->first();
    }

    private function driveRecordPayload(TenantGoogleDriveFile $record): array
    {
        return [
            'id' => (string) $record->id,
            'drive_file_id' => (string) $record->drive_file_id,
            'drive_file_name' => (string) $record->drive_file_name,
            'drive_web_view_link' => (string) ($record->drive_web_view_link ?? ''),
            'size_bytes' => (int) ($record->size_bytes ?? 0),
            'size_label' => $this->formatBytes((int) ($record->size_bytes ?? 0)),
            'uploaded_at' => optional($record->uploaded_at)->toIso8601String(),
        ];
    }

    private function formatBytes(int $bytes): string
    {
        if ($bytes <= 0) {
            return '0 B';
        }

        $units = ['B', 'KB', 'MB', 'GB', 'TB'];
        $index = 0;
        $value = (float) $bytes;
        while ($value >= 1024 && $index < count($units) - 1) {
            $value /= 1024;
            $index++;
        }

        return round($value, $index === 0 ? 0 : 2).' '.$units[$index];
    }
}
