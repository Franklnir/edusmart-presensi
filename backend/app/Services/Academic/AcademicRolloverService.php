<?php

namespace App\Services\Academic;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class AcademicRolloverService
{
    public function lockTenant(string $tenantId): void
    {
        if (Schema::hasTable('settings')) {
            DB::table('settings')
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first(['id']);
        }

        if (Schema::hasTable('academic_years')) {
            DB::table('academic_years')
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->lockForUpdate()
                ->get(['id']);
        }
    }

    public function execute(
        string $tenantId,
        mixed $sourceYearId,
        mixed $targetYearId,
        string $sourceYear,
        string $targetYear,
        string $actorId,
        callable $operation
    ): array {
        $this->lockTenant($tenantId);

        if (! Schema::hasTable('academic_rollover_runs') || trim((string) $targetYearId) === '') {
            return ['run_id' => null, 'result' => $operation()];
        }

        $idempotencyKey = 'annual_rollover:'.$sourceYear.':'.$targetYear;
        $existing = DB::table('academic_rollover_runs')
            ->where('tenant_id', $tenantId)
            ->where('idempotency_key', $idempotencyKey)
            ->lockForUpdate()
            ->first();
        if ($existing) {
            throw new \RuntimeException(
                (string) $existing->status === 'completed'
                    ? 'Rollover periode ini sudah pernah diselesaikan.'
                    : 'Rollover periode ini sedang diproses atau perlu diperiksa.'
            );
        }

        $runId = (string) Str::uuid();
        $now = now();
        DB::table('academic_rollover_runs')->insert([
            'id' => $runId,
            'tenant_id' => $tenantId,
            'source_academic_year_id' => trim((string) $sourceYearId) ?: null,
            'target_academic_year_id' => (string) $targetYearId,
            'operation' => 'annual_rollover',
            'idempotency_key' => $idempotencyKey,
            'status' => 'running',
            'created_by' => trim($actorId) ?: null,
            'started_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        try {
            $result = $operation();
            DB::table('academic_rollover_runs')
                ->where('tenant_id', $tenantId)
                ->where('id', $runId)
                ->update([
                    'status' => 'completed',
                    'result' => json_encode($result),
                    'finished_at' => now(),
                    'updated_at' => now(),
                ]);

            return ['run_id' => $runId, 'result' => $result];
        } catch (\Throwable $e) {
            DB::table('academic_rollover_runs')
                ->where('tenant_id', $tenantId)
                ->where('id', $runId)
                ->update([
                    'status' => 'failed',
                    'error_message' => mb_substr($e->getMessage(), 0, 2000),
                    'finished_at' => now(),
                    'updated_at' => now(),
                ]);

            throw $e;
        }
    }
}
