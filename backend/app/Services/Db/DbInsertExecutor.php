<?php

namespace App\Services\Db;

use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DbInsertExecutor
{
    public function execute(Request $request, array $context, array $callbacks): JsonResponse
    {
        $table = (string) ($context['table'] ?? '');
        $payload = $context['payload'] ?? null;
        $tenantScoped = (bool) ($context['tenant_scoped'] ?? false);
        $tenantId = $context['tenant_id'] ?? null;
        $isAdmin = (bool) ($context['is_admin'] ?? false);

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

        if ($table === 'profiles' && $isAdmin) {
            $rows = $callbacks['attach_profile_cohort_rows']($rows, $tenantId);
        }

        if ($table === 'kelas') {
            $kelasError = $callbacks['prepare_kelas_rows_for_insert']($rows, $tenantId);
            if ($kelasError !== null) {
                return $callbacks['deny']($kelasError['message'], $kelasError['status']);
            }
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

        if ($table === 'settings') {
            $saved = $callbacks['save_settings_singleton_rows']($rows, $tenantId, $tenantScoped);

            return response()->json(['data' => $saved]);
        }

        if ($table === 'profiles' && $isAdmin) {
            $profileInsertError = $callbacks['validate_profile_rows_for_tenant_insert']($rows, $tenantId);
            if ($profileInsertError !== null) {
                return $callbacks['deny']($profileInsertError['message'], $profileInsertError['status']);
            }
        }

        if ($table === 'absensi_rfid_settings') {
            $singletonTenantId = $tenantId ?: (string) ($rows[0]['tenant_id'] ?? '');
            if ($singletonTenantId === '') {
                return $callbacks['deny']('Tenant tidak valid', 400);
            }
            $saved = $callbacks['save_tenant_singleton_rows']($table, $rows, $singletonTenantId);

            return response()->json(['data' => $saved]);
        }

        $beforeRows = [];
        $shouldAuditNilai = $table === 'tugas_jawaban' && $callbacks['is_nilai_audit_actor']($request);
        if ($shouldAuditNilai) {
            $beforeRows = $callbacks['fetch_tugas_jawaban_rows_for_payload']($rows, $tenantId);
        }

        try {
            DB::table($table)->insert($rows);
        } catch (QueryException $e) {
            if ($callbacks['is_unique_constraint_exception']($e)) {
                return $callbacks['deny']('Data sudah ada atau bentrok dengan data yang sudah tersimpan', 409);
            }
            throw $e;
        }

        $callbacks['notify_whatsapp_mutation']($tenantId, $table, 'insert', [], $rows);
        $callbacks['after_mutation']($tenantId, $table, [], $rows);

        if ($shouldAuditNilai) {
            $afterRows = $callbacks['fetch_tugas_jawaban_rows_for_payload']($rows, $tenantId);
            $callbacks['log_audit'](
                $request,
                'tugas_jawaban',
                'bulk',
                'INSERT',
                $beforeRows,
                $afterRows,
                $tenantId
            );
        }

        return response()->json(['data' => $rows]);
    }
}
