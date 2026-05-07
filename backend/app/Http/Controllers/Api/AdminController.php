<?php

namespace App\Http\Controllers\Api;

use App\Models\Profile;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password as PasswordRule;

class AdminController extends ApiController
{
    public function provisionUser(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $payload = $request->all();
        $validator = Validator::make($payload, [
            'nama' => 'required|string|max:120',
            'email' => 'nullable|email|max:255',
            'password' => ['required', 'string', PasswordRule::defaults()],
            'role' => 'required|in:siswa,guru,admin',
            'nis' => 'nullable|string|max:64',
            'kelas' => 'nullable|string|max:120',
            'jk' => 'nullable|string|max:20',
            'usia' => 'nullable|integer|min:0|max:150',
            'telp' => 'nullable|string|max:32',
            'agama' => 'nullable|string|max:50',
            'jabatan' => 'nullable|string|max:100',
            'alamat' => 'nullable|string|max:1000',
            'status' => 'nullable|string|max:32',
            'tanggal_lahir' => 'nullable|date',
            'no_hp_siswa' => 'nullable|string|max:32',
            'no_hp_wali' => 'nullable|string|max:32',
            'must_change_password' => 'nullable|boolean',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $role = strtolower(trim((string) ($payload['role'] ?? '')));
        $nama = trim((string) ($payload['nama'] ?? ''));
        $nis = trim((string) ($payload['nis'] ?? ''));
        $email = strtolower(trim((string) ($payload['email'] ?? '')));

        if ($email === '') {
            if ($role !== 'siswa') {
                return response()->json(['error' => 'Email wajib diisi untuk akun guru atau admin'], 422);
            }
            if ($nis === '') {
                return response()->json(['error' => 'NIS wajib diisi jika email siswa kosong'], 422);
            }
            $email = $this->buildImportPlaceholderEmail($nis, $tenantId);
        } elseif (Str::endsWith($email, '@import.local')) {
            $seed = $nis !== '' ? $nis : strstr($email, '@', true);
            $email = $this->buildImportPlaceholderEmail((string) $seed, $tenantId);
        }

        $existingUser = User::query()
            ->whereRaw('lower(email) = ?', [$email])
            ->first();
        if ($existingUser) {
            return response()->json(['error' => 'Email sudah terdaftar'], 409);
        }

        if ($nis !== '') {
            $existingNis = Profile::query()
                ->where('tenant_id', $tenantId)
                ->where('nis', $nis)
                ->first();
            if ($existingNis) {
                return response()->json(['error' => 'NIS/NIP sudah terdaftar di sekolah ini'], 409);
            }
        }

        $userId = (string) Str::uuid();
        $status = trim((string) ($payload['status'] ?? 'active')) ?: 'active';
        $now = now();

        $user = null;
        $profile = null;

        DB::transaction(function () use ($payload, $tenantId, $userId, $nama, $email, $role, $nis, $status, $now, &$user, &$profile) {
            $user = User::query()->create([
                'id' => $userId,
                'name' => $nama,
                'email' => $email,
                'password' => (string) ($payload['password'] ?? ''),
            ]);

            $profile = Profile::query()->create([
                'id' => $userId,
                'tenant_id' => $tenantId,
                'email' => $email,
                'nama' => $nama,
                'role' => $role,
                'nis' => $nis !== '' ? $nis : null,
                'kelas' => $this->nullableString($payload['kelas'] ?? null),
                'jk' => $this->nullableString($payload['jk'] ?? null),
                'usia' => isset($payload['usia']) ? (int) $payload['usia'] : null,
                'telp' => $this->nullableString($payload['telp'] ?? null),
                'agama' => $this->nullableString($payload['agama'] ?? null),
                'jabatan' => $this->nullableString($payload['jabatan'] ?? null),
                'alamat' => $this->nullableString($payload['alamat'] ?? null),
                'status' => $status,
                'must_change_password' => (bool) ($payload['must_change_password'] ?? false),
                'tanggal_lahir' => $this->nullableString($payload['tanggal_lahir'] ?? null),
                'no_hp_siswa' => $this->nullableString($payload['no_hp_siswa'] ?? null),
                'no_hp_wali' => $this->nullableString($payload['no_hp_wali'] ?? null),
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        });

        $this->logAudit($request, 'profiles', $userId, 'INSERT', null, [
            'id' => $userId,
            'tenant_id' => $tenantId,
            'email' => $email,
            'nama' => $nama,
            'role' => $role,
            'nis' => $nis !== '' ? $nis : null,
            'status' => $status,
            'must_change_password' => (bool) ($payload['must_change_password'] ?? false),
        ], $tenantId);

        return response()->json([
            'data' => [
                'user' => $user,
                'profile' => $profile,
            ],
        ], 201);
    }

    public function monitoring(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }
        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $activeSeconds = (int) $request->query('active_sec', 120);
        if ($activeSeconds < 30) {
            $activeSeconds = 30;
        }
        if ($activeSeconds > 900) {
            $activeSeconds = 900;
        }

        $activeCutoff = now()->subSeconds($activeSeconds)->toDateTimeString();

        $presenceAgg = DB::table('user_presence')
            ->select(
                'user_id',
                DB::raw('max(last_seen_at) as last_seen_at')
            )
            ->selectRaw('sum(case when last_seen_at >= ? then 1 else 0 end) as active_devices', [$activeCutoff])
            ->selectRaw('sum(case when last_seen_at >= ? then activity_count else 0 end) as activity_count', [$activeCutoff])
            ->where('tenant_id', $tenantId)
            ->groupBy('user_id');

        $rows = DB::table('profiles as p')
            ->leftJoinSub($presenceAgg, 'pr', 'p.id', '=', 'pr.user_id')
            ->where('p.tenant_id', $tenantId)
            ->whereIn('p.role', ['siswa', 'guru'])
            ->select(
                'p.id',
                'p.nama',
                'p.email',
                'p.nis',
                'p.role',
                'p.kelas',
                'pr.last_seen_at',
                'pr.active_devices',
                'pr.activity_count'
            )
            ->get();

        $students = [];
        $teachers = [];

        foreach ($rows as $row) {
            $activeDevices = (int) ($row->active_devices ?? 0);
            $item = [
                'id' => $row->id,
                'nama' => $row->nama,
                'email' => $row->email,
                'nis' => $row->nis,
                'kelas' => $row->kelas,
                'role' => $row->role,
                'online' => $activeDevices > 0,
                'last_seen_at' => $row->last_seen_at,
                'active_devices' => $activeDevices,
                'activity_count' => (int) ($row->activity_count ?? 0),
            ];

            if ($row->role === 'siswa') {
                $students[] = $item;
            } else {
                $teachers[] = $item;
            }
        }

        $sortWithActivity = function ($a, $b) {
            if ($a['online'] !== $b['online']) {
                return $a['online'] ? -1 : 1;
            }
            if ($a['online']) {
                if ($a['activity_count'] !== $b['activity_count']) {
                    return $b['activity_count'] <=> $a['activity_count'];
                }
            }
            $aSeen = $a['last_seen_at'] ?? '';
            $bSeen = $b['last_seen_at'] ?? '';

            return strcmp($bSeen, $aSeen);
        };

        $sortByLastSeen = function ($a, $b) {
            if ($a['online'] !== $b['online']) {
                return $a['online'] ? -1 : 1;
            }
            $aSeen = $a['last_seen_at'] ?? '';
            $bSeen = $b['last_seen_at'] ?? '';

            return strcmp($bSeen, $aSeen);
        };

        usort($students, $sortWithActivity);
        usort($teachers, $sortByLastSeen);

        return response()->json([
            'data' => [
                'students' => $students,
                'teachers' => $teachers,
                'active_seconds' => $activeSeconds,
                'generated_at' => now()->toISOString(),
            ],
        ]);
    }

    public function deleteUser(Request $request, string $id)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }
        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $profile = DB::table('profiles')->where('id', $id)->where('tenant_id', $tenantId)->first();
        if (! $profile) {
            return $this->deny('User tidak ditemukan', 404);
        }

        $role = strtolower((string) ($profile->role ?? ''));
        if (! in_array($role, ['guru', 'teacher', 'siswa'], true)) {
            return $this->deny('Hanya role guru/siswa yang boleh dihapus', 409);
        }

        $currentUserId = (string) ($request->user()?->id ?? '');
        if ($currentUserId !== '' && $currentUserId === $id) {
            return $this->deny('Tidak bisa menghapus akun sendiri', 409);
        }

        $oldData = (array) $profile;

        try {
            DB::transaction(function () use ($id, $role) {
                $this->cleanupBeforeHardDelete($id, $role);

                $deleted = DB::table('users')->where('id', $id)->delete();
                if ($deleted === 0) {
                    DB::table('profiles')->where('id', $id)->delete();
                }
            });
        } catch (\Throwable $e) {
            return $this->deny('Gagal menghapus user, masih ada data yang terkait.', 409);
        }

        $this->logAudit($request, 'profiles', $id, 'DELETE', $oldData, null, $tenantId);

        return response()->json(['data' => 'deleted']);
    }

    public function updateTeacherName(Request $request, string $id)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $validator = Validator::make($request->all(), [
            'nama' => ['required', 'string', 'max:120'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $newName = preg_replace('/\s+/', ' ', trim((string) $request->input('nama', ''))) ?? '';
        if ($newName === '') {
            return $this->deny('Nama guru wajib diisi.', 422);
        }

        $profile = DB::table('profiles')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();
        if (! $profile) {
            return $this->deny('Guru tidak ditemukan', 404);
        }

        $role = strtolower((string) ($profile->role ?? ''));
        if (! in_array($role, ['guru', 'teacher'], true)) {
            return $this->deny('Hanya nama guru yang bisa diubah dari form ini.', 409);
        }

        $oldName = (string) ($profile->nama ?? '');
        if ($oldName === $newName) {
            return response()->json([
                'data' => [
                    'profile' => $profile,
                    'changed' => false,
                    'synced_snapshots' => [
                        'jadwal' => 0,
                        'kelas_struktur' => 0,
                        'struktur_sekolah' => 0,
                        'organisasi' => 0,
                        'absensi_ajuan' => 0,
                    ],
                ],
            ]);
        }

        $now = now();
        $syncedSnapshots = [];

        DB::transaction(function () use ($id, $tenantId, $newName, $now, &$syncedSnapshots) {
            DB::table('profiles')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->update([
                    'nama' => $newName,
                    'updated_at' => $now,
                ]);

            DB::table('users')
                ->where('id', $id)
                ->update([
                    'name' => $newName,
                    'updated_at' => $now,
                ]);

            $syncedSnapshots = $this->syncTeacherDisplayNameSnapshots($tenantId, $id, $newName, $now);
        });

        $fresh = Profile::query()
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        $editor = $this->profile($request);
        $this->logAudit(
            $request,
            'profiles',
            $id,
            'UPDATE',
            [
                'id' => $id,
                'tenant_id' => $tenantId,
                'role' => $role,
                'email' => $profile->email,
                'nama' => $oldName,
            ],
            [
                'id' => $id,
                'tenant_id' => $tenantId,
                'role' => $role,
                'email' => $profile->email,
                'nama' => $fresh?->nama,
                'synced_snapshots' => $syncedSnapshots,
                'edited_by' => [
                    'id' => $editor?->id ?? $request->user()?->id,
                    'nama' => $editor?->nama ?? $request->user()?->name,
                    'email' => $editor?->email ?? $request->user()?->email,
                    'role' => $editor?->role,
                ],
                'edited_at' => $now->toISOString(),
            ],
            $tenantId
        );

        return response()->json([
            'data' => [
                'profile' => $fresh,
                'changed' => true,
                'synced_snapshots' => $syncedSnapshots,
            ],
        ]);
    }

    public function updateStudentAdditionalInfo(Request $request, string $id)
    {
        if (! $this->isAdmin($request) && ! $this->isGuru($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $student = Profile::query()
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa')
            ->first();

        if (! $student) {
            return $this->deny('Siswa tidak ditemukan', 404);
        }

        if (! $this->canEditStudentAdditionalInfo($request, $student, $tenantId)) {
            return $this->deny('Anda tidak memiliki akses untuk mengubah data siswa ini.', 403);
        }

        $payload = $request->all();
        $validator = Validator::make($payload, [
            'nama' => ['sometimes', 'string', 'max:120'],
            'jk' => ['sometimes', 'nullable', 'string', 'max:20'],
            'usia' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:150'],
            'tanggal_lahir' => ['sometimes', 'nullable', 'date'],
            'agama' => ['sometimes', 'nullable', 'string', 'max:50'],
            'alamat' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $allowedKeys = ['nama', 'jk', 'usia', 'tanggal_lahir', 'agama', 'alamat'];
        $hasAnyField = false;
        foreach ($allowedKeys as $key) {
            if (array_key_exists($key, $payload)) {
                $hasAnyField = true;
                break;
            }
        }

        if (! $hasAnyField) {
            return $this->deny('Tidak ada data yang dikirim untuk diperbarui.', 422);
        }

        $data = [];

        if (array_key_exists('nama', $payload)) {
            $nama = trim((string) ($payload['nama'] ?? ''));
            if ($nama === '') {
                return $this->deny('Nama siswa wajib diisi.', 422);
            }
            $data['nama'] = $nama;
        }

        if (array_key_exists('jk', $payload)) {
            $data['jk'] = $this->normalizeGenderValue($payload['jk']);
        }

        if (array_key_exists('tanggal_lahir', $payload)) {
            $tanggalLahir = $this->nullableString($payload['tanggal_lahir'] ?? null);
            $data['tanggal_lahir'] = $tanggalLahir;
            $data['usia'] = $tanggalLahir ? $this->calculateAgeFromBirthDate($tanggalLahir) : null;
        } elseif (array_key_exists('usia', $payload)) {
            $usia = $payload['usia'];
            $data['usia'] = ($usia === null || $usia === '') ? null : (int) $usia;
        }

        if (array_key_exists('agama', $payload)) {
            $data['agama'] = $this->nullableString($payload['agama'] ?? null);
        }

        if (array_key_exists('alamat', $payload)) {
            $data['alamat'] = $this->nullableString($payload['alamat'] ?? null);
        }

        $oldData = [
            'nama' => $student->nama,
            'jk' => $student->jk,
            'usia' => $student->usia,
            'tanggal_lahir' => $student->tanggal_lahir,
            'agama' => $student->agama,
            'alamat' => $student->alamat,
        ];

        $now = now();
        $data['updated_at'] = $now;

        DB::transaction(function () use ($id, $tenantId, $data, $now) {
            DB::table('profiles')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->update($data);

            if (array_key_exists('nama', $data)) {
                DB::table('users')
                    ->where('id', $id)
                    ->update([
                        'name' => $data['nama'],
                        'updated_at' => $now,
                    ]);

                $this->syncStudentDisplayNameSnapshots($tenantId, $id, (string) $data['nama'], $now);
            }
        });

        $fresh = Profile::query()
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        $this->logAudit(
            $request,
            'profiles',
            $id,
            'UPDATE',
            $oldData,
            [
                'nama' => $fresh?->nama,
                'jk' => $fresh?->jk,
                'usia' => $fresh?->usia,
                'tanggal_lahir' => $fresh?->tanggal_lahir,
                'agama' => $fresh?->agama,
                'alamat' => $fresh?->alamat,
            ],
            $tenantId
        );

        return response()->json([
            'data' => [
                'profile' => $fresh,
            ],
        ]);
    }

    private function cleanupBeforeHardDelete(string $userId, string $role): void
    {
        $now = now();

        // FK audit_log.user_id -> profiles.id (non-cascade), wajib dinullkan dulu
        DB::table('audit_log')->where('user_id', $userId)->update(['user_id' => null]);

        // Referensi text/non-cascade yang sering menahan delete
        DB::table('kelas_struktur')
            ->where('ketua_siswa_id', $userId)
            ->update([
                'ketua_siswa_id' => null,
                'ketua_siswa_nama' => null,
                'updated_at' => $now,
            ]);

        DB::table('organisasi_anggota')->where('siswa_id', $userId)->delete();
        DB::table('absensi_eskul')->where('user_id', $userId)->delete();

        // Referensi ke users.id (non-cascade)
        DB::table('templat_sertifikat_publik')
            ->where('created_by', $userId)
            ->update([
                'created_by' => null,
                'updated_at' => $now,
            ]);

        // Referensi ke profiles.id (non-cascade)
        DB::table('tugas')
            ->where('created_by', $userId)
            ->update([
                'created_by' => null,
                'updated_at' => $now,
            ]);

        if (in_array($role, ['guru', 'teacher'], true)) {
            DB::table('jadwal')->where('guru_id', $userId)->delete();

            DB::table('kelas_struktur')
                ->where('wali_guru_id', $userId)
                ->update([
                    'wali_guru_id' => null,
                    'wali_guru_nama' => null,
                    'updated_at' => $now,
                ]);

            DB::table('struktur_sekolah')->where('guru_id', $userId)->delete();

            DB::table('organisasi')
                ->where('pembina_guru_id', $userId)
                ->update([
                    'pembina_guru_id' => null,
                    'pembina_guru_nama' => null,
                    'updated_at' => $now,
                ]);

            DB::table('ekskul')
                ->where('pembina_guru_id', $userId)
                ->update([
                    'pembina_guru_id' => null,
                    'updated_at' => $now,
                ]);

            DB::table('absensi_ajuan')
                ->where('guru_id', $userId)
                ->update([
                    'guru_id' => null,
                    'guru_nama' => null,
                ]);

            DB::table('quizzes')->where('guru_id', $userId)->delete();
        }
    }

    private function nullableString(mixed $value): ?string
    {
        $normalized = trim((string) ($value ?? ''));

        return $normalized === '' ? null : $normalized;
    }

    private function canEditStudentAdditionalInfo(Request $request, Profile $student, string $tenantId): bool
    {
        if ($this->isAdmin($request)) {
            return true;
        }

        if (! $this->isGuru($request)) {
            return false;
        }

        $guruId = (string) ($request->user()?->id ?? '');
        $kelasId = trim((string) ($student->kelas ?? ''));
        if ($guruId === '' || $kelasId === '') {
            return false;
        }

        return DB::table('kelas_struktur')
            ->where('tenant_id', $tenantId)
            ->where('kelas_id', $kelasId)
            ->where('wali_guru_id', $guruId)
            ->exists();
    }

    private function normalizeGenderValue(mixed $value): ?string
    {
        $normalized = strtolower(trim((string) ($value ?? '')));
        if ($normalized === '') {
            return null;
        }

        if (in_array($normalized, ['l', 'lk', 'laki', 'laki-laki', 'laki laki', 'pria', 'cowok'], true)) {
            return 'L';
        }

        if (in_array($normalized, ['p', 'pr', 'perempuan', 'perumpuan', 'wanita', 'cewek'], true)) {
            return 'P';
        }

        return strtoupper(substr($normalized, 0, 1));
    }

    private function calculateAgeFromBirthDate(string $value): ?int
    {
        try {
            $birthDate = Carbon::parse($value);
        } catch (\Throwable $e) {
            return null;
        }

        $now = Carbon::now($birthDate->getTimezone());
        if ($birthDate->greaterThan($now)) {
            return null;
        }

        return $birthDate->age;
    }

    private function buildImportPlaceholderEmail(string $identifier, string $tenantId): string
    {
        $local = strtolower(trim($identifier));
        $local = preg_replace('/[^a-z0-9]+/i', '.', $local) ?? '';
        $local = trim($local, '.');
        if ($local === '') {
            $local = 'user';
        }

        $tenantPart = strtolower(trim($tenantId));
        $tenantPart = preg_replace('/[^a-z0-9]+/i', '.', $tenantPart) ?? '';
        $tenantPart = trim($tenantPart, '.');
        if ($tenantPart === '') {
            $tenantPart = 'tenant';
        }

        return "{$local}.{$tenantPart}@import.local";
    }

    public function dashboardStats(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }
        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $period = \App\Support\AcademicPeriod::current();

        $stats = [
            'siswa' => DB::table('profiles')->where('tenant_id', $tenantId)->where('role', 'siswa')->count(),
            'guru' => DB::table('profiles')->where('tenant_id', $tenantId)->whereIn('role', ['guru', 'teacher'])->count(),
            'admin' => DB::table('profiles')->where('tenant_id', $tenantId)->where('role', 'admin')->count(),
            'kelas' => DB::table('kelas')->where('tenant_id', $tenantId)->count(),
            'absensi' => DB::table('absensi')
                ->where('tenant_id', $tenantId)
                ->where('tahun_ajaran', $period['tahun_ajaran'])
                ->where('semester', $period['semester'])
                ->count(),
            'pengumuman' => DB::table('pengumuman')->where('tenant_id', $tenantId)->count(),
            'eskul' => DB::table('ekskul')->where('tenant_id', $tenantId)->count(),
        ];

        return response()->json(['data' => $stats]);
    }
}
