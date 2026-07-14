<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V2\StoreAttendanceAjuanRequest;
use App\Http\Requests\Api\V2\UpdateAttendanceAjuanRequest;
use App\Http\Resources\Api\V2\AttendanceRequestResource;
use App\Models\AbsensiAjuan;
use App\Services\AcademicAccessService;
use App\Services\Actions\Attendance\CreateAttendanceRequest;
use App\Services\Actions\Attendance\RespondAttendanceRequest;
use App\Services\IdempotencyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

class AttendanceRequestController extends Controller
{
    public function __construct(
        private readonly IdempotencyService $idempotencyService,
        private readonly AcademicAccessService $academicAccess,
        private readonly CreateAttendanceRequest $createRequest,
        private readonly RespondAttendanceRequest $respondRequest
    ) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', AbsensiAjuan::class);
        $tenantId = (string) $request->attributes->get('tenant_id');
        $actor = $request->user()->profile;
        $query = AbsensiAjuan::with('profile')->where('tenant_id', $tenantId);

        foreach (['tanggal', 'kelas', 'mapel', 'uid', 'tahun_ajaran', 'status_guru'] as $filter) {
            if ($request->filled($filter)) {
                $filter === 'tanggal'
                    ? $query->whereDate('tanggal', $request->query($filter))
                    : $query->where($filter, $request->query($filter));
            }
        }

        if ($actor->role === 'siswa') {
            $query->where('uid', $actor->id);
        } elseif ($actor->role === 'guru') {
            $classIds = $this->academicAccess->teacherClassIds($actor);
            $classIds->isEmpty()
                ? $query->whereRaw('1 = 0')
                : $query->whereIn('kelas', $classIds);
        }

        $requests = $query->orderByDesc('tanggal')
            ->orderByDesc('created_at')
            ->paginate(max(1, min((int) $request->query('per_page', 25), 500)))
            ->appends($request->query());

        return AttendanceRequestResource::collection($requests)->additional([
            'success' => true,
            'message' => 'Data pengajuan presensi berhasil diambil.',
            'request_id' => $this->requestId($request),
        ])->response();
    }

    public function store(StoreAttendanceAjuanRequest $request): JsonResponse
    {
        Gate::authorize('create', AbsensiAjuan::class);
        $student = $request->user()->profile;
        $tenantId = (string) $request->attributes->get('tenant_id');
        $validated = $request->validated();

        if (! $student->kelas) {
            return $this->error($request, 'STUDENT_CLASS_REQUIRED', 'Siswa belum memiliki kelas aktif.', 422);
        }
        if (isset($validated['kelas']) && (string) $validated['kelas'] !== (string) $student->kelas) {
            return $this->error($request, 'ATTENDANCE_CLASS_MISMATCH', 'Kelas pengajuan harus berasal dari profil siswa.', 422);
        }

        return $this->idempotencyService->handle(
            $request,
            $validated['idempotency_key'] ?? null,
            function () use ($request, $validated, $student, $tenantId) {
                try {
                    $attendanceRequest = $this->createRequest->execute($validated, $student, $tenantId);
                } catch (\LogicException $exception) {
                    if ($exception->getMessage() === 'ATTENDANCE_REQUEST_ALREADY_EXISTS') {
                        return $this->error($request, 'ATTENDANCE_REQUEST_ALREADY_EXISTS', 'Pengajuan pending untuk slot ini sudah ada.', 409);
                    }
                    throw $exception;
                }

                return (new AttendanceRequestResource($attendanceRequest))->additional([
                    'success' => true,
                    'message' => 'Pengajuan presensi berhasil dibuat.',
                    'request_id' => $this->requestId($request),
                ])->response()->setStatusCode(201);
            }
        );
    }

    public function update(UpdateAttendanceAjuanRequest $request, string $id): JsonResponse
    {
        $tenantId = (string) $request->attributes->get('tenant_id');
        $attendanceRequest = AbsensiAjuan::with('profile')->where('tenant_id', $tenantId)->find($id);
        if (! $attendanceRequest) {
            return $this->error($request, 'ATTENDANCE_REQUEST_NOT_FOUND', 'Pengajuan presensi tidak ditemukan.', 404);
        }

        Gate::authorize('update', $attendanceRequest);

        $validated = $request->validated();

        return $this->idempotencyService->handle(
            $request,
            $validated['idempotency_key'] ?? null,
            function () use ($request, $attendanceRequest, $validated, $tenantId) {
                try {
                    $updated = $this->respondRequest->execute(
                        $attendanceRequest,
                        $validated['action'],
                        $request->user()->profile,
                        $tenantId
                    );
                } catch (\LogicException $exception) {
                    if ($exception->getMessage() === 'ATTENDANCE_REQUEST_ALREADY_PROCESSED') {
                        return $this->error($request, 'ATTENDANCE_REQUEST_ALREADY_PROCESSED', 'Pengajuan ini sudah memiliki keputusan final.', 409);
                    }
                    throw $exception;
                }

                return (new AttendanceRequestResource($updated))->additional([
                    'success' => true,
                    'message' => 'Pengajuan presensi berhasil diproses.',
                    'request_id' => $this->requestId($request),
                ])->response();
            }
        );
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $tenantId = (string) $request->attributes->get('tenant_id');

        return $this->idempotencyService->handle($request, null, function () use ($request, $id, $tenantId) {
            $attendanceRequest = AbsensiAjuan::with('profile')->where('tenant_id', $tenantId)->find($id);
            if (! $attendanceRequest) {
                return $this->error($request, 'ATTENDANCE_REQUEST_NOT_FOUND', 'Pengajuan presensi tidak ditemukan.', 404);
            }

            Gate::authorize('delete', $attendanceRequest);

            try {
                DB::transaction(function () use ($attendanceRequest, $request, $tenantId) {
                    $locked = AbsensiAjuan::whereKey($attendanceRequest->id)
                        ->where('tenant_id', $tenantId)
                        ->lockForUpdate()
                        ->firstOrFail();
                    if ($locked->status_guru !== 'pending') {
                        throw new \LogicException('ATTENDANCE_REQUEST_ALREADY_PROCESSED');
                    }

                    DB::table('audit_log')->insert([
                        'tenant_id' => $tenantId,
                        'table_name' => 'absensi_ajuan',
                        'record_id' => $locked->id,
                        'action' => 'DELETE',
                        'old_data' => json_encode($locked->only(['uid', 'kelas', 'tanggal', 'mapel', 'status_guru'])),
                        'new_data' => null,
                        'user_id' => $request->user()->id,
                        'user_role' => $request->user()->profile->role,
                        'timestamp' => now(),
                    ]);
                    $locked->delete();
                });
            } catch (\LogicException $exception) {
                return $this->error($request, $exception->getMessage(), 'Pengajuan ini sudah memiliki keputusan final.', 409);
            }

            return response()->json([
                'success' => true,
                'message' => 'Pengajuan presensi pending berhasil dihapus.',
                'request_id' => $this->requestId($request),
            ]);
        });
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
