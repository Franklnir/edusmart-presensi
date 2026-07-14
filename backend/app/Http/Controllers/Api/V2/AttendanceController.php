<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V2\StoreAttendanceRequest;
use App\Http\Requests\Api\V2\UpdateAttendanceRequest;
use App\Http\Resources\Api\V2\AttendanceResource;
use App\Models\Absensi;
use App\Models\Profile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use App\Services\IdempotencyService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Carbon\Carbon;

class AttendanceController extends Controller
{
    private IdempotencyService $idempotencyService;

    public function __construct(IdempotencyService $idempotencyService)
    {
        $this->idempotencyService = $idempotencyService;
    }

    private function getRequestId(Request $request): string
    {
        return $request->header('X-Request-ID', (string) Str::uuid());
    }

    public function index(Request $request): AnonymousResourceCollection|JsonResponse
    {
        Gate::authorize('viewAny', Absensi::class);
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $limit = (int) $request->query('per_page', 25);
        $limit = min($limit, 500);

        $query = Absensi::with('profile')->whereHas('profile', function ($q) use ($tenantId) {
            $q->where('tenant_id', $tenantId);
        });

        if ($request->filled('tanggal')) {
            $query->whereDate('tanggal', $request->query('tanggal'));
        }
        if ($request->filled('kelas')) {
            $query->where('kelas', $request->query('kelas'));
        }
        if ($request->filled('mapel')) {
            $query->where('mapel', $request->query('mapel'));
        }
        if ($request->filled('uid')) {
            $query->where('uid', $request->query('uid'));
        }
        if ($request->filled('tahun_ajaran')) {
            $query->where('tahun_ajaran', $request->query('tahun_ajaran'));
        }
        if ($request->filled('semester')) {
            $query->where('semester', $request->query('semester'));
        }
        
        $user = $request->user();
        if ($user && $user->profile && $user->profile->role === 'siswa') {
             $query->where('uid', $user->id);
        }

        $query->orderBy('tanggal', 'desc')->orderBy('waktu', 'desc');

        $attendances = $query->paginate($limit);

        return AttendanceResource::collection($attendances)->additional([
            'success' => true,
            'message' => 'Data presensi berhasil diambil.',
            'request_id' => $reqId,
        ]);
    }

    public function store(StoreAttendanceRequest $request): JsonResponse
    {
        Gate::authorize('create', Absensi::class);
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);
        
        $validated = $request->validated();
        $idempotencyKey = $validated['idempotency_key'];

        return $this->idempotencyService->handle($request, $idempotencyKey, function () use ($request, $validated, $reqId) {


        // Cek duplikasi absensi pada hari dan mapel yang sama
        $existing = Absensi::where('uid', $validated['uid'])
            ->whereDate('tanggal', $validated['tanggal'])
            ->where('kelas', $validated['kelas'])
            ->where('mapel', $validated['mapel'] ?? '')
            ->first();

        if ($existing) {
             return response()->json([
                'success' => false,
                'code' => 'ATTENDANCE_ALREADY_EXISTS',
                'message' => 'Siswa sudah memiliki presensi pada tanggal dan mapel ini.',
                'error' => 'Duplicate attendance record.',
                'request_id' => $reqId,
            ], 409);
        }

        $profile = Profile::find($validated['uid']);

        $attendance = new Absensi();
        $attendance->uid = $validated['uid'];
        $attendance->kelas = $validated['kelas'];
        $attendance->tanggal = $validated['tanggal'];
        $attendance->status = $validated['status'];
        $attendance->mapel = $validated['mapel'] ?? '';
        $attendance->tahun_ajaran = $validated['tahun_ajaran'] ?? null;
        $attendance->semester = $validated['semester'] ?? null;
        $attendance->nama = $profile->nama;
        $attendance->waktu = Carbon::now();
        $attendance->komentar = $validated['komentar'] ?? null;
        $attendance->oleh = $request->user()->name ?? 'System';
        $attendance->dikonfirmasi = $request->user()->id;
        $attendance->save();

        $attendance->load('profile');

        return (new AttendanceResource($attendance))->additional([
            'success' => true,
            'message' => 'Presensi berhasil dicatat.',
            'request_id' => $reqId,
        ])->response()->setStatusCode(201);
        });
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $attendance = Absensi::with('profile')->whereHas('profile', function ($q) use ($tenantId) {
            $q->where('tenant_id', $tenantId);
        })->find($id);

        if (! $attendance) {
            return response()->json([
                'success' => false,
                'code' => 'ATTENDANCE_NOT_FOUND',
                'message' => 'Data presensi tidak ditemukan.',
                'error' => 'Presensi tidak ditemukan.',
                'request_id' => $reqId,
            ], 404);
        }

        Gate::authorize('view', $attendance);

        return (new AttendanceResource($attendance))->additional([
            'success' => true,
            'message' => 'Data presensi berhasil diambil.',
            'request_id' => $reqId,
        ])->response()->setStatusCode(200);
    }

    public function update(UpdateAttendanceRequest $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $attendance = Absensi::whereHas('profile', function ($q) use ($tenantId) {
            $q->where('tenant_id', $tenantId);
        })->find($id);

        if (! $attendance) {
            return response()->json([
                'success' => false,
                'code' => 'ATTENDANCE_NOT_FOUND',
                'message' => 'Data presensi tidak ditemukan.',
                'error' => 'Presensi tidak ditemukan.',
                'request_id' => $reqId,
            ], 404);
        }

        Gate::authorize('update', $attendance);

        $validated = $request->validated();
        
        if (isset($validated['status'])) {
            $attendance->status = $validated['status'];
        }
        if (isset($validated['komentar'])) {
            $attendance->komentar = $validated['komentar'];
        }
        
        $attendance->oleh = $request->user()->name ?? 'System';
        $attendance->dikonfirmasi = $request->user()->id;
        $attendance->save();

        $attendance->load('profile');

        return (new AttendanceResource($attendance))->additional([
            'success' => true,
            'message' => 'Presensi berhasil diupdate.',
            'request_id' => $reqId,
        ])->response()->setStatusCode(200);
    }
}
