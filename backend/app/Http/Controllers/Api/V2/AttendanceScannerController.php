<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V2\BulkStoreAttendanceRequest;
use App\Http\Requests\Api\V2\StoreTempScanRequest;
use App\Models\Absensi;
use App\Models\Profile;
use App\Services\Actions\Attendance\BulkCreateAttendance;
use App\Services\IdempotencyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

class AttendanceScannerController extends Controller
{
    public function __construct(
        private readonly IdempotencyService $idempotencyService,
        private readonly BulkCreateAttendance $bulkCreateAttendance
    ) {}

    public function bulkStore(BulkStoreAttendanceRequest $request): JsonResponse
    {
        Gate::authorize('create', Absensi::class);
        $tenantId = (string) $request->attributes->get('tenant_id');
        $actor = $request->user()->profile;
        $validated = $request->validated();
        
        $records = $validated['records'];
        $idempotencyKey = $validated['idempotency_key'];

        return $this->idempotencyService->handle(
            $request,
            $idempotencyKey,
            function () use ($request, $records, $actor, $tenantId) {
                // Ensure all students belong to the tenant
                $uids = array_unique(array_column($records, 'uid'));
                $validStudentCount = Profile::whereIn('id', $uids)
                    ->where('tenant_id', $tenantId)
                    ->where('role', 'siswa')
                    ->count();

                if ($validStudentCount !== count($uids)) {
                    return $this->error($request, 'ATTENDANCE_STUDENT_NOT_FOUND', 'Beberapa siswa tidak ditemukan atau tidak berada di tenant ini.', 422);
                }

                $inserted = $this->bulkCreateAttendance->execute($records, $actor, $tenantId);

                return response()->json([
                    'success' => true,
                    'message' => count($inserted) . ' data presensi berhasil disimpan.',
                    'data' => $inserted,
                    'request_id' => $this->requestId($request),
                ], 201);
            }
        );
    }

    public function storeTemp(StoreTempScanRequest $request): JsonResponse
    {
        Gate::authorize('create', Absensi::class); // Reusing the same gate for creating attendance
        
        $tenantId = (string) $request->attributes->get('tenant_id');
        $validated = $request->validated();
        
        // Ensure student belongs to tenant
        $studentExists = Profile::where('id', $validated['siswa_id'])
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa')
            ->exists();
            
        if (! $studentExists) {
            return $this->error($request, 'ATTENDANCE_STUDENT_NOT_FOUND', 'Siswa tidak ditemukan atau tidak berada di tenant ini.', 422);
        }

        // Generate a synthetic idempotency key if not provided (temp scans might not have it)
        $idempotencyKey = $validated['idempotency_key'] ?? 'scan_temp_' . $validated['siswa_id'] . '_' . $validated['tanggal'] . '_' . $validated['sesi'];

        return $this->idempotencyService->handle(
            $request,
            $idempotencyKey,
            function () use ($request, $validated, $tenantId) {
                // Insert or update scan temp
                // Since this is just a temporary table, we can just upsert it or insert and ignore duplicates
                $keyData = [
                    'tenant_id' => $tenantId,
                    'siswa_id' => $validated['siswa_id'],
                    'tanggal' => $validated['tanggal'],
                    'sesi' => $validated['sesi']
                ];
                
                $updateData = [
                    'kelas' => $validated['kelas'],
                    'scan_at' => Carbon::parse($validated['scan_at'])->format('Y-m-d H:i:sP'),
                    'source' => $validated['source'] ?? 'MANUAL_SCAN',
                    'card_uid' => $validated['card_uid'] ?? null,
                    'mapel_count' => $validated['mapel_count'] ?? 0,
                    'created_at' => now(),
                ];
                
                DB::table('absensi_scan_temp')->updateOrInsert($keyData, $updateData);

                return response()->json([
                    'success' => true,
                    'message' => 'Data scan sementara berhasil disimpan.',
                    'request_id' => $this->requestId($request),
                ], 201);
            }
        );
    }

    private function requestId(Request $request): string
    {
        return $request->header('X-Request-ID', (string) Str::uuid());
    }

    private function error(Request $request, string $code, string $message, int $status): JsonResponse
    {
        return response()->json([
            'success' => false,
            'code' => $code,
            'message' => $message,
            'request_id' => $this->requestId($request),
        ], $status);
    }
}
