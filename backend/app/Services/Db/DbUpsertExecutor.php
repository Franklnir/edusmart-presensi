<?php

namespace App\Services\Db;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DbUpsertExecutor
{
    public function execute(Request $request, array $context, array $callbacks): JsonResponse
    {
        $table = (string) ($context['table'] ?? '');
        $payload = $context['payload'] ?? null;
        $tenantScoped = (bool) ($context['tenant_scoped'] ?? false);
        $tenantId = $context['tenant_id'] ?? null;

        $rows = $callbacks['normalize_rows']($payload);
        if (empty($rows)) {
            return $callbacks['deny']('Payload kosong', 422);
        }

        if ($tenantScoped && $tenantId) {
            $rows = $callbacks['attach_tenant_rows']($rows, $tenantId);
        }

        $rows = $callbacks['attach_academic_period_rows']($table, $rows, $tenantId);
        try {
            $rows = $callbacks['normalize_json_rows_for_table']($table, $rows);
        } catch (\InvalidArgumentException $e) {
            return $callbacks['deny']($e->getMessage(), 422);
        }

        $rows = $callbacks['filter_rows_to_existing_columns']($table, $rows);
        if (empty($rows)) {
            return $callbacks['deny']('Payload tidak memiliki kolom yang valid', 422);
        }

        if ($table === 'ekskul') {
            $deadlineError = $callbacks['validate_ekskul_registration_deadline_rows']($rows, $tenantId, true);
            if ($deadlineError !== null) {
                return $callbacks['deny']($deadlineError['message'], $deadlineError['status']);
            }
        }

        if ($table === 'ekskul_anggota') {
            $membershipError = $callbacks['validate_ekskul_membership_rows_open']($rows, $tenantId);
            if ($membershipError !== null) {
                return $callbacks['deny']($membershipError['message'], $membershipError['status']);
            }
        }

        $beforeRows = [];
        $shouldAuditNilai = $table === 'tugas_jawaban' && $callbacks['is_nilai_audit_actor']($request);
        if ($shouldAuditNilai) {
            $beforeRows = $callbacks['fetch_tugas_jawaban_rows_for_payload']($rows, $tenantId);
        }

        if ($table === 'settings') {
            $saved = $callbacks['save_settings_singleton_rows']($rows, $tenantId, $tenantScoped);

            return response()->json(['data' => $saved]);
        }

        if ($table === 'absensi_rfid_settings') {
            $singletonTenantId = $tenantId ?: (string) ($rows[0]['tenant_id'] ?? '');
            if ($singletonTenantId === '') {
                return $callbacks['deny']('Tenant tidak valid', 400);
            }
            $saved = $callbacks['save_tenant_singleton_rows']($table, $rows, $singletonTenantId);

            return response()->json(['data' => $saved]);
        }

        $onConflict = $request->input('onConflict');
        if (is_string($onConflict) && $onConflict !== '') {
            $uniqueBy = array_values(array_filter(array_map('trim', explode(',', $onConflict))));
        } else {
            $uniqueBy = [];
        }
        if (! empty($uniqueBy)) {
            $uniqueBy = array_values(array_filter(
                $uniqueBy,
                fn ($column) => $callbacks['is_selectable_column']($table, (string) $column)
            ));
        }

        if (
            in_array($table, ['absensi', 'absensi_settings', 'absensi_scan_temp'], true) &&
            $tenantId &&
            $callbacks['is_selectable_column']($table, 'tenant_id')
        ) {
            $uniqueBy = array_values(array_unique(array_merge(['tenant_id'], $uniqueBy)));
        }

        if ($table === 'settings' && empty($uniqueBy)) {
            $existingQuery = DB::table('settings')->orderBy('id');
            if ($tenantScoped && $tenantId) {
                $existingQuery->where('tenant_id', $tenantId);
            }
            $existing = $existingQuery->first();
            if ($existing && isset($rows[0]['id'])) {
                $updateQuery = DB::table('settings')->where('id', $rows[0]['id']);
                if ($tenantScoped && $tenantId) {
                    $updateQuery->where('tenant_id', $tenantId);
                }
                $updateQuery->update($rows[0]);

                return response()->json(['data' => $rows]);
            }
        }

        if (empty($uniqueBy)) {
            if (isset($rows[0]['id'])) {
                $uniqueBy = ['id'];
            } else {
                DB::table($table)->insert($rows);

                $callbacks['notify_whatsapp_mutation']($tenantId, $table, 'upsert', [], $rows);

                if ($shouldAuditNilai) {
                    $afterRows = $callbacks['fetch_tugas_jawaban_rows_for_payload']($rows, $tenantId);
                    $callbacks['log_audit'](
                        $request,
                        'tugas_jawaban',
                        'bulk',
                        'UPDATE',
                        $beforeRows,
                        $afterRows,
                        $tenantId
                    );
                }

                return response()->json(['data' => $rows]);
            }
        }

        $updateColumns = array_keys($rows[0]);
        if (! empty($uniqueBy)) {
            $updateColumns = array_values(array_filter(
                $updateColumns,
                fn ($column) => ! in_array($column, $uniqueBy, true)
                    && ($column !== 'id' || in_array('id', $uniqueBy, true))
                    && $column !== 'created_at'
            ));
        }
        $manualFallbackTables = [
            'absensi',
            'absensi_settings',
            'absensi_scan_temp',
            'guru_mapel_bobot',
            'guru_mapel_manual_nilai',
            'rapot_siswa',
            'rapot_siswa_items',
        ];

        if (in_array($table, $manualFallbackTables, true) && ! empty($uniqueBy)) {
            $resolved = [];
            try {
                DB::table($table)->upsert($rows, $uniqueBy, $updateColumns);
                $resolved = $callbacks['fetch_rows_by_keys']($table, $rows, $uniqueBy, $tenantId);
            } catch (\Throwable $e) {
                $message = strtolower($e->getMessage() ?? '');
                if (str_contains($message, 'on conflict') || str_contains($message, 'unique')) {
                    $resolved = $callbacks['manual_upsert_by_keys']($table, $rows, $uniqueBy, $tenantId);
                } else {
                    throw $e;
                }
            }

            $callbacks['notify_whatsapp_mutation']($tenantId, $table, 'upsert', [], $resolved);

            return response()->json(['data' => $resolved]);
        }

        DB::table($table)->upsert($rows, $uniqueBy, $updateColumns);

        $callbacks['notify_whatsapp_mutation']($tenantId, $table, 'upsert', [], $rows);

        if ($shouldAuditNilai) {
            $afterRows = $callbacks['fetch_tugas_jawaban_rows_for_payload']($rows, $tenantId);
            $callbacks['log_audit'](
                $request,
                'tugas_jawaban',
                'bulk',
                'UPDATE',
                $beforeRows,
                $afterRows,
                $tenantId
            );
        }

        return response()->json(['data' => $rows]);
    }
}
