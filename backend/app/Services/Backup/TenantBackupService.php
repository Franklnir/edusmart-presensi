<?php

namespace App\Services\Backup;

use App\Jobs\TenantMonthlyGoogleDriveBackupJob;
use App\Models\TenantGoogleDriveFile;
use App\Services\GoogleDrive\GoogleDriveService;
use App\Support\AcademicPeriod;
use App\Traits\HasTenantBackupLogic;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
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

        return $this->buildPayloadForScope($tenantId, $mode, $periodScope, $userId, $role);
    }

    private function buildPayloadForScope(string $tenantId, string $mode, array $periodScope, string $userId = '', ?string $role = null): array
    {
        $tenantId = trim($tenantId);
        $mode = $this->normalizeBackupMode($mode);

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

        $payload = [
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

        return $this->attachPayloadChecksum($payload);
    }

    public function savePayloadToGoogleDrive(string $tenantId, string $userId, array $payload, string $fileName = ''): array
    {
        return $this->googleDriveService->uploadTenantBackupJson($tenantId, $userId, $payload, $fileName);
    }

    public function savePayloadFormatsToGoogleDrive(string $tenantId, string $userId, array $payload, string $fileName = ''): array
    {
        $jsonFile = $this->googleDriveService->uploadTenantBackupJson($tenantId, $userId, $payload, $fileName);
        $excelFile = $this->googleDriveService->uploadTenantBackupExcel($tenantId, $userId, $payload, $fileName);

        return array_merge($jsonFile, [
            'formats' => [
                'json' => $jsonFile,
                'excel' => $excelFile,
            ],
            'excel_file' => $excelFile,
        ]);
    }

    public function buildMonthlyPayload(
        string $tenantId,
        string $monthKey,
        string $userId = 'system',
        ?string $role = 'system',
        ?Carbon $endAt = null,
        ?Carbon $startAt = null,
        string $runKind = 'initial_monthly_snapshot',
        ?Carbon $serverTime = null
    ): array {
        $month = $this->findAcademicMonth($tenantId, $monthKey);
        if (! $month) {
            throw new \RuntimeException('Bulan backup tidak berada dalam periode aktif sekolah.');
        }

        $window = $this->monthlyBackupWindow($tenantId, $month['value'], $serverTime ?: $endAt, $startAt);
        if (! $window['can_backup']) {
            throw new \RuntimeException((string) ($window['reason'] ?? 'Bulan backup belum bisa diproses.'));
        }
        if ($endAt) {
            $window['end_at'] = $endAt->copy()->setTimezone('Asia/Jakarta');
            $window['effective_end_at'] = $window['end_at'];
        }

        $periodScope = $this->makeBackupPeriodScope(
            'date_range',
            'Rentang '.$window['start_at']->toDateTimeString().' s/d '.$window['end_at']->toDateTimeString(),
            null,
            $window['start_at'],
            $window['end_at'],
            $this->activeAcademicYear($tenantId),
            null
        );

        $payload = $this->buildPayloadForScope($tenantId, 'full', $periodScope, $userId, $role);

        $payload['period']['type'] = 'monthly';
        $payload['period']['label'] = 'Backup Bulanan '.$month['label'];
        $payload['period']['month_key'] = $month['value'];
        $payload['period']['month_label'] = $month['label'];
        $payload['period']['tahun_ajaran'] = $this->activeAcademicYear($tenantId);
        $payload['manifest']['scheduled_backup'] = true;
        $payload['manifest']['backup_window'] = [
            'month_key' => (string) $month['value'],
            'month_label' => (string) $month['label'],
            'start_at' => $window['start_at']->toIso8601String(),
            'end_at' => $window['end_at']->toIso8601String(),
            'server_time' => $window['server_time']->toIso8601String(),
            'kind' => $runKind,
        ];

        return $this->attachPayloadChecksum($payload);
    }

    public function saveMonthlyBackupToGoogleDrive(
        string $tenantId,
        string $monthKey,
        string $userId = 'system',
        bool $force = false,
        ?Carbon $runAt = null
    ): array {
        $month = $this->findAcademicMonth($tenantId, $monthKey);
        if (! $month) {
            throw new \RuntimeException('Bulan backup tidak berada dalam periode aktif sekolah.');
        }

        $runAt = ($runAt ?: now('Asia/Jakarta'))->copy()->setTimezone('Asia/Jakarta');
        $window = $this->monthlyBackupWindow($tenantId, $month['value'], $runAt);
        if (! $window['can_backup']) {
            throw new \RuntimeException((string) ($window['reason'] ?? 'Bulan backup belum bisa diproses.'));
        }

        $record = $this->monthlyBackupRecord($tenantId, $month['value']);
        $latestDataAt = $this->latestTenantDataAt(
            $tenantId,
            $window['month_start'],
            $window['effective_end_at']
        );
        $lastBackupAt = $this->recordUploadedAt($record);
        $needsUpdate = $record && $latestDataAt && $lastBackupAt && $latestDataAt->greaterThan($lastBackupAt);
        if (! $force && $record && ! $needsUpdate) {
            throw new \RuntimeException('Backup bulan '.$month['label'].' sudah tersedia di Google Drive.');
        }

        $fileName = $this->monthlyBackupFileName($tenantId, $month['value'], (bool) $record);
        $runKind = $record ? 'monthly_delta_update' : 'initial_monthly_snapshot';
        $deltaStartAt = $record && $lastBackupAt && $needsUpdate
            ? $lastBackupAt->copy()->setTimezone('Asia/Jakarta')->subSecond()
            : $window['month_start'];
        $payload = $this->buildMonthlyPayload(
            $tenantId,
            $month['value'],
            $userId,
            $userId === 'system' ? 'system' : 'admin',
            $window['effective_end_at'],
            $deltaStartAt,
            $runKind,
            $runAt
        );
        $payload['manifest']['backup_run'] = [
            'kind' => $runKind,
            'previous_backup_at' => optional($lastBackupAt)->toIso8601String(),
            'latest_data_at' => optional($latestDataAt)->toIso8601String(),
            'server_time' => $runAt->toIso8601String(),
            'effective_start_at' => $deltaStartAt->toIso8601String(),
            'effective_end_at' => $window['effective_end_at']->toIso8601String(),
            'stores_json_and_excel' => true,
        ];
        $payload = $this->attachPayloadChecksum($payload);

        return $this->savePayloadFormatsToGoogleDrive($tenantId, $userId, $payload, $fileName);
    }

    public function autoMonthlyBackupToGoogleDrive(string $tenantId, string $userId = 'system'): array
    {
        $status = $this->monthlyStatus($tenantId, true);
        $now = now('Asia/Jakarta');
        $statusMonths = array_values((array) ($status['months'] ?? []));
        if (empty($statusMonths)) {
            throw new \RuntimeException('Jadwal bulan backup periode aktif belum tersedia.');
        }

        $periodStart = Carbon::parse((string) (($statusMonths[0] ?? [])['start_date'] ?? ''), 'Asia/Jakarta')->startOfDay();
        $periodEnd = Carbon::parse((string) (($statusMonths[count($statusMonths) - 1] ?? [])['end_date'] ?? ''), 'Asia/Jakarta')->endOfDay();
        if ($now->lessThan($periodStart) || $now->greaterThan($periodEnd)) {
            throw new \RuntimeException('Auto backup hanya bisa dijalankan saat waktu server masih berada dalam periode aktif sekolah.');
        }

        $results = [];

        foreach ($statusMonths as $month) {
            $monthKey = (string) ($month['key'] ?? '');
            if ($monthKey === '') {
                continue;
            }

            try {
                $monthStart = Carbon::parse((string) ($month['start_date'] ?? ''), 'Asia/Jakarta')->startOfDay();
            } catch (\Throwable $e) {
                continue;
            }

            if ($monthStart->greaterThan($now)) {
                $results[] = array_merge($month, [
                    'action' => 'skipped',
                    'message' => 'Bulan belum berjalan.',
                ]);

                continue;
            }

            if (! (bool) ($month['can_backup'] ?? true)) {
                $results[] = array_merge($month, [
                    'action' => 'skipped',
                    'message' => 'Tidak ada data baru sejak backup terakhir.',
                ]);

                continue;
            }

            try {
                $file = $this->saveMonthlyBackupToGoogleDrive($tenantId, $monthKey, $userId, true, $now);
                $results[] = array_merge($month, [
                    'action' => ($month['status'] ?? '') === 'needs_update' ? 'updated' : 'created',
                    'message' => ($month['status'] ?? '') === 'needs_update'
                        ? 'Data baru berhasil dibackup.'
                        : 'Backup bulan berhasil dibuat.',
                    'drive_file' => $file,
                ]);
            } catch (\Throwable $e) {
                $results[] = array_merge($month, [
                    'action' => 'failed',
                    'message' => trim((string) $e->getMessage()) ?: 'Gagal membuat backup.',
                ]);
            }
        }

        $created = count(array_filter($results, static fn ($item) => ($item['action'] ?? '') === 'created'));
        $updated = count(array_filter($results, static fn ($item) => ($item['action'] ?? '') === 'updated'));
        $failed = count(array_filter($results, static fn ($item) => ($item['action'] ?? '') === 'failed'));
        $skipped = count(array_filter($results, static fn ($item) => ($item['action'] ?? '') === 'skipped'));

        return [
            'summary' => [
                'created' => $created,
                'updated' => $updated,
                'skipped' => $skipped,
                'failed' => $failed,
                'changed' => $created + $updated,
                'message' => ($created + $updated) > 0
                    ? 'Auto backup selesai. '.$created.' bulan baru dibuat, '.$updated.' bulan diperbarui.'
                    : 'Tidak ada data baru yang perlu dibackup.',
                'server_time' => $now->toIso8601String(),
                'server_time_label' => $now->format('Y-m-d H:i:s').' WIB',
            ],
            'months' => $results,
            'monthly_status' => $this->monthlyStatus($tenantId),
        ];
    }

    public function queueMonthlyBackupToGoogleDrive(
        string $tenantId,
        ?string $monthKey,
        string $userId = 'system',
        bool $force = false,
        bool $auto = false,
        int $delaySeconds = 0
    ): array {
        $tenantId = trim($tenantId);
        if ($tenantId === '') {
            throw new \RuntimeException('Tenant tidak valid.');
        }

        $monthKey = $monthKey !== null ? trim($monthKey) : null;
        if (! $auto && ($monthKey === null || $monthKey === '')) {
            throw new \RuntimeException('Bulan backup wajib dipilih.');
        }

        $activeKey = $this->monthlyBackupActiveJobKey($tenantId, $auto ? null : $monthKey, $auto);
        $activeJobId = Cache::get($activeKey);
        if ((! is_string($activeJobId) || trim($activeJobId) === '') && $this->tenantBackupJobsTableReady()) {
            $activeJobId = $this->latestActiveMonthlyBackupJobId($tenantId, $auto ? null : $monthKey, $auto);
            if (is_string($activeJobId) && trim($activeJobId) !== '') {
                Cache::put($activeKey, $activeJobId, now()->addMinutes((int) config('backup.monthly_active_job_lock_minutes', 45)));
            }
        }
        if (is_string($activeJobId) && trim($activeJobId) !== '') {
            $activeStatus = $this->monthlyBackupJobStatus($tenantId, $activeJobId);
            if (in_array((string) ($activeStatus['status'] ?? ''), ['queued', 'running', 'retrying'], true)) {
                return array_merge($activeStatus, [
                    'queued' => true,
                    'already_queued' => true,
                    'monthly_status' => $activeStatus['monthly_status'] ?? $this->monthlyStatus($tenantId),
                    'message' => $activeStatus['message'] ?? (
                        $auto
                            ? 'Auto backup tenant ini masih berada di antrean.'
                            : 'Backup bulan ini masih berada di antrean.'
                    ),
                ]);
            }

            Cache::forget($activeKey);
        }

        $jobId = (string) Str::uuid();
        $status = [
            'job_id' => $jobId,
            'tenant_id' => $tenantId,
            'month' => $monthKey,
            'type' => $auto ? 'auto_monthly' : 'monthly',
            'status' => 'queued',
            'progress' => 12,
            'message' => $auto
                ? 'Auto backup masuk antrean dan akan diproses di background.'
                : 'Backup bulanan masuk antrean dan akan diproses di background.',
            'queued_at' => now('Asia/Jakarta')->toIso8601String(),
            'updated_at' => now('Asia/Jakarta')->toIso8601String(),
        ];

        $this->putMonthlyBackupJobStatus($tenantId, $jobId, $status);
        $lockMinutes = max(
            (int) config('backup.monthly_active_job_lock_minutes', 45),
            (int) ceil(max(0, $delaySeconds) / 60) + (int) config('backup.monthly_active_job_lock_minutes', 45)
        );
        Cache::put(
            $activeKey,
            $jobId,
            now()->addMinutes($lockMinutes)
        );

        $job = new TenantMonthlyGoogleDriveBackupJob(
            $tenantId,
            trim($userId) !== '' ? trim($userId) : 'system',
            $monthKey,
            $force,
            $auto,
            $jobId
        );

        if ($delaySeconds > 0) {
            $job->delay(now()->addSeconds($delaySeconds));
        }

        dispatch($job);

        return array_merge($status, [
            'queued' => true,
            'monthly_status' => $this->monthlyStatus($tenantId),
        ]);
    }

    public function releaseMonthlyBackupActiveJob(string $tenantId, ?string $monthKey, bool $auto, string $jobId): void
    {
        $activeKey = $this->monthlyBackupActiveJobKey($tenantId, $auto ? null : $monthKey, $auto);
        $activeJobId = Cache::get($activeKey);

        if (is_string($activeJobId) && trim($activeJobId) === trim($jobId)) {
            Cache::forget($activeKey);
        }
    }

    public function monthlyBackupJobStatus(string $tenantId, string $jobId): array
    {
        $tenantId = trim($tenantId);
        $jobId = trim($jobId);
        if ($tenantId === '' || $jobId === '') {
            return [
                'job_id' => $jobId,
                'status' => 'missing',
                'message' => 'Status job backup tidak ditemukan.',
            ];
        }

        $status = Cache::get($this->monthlyBackupJobStatusKey($tenantId, $jobId));
        if (! is_array($status)) {
            $status = $this->readMonthlyBackupJobStatusFromDatabase($tenantId, $jobId);
            if (! is_array($status)) {
                return [
                    'job_id' => $jobId,
                    'tenant_id' => $tenantId,
                    'status' => 'missing',
                    'progress' => 0,
                    'message' => 'Status job backup tidak ditemukan atau sudah kedaluwarsa.',
                    'monthly_status' => $this->monthlyStatus($tenantId),
                ];
            }
        }

        if (! isset($status['monthly_status']) && in_array((string) ($status['status'] ?? ''), ['finished', 'failed', 'needs_attention'], true)) {
            $status['monthly_status'] = $this->monthlyStatus($tenantId);
        }

        return $status;
    }

    public function putMonthlyBackupJobStatus(string $tenantId, string $jobId, array $patch): void
    {
        $tenantId = trim($tenantId);
        $jobId = trim($jobId);
        if ($tenantId === '' || $jobId === '') {
            return;
        }

        $key = $this->monthlyBackupJobStatusKey($tenantId, $jobId);
        $current = Cache::get($key);
        if (! is_array($current)) {
            $current = [
                'job_id' => $jobId,
                'tenant_id' => $tenantId,
            ];
        }

        $next = array_merge($current, $patch, [
            'job_id' => $jobId,
            'tenant_id' => $tenantId,
            'updated_at' => now('Asia/Jakarta')->toIso8601String(),
        ]);

        Cache::put($key, $next, now()->addHours((int) config('backup.job_status_ttl_hours', 24)));
        $this->persistMonthlyBackupJobStatus($tenantId, $jobId, $next);
    }

    public function monthlyCatchUpKeysForTenant(string $tenantId, ?Carbon $runAt = null): array
    {
        $tenantId = trim($tenantId);
        if ($tenantId === '') {
            return [];
        }

        $now = ($runAt ?: now('Asia/Jakarta'))->copy()->setTimezone('Asia/Jakarta');
        $status = $this->monthlyStatus($tenantId, true);
        $months = array_values((array) ($status['months'] ?? []));
        $keys = [];

        foreach ($months as $month) {
            $monthKey = (string) ($month['key'] ?? '');
            if ($monthKey === '' || ! (bool) ($month['can_backup'] ?? false)) {
                continue;
            }

            try {
                $monthEnd = Carbon::parse((string) ($month['end_date'] ?? ''), 'Asia/Jakarta')->endOfDay();
            } catch (\Throwable $e) {
                continue;
            }

            if ($monthEnd->lessThanOrEqualTo($now) || $monthEnd->isSameDay($now)) {
                $keys[] = $monthKey;
            }
        }

        return array_values(array_unique($keys));
    }

    public function monthlyStatus(string $tenantId, bool $refresh = false): array
    {
        $tenantId = trim($tenantId);
        $active = $this->tenantActiveAcademicPeriod($tenantId);
        $year = $this->activeAcademicYear($tenantId);
        $months = $this->academicYearMonths($year);
        $now = now('Asia/Jakarta');
        $cacheKey = $this->monthlyStatusCacheKey($tenantId, $year);
        if ($refresh) {
            Cache::forget($cacheKey);
        } else {
            $cached = Cache::get($cacheKey);
            if (is_array($cached)) {
                return $cached;
            }
        }

        $items = [];
        foreach ($months as $month) {
            $window = $this->monthlyBackupWindow($tenantId, (string) $month['value'], $now);
            $record = $this->monthlyBackupRecord($tenantId, (string) $month['value']);
            $latestDataAt = $this->latestTenantDataAtCached(
                $tenantId,
                $window['month_start'],
                $window['effective_end_at'],
                $refresh
            );
            $lastBackupAt = $this->recordUploadedAt($record);
            $needsUpdate = $record && $latestDataAt && $lastBackupAt && $latestDataAt->greaterThan($lastBackupAt);
            $isFuture = $window['is_future'] ?? false;
            $status = $isFuture ? 'future' : ($record ? ($needsUpdate ? 'needs_update' : 'backed_up') : 'pending');
            $items[] = [
                'key' => (string) $month['value'],
                'label' => (string) $month['label'],
                'short_label' => (string) $month['short_label'],
                'start_date' => (string) $month['start_date'],
                'end_date' => (string) $month['end_date'],
                'effective_end_at' => $window['effective_end_at']->toIso8601String(),
                'status' => $status,
                'is_backed_up' => (bool) $record,
                'can_backup' => ! $isFuture && (! $record || $needsUpdate),
                'has_new_data' => (bool) $needsUpdate,
                'last_data_at' => optional($latestDataAt)->toIso8601String(),
                'last_backup_at' => optional($lastBackupAt)->toIso8601String(),
                'drive_file' => $record ? $this->driveRecordPayload($record) : null,
            ];
        }

        $backedUp = count(array_filter($items, static fn ($item) => (bool) ($item['is_backed_up'] ?? false)));

        $statusPayload = [
            'tenant' => $this->tenantSnapshot($tenantId),
            'schedule' => [
                'enabled' => true,
                'timezone' => 'Asia/Jakarta',
                'runs_at' => (string) config('backup.monthly_auto_start_time', '23:15'),
                'runs_at_label' => $this->monthlyAutoScheduleLabel(),
                'rule' => 'Scheduler berjalan harian, mengejar bulan yang sudah due/terlewat, dan tenant diproses bertahap agar server dan Google Drive tidak menumpuk.',
                'mode' => 'full',
                'destination' => 'Google Drive sekolah',
                'server_time' => $now->toIso8601String(),
                'server_time_label' => $now->format('Y-m-d H:i:s').' WIB',
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

        Cache::put(
            $cacheKey,
            $statusPayload,
            now()->addSeconds((int) config('backup.monthly_status_cache_ttl_seconds', 60))
        );

        return $statusPayload;
    }

    private function monthlyAutoScheduleLabel(): string
    {
        $start = trim((string) config('backup.monthly_auto_start_time', '23:15')) ?: '23:15';
        $spacing = (int) config('backup.monthly_auto_tenant_spacing_minutes', 4);

        return 'Setiap hari '.$start.' WIB, catch-up bulanan bertahap tiap '.$spacing.' menit per sekolah';
    }

    public function backupFailureStatus(string $message): string
    {
        return $this->isGoogleDriveAttentionError($message) ? 'needs_attention' : 'failed';
    }

    public function markGoogleDriveNeedsAttention(string $tenantId, string $message): void
    {
        $tenantId = trim($tenantId);
        if ($tenantId === '' || ! $this->hasTable('tenant_google_drive_configs')) {
            return;
        }

        try {
            $updates = [
                'status' => 'needs_attention',
                'updated_at' => now(),
            ];
            if ($this->tableHasColumn('tenant_google_drive_configs', 'last_error')) {
                $updates['last_error'] = Str::limit($message, 1000, '');
            }

            DB::table('tenant_google_drive_configs')
                ->where('tenant_id', $tenantId)
                ->update($updates);
        } catch (\Throwable $e) {
            // Status koneksi Drive bersifat observability; jangan gagalkan job.
        }
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

    private function monthlyBackupWindow(string $tenantId, string $monthKey, ?Carbon $runAt = null, ?Carbon $startAt = null): array
    {
        $month = $this->findAcademicMonth($tenantId, $monthKey);
        if (! $month) {
            throw new \RuntimeException('Bulan backup tidak berada dalam periode aktif sekolah.');
        }

        $serverTime = ($runAt ?: now('Asia/Jakarta'))->copy()->setTimezone('Asia/Jakarta');
        $monthStart = Carbon::parse((string) $month['start_date'], 'Asia/Jakarta')->startOfDay();
        $monthEnd = Carbon::parse((string) $month['end_date'], 'Asia/Jakarta')->endOfDay();
        $effectiveEnd = $serverTime->lessThan($monthEnd) ? $serverTime->copy() : $monthEnd->copy();
        $effectiveStart = ($startAt ?: $monthStart)->copy()->setTimezone('Asia/Jakarta');
        if ($effectiveStart->lessThan($monthStart)) {
            $effectiveStart = $monthStart->copy();
        }
        if ($effectiveStart->greaterThan($effectiveEnd)) {
            $effectiveStart = $effectiveEnd->copy();
        }

        $isFuture = $monthStart->greaterThan($serverTime);

        return [
            'month_start' => $monthStart,
            'month_end' => $monthEnd,
            'start_at' => $effectiveStart,
            'end_at' => $effectiveEnd,
            'effective_end_at' => $effectiveEnd,
            'server_time' => $serverTime,
            'is_future' => $isFuture,
            'can_backup' => ! $isFuture && $effectiveEnd->greaterThanOrEqualTo($monthStart),
            'reason' => $isFuture ? 'Bulan backup belum berjalan pada waktu server saat ini.' : null,
        ];
    }

    public function monthlyBackupFileName(string $tenantId, string $monthKey, bool $versioned = false): string
    {
        $tenant = $this->tenantSnapshot($tenantId);
        $slug = Str::slug((string) ($tenant['slug'] ?? $tenant['name'] ?? 'tenant')) ?: 'tenant';
        $suffix = $versioned ? '-update-'.now('Asia/Jakarta')->format('Ymd-His') : '';

        return 'backup-'.$slug.'-full-monthly-'.$monthKey.$suffix.'.json';
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

        $query = TenantGoogleDriveFile::query()
            ->where('tenant_id', $tenantId)
            ->where('bucket', 'backups');

        if (Schema::hasColumn('tenant_google_drive_files', 'extension')) {
            $query->where(function ($subQuery) {
                $subQuery->where('extension', 'json')
                    ->orWhereNull('extension');
            });
        }

        return $query->where(function ($query) use ($monthKey, $sourcePath) {
            $query->where('source_path', $sourcePath)
                ->orWhere('drive_file_name', 'like', '%monthly-'.$monthKey.'%')
                ->orWhere('source_path', 'like', '%monthly-'.$monthKey.'%');
        })
            ->latest('uploaded_at')
            ->first();
    }

    private function monthlyBackupJobStatusKey(string $tenantId, string $jobId): string
    {
        return 'tenant-backup-monthly-job:'.trim($tenantId).':'.trim($jobId);
    }

    private function monthlyBackupActiveJobKey(string $tenantId, ?string $monthKey, bool $auto): string
    {
        return implode(':', [
            'tenant-backup-monthly-active',
            trim($tenantId),
            $auto ? 'auto' : 'monthly',
            $auto ? 'all' : trim((string) $monthKey),
        ]);
    }

    private function latestActiveMonthlyBackupJobId(string $tenantId, ?string $monthKey, bool $auto): ?string
    {
        if (! $this->tenantBackupJobsTableReady()) {
            return null;
        }

        try {
            $query = DB::table('tenant_backup_jobs')
                ->where('tenant_id', $tenantId)
                ->where('type', $auto ? 'auto_monthly' : 'monthly')
                ->whereIn('status', ['queued', 'running', 'retrying'])
                ->latest('updated_at');

            if ($auto) {
                $query->whereNull('month_key');
            } else {
                $query->where('month_key', $monthKey);
            }

            $jobId = $query->value('job_id');

            return is_string($jobId) && trim($jobId) !== '' ? trim($jobId) : null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function readMonthlyBackupJobStatusFromDatabase(string $tenantId, string $jobId): ?array
    {
        if (! $this->tenantBackupJobsTableReady()) {
            return null;
        }

        try {
            $row = DB::table('tenant_backup_jobs')
                ->where('tenant_id', $tenantId)
                ->where('job_id', $jobId)
                ->first();
            if (! $row) {
                return null;
            }

            $result = $this->decodeJson($row->result ?? null);
            $metadata = $this->decodeJson($row->metadata ?? null);
            $status = [
                'job_id' => (string) $row->job_id,
                'tenant_id' => (string) $row->tenant_id,
                'month' => $row->month_key ? (string) $row->month_key : null,
                'type' => (string) ($row->type ?? 'monthly'),
                'status' => (string) ($row->status ?? 'missing'),
                'progress' => (int) ($row->progress ?? 0),
                'message' => $row->message ? (string) $row->message : null,
                'last_error' => $row->last_error ? (string) $row->last_error : null,
                'queued_at' => $row->queued_at ? Carbon::parse($row->queued_at)->toIso8601String() : null,
                'started_at' => $row->started_at ? Carbon::parse($row->started_at)->toIso8601String() : null,
                'finished_at' => $row->finished_at ? Carbon::parse($row->finished_at)->toIso8601String() : null,
                'failed_at' => $row->failed_at ? Carbon::parse($row->failed_at)->toIso8601String() : null,
                'updated_at' => $row->updated_at ? Carbon::parse($row->updated_at)->toIso8601String() : null,
            ];

            if ($result !== null) {
                $status['result'] = $result;
            }
            if ($metadata !== null) {
                $status = array_merge($status, $metadata);
            }

            return $status;
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function persistMonthlyBackupJobStatus(string $tenantId, string $jobId, array $status): void
    {
        if (! $this->tenantBackupJobsTableReady()) {
            return;
        }

        try {
            $now = now();
            $row = DB::table('tenant_backup_jobs')->where('job_id', $jobId)->first(['id']);
            $metadata = $status;
            unset(
                $metadata['job_id'],
                $metadata['tenant_id'],
                $metadata['month'],
                $metadata['type'],
                $metadata['status'],
                $metadata['progress'],
                $metadata['message'],
                $metadata['last_error'],
                $metadata['result'],
                $metadata['monthly_status'],
                $metadata['queued_at'],
                $metadata['started_at'],
                $metadata['finished_at'],
                $metadata['failed_at'],
                $metadata['updated_at']
            );
            $updates = [
                'tenant_id' => $tenantId,
                'job_id' => $jobId,
                'type' => (string) ($status['type'] ?? 'monthly'),
                'month_key' => isset($status['month']) && trim((string) $status['month']) !== '' ? trim((string) $status['month']) : null,
                'status' => (string) ($status['status'] ?? 'queued'),
                'progress' => max(0, min(100, (int) ($status['progress'] ?? 0))),
                'message' => isset($status['message']) ? (string) $status['message'] : null,
                'last_error' => isset($status['last_error']) ? (string) $status['last_error'] : null,
                'result' => isset($status['result'])
                    ? json_encode($status['result'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                    : null,
                'metadata' => ! empty($metadata)
                    ? json_encode($metadata, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                    : null,
                'queued_at' => $this->nullableTimestamp($status['queued_at'] ?? null),
                'started_at' => $this->nullableTimestamp($status['started_at'] ?? null),
                'finished_at' => $this->nullableTimestamp($status['finished_at'] ?? null),
                'failed_at' => $this->nullableTimestamp($status['failed_at'] ?? null),
                'updated_at' => $now,
            ];

            if ($row) {
                DB::table('tenant_backup_jobs')->where('job_id', $jobId)->update($updates);

                return;
            }

            $updates['id'] = (string) Str::uuid();
            $updates['created_at'] = $now;
            DB::table('tenant_backup_jobs')->insert($updates);
        } catch (\Throwable $e) {
            // Durable status tidak boleh menggagalkan backup.
        }
    }

    private function tenantBackupJobsTableReady(): bool
    {
        try {
            return Schema::hasTable('tenant_backup_jobs');
        } catch (\Throwable $e) {
            return false;
        }
    }

    private function nullableTimestamp(mixed $value): ?string
    {
        if ($value === null || trim((string) $value) === '') {
            return null;
        }

        try {
            return Carbon::parse((string) $value)->toDateTimeString();
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function decodeJson(mixed $value): ?array
    {
        if (is_array($value)) {
            return $value;
        }

        if (! is_string($value) || trim($value) === '') {
            return null;
        }

        $decoded = json_decode($value, true);

        return is_array($decoded) ? $decoded : null;
    }

    private function isGoogleDriveAttentionError(string $message): bool
    {
        $message = Str::lower($message);

        return Str::contains($message, [
            'google',
            'drive',
            'oauth',
            'token',
            'refresh',
            'unauthorized',
            'forbidden',
            'invalid_grant',
            'disconnected',
            'belum tersambung',
        ]);
    }

    private function attachPayloadChecksum(array $payload): array
    {
        unset($payload['manifest']['checksum']);
        $payload['manifest']['checksum'] = [
            'algorithm' => 'sha256',
            'scope' => 'payload_without_checksum',
            'generated_at' => now('Asia/Jakarta')->toIso8601String(),
            'value' => hash('sha256', json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: ''),
        ];

        return $payload;
    }

    private function monthlyStatusCacheKey(string $tenantId, string $academicYear): string
    {
        return 'tenant-backup-monthly-status:'.trim($tenantId).':'.trim($academicYear);
    }

    private function latestTenantDataAtCached(string $tenantId, Carbon $startAt, Carbon $endAt, bool $refresh = false): ?Carbon
    {
        $cacheKey = implode(':', [
            'tenant-backup-latest-data',
            trim($tenantId),
            $startAt->format('YmdHis'),
            $endAt->format('YmdHis'),
        ]);

        if ($refresh) {
            Cache::forget($cacheKey);
        }

        $cached = Cache::get($cacheKey);
        if (is_string($cached) && $cached !== '') {
            try {
                return Carbon::parse($cached, 'Asia/Jakarta');
            } catch (\Throwable $e) {
                Cache::forget($cacheKey);
            }
        }
        if ($cached === false) {
            return null;
        }

        $latest = $this->latestTenantDataAt($tenantId, $startAt, $endAt);
        Cache::put(
            $cacheKey,
            $latest ? $latest->toIso8601String() : false,
            now()->addSeconds((int) config('backup.monthly_status_cache_ttl_seconds', 60))
        );

        return $latest;
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

    private function recordUploadedAt(?TenantGoogleDriveFile $record): ?Carbon
    {
        if (! $record || ! $record->uploaded_at) {
            return null;
        }

        try {
            return $record->uploaded_at instanceof Carbon
                ? $record->uploaded_at->copy()
                : Carbon::parse($record->uploaded_at, 'Asia/Jakarta');
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function latestTenantDataAt(string $tenantId, Carbon $startAt, Carbon $endAt): ?Carbon
    {
        $latest = null;
        $ignoredTables = array_fill_keys([
            'audit_log',
            'tenant_google_drive_configs',
            'tenant_google_drive_files',
            'user_presence',
            'whatsapp_message_logs',
        ], true);
        foreach ($this->backupTablesForTenant() as $table) {
            if (
                $table === 'users'
                || isset($ignoredTables[$table])
                || ! $this->hasTable($table)
                || ! $this->tableHasColumn($table, 'tenant_id')
            ) {
                continue;
            }

            $timestampColumn = $this->firstExistingColumn($table, ['updated_at', 'created_at', 'uploaded_at', 'sent_at', 'tanggal']);
            if (! $timestampColumn) {
                continue;
            }

            $monthColumn = $this->firstExistingColumn($table, [
                'tanggal', 'scan_at', 'scanned_at', 'uploaded_at', 'queued_at', 'sent_at', 'failed_at',
                'requested_at', 'approved_at', 'rejected_at', 'printed_at', 'issued_at',
                'waktu_submit', 'started_at', 'finished_at', 'live_started_at', 'created_at',
            ]);

            try {
                $query = DB::table($table)->where('tenant_id', $tenantId);
                $rangeColumn = $monthColumn ?: $timestampColumn;
                $startValue = $rangeColumn === 'tanggal' ? $startAt->toDateString() : $startAt->toDateTimeString();
                $endValue = $rangeColumn === 'tanggal' ? $endAt->toDateString() : $endAt->toDateTimeString();
                $query->where($rangeColumn, '>=', $startValue)
                    ->where($rangeColumn, '<=', $endValue);

                $value = $query->max($timestampColumn);
                if (! $value) {
                    continue;
                }

                $candidate = Carbon::parse($value, 'Asia/Jakarta');
                if (! $latest || $candidate->greaterThan($latest)) {
                    $latest = $candidate;
                }
            } catch (\Throwable $e) {
                continue;
            }
        }

        return $latest;
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
