<?php

namespace App\Services\Academic;

use App\Support\AcademicScopeRegistry;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class AcademicCorrectionService
{
    public function create(
        string $tenantId,
        string $userId,
        string $termId,
        string $reason,
        array $allowedScopes,
        int $durationMinutes = 30
    ): ?array {
        if (! Schema::hasTable('academic_correction_sessions')) {
            return null;
        }

        $term = DB::table('academic_terms')
            ->where('tenant_id', $tenantId)
            ->where('id', $termId)
            ->first();
        if (! $term) {
            return null;
        }
        $year = DB::table('academic_years')
            ->where('tenant_id', $tenantId)
            ->where('id', $term->academic_year_id)
            ->first();
        if (! $year) {
            return null;
        }
        if ($term->status !== 'closed' && $year->status !== 'closed') {
            throw new \DomainException('Sesi koreksi hanya dapat dibuat untuk periode yang sudah ditutup.');
        }

        $reason = preg_replace('/\s+/', ' ', trim($reason)) ?? '';
        if (mb_strlen($reason) < 10 || mb_strlen($reason) > 500) {
            throw new \InvalidArgumentException('Alasan koreksi harus berisi 10 sampai 500 karakter.');
        }

        $allowed = collect($allowedScopes)
            ->map(fn ($scope) => strtolower(trim((string) $scope)))
            ->filter(fn ($scope) => AcademicScopeRegistry::isDirectlyMutablePeriodTable($scope))
            ->unique()
            ->values()
            ->all();
        if ($allowed === []) {
            throw new \InvalidArgumentException('Pilih minimal satu cakupan data yang boleh dikoreksi.');
        }

        $durationMinutes = max(5, min(60, $durationMinutes));
        $now = now();
        $id = (string) Str::uuid();
        DB::table('academic_correction_sessions')->insert([
            'id' => $id,
            'tenant_id' => $tenantId,
            'academic_year_id' => $year->id,
            'academic_term_id' => $term->id,
            'requested_by' => $userId,
            'reason' => $reason,
            'allowed_scopes' => json_encode($allowed),
            'status' => 'active',
            'expires_at' => $now->copy()->addMinutes($durationMinutes),
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return $this->payload(DB::table('academic_correction_sessions')->where('id', $id)->first(), $year, $term);
    }

    public function validateForMutation(
        ?string $sessionId,
        string $tenantId,
        string $userId,
        string $table
    ): ?array {
        $sessionId = trim((string) $sessionId);
        if ($sessionId === '' || ! Schema::hasTable('academic_correction_sessions')) {
            return null;
        }

        $session = DB::table('academic_correction_sessions')
            ->where('id', $sessionId)
            ->where('tenant_id', $tenantId)
            ->where('requested_by', $userId)
            ->first();
        if (! $session || $session->status !== 'active') {
            return null;
        }
        if (now()->greaterThanOrEqualTo($session->expires_at)) {
            DB::table('academic_correction_sessions')->where('id', $session->id)->update([
                'status' => 'expired',
                'updated_at' => now(),
            ]);

            return null;
        }

        $allowed = json_decode((string) $session->allowed_scopes, true);
        if (! is_array($allowed) || ! in_array($table, $allowed, true)) {
            return null;
        }

        $year = DB::table('academic_years')
            ->where('tenant_id', $tenantId)
            ->where('id', $session->academic_year_id)
            ->first();
        $term = $session->academic_term_id
            ? DB::table('academic_terms')
                ->where('tenant_id', $tenantId)
                ->where('id', $session->academic_term_id)
                ->first()
            : null;
        if (! $year || (AcademicScopeRegistry::isTermScoped($table) && ! $term)) {
            return null;
        }

        return [
            'id' => (string) $session->id,
            'tenant_id' => $tenantId,
            'tahun_ajaran' => (string) $year->label,
            'semester' => $term?->semester,
            'academic_year_id' => (string) $year->id,
            'academic_term_id' => $term?->id,
            'allowed_scopes' => $allowed,
            'reason' => (string) $session->reason,
            'expires_at' => $session->expires_at,
            'mode' => 'correction',
        ];
    }

    public function close(string $tenantId, string $userId, string $sessionId): bool
    {
        if (! Schema::hasTable('academic_correction_sessions')) {
            return false;
        }

        return DB::table('academic_correction_sessions')
            ->where('id', $sessionId)
            ->where('tenant_id', $tenantId)
            ->where('requested_by', $userId)
            ->where('status', 'active')
            ->update([
                'status' => 'closed',
                'closed_at' => now(),
                'closed_by' => $userId,
                'updated_at' => now(),
            ]) > 0;
    }

    public function activeForActor(string $tenantId, string $userId): array
    {
        if (! Schema::hasTable('academic_correction_sessions')) {
            return [];
        }

        DB::table('academic_correction_sessions')
            ->where('tenant_id', $tenantId)
            ->where('requested_by', $userId)
            ->where('status', 'active')
            ->where('expires_at', '<=', now())
            ->update([
                'status' => 'expired',
                'updated_at' => now(),
            ]);

        return DB::table('academic_correction_sessions as sessions')
            ->join('academic_years as years', function ($join) {
                $join->on('years.id', '=', 'sessions.academic_year_id')
                    ->on('years.tenant_id', '=', 'sessions.tenant_id');
            })
            ->leftJoin('academic_terms as terms', function ($join) {
                $join->on('terms.id', '=', 'sessions.academic_term_id')
                    ->on('terms.tenant_id', '=', 'sessions.tenant_id');
            })
            ->where('sessions.tenant_id', $tenantId)
            ->where('sessions.requested_by', $userId)
            ->where('sessions.status', 'active')
            ->where('sessions.expires_at', '>', now())
            ->orderByDesc('sessions.created_at')
            ->get([
                'sessions.id',
                'sessions.tenant_id',
                'sessions.allowed_scopes',
                'sessions.reason',
                'sessions.status',
                'sessions.expires_at',
                'years.label as tahun_ajaran',
                'terms.semester',
            ])
            ->map(fn ($row) => [
                'id' => (string) $row->id,
                'tenant_id' => (string) $row->tenant_id,
                'tahun_ajaran' => (string) $row->tahun_ajaran,
                'semester' => $row->semester ? (string) $row->semester : null,
                'allowed_scopes' => json_decode((string) $row->allowed_scopes, true) ?: [],
                'reason' => (string) $row->reason,
                'status' => (string) $row->status,
                'expires_at' => $row->expires_at,
            ])
            ->values()
            ->all();
    }

    private function payload(object $session, object $year, object $term): array
    {
        return [
            'id' => (string) $session->id,
            'tenant_id' => (string) $session->tenant_id,
            'academic_year_id' => (string) $year->id,
            'academic_term_id' => (string) $term->id,
            'tahun_ajaran' => (string) $year->label,
            'semester' => (string) $term->semester,
            'allowed_scopes' => json_decode((string) $session->allowed_scopes, true) ?: [],
            'reason' => (string) $session->reason,
            'status' => (string) $session->status,
            'expires_at' => $session->expires_at,
        ];
    }
}
