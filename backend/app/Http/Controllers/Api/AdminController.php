<?php

namespace App\Http\Controllers\Api;

use App\Models\Profile;
use App\Models\User;
use App\Support\AcademicPeriod;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
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
        $createdVia = $this->normalizeProfileCreatedVia($payload['created_via'] ?? $payload['source'] ?? null, 'admin_created');
        if ($createdVia === 'import' && array_key_exists('password', $payload)) {
            $payload['password'] = $this->normalizeProvisionPassword((string) ($payload['password'] ?? ''));
        }

        $validator = Validator::make($payload, [
            'id' => 'nullable|string|max:191',
            'nama' => 'required|string|max:120',
            'email' => 'nullable|email|max:255',
            'password' => ['nullable', 'string', PasswordRule::defaults()],
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
            'sync_existing' => 'nullable|boolean',
            'created_via' => 'nullable|string|max:40',
            'source' => 'nullable|string|max:40',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $role = strtolower(trim((string) ($payload['role'] ?? '')));
        $nama = trim((string) ($payload['nama'] ?? ''));
        $nis = $this->normalizeIdentifierCode($payload['nis'] ?? '');
        $email = strtolower(trim((string) ($payload['email'] ?? '')));
        $requestedId = trim((string) ($payload['id'] ?? ''));
        $syncExisting = filter_var($payload['sync_existing'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $allowExistingUpdate = $syncExisting || $requestedId !== '';

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

        $existingProfile = null;
        if ($requestedId !== '') {
            $existingProfile = Profile::query()
                ->where('tenant_id', $tenantId)
                ->where('id', $requestedId)
                ->first();
        }

        if (! $existingProfile && $allowExistingUpdate && $nis !== '') {
            $existingProfile = Profile::query()
                ->where('tenant_id', $tenantId)
                ->whereRaw('lower(nis) = ?', [strtolower($nis)])
                ->first();
        }

        if (! $existingProfile && $allowExistingUpdate && $email !== '') {
            $existingProfile = Profile::query()
                ->where('tenant_id', $tenantId)
                ->whereRaw('lower(email) = ?', [$email])
                ->first();
        }

        if ($existingProfile) {
            $existingRole = strtolower(trim((string) ($existingProfile->role ?? '')));
            $existingRole = $existingRole === 'teacher' ? 'guru' : $existingRole;
            if ($existingRole !== $role) {
                return response()->json(['error' => 'Data ditemukan, tapi role akun berbeda'], 409);
            }

            if (
                Profile::query()
                    ->where('tenant_id', $tenantId)
                    ->whereRaw('lower(email) = ?', [$email])
                    ->where('id', '!=', $existingProfile->id)
                    ->exists()
            ) {
                return response()->json(['error' => 'Email sudah terdaftar di sekolah ini'], 409);
            }

            if ($nis !== '' && Profile::query()
                ->where('tenant_id', $tenantId)
                ->whereRaw('lower(nis) = ?', [strtolower($nis)])
                ->where('id', '!=', $existingProfile->id)
                ->exists()
            ) {
                return response()->json(['error' => 'NIS/NIP sudah terdaftar di sekolah ini'], 409);
            }
        } else {
            $existingUser = Profile::query()
                ->where('tenant_id', $tenantId)
                ->whereRaw('lower(email) = ?', [$email])
                ->first();
            if ($existingUser) {
                return response()->json(['error' => 'Email sudah terdaftar di sekolah ini'], 409);
            }

            if ($nis !== '') {
                $existingNis = Profile::query()
                    ->where('tenant_id', $tenantId)
                    ->whereRaw('lower(nis) = ?', [strtolower($nis)])
                    ->first();
                if ($existingNis) {
                    return response()->json(['error' => 'NIS/NIP sudah terdaftar di sekolah ini'], 409);
                }
            }

            if (trim((string) ($payload['password'] ?? '')) === '') {
                return response()->json(['error' => 'Password wajib diisi'], 422);
            }
        }

        $userId = $existingProfile ? (string) $existingProfile->id : (string) Str::uuid();
        $statusInput = array_key_exists('status', $payload)
            ? trim((string) ($payload['status'] ?? ''))
            : trim((string) ($existingProfile->status ?? 'active'));
        $status = $statusInput !== '' ? $statusInput : 'active';
        $angkatan = $this->resolveCohortForClass($tenantId, $payload['kelas'] ?? null);
        $now = now();
        $password = trim((string) ($payload['password'] ?? ''));
        $actorId = (string) ($request->user()?->id ?? '');
        $isUpdate = (bool) $existingProfile;
        $oldData = $existingProfile ? (array) $existingProfile->getAttributes() : null;
        $syncedSnapshots = [];

        $user = null;
        $profile = null;

        DB::transaction(function () use (
            $payload,
            $tenantId,
            $userId,
            $nama,
            $email,
            $role,
            $nis,
            $status,
            $angkatan,
            $now,
            $password,
            $actorId,
            $createdVia,
            $existingProfile,
            $isUpdate,
            &$user,
            &$profile,
            &$syncedSnapshots
        ) {
            $profilePayload = [
                'email' => $email,
                'nama' => $nama,
                'role' => $role,
                'status' => $status,
                'updated_at' => $now,
            ];

            if (! $isUpdate || $nis !== '') {
                $profilePayload['nis'] = $nis !== '' ? $nis : null;
            }

            foreach (['kelas', 'jk', 'telp', 'agama', 'jabatan', 'alamat', 'tanggal_lahir', 'no_hp_siswa', 'no_hp_wali'] as $key) {
                if (! $isUpdate || array_key_exists($key, $payload)) {
                    $profilePayload[$key] = $this->nullableString($payload[$key] ?? null);
                }
            }

            if (array_key_exists('tanggal_lahir', $profilePayload)) {
                $profilePayload['usia'] = $profilePayload['tanggal_lahir']
                    ? $this->calculateAgeFromBirthDate((string) $profilePayload['tanggal_lahir'])
                    : null;
            } elseif (! $isUpdate || array_key_exists('usia', $payload)) {
                $rawUsia = $payload['usia'] ?? null;
                $profilePayload['usia'] = $rawUsia === null || $rawUsia === ''
                    ? null
                    : (int) $rawUsia;
            }

            if (Schema::hasColumn('profiles', 'angkatan') && (! $isUpdate || array_key_exists('kelas', $payload))) {
                $profilePayload['angkatan'] = $angkatan;
            }

            if (Schema::hasColumn('profiles', 'created_via') && (! $isUpdate || trim((string) ($existingProfile?->created_via ?? '')) === '')) {
                $profilePayload['created_via'] = $createdVia;
            }
            if (Schema::hasColumn('profiles', 'created_by') && $actorId !== '' && (! $isUpdate || trim((string) ($existingProfile?->created_by ?? '')) === '')) {
                $profilePayload['created_by'] = $actorId;
            }

            if ($isUpdate) {
                Profile::query()
                    ->where('id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->update($profilePayload);

                $user = User::query()->where('id', $userId)->first();
                if ($user) {
                    $user->forceFill([
                        'name' => $nama,
                        'email' => $email,
                    ])->save();
                } else {
                    $user = User::query()->create([
                        'id' => $userId,
                        'name' => $nama,
                        'email' => $email,
                        'password' => $password !== '' ? $password : $this->temporaryStrongPassword(),
                    ]);
                }

                $profile = Profile::query()
                    ->where('id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->first();

                if (in_array($role, ['siswa', 'guru'], true) && array_key_exists('tanggal_lahir', $profilePayload)) {
                    $this->syncImportedInitialProfilePassword($tenantId, $userId, $now);
                }
            } else {
                $user = User::query()->create([
                    'id' => $userId,
                    'name' => $nama,
                    'email' => $email,
                    'password' => $password,
                ]);

                $profilePayload['id'] = $userId;
                $profilePayload['tenant_id'] = $tenantId;
                $profilePayload['must_change_password'] = (bool) ($payload['must_change_password'] ?? false);
                $profilePayload['created_at'] = $now;

                $profile = Profile::query()->create($profilePayload);
            }

            if ($isUpdate) {
                if ($role === 'guru') {
                    $syncedSnapshots = $this->syncTeacherDisplayNameSnapshots($tenantId, $userId, $nama, $now);
                } elseif ($role === 'siswa') {
                    $syncedSnapshots = $this->syncStudentDisplayNameSnapshots($tenantId, $userId, $nama, $now);
                }
            }
        });

        $newData = [
            'id' => $userId,
            'tenant_id' => $tenantId,
            'email' => $email,
            'nama' => $nama,
            'role' => $role,
            'nis' => $nis !== '' ? $nis : null,
            'status' => $status,
            'angkatan' => $angkatan,
            'must_change_password' => (bool) ($profile?->must_change_password ?? ($payload['must_change_password'] ?? false)),
            'created_via' => $profile?->created_via ?? null,
            'created_by' => $profile?->created_by ?? null,
        ];
        if ($isUpdate) {
            $newData['synced_snapshots'] = $syncedSnapshots;
        }

        $this->logAudit($request, 'profiles', $userId, $isUpdate ? 'UPDATE' : 'INSERT', $oldData, $newData, $tenantId);

        return response()->json([
            'data' => [
                'user' => $user,
                'profile' => $profile,
                'status' => $isUpdate ? 'updated' : 'created',
            ],
        ], $isUpdate ? 200 : 201);
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
        $presenceAgg = $this->presenceAggregateQuery($tenantId, $activeCutoff);

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

    public function dashboardSummary(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $cacheKey = "tenant:{$tenantId}:admin-dashboard-summary:v2";
        $payload = Cache::remember($cacheKey, now()->addSeconds(60), function () use ($tenantId) {
            $profileCounts = DB::table('profiles')
                ->select('role', DB::raw('count(*) as aggregate'))
                ->where('tenant_id', $tenantId)
                ->whereIn('role', ['siswa', 'guru', 'admin'])
                ->groupBy('role')
                ->pluck('aggregate', 'role');

            $settings = $this->firstTenantRow('settings', $tenantId);
            $periodStart = $settings?->periode_mulai ?? null;
            $periodEnd = $settings?->periode_selesai ?? null;

            $attendanceQuery = $this->tenantQuery('absensi', $tenantId);
            if ($periodStart && $periodEnd && Schema::hasColumn('absensi', 'tanggal')) {
                $attendanceQuery->whereBetween('tanggal', [$periodStart, $periodEnd]);
            }

            return [
                'siswa' => (int) ($profileCounts['siswa'] ?? 0),
                'guru' => (int) ($profileCounts['guru'] ?? 0),
                'admin' => (int) ($profileCounts['admin'] ?? 0),
                'kelas' => $this->tenantTableCount('kelas', $tenantId),
                'absensi' => Schema::hasTable('absensi') ? (int) $attendanceQuery->count() : 0,
                'pengumuman' => $this->tenantTableCount('pengumuman', $tenantId),
                'eskul' => $this->tenantTableCount('ekskul', $tenantId),
                'generated_at' => now()->toISOString(),
            ];
        });

        return response()->json(['data' => $payload]);
    }

    public function students(Request $request)
    {
        if (! $this->isAdmin($request) && ! $this->isGuru($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $isAdmin = $this->isAdmin($request);
        $teacherClassIds = null;
        if (! $isAdmin) {
            $teacherClassIds = $this->teacherClassIds($tenantId, (string) ($request->user()?->id ?? ''));
            if (empty($teacherClassIds)) {
                return response()->json([
                    'data' => [
                        'rows' => [],
                        'meta' => $this->paginationMeta(1, $this->perPage($request), 0),
                        'stats' => $this->emptyStudentStats(),
                        'kelas' => [],
                        'struktur' => [],
                        'wali_kelas_ids' => [],
                    ],
                ]);
            }
        }

        $page = max(1, (int) $request->query('page', 1));
        $allRows = filter_var($request->query('all', false), FILTER_VALIDATE_BOOLEAN);
        $perPage = $allRows ? min(10000, max(1, (int) $request->query('per_page', 10000))) : $this->perPage($request);
        $includeContext = filter_var($request->query('include_context', true), FILTER_VALIDATE_BOOLEAN);
        $includeStats = filter_var($request->query('include_stats', true), FILTER_VALIDATE_BOOLEAN);

        $presenceAgg = $this->presenceAggregateQuery($tenantId);
        $query = $this->studentBaseQuery($tenantId, $teacherClassIds)
            ->leftJoinSub($presenceAgg, 'pr', 'profiles.id', '=', 'pr.user_id');
        $this->applyStudentFilters($query, $request);

        $total = (clone $query)->count('profiles.id');
        $studentColumns = $this->prefixedExistingColumns('profiles', [
            'id', 'email', 'nama', 'role', 'kelas', 'jk', 'usia', 'telp', 'photo_url',
            'created_at', 'nis', 'agama', 'jabatan', 'alamat', 'status',
            'alasan_nonaktif', 'disabled_at', 'tanggal_lahir', 'updated_at',
            'rfid_uid', 'kelas_change_used', 'no_hp_siswa', 'no_hp_wali',
            'deleted_at', 'photo_path', 'photo_updated_at', 'angkatan',
            'created_via', 'created_by',
        ]);
        $rows = $query
            ->select($studentColumns)
            ->selectRaw('pr.last_seen_at as last_seen_at')
            ->selectRaw('coalesce(pr.active_devices, 0) as active_devices')
            ->selectRaw('coalesce(pr.activity_count, 0) as activity_count')
            ->selectRaw('case when coalesce(pr.active_devices, 0) > 0 then 1 else 0 end as online')
            ->orderByRaw('case when coalesce(pr.active_devices, 0) > 0 then 0 else 1 end')
            ->orderByRaw('case when pr.last_seen_at is null then 1 else 0 end')
            ->orderByDesc('pr.last_seen_at')
            ->orderBy('profiles.kelas')
            ->orderBy('profiles.nama')
            ->when(! $allRows, fn ($builder) => $builder->offset(($page - 1) * $perPage)->limit($perPage))
            ->when($allRows, fn ($builder) => $builder->limit($perPage))
            ->get()
            ->map(fn ($row) => (array) $row)
            ->values();

        $payload = [
            'rows' => $rows,
            'meta' => $this->paginationMeta($page, $perPage, $total, $allRows),
        ];

        if ($includeStats) {
            $payload['stats'] = $this->studentStats($tenantId, $teacherClassIds);
        }

        if ($includeContext) {
            $payload['kelas'] = $this->tenantQuery('kelas', $tenantId)
                ->select($this->existingColumns('kelas', ['id', 'nama', 'tingkat', 'jurusan', 'wali_kelas', 'angkatan', 'created_at', 'updated_at']))
                ->when($teacherClassIds !== null, fn ($builder) => $builder->whereIn('id', $teacherClassIds))
                ->orderBy('id')
                ->get()
                ->map(fn ($row) => (array) $row)
                ->values();

            $payload['struktur'] = $this->tenantQuery('kelas_struktur', $tenantId)
                ->select($this->existingColumns('kelas_struktur', ['kelas_id', 'wali_guru_id', 'wali_guru_nama', 'ketua_siswa_id', 'ketua_siswa_nama', 'created_at', 'updated_at']))
                ->when($teacherClassIds !== null, fn ($builder) => $builder->whereIn('kelas_id', $teacherClassIds))
                ->get()
                ->map(fn ($row) => (array) $row)
                ->values();

            $payload['wali_kelas_ids'] = $teacherClassIds ?? [];
        }

        return response()->json(['data' => $payload]);
    }

    public function studentDetail(Request $request, string $id)
    {
        if (! $this->isAdmin($request) && ! $this->isGuru($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $query = $this->studentBaseQuery($tenantId);
        if (! $this->isAdmin($request)) {
            $teacherClassIds = $this->teacherClassIds($tenantId, (string) ($request->user()?->id ?? ''));
            if (empty($teacherClassIds)) {
                return $this->deny('Siswa tidak ditemukan', 404);
            }
            $query->whereIn('kelas', $teacherClassIds);
        }

        $profile = $query
            ->where('id', $id)
            ->select($this->existingColumns('profiles', [
                'id', 'email', 'nama', 'role', 'kelas', 'jk', 'usia', 'telp', 'photo_url',
                'created_at', 'nis', 'agama', 'jabatan', 'alamat', 'status',
                'alasan_nonaktif', 'disabled_at', 'tanggal_lahir', 'updated_at',
                'rfid_uid', 'kelas_change_used', 'no_hp_siswa', 'no_hp_wali',
                'deleted_at', 'photo_path', 'photo_updated_at', 'angkatan',
                'created_via', 'created_by',
            ]))
            ->first();

        if (! $profile) {
            return $this->deny('Siswa tidak ditemukan', 404);
        }

        return response()->json([
            'data' => [
                'profile' => (array) $profile,
                'class_history' => $this->studentClassHistoriesForStudents($tenantId, [$id])[$id] ?? [],
                'org_member' => $this->studentOrganizationMemberships($tenantId, $id),
                'osis' => $this->studentOsisMembership($tenantId, $id),
            ],
        ]);
    }

    public function academicSummary(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $includeStudents = filter_var($request->query('include_students', true), FILTER_VALIDATE_BOOLEAN);
        $includeSchedule = filter_var($request->query('include_schedule', false), FILTER_VALIDATE_BOOLEAN);
        $includeMapel = filter_var($request->query('include_mapel', false), FILTER_VALIDATE_BOOLEAN);
        $requestedClassId = $this->queryText($request, 'class_id');
        $studentStatus = strtolower($this->queryText($request, 'student_status'));
        $tahunAjaran = $this->queryText($request, 'tahun_ajaran');
        $semester = $this->queryText($request, 'semester');

        $settings = $this->firstTenantRow('settings', $tenantId);
        if ($tahunAjaran === '') {
            $tahunAjaran = (string) ($settings?->tahun_ajaran ?? '');
        }
        if ($semester === '') {
            $semester = (string) ($settings?->semester_aktif ?? '');
        }

        $classes = $this->tenantQuery('kelas', $tenantId)
            ->select($this->existingColumns('kelas', [
                'id', 'nama', 'grade', 'suffix', 'tingkat', 'jurusan',
                'angkatan', 'tahun_ajaran', 'semester', 'is_active',
                'created_at', 'updated_at',
            ]))
            ->orderBy(Schema::hasColumn('kelas', 'grade') ? 'grade' : 'id')
            ->when(Schema::hasColumn('kelas', 'suffix'), fn ($builder) => $builder->orderBy('suffix'))
            ->get()
            ->map(fn ($row) => (array) $row)
            ->values();

        $selectedClassId = $requestedClassId;
        if ($selectedClassId === '' || ! $classes->contains(fn ($row) => (string) ($row['id'] ?? '') === $selectedClassId)) {
            $selectedClassId = (string) ($classes->first()['id'] ?? '');
        }

        $teacherRows = DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->whereIn('role', ['guru', 'teacher'])
            ->select($this->existingColumns('profiles', ['id', 'nama', 'email', 'role', 'jabatan', 'status', 'updated_at', 'created_via', 'created_by']))
            ->orderBy('nama')
            ->limit(1000)
            ->get()
            ->map(fn ($row) => (array) $row)
            ->values();

        $selectedStructure = $selectedClassId !== '' && Schema::hasTable('kelas_struktur')
            ? $this->tenantQuery('kelas_struktur', $tenantId)
                ->select($this->existingColumns('kelas_struktur', [
                    'kelas_id', 'wali_guru_id', 'wali_guru_nama',
                    'ketua_siswa_id', 'ketua_siswa_nama', 'created_at', 'updated_at',
                ]))
                ->where('kelas_id', $selectedClassId)
                ->first()
            : null;

        $students = collect();
        if ($includeStudents && $selectedClassId !== '') {
            $studentLimit = max(1, min(1000, (int) $request->query('students_limit', 250)));
            $studentQuery = DB::table('profiles')
                ->where('tenant_id', $tenantId)
                ->where('role', 'siswa')
                ->where('kelas', $selectedClassId);

            if ($studentStatus !== '') {
                $studentQuery->whereRaw('lower(coalesce(status, \'active\')) = ?', [$studentStatus]);
            }

            $students = $studentQuery
                ->select($this->existingColumns('profiles', [
                    'id', 'nama', 'email', 'kelas', 'role', 'status', 'nis', 'angkatan',
                    'created_via', 'created_by',
                ]))
                ->orderBy('nama')
                ->limit($studentLimit)
                ->get()
                ->map(fn ($row) => (array) $row)
                ->values();

            $historiesByStudent = $this->studentClassHistoriesForStudents(
                $tenantId,
                $students->pluck('id')->filter()->map(fn ($id) => (string) $id)->all()
            );
            $students = $students
                ->map(function (array $row) use ($historiesByStudent) {
                    $studentId = (string) ($row['id'] ?? '');
                    $row['class_history'] = $historiesByStudent[$studentId] ?? [];

                    return $row;
                })
                ->values();
        }

        $schedule = collect();
        if ($includeSchedule && $selectedClassId !== '' && Schema::hasTable('jadwal')) {
            $scheduleQuery = $this->tenantQuery('jadwal', $tenantId)
                ->select($this->existingColumns('jadwal', [
                    'id', 'kelas_id', 'hari', 'mapel', 'guru_id', 'guru_nama',
                    'jam_mulai', 'jam_selesai', 'tahun_ajaran', 'semester', 'periode_berlaku',
                    'created_at', 'updated_at',
                ]))
                ->where('kelas_id', $selectedClassId);

            if ($tahunAjaran !== '' && Schema::hasColumn('jadwal', 'tahun_ajaran')) {
                $scheduleQuery->where('tahun_ajaran', $tahunAjaran);
            }
            if ($semester !== '' && Schema::hasColumn('jadwal', 'periode_berlaku')) {
                $scope = strtolower($semester);
                $scheduleQuery->where(function ($query) use ($scope) {
                    $query->whereNull('periode_berlaku')
                        ->orWhere('periode_berlaku', '')
                        ->orWhere('periode_berlaku', 'tahunan')
                        ->orWhere('periode_berlaku', $scope);
                });
            } elseif ($semester !== '' && Schema::hasColumn('jadwal', 'semester')) {
                $scheduleQuery->where(function ($query) use ($semester) {
                    $query->whereNull('semester')
                        ->orWhere('semester', '')
                        ->orWhere('semester', $semester);
                });
            }

            $schedule = $scheduleQuery
                ->orderBy('hari')
                ->orderBy('jam_mulai')
                ->get()
                ->map(fn ($row) => (array) $row)
                ->values();
        }

        $mapel = collect();
        if ($includeMapel && Schema::hasTable('mata_pelajaran')) {
            $mapel = $this->tenantQuery('mata_pelajaran', $tenantId)
                ->select($this->existingColumns('mata_pelajaran', ['id', 'nama', 'created_at', 'updated_at']))
                ->orderBy('nama')
                ->limit(1000)
                ->get()
                ->map(fn ($row) => (array) $row)
                ->values();
        }

        return response()->json([
            'data' => [
                'settings' => $settings ? (array) $settings : null,
                'guru' => $teacherRows,
                'kelas' => $classes,
                'selected_class_id' => $selectedClassId,
                'selected_structure' => $selectedStructure ? (array) $selectedStructure : null,
                'selected_students' => $students,
                'schedule' => $schedule,
                'mapel' => $mapel,
                'statistics' => [
                    'teachers' => $teacherRows->count(),
                    'classes' => $classes->count(),
                    'selected_students' => $students->count(),
                    'schedule_rows' => $schedule->count(),
                    'mapel' => $mapel->count(),
                ],
                'generated_at' => now()->toISOString(),
            ],
        ]);
    }

    public function applyAcademicPeriod(Request $request)
    {
        if ($this->isAdmin($request) === false) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if ($tenantId === null || $tenantId === '') {
            return $this->deny('Tenant tidak valid', 400);
        }

        $payload = $request->all();
        $tahunAjaran = AcademicPeriod::normalizeAcademicYear($payload['tahun_ajaran'] ?? null);
        $semester = AcademicPeriod::normalizeSemester($payload['semester_aktif'] ?? null);
        if ($tahunAjaran === null || $semester === null) {
            return $this->deny('Tahun ajaran atau semester belum valid.', 422);
        }

        $ganjilStart = AcademicPeriod::normalizeDate($payload['periode_ganjil_mulai'] ?? null);
        $ganjilEnd = AcademicPeriod::normalizeDate($payload['periode_ganjil_selesai'] ?? null);
        $genapStart = AcademicPeriod::normalizeDate($payload['periode_genap_mulai'] ?? null);
        $genapEnd = AcademicPeriod::normalizeDate($payload['periode_genap_selesai'] ?? null);
        $activeStart = AcademicPeriod::normalizeDate($payload['periode_mulai'] ?? null);
        $activeEnd = AcademicPeriod::normalizeDate($payload['periode_selesai'] ?? null);

        if ($semester === AcademicPeriod::SEMESTER_GANJIL) {
            $ganjilStart = $ganjilStart ?: $activeStart;
            $ganjilEnd = $ganjilEnd ?: $activeEnd;
        } else {
            $genapStart = $genapStart ?: $activeStart;
            $genapEnd = $genapEnd ?: $activeEnd;
        }

        $ganjilPeriod = AcademicPeriod::make(
            $tahunAjaran,
            AcademicPeriod::SEMESTER_GANJIL,
            $ganjilStart,
            $ganjilEnd
        );
        $genapPeriod = AcademicPeriod::make(
            $tahunAjaran,
            AcademicPeriod::SEMESTER_GENAP,
            $genapStart,
            $genapEnd
        );
        if (empty($ganjilPeriod['custom_range'])) {
            return $this->deny('Rentang bulan semester Ganjil belum valid.', 422);
        }
        if (empty($genapPeriod['custom_range'])) {
            return $this->deny('Rentang bulan semester Genap belum valid.', 422);
        }

        $activePeriod = $semester === AcademicPeriod::SEMESTER_GENAP ? $genapPeriod : $ganjilPeriod;
        $settingsPayload = [
            'tahun_ajaran' => $tahunAjaran,
            'semester_aktif' => $semester,
            'periode_mulai' => $activePeriod['starts_at'],
            'periode_selesai' => $activePeriod['ends_at'],
            'periode_ganjil_mulai' => $ganjilPeriod['starts_at'],
            'periode_ganjil_selesai' => $ganjilPeriod['ends_at'],
            'periode_genap_mulai' => $genapPeriod['starts_at'],
            'periode_genap_selesai' => $genapPeriod['ends_at'],
        ];

        $existing = $this->firstTenantRow('settings', $tenantId);
        $previousYear = AcademicPeriod::normalizeAcademicYear($existing->tahun_ajaran ?? null)
            ?: AcademicPeriod::current()['tahun_ajaran'];
        $previousSemester = AcademicPeriod::normalizeSemester($existing->semester_aktif ?? null)
            ?: AcademicPeriod::current()['semester'];
        $yearChanged = $previousYear !== $tahunAjaran;
        $autoRollover = filter_var($payload['auto_rollover'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $manualRolloverCompleted = filter_var($payload['manual_rollover_completed'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $carryEskulMembers = filter_var($payload['carry_eskul_members'] ?? false, FILTER_VALIDATE_BOOLEAN);

        $previousStartYear = (int) substr($previousYear, 0, 4);
        $targetStartYear = (int) substr($tahunAjaran, 0, 4);
        $semesterOnlyChange = $yearChanged === false && $previousSemester !== $semester;
        $serverNow = Carbon::now('Asia/Jakarta');
        $calendarPeriod = AcademicPeriod::current($serverNow);
        $calendarStartYear = (int) substr((string) $calendarPeriod['tahun_ajaran'], 0, 4);
        $calendarConfirmed = filter_var($payload['calendar_confirmed'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $isCalendarCorrection = $yearChanged
            && $previousStartYear > $calendarStartYear
            && $targetStartYear === $calendarStartYear;
        $requiresRollover = $yearChanged && $isCalendarCorrection === false && $manualRolloverCompleted === false;
        $targetMatchesServerCalendar = $tahunAjaran === $calendarPeriod['tahun_ajaran']
            && $semester === $calendarPeriod['semester'];

        if ($targetStartYear < $calendarStartYear) {
            return $this->deny(
                'Periode lama tidak boleh dijadikan periode aktif. Gunakan filter Mode Arsip untuk melihat data '.$tahunAjaran.'.',
                422
            );
        }

        if ($targetStartYear > $calendarStartYear + 1) {
            return $this->deny('Periode aktif tidak boleh melompat lebih dari satu tahun ajaran dari kalender server.', 422);
        }

        if (($isCalendarCorrection || $targetMatchesServerCalendar === false) && $calendarConfirmed === false) {
            return $this->academicPeriodConfirmationRequired(
                $isCalendarCorrection
                    ? 'Periode aktif tersimpan berada di masa depan. Konfirmasi untuk mengoreksi kalender aktif tanpa membalik otomatis riwayat siswa.'
                    : 'Periode yang dipilih tidak sama dengan kalender server saat ini. Konfirmasi ulang sebelum dipakai sebagai periode operasional.',
                $calendarPeriod,
                $serverNow,
                [
                    'tahun_ajaran' => $previousYear,
                    'semester' => $previousSemester,
                ],
                [
                    'tahun_ajaran' => $tahunAjaran,
                    'semester' => $semester,
                ]
            );
        }

        if ($yearChanged && $isCalendarCorrection === false && $targetStartYear !== $previousStartYear + 1) {
            return $this->deny('Rollover akademik hanya bisa maju tepat satu tahun ajaran.', 422);
        }

        if ($requiresRollover && $autoRollover === false) {
            return $this->deny('Perubahan tahun ajaran harus dijalankan melalui rollover akademik atau Kenaikan Kelas manual.', 409);
        }

        if ($requiresRollover && $targetStartYear !== $previousStartYear + 1) {
            return $this->deny('Rollover otomatis hanya bisa maju tepat satu tahun ajaran.', 422);
        }

        try {
            $result = DB::transaction(function () use (
                $tenantId,
                $existing,
                $settingsPayload,
                $activePeriod,
                $previousYear,
                $previousSemester,
                $yearChanged,
                $semesterOnlyChange,
                $requiresRollover,
                $isCalendarCorrection,
                $manualRolloverCompleted,
                $calendarPeriod,
                $serverNow,
                $carryEskulMembers
            ) {
                $rollover = null;
                $classesSynced = 0;
                $classHistorySnapshots = 0;

                if ($requiresRollover) {
                    $rollover = $this->rolloverAcademicYearData(
                        $tenantId,
                        $activePeriod,
                        $previousYear,
                        $previousSemester,
                        $carryEskulMembers
                    );
                    $classesSynced = (int) ($rollover['classes_synced'] ?? 0);
                } elseif ($yearChanged || $isCalendarCorrection || $manualRolloverCompleted) {
                    $classesSynced = $this->syncClassPeriodMetadata($tenantId, $activePeriod);
                }

                $settings = $this->saveAcademicPeriodSettings($tenantId, $existing, $settingsPayload);
                if ($classesSynced > 0 || $requiresRollover || $yearChanged || $manualRolloverCompleted) {
                    $classHistorySnapshots = $this->snapshotStudentClassHistoriesForPeriod(
                        $tenantId,
                        $activePeriod,
                        $requiresRollover
                            ? 'auto_rollover'
                            : ($manualRolloverCompleted ? 'manual_rollover_completed' : 'period_sync')
                    );
                }

                return [
                    'settings' => $settings ? (array) $settings : null,
                    'period' => [
                        'tahun_ajaran' => $activePeriod['tahun_ajaran'],
                        'semester' => $activePeriod['semester'],
                        'starts_at' => $activePeriod['starts_at'],
                        'ends_at' => $activePeriod['ends_at'],
                    ],
                    'year_changed' => $yearChanged,
                    'semester_only_change' => $semesterOnlyChange,
                    'calendar_correction' => $isCalendarCorrection,
                    'manual_rollover_completed' => $manualRolloverCompleted,
                    'class_history_snapshots' => $classHistorySnapshots,
                    'server_calendar' => [
                        'today' => $serverNow->toDateString(),
                        'timezone' => 'Asia/Jakarta',
                        'tahun_ajaran' => $calendarPeriod['tahun_ajaran'],
                        'semester' => $calendarPeriod['semester'],
                    ],
                    'classes_synced' => $classesSynced,
                    'rollover' => $rollover,
                ];
            });
        } catch (\RuntimeException $e) {
            return $this->deny($e->getMessage(), 422);
        }

        return response()->json(['data' => $result]);
    }

    private function academicPeriodConfirmationRequired(
        string $message,
        array $serverPeriod,
        Carbon $serverNow,
        array $previousPeriod,
        array $targetPeriod
    ) {
        return response()->json([
            'error' => $message,
            'code' => 'academic_period_calendar_confirmation_required',
            'data' => [
                'server_calendar' => [
                    'today' => $serverNow->toDateString(),
                    'timezone' => 'Asia/Jakarta',
                    'tahun_ajaran' => $serverPeriod['tahun_ajaran'] ?? null,
                    'semester' => $serverPeriod['semester'] ?? null,
                    'label' => ($serverPeriod['tahun_ajaran'] ?? '-').' - Semester '.($serverPeriod['semester'] ?? '-'),
                ],
                'previous_period' => $previousPeriod,
                'target_period' => $targetPeriod,
            ],
        ], 409);
    }

    public function studentOptions(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $allRows = filter_var($request->query('all', false), FILTER_VALIDATE_BOOLEAN);
        $perPage = $allRows
            ? max(1, min(10000, (int) $request->query('per_page', 10000)))
            : max(1, min(100, (int) $request->query('per_page', 50)));
        $search = strtolower($this->queryText($request, 'q'));
        $kelas = $this->queryText($request, 'kelas');
        $status = strtolower($this->queryText($request, 'status') ?: 'active');

        $query = DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa');

        if ($status !== '') {
            $query->whereRaw('lower(coalesce(status, \'active\')) = ?', [$status]);
        }
        if ($kelas !== '') {
            $query->where('kelas', $kelas);
        }
        if ($search !== '') {
            $like = '%'.$search.'%';
            $query->where(function ($builder) use ($like) {
                $builder->whereRaw('lower(coalesce(nama, \'\')) like ?', [$like])
                    ->orWhereRaw('lower(coalesce(email, \'\')) like ?', [$like])
                    ->orWhereRaw('lower(coalesce(nis, \'\')) like ?', [$like])
                    ->orWhereRaw('lower(coalesce(kelas, \'\')) like ?', [$like]);
            });
        }

        $rows = $query
            ->select($this->existingColumns('profiles', ['id', 'nama', 'email', 'kelas', 'nis', 'status', 'angkatan', 'created_via', 'created_by']))
            ->orderBy('kelas')
            ->orderBy('nama')
            ->limit($perPage + 1)
            ->get()
            ->map(fn ($row) => (array) $row)
            ->values();

        $hasMore = $rows->count() > $perPage;

        return response()->json([
            'data' => [
                'rows' => $rows->take($perPage)->values(),
                'meta' => [
                    'per_page' => $perPage,
                    'has_more' => $hasMore,
                    'all' => $allRows,
                ],
            ],
        ]);
    }

    public function teachers(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $page = max(1, (int) $request->query('page', 1));
        $allRows = filter_var($request->query('all', false), FILTER_VALIDATE_BOOLEAN);
        $perPage = $allRows ? min(10000, max(1, (int) $request->query('per_page', 10000))) : $this->perPage($request);

        $presenceAgg = $this->presenceAggregateQuery($tenantId);
        $teacherColumns = $this->prefixedExistingColumns('profiles', [
            'id', 'email', 'nama', 'role', 'kelas', 'jk', 'usia', 'telp', 'photo_url',
            'created_at', 'nis', 'agama', 'jabatan', 'alamat', 'status',
            'alasan_nonaktif', 'disabled_at', 'tanggal_lahir', 'updated_at',
            'photo_path', 'photo_updated_at', 'created_via', 'created_by',
        ]);
        $baseTeachers = DB::table('profiles')
            ->leftJoinSub($presenceAgg, 'pr', 'profiles.id', '=', 'pr.user_id')
            ->where('profiles.tenant_id', $tenantId)
            ->where('profiles.role', 'guru')
            ->select($teacherColumns)
            ->selectRaw('pr.last_seen_at as last_seen_at')
            ->selectRaw('coalesce(pr.active_devices, 0) as active_devices')
            ->selectRaw('coalesce(pr.activity_count, 0) as activity_count')
            ->selectRaw('case when coalesce(pr.active_devices, 0) > 0 then 1 else 0 end as online')
            ->orderByRaw('case when coalesce(pr.active_devices, 0) > 0 then 0 else 1 end')
            ->orderByRaw('case when pr.last_seen_at is null then 1 else 0 end')
            ->orderByDesc('pr.last_seen_at')
            ->orderBy('profiles.nama')
            ->get()
            ->map(fn ($row) => (array) $row);

        $teacherIds = $baseTeachers->pluck('id')->filter()->values()->all();
        $jadwalRows = empty($teacherIds)
            ? collect()
            : $this->tenantQuery('jadwal', $tenantId)
                ->select($this->existingColumns('jadwal', ['id', 'kelas_id', 'hari', 'mapel', 'guru_id', 'guru_nama', 'jam_mulai', 'jam_selesai', 'created_at', 'updated_at']))
                ->whereIn('guru_id', $teacherIds)
                ->get();
        $waliRows = empty($teacherIds)
            ? collect()
            : $this->tenantQuery('kelas_struktur', $tenantId)
                ->select($this->existingColumns('kelas_struktur', ['kelas_id', 'wali_guru_id', 'wali_guru_nama']))
                ->whereIn('wali_guru_id', $teacherIds)
                ->get();
        $strukturRows = empty($teacherIds)
            ? collect()
            : $this->tenantQuery('struktur_sekolah', $tenantId)
                ->select($this->existingColumns('struktur_sekolah', ['id', 'jabatan', 'guru_id', 'guru_nama']))
                ->whereIn('guru_id', $teacherIds)
                ->get();

        $jadwalByTeacher = $jadwalRows->groupBy('guru_id');
        $waliByTeacher = $waliRows->groupBy('wali_guru_id');
        $strukturByTeacher = $strukturRows->groupBy('guru_id');
        $allMapel = [];
        $allJabatan = [];

        $teachers = $baseTeachers->map(function (array $teacher) use ($jadwalByTeacher, $waliByTeacher, $strukturByTeacher, &$allMapel, &$allJabatan) {
            $teacherId = (string) ($teacher['id'] ?? '');
            $mapel = $jadwalByTeacher->get($teacherId, collect())
                ->pluck('mapel')
                ->filter()
                ->unique()
                ->values()
                ->all();
            $kelas = $jadwalByTeacher->get($teacherId, collect())
                ->pluck('kelas_id')
                ->merge($waliByTeacher->get($teacherId, collect())->pluck('kelas_id'))
                ->filter()
                ->unique()
                ->values()
                ->all();
            $jabatan = [];
            if (! empty($teacher['jabatan'])) {
                $jabatan[] = (string) $teacher['jabatan'];
            }
            $jabatan = collect($jabatan)
                ->merge($strukturByTeacher->get($teacherId, collect())->pluck('jabatan'))
                ->filter()
                ->unique()
                ->values()
                ->all();

            $allMapel = array_merge($allMapel, $mapel);
            $allJabatan = array_merge($allJabatan, $jabatan);

            $teacher['mapelList'] = $mapel;
            $teacher['kelasList'] = $kelas;
            $teacher['jabatanList'] = $jabatan;
            $teacher['jabatanUtama'] = $jabatan[0] ?? ($teacher['jabatan'] ?? '-');

            return $teacher;
        })->values();

        $filtered = $this->sortRowsByPresence($this->filterTeacherRows($teachers, $request))->values();
        $total = $filtered->count();
        $rows = $allRows
            ? $filtered->take($perPage)->values()
            : $filtered->slice(($page - 1) * $perPage, $perPage)->values();

        $statusCounts = $teachers->groupBy(fn ($row) => strtolower(trim((string) ($row['status'] ?? 'active'))) ?: 'active')
            ->map(fn ($items) => $items->count());

        return response()->json([
            'data' => [
                'rows' => $rows,
                'meta' => $this->paginationMeta($page, $perPage, $total, $allRows),
                'stats' => [
                    'totalGuru' => $teachers->count(),
                    'aktifGuru' => (int) ($statusCounts['active'] ?? 0),
                    'nonaktifGuru' => (int) ($statusCounts['nonaktif'] ?? 0),
                    'mutasiGuru' => (int) ($statusCounts['mutasi'] ?? 0),
                    'inactiveGuru' => max(0, $teachers->count() - (int) ($statusCounts['active'] ?? 0)),
                    'mapelCount' => count(array_unique(array_filter($allMapel))),
                    'jabatanCount' => count(array_unique(array_filter($allJabatan))),
                ],
                'filter_options' => [
                    'mapel' => array_values(array_unique(array_filter($allMapel))),
                    'jabatan' => array_values(array_unique(array_filter($allJabatan))),
                ],
            ],
        ]);
    }

    public function certificates(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $page = max(1, (int) $request->query('page', 1));
        $perPage = $this->perPage($request, 50);

        $query = DB::table('certificates as c')
            ->leftJoin('profiles as p', 'c.user_id', '=', 'p.id');
        if (Schema::hasColumn('certificates', 'tenant_id')) {
            $query->where('c.tenant_id', $tenantId);
        } else {
            $query->where(function ($builder) use ($tenantId) {
                $builder->where('p.tenant_id', $tenantId)
                    ->orWhereNull('c.user_id');
            });
        }

        $search = $this->queryText($request, 'q');
        if ($search !== '') {
            $like = '%'.strtolower($search).'%';
            $query->where(function ($builder) use ($like) {
                $builder->whereRaw('lower(c.nama_penerima) like ?', [$like])
                    ->orWhereRaw('lower(c.email) like ?', [$like])
                    ->orWhereRaw('lower(c.event) like ?', [$like])
                    ->orWhereRaw('lower(coalesce(c.kelas, p.kelas, \'\')) like ?', [$like]);
            });
        }
        $kelas = $this->queryText($request, 'kelas');
        if ($kelas !== '') {
            $query->where(function ($builder) use ($kelas) {
                $builder->where('c.kelas', $kelas)->orWhere('p.kelas', $kelas);
            });
        }
        $sent = $this->queryText($request, 'sent');
        if ($sent !== '') {
            $query->where('c.sent', filter_var($sent, FILTER_VALIDATE_BOOLEAN));
        }

        $total = (clone $query)->count('c.id');
        $rows = $query
            ->select([
                'c.*',
                'p.nama as profile_nama',
                'p.kelas as profile_kelas',
                'p.email as profile_email',
            ])
            ->orderByDesc('c.issued_at')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get()
            ->map(fn ($row) => (array) $row)
            ->values();

        return response()->json([
            'data' => [
                'rows' => $rows,
                'meta' => $this->paginationMeta($page, $perPage, $total),
            ],
        ]);
    }

    public function scanSessionSummary(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $date = $this->queryText($request, 'date') ?: now('Asia/Jakarta')->toDateString();
        $dayName = $this->indonesianDayName(Carbon::parse($date, 'Asia/Jakarta'));

        $settings = $this->firstTenantRow('settings', $tenantId);
        $classes = $this->tenantQuery('kelas', $tenantId)
            ->select($this->existingColumns('kelas', ['id', 'nama', 'tingkat', 'jurusan', 'angkatan']))
            ->orderBy('id')
            ->get();

        $todaySchedule = $this->tenantQuery('jadwal', $tenantId)
            ->select($this->existingColumns('jadwal', ['id', 'kelas_id', 'hari', 'mapel', 'guru_id', 'guru_nama', 'jam_mulai', 'jam_selesai']))
            ->whereRaw('lower(hari) = ?', [strtolower($dayName)])
            ->orderBy('kelas_id')
            ->orderBy('jam_mulai')
            ->get();

        $studentCountByClass = DB::table('profiles')
            ->select('kelas', DB::raw('count(*) as aggregate'))
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa')
            ->groupBy('kelas')
            ->pluck('aggregate', 'kelas');
        $scheduleCountByClass = $todaySchedule->groupBy('kelas_id')->map(fn ($rows) => $rows->count());

        $recentScans = Schema::hasTable('absensi_scan_temp')
            ? $this->tenantQuery('absensi_scan_temp', $tenantId, 't')
                ->leftJoin('profiles as p', function ($join) use ($tenantId) {
                    $join->on('p.id', '=', 't.siswa_id')
                        ->where('p.tenant_id', '=', $tenantId);
                })
                ->select([
                    't.id',
                    't.tanggal',
                    't.siswa_id',
                    't.kelas',
                    't.sesi',
                    't.scan_at',
                    't.source',
                    't.card_uid',
                    't.mapel_count',
                    't.created_at',
                    'p.nama as siswa_nama',
                    'p.nis as siswa_nis',
                    'p.photo_url as siswa_photo_url',
                    'p.rfid_uid as siswa_rfid_uid',
                ])
                ->where('t.tanggal', $date)
                ->orderByDesc('t.scan_at')
                ->limit(50)
                ->get()
            : collect();
        $scannedCountByClass = $recentScans
            ->groupBy('kelas')
            ->map(fn ($rows) => $rows->pluck('siswa_id')->unique()->count());

        $classes = $classes->map(function ($row) use ($studentCountByClass, $scheduleCountByClass, $scannedCountByClass) {
            $item = (array) $row;
            $classId = (string) ($item['id'] ?? '');
            $item['total_siswa'] = (int) ($studentCountByClass[$classId] ?? 0);
            $item['total_mapel'] = (int) ($scheduleCountByClass[$classId] ?? 0);
            $item['scanned_count'] = (int) ($scannedCountByClass[$classId] ?? 0);

            return $item;
        })->values();

        $studentsWithRfid = DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa')
            ->whereNotNull('rfid_uid')
            ->where('rfid_uid', '<>', '')
            ->count('id');

        return response()->json([
            'data' => [
                'settings' => $settings ? (array) $settings : null,
                'date' => $date,
                'day' => $dayName,
                'classes' => $classes,
                'today_schedule' => $todaySchedule,
                'recent_scans' => $recentScans,
                'statistics' => [
                    'classes' => $classes->count(),
                    'schedule_rows' => $todaySchedule->count(),
                    'recent_scans' => $recentScans->count(),
                    'students_with_rfid' => (int) $studentsWithRfid,
                ],
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

        return $this->deny(
            'Hapus permanen akun guru/siswa sudah dinonaktifkan. Gunakan Mutasi atau Nonaktif agar data tetap aman.',
            409
        );
    }

    public function updateUserStatus(Request $request, string $id)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $validator = Validator::make($request->all(), [
            'status' => ['required', 'string', 'in:active,nonaktif,mutasi,alumni'],
            'reason' => ['nullable', 'string', 'max:1000'],
            'role' => ['nullable', 'string', 'in:siswa,guru,teacher'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $profile = DB::table('profiles')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();
        if (! $profile) {
            return $this->deny('User tidak ditemukan', 404);
        }

        $role = strtolower((string) ($profile->role ?? ''));
        $normalizedRole = $role === 'teacher' ? 'guru' : $role;
        if (! in_array($normalizedRole, ['guru', 'siswa'], true)) {
            return $this->deny('Status hanya bisa diubah untuk guru atau siswa', 409);
        }

        $expectedRole = strtolower(trim((string) $request->input('role', '')));
        $expectedRole = $expectedRole === 'teacher' ? 'guru' : $expectedRole;
        if ($expectedRole !== '' && $expectedRole !== $normalizedRole) {
            return $this->deny('Role user tidak sesuai dengan data yang dikirim', 409);
        }

        $status = strtolower(trim((string) $request->input('status')));
        if ($normalizedRole === 'guru' && $status === 'alumni') {
            return $this->deny('Status alumni hanya tersedia untuk siswa', 422);
        }

        $reason = preg_replace('/\s+/', ' ', trim((string) $request->input('reason', ''))) ?? '';
        if (in_array($status, ['nonaktif', 'mutasi', 'alumni'], true) && $reason === '') {
            return $this->deny('Alasan wajib diisi', 422);
        }

        $now = now();
        $oldData = (array) $profile;
        $profilePayload = [
            'status' => $status,
            'updated_at' => $now,
        ];

        if ($status === 'active') {
            $profilePayload['alasan_nonaktif'] = null;
            $profilePayload['disabled_at'] = null;
        } else {
            $profilePayload['alasan_nonaktif'] = $reason;
            $profilePayload['disabled_at'] = $now;
        }

        if ($normalizedRole === 'siswa' && in_array($status, ['mutasi', 'alumni'], true)) {
            if (Schema::hasColumn('profiles', 'rfid_uid')) {
                $profilePayload['rfid_uid'] = null;
            }
            if (Schema::hasColumn('profiles', 'kelas')) {
                $profilePayload['kelas'] = '';
            }
        }

        $syncedAssignments = [];
        DB::transaction(function () use (
            $id,
            $tenantId,
            $normalizedRole,
            $status,
            $profilePayload,
            $now,
            &$syncedAssignments
        ) {
            DB::table('profiles')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->update($profilePayload);

            if (Schema::hasColumn('users', 'updated_at')) {
                DB::table('users')
                    ->where('id', $id)
                    ->update(['updated_at' => $now]);
            }

            if (in_array($status, ['mutasi', 'alumni'], true)) {
                $syncedAssignments = $normalizedRole === 'guru'
                    ? $this->clearTeacherActiveAssignments($tenantId, $id, $now)
                    : $this->clearStudentActiveAssignments($tenantId, $id, $now);
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
            [
                'id' => $id,
                'tenant_id' => $tenantId,
                'role' => $role,
                'status' => $oldData['status'] ?? null,
                'alasan_nonaktif' => $oldData['alasan_nonaktif'] ?? null,
                'disabled_at' => $oldData['disabled_at'] ?? null,
                'kelas' => $oldData['kelas'] ?? null,
                'rfid_uid' => $oldData['rfid_uid'] ?? null,
            ],
            [
                'id' => $id,
                'tenant_id' => $tenantId,
                'role' => $normalizedRole,
                'status' => $fresh?->status,
                'alasan_nonaktif' => $fresh?->alasan_nonaktif,
                'disabled_at' => $fresh?->disabled_at,
                'kelas' => $fresh?->kelas,
                'rfid_uid' => $fresh?->rfid_uid,
                'synced_assignments' => $syncedAssignments,
            ],
            $tenantId
        );

        return response()->json([
            'data' => [
                'profile' => $fresh,
                'synced_assignments' => $syncedAssignments,
            ],
        ]);
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

    public function updateTeacherProfile(Request $request, string $id)
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
            'nis' => ['nullable', 'string', 'max:64'],
            'jk' => ['nullable', 'string', 'max:20'],
            'agama' => ['nullable', 'string', 'max:50'],
            'telp' => ['nullable', 'string', 'max:32'],
            'alamat' => ['nullable', 'string', 'max:1000'],
            'tanggal_lahir' => ['nullable', 'date'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
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
            return $this->deny('Hanya profil guru yang bisa diubah dari form ini.', 409);
        }

        $validated = $validator->validated();
        $data = [];
        foreach (['nama', 'nis', 'jk', 'agama', 'telp', 'alamat', 'tanggal_lahir'] as $key) {
            if (! array_key_exists($key, $validated) || ! Schema::hasColumn('profiles', $key)) {
                continue;
            }

            $value = $validated[$key];
            if (is_string($value)) {
                $value = preg_replace('/\s+/', ' ', trim($value)) ?? '';
            }

            if ($key === 'nis') {
                $value = $this->normalizeIdentifierCode($value);
            }
            if ($key === 'jk' && $value !== '') {
                $gender = strtoupper((string) $value);
                $value = in_array($gender, ['L', 'P'], true) ? $gender : $value;
            }

            $data[$key] = $value === '' ? null : $value;
        }

        $newName = (string) ($data['nama'] ?? '');
        if ($newName === '') {
            return $this->deny('Nama guru wajib diisi.', 422);
        }

        $oldProfile = (array) $profile;
        $now = now();
        $syncedSnapshots = [
            'jadwal' => 0,
            'kelas_struktur' => 0,
            'struktur_sekolah' => 0,
            'organisasi' => 0,
            'absensi_ajuan' => 0,
        ];

        DB::transaction(function () use ($id, $tenantId, $data, $newName, $profile, $now, &$syncedSnapshots) {
            DB::table('profiles')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->update(array_merge($data, ['updated_at' => $now]));

            if ((string) ($profile->nama ?? '') !== $newName) {
                DB::table('users')
                    ->where('id', $id)
                    ->update([
                        'name' => $newName,
                        'updated_at' => $now,
                    ]);

                $syncedSnapshots = $this->syncTeacherDisplayNameSnapshots($tenantId, $id, $newName, $now);
            }
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
                'email' => $oldProfile['email'] ?? null,
                'nama' => $oldProfile['nama'] ?? null,
                'nis' => $oldProfile['nis'] ?? null,
                'jk' => $oldProfile['jk'] ?? null,
                'agama' => $oldProfile['agama'] ?? null,
                'telp' => $oldProfile['telp'] ?? null,
                'alamat' => $oldProfile['alamat'] ?? null,
                'tanggal_lahir' => $oldProfile['tanggal_lahir'] ?? null,
            ],
            [
                'id' => $id,
                'tenant_id' => $tenantId,
                'role' => $role,
                'email' => $fresh?->email,
                'nama' => $fresh?->nama,
                'nis' => $fresh?->nis,
                'jk' => $fresh?->jk,
                'agama' => $fresh?->agama,
                'telp' => $fresh?->telp,
                'alamat' => $fresh?->alamat,
                'tanggal_lahir' => $fresh?->tanggal_lahir,
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
            'tanggal_lahir' => ['sometimes', 'nullable', 'date'],
            'agama' => ['sometimes', 'nullable', 'string', 'max:50'],
            'alamat' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $allowedKeys = ['nama', 'jk', 'tanggal_lahir', 'agama', 'alamat'];
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

            if (array_key_exists('tanggal_lahir', $data)) {
                $this->syncImportedInitialStudentPassword($tenantId, $id, $now);
            }

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

    private function clearStudentActiveAssignments(string $tenantId, string $studentId, Carbon $now): array
    {
        return [
            'kelas_struktur' => $this->updateTenantSnapshotTable(
                'kelas_struktur',
                ['ketua_siswa_id' => $studentId],
                [
                    'ketua_siswa_id' => null,
                    'ketua_siswa_nama' => null,
                    'updated_at' => $now,
                ],
                $tenantId
            ),
        ];
    }

    private function clearTeacherActiveAssignments(string $tenantId, string $teacherId, Carbon $now): array
    {
        return [
            'jadwal' => $this->updateTenantSnapshotTable(
                'jadwal',
                ['guru_id' => $teacherId],
                [
                    'guru_id' => null,
                    'guru_nama' => null,
                    'updated_at' => $now,
                ],
                $tenantId
            ),
            'kelas_struktur' => $this->updateTenantSnapshotTable(
                'kelas_struktur',
                ['wali_guru_id' => $teacherId],
                [
                    'wali_guru_id' => null,
                    'wali_guru_nama' => null,
                    'updated_at' => $now,
                ],
                $tenantId
            ),
            'struktur_sekolah' => $this->updateTenantSnapshotTable(
                'struktur_sekolah',
                ['guru_id' => $teacherId],
                [
                    'guru_id' => null,
                    'guru_nama' => null,
                    'updated_at' => $now,
                ],
                $tenantId
            ),
            'organisasi' => $this->updateTenantSnapshotTable(
                'organisasi',
                ['pembina_guru_id' => $teacherId],
                [
                    'pembina_guru_id' => null,
                    'pembina_guru_nama' => null,
                    'updated_at' => $now,
                ],
                $tenantId
            ),
            'ekskul' => $this->updateTenantSnapshotTable(
                'ekskul',
                ['pembina_guru_id' => $teacherId],
                [
                    'pembina_guru_id' => null,
                    'updated_at' => $now,
                ],
                $tenantId
            ),
        ];
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

    private function normalizeIdentifierCode(mixed $value): string
    {
        $normalized = preg_replace('/\s+/', '', trim((string) ($value ?? '')));

        return strtoupper((string) $normalized);
    }

    private function normalizeProfileCreatedVia(mixed $value, string $default): string
    {
        $normalized = strtolower(trim((string) ($value ?? '')));
        $normalized = str_replace(['-', ' '], '_', $normalized);

        return match ($normalized) {
            'import', 'file', 'excel', 'spreadsheet', 'sheet', 'google_sheet', 'google_sheets' => 'import',
            'manual', 'manual_registration', 'pendaftaran_manual', 'registrasi_manual' => 'manual_registration',
            'admin', 'admin_created', 'created_by_admin', 'buatan_admin' => 'admin_created',
            default => $default,
        };
    }

    private function syncImportedInitialStudentPassword(string $tenantId, string $studentId, mixed $timestamp = null): bool
    {
        return $this->syncImportedInitialProfilePassword($tenantId, $studentId, $timestamp);
    }

    private function syncImportedInitialProfilePassword(string $tenantId, string $profileId, mixed $timestamp = null): bool
    {
        $profile = Profile::query()
            ->where('id', $profileId)
            ->where('tenant_id', $tenantId)
            ->whereIn('role', ['siswa', 'guru', 'teacher'])
            ->first();

        if (! $profile || ! $this->isImportedInitialProfileAccount($profile)) {
            return false;
        }

        $seed = $this->buildBirthDatePasswordSeed($profile->tanggal_lahir);
        if ($seed === '') {
            $nis = trim((string) ($profile->nis ?? ''));
            $digits = preg_replace('/\D+/', '', $nis) ?? '';
            $seed = $digits !== '' ? $digits : $nis;
        }
        if ($seed === '') {
            return false;
        }

        DB::table('users')
            ->where('id', $profileId)
            ->update([
                'password' => Hash::make($this->normalizeProvisionPassword($seed)),
                'updated_at' => $timestamp ?: now(),
            ]);

        return true;
    }

    private function isImportedInitialStudentAccount(Profile $profile): bool
    {
        return $this->isImportedInitialProfileAccount($profile);
    }

    private function isImportedInitialProfileAccount(Profile $profile): bool
    {
        if (! in_array(strtolower(trim((string) ($profile->role ?? ''))), ['siswa', 'guru', 'teacher'], true)) {
            return false;
        }
        if (! (bool) ($profile->must_change_password ?? false)) {
            return false;
        }

        $createdVia = $this->normalizeProfileCreatedVia($profile->created_via ?? null, '');
        $email = strtolower(trim((string) ($profile->email ?? '')));

        return $createdVia === 'import' || Str::endsWith($email, '@import.local');
    }

    private function buildBirthDatePasswordSeed(mixed $tanggalLahir): string
    {
        if (! $tanggalLahir) {
            return '';
        }

        try {
            $date = date_create((string) $tanggalLahir);
            if (! $date) {
                return '';
            }

            return $date->format('dmY');
        } catch (\Throwable $e) {
            return '';
        }
    }

    private function normalizeProvisionPassword(string $password): string
    {
        $raw = trim($password);
        if ($this->looksLikeStrongProvisionPassword($raw)) {
            return $raw;
        }

        $digits = preg_replace('/\D+/', '', $raw) ?? '';
        $digits = $digits !== '' ? $digits : '123456';
        if (strlen($digits) < 6) {
            $digits = str_pad($digits, 6, '0');
        }

        $generated = 'Aa'.$digits.'!Edu';
        while (strlen($generated) < $this->provisionPasswordMinLength()) {
            $generated .= '9';
        }

        return $generated;
    }

    private function looksLikeStrongProvisionPassword(string $password): bool
    {
        if (strlen($password) < $this->provisionPasswordMinLength()) {
            return false;
        }

        return preg_match('/[a-z]/', $password)
            && preg_match('/[A-Z]/', $password)
            && preg_match('/\d/', $password)
            && preg_match('/[^a-zA-Z0-9]/', $password);
    }

    private function provisionPasswordMinLength(): int
    {
        return max(12, (int) env('PASSWORD_MIN_LENGTH', 12));
    }

    private function temporaryStrongPassword(): string
    {
        return $this->normalizeProvisionPassword(Str::random(24).'9!');
    }

    private function resolveCohortForClass(string $tenantId, mixed $classId): ?string
    {
        $normalizedClassId = trim((string) ($classId ?? ''));
        if ($normalizedClassId === '' || ! Schema::hasTable('kelas') || ! Schema::hasColumn('kelas', 'angkatan')) {
            return null;
        }

        $query = DB::table('kelas')->where(function ($inner) use ($normalizedClassId) {
            $inner->where('id', $normalizedClassId);
            if (Schema::hasColumn('kelas', 'nama')) {
                $inner->orWhere('nama', $normalizedClassId);
            }
        });
        if (Schema::hasColumn('kelas', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        $cohort = trim((string) ($query->orderBy('id')->value('angkatan') ?? ''));

        return $cohort !== '' ? $cohort : null;
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

    private function saveAcademicPeriodSettings(string $tenantId, ?object $existing, array $payload): ?object
    {
        if (Schema::hasTable('settings') === false) {
            throw new \RuntimeException('Tabel settings belum tersedia.');
        }

        $update = $this->filterExistingPayload('settings', $payload);
        if (Schema::hasColumn('settings', 'updated_at')) {
            $update['updated_at'] = now();
        }

        if ($existing) {
            $query = DB::table('settings')->where('id', $existing->id);
            if (Schema::hasColumn('settings', 'tenant_id')) {
                $query->where('tenant_id', $tenantId);
            }
            $query->update($update);

            $select = DB::table('settings')->where('id', $existing->id);
            if (Schema::hasColumn('settings', 'tenant_id')) {
                $select->where('tenant_id', $tenantId);
            }

            return $select->first();
        }

        if (Schema::hasColumn('settings', 'tenant_id')) {
            $update['tenant_id'] = $tenantId;
        }
        if (Schema::hasColumn('settings', 'created_at')) {
            $update['created_at'] = now();
        }

        $id = DB::table('settings')->insertGetId($update);

        $select = DB::table('settings')->where('id', $id);
        if (Schema::hasColumn('settings', 'tenant_id')) {
            $select->where('tenant_id', $tenantId);
        }

        return $select->first();
    }

    private function rolloverAcademicYearData(
        string $tenantId,
        array $period,
        string $previousYear,
        string $previousSemester,
        bool $carryEskulMembers
    ): array {
        if (Schema::hasTable('kelas') === false || Schema::hasTable('profiles') === false) {
            return [
                'promoted_students' => 0,
                'alumni_students' => 0,
                'skipped_students' => 0,
                'classes_synced' => 0,
                'eskul_members_copied' => 0,
            ];
        }

        $targetStartYear = (int) substr((string) $period['tahun_ajaran'], 0, 4);
        $classRows = $this->tenantQuery('kelas', $tenantId)
            ->select($this->existingColumns('kelas', [
                'id', 'nama', 'grade', 'suffix', 'angkatan', 'tahun_ajaran', 'semester', 'is_active',
            ]))
            ->get();

        $classInfoById = [];
        $classesByGradeSuffix = [];
        foreach ($classRows as $row) {
            if ($this->isActiveClassRow($row) === false) {
                continue;
            }

            $grade = $this->classGradeFromRow($row);
            $suffix = $this->classSuffixFromRow($row, $grade);
            $id = trim((string) ($row->id ?? ''));
            if ($id === '' || $grade === '' || $suffix === '') {
                continue;
            }

            $info = [
                'id' => $id,
                'grade' => $grade,
                'suffix' => $suffix,
                'label' => trim($grade.' '.$suffix),
            ];
            $classInfoById[$id] = $info;
            $classesByGradeSuffix[$grade][$suffix] = $info;
        }

        $studentRows = DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa')
            ->whereRaw('lower(coalesce(status, \'active\')) = ?', ['active'])
            ->select($this->existingColumns('profiles', ['id', 'kelas', 'angkatan', 'status']))
            ->orderBy('kelas')
            ->orderBy('id')
            ->get();

        $updatesByTarget = [];
        $targetGradeByClass = [];
        $alumniIds = [];
        $affectedClassIds = [];
        $studentClassSnapshots = [];
        $clearedClassStudentIds = [];
        $skippedStudents = 0;
        $missingTargets = [];

        foreach ($studentRows as $student) {
            $studentId = trim((string) ($student->id ?? ''));
            $classId = trim((string) ($student->kelas ?? ''));
            if ($studentId === '' || $classId === '' || isset($classInfoById[$classId]) === false) {
                $skippedStudents += 1;

                continue;
            }

            $currentClass = $classInfoById[$classId];
            $nextGrade = $this->nextAcademicGrade($currentClass['grade']);
            if ($nextGrade === null) {
                $skippedStudents += 1;

                continue;
            }

            $affectedClassIds[$classId] = true;
            if ($nextGrade === 'ALUMNI') {
                $alumniIds[] = $studentId;
                $clearedClassStudentIds[] = $studentId;

                continue;
            }

            $targetClass = $classesByGradeSuffix[$nextGrade][$currentClass['suffix']] ?? null;
            if ($targetClass === null) {
                $missingTargets[$nextGrade.' '.$currentClass['suffix']] = true;

                continue;
            }

            $updatesByTarget[$targetClass['id']][] = $studentId;
            $targetGradeByClass[$targetClass['id']] = $nextGrade;
            $affectedClassIds[$targetClass['id']] = true;
            $studentClassSnapshots[$studentId] = $targetClass['id'];
        }

        if ($missingTargets !== []) {
            $labels = array_keys($missingTargets);
            sort($labels, SORT_NATURAL);
            throw new \RuntimeException(
                'Kelas tujuan rollover belum lengkap: '.implode(', ', array_slice($labels, 0, 12)).
                (count($labels) > 12 ? ', ...' : '').
                '. Buat kelas tujuan dulu atau gunakan Kenaikan Kelas manual.'
            );
        }

        $now = now();
        $promotedStudents = 0;
        foreach ($updatesByTarget as $targetClassId => $studentIds) {
            $update = [
                'kelas' => $targetClassId,
                'updated_at' => $now,
            ];
            if (Schema::hasColumn('profiles', 'angkatan')) {
                $update['angkatan'] = $this->cohortYearForGrade($targetGradeByClass[$targetClassId] ?? '', $targetStartYear);
            }
            $update = $this->filterExistingPayload('profiles', $update);

            foreach (array_chunk($studentIds, 500) as $chunk) {
                DB::table('profiles')
                    ->where('tenant_id', $tenantId)
                    ->whereIn('id', $chunk)
                    ->update($update);
            }
            $promotedStudents += count($studentIds);
        }

        if ($alumniIds !== []) {
            $alumniPayload = [
                'status' => 'alumni',
                'kelas' => '',
                'tahun_lulus' => $targetStartYear,
                'disabled_at' => $now,
                'alasan_nonaktif' => 'Lulus otomatis saat rollover dari '.$previousYear.' ke '.$period['tahun_ajaran'].'.',
                'rfid_uid' => null,
                'updated_at' => $now,
            ];
            $alumniPayload = $this->filterExistingPayload('profiles', $alumniPayload);

            foreach (array_chunk($alumniIds, 500) as $chunk) {
                DB::table('profiles')
                    ->where('tenant_id', $tenantId)
                    ->whereIn('id', $chunk)
                    ->update($alumniPayload);
            }
        }

        $snapshotUpdates = $this->syncStudentClassSnapshotTables($tenantId, $studentClassSnapshots, $clearedClassStudentIds);
        $eskulMembersCopied = $carryEskulMembers
            ? $this->copyEskulMembershipsToAcademicPeriod(
                $tenantId,
                $previousYear,
                $previousSemester,
                $period,
                array_keys($studentClassSnapshots)
            )
            : 0;

        $affectedIds = array_keys($affectedClassIds);
        if ($affectedIds !== [] && Schema::hasTable('kelas_struktur')) {
            $structurePayload = $this->filterExistingPayload('kelas_struktur', [
                'ketua_siswa_id' => null,
                'ketua_siswa_nama' => null,
                'updated_at' => $now,
            ]);
            if ($structurePayload !== []) {
                $query = DB::table('kelas_struktur')->whereIn('kelas_id', $affectedIds);
                if (Schema::hasColumn('kelas_struktur', 'tenant_id')) {
                    $query->where('tenant_id', $tenantId);
                }
                $query->update($structurePayload);
            }
        }

        return [
            'promoted_students' => $promotedStudents,
            'alumni_students' => count($alumniIds),
            'skipped_students' => $skippedStudents,
            'classes_synced' => $this->syncClassPeriodMetadata($tenantId, $period),
            'related_snapshots_synced' => $snapshotUpdates,
            'eskul_members_copied' => $eskulMembersCopied,
        ];
    }

    private function copyEskulMembershipsToAcademicPeriod(
        string $tenantId,
        string $sourceYear,
        string $sourceSemester,
        array $targetPeriod,
        array $studentIds
    ): int {
        $studentIds = array_values(array_unique(array_filter(array_map(
            fn ($value) => trim((string) $value),
            $studentIds
        ))));
        if ($studentIds === [] || Schema::hasTable('ekskul_anggota') === false) {
            return 0;
        }

        foreach (['ekskul_id', 'user_id', 'tahun_ajaran', 'semester'] as $column) {
            if (Schema::hasColumn('ekskul_anggota', $column) === false) {
                return 0;
            }
        }

        $targetYear = AcademicPeriod::normalizeAcademicYear($targetPeriod['tahun_ajaran'] ?? null);
        $targetSemester = AcademicPeriod::normalizeSemester($targetPeriod['semester'] ?? null);
        $sourceYear = AcademicPeriod::normalizeAcademicYear($sourceYear);
        $sourceSemester = AcademicPeriod::normalizeSemester($sourceSemester);
        if (
            $targetYear === null
            || $targetSemester === null
            || $sourceYear === null
            || $sourceSemester === null
            || ($sourceYear === $targetYear && $sourceSemester === $targetSemester)
        ) {
            return 0;
        }

        $cohortByStudent = [];
        if (Schema::hasColumn('profiles', 'angkatan')) {
            foreach (array_chunk($studentIds, 500) as $chunk) {
                $profileQuery = DB::table('profiles')->whereIn('id', $chunk);
                if (Schema::hasColumn('profiles', 'tenant_id')) {
                    $profileQuery->where('tenant_id', $tenantId);
                }

                foreach ($profileQuery->pluck('angkatan', 'id') as $studentId => $cohort) {
                    $cohortByStudent[(string) $studentId] = $cohort;
                }
            }
        }

        $validEskulIds = null;
        if (Schema::hasTable('ekskul') && Schema::hasColumn('ekskul', 'id')) {
            $validEskulIds = [];
            $ekskulQuery = DB::table('ekskul');
            if (Schema::hasColumn('ekskul', 'tenant_id')) {
                $ekskulQuery->where('tenant_id', $tenantId);
            }

            foreach ($ekskulQuery->pluck('id') as $ekskulId) {
                $id = trim((string) $ekskulId);
                if ($id !== '') {
                    $validEskulIds[$id] = true;
                }
            }
        }

        $existingTargetKeys = [];
        foreach (array_chunk($studentIds, 500) as $chunk) {
            $targetQuery = DB::table('ekskul_anggota')
                ->where('tahun_ajaran', $targetYear)
                ->where('semester', $targetSemester)
                ->whereIn('user_id', $chunk);
            if (Schema::hasColumn('ekskul_anggota', 'tenant_id')) {
                $targetQuery->where('tenant_id', $tenantId);
            }

            foreach ($targetQuery->get(['ekskul_id', 'user_id']) as $row) {
                $userId = trim((string) ($row->user_id ?? ''));
                $ekskulId = trim((string) ($row->ekskul_id ?? ''));
                if ($userId !== '' && $ekskulId !== '') {
                    $existingTargetKeys[$userId.'|'.$ekskulId] = true;
                }
            }
        }

        $sourceColumns = $this->existingColumns('ekskul_anggota', ['id', 'ekskul_id', 'user_id', 'angkatan']);
        $sourceRows = [];
        foreach (array_chunk($studentIds, 500) as $chunk) {
            $sourceQuery = DB::table('ekskul_anggota')
                ->where('tahun_ajaran', $sourceYear)
                ->where('semester', $sourceSemester)
                ->whereIn('user_id', $chunk)
                ->whereNotNull('ekskul_id')
                ->where('ekskul_id', '!=', '')
                ->whereNotNull('user_id')
                ->where('user_id', '!=', '');
            if (Schema::hasColumn('ekskul_anggota', 'tenant_id')) {
                $sourceQuery->where('tenant_id', $tenantId);
            }
            if (Schema::hasColumn('ekskul_anggota', 'id')) {
                $sourceQuery->orderBy('id');
            }

            foreach ($sourceQuery->get($sourceColumns) as $row) {
                $sourceRows[] = $row;
            }
        }

        $now = now();
        $insertRows = [];
        $seenSourceKeys = [];
        foreach ($sourceRows as $row) {
            $userId = trim((string) ($row->user_id ?? ''));
            $ekskulId = trim((string) ($row->ekskul_id ?? ''));
            if ($userId === '' || $ekskulId === '') {
                continue;
            }
            if ($validEskulIds !== null && isset($validEskulIds[$ekskulId]) === false) {
                continue;
            }

            $key = $userId.'|'.$ekskulId;
            if (isset($seenSourceKeys[$key]) || isset($existingTargetKeys[$key])) {
                continue;
            }

            $seenSourceKeys[$key] = true;
            $insertRows[] = $this->filterExistingPayload('ekskul_anggota', [
                'tenant_id' => $tenantId,
                'ekskul_id' => $ekskulId,
                'user_id' => $userId,
                'tahun_ajaran' => $targetYear,
                'semester' => $targetSemester,
                'angkatan' => $cohortByStudent[$userId] ?? ($row->angkatan ?? null),
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        foreach (array_chunk($insertRows, 500) as $chunk) {
            if ($chunk !== []) {
                DB::table('ekskul_anggota')->insert($chunk);
            }
        }

        return count($insertRows);
    }

    private function syncStudentClassSnapshotTables(string $tenantId, array $studentClassMap, array $clearedStudentIds): int
    {
        $updates = 0;
        $snapshotTables = [
            'organisasi_anggota' => 'siswa_id',
            'osis_anggota' => 'siswa_id',
        ];

        foreach ($snapshotTables as $table => $studentColumn) {
            if (
                Schema::hasTable($table) === false
                || Schema::hasColumn($table, $studentColumn) === false
                || Schema::hasColumn($table, 'kelas') === false
            ) {
                continue;
            }

            foreach ($studentClassMap as $studentId => $classId) {
                $payload = $this->filterExistingPayload($table, [
                    'kelas' => $classId,
                    'updated_at' => now(),
                ]);
                if ($payload === []) {
                    continue;
                }

                $query = DB::table($table)->where($studentColumn, $studentId);
                if (Schema::hasColumn($table, 'tenant_id')) {
                    $query->where('tenant_id', $tenantId);
                }
                $updates += (int) $query->update($payload);
            }

            if ($clearedStudentIds !== []) {
                $payload = $this->filterExistingPayload($table, [
                    'kelas' => null,
                    'updated_at' => now(),
                ]);
                if ($payload === []) {
                    continue;
                }

                foreach (array_chunk($clearedStudentIds, 500) as $chunk) {
                    $query = DB::table($table)->whereIn($studentColumn, $chunk);
                    if (Schema::hasColumn($table, 'tenant_id')) {
                        $query->where('tenant_id', $tenantId);
                    }
                    $updates += (int) $query->update($payload);
                }
            }
        }

        return $updates;
    }

    private function syncClassPeriodMetadata(string $tenantId, array $period): int
    {
        if (Schema::hasTable('kelas') === false) {
            return 0;
        }

        $targetStartYear = (int) substr((string) $period['tahun_ajaran'], 0, 4);
        $rows = $this->tenantQuery('kelas', $tenantId)
            ->select($this->existingColumns('kelas', ['id', 'nama', 'grade', 'suffix', 'is_active']))
            ->orderBy('id')
            ->get();

        $count = 0;
        foreach ($rows as $row) {
            if ($this->isActiveClassRow($row) === false) {
                continue;
            }

            $grade = $this->classGradeFromRow($row);
            $update = [
                'tahun_ajaran' => $period['tahun_ajaran'],
                'semester' => $period['semester'],
                'updated_at' => now(),
            ];
            if ($grade !== '') {
                $update['angkatan'] = $this->cohortYearForGrade($grade, $targetStartYear);
            }

            $update = $this->filterExistingPayload('kelas', $update);
            if (empty($update)) {
                continue;
            }

            $query = DB::table('kelas')->where('id', $row->id);
            if (Schema::hasColumn('kelas', 'tenant_id')) {
                $query->where('tenant_id', $tenantId);
            }
            $query->update($update);
            $count += 1;
        }

        return $count;
    }

    private function studentClassHistoriesForStudents(string $tenantId, array $studentIds): array
    {
        $ids = array_values(array_unique(array_filter(
            array_map(fn ($id) => trim((string) $id), $studentIds),
            fn ($id) => $id !== ''
        )));
        if ($ids === [] || ! Schema::hasTable('student_class_histories')) {
            return [];
        }

        $columns = $this->existingColumns('student_class_histories', [
            'id', 'student_id', 'class_id', 'class_name', 'grade', 'suffix', 'angkatan',
            'tahun_ajaran', 'semester', 'status', 'source', 'note', 'valid_from',
            'valid_until', 'created_at',
        ]);
        if ($columns === []) {
            return [];
        }

        $rows = $this->tenantQuery('student_class_histories', $tenantId)
            ->whereIn('student_id', $ids)
            ->select($columns)
            ->orderBy('student_id')
            ->orderByDesc(Schema::hasColumn('student_class_histories', 'valid_from') ? 'valid_from' : 'created_at')
            ->limit(max(100, count($ids) * 8))
            ->get()
            ->map(fn ($row) => (array) $row)
            ->groupBy(fn ($row) => (string) ($row['student_id'] ?? ''));

        $histories = [];
        foreach ($rows as $studentId => $studentRows) {
            $histories[$studentId] = $studentRows
                ->take(8)
                ->values()
                ->all();
        }

        return $histories;
    }

    private function snapshotStudentClassHistoriesForPeriod(string $tenantId, array $period, string $source): int
    {
        if (
            ! Schema::hasTable('student_class_histories')
            || ! Schema::hasTable('profiles')
            || ! Schema::hasTable('kelas')
        ) {
            return 0;
        }

        $classRows = $this->tenantQuery('kelas', $tenantId)
            ->select($this->existingColumns('kelas', ['id', 'nama', 'grade', 'suffix', 'angkatan']))
            ->get()
            ->keyBy(fn ($row) => (string) ($row->id ?? ''));

        $studentRows = DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa')
            ->whereNotNull('kelas')
            ->where('kelas', '!=', '')
            ->whereRaw('lower(coalesce(status, \'active\')) = ?', ['active'])
            ->select($this->existingColumns('profiles', ['id', 'kelas', 'angkatan', 'status']))
            ->orderBy('kelas')
            ->orderBy('id')
            ->get();

        if ($studentRows->isEmpty()) {
            return 0;
        }

        $now = now();
        $inserted = 0;
        foreach ($studentRows->chunk(500) as $chunk) {
            $studentIds = $chunk->pluck('id')->filter()->map(fn ($id) => (string) $id)->values()->all();
            $existingKeys = $this->tenantQuery('student_class_histories', $tenantId)
                ->whereIn('student_id', $studentIds)
                ->where('tahun_ajaran', $period['tahun_ajaran'])
                ->where('semester', $period['semester'])
                ->whereNull('valid_until')
                ->select($this->existingColumns('student_class_histories', ['student_id', 'class_id']))
                ->get()
                ->mapWithKeys(fn ($row) => [(string) ($row->student_id ?? '').'|'.(string) ($row->class_id ?? '') => true]);

            $rowsToInsert = [];
            $studentsToClose = [];
            foreach ($chunk as $student) {
                $studentId = (string) ($student->id ?? '');
                $classId = (string) ($student->kelas ?? '');
                if ($studentId === '' || $classId === '') {
                    continue;
                }

                if ($existingKeys->has($studentId.'|'.$classId)) {
                    continue;
                }

                $class = $classRows->get($classId);
                $studentsToClose[] = $studentId;
                $rowsToInsert[] = $this->filterExistingPayload('student_class_histories', [
                    'id' => (string) Str::uuid(),
                    'tenant_id' => $tenantId,
                    'student_id' => $studentId,
                    'class_id' => $classId,
                    'class_name' => $class->nama ?? $classId,
                    'grade' => $class ? $this->classGradeFromRow($class) : $this->parseClassGrade($classId),
                    'suffix' => $class ? $this->classSuffixFromRow($class, $this->classGradeFromRow($class)) : null,
                    'angkatan' => $student->angkatan ?? ($class->angkatan ?? null),
                    'tahun_ajaran' => $period['tahun_ajaran'],
                    'semester' => $period['semester'],
                    'status' => $student->status ?? 'active',
                    'source' => $source,
                    'note' => 'Snapshot otomatis periode akademik aktif.',
                    'valid_from' => $now,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }

            if ($rowsToInsert === []) {
                continue;
            }

            $this->tenantQuery('student_class_histories', $tenantId)
                ->whereIn('student_id', array_values(array_unique($studentsToClose)))
                ->whereNull('valid_until')
                ->update($this->filterExistingPayload('student_class_histories', [
                    'valid_until' => $now,
                    'updated_at' => $now,
                ]));

            DB::table('student_class_histories')->insert($rowsToInsert);
            $inserted += count($rowsToInsert);
        }

        return $inserted;
    }

    private function filterExistingPayload(string $table, array $payload): array
    {
        if (Schema::hasTable($table) === false) {
            return [];
        }

        return array_filter(
            $payload,
            fn ($value, $column) => Schema::hasColumn($table, (string) $column),
            ARRAY_FILTER_USE_BOTH
        );
    }

    private function isActiveClassRow(object $row): bool
    {
        if (property_exists($row, 'is_active') === false) {
            return true;
        }

        $value = $row->is_active;
        if (is_bool($value)) {
            return $value;
        }

        return in_array(strtolower(trim((string) $value)), ['0', 'false', 'no', 'inactive'], true) === false;
    }

    private function classGradeFromRow(object $row): string
    {
        $grade = $this->normalizeClassGrade($row->grade ?? '');
        if ($grade !== '') {
            return $grade;
        }

        return $this->parseClassGrade((string) ($row->nama ?? $row->id ?? ''));
    }

    private function classSuffixFromRow(object $row, string $grade): string
    {
        $suffix = trim((string) ($row->suffix ?? ''));
        if ($suffix === '') {
            $suffix = $this->stripClassGradePrefix((string) ($row->nama ?? $row->id ?? ''), $grade);
        }

        return strtoupper(trim((string) preg_replace('/\s+/', ' ', $suffix)));
    }

    private function normalizeClassGrade(string $value): string
    {
        $grade = strtoupper(trim((string) preg_replace('/\s+/', ' ', $value)));

        return in_array($grade, ['VII', 'VIII', 'IX', 'X', 'XI', 'XII'], true) ? $grade : '';
    }

    private function parseClassGrade(string $value): string
    {
        $normalized = strtoupper(trim((string) preg_replace('/[\s_-]+/', ' ', $value)));
        if (preg_match('/^(XII|XI|X|IX|VIII|VII)\b/', $normalized, $matches)) {
            return $matches[1];
        }

        return '';
    }

    private function stripClassGradePrefix(string $value, string $grade): string
    {
        $normalized = strtoupper(trim((string) preg_replace('/[\s_-]+/', ' ', $value)));
        if ($grade !== '' && str_starts_with($normalized, $grade.' ')) {
            return trim(substr($normalized, strlen($grade) + 1));
        }

        return $normalized;
    }

    private function nextAcademicGrade(string $grade): ?string
    {
        return match ($grade) {
            'VII' => 'VIII',
            'VIII' => 'IX',
            'IX', 'XII' => 'ALUMNI',
            'X' => 'XI',
            'XI' => 'XII',
            default => null,
        };
    }

    private function cohortYearForGrade(string $grade, int $academicStartYear): string
    {
        $offset = match ($grade) {
            'VIII', 'XI' => -1,
            'IX', 'XII' => -2,
            default => 0,
        };

        return (string) ($academicStartYear + $offset);
    }

    private function firstTenantRow(string $table, string $tenantId): ?object
    {
        if (! Schema::hasTable($table)) {
            return null;
        }

        $query = DB::table($table);
        if (Schema::hasColumn($table, 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        return $query->orderBy(Schema::hasColumn($table, 'id') ? 'id' : 'created_at')->first();
    }

    private function tenantQuery(string $table, string $tenantId, ?string $alias = null)
    {
        $query = DB::table($alias ? "{$table} as {$alias}" : $table);
        if (Schema::hasColumn($table, 'tenant_id')) {
            $query->where(($alias ? "{$alias}." : '').'tenant_id', $tenantId);
        }

        return $query;
    }

    private function tenantTableCount(string $table, string $tenantId): int
    {
        if (! Schema::hasTable($table)) {
            return 0;
        }

        return (int) $this->tenantQuery($table, $tenantId)->count();
    }

    private function perPage(Request $request, int $default = 25): int
    {
        return max(1, min(100, (int) $request->query('per_page', $default)));
    }

    private function paginationMeta(int $page, int $perPage, int $total, bool $allRows = false): array
    {
        $pageCount = $allRows ? 1 : max(1, (int) ceil($total / max(1, $perPage)));
        $safePage = $allRows ? 1 : min(max(1, $page), $pageCount);
        $from = $total === 0 ? 0 : (($safePage - 1) * $perPage) + 1;
        $to = $total === 0 ? 0 : min($total, $from + $perPage - 1);

        return [
            'page' => $safePage,
            'per_page' => $perPage,
            'total' => $total,
            'page_count' => $pageCount,
            'from' => $from,
            'to' => $to,
            'all' => $allRows,
        ];
    }

    private function existingColumns(string $table, array $columns): array
    {
        if (! Schema::hasTable($table)) {
            return $columns;
        }

        $available = array_values(array_filter($columns, fn ($column) => Schema::hasColumn($table, $column)));

        return ! empty($available) ? $available : ['*'];
    }

    private function prefixedExistingColumns(string $table, array $columns, ?string $prefix = null): array
    {
        $prefix = $prefix ?: $table;

        return array_map(
            fn ($column) => $column === '*' ? "{$prefix}.*" : "{$prefix}.{$column}",
            $this->existingColumns($table, $columns)
        );
    }

    private function presenceAggregateQuery(string $tenantId, $activeCutoff = null)
    {
        $activeCutoff = $activeCutoff ?: now()->subSeconds(120)->toDateTimeString();
        $query = DB::table('user_presence')
            ->select('user_id', DB::raw('max(last_seen_at) as last_seen_at'))
            ->selectRaw('sum(case when last_seen_at >= ? then 1 else 0 end) as active_devices', [$activeCutoff])
            ->selectRaw('sum(case when last_seen_at >= ? then activity_count else 0 end) as activity_count', [$activeCutoff])
            ->groupBy('user_id');

        if (Schema::hasColumn('user_presence', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        return $query;
    }

    private function sortRowsByPresence($rows)
    {
        return $rows->sort(function (array $a, array $b) {
            $aOnline = (int) ($a['online'] ?? 0) > 0 || (int) ($a['active_devices'] ?? 0) > 0;
            $bOnline = (int) ($b['online'] ?? 0) > 0 || (int) ($b['active_devices'] ?? 0) > 0;

            if ($aOnline !== $bOnline) {
                return $aOnline ? -1 : 1;
            }

            $aSeen = (string) ($a['last_seen_at'] ?? '');
            $bSeen = (string) ($b['last_seen_at'] ?? '');
            if ($aSeen !== $bSeen) {
                return strcmp($bSeen, $aSeen);
            }

            return strcasecmp((string) ($a['nama'] ?? ''), (string) ($b['nama'] ?? ''));
        });
    }

    private function queryText(Request $request, string $key): string
    {
        return trim((string) $request->query($key, ''));
    }

    private function teacherClassIds(string $tenantId, string $teacherId): array
    {
        if ($teacherId === '' || ! Schema::hasTable('kelas_struktur')) {
            return [];
        }

        return $this->tenantQuery('kelas_struktur', $tenantId)
            ->where('wali_guru_id', $teacherId)
            ->pluck('kelas_id')
            ->filter()
            ->map(fn ($value) => (string) $value)
            ->values()
            ->all();
    }

    private function studentBaseQuery(string $tenantId, ?array $classIds = null)
    {
        $query = DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa');

        if ($classIds !== null) {
            $query->whereIn('kelas', $classIds);
        }

        return $query;
    }

    private function applyStudentFilters($query, Request $request): void
    {
        $search = $this->queryText($request, 'q') ?: $this->queryText($request, 'nama');
        if ($search !== '') {
            $like = '%'.strtolower($search).'%';
            $query->where(function ($builder) use ($like) {
                $builder->whereRaw('lower(nama) like ?', [$like])
                    ->orWhereRaw('lower(email) like ?', [$like]);
            });
        }

        $nis = $this->queryText($request, 'nis');
        if ($nis !== '') {
            $query->whereRaw('lower(coalesce(nis, \'\')) like ?', ['%'.strtolower($nis).'%']);
        }

        $kelas = $this->queryText($request, 'kelas');
        if ($kelas !== '') {
            $query->where('kelas', $kelas);
        }

        $status = $this->queryText($request, 'status');
        if ($status !== '') {
            $query->whereRaw('lower(coalesce(status, \'active\')) = ?', [strtolower($status)]);
        }

        $hasRfid = $this->queryText($request, 'has_rfid');
        if ($hasRfid !== '') {
            $truthy = in_array(strtolower($hasRfid), ['1', 'true', 'yes', 'ada', 'rfid'], true);
            if ($truthy) {
                $query->whereNotNull('rfid_uid')->where('rfid_uid', '<>', '');
            } else {
                $query->where(function ($builder) {
                    $builder->whereNull('rfid_uid')->orWhere('rfid_uid', '');
                });
            }
        }
    }

    private function studentOrganizationMemberships(string $tenantId, string $studentId): array
    {
        if (! Schema::hasTable('organisasi_anggota') || ! Schema::hasColumn('organisasi_anggota', 'siswa_id')) {
            return [];
        }

        $query = $this->tenantQuery('organisasi_anggota', $tenantId, 'oa')
            ->where('oa.siswa_id', $studentId);

        $hasOrganizationJoin =
            Schema::hasTable('organisasi') &&
            Schema::hasColumn('organisasi_anggota', 'organisasi_id') &&
            Schema::hasColumn('organisasi', 'id');

        if ($hasOrganizationJoin) {
            $query->leftJoin('organisasi as o', function ($join) {
                $join->on('o.id', '=', 'oa.organisasi_id');
                if (Schema::hasColumn('organisasi', 'tenant_id') && Schema::hasColumn('organisasi_anggota', 'tenant_id')) {
                    $join->on('o.tenant_id', '=', 'oa.tenant_id');
                }
            });
        }

        $selects = [];
        $selects[] = Schema::hasColumn('organisasi_anggota', 'organisasi_id')
            ? 'oa.organisasi_id'
            : DB::raw('null as organisasi_id');
        $selects[] = Schema::hasColumn('organisasi_anggota', 'status')
            ? 'oa.status'
            : DB::raw("'aktif' as status");
        $selects[] = Schema::hasColumn('organisasi_anggota', 'bagian')
            ? 'oa.bagian'
            : DB::raw("'' as bagian");
        $selects[] = Schema::hasColumn('organisasi_anggota', 'jabatan')
            ? 'oa.jabatan'
            : DB::raw("'Anggota' as jabatan");
        $selects[] = $hasOrganizationJoin && Schema::hasColumn('organisasi', 'nama')
            ? DB::raw('o.nama as org_nama')
            : DB::raw('null as org_nama');

        if (Schema::hasColumn('organisasi_anggota', 'organisasi_id')) {
            $query->orderBy('oa.organisasi_id');
        }

        return $query
            ->select($selects)
            ->get()
            ->map(fn ($member) => [
                'orgId' => $member->organisasi_id ?? null,
                'orgNama' => $member->org_nama ?: ($member->organisasi_id ?? 'Organisasi'),
                'status' => $member->status ?: 'aktif',
                'bagian' => $member->bagian ?: '',
                'jabatan' => $member->jabatan ?: 'Anggota',
            ])
            ->values()
            ->all();
    }

    private function studentOsisMembership(string $tenantId, string $studentId): ?array
    {
        if (! Schema::hasTable('osis_anggota') || ! Schema::hasColumn('osis_anggota', 'siswa_id')) {
            return null;
        }

        $query = $this->tenantQuery('osis_anggota', $tenantId)
            ->where('siswa_id', $studentId);

        $selects = [];
        $selects[] = Schema::hasColumn('osis_anggota', 'status')
            ? 'status'
            : DB::raw("'aktif' as status");
        $selects[] = Schema::hasColumn('osis_anggota', 'bagian')
            ? 'bagian'
            : DB::raw("'' as bagian");
        $selects[] = Schema::hasColumn('osis_anggota', 'jabatan')
            ? 'jabatan'
            : DB::raw("'Anggota' as jabatan");

        $row = $query->select($selects)->first();
        if (! $row) {
            return null;
        }

        return [
            'status' => $row->status ?: 'aktif',
            'bagian' => $row->bagian ?: '',
            'jabatan' => $row->jabatan ?: 'Anggota',
        ];
    }

    private function studentStats(string $tenantId, ?array $classIds = null): array
    {
        $base = $this->studentBaseQuery($tenantId, $classIds);
        $statusCounts = (clone $base)
            ->selectRaw("coalesce(status, 'active') as status_key, count(*) as aggregate")
            ->groupBy('status_key')
            ->pluck('aggregate', 'status_key');

        $total = (int) $statusCounts->sum();
        $active = (int) ($statusCounts['active'] ?? 0);
        $struktur = $this->tenantQuery('kelas_struktur', $tenantId)
            ->when($classIds !== null, fn ($builder) => $builder->whereIn('kelas_id', $classIds))
            ->whereNotNull('ketua_siswa_id')
            ->where('ketua_siswa_id', '<>', '');

        return [
            'totalSiswa' => $total,
            'aktifSiswa' => $active,
            'nonaktifSiswa' => max(0, $total - $active),
            'nonaktifOnly' => (int) ($statusCounts['nonaktif'] ?? 0),
            'mutasiSiswa' => (int) ($statusCounts['mutasi'] ?? 0),
            'alumniSiswa' => (int) ($statusCounts['alumni'] ?? 0),
            'ketuaKelas' => Schema::hasTable('kelas_struktur') ? (int) $struktur->count() : 0,
        ];
    }

    private function emptyStudentStats(): array
    {
        return [
            'totalSiswa' => 0,
            'aktifSiswa' => 0,
            'nonaktifSiswa' => 0,
            'nonaktifOnly' => 0,
            'mutasiSiswa' => 0,
            'alumniSiswa' => 0,
            'ketuaKelas' => 0,
        ];
    }

    private function filterTeacherRows($teachers, Request $request)
    {
        $search = strtolower($this->queryText($request, 'q'));
        $mapel = strtolower($this->queryText($request, 'mapel'));
        $jabatan = strtolower($this->queryText($request, 'jabatan'));
        $status = strtolower($this->queryText($request, 'status'));

        return $teachers->filter(function (array $teacher) use ($search, $mapel, $jabatan, $status) {
            if ($search !== '') {
                $haystack = strtolower(implode(' ', array_filter([
                    $teacher['nama'] ?? '',
                    $teacher['email'] ?? '',
                    $teacher['nis'] ?? '',
                    implode(' ', $teacher['mapelList'] ?? []),
                    implode(' ', $teacher['kelasList'] ?? []),
                    implode(' ', $teacher['jabatanList'] ?? []),
                ])));
                if (! str_contains($haystack, $search)) {
                    return false;
                }
            }

            if ($mapel !== '' && ! $this->arrayContainsText($teacher['mapelList'] ?? [], $mapel)) {
                return false;
            }

            if ($jabatan !== '' && ! $this->arrayContainsText($teacher['jabatanList'] ?? [], $jabatan)) {
                return false;
            }

            if ($status !== '') {
                $teacherStatus = strtolower(trim((string) ($teacher['status'] ?? 'active'))) ?: 'active';
                if ($teacherStatus !== $status) {
                    return false;
                }
            }

            return true;
        });
    }

    private function arrayContainsText(array $values, string $needle): bool
    {
        foreach ($values as $value) {
            if (strtolower(trim((string) $value)) === $needle) {
                return true;
            }
        }

        return false;
    }

    private function indonesianDayName(Carbon $date): string
    {
        return match ((int) $date->dayOfWeekIso) {
            1 => 'Senin',
            2 => 'Selasa',
            3 => 'Rabu',
            4 => 'Kamis',
            5 => 'Jumat',
            6 => 'Sabtu',
            default => 'Minggu',
        };
    }
}
