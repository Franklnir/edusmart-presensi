<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V2\StoreTeacherRequest;
use App\Http\Requests\Api\V2\UpdateTeacherRequest;
use App\Http\Resources\Api\V2\TeacherResource;
use App\Models\Profile;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class TeacherController extends Controller
{
    private function getRequestId(Request $request): string
    {
        return $request->header('X-Request-ID', (string) Str::uuid());
    }

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', Profile::class);
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $limit = max(1, (int) $request->query('per_page', 25));
        $sort = $request->query('sort', 'nama');
        $order = $request->query('order', 'asc');

        $query = Profile::where('tenant_id', $tenantId)->where('role', 'guru');

        if ($request->filled('q')) {
            $q = strtolower($request->query('q'));
            $query->whereRaw('LOWER(nama) LIKE ?', ["%{$q}%"]);
        }

        if ($request->filled('status')) {
            $query->where('status', $request->query('status'));
        }

        $teachers = $query->orderBy($sort, $order)->paginate($limit)->appends($request->query());
        $teacherIds = collect($teachers->items())->pluck('id')->all();

        $activeYear = '';
        if (Schema::hasTable('academic_periods')) {
            $activeYear = DB::table('academic_periods')->where('tenant_id', $tenantId)->where('is_active', true)->value('tahun_ajaran') ?? '';
        }

        $jadwalRows = empty($teacherIds) || ! Schema::hasTable('jadwal') ? collect() : DB::table('jadwal')
            ->where('tenant_id', $tenantId)
            ->whereIn('guru_id', $teacherIds)
            ->when($activeYear !== '' && Schema::hasColumn('jadwal', 'tahun_ajaran'), fn ($q) => $q->where('tahun_ajaran', $activeYear))
            ->get();

        $waliRows = empty($teacherIds) || ! Schema::hasTable('kelas_struktur') ? collect() : DB::table('kelas_struktur')
            ->join('kelas', 'kelas_struktur.kelas_id', '=', 'kelas.id')
            ->where('kelas.tenant_id', $tenantId)
            ->whereIn('kelas_struktur.wali_guru_id', $teacherIds)
            ->when($activeYear !== '' && Schema::hasColumn('kelas_struktur', 'tahun_ajaran'), fn ($q) => $q->where('kelas_struktur.tahun_ajaran', $activeYear))
            ->select('kelas_struktur.kelas_id', 'kelas_struktur.wali_guru_id')
            ->get();

        $strukturRows = empty($teacherIds) || ! Schema::hasTable('struktur_sekolah') ? collect() : DB::table('struktur_sekolah')
            ->where('tenant_id', $tenantId)
            ->whereIn('guru_id', $teacherIds)
            ->when($activeYear !== '' && Schema::hasColumn('struktur_sekolah', 'tahun_ajaran'), fn ($q) => $q->where('tahun_ajaran', $activeYear))
            ->get();

        $jadwalByTeacher = $jadwalRows->groupBy('guru_id');
        $waliByTeacher = $waliRows->groupBy('wali_guru_id');
        $strukturByTeacher = $strukturRows->groupBy('guru_id');
        $allMapel = [];
        $allJabatan = [];

        foreach ($teachers->items() as $teacher) {
            $teacherId = $teacher->id;
            $mapel = $jadwalByTeacher->get($teacherId, collect())->pluck('mapel')->filter()->unique()->values()->all();
            $kelas = $jadwalByTeacher->get($teacherId, collect())->pluck('kelas_id')
                ->merge($waliByTeacher->get($teacherId, collect())->pluck('kelas_id'))
                ->filter()->unique()->values()->all();

            $jabatan = [];
            if (! empty($teacher->jabatan)) {
                $jabatan[] = $teacher->jabatan;
            }
            $jabatan = collect($jabatan)
                ->merge($strukturByTeacher->get($teacherId, collect())->pluck('jabatan'))
                ->filter()->unique()->values()->all();

            $allMapel = array_merge($allMapel, $mapel);
            $allJabatan = array_merge($allJabatan, $jabatan);

            $teacher->mapelList = $mapel;
            $teacher->kelasList = $kelas;
            $teacher->jabatanList = $jabatan;
            $teacher->jabatanUtama = $jabatan[0] ?? ($teacher->jabatan ?? '-');
        }

        $stats = null;
        if (filter_var($request->query('include_stats'), FILTER_VALIDATE_BOOLEAN)) {
            $allQuery = Profile::where('tenant_id', $tenantId)->where('role', 'guru');
            $totalGuru = (clone $allQuery)->count();
            $aktifGuru = (clone $allQuery)->where('status', 'active')->count();

            $stats = [
                'totalGuru' => $totalGuru,
                'aktifGuru' => $aktifGuru,
                'nonaktifGuru' => (clone $allQuery)->where('status', 'nonaktif')->count(),
                'mutasiGuru' => (clone $allQuery)->where('status', 'mutasi')->count(),
                'inactiveGuru' => max(0, $totalGuru - $aktifGuru),
                'mapelCount' => count(array_unique(array_filter($allMapel))),
                'jabatanCount' => count(array_unique(array_filter($allJabatan))),
            ];
        }

        $filterOptions = [
            'mapel' => array_values(array_unique(array_filter($allMapel))),
            'jabatan' => array_values(array_unique(array_filter($allJabatan))),
        ];

        $response = TeacherResource::collection($teachers)->additional([
            'success' => true,
            'message' => 'Data guru berhasil dimuat.',
            'request_id' => $reqId,
            'filter_options' => $filterOptions,
        ]);

        if ($stats) {
            $response->additional(['stats' => $stats]);
        }

        return $response->response()->setStatusCode(200);
    }

    public function store(StoreTeacherRequest $request): JsonResponse
    {
        Gate::authorize('create', Profile::class);
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $validated = $request->validated();
        $validated['tenant_id'] = $tenantId;
        $validated['id'] = (string) Str::uuid();
        $validated['role'] = 'guru';
        $validated['status'] = $validated['status'] ?? 'active';
        $validated['created_via'] = 'api_v2';

        DB::beginTransaction();
        try {
            $user = User::create([
                'id' => $validated['id'],
                'email' => $validated['email'],
                'password' => Hash::make($validated['password'] ?? 'password123'),
                'name' => $validated['nama'],
            ]);

            unset($validated['password']);
            $profile = Profile::create($validated);
            DB::commit();

            return (new TeacherResource($profile))->additional([
                'success' => true,
                'message' => 'Guru berhasil dibuat.',
                'request_id' => $reqId,
            ])->response()->setStatusCode(201);
        } catch (\Exception $e) {
            DB::rollBack();

            return response()->json([
                'success' => false,
                'code' => 'TEACHER_CREATE_FAILED',
                'message' => 'Gagal membuat guru.',
                'error' => $e->getMessage(),
                'request_id' => $reqId,
            ], 500);
        }
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $profile = Profile::where('tenant_id', $tenantId)->where('role', 'guru')->find($id);

        if (! $profile) {
            return response()->json([
                'success' => false,
                'code' => 'TEACHER_NOT_FOUND',
                'message' => 'Guru tidak ditemukan.',
                'request_id' => $reqId,
            ], 404);
        }

        Gate::authorize('view', $profile);

        return (new TeacherResource($profile))->additional([
            'success' => true,
            'message' => 'Data guru berhasil dimuat.',
            'request_id' => $reqId,
        ])->response()->setStatusCode(200);
    }

    public function update(UpdateTeacherRequest $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $profile = Profile::where('tenant_id', $tenantId)->where('role', 'guru')->find($id);

        if (! $profile) {
            return response()->json([
                'success' => false,
                'code' => 'TEACHER_NOT_FOUND',
                'message' => 'Guru tidak ditemukan.',
                'request_id' => $reqId,
            ], 404);
        }

        Gate::authorize('update', $profile);

        $validated = $request->validated();

        DB::beginTransaction();
        try {
            if (isset($validated['password'])) {
                User::where('id', $profile->id)->update(['password' => Hash::make($validated['password'])]);
                unset($validated['password']);
            }

            $profile->update($validated);

            if (isset($validated['email']) || isset($validated['nama'])) {
                $user = User::find($profile->id);
                if ($user) {
                    if (isset($validated['email'])) {
                        $user->email = $validated['email'];
                    }
                    if (isset($validated['nama'])) {
                        $user->name = $validated['nama'];
                    }
                    $user->save();
                }
            }
            DB::commit();

            return (new TeacherResource($profile))->additional([
                'success' => true,
                'message' => 'Guru berhasil diupdate.',
                'request_id' => $reqId,
            ])->response()->setStatusCode(200);
        } catch (\Exception $e) {
            DB::rollBack();

            return response()->json([
                'success' => false,
                'code' => 'TEACHER_UPDATE_FAILED',
                'message' => 'Gagal mengupdate guru.',
                'error' => $e->getMessage(),
                'request_id' => $reqId,
            ], 500);
        }
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $profile = Profile::where('tenant_id', $tenantId)->where('role', 'guru')->find($id);

        if (! $profile) {
            return response()->json([
                'success' => false,
                'code' => 'TEACHER_NOT_FOUND',
                'message' => 'Guru tidak ditemukan.',
                'request_id' => $reqId,
            ], 404);
        }

        Gate::authorize('delete', $profile);

        DB::beginTransaction();
        try {
            $profile->delete();
            User::where('id', $profile->id)->delete();
            DB::commit();

            return response()->json([
                'success' => true,
                'message' => 'Guru berhasil dihapus.',
                'request_id' => $reqId,
            ], 200);
        } catch (\Exception $e) {
            DB::rollBack();

            return response()->json([
                'success' => false,
                'code' => 'TEACHER_DELETE_FAILED',
                'message' => 'Gagal menghapus guru.',
                'error' => $e->getMessage(),
                'request_id' => $reqId,
            ], 500);
        }
    }
}
