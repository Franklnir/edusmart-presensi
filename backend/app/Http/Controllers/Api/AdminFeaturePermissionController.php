<?php

namespace App\Http\Controllers\Api;

use App\Support\AcademicPeriod;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class AdminFeaturePermissionController extends ApiController
{
    private const FEATURES = [
        'dashboard' => ['label' => 'Dashboard', 'path' => '/guru/admin/home'],
        'kelas' => ['label' => 'Kelas', 'path' => '/guru/admin/kelas'],
        'jadwal' => ['label' => 'Jadwal', 'path' => '/guru/admin/jadwal'],
        'struktur-sekolah' => ['label' => 'Struktur Sekolah', 'path' => '/guru/admin/struktur-sekolah'],
        'organisasi' => ['label' => 'Organisasi', 'path' => '/guru/admin/organisasi'],
        'guru' => ['label' => 'Guru', 'path' => '/guru/admin/guru'],
        'sertifikat' => ['label' => 'Sertifikat', 'path' => '/guru/admin/sertifikat'],
        'siswa' => ['label' => 'Siswa', 'path' => '/guru/admin/siswa'],
        'scan-kehadiran' => ['label' => 'Scan Kehadiran (Semua Submenu)', 'path' => '/guru/admin/scan', 'legacy' => true],
        'scan-kehadiran-pengaturan' => ['label' => 'Pengaturan Scan', 'path' => '/guru/admin/scan?menu=pengaturan'],
        'scan-kehadiran-live' => ['label' => 'Live Scan', 'path' => '/guru/admin/scan?menu=live-scan'],
        'scan-kehadiran-riwayat' => ['label' => 'Riwayat', 'path' => '/guru/admin/scan?menu=riwayat'],
    ];

    private const TARGET_TYPES = ['teacher', 'position', 'homeroom'];

    public function index(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        if (! $this->tableReady()) {
            return $this->tableUnavailableResponse();
        }

        $rows = $this->tenantPermissionQuery($tenantId)
            ->orderBy('target_label')
            ->orderBy('feature_key')
            ->get()
            ->map(fn ($row) => $this->formatPermissionRow((array) $row))
            ->values();

        return $this->ok([
            'rows' => $rows,
            'groups' => $this->groupRows($rows->all()),
            'options' => $this->optionsPayload($tenantId),
            'features' => $this->featureOptions(),
        ]);
    }

    public function store(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        if (! $this->tableReady()) {
            return $this->tableUnavailableResponse();
        }

        $payload = $this->validatedPayload($request);
        if ($payload instanceof JsonResponse) {
            return $payload;
        }

        $target = $this->resolveTarget($tenantId, $payload);
        if ($target instanceof JsonResponse) {
            return $target;
        }

        $features = $this->normalizeFeatures($payload['features'] ?? []);
        if ($features === []) {
            return $this->deny('Pilih minimal satu fitur halaman admin.', 422);
        }

        if (($target['target_type'] ?? '') === 'homeroom' && in_array('siswa', $features, true)) {
            return $this->deny('Wali kelas tidak perlu diberi fitur Siswa karena menu Siswa Wali sudah tersedia.', 422);
        }

        $now = now();
        $actorId = (string) ($request->user()?->id ?? '');
        DB::transaction(function () use ($tenantId, $target, $features, $payload, $now, $actorId) {
            foreach ($features as $featureKey) {
                $identity = [
                    'tenant_id' => $tenantId,
                    'target_type' => $target['target_type'],
                    'target_teacher_id' => $target['target_teacher_id'],
                    'target_class_id' => $target['target_class_id'] ?? '',
                    'feature_key' => $featureKey,
                ];
                $exists = DB::table('admin_feature_permissions')->where($identity)->exists();
                if ($exists) {
                    DB::table('admin_feature_permissions')->where($identity)->update([
                        'target_label' => $target['target_label'],
                        'is_active' => (bool) ($payload['is_active'] ?? true),
                        'updated_by' => $actorId ?: null,
                        'updated_at' => $now,
                    ]);
                } else {
                    DB::table('admin_feature_permissions')->insert([
                        ...$identity,
                        'id' => (string) Str::uuid(),
                        'target_label' => $target['target_label'],
                        'is_active' => (bool) ($payload['is_active'] ?? true),
                        'updated_by' => $actorId ?: null,
                        'updated_at' => $now,
                        'created_by' => $actorId ?: null,
                        'created_at' => $now,
                    ]);
                }
            }
        });

        return $this->index($request);
    }

    public function update(Request $request, string $id)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        if (! $this->tableReady()) {
            return $this->tableUnavailableResponse();
        }

        $row = $this->tenantPermissionQuery($tenantId)->where('id', $id)->first();
        if (! $row) {
            return $this->deny('Permission admin tidak ditemukan.', 404);
        }

        $validator = Validator::make($request->all(), [
            'is_active' => 'required|boolean',
        ]);
        if ($validator->fails()) {
            return $this->deny($validator->errors()->first(), 422);
        }

        DB::table('admin_feature_permissions')
            ->where('id', $id)
            ->update([
                'is_active' => (bool) $request->boolean('is_active'),
                'updated_by' => (string) ($request->user()?->id ?? '') ?: null,
                'updated_at' => now(),
            ]);

        return $this->index($request);
    }

    public function destroy(Request $request, string $id)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        if (! $this->tableReady()) {
            return $this->tableUnavailableResponse();
        }
        $deleted = $this->tenantPermissionQuery($tenantId)->where('id', $id)->delete();
        if (! $deleted) {
            return $this->deny('Permission admin tidak ditemukan.', 404);
        }

        return $this->index($request);
    }

    public function mine(Request $request)
    {
        if (! $this->isGuru($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        $teacherId = (string) ($request->user()?->id ?? '');
        if (! $tenantId || $teacherId === '') {
            return $this->deny('Tenant atau guru tidak valid.', 400);
        }

        if (! Schema::hasTable('admin_feature_permissions')) {
            return $this->ok(['features' => [], 'rows' => []]);
        }

        $rows = $this->tenantPermissionQuery($tenantId)
            ->where('target_teacher_id', $teacherId)
            ->where('is_active', true)
            ->orderBy('feature_key')
            ->get()
            ->map(fn ($row) => $this->formatPermissionRow((array) $row))
            ->values();

        return $this->ok([
            'features' => $rows
                ->pluck('feature_key')
                ->filter()
                ->unique()
                ->values()
                ->all(),
            'rows' => $rows,
        ]);
    }

    private function validatedPayload(Request $request): array|JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'target_type' => 'required|string|in:teacher,position,homeroom',
            'teacher_id' => 'nullable|string|max:191',
            'position_id' => 'nullable|string|max:191',
            'class_id' => 'nullable|string|max:191',
            'features' => 'required|array|min:1',
            'features.*' => 'string|max:64',
            'is_active' => 'nullable|boolean',
        ]);

        if ($validator->fails()) {
            return $this->deny($validator->errors()->first(), 422);
        }

        return $validator->validated();
    }

    private function resolveTarget(string $tenantId, array $payload): array|JsonResponse
    {
        $targetType = (string) ($payload['target_type'] ?? '');
        if (! in_array($targetType, self::TARGET_TYPES, true)) {
            return $this->deny('Target permission tidak valid.', 422);
        }

        if ($targetType === 'teacher') {
            $teacherId = (string) ($payload['teacher_id'] ?? '');
            $teacher = $this->teacherRow($tenantId, $teacherId);
            if (! $teacher) {
                return $this->deny('Guru tidak ditemukan.', 404);
            }
            $hasPosition = $this->teacherHasPosition($tenantId, $teacherId);
            $hasHomeroom = $this->teacherHasHomeroom($tenantId, $teacherId);
            if ($hasPosition || $hasHomeroom) {
                return $this->deny('Guru ini memiliki jabatan atau wali kelas. Silakan pilih target Jabatan atau Wali Kelas agar permission tidak ambigu.', 422);
            }

            return [
                'target_type' => 'teacher',
                'target_teacher_id' => $teacherId,
                'target_label' => (string) ($teacher->nama ?? 'Guru'),
                'target_class_id' => '',
            ];
        }

        if ($targetType === 'position') {
            $positionId = (string) ($payload['position_id'] ?? '');
            $position = $this->positionRow($tenantId, $positionId);
            if (! $position || empty($position->guru_id)) {
                return $this->deny('Jabatan belum memiliki guru penanggung jawab.', 422);
            }

            return [
                'target_type' => 'position',
                'target_teacher_id' => (string) $position->guru_id,
                'target_label' => trim((string) ($position->jabatan ?? 'Jabatan')).' - '.trim((string) ($position->guru_nama ?? 'Guru')),
                'target_class_id' => '',
            ];
        }

        $classId = (string) ($payload['class_id'] ?? '');
        $homeroom = $this->homeroomRow($tenantId, $classId);
        if (! $homeroom || empty($homeroom->wali_guru_id)) {
            return $this->deny('Wali kelas belum ditentukan untuk kelas ini.', 422);
        }

        return [
            'target_type' => 'homeroom',
            'target_teacher_id' => (string) $homeroom->wali_guru_id,
            'target_label' => 'Wali Kelas '.$this->classLabel($tenantId, $classId).' - '.trim((string) ($homeroom->wali_guru_nama ?? 'Guru')),
            'target_class_id' => $classId,
        ];
    }

    private function normalizeFeatures(array $features): array
    {
        return collect($features)
            ->map(fn ($value) => trim((string) $value))
            ->filter(fn ($value) => isset(self::FEATURES[$value]))
            ->unique()
            ->values()
            ->all();
    }

    private function optionsPayload(string $tenantId): array
    {
        return [
            'teachers' => $this->teacherOptions($tenantId),
            'positions' => $this->positionOptions($tenantId),
            'homerooms' => $this->homeroomOptions($tenantId),
        ];
    }

    private function featureOptions(): array
    {
        return collect(self::FEATURES)
            ->reject(fn ($meta) => (bool) ($meta['legacy'] ?? false))
            ->map(fn ($meta, $key) => ['key' => $key, 'label' => $meta['label'], 'path' => $meta['path']])
            ->values()
            ->all();
    }

    private function groupRows(array $rows): array
    {
        return collect($rows)
            ->groupBy(fn ($row) => implode('|', [
                $row['target_type'] ?? '',
                $row['target_teacher_id'] ?? '',
                $row['target_class_id'] ?? '',
            ]))
            ->map(function ($items) {
                $first = $items->first();
                $features = $items->map(fn ($row) => [
                    'id' => $row['id'],
                    'key' => $row['feature_key'],
                    'label' => $row['feature_label'],
                    'active' => (bool) $row['is_active'],
                ])->values();

                return [
                    'group_key' => implode('|', [
                        $first['target_type'] ?? '',
                        $first['target_teacher_id'] ?? '',
                        $first['target_class_id'] ?? '',
                    ]),
                    'target_type' => $first['target_type'] ?? '',
                    'target_label' => $first['target_label'] ?? '',
                    'target_teacher_id' => $first['target_teacher_id'] ?? '',
                    'target_class_id' => $first['target_class_id'] ?? '',
                    'features' => $features,
                    'active_count' => $features->where('active', true)->count(),
                    'inactive_count' => $features->where('active', false)->count(),
                ];
            })
            ->values()
            ->all();
    }

    private function formatPermissionRow(array $row): array
    {
        $featureKey = (string) ($row['feature_key'] ?? '');

        return [
            'id' => (string) ($row['id'] ?? ''),
            'target_type' => (string) ($row['target_type'] ?? ''),
            'target_teacher_id' => (string) ($row['target_teacher_id'] ?? ''),
            'target_class_id' => (string) ($row['target_class_id'] ?? ''),
            'target_label' => (string) ($row['target_label'] ?? ''),
            'feature_key' => $featureKey,
            'feature_label' => self::FEATURES[$featureKey]['label'] ?? $featureKey,
            'path' => self::FEATURES[$featureKey]['path'] ?? '',
            'is_active' => (bool) ($row['is_active'] ?? false),
            'updated_at' => (string) ($row['updated_at'] ?? ''),
        ];
    }

    private function teacherOptions(string $tenantId): array
    {
        return DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->whereIn('role', ['guru', 'teacher'])
            ->select('id', 'nama', 'email', 'jabatan', 'status')
            ->orderBy('nama')
            ->limit(1000)
            ->get()
            ->map(fn ($row) => [
                'id' => (string) $row->id,
                'nama' => (string) ($row->nama ?? 'Guru'),
                'email' => (string) ($row->email ?? ''),
                'jabatan' => (string) ($row->jabatan ?? ''),
                'status' => (string) ($row->status ?? 'active'),
                'has_position' => $this->teacherHasPosition($tenantId, (string) $row->id),
                'has_homeroom' => $this->teacherHasHomeroom($tenantId, (string) $row->id),
            ])
            ->values()
            ->all();
    }

    private function positionOptions(string $tenantId): array
    {
        if (! Schema::hasTable('struktur_sekolah')) {
            return [];
        }

        $query = DB::table('struktur_sekolah')
            ->where('tenant_id', $tenantId)
            ->select('id', 'jabatan', 'guru_id', 'guru_nama')
            ->orderBy('jabatan');
        $this->scopeActiveAcademicYear($query, 'struktur_sekolah', $tenantId);

        return $query
            ->get()
            ->map(fn ($row) => [
                'id' => (string) ($row->id ?? ''),
                'jabatan' => (string) ($row->jabatan ?? ''),
                'guru_id' => (string) ($row->guru_id ?? ''),
                'guru_nama' => (string) ($row->guru_nama ?? ''),
                'label' => trim((string) ($row->jabatan ?? 'Jabatan')).' - '.trim((string) ($row->guru_nama ?? 'Belum ada guru')),
            ])
            ->values()
            ->all();
    }

    private function homeroomOptions(string $tenantId): array
    {
        if (! Schema::hasTable('kelas_struktur')) {
            return [];
        }

        $query = DB::table('kelas_struktur')
            ->where('tenant_id', $tenantId)
            ->select('kelas_id', 'wali_guru_id', 'wali_guru_nama')
            ->orderBy('kelas_id');
        $this->scopeActiveAcademicYear($query, 'kelas_struktur', $tenantId);

        return $query
            ->get()
            ->map(fn ($row) => [
                'kelas_id' => (string) ($row->kelas_id ?? ''),
                'kelas_label' => $this->classLabel($tenantId, (string) ($row->kelas_id ?? '')),
                'wali_guru_id' => (string) ($row->wali_guru_id ?? ''),
                'wali_guru_nama' => (string) ($row->wali_guru_nama ?? ''),
                'label' => $this->classLabel($tenantId, (string) ($row->kelas_id ?? '')).' - '.trim((string) ($row->wali_guru_nama ?? 'Belum ada wali')),
            ])
            ->values()
            ->all();
    }

    private function teacherRow(string $tenantId, string $teacherId): ?object
    {
        if ($teacherId === '') {
            return null;
        }

        return DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('id', $teacherId)
            ->whereIn('role', ['guru', 'teacher'])
            ->first();
    }

    private function positionRow(string $tenantId, string $positionId): ?object
    {
        if ($positionId === '' || ! Schema::hasTable('struktur_sekolah')) {
            return null;
        }

        $query = DB::table('struktur_sekolah')
            ->where('tenant_id', $tenantId)
            ->where('id', $positionId);
        $this->scopeActiveAcademicYear($query, 'struktur_sekolah', $tenantId);

        return $query
            ->first();
    }

    private function homeroomRow(string $tenantId, string $classId): ?object
    {
        if ($classId === '' || ! Schema::hasTable('kelas_struktur')) {
            return null;
        }

        $query = DB::table('kelas_struktur')
            ->where('tenant_id', $tenantId)
            ->where('kelas_id', $classId);
        $this->scopeActiveAcademicYear($query, 'kelas_struktur', $tenantId);

        return $query
            ->first();
    }

    private function teacherHasPosition(string $tenantId, string $teacherId): bool
    {
        if ($teacherId === '' || ! Schema::hasTable('struktur_sekolah')) {
            return false;
        }

        $query = DB::table('struktur_sekolah')
            ->where('tenant_id', $tenantId)
            ->where('guru_id', $teacherId);
        $this->scopeActiveAcademicYear($query, 'struktur_sekolah', $tenantId);

        return $query->exists();
    }

    private function teacherHasHomeroom(string $tenantId, string $teacherId): bool
    {
        if ($teacherId === '' || ! Schema::hasTable('kelas_struktur')) {
            return false;
        }

        $query = DB::table('kelas_struktur')
            ->where('tenant_id', $tenantId)
            ->where('wali_guru_id', $teacherId);
        $this->scopeActiveAcademicYear($query, 'kelas_struktur', $tenantId);

        return $query->exists();
    }

    private function classLabel(string $tenantId, string $classId): string
    {
        if ($classId === '' || ! Schema::hasTable('kelas')) {
            return $classId ?: '-';
        }

        $columns = array_values(array_filter(['nama', 'grade', 'suffix', 'tingkat', 'jurusan'], fn ($column) => Schema::hasColumn('kelas', $column)));
        $row = DB::table('kelas')
            ->where('tenant_id', $tenantId)
            ->where('id', $classId)
            ->select($columns ?: ['id'])
            ->first();

        if (! $row) {
            return $classId;
        }

        $nama = trim((string) ($row->nama ?? ''));
        if ($nama !== '') {
            return $nama;
        }

        $grade = trim((string) ($row->grade ?? $row->tingkat ?? ''));
        $suffix = trim((string) ($row->suffix ?? $row->jurusan ?? ''));
        $label = trim($grade.' '.$suffix);

        return $label !== '' ? $label : $classId;
    }

    private function tenantPermissionQuery(string $tenantId)
    {
        return DB::table('admin_feature_permissions')->where('tenant_id', $tenantId);
    }

    private function tableReady(): bool
    {
        return Schema::hasTable('admin_feature_permissions');
    }

    private function tableUnavailableResponse(): JsonResponse
    {
        return $this->deny('Tabel permission admin belum tersedia. Jalankan migration production terlebih dahulu.', 503);
    }

    private function scopeActiveAcademicYear($query, string $table, string $tenantId): void
    {
        if (! Schema::hasColumn($table, 'tahun_ajaran')) {
            return;
        }

        $settingsColumns = array_values(array_filter([
            Schema::hasColumn('settings', 'tahun_ajaran') ? 'tahun_ajaran' : null,
            Schema::hasColumn('settings', 'semester_aktif') ? 'semester_aktif' : null,
        ]));
        $settings = Schema::hasTable('settings') && $settingsColumns !== []
            ? DB::table('settings')
                ->when(Schema::hasColumn('settings', 'tenant_id'), fn ($builder) => $builder->where('tenant_id', $tenantId))
                ->orderBy('id')
                ->first($settingsColumns)
            : null;
        $period = AcademicPeriod::fromSettings($settings);
        $year = AcademicPeriod::normalizeAcademicYear($period['tahun_ajaran'] ?? null);
        if ($year !== '') {
            $query->where('tahun_ajaran', $year);
        }
    }
}
