<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V2\StoreStudentRequest;
use App\Http\Requests\Api\V2\UpdateStudentRequest;
use App\Http\Resources\Api\V2\StudentResource;
use App\Models\Profile;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class StudentController extends Controller
{
    private function getRequestId(Request $request): string
    {
        return $request->header('X-Request-ID', (string) Str::uuid());
    }

    public function index(Request $request): AnonymousResourceCollection|JsonResponse
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

        if ($request->filled('q')) {
            $query->where('nama', 'like', '%'.$request->query('q').'%');
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
            $context['kelas'] = DB::table('kelas')
                ->where('tenant_id', $tenantId)
                ->orderBy('id')
                ->get()
                ->map(fn ($row) => (array) $row)
                ->values();

            $context['struktur'] = DB::table('kelas_struktur')
                ->whereIn('kelas_id', collect($context['kelas'])->pluck('id'))
                ->get()
                ->map(fn ($row) => (array) $row)
                ->values();

            $context['wali_kelas_ids'] = [];
            if ($request->user() && $request->user()->profile->role === 'guru') {
                $context['wali_kelas_ids'] = collect($context['struktur'])
                    ->where('wali_guru_id', $request->user()->id)
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

    public function store(StoreStudentRequest $request): JsonResponse
    {
        Gate::authorize('create', Profile::class);
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $validated = $request->validated();
        $validated['tenant_id'] = $tenantId;
        $validated['id'] = (string) Str::uuid();
        $validated['role'] = 'siswa';
        $validated['status'] = $validated['status'] ?? 'active';
        $validated['created_via'] = 'api_v2';

        DB::beginTransaction();
        try {
            $user = User::create([
                'id' => $validated['id'],
                'email' => $validated['email'],
                'password' => Hash::make($validated['nis'] ?: 'password123'),
                'name' => $validated['nama'],
            ]);

            $profile = Profile::create($validated);
            DB::commit();

            return (new StudentResource($profile))->additional([
                'success' => true,
                'message' => 'Siswa berhasil dibuat.',
                'request_id' => $reqId,
            ])->response()->setStatusCode(201);
        } catch (\Exception $e) {
            DB::rollBack();

            return response()->json([
                'success' => false,
                'code' => 'STUDENT_CREATE_FAILED',
                'message' => 'Gagal membuat siswa.',
                'error' => $e->getMessage(),
                'request_id' => $reqId,
            ], 500);
        }
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

    public function update(UpdateStudentRequest $request, string $id): JsonResponse
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

        DB::beginTransaction();
        try {
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

            return (new StudentResource($profile))->additional([
                'success' => true,
                'message' => 'Siswa berhasil diupdate.',
                'request_id' => $reqId,
            ])->response()->setStatusCode(200);
        } catch (\Exception $e) {
            DB::rollBack();

            return response()->json([
                'success' => false,
                'code' => 'STUDENT_UPDATE_FAILED',
                'message' => 'Gagal mengupdate siswa.',
                'error' => $e->getMessage(),
                'request_id' => $reqId,
            ], 500);
        }
    }

    public function destroy(Request $request, string $id): JsonResponse
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

        Gate::authorize('delete', $profile);

        DB::beginTransaction();
        try {
            $profile->delete();
            User::where('id', $profile->id)->delete();
            DB::commit();

            return response()->json([
                'success' => true,
                'message' => 'Siswa berhasil dihapus.',
                'request_id' => $reqId,
            ], 200);
        } catch (\Exception $e) {
            DB::rollBack();

            return response()->json([
                'success' => false,
                'code' => 'STUDENT_DELETE_FAILED',
                'message' => 'Gagal menghapus siswa.',
                'error' => $e->getMessage(),
                'request_id' => $reqId,
            ], 500);
        }
    }
}
