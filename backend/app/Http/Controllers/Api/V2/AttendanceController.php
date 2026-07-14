<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V2\StoreAttendanceRequest;
use App\Http\Requests\Api\V2\UpdateAttendanceRequest;
use App\Http\Resources\Api\V2\AttendanceResource;
use App\Models\Absensi;
use App\Models\Profile;
use App\Services\AcademicAccessService;
use App\Services\Actions\Attendance\CreateAttendance;
use App\Services\Actions\Attendance\UpdateAttendance;
use App\Services\IdempotencyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

class AttendanceController extends Controller
{
    public function __construct(
        private readonly IdempotencyService $idempotencyService,
        private readonly AcademicAccessService $academicAccess,
        private readonly CreateAttendance $createAttendance,
        private readonly UpdateAttendance $updateAttendance
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        Gate::authorize('viewAny', Absensi::class);
        $tenantId = (string) $request->attributes->get('tenant_id');
        $actor = $request->user()->profile;

        $query = Absensi::with('profile')->where('tenant_id', $tenantId);
        foreach (['tanggal', 'kelas', 'mapel', 'uid', 'tahun_ajaran', 'semester'] as $filter) {
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

        $attendances = $query
            ->orderByDesc('tanggal')
            ->orderByDesc('waktu')
            ->paginate(max(1, min((int) $request->query('per_page', 25), 500)))
            ->appends($request->query());

        return AttendanceResource::collection($attendances)->additional([
            'success' => true,
            'message' => 'Data presensi berhasil diambil.',
            'request_id' => $this->requestId($request),
        ]);
    }

    public function store(StoreAttendanceRequest $request): JsonResponse
    {
        Gate::authorize('create', Absensi::class);
        $tenantId = (string) $request->attributes->get('tenant_id');
        $actor = $request->user()->profile;
        $validated = $request->validated();
        $student = Profile::whereKey($validated['uid'])
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa')
            ->firstOrFail();

        if ((string) $student->kelas !== (string) $validated['kelas']) {
            return $this->error($request, 'ATTENDANCE_CLASS_MISMATCH', 'Kelas siswa tidak sesuai dengan payload.', 422);
        }
        if (! $this->academicAccess->canManageClass($actor, $validated['kelas'], $validated['mapel'] ?? '')) {
            return $this->error($request, 'ATTENDANCE_SCOPE_FORBIDDEN', 'Anda tidak berwenang mengelola presensi kelas/mapel ini.', 403);
        }

        return $this->idempotencyService->handle(
            $request,
            $validated['idempotency_key'] ?? null,
            function () use ($request, $validated, $actor, $tenantId) {
                try {
                    $attendance = $this->createAttendance->execute($validated, $actor, $tenantId);
                } catch (\LogicException $exception) {
                    if ($exception->getMessage() === 'ATTENDANCE_ALREADY_EXISTS') {
                        return $this->error($request, 'ATTENDANCE_ALREADY_EXISTS', 'Siswa sudah memiliki presensi untuk slot ini.', 409);
                    }
                    throw $exception;
                }

                return (new AttendanceResource($attendance))->additional([
                    'success' => true,
                    'message' => 'Presensi berhasil dicatat.',
                    'request_id' => $this->requestId($request),
                ])->response()->setStatusCode(201);
            }
        );
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $attendance = Absensi::with('profile')
            ->where('tenant_id', $request->attributes->get('tenant_id'))
            ->find($id);
        if (! $attendance) {
            return $this->error($request, 'ATTENDANCE_NOT_FOUND', 'Data presensi tidak ditemukan.', 404);
        }

        Gate::authorize('view', $attendance);

        return (new AttendanceResource($attendance))->additional([
            'success' => true,
            'message' => 'Data presensi berhasil diambil.',
            'request_id' => $this->requestId($request),
        ])->response();
    }

    public function update(UpdateAttendanceRequest $request, string $id): JsonResponse
    {
        $tenantId = (string) $request->attributes->get('tenant_id');
        $attendance = Absensi::with('profile')->where('tenant_id', $tenantId)->find($id);
        if (! $attendance) {
            return $this->error($request, 'ATTENDANCE_NOT_FOUND', 'Data presensi tidak ditemukan.', 404);
        }

        Gate::authorize('update', $attendance);
        $validated = $request->validated();
        $actor = $request->user()->profile;

        return $this->idempotencyService->handle(
            $request,
            $validated['idempotency_key'] ?? null,
            function () use ($request, $attendance, $validated, $actor, $tenantId) {
                $updated = $this->updateAttendance->execute($attendance, $validated, $actor, $tenantId);

                return (new AttendanceResource($updated))->additional([
                    'success' => true,
                    'message' => 'Presensi berhasil diperbarui.',
                    'request_id' => $this->requestId($request),
                ])->response();
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
