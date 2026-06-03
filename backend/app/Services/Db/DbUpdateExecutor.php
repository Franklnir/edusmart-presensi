<?php

namespace App\Services\Db;

use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DbUpdateExecutor
{
    public function execute(Request $request, $query, array $context, array $callbacks): JsonResponse
    {
        $table = (string) ($context['table'] ?? '');
        $payload = $context['payload'] ?? null;
        $tenantScoped = (bool) ($context['tenant_scoped'] ?? false);
        $tenantId = $context['tenant_id'] ?? null;
        $filters = is_array($context['filters'] ?? null) ? $context['filters'] : [];
        $isAdmin = (bool) ($context['is_admin'] ?? false);

        if (! is_array($payload) || empty($payload)) {
            return $callbacks['deny']('Payload tidak valid', 422);
        }

        $beforeMutationRows = ($callbacks['should_notify_whatsapp_for_table']($table) || $callbacks['should_capture_mutation_rows']($table))
            ? $callbacks['query_rows_to_array'](clone $query)
            : [];
        $beforeRows = [];
        $shouldAuditNilai = $table === 'tugas_jawaban' && $callbacks['is_nilai_audit_actor']($request);
        if ($shouldAuditNilai) {
            $beforeRows = $callbacks['query_rows_to_array'](clone $query);
        }

        if ($table === 'profiles' && array_key_exists('tanggal_lahir', $payload)) {
            $payload['usia'] = $callbacks['calculate_age_from_birth_date']($payload['tanggal_lahir']);
        }

        if ($tenantScoped) {
            unset($payload['tenant_id']);
        }

        try {
            $payload = $callbacks['normalize_json_row_for_table']($table, $payload);
        } catch (\InvalidArgumentException $e) {
            return $callbacks['deny']($e->getMessage(), 422);
        }

        $payload = $callbacks['filter_payload_to_existing_columns']($table, $payload);
        if ($table === 'profiles' && $isAdmin) {
            $payload = $callbacks['normalize_profile_cohort_payload']($payload, $tenantId);
        }
        if (empty($payload)) {
            return $callbacks['deny']('Payload tidak memiliki kolom yang valid', 422);
        }

        if ($table === 'ekskul') {
            $deadlineError = $callbacks['validate_ekskul_registration_deadline_rows']([$payload], $tenantId);
            if ($deadlineError !== null) {
                return $callbacks['deny']($deadlineError['message'], $deadlineError['status']);
            }
        }

        $profileIdForIdentitySync = null;
        if ($table === 'profiles' && $isAdmin) {
            $profileIdFromFilter = null;
            if (array_key_exists('email', $payload)) {
                $candidateEmail = strtolower(trim((string) $payload['email']));
                if (! filter_var($candidateEmail, FILTER_VALIDATE_EMAIL)) {
                    return $callbacks['deny']('Email tidak valid', 422);
                }
                $payload['email'] = $candidateEmail;
            }

            if (array_key_exists('email', $payload) || array_key_exists('nama', $payload)) {
                $profileIdFromFilter = $filters['eq']['id'] ?? null;
                if (is_string($profileIdFromFilter) && $profileIdFromFilter !== '') {
                    $profileIdForIdentitySync = $profileIdFromFilter;
                }
            }

            if (array_key_exists('email', $payload) && is_string($profileIdFromFilter) && $profileIdFromFilter !== '') {
                $duplicateQuery = DB::table('profiles')
                    ->whereRaw('lower(email) = ?', [$payload['email']])
                    ->where('id', '!=', $profileIdFromFilter);
                if ($tenantId && $callbacks['is_selectable_column']('profiles', 'tenant_id')) {
                    $duplicateQuery->where('tenant_id', $tenantId);
                }
                if ($duplicateQuery->exists()) {
                    return $callbacks['deny']('Email sudah terdaftar di sekolah ini', 409);
                }
            }
        }

        try {
            $updated = DB::transaction(function () use (
                $query,
                $payload,
                $profileIdForIdentitySync,
                $tenantId,
                $callbacks
            ) {
                $updatedCount = $query->update($payload);

                if ($updatedCount && $profileIdForIdentitySync) {
                    $freshProfileQuery = DB::table('profiles')
                        ->where('id', $profileIdForIdentitySync);
                    if ($tenantId) {
                        $freshProfileQuery->where('tenant_id', $tenantId);
                    }
                    $freshProfile = $freshProfileQuery->first(['id', 'role', 'nama', 'email']);

                    if ($freshProfile) {
                        $now = now();
                        $userPayload = ['updated_at' => $now];

                        if (array_key_exists('email', $payload)) {
                            $userPayload['email'] = strtolower(trim((string) ($freshProfile->email ?? $payload['email'])));
                        }

                        if (array_key_exists('nama', $payload)) {
                            $userPayload['name'] = preg_replace('/\s+/', ' ', trim((string) ($freshProfile->nama ?? $payload['nama']))) ?? '';
                        }

                        if (count($userPayload) > 1) {
                            DB::table('users')
                                ->where('id', $profileIdForIdentitySync)
                                ->update($userPayload);
                        }

                        $role = strtolower((string) ($freshProfile->role ?? ''));
                        if (array_key_exists('email', $payload) || array_key_exists('nama', $payload)) {
                            if (in_array($role, ['guru', 'teacher'], true)) {
                                $callbacks['sync_teacher_display_name_snapshots'](
                                    (string) $tenantId,
                                    $profileIdForIdentitySync,
                                    (string) ($freshProfile->nama ?? ''),
                                    $now
                                );
                            } elseif ($role === 'siswa' && array_key_exists('nama', $payload)) {
                                $callbacks['sync_student_display_name_snapshots'](
                                    (string) $tenantId,
                                    $profileIdForIdentitySync,
                                    (string) ($freshProfile->nama ?? ''),
                                    $now
                                );
                            }
                        }
                    }
                }

                return $updatedCount;
            });
        } catch (QueryException $e) {
            $message = strtolower($e->getMessage());
            if (str_contains($message, 'duplicate') || str_contains($message, 'unique')) {
                return $callbacks['deny']('Email sudah digunakan akun lain', 409);
            }
            throw $e;
        }

        if ($updated > 0) {
            $afterMutationRows = $callbacks['should_notify_whatsapp_for_table']($table)
                ? $callbacks['query_rows_to_array'](clone $query)
                : [];
            $callbacks['notify_whatsapp_mutation']($tenantId, $table, 'update', $beforeMutationRows, $afterMutationRows);
            $callbacks['after_mutation']($tenantId, $table, $beforeMutationRows, $afterMutationRows);
        }

        if ($shouldAuditNilai && $updated > 0) {
            $afterRows = $callbacks['query_rows_to_array'](clone $query);
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

        return response()->json(['data' => $updated]);
    }
}
