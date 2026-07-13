<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Academic\StoreTaskRequest;
use App\Http\Requests\Academic\UpdateTaskRequest;
use App\Services\Academic\AcademicContextResolver;
use App\Services\Academic\AcademicPeriodLifecycleService;
use App\Services\Academic\HistoricalEnrollmentResolver;
use App\Services\WhatsApp\WhatsAppNotificationService;
use App\Support\AcademicPeriod;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class TugasController extends ApiController
{
    public function __construct(
        private readonly AcademicContextResolver $academicContextResolver,
        private readonly AcademicPeriodLifecycleService $academicPeriodLifecycle,
        private readonly HistoricalEnrollmentResolver $historicalEnrollmentResolver,
        private readonly WhatsAppNotificationService $whatsAppNotificationService
    ) {}

    public function index(Request $request)
    {
        $tenantId = (string) ($this->tenantId($request) ?? '');
        $context = $this->academicContextResolver->forRead($request, $tenantId);
        $query = DB::table('tugas')->where('tenant_id', $tenantId);

        if ($this->isAdmin($request)) {
            // full
        } elseif ($this->isGuru($request)) {
            $query->where('created_by', $request->user()->id);
        } elseif ($this->isSiswa($request)) {
            $classId = $this->historicalEnrollmentResolver->resolve(
                $tenantId,
                (string) $request->user()->id,
                $context['tahun_ajaran'] ?? null,
                $context['semester'] ?? null,
                $this->currentKelas($request),
                $this->academicPeriodLifecycle->currentContext($tenantId)['tahun_ajaran'] ?? null
            );
            $classId ? $query->where('kelas', $classId) : $query->whereRaw('1 = 0');
        } else {
            return $this->deny();
        }

        if ($kelas = $request->query('kelas')) {
            $query->where('kelas', $kelas);
        }
        if ($mapel = $request->query('mapel')) {
            $query->where('mapel', $mapel);
        }
        if ($createdBy = $request->query('created_by')) {
            $query->where('created_by', $createdBy);
        }
        if ($gte = $request->query('deadline_gte')) {
            $query->where('deadline', '>=', $gte);
        }
        if ($lt = $request->query('deadline_lt')) {
            $query->where('deadline', '<', $lt);
        }
        if ($gteCreated = $request->query('created_gte')) {
            $query->where('created_at', '>=', $gteCreated);
        }
        if (Schema::hasColumn('tugas', 'tahun_ajaran')) {
            $query->where('tahun_ajaran', $context['tahun_ajaran']);
        }
        if (Schema::hasColumn('tugas', 'semester')) {
            $query->where('semester', $context['semester']);
        }

        $orderBy = in_array($request->query('order_by'), ['created_at', 'deadline', 'judul', 'mapel'], true)
            ? $request->query('order_by')
            : 'created_at';
        $order = strtolower((string) $request->query('order', 'desc')) === 'asc' ? 'asc' : 'desc';
        $query->orderBy($orderBy, $order);

        $this->applyPagination($query, $request);

        return response()->json(['data' => $query->get()]);
    }

    public function show(Request $request, string $id)
    {
        $tenantId = (string) ($this->tenantId($request) ?? '');
        $tugas = DB::table('tugas')->where('tenant_id', $tenantId)->where('id', $id)->first();
        if (! $tugas) {
            return $this->deny('Tugas tidak ditemukan', 404);
        }

        if ($this->isAdmin($request)) {
            return response()->json(['data' => $tugas]);
        }

        if ($this->isGuru($request) && $tugas->created_by === $request->user()->id) {
            return response()->json(['data' => $tugas]);
        }

        if ($this->isSiswa($request)) {
            $active = $this->academicPeriodLifecycle->currentContext($tenantId);
            $classId = $this->historicalEnrollmentResolver->resolve(
                $tenantId,
                (string) $request->user()->id,
                $tugas->tahun_ajaran ?? null,
                $tugas->semester ?? null,
                $this->currentKelas($request),
                $active['tahun_ajaran'] ?? null
            );
            if ((string) $tugas->kelas === (string) $classId) {
                return response()->json(['data' => $tugas]);
            }
        }

        return $this->deny();
    }

    public function store(StoreTaskRequest $request)
    {
        if (! $this->isGuru($request) && ! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = (string) ($this->tenantId($request) ?? '');
        $period = $this->academicPeriodLifecycle->currentContext($tenantId);
        $payload = $request->validated();
        if (! $this->isAdmin($request) && ! $this->teacherOwnsTaskAssignment(
            $tenantId,
            (string) $request->user()->id,
            (string) $payload['kelas'],
            (string) $payload['mapel'],
            (string) ($period['tahun_ajaran'] ?? '')
        )) {
            return $this->deny('Kelas dan mata pelajaran tidak sesuai penugasan guru.', 422);
        }

        $timelineError = $this->validateTaskTimeline($tenantId, $period, $payload['mulai'], $payload['deadline']);
        if ($timelineError !== null) {
            return $this->deny($timelineError, 422);
        }

        $payload['tenant_id'] = $tenantId;
        $payload['created_by'] = (string) $request->user()->id;
        $payload['tahun_ajaran'] = $period['tahun_ajaran'];
        $payload['semester'] = $period['semester'];
        if (Schema::hasColumn('tugas', 'academic_year_id')) {
            $payload['academic_year_id'] = $period['academic_year_id'] ?? null;
        }
        if (Schema::hasColumn('tugas', 'academic_term_id')) {
            $payload['academic_term_id'] = $period['academic_term_id'] ?? null;
        }
        $payload['created_at'] = now();
        $payload['updated_at'] = now();
        $payload = $this->existingTaskPayload($payload);
        $id = DB::table('tugas')->insertGetId($payload);
        $row = DB::table('tugas')->where('tenant_id', $tenantId)->where('id', $id)->first();

        $this->logAudit($request, 'tugas', (string) $id, 'CREATE', null, [
            'academic_context' => $period,
            'row' => (array) $row,
        ], $tenantId);

        return response()->json(['data' => $row], 201);
    }

    public function update(UpdateTaskRequest $request, string $id)
    {
        $tenantId = (string) ($this->tenantId($request) ?? '');
        $tugas = DB::table('tugas')->where('tenant_id', $tenantId)->where('id', $id)->first();
        if (! $tugas) {
            return $this->deny('Tugas tidak ditemukan', 404);
        }

        $period = $this->academicPeriodLifecycle->currentContext($tenantId);
        if (! $this->taskMatchesPeriod($tugas, $period)) {
            return response()->json([
                'error' => 'Tugas periode arsip terkunci.',
                'code' => 'academic_period_locked',
            ], 409);
        }

        if ($this->isAdmin($request)) {
            // ok
        } elseif ($this->isGuru($request) && $tugas->created_by === $request->user()->id) {
            // ok
        } else {
            return $this->deny();
        }

        $payload = $request->validated();
        $kelas = (string) ($payload['kelas'] ?? $tugas->kelas);
        $mapel = (string) ($payload['mapel'] ?? $tugas->mapel);
        if (! $this->isAdmin($request) && ! $this->teacherOwnsTaskAssignment(
            $tenantId,
            (string) $request->user()->id,
            $kelas,
            $mapel,
            (string) ($period['tahun_ajaran'] ?? '')
        )) {
            return $this->deny('Kelas dan mata pelajaran tidak sesuai penugasan guru.', 422);
        }

        $startsAt = $payload['mulai'] ?? $tugas->mulai ?? $tugas->created_at;
        $deadlineAt = $payload['deadline'] ?? $tugas->deadline;
        $timelineError = $this->validateTaskTimeline($tenantId, $period, $startsAt, $deadlineAt);
        if ($timelineError !== null) {
            return $this->deny($timelineError, 422);
        }

        $payload['updated_at'] = now();
        $payload = $this->existingTaskPayload($payload);
        DB::table('tugas')->where('tenant_id', $tenantId)->where('id', $id)->update($payload);
        $row = DB::table('tugas')->where('tenant_id', $tenantId)->where('id', $id)->first();

        $this->logAudit($request, 'tugas', (string) $id, 'UPDATE', [
            'academic_context' => $period,
            'row' => (array) $tugas,
        ], [
            'academic_context' => $period,
            'row' => (array) $row,
        ], $tenantId);

        return response()->json(['data' => $row]);
    }

    public function destroy(Request $request, string $id)
    {
        $tenantId = (string) ($this->tenantId($request) ?? '');
        $tugas = DB::table('tugas')->where('tenant_id', $tenantId)->where('id', $id)->first();
        if (! $tugas) {
            return $this->deny('Tugas tidak ditemukan', 404);
        }

        $period = $this->academicPeriodLifecycle->currentContext($tenantId);
        if (! $this->taskMatchesPeriod($tugas, $period)) {
            return response()->json([
                'error' => 'Tugas periode arsip terkunci.',
                'code' => 'academic_period_locked',
            ], 409);
        }

        if ($this->isAdmin($request) || ($this->isGuru($request) && $tugas->created_by === $request->user()->id)) {
            if (DB::table('tugas_jawaban')->where('tenant_id', $tenantId)->where('tugas_id', $id)->whereNotNull('nilai')->exists()) {
                return $this->deny('Tugas yang sudah memiliki nilai tidak boleh dihapus.', 422);
            }

            DB::table('tugas')->where('tenant_id', $tenantId)->where('id', $id)->delete();
            $this->logAudit($request, 'tugas', (string) $id, 'DELETE', [
                'academic_context' => $period,
                'row' => (array) $tugas,
            ], null, $tenantId);

            return response()->json(['data' => 'deleted']);
        }

        return $this->deny();
    }

    private function teacherOwnsTaskAssignment(
        string $tenantId,
        string $teacherId,
        string $classId,
        string $subject,
        string $academicYear
    ): bool {
        if (! Schema::hasTable('jadwal')) {
            return false;
        }

        $query = DB::table('jadwal')
            ->where('tenant_id', $tenantId)
            ->where('guru_id', $teacherId)
            ->where('kelas_id', $classId)
            ->whereRaw('lower(trim(mapel)) = ?', [strtolower(trim($subject))]);
        if (Schema::hasColumn('jadwal', 'tahun_ajaran')) {
            $query->where('tahun_ajaran', $academicYear);
        }

        return $query->exists();
    }

    private function validateTaskTimeline(
        string $tenantId,
        array $period,
        mixed $startsAt,
        mixed $deadlineAt
    ): ?string {
        try {
            $start = Carbon::parse($startsAt, 'Asia/Jakarta');
            $deadline = Carbon::parse($deadlineAt, 'Asia/Jakarta');
        } catch (\Throwable) {
            return 'Tanggal mulai atau deadline tidak valid.';
        }
        if ($deadline->lessThanOrEqualTo($start)) {
            return 'Deadline harus setelah waktu mulai.';
        }

        $term = null;
        if (! empty($period['academic_term_id']) && Schema::hasTable('academic_terms')) {
            $term = DB::table('academic_terms')
                ->where('tenant_id', $tenantId)
                ->where('id', $period['academic_term_id'])
                ->first(['starts_at', 'ends_at']);
        }
        $fallback = AcademicPeriod::make(
            $period['tahun_ajaran'] ?? null,
            $period['semester'] ?? null
        );
        $periodStart = Carbon::parse($term->starts_at ?? $fallback['starts_at'], 'Asia/Jakarta')->startOfDay();
        $periodEnd = Carbon::parse($term->ends_at ?? $fallback['ends_at'], 'Asia/Jakarta')->endOfDay();
        if ($start->lessThan($periodStart) || $deadline->greaterThan($periodEnd)) {
            return 'Jadwal tugas harus berada di dalam semester aktif.';
        }

        return null;
    }

    private function taskMatchesPeriod(object $task, array $period): bool
    {
        if (! Schema::hasColumn('tugas', 'tahun_ajaran') || ! Schema::hasColumn('tugas', 'semester')) {
            return true;
        }

        return AcademicPeriod::normalizeAcademicYear($task->tahun_ajaran ?? null) === ($period['tahun_ajaran'] ?? null)
            && AcademicPeriod::normalizeSemester($task->semester ?? null) === ($period['semester'] ?? null);
    }

    private function existingTaskPayload(array $payload): array
    {
        return array_filter(
            $payload,
            fn ($value, $column) => Schema::hasColumn('tugas', (string) $column),
            ARRAY_FILTER_USE_BOTH
        );
    }

    public function jawabanIndex(Request $request)
    {
        $query = DB::table('tugas_jawaban');

        if ($this->isAdmin($request)) {
            // full
        } elseif ($this->isGuru($request)) {
            $query->whereIn('tugas_id', function ($q) use ($request) {
                $q->select('id')->from('tugas')->where('created_by', $request->user()->id);
            });
        } else {
            $query->where('user_id', $request->user()->id);
        }

        if ($tugasId = $request->query('tugas_id')) {
            $query->where('tugas_id', $tugasId);
        }
        if ($userId = $request->query('user_id')) {
            $query->where('user_id', $userId);
        }

        $this->applyPagination($query, $request);

        return response()->json(['data' => $query->get()]);
    }

    public function jawabanStore(Request $request)
    {
        $payload = $request->all();
        $userId = $request->user()->id;

        if ($this->isSiswa($request)) {
            $payload['user_id'] = $userId;
        } elseif ($this->isGuru($request)) {
            // ensure guru owns tugas
            $tugas = DB::table('tugas')->where('id', $payload['tugas_id'] ?? null)->first();
            if (! $tugas || $tugas->created_by !== $userId) {
                return $this->deny();
            }
        } elseif (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $payload['waktu_submit'] = $payload['waktu_submit'] ?? now();
        DB::table('tugas_jawaban')->insert($payload);

        return response()->json(['data' => $payload], 201);
    }

    public function jawabanUpdate(Request $request, string $id)
    {
        $jawaban = DB::table('tugas_jawaban')->where('id', $id)->first();
        if (! $jawaban) {
            return $this->deny('Jawaban tidak ditemukan', 404);
        }

        $userId = $request->user()->id;
        if ($this->isAdmin($request)) {
            // ok
        } elseif ($this->isGuru($request)) {
            $tugas = DB::table('tugas')->where('id', $jawaban->tugas_id)->first();
            if (! $tugas || $tugas->created_by !== $userId) {
                return $this->deny();
            }
        } elseif ($this->isSiswa($request)) {
            if ($jawaban->user_id !== $userId) {
                return $this->deny();
            }
        } else {
            return $this->deny();
        }

        $payload = $request->all();
        DB::table('tugas_jawaban')->where('id', $id)->update($payload);
        $row = DB::table('tugas_jawaban')->where('id', $id)->first();

        return response()->json(['data' => $row]);
    }

    public function jawabanDestroy(Request $request, string $id)
    {
        $jawaban = DB::table('tugas_jawaban')->where('id', $id)->first();
        if (! $jawaban) {
            return $this->deny('Jawaban tidak ditemukan', 404);
        }

        $userId = $request->user()->id;
        if ($this->isAdmin($request)) {
            // ok
        } elseif ($this->isGuru($request)) {
            $tugas = DB::table('tugas')->where('id', $jawaban->tugas_id)->first();
            if (! $tugas || $tugas->created_by !== $userId) {
                return $this->deny();
            }
        } elseif ($this->isSiswa($request)) {
            if ($jawaban->user_id !== $userId) {
                return $this->deny();
            }
        } else {
            return $this->deny();
        }

        DB::table('tugas_jawaban')->where('id', $id)->delete();

        return response()->json(['data' => 'deleted']);
    }

    public function submitJawaban(Request $request)
    {
        if (! $this->isSiswa($request)) {
            return $this->deny();
        }

        $request->validate([
            'tugas_id' => ['required', 'integer', 'min:1'],
            'file_url' => ['nullable', 'string', 'max:2048'],
            'file_urls' => ['nullable', 'array', 'max:10'],
            'file_urls.*' => ['nullable', 'string', 'max:2048'],
            'link_url' => ['nullable', 'url:http,https', 'max:2048'],
            'file_name' => ['nullable', 'string', 'max:255'],
            'komentar_siswa' => ['nullable', 'string', 'max:500'],
        ]);

        $userId = (string) $request->user()->id;
        $tenantId = (string) ($this->tenantId($request) ?? $this->profileTenantId($request) ?? '');
        $tugasId = trim((string) $request->input('tugas_id', ''));
        $activePeriod = $this->academicPeriodLifecycle->currentContext($tenantId);
        $kelas = (string) ($this->historicalEnrollmentResolver->resolve(
            $tenantId,
            $userId,
            $activePeriod['tahun_ajaran'] ?? null,
            $activePeriod['semester'] ?? null,
            $this->currentKelas($request),
            $activePeriod['tahun_ajaran'] ?? null
        ) ?? '');

        if ($tenantId === '' || $kelas === '' || $tugasId === '') {
            return $this->deny('Tugas tidak diizinkan', 422);
        }

        $lockKey = 'assignment-submit|'.sha1($tenantId.'|'.$tugasId.'|'.$userId);
        $lock = Cache::lock($lockKey, 15);
        if (! $lock->get()) {
            return $this->deny('Jawaban sedang diproses. Tunggu beberapa detik lalu cek kembali.', 429);
        }

        try {
            $result = DB::transaction(function () use ($request, $tenantId, $kelas, $tugasId, $userId, $activePeriod) {
                $tugasQuery = DB::table('tugas')->where('id', $tugasId)->where('kelas', $kelas);
                $this->applyTenantColumnFilter($tugasQuery, 'tugas', $tenantId);
                $tugas = $tugasQuery->first();
                if (! $tugas) {
                    return ['error' => 'Tugas tidak diizinkan', 'status' => 422];
                }

                if (! $this->taskMatchesPeriod($tugas, $activePeriod)) {
                    return [
                        'error' => 'Tugas periode arsip terkunci dan tidak dapat dikumpulkan.',
                        'code' => 'academic_period_locked',
                        'status' => 409,
                    ];
                }

                $availabilityError = $this->tugasAvailabilityError($tugas);
                if ($availabilityError !== null) {
                    return ['error' => $availabilityError, 'status' => 422];
                }

                $existingQuery = DB::table('tugas_jawaban')
                    ->where('tugas_id', $tugasId)
                    ->where('user_id', $userId);
                $this->applyTenantColumnFilter($existingQuery, 'tugas_jawaban', $tenantId);
                $existing = $existingQuery->lockForUpdate()->first();

                if ($existing && $this->isJawabanDinilai($existing)) {
                    return ['error' => 'Jawaban yang sudah dinilai tidak boleh diubah', 'status' => 422];
                }

                $payload = $this->buildStudentAnswerPayload(
                    $request,
                    $tenantId,
                    $tugasId,
                    $userId,
                    $tugas,
                    $activePeriod
                );
                $beforeRows = $existing ? [(array) $existing] : [];

                if ($existing) {
                    $update = $payload;
                    unset($update['tugas_id'], $update['user_id'], $update['tenant_id']);

                    $target = DB::table('tugas_jawaban')->where('id', $existing->id);
                    $this->applyTenantColumnFilter($target, 'tugas_jawaban', $tenantId);
                    $target->update($update);

                    $id = $existing->id;
                    $action = 'update';
                } else {
                    $id = DB::table('tugas_jawaban')->insertGetId($payload);
                    $action = 'insert';
                }

                $rowQuery = DB::table('tugas_jawaban')->where('id', $id);
                $this->applyTenantColumnFilter($rowQuery, 'tugas_jawaban', $tenantId);
                $row = $rowQuery->first();

                $this->notifyTugasJawabanMutation($tenantId, $action, $beforeRows, $row ? [(array) $row] : []);

                return [
                    'row' => $row,
                    'before' => $beforeRows,
                    'action' => strtoupper($action),
                    'academic_context' => $activePeriod,
                ];
            });
        } finally {
            optional($lock)->release();
        }

        if (isset($result['error'])) {
            return response()->json([
                'error' => $result['error'],
                'code' => $result['code'] ?? 'assignment_submission_rejected',
            ], (int) ($result['status'] ?? 422));
        }

        $this->logAudit(
            $request,
            'tugas_jawaban',
            (string) ($result['row']->id ?? ''),
            (string) ($result['action'] ?? 'UPDATE'),
            [
                'academic_context' => $result['academic_context'] ?? $activePeriod,
                'rows' => $result['before'] ?? [],
            ],
            [
                'academic_context' => $result['academic_context'] ?? $activePeriod,
                'row' => (array) ($result['row'] ?? []),
            ],
            $tenantId
        );

        return response()->json(['data' => $result['row'] ?? null]);
    }

    private function applyTenantColumnFilter($query, string $table, string $tenantId): void
    {
        if ($tenantId !== '' && Schema::hasColumn($table, 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }
    }

    private function buildStudentAnswerPayload(
        Request $request,
        string $tenantId,
        string $tugasId,
        string $userId,
        object $task,
        array $period
    ): array {
        $payload = [
            'tugas_id' => $tugasId,
            'user_id' => $userId,
            'file_url' => $this->nullableTrimmedString($request->input('file_url')),
            'link_url' => $this->nullableUrl($request->input('link_url')),
            'file_name' => $this->nullableTrimmedString($request->input('file_name')),
            'waktu_submit' => now(),
            'status' => 'menunggu',
        ];

        if (Schema::hasColumn('tugas_jawaban', 'tenant_id') && $tenantId !== '') {
            $payload['tenant_id'] = $tenantId;
        }

        if (Schema::hasColumn('tugas_jawaban', 'file_urls')) {
            $fileUrls = $request->input('file_urls');
            $payload['file_urls'] = is_array($fileUrls)
                ? json_encode(array_values(array_filter(array_map(
                    fn ($value) => $this->nullableTrimmedString($value),
                    $fileUrls
                ))))
                : null;
        }

        if (Schema::hasColumn('tugas_jawaban', 'komentar_siswa')) {
            $comment = $this->nullableTrimmedString($request->input('komentar_siswa'));
            $payload['komentar_siswa'] = $comment ? mb_substr($comment, 0, 500) : null;
        }

        $serverPeriodValues = [
            'tahun_ajaran' => $period['tahun_ajaran'] ?? $task->tahun_ajaran ?? null,
            'semester' => $period['semester'] ?? $task->semester ?? null,
            'angkatan' => $task->angkatan ?? null,
            'academic_year_id' => $period['academic_year_id'] ?? $task->academic_year_id ?? null,
            'academic_term_id' => $period['academic_term_id'] ?? $task->academic_term_id ?? null,
        ];
        foreach ($serverPeriodValues as $column => $value) {
            if (Schema::hasColumn('tugas_jawaban', $column) && $value !== null && $value !== '') {
                $payload[$column] = $value;
            }
        }

        return array_filter(
            $payload,
            fn ($value, $key) => Schema::hasColumn('tugas_jawaban', (string) $key) && $value !== '',
            ARRAY_FILTER_USE_BOTH
        );
    }

    private function tugasAvailabilityError(object $tugas): ?string
    {
        $now = now();
        $mulai = $this->parseDateTime($tugas->mulai ?? $tugas->created_at ?? null);
        $deadline = $this->parseDateTime($tugas->deadline ?? null);

        if ($mulai && $now->lt($mulai)) {
            return 'Tugas belum dibuka';
        }

        if ($deadline && $now->gt($deadline)) {
            return 'Deadline tugas sudah lewat';
        }

        return null;
    }

    private function parseDateTime($value): ?Carbon
    {
        if (! $value) {
            return null;
        }

        try {
            return Carbon::parse($value);
        } catch (\Throwable) {
            return null;
        }
    }

    private function isJawabanDinilai(object $row): bool
    {
        return $row->nilai !== null || strtolower((string) ($row->status ?? '')) === 'dinilai';
    }

    private function nullableTrimmedString($value): ?string
    {
        $text = trim((string) ($value ?? ''));

        return $text === '' ? null : $text;
    }

    private function nullableUrl($value): ?string
    {
        $url = $this->nullableTrimmedString($value);
        if (! $url) {
            return null;
        }

        return filter_var($url, FILTER_VALIDATE_URL) ? $url : null;
    }

    private function notifyTugasJawabanMutation(string $tenantId, string $action, array $beforeRows, array $afterRows): void
    {
        if ($tenantId === '') {
            return;
        }

        try {
            $this->whatsAppNotificationService->handleTableMutation(
                $tenantId,
                'tugas_jawaban',
                $action,
                $beforeRows,
                $afterRows
            );
        } catch (\Throwable) {
            // Notifikasi tidak boleh menghambat submit jawaban siswa.
        }
    }
}
