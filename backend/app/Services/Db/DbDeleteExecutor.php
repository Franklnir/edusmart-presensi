<?php

namespace App\Services\Db;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DbDeleteExecutor
{
    public function execute(Request $request, $query, array $context, array $callbacks): JsonResponse
    {
        $table = (string) ($context['table'] ?? '');
        $tenantId = $context['tenant_id'] ?? null;
        $isAdmin = (bool) ($context['is_admin'] ?? false);

        $beforeMutationRows = $callbacks['should_notify_whatsapp_for_table']($table)
            ? $callbacks['query_rows_to_array'](clone $query)
            : [];
        $beforeRows = [];
        $shouldAuditNilai = $table === 'tugas_jawaban' && $callbacks['is_nilai_audit_actor']($request);
        if ($shouldAuditNilai) {
            $beforeRows = $callbacks['query_rows_to_array'](clone $query);
        }

        if ($table === 'profiles' && $isAdmin) {
            $updated = $query->update([
                'status' => 'nonaktif',
                'alasan_nonaktif' => 'Dinonaktifkan oleh admin',
                'disabled_at' => now(),
                'deleted_at' => now(),
                'updated_at' => now(),
            ]);

            if ($shouldAuditNilai && $updated > 0) {
                $callbacks['log_audit'](
                    $request,
                    'tugas_jawaban',
                    'bulk',
                    'DELETE',
                    $beforeRows,
                    [],
                    $tenantId
                );
            }

            if ($updated > 0) {
                $afterMutationRows = $callbacks['query_rows_to_array'](clone $query);
                $callbacks['notify_whatsapp_mutation']($tenantId, $table, 'delete', $beforeMutationRows, $afterMutationRows);
            }

            return response()->json(['data' => $updated]);
        }

        $deleted = $query->delete();

        if ($deleted > 0) {
            $callbacks['notify_whatsapp_mutation']($tenantId, $table, 'delete', $beforeMutationRows, []);
        }

        if ($shouldAuditNilai && $deleted > 0) {
            $callbacks['log_audit'](
                $request,
                'tugas_jawaban',
                'bulk',
                'DELETE',
                $beforeRows,
                [],
                $tenantId
            );
        }

        return response()->json(['data' => $deleted]);
    }
}
