<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V2\JoinExtracurricularRequest;
use App\Http\Requests\Api\V2\StoreExtracurricularRequest;
use App\Http\Requests\Api\V2\UpdateExtracurricularRequest;
use App\Services\Academic\AcademicContextResolver;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class ExtracurricularController extends Controller
{
    private AcademicContextResolver $contextResolver;

    public function __construct(AcademicContextResolver $contextResolver)
    {
        $this->contextResolver = $contextResolver;
    }

    public function index(Request $request): JsonResponse
    {
        $tenantId = $this->tenantId($request);
        $context = $this->contextResolver->forRead($request, $tenantId);

        $query = DB::table('ekskul')
            ->where('tenant_id', $tenantId)
            ->where('tahun_ajaran', $context['tahun_ajaran'])
            ->where('semester', $context['semester']);

        $extracurriculars = $query->orderBy('nama')->get();

        return $this->success($request, $extracurriculars);
    }

    public function show(Request $request, string $extracurricular): JsonResponse
    {
        $tenantId = $this->tenantId($request);

        $ekskul = DB::table('ekskul')
            ->where('tenant_id', $tenantId)
            ->where('id', $extracurricular)
            ->first();

        if (! $ekskul) {
            return $this->error($request, 'EXTRACURRICULAR_NOT_FOUND', 'Ekstrakurikuler tidak ditemukan.', 404);
        }

        return $this->success($request, $ekskul);
    }

    public function store(StoreExtracurricularRequest $request): JsonResponse
    {
        if ($this->role($request) !== 'admin') {
            return $this->error($request, 'FORBIDDEN', 'Hanya admin yang dapat membuat ekstrakurikuler.', 403);
        }

        $tenantId = $this->tenantId($request);
        $context = $this->contextResolver->forRead($request, $tenantId);

        $data = $request->validated();
        $id = (string) Str::uuid();

        DB::table('ekskul')->insert([
            'id' => $id,
            'tenant_id' => $tenantId,
            'nama' => $data['nama'],
            'keterangan' => $data['keterangan'] ?? null,
            'hari' => $data['hari'] ?? null,
            'jam_mulai' => $data['jam_mulai'] ?? null,
            'jam_selesai' => $data['jam_selesai'] ?? null,
            'pembina_guru_id' => $data['pembina_guru_id'] ?? null,
            'registration_deadline_at' => $data['registration_deadline_at'] ?? null,
            'tahun_ajaran' => $context['tahun_ajaran'],
            'semester' => $context['semester'],
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $ekskul = DB::table('ekskul')->where('id', $id)->first();

        return $this->success($request, $ekskul, 201);
    }

    public function update(UpdateExtracurricularRequest $request, string $extracurricular): JsonResponse
    {
        if ($this->role($request) !== 'admin') {
            return $this->error($request, 'FORBIDDEN', 'Hanya admin yang dapat mengubah ekstrakurikuler.', 403);
        }

        $tenantId = $this->tenantId($request);
        $ekskul = DB::table('ekskul')
            ->where('tenant_id', $tenantId)
            ->where('id', $extracurricular)
            ->first();

        if (! $ekskul) {
            return $this->error($request, 'EXTRACURRICULAR_NOT_FOUND', 'Ekstrakurikuler tidak ditemukan.', 404);
        }

        $data = $request->validated();
        $updateData = [];

        foreach (['nama', 'keterangan', 'hari', 'jam_mulai', 'jam_selesai', 'pembina_guru_id', 'registration_deadline_at'] as $field) {
            if (array_key_exists($field, $data)) {
                $updateData[$field] = $data[$field];
            }
        }

        if (! empty($updateData)) {
            $updateData['updated_at'] = now();
            DB::table('ekskul')->where('id', $extracurricular)->update($updateData);
        }

        $ekskul = DB::table('ekskul')->where('id', $extracurricular)->first();

        return $this->success($request, $ekskul);
    }

    public function destroy(Request $request, string $extracurricular): JsonResponse
    {
        if ($this->role($request) !== 'admin') {
            return $this->error($request, 'FORBIDDEN', 'Hanya admin yang dapat menghapus ekstrakurikuler.', 403);
        }

        $tenantId = $this->tenantId($request);
        $ekskul = DB::table('ekskul')
            ->where('tenant_id', $tenantId)
            ->where('id', $extracurricular)
            ->first();

        if (! $ekskul) {
            return $this->error($request, 'EXTRACURRICULAR_NOT_FOUND', 'Ekstrakurikuler tidak ditemukan.', 404);
        }

        DB::table('ekskul')->where('id', $extracurricular)->delete();

        return $this->success($request, ['message' => 'Ekstrakurikuler berhasil dihapus.']);
    }

    public function members(Request $request, string $extracurricular): JsonResponse
    {
        $tenantId = $this->tenantId($request);

        $ekskul = DB::table('ekskul')
            ->where('tenant_id', $tenantId)
            ->where('id', $extracurricular)
            ->first();

        if (! $ekskul) {
            return $this->error($request, 'EXTRACURRICULAR_NOT_FOUND', 'Ekstrakurikuler tidak ditemukan.', 404);
        }

        $role = $this->role($request);
        if ($role !== 'admin') {
            if ($role === 'guru') {
                $profileId = $this->profileId($request);
                if ($ekskul->pembina_guru_id !== $profileId) {
                    return $this->error($request, 'FORBIDDEN', 'Hanya pembina ekstrakurikuler yang dapat melihat anggotanya.', 403);
                }
            } else {
                return $this->error($request, 'FORBIDDEN', 'Anda tidak memiliki akses.', 403);
            }
        }

        $members = DB::table('ekskul_anggota')
            ->join('profiles', 'ekskul_anggota.user_id', '=', 'profiles.id')
            ->where('ekskul_anggota.ekskul_id', $extracurricular)
            ->select('ekskul_anggota.id as membership_id', 'profiles.id as user_id', 'profiles.nama', 'profiles.nis', 'profiles.kelas', 'ekskul_anggota.created_at')
            ->orderBy('profiles.nama')
            ->get();

        return $this->success($request, $members);
    }

    public function join(JoinExtracurricularRequest $request, string $extracurricular): JsonResponse
    {
        $tenantId = $this->tenantId($request);

        $ekskul = DB::table('ekskul')
            ->where('tenant_id', $tenantId)
            ->where('id', $extracurricular)
            ->first();

        if (! $ekskul) {
            return $this->error($request, 'EXTRACURRICULAR_NOT_FOUND', 'Ekstrakurikuler tidak ditemukan.', 404);
        }

        $role = $this->role($request);
        $data = $request->validated();

        $studentId = $data['student_id'] ?? null;

        if ($role === 'siswa') {
            $studentId = $this->profileId($request);
        } else {
            if ($role !== 'admin') {
                return $this->error($request, 'FORBIDDEN', 'Hanya admin yang dapat mendaftarkan siswa lain.', 403);
            }
            if (! $studentId) {
                return $this->error($request, 'STUDENT_REQUIRED', 'ID siswa wajib disertakan.', 400);
            }
        }

        if ($role === 'siswa' && $ekskul->registration_deadline_at) {
            $deadline = Carbon::parse($ekskul->registration_deadline_at);
            if (now()->gt($deadline)) {
                return $this->error($request, 'DEADLINE_PASSED', 'Pendaftaran ekstrakurikuler sudah ditutup.', 400);
            }
        }

        $exists = DB::table('ekskul_anggota')
            ->where('ekskul_id', $extracurricular)
            ->where('user_id', $studentId)
            ->exists();

        if ($exists) {
            return $this->error($request, 'ALREADY_JOINED', 'Anda sudah terdaftar pada ekstrakurikuler ini.', 400);
        }

        $settings = DB::table('settings')->where('tenant_id', $tenantId)->first();
        $maxLimit = $settings->max_ekskul_per_siswa ?? null;

        if ($maxLimit !== null) {
            $currentPeriod = $this->contextResolver->forRead($request, $tenantId);

            $activeCount = DB::table('ekskul_anggota')
                ->join('ekskul', 'ekskul_anggota.ekskul_id', '=', 'ekskul.id')
                ->where('ekskul_anggota.user_id', $studentId)
                ->where('ekskul.tahun_ajaran', $currentPeriod['tahun_ajaran'])
                ->where('ekskul.semester', $currentPeriod['semester'])
                ->count();

            if ($activeCount >= $maxLimit) {
                return $this->error($request, 'LIMIT_REACHED', "Maksimal ekstrakurikuler per siswa adalah {$maxLimit}.", 400);
            }
        }

        DB::table('ekskul_anggota')->insert([
            'ekskul_id' => $extracurricular,
            'user_id' => $studentId,
            'created_at' => now(),
        ]);

        return $this->success($request, ['message' => 'Berhasil bergabung ke ekstrakurikuler.']);
    }

    public function leave(Request $request, string $extracurricular): JsonResponse
    {
        $tenantId = $this->tenantId($request);

        $ekskul = DB::table('ekskul')
            ->where('tenant_id', $tenantId)
            ->where('id', $extracurricular)
            ->first();

        if (! $ekskul) {
            return $this->error($request, 'EXTRACURRICULAR_NOT_FOUND', 'Ekstrakurikuler tidak ditemukan.', 404);
        }

        $role = $this->role($request);
        $studentId = $request->query('student_id');

        if ($role === 'siswa') {
            $studentId = $this->profileId($request);

            if ($ekskul->registration_deadline_at) {
                $deadline = Carbon::parse($ekskul->registration_deadline_at);
                if (now()->gt($deadline)) {
                    return $this->error($request, 'DEADLINE_PASSED', 'Batas waktu pendaftaran ekstrakurikuler sudah ditutup.', 400);
                }
            }
        } else {
            if ($role !== 'admin') {
                return $this->error($request, 'FORBIDDEN', 'Hanya admin yang dapat mengeluarkan siswa.', 403);
            }
            if (! $studentId) {
                return $this->error($request, 'STUDENT_REQUIRED', 'Filter student_id wajib disertakan.', 400);
            }
        }

        $deleted = DB::table('ekskul_anggota')
            ->where('ekskul_id', $extracurricular)
            ->where('user_id', $studentId)
            ->delete();

        if (! $deleted) {
            return $this->error($request, 'NOT_JOINED', 'Data anggota ekstrakurikuler tidak ditemukan.', 404);
        }

        return $this->success($request, ['message' => 'Berhasil keluar dari ekstrakurikuler.']);
    }

    private function role(Request $request): string
    {
        return strtolower(trim((string) ($request->user()?->profile?->role ?? '')));
    }

    private function tenantId(Request $request): string
    {
        return (string) ($request->user()?->profile?->tenant_id ?? '');
    }

    private function profileId(Request $request): string
    {
        return (string) ($request->user()?->profile?->id ?? '');
    }

    private function error(Request $request, string $code, string $message, int $status = 400): JsonResponse
    {
        return response()->json([
            'success' => false,
            'error' => [
                'code' => $code,
                'message' => $message,
            ],
        ], $status);
    }

    private function success(Request $request, $data = null, int $status = 200): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data' => $data,
        ], $status);
    }
}
