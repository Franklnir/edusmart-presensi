<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V2\StoreClassRequest;
use App\Http\Requests\Api\V2\UpdateClassRequest;
use App\Http\Resources\Api\V2\ClassResource;
use App\Models\Kelas;
use App\Services\Admin\AdminPageCacheService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

class ClassController extends Controller
{
    public function __construct(
        private readonly AdminPageCacheService $pageCache
    ) {}

    private function getRequestId(Request $request): string
    {
        return $request->header('X-Request-ID', (string) Str::uuid());
    }

    /**
     * Display a listing of the resource.
     */
    public function index(Request $request): AnonymousResourceCollection|JsonResponse
    {
        Gate::authorize('viewAny', Kelas::class);
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $limit = (int) $request->query('per_page', 20);
        $limit = min($limit, 100);

        $sort = $request->query('sort', 'grade');
        $order = $request->query('order', 'asc');

        $allowlist = ['nama', 'grade', 'tahun_ajaran', 'semester', 'created_at', 'updated_at'];
        if (! in_array($sort, $allowlist)) {
            $sort = 'grade';
        }
        if (! in_array(strtolower($order), ['asc', 'desc'])) {
            $order = 'asc';
        }

        $classes = Kelas::where('tenant_id', $tenantId)
            ->orderBy($sort, $order)
            ->paginate($limit)
            ->appends($request->query());

        return ClassResource::collection($classes)->additional([
            'success' => true,
            'message' => 'Data kelas berhasil dimuat.',
            'request_id' => $reqId,
        ]);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(StoreClassRequest $request): JsonResponse
    {
        Gate::authorize('create', Kelas::class);
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $validated = $request->validated();
        $validated['tenant_id'] = $tenantId;
        $validated['id'] = (string) Str::uuid();

        $kelas = Kelas::create($validated);

        return (new ClassResource($kelas))->additional([
            'success' => true,
            'message' => 'Kelas berhasil dibuat.',
            'request_id' => $reqId,
        ])->response()->setStatusCode(201);
    }

    /**
     * Display the specified resource.
     */
    public function show(Request $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $kelas = Kelas::where('tenant_id', $tenantId)->find($id);

        if (! $kelas) {
            return response()->json([
                'success' => false,
                'code' => 'CLASS_NOT_FOUND',
                'message' => 'Kelas tidak ditemukan.',
                'error' => 'Kelas tidak ditemukan.',
                'request_id' => $reqId,
            ], 404);
        }

        Gate::authorize('view', $kelas);

        return (new ClassResource($kelas))->additional([
            'success' => true,
            'message' => 'Data kelas berhasil dimuat.',
            'request_id' => $reqId,
        ])->response()->setStatusCode(200);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(UpdateClassRequest $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $kelas = Kelas::where('tenant_id', $tenantId)->find($id);

        if (! $kelas) {
            return response()->json([
                'success' => false,
                'code' => 'CLASS_NOT_FOUND',
                'message' => 'Kelas tidak ditemukan.',
                'error' => 'Kelas tidak ditemukan.',
                'request_id' => $reqId,
            ], 404);
        }

        Gate::authorize('update', $kelas);

        $kelas->update($request->validated());

        return (new ClassResource($kelas))->additional([
            'success' => true,
            'message' => 'Kelas berhasil diupdate.',
            'request_id' => $reqId,
        ])->response()->setStatusCode(200);
    }

    public function updateStructure(Request $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $kelas = Kelas::where('tenant_id', $tenantId)->find($id);

        if (! $kelas) {
            return response()->json([
                'success' => false,
                'code' => 'CLASS_NOT_FOUND',
                'message' => 'Kelas tidak ditemukan.',
                'error' => 'Kelas tidak ditemukan.',
                'request_id' => $reqId,
            ], 404);
        }

        Gate::authorize('update', $kelas);

        $request->validate([
            'wali_guru_id' => 'nullable|string',
            'wali_guru_nama' => 'nullable|string',
            'ketua_siswa_id' => 'nullable|string',
            'ketua_siswa_nama' => 'nullable|string',
        ]);

        $existing = DB::table('kelas_struktur')->where('kelas_id', $id)->first();

        if ($existing) {
            DB::table('kelas_struktur')->where('kelas_id', $id)->update([
                'wali_guru_id' => $request->input('wali_guru_id'),
                'wali_guru_nama' => $request->input('wali_guru_nama'),
                'ketua_siswa_id' => $request->input('ketua_siswa_id'),
                'ketua_siswa_nama' => $request->input('ketua_siswa_nama'),
                'updated_at' => now(),
            ]);
        } else {
            DB::table('kelas_struktur')->insert([
                'kelas_id' => $id,
                'wali_guru_id' => $request->input('wali_guru_id'),
                'wali_guru_nama' => $request->input('wali_guru_nama'),
                'ketua_siswa_id' => $request->input('ketua_siswa_id'),
                'ketua_siswa_nama' => $request->input('ketua_siswa_nama'),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        return response()->json([
            'success' => true,
            'message' => 'Struktur kelas berhasil diupdate.',
            'request_id' => $reqId,
        ], 200);
    }

    public function getStructure(Request $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $kelas = Kelas::where('tenant_id', $tenantId)->find($id);

        if (! $kelas) {
            return response()->json([
                'success' => false,
                'code' => 'CLASS_NOT_FOUND',
                'message' => 'Kelas tidak ditemukan.',
                'error' => 'Kelas tidak ditemukan.',
                'request_id' => $reqId,
            ], 404);
        }

        Gate::authorize('view', $kelas);

        $struktur = DB::table('kelas_struktur')->where('kelas_id', $id)->first();

        return response()->json([
            'success' => true,
            'data' => $struktur,
            'request_id' => $reqId,
        ], 200);
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $kelas = Kelas::where('tenant_id', $tenantId)->find($id);

        if (! $kelas) {
            return response()->json([
                'success' => false,
                'code' => 'CLASS_NOT_FOUND',
                'message' => 'Kelas tidak ditemukan.',
                'error' => 'Kelas tidak ditemukan.',
                'request_id' => $reqId,
            ], 404);
        }

        Gate::authorize('delete', $kelas);

        // Periksa relasi aktif sebelum menghapus
        $hasSiswa = DB::table('profiles')
            ->where('kelas', $kelas->id)
            ->exists();

        $hasWali = DB::table('kelas_struktur')
            ->where('kelas_id', $kelas->id)
            ->exists();

        $hasJadwal = DB::table('jadwal')
            ->where('kelas_id', $kelas->id)
            ->exists();

        $hasTugas = DB::table('tugas')
            ->where('kelas', $kelas->id)
            ->exists();

        $hasAbsensi = DB::table('absensi')
            ->where('kelas', $kelas->id)
            ->exists();

        if ($hasSiswa || $hasWali || $hasJadwal || $hasTugas || $hasAbsensi) {
            return response()->json([
                'success' => false,
                'code' => 'CLASS_NOT_EMPTY',
                'message' => 'Kelas masih memiliki data terkait (siswa, jadwal, dll) dan tidak dapat dihapus.',
                'error' => 'Kelas masih memiliki data terkait (siswa, jadwal, dll) dan tidak dapat dihapus.',
                'request_id' => $reqId,
            ], 409);
        }

        $kelas->delete();

        return response()->json([
            'success' => true,
            'message' => 'Kelas berhasil dihapus.',
            'request_id' => $reqId,
        ], 200);
    }

    public function organisasiBootstrap(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', Kelas::class);
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        return response()->json([
            'success' => true,
            'data' => $this->pageCache->organizationBootstrap((string) $tenantId, [
                'tahun_ajaran' => $request->query('tahun_ajaran', ''),
            ]),
            'request_id' => $reqId,
        ]);
    }

    public function strukturBootstrap(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', Kelas::class);
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        return response()->json([
            'success' => true,
            'data' => $this->pageCache->structureBootstrap((string) $tenantId, [
                'tahun_ajaran' => $request->query('tahun_ajaran', ''),
            ]),
            'request_id' => $reqId,
        ]);
    }

    public function academicSummary(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', Kelas::class);
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $includeStudents = filter_var($request->query('include_students', true), FILTER_VALIDATE_BOOLEAN);
        $includeSchedule = filter_var($request->query('include_schedule', false), FILTER_VALIDATE_BOOLEAN);
        $includeMapel = filter_var($request->query('include_mapel', false), FILTER_VALIDATE_BOOLEAN);

        if (! $includeStudents && ! $includeSchedule && ! $includeMapel) {
            return response()->json([
                'success' => true,
                'data' => $this->pageCache->structureBootstrap((string) $tenantId, [
                    'tahun_ajaran' => $request->query('tahun_ajaran', ''),
                ]),
                'request_id' => $reqId,
            ]);
        }

        return response()->json([
            'success' => true,
            'data' => $this->pageCache->academicBootstrap((string) $tenantId, [
                'tahun_ajaran' => $request->query('tahun_ajaran', ''),
                'class_id' => $request->query('class_id', ''),
                'include_students' => $includeStudents,
                'include_schedule' => $includeSchedule,
                'include_mapel' => $includeMapel,
            ]),
            'request_id' => $reqId,
        ]);
    }
}
