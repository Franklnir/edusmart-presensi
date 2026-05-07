<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class ApprovalController extends ApiController
{
    public function index(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }
        if (! Schema::hasTable('approval_requests')) {
            return $this->deny('Fitur maker-checker belum aktif. Jalankan migrasi terbaru.', 503);
        }

        $isSuperAdmin = $this->isSuperAdmin($request);
        $tenantFilter = trim((string) $request->query('tenant_id', ''));
        $fallbackTenantId = $this->resolveOwnedTenantId($request);

        $scopeTenantId = $isSuperAdmin
            ? $tenantFilter
            : ($tenantFilter !== '' ? $tenantFilter : $fallbackTenantId);
        if (! $isSuperAdmin && ! $scopeTenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $query = DB::table('approval_requests as ar')
            ->leftJoin('profiles as maker', 'maker.id', '=', 'ar.requested_by')
            ->leftJoin('profiles as approver', 'approver.id', '=', 'ar.approved_by')
            ->leftJoin('profiles as rejector', 'rejector.id', '=', 'ar.rejected_by')
            ->leftJoin('tenants as t', 't.id', '=', 'ar.tenant_id')
            ->select(
                'ar.id',
                'ar.tenant_id',
                't.name as tenant_name',
                'ar.status',
                'ar.target_table',
                'ar.target_action',
                'ar.target_record_id',
                'ar.change_payload',
                'ar.change_summary',
                'ar.affected_rows_estimate',
                'ar.risk_level',
                'ar.requested_by',
                'ar.requested_by_role',
                'ar.requested_at',
                'ar.request_note',
                'ar.approved_by',
                'ar.approved_at',
                'ar.rejected_by',
                'ar.rejected_at',
                'ar.review_note',
                'maker.nama as requested_by_name',
                'approver.nama as approved_by_name',
                'rejector.nama as rejected_by_name'
            );

        if ($scopeTenantId !== '') {
            $query->where('ar.tenant_id', $scopeTenantId);
        }

        $status = strtolower(trim((string) $request->query('status', '')));
        if ($status !== '') {
            $query->where('ar.status', $status);
        }

        $targetTable = trim((string) $request->query('table', ''));
        if ($targetTable !== '') {
            $query->where('ar.target_table', $targetTable);
        }

        $targetAction = strtoupper(trim((string) $request->query('action', '')));
        if ($targetAction !== '') {
            $query->where('ar.target_action', $targetAction);
        }

        $riskLevel = strtolower(trim((string) $request->query('risk', '')));
        if ($riskLevel !== '') {
            $query->where('ar.risk_level', $riskLevel);
        }

        $q = trim((string) $request->query('q', ''));
        if ($q !== '') {
            $like = '%'.strtolower($q).'%';
            $query->where(function ($builder) use ($like) {
                $builder
                    ->whereRaw("LOWER(COALESCE(ar.change_summary, '')) LIKE ?", [$like])
                    ->orWhereRaw("LOWER(COALESCE(ar.target_table, '')) LIKE ?", [$like])
                    ->orWhereRaw("LOWER(COALESCE(maker.nama, '')) LIKE ?", [$like])
                    ->orWhereRaw("LOWER(COALESCE(t.name, '')) LIKE ?", [$like]);
            });
        }

        $from = $request->query('from');
        if ($from) {
            try {
                $query->where('ar.requested_at', '>=', Carbon::parse((string) $from));
            } catch (\Throwable $e) {
                // ignore invalid filter
            }
        }

        $to = $request->query('to');
        if ($to) {
            try {
                $query->where('ar.requested_at', '<=', Carbon::parse((string) $to));
            } catch (\Throwable $e) {
                // ignore invalid filter
            }
        }

        $limit = (int) $request->query('limit', 100);
        $limit = max(1, min(250, $limit));

        $rows = $query
            ->orderByDesc('ar.requested_at')
            ->limit($limit)
            ->get()
            ->map(function ($row) {
                $row->change_payload = $this->decodeJsonValue($row->change_payload);

                return $row;
            })
            ->values();

        $summaryQuery = DB::table('approval_requests');
        if ($scopeTenantId !== '') {
            $summaryQuery->where('tenant_id', $scopeTenantId);
        }

        $summary = $summaryQuery
            ->selectRaw("sum(case when status = 'pending' then 1 else 0 end) as pending")
            ->selectRaw("sum(case when status = 'approved' then 1 else 0 end) as approved")
            ->selectRaw("sum(case when status = 'rejected' then 1 else 0 end) as rejected")
            ->selectRaw("sum(case when status = 'cancelled' then 1 else 0 end) as cancelled")
            ->selectRaw('count(*) as total')
            ->first();

        return response()->json([
            'data' => [
                'rows' => $rows,
                'summary' => [
                    'pending' => (int) ($summary->pending ?? 0),
                    'approved' => (int) ($summary->approved ?? 0),
                    'rejected' => (int) ($summary->rejected ?? 0),
                    'cancelled' => (int) ($summary->cancelled ?? 0),
                    'total' => (int) ($summary->total ?? 0),
                ],
            ],
        ]);
    }

    public function approve(Request $request, string $id)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }
        if (! Schema::hasTable('approval_requests')) {
            return $this->deny('Fitur maker-checker belum aktif. Jalankan migrasi terbaru.', 503);
        }

        $approval = $this->findApprovalByScope($request, $id);
        if (! $approval) {
            return $this->deny('Permintaan approval tidak ditemukan', 404);
        }
        if ($approval->status !== 'pending') {
            return $this->deny('Permintaan approval sudah diproses', 409);
        }

        $actorId = (string) ($request->user()?->id ?? '');
        if ($this->requiresSecondApprover((string) $approval->tenant_id) && $actorId !== '' && $actorId === (string) ($approval->requested_by ?? '')) {
            return $this->deny('Maker tidak boleh approve request miliknya sendiri', 409);
        }

        $payload = $this->decodeJsonValue($approval->change_payload);
        if (! is_array($payload)) {
            return $this->deny('Payload approval tidak valid', 422);
        }

        $dbRequest = Request::create('/api/db', 'POST', [
            'table' => $payload['table'] ?? null,
            'action' => $payload['action'] ?? null,
            'payload' => $payload['payload'] ?? null,
            'filters' => $payload['filters'] ?? [],
            'order' => $payload['order'] ?? [],
            'onConflict' => $payload['onConflict'] ?? null,
            'limit' => $payload['limit'] ?? null,
            'offset' => $payload['offset'] ?? null,
        ]);
        $dbRequest->setUserResolver(fn () => $request->user());
        $dbRequest->attributes->set('tenant_id', (string) $approval->tenant_id);
        $dbRequest->attributes->set('tenant_slug', $request->attributes->get('tenant_slug'));
        $dbRequest->attributes->set('approval_exec', true);

        $response = app(DbController::class)->handle($dbRequest);
        if ($response->getStatusCode() >= 400) {
            $parsed = $this->decodeJsonValue($response->getContent());

            return response()->json([
                'error' => $parsed['error'] ?? 'Eksekusi approval gagal',
                'code' => $parsed['code'] ?? null,
                'approval_id' => $approval->id,
            ], $response->getStatusCode());
        }

        $oldData = (array) $approval;
        $reviewNote = trim((string) $request->input('note', ''));

        DB::table('approval_requests')
            ->where('id', $approval->id)
            ->update([
                'status' => 'approved',
                'approved_by' => $actorId !== '' ? $actorId : null,
                'approved_at' => now(),
                'review_note' => $reviewNote !== '' ? $reviewNote : null,
                'updated_at' => now(),
            ]);

        $newData = DB::table('approval_requests')->where('id', $approval->id)->first();
        $this->logAudit(
            $request,
            'approval_requests',
            (string) $approval->id,
            'UPDATE',
            $oldData,
            $newData,
            (string) $approval->tenant_id
        );

        return response()->json([
            'data' => [
                'id' => $approval->id,
                'status' => 'approved',
            ],
        ]);
    }

    public function reject(Request $request, string $id)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }
        if (! Schema::hasTable('approval_requests')) {
            return $this->deny('Fitur maker-checker belum aktif. Jalankan migrasi terbaru.', 503);
        }

        $approval = $this->findApprovalByScope($request, $id);
        if (! $approval) {
            return $this->deny('Permintaan approval tidak ditemukan', 404);
        }
        if ($approval->status !== 'pending') {
            return $this->deny('Permintaan approval sudah diproses', 409);
        }

        $oldData = (array) $approval;
        $actorId = (string) ($request->user()?->id ?? '');
        $reviewNote = trim((string) $request->input('note', ''));

        DB::table('approval_requests')
            ->where('id', $approval->id)
            ->update([
                'status' => 'rejected',
                'rejected_by' => $actorId !== '' ? $actorId : null,
                'rejected_at' => now(),
                'review_note' => $reviewNote !== '' ? $reviewNote : null,
                'updated_at' => now(),
            ]);

        $newData = DB::table('approval_requests')->where('id', $approval->id)->first();
        $this->logAudit(
            $request,
            'approval_requests',
            (string) $approval->id,
            'UPDATE',
            $oldData,
            $newData,
            (string) $approval->tenant_id
        );

        return response()->json([
            'data' => [
                'id' => $approval->id,
                'status' => 'rejected',
            ],
        ]);
    }

    private function findApprovalByScope(Request $request, string $id): ?object
    {
        $query = DB::table('approval_requests')->where('id', $id);

        if (! $this->isSuperAdmin($request)) {
            $tenantId = $this->resolveOwnedTenantId($request);
            if (! $tenantId) {
                return null;
            }
            $query->where('tenant_id', $tenantId);
        } else {
            $tenantFilter = trim((string) $request->query('tenant_id', ''));
            if ($tenantFilter !== '') {
                $query->where('tenant_id', $tenantFilter);
            }
        }

        return $query->first() ?: null;
    }

    private function requiresSecondApprover(string $tenantId): bool
    {
        try {
            if (! Schema::hasTable('settings')) {
                return true;
            }
            if (! Schema::hasColumn('settings', 'approval_require_second_approver')) {
                return true;
            }
            $settings = DB::table('settings')
                ->where('tenant_id', $tenantId)
                ->orderBy('id')
                ->first(['approval_require_second_approver']);

            if (! $settings) {
                return true;
            }

            return (bool) ($settings->approval_require_second_approver ?? true);
        } catch (\Throwable $e) {
            return true;
        }
    }

    private function decodeJsonValue($value)
    {
        if (is_array($value)) {
            return $value;
        }
        if (is_object($value)) {
            return (array) $value;
        }
        if (! is_string($value) || trim($value) === '') {
            return null;
        }

        try {
            return json_decode($value, true, 512, JSON_THROW_ON_ERROR);
        } catch (\Throwable $e) {
            return null;
        }
    }
}
