<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V2\StoreStudentRequest;
use App\Http\Requests\Api\V2\StudentIndexRequest;
use App\Http\Requests\Api\V2\UpdateStudentRequest;
use App\Http\Resources\Api\V2\StudentResource;
use App\Models\Profile;
use App\Services\AcademicAccessService;
use App\Services\Actions\Student\ActivateStudent;
use App\Services\Actions\Student\CreateStudent;
use App\Services\Actions\Student\DeactivateStudent;
use App\Services\Actions\Student\UpdateStudent as UpdateStudentAction;
use App\Services\IdempotencyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

class StudentController extends Controller
{
    public function __construct(
        private readonly IdempotencyService $idempotencyService,
        private readonly AcademicAccessService $academicAccess
    ) {}

    private function getRequestId(Request $request): string
    {
        return $request->header('X-Request-ID', (string) Str::uuid());
    }

    public function index(StudentIndexRequest $request): AnonymousResourceCollection|JsonResponse
    {
        Gate::authorize('viewAny', Profile::class);
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $limit = (int) $request->query('per_page', 25);
        $limit = min($limit, 500);

        $sort = $request->query('sort', 'nama');
        $order = $request->query('order', 'asc');

        if (! in_array(strtolower($order), ['asc', 'desc'])) {
            $order = 'asc';
        }

        $query = Profile::where('tenant_id', $tenantId)->where('role', 'siswa');

        $actor = $request->user()?->profile;
        if ($actor?->role === 'guru') {
            $classIds = $this->academicAccess->teacherClassIds($actor);
            $classIds->isEmpty()
                ? $query->whereRaw('1 = 0')
                : $query->whereIn('kelas', $classIds);
        }

        if ($request->filled('q')) {
            $query->where('nama', 'like', '%'.$request->query('q').'%');
        }
        if ($request->filled('search')) {
            $search = $request->query('search');
            $query->where(function ($q) use ($search) {
                $q->where('nama', 'like', "%{$search}%")
                    ->orWhere('nis', 'like', "%{$search}%");
            });
        }
        if ($request->filled('nis')) {
            $query->where('nis', 'like', '%'.$request->query('nis').'%');
        }
        if ($request->filled('kelas')) {
            $query->where('kelas', $request->query('kelas'));
        }
        if ($request->filled('status')) {
            $query->where('status', $request->query('status'));
        }
        if ($request->filled('tahun_ajaran')) {
            $query->where('angkatan', $request->query('tahun_ajaran'));
        }
        if ($request->filled('has_rfid')) {
            $hasRfid = filter_var($request->query('has_rfid'), FILTER_VALIDATE_BOOLEAN);
            if ($hasRfid) {
                $query->whereNotNull('rfid_uid')->where('rfid_uid', '!=', '');
            } else {
                $query->where(function ($q) {
                    $q->whereNull('rfid_uid')->orWhere('rfid_uid', '');
                });
            }
        }

        $students = $query->orderBy($sort, $order)->paginate($limit)->appends($request->query());

        // Dummy stats for backward compatibility if include_stats is true
        $stats = null;
        if (filter_var($request->query('include_stats'), FILTER_VALIDATE_BOOLEAN)) {
            $allQuery = Profile::where('tenant_id', $tenantId)->where('role', 'siswa');
            $totalSiswa = (clone $allQuery)->count();
            $aktifSiswa = (clone $allQuery)->where('status', 'active')->count();
            $stats = [
                'totalSiswa' => $totalSiswa,
                'aktifSiswa' => $aktifSiswa,
                'nonaktifSiswa' => $totalSiswa - $aktifSiswa,
                'mutasiSiswa' => (clone $allQuery)->where('status', 'mutasi')->count(),
                'alumniSiswa' => (clone $allQuery)->where('status', 'alumni')->count(),
                'ketuaKelas' => 0,
            ];
        }

        $includeContext = filter_var($request->query('include_context'), FILTER_VALIDATE_BOOLEAN);
        $context = [];
        if ($includeContext) {
            $classQuery = DB::table('kelas')
                ->where('tenant_id', $tenantId)
                ->orderBy('id');
            if ($actor?->role === 'guru') {
                $classQuery->whereIn('id', $this->academicAccess->teacherClassIds($actor));
            }
            $context['kelas'] = $classQuery->get()
                ->map(fn ($row) => (array) $row)
                ->values();

            $context['struktur'] = DB::table('kelas_struktur')
                ->whereIn('kelas_id', collect($context['kelas'])->pluck('id'))
                ->get()
                ->map(fn ($row) => (array) $row)
                ->values();

            $context['wali_kelas_ids'] = [];
            if ($actor?->role === 'guru') {
                $context['wali_kelas_ids'] = collect($context['struktur'])
                    ->where('wali_guru_id', $actor->id)
                    ->pluck('kelas_id')
                    ->values()
                    ->toArray();
            }
        }

        $response = StudentResource::collection($students)->additional(array_merge([
            'success' => true,
            'message' => 'Data siswa berhasil dimuat.',
            'request_id' => $reqId,
        ], $context));

        if ($stats) {
            $response->additional(['stats' => $stats]);
        }

        return $response;
    }

    public function store(StoreStudentRequest $request, CreateStudent $action): JsonResponse
    {
        Gate::authorize('create', Profile::class);
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $validated = $request->validated();
        $idempotencyKey = $validated['idempotency_key'] ?? null;

        return $this->idempotencyService->handle($request, $idempotencyKey, function () use ($action, $validated, $tenantId, $reqId) {
            $profile = $action->execute($validated, $tenantId);

            return (new StudentResource($profile))->additional([
                'success' => true,
                'message' => 'Siswa berhasil dibuat.',
                'request_id' => $reqId,
            ])->response()->setStatusCode(201);
        });
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $profile = Profile::where('tenant_id', $tenantId)->where('role', 'siswa')->find($id);

        if (! $profile) {
            return response()->json([
                'success' => false,
                'code' => 'STUDENT_NOT_FOUND',
                'message' => 'Siswa tidak ditemukan.',
                'error' => 'Siswa tidak ditemukan.',
                'request_id' => $reqId,
            ], 404);
        }

        Gate::authorize('view', $profile);

        $includeContext = filter_var($request->query('include_context'), FILTER_VALIDATE_BOOLEAN);
        $context = [];
        if ($includeContext) {
            $context['org_member'] = DB::table('organisasi_anggota')
                ->join('organisasi', 'organisasi_anggota.organisasi_id', '=', 'organisasi.id')
                ->where('organisasi.tenant_id', $tenantId)
                ->where('organisasi_anggota.siswa_id', $profile->id)
                ->select(
                    'organisasi_anggota.organisasi_id as orgId',
                    'organisasi.nama as orgName',
                    'organisasi_anggota.jabatan',
                    'organisasi_anggota.tahun_ajaran',
                    'organisasi.jenis'
                )
                ->get()
                ->map(fn ($row) => (array) $row)
                ->values();

            $context['osis'] = DB::table('osis_anggota')
                ->join('osis_periode', 'osis_anggota.periode_id', '=', 'osis_periode.id')
                ->where('osis_periode.tenant_id', $tenantId)
                ->where('osis_anggota.siswa_id', $profile->id)
                ->select(
                    'osis_anggota.id',
                    'osis_anggota.periode_id',
                    'osis_anggota.jabatan',
                    'osis_anggota.divisi',
                    'osis_periode.tahun_ajaran',
                    'osis_periode.status as periode_status'
                )
                ->orderByDesc('osis_periode.tahun_ajaran')
                ->first();

            if ($context['osis']) {
                $context['osis'] = (array) $context['osis'];
            }
        }

        return (new StudentResource($profile))->additional(array_merge([
            'success' => true,
            'message' => 'Data siswa berhasil dimuat.',
            'request_id' => $reqId,
        ], $context))->response()->setStatusCode(200);
    }

    public function update(UpdateStudentRequest $request, string $id, UpdateStudentAction $action): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $profile = Profile::where('tenant_id', $tenantId)->where('role', 'siswa')->find($id);

        if (! $profile) {
            return response()->json([
                'success' => false,
                'code' => 'STUDENT_NOT_FOUND',
                'message' => 'Siswa tidak ditemukan.',
                'error' => 'Siswa tidak ditemukan.',
                'request_id' => $reqId,
            ], 404);
        }

        Gate::authorize('update', $profile);

        $validated = $request->validated();
        $idempotencyKey = $validated['idempotency_key'] ?? null;

        return $this->idempotencyService->handle($request, $idempotencyKey, function () use ($action, $profile, $validated, $reqId) {
            $updatedProfile = $action->execute($profile, $validated);

            return (new StudentResource($updatedProfile))->additional([
                'success' => true,
                'message' => 'Siswa berhasil diupdate.',
                'request_id' => $reqId,
            ])->response()->setStatusCode(200);
        });
    }

    public function deactivate(Request $request, string $id, DeactivateStudent $action): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $profile = Profile::where('tenant_id', $tenantId)->where('role', 'siswa')->find($id);

        if (! $profile) {
            return response()->json([
                'success' => false,
                'code' => 'STUDENT_NOT_FOUND',
                'message' => 'Siswa tidak ditemukan.',
                'error' => 'Siswa tidak ditemukan.',
                'request_id' => $reqId,
            ], 404);
        }

        Gate::authorize('deactivate', $profile);

        $validated = $request->validate([
            'reason' => 'nullable|string|in:nonaktif,mutasi,alumni',
            'idempotency_key' => 'nullable|string|max:64',
        ]);

        $reason = $validated['reason'] ?? 'nonaktif';
        $idempotencyKey = $validated['idempotency_key'] ?? null;

        return $this->idempotencyService->handle($request, $idempotencyKey, function () use ($action, $profile, $reason, $reqId) {
            $action->execute($profile, $reason);

            return response()->json([
                'success' => true,
                'message' => 'Siswa berhasil dinonaktifkan.',
                'request_id' => $reqId,
            ], 200);
        });
    }

    public function activate(Request $request, string $id, ActivateStudent $action): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $profile = Profile::where('tenant_id', $tenantId)->where('role', 'siswa')->find($id);

        if (! $profile) {
            return response()->json([
                'success' => false,
                'code' => 'STUDENT_NOT_FOUND',
                'message' => 'Siswa tidak ditemukan.',
                'error' => 'Siswa tidak ditemukan.',
                'request_id' => $reqId,
            ], 404);
        }

        Gate::authorize('activate', $profile);

        $idempotencyKey = $request->input('idempotency_key');

        return $this->idempotencyService->handle($request, $idempotencyKey, function () use ($action, $profile, $reqId) {
            $action->execute($profile);

            return response()->json([
                'success' => true,
                'message' => 'Siswa berhasil diaktifkan.',
                'request_id' => $reqId,
            ], 200);
        });
    }

    public function options(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', Profile::class);
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $search = $request->query('q', '');
        $kelas = $request->query('kelas', '');
        $status = $request->query('status', 'active');
        $perPage = min(max(1, (int) $request->query('per_page', 50)), 200);

        $query = Profile::where('tenant_id', $tenantId)->where('role', 'siswa');
        if ($status) {
            $query->where('status', $status);
        }
        if ($kelas) {
            $query->where('kelas', $kelas);
        }
        if ($search) {
            $query->where(function ($q) use ($search) {
                $q->where('nama', 'ilike', "%{$search}%")
                    ->orWhere('nis', 'ilike', "%{$search}%");
            });
        }

        $rows = $query->select(['id', 'nama', 'nis', 'kelas', 'status', 'jk'])
            ->orderBy('nama')
            ->paginate($perPage)
            ->appends($request->query());

        return response()->json([
            'success' => true,
            'message' => 'Opsi siswa berhasil dimuat.',
            'data' => $rows->items(),
            'meta' => [
                'current_page' => $rows->currentPage(),
                'last_page' => $rows->lastPage(),
                'total' => $rows->total(),
            ],
            'request_id' => $reqId,
        ]);
    }
}
