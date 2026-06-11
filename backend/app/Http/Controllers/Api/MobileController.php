<?php

namespace App\Http\Controllers\Api;

use App\Models\Profile;
use App\Services\Rfid\RfidIngressService;
use App\Support\Tenancy\TenantDomainService;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class MobileController extends ApiController
{
    public function __construct(
        private readonly TenantDomainService $tenantDomainService,
        private readonly RfidIngressService $rfidIngressService
    ) {}

    public function me(Request $request)
    {
        $context = $this->mobileContext($request);
        if ($context['response']) {
            return $context['response'];
        }

        return $this->ok([
            'profile' => $this->profilePayload($context['profile']),
            'tenant' => $this->tenantPayload($context['tenant'], $context['tenant_id']),
        ]);
    }

    public function dashboard(Request $request)
    {
        $context = $this->mobileContext($request);
        if ($context['response']) {
            return $context['response'];
        }

        return $context['role'] === 'guru'
            ? $this->guruDashboard($request)
            : $this->siswaDashboard($request);
    }

    public function guruDashboard(Request $request)
    {
        $context = $this->mobileContext($request, 'guru');
        if ($context['response']) {
            return $context['response'];
        }

        $today = $this->today();
        $schedules = $this->teacherSchedulesForDate($context['tenant_id'], (string) $context['profile']->id, $today);
        $classes = $schedules->pluck('kelas_id')->filter()->unique()->values();
        $attendanceDone = $schedules->filter(function ($schedule) use ($context, $today) {
            return $this->tenantQuery('absensi', $context['tenant_id'])
                ->where('tanggal', $today->toDateString())
                ->where('kelas', (string) ($schedule->kelas_id ?? ''))
                ->where('mapel', (string) ($schedule->mapel ?? ''))
                ->exists();
        })->count();

        $missingAttendance = 0;
        if ($classes->isNotEmpty() && Schema::hasTable('profiles')) {
            $studentTotal = DB::table('profiles')
                ->where('tenant_id', $context['tenant_id'])
                ->where('role', 'siswa')
                ->whereIn('kelas', $classes->all())
                ->count();
            $presentTotal = $this->tenantQuery('absensi', $context['tenant_id'])
                ->where('tanggal', $today->toDateString())
                ->whereIn('kelas', $classes->all())
                ->where('status', 'Hadir')
                ->count();
            $missingAttendance = max(0, $studentTotal - $presentTotal);
        }

        return $this->ok([
            'profile' => $this->profilePayload($context['profile']),
            'tenant' => $this->tenantPayload($context['tenant'], $context['tenant_id']),
            'summary' => [
                'today_classes' => $classes->count(),
                'attendance_done' => $attendanceDone,
                'missing_attendance' => $missingAttendance,
                'offline_queue' => 0,
            ],
            'schedules' => $schedules->values(),
        ]);
    }

    public function guruSchedulesToday(Request $request)
    {
        $context = $this->mobileContext($request, 'guru');
        if ($context['response']) {
            return $context['response'];
        }

        return $this->ok($this->teacherSchedulesForDate(
            $context['tenant_id'],
            (string) $context['profile']->id,
            $this->today()
        )->values());
    }

    public function guruClasses(Request $request)
    {
        $context = $this->mobileContext($request, 'guru');
        if ($context['response']) {
            return $context['response'];
        }

        if (! Schema::hasTable('jadwal')) {
            return $this->ok([]);
        }

        $rows = $this->tenantQuery('jadwal', $context['tenant_id'])
            ->where('guru_id', (string) $context['profile']->id)
            ->select($this->existingColumns('jadwal', ['kelas_id', 'mapel', 'guru_nama']))
            ->orderBy('kelas_id')
            ->orderBy('mapel')
            ->get()
            ->unique(fn ($row) => (string) ($row->kelas_id ?? '').'|'.(string) ($row->mapel ?? ''))
            ->values();

        $classIds = $rows->pluck('kelas_id')->filter()->unique()->values();
        $counts = $classIds->isEmpty() || ! Schema::hasTable('profiles')
            ? collect()
            : DB::table('profiles')
                ->where('tenant_id', $context['tenant_id'])
                ->where('role', 'siswa')
                ->whereIn('kelas', $classIds->all())
                ->select('kelas', DB::raw('COUNT(*) as total'))
                ->groupBy('kelas')
                ->pluck('total', 'kelas');

        return $this->ok($rows->map(fn ($row) => [
            'kelas_id' => (string) ($row->kelas_id ?? ''),
            'mapel' => (string) ($row->mapel ?? ''),
            'student_count' => (int) ($counts[(string) ($row->kelas_id ?? '')] ?? 0),
        ])->values());
    }

    public function guruClass(Request $request, string $id)
    {
        $context = $this->mobileContext($request, 'guru');
        if ($context['response']) {
            return $context['response'];
        }

        if (! $this->teacherCanAccessClass($context['tenant_id'], (string) $context['profile']->id, $id)) {
            return $this->deny('Kelas ini bukan kelas yang Anda ampu.', 403);
        }

        $students = Schema::hasTable('profiles')
            ? DB::table('profiles')
                ->where('tenant_id', $context['tenant_id'])
                ->where('role', 'siswa')
                ->where('kelas', $id)
                ->orderBy('nama')
                ->limit(200)
                ->get($this->existingColumns('profiles', ['id', 'nama', 'nis', 'kelas', 'photo_url', 'rfid_uid']))
            : collect();

        return $this->ok([
            'kelas_id' => $id,
            'students' => $students->map(fn ($row) => [
                'id' => (string) ($row->id ?? ''),
                'nama' => (string) ($row->nama ?? ''),
                'nis' => (string) ($row->nis ?? ''),
                'kelas' => (string) ($row->kelas ?? ''),
                'photo_url' => $row->photo_url ?? null,
                'has_rfid' => trim((string) ($row->rfid_uid ?? '')) !== '',
            ])->values(),
        ]);
    }

    public function guruAttendanceSummary(Request $request)
    {
        $context = $this->mobileContext($request, 'guru');
        if ($context['response']) {
            return $context['response'];
        }

        $today = $this->today()->toDateString();
        $schedules = $this->teacherSchedulesForDate($context['tenant_id'], (string) $context['profile']->id, $this->today());
        $classes = $schedules->pluck('kelas_id')->filter()->unique()->values();

        return $this->ok([
            'date' => $today,
            'summary' => $this->attendanceCounts($context['tenant_id'], $today, $classes->all()),
        ]);
    }

    public function guruRfidScan(Request $request)
    {
        $context = $this->mobileContext($request, 'guru');
        if ($context['response']) {
            return $context['response'];
        }

        $validated = $request->validate([
            'card_uid' => ['required', 'string', 'max:128'],
            'device_id' => ['nullable', 'string', 'max:191'],
            'event_id' => ['nullable', 'string', 'max:191'],
            'mode' => ['nullable', 'string', 'max:32'],
            'scanned_at' => ['nullable', 'date'],
        ]);

        $tenantSlug = $this->mobileTenantSlug($context, $request);
        if ($tenantSlug === '') {
            return $this->deny('Tenant sekolah tidak valid.', 400);
        }

        $deviceId = trim((string) ($validated['device_id'] ?? ''));
        if ($deviceId === '') {
            $deviceId = 'MOBILE_GURU_'.Str::slug((string) $context['profile']->id, '_');
        }

        $payload = array_merge($request->all(), [
            'mobile' => true,
            'teacher_id' => (string) $context['profile']->id,
            'tenant_slug' => $tenantSlug,
        ]);

        $result = $this->rfidIngressService->processScanByTenantSlug(
            tenantSlug: $tenantSlug,
            cardUid: (string) $validated['card_uid'],
            deviceId: $deviceId,
            mode: (string) ($validated['mode'] ?? ''),
            source: 'mobile-nfc',
            eventId: (string) ($validated['event_id'] ?? ''),
            scannedAt: (string) ($validated['scanned_at'] ?? ''),
            payload: $payload,
        );

        return response()->json($result['data'] ?? [], (int) ($result['status'] ?? 500));
    }

    public function guruRfidSync(Request $request)
    {
        $context = $this->mobileContext($request, 'guru');
        if ($context['response']) {
            return $context['response'];
        }

        $maxEvents = max(10, min(1000, (int) config('rfid.performance.sync_batch_max_events', 500)));
        $validated = $request->validate([
            'device_id' => ['nullable', 'string', 'max:191'],
            'events' => ['required', 'array', 'min:1', 'max:'.$maxEvents],
            'events.*.event_id' => ['nullable', 'string', 'max:191'],
            'events.*.scan_id' => ['nullable', 'string', 'max:191'],
            'events.*.device_id' => ['nullable', 'string', 'max:191'],
            'events.*.card_uid' => ['required', 'string', 'max:128'],
            'events.*.mode' => ['nullable', 'string', 'max:32'],
            'events.*.scanned_at' => ['nullable', 'date'],
            'events.*.timestamp' => ['nullable', 'date'],
        ]);

        $tenantSlug = $this->mobileTenantSlug($context, $request);
        if ($tenantSlug === '') {
            return $this->deny('Tenant sekolah tidak valid.', 400);
        }

        $deviceId = trim((string) ($validated['device_id'] ?? ''));
        if ($deviceId === '') {
            $deviceId = 'MOBILE_GURU_'.Str::slug((string) $context['profile']->id, '_');
        }

        $result = $this->rfidIngressService->syncBatchByTenantSlug(
            tenantSlug: $tenantSlug,
            events: (array) $validated['events'],
            deviceId: $deviceId,
            source: 'mobile-nfc-sync',
        );

        return response()->json($result['data'] ?? [], (int) ($result['status'] ?? 500));
    }

    public function siswaDashboard(Request $request)
    {
        $context = $this->mobileContext($request, 'siswa');
        if ($context['response']) {
            return $context['response'];
        }

        $profile = $context['profile'];
        $today = $this->today();
        $monthStart = $today->copy()->startOfMonth()->toDateString();
        $monthEnd = $today->copy()->endOfMonth()->toDateString();
        $attendance = $this->studentAttendanceCounts($context['tenant_id'], (string) $profile->id, $monthStart, $monthEnd);

        return $this->ok([
            'profile' => $this->profilePayload($profile),
            'tenant' => $this->tenantPayload($context['tenant'], $context['tenant_id']),
            'summary' => [
                'hadir' => $attendance['hadir'],
                'izin' => $attendance['izin'],
                'sakit' => $attendance['sakit'],
                'alpha' => $attendance['alpha'],
                'active_tasks' => $this->activeTaskCount($context['tenant_id'], (string) ($profile->kelas ?? '')),
                'active_quizzes' => $this->activeQuizCount($context['tenant_id'], (string) ($profile->kelas ?? '')),
            ],
        ]);
    }

    public function siswaAttendance(Request $request)
    {
        $context = $this->mobileContext($request, 'siswa');
        if ($context['response']) {
            return $context['response'];
        }

        $start = $this->validatedDate($request->query('start')) ?? $this->today()->copy()->startOfMonth();
        $end = $this->validatedDate($request->query('end')) ?? $this->today()->copy()->endOfMonth();

        return $this->ok([
            'start' => $start->toDateString(),
            'end' => $end->toDateString(),
            'summary' => $this->studentAttendanceCounts(
                $context['tenant_id'],
                (string) $context['profile']->id,
                $start->toDateString(),
                $end->toDateString()
            ),
        ]);
    }

    public function siswaSchedules(Request $request)
    {
        $context = $this->mobileContext($request, 'siswa');
        if ($context['response']) {
            return $context['response'];
        }

        if (! Schema::hasTable('jadwal')) {
            return $this->ok([]);
        }

        $rows = $this->tenantQuery('jadwal', $context['tenant_id'])
            ->where('kelas_id', (string) ($context['profile']->kelas ?? ''))
            ->select($this->existingColumns('jadwal', ['id', 'kelas_id', 'hari', 'mapel', 'guru_nama', 'jam_mulai', 'jam_selesai']))
            ->orderBy('hari')
            ->orderBy('jam_mulai')
            ->limit(80)
            ->get();

        return $this->ok($rows);
    }

    public function siswaTasks(Request $request)
    {
        $context = $this->mobileContext($request, 'siswa');
        if ($context['response']) {
            return $context['response'];
        }

        if (! Schema::hasTable('tugas')) {
            return $this->ok([]);
        }

        $tasks = $this->tenantQuery('tugas', $context['tenant_id'])
            ->where('kelas', (string) ($context['profile']->kelas ?? ''))
            ->select($this->existingColumns('tugas', ['id', 'judul', 'mapel', 'deadline', 'created_at']))
            ->orderByDesc('created_at')
            ->limit(50)
            ->get();

        $taskIds = $tasks->pluck('id')->map(fn ($id) => (string) $id)->all();
        $answers = empty($taskIds) || ! Schema::hasTable('tugas_jawaban')
            ? collect()
            : $this->tenantQuery('tugas_jawaban', $context['tenant_id'])
                ->where('user_id', (string) $context['profile']->id)
                ->whereIn('tugas_id', $taskIds)
                ->get($this->existingColumns('tugas_jawaban', ['tugas_id', 'status', 'nilai', 'waktu_submit']))
                ->keyBy(fn ($row) => (string) $row->tugas_id);

        return $this->ok($tasks->map(fn ($task) => [
            'id' => (string) $task->id,
            'judul' => (string) ($task->judul ?? ''),
            'mapel' => (string) ($task->mapel ?? ''),
            'deadline' => $task->deadline ?? null,
            'submitted' => $answers->has((string) $task->id),
            'answer' => $answers[(string) $task->id] ?? null,
        ])->values());
    }

    public function siswaGrades(Request $request)
    {
        $context = $this->mobileContext($request, 'siswa');
        if ($context['response']) {
            return $context['response'];
        }

        $items = collect();

        if (Schema::hasTable('tugas_jawaban')) {
            $taskGrades = $this->tenantQuery('tugas_jawaban', $context['tenant_id'])
                ->leftJoin('tugas as t', 'tugas_jawaban.tugas_id', '=', 't.id')
                ->where('tugas_jawaban.user_id', (string) $context['profile']->id)
                ->whereNotNull('tugas_jawaban.nilai')
                ->orderByDesc('tugas_jawaban.waktu_submit')
                ->limit(30)
                ->get([
                    'tugas_jawaban.id',
                    'tugas_jawaban.nilai as score',
                    't.judul as title',
                    't.mapel as mapel',
                ])
                ->map(fn ($row) => [
                    'id' => 'task-'.(string) $row->id,
                    'type' => 'Tugas',
                    'title' => (string) ($row->title ?? 'Tugas'),
                    'mapel' => (string) ($row->mapel ?? ''),
                    'score' => $row->score,
                ]);
            $items = $items->merge($taskGrades);
        }

        if (Schema::hasTable('quiz_submissions') && Schema::hasTable('quizzes')) {
            $quizGrades = $this->tenantQuery('quiz_submissions', $context['tenant_id'])
                ->leftJoin('quizzes as q', 'quiz_submissions.quiz_id', '=', 'q.id')
                ->where('quiz_submissions.siswa_id', (string) $context['profile']->id)
                ->whereNotNull('quiz_submissions.score')
                ->orderByDesc('quiz_submissions.updated_at')
                ->limit(30)
                ->get([
                    'quiz_submissions.id',
                    'quiz_submissions.score',
                    'q.nama as title',
                    'q.mapel as mapel',
                ])
                ->map(fn ($row) => [
                    'id' => 'quiz-'.(string) $row->id,
                    'type' => 'Quiz',
                    'title' => (string) ($row->title ?? 'Quiz'),
                    'mapel' => (string) ($row->mapel ?? ''),
                    'score' => $row->score,
                ]);
            $items = $items->merge($quizGrades);
        }

        return $this->ok(['items' => $items->take(60)->values()]);
    }

    public function siswaDigitalCard(Request $request)
    {
        $context = $this->mobileContext($request, 'siswa');
        if ($context['response']) {
            return $context['response'];
        }

        $expiresAt = now('Asia/Jakarta')->addMinutes(30);
        $payload = [
            'typ' => 'student_attendance_qr',
            'tid' => $context['tenant_id'],
            'sid' => (string) $context['profile']->id,
            'exp' => $expiresAt->timestamp,
            'nonce' => Str::random(20),
        ];
        $encoded = rtrim(strtr(base64_encode(json_encode($payload, JSON_THROW_ON_ERROR)), '+/', '-_'), '=');
        $signature = hash_hmac('sha256', $encoded, (string) config('app.key'));

        return $this->ok([
            'token' => $encoded.'.'.$signature,
            'expires_at' => $expiresAt->toIso8601String(),
            'student' => [
                'id' => (string) $context['profile']->id,
                'nama' => (string) ($context['profile']->nama ?? ''),
                'kelas' => (string) ($context['profile']->kelas ?? ''),
            ],
        ]);
    }

    private function mobileContext(Request $request, ?string $requiredRole = null): array
    {
        $profile = $this->profile($request);
        $tenantId = $this->tenantId($request);
        $role = strtolower(trim((string) ($profile?->role ?? '')));

        if (! $profile || ! $tenantId) {
            return ['response' => $this->deny('Profil mobile tidak valid.', 403)];
        }

        if (! in_array($role, ['guru', 'siswa'], true)) {
            return ['response' => $this->deny('Aplikasi mobile hanya untuk guru dan siswa.', 403)];
        }

        if ($requiredRole !== null && $role !== $requiredRole) {
            return ['response' => $this->deny('Role tidak sesuai untuk halaman mobile ini.', 403)];
        }

        if (($profile->status ?? 'active') === 'nonaktif') {
            return ['response' => $this->deny('Akun Anda sedang nonaktif.', 403)];
        }

        $tenant = Schema::hasTable('tenants')
            ? DB::table('tenants')->where('id', $tenantId)->first(['id', 'name', 'slug', 'status'])
            : null;

        return [
            'response' => null,
            'profile' => $profile,
            'tenant_id' => (string) $tenantId,
            'tenant' => $tenant,
            'role' => $role,
        ];
    }

    private function mobileTenantSlug(array $context, Request $request): string
    {
        $tenantSlug = strtolower(trim((string) ($context['tenant']->slug ?? '')));
        if ($tenantSlug !== '') {
            return $tenantSlug;
        }

        $tenantSlug = strtolower(trim((string) $request->header(config('tenancy.header', 'X-Tenant'), '')));
        if ($tenantSlug !== '') {
            return $tenantSlug;
        }

        if (! Schema::hasTable('tenants')) {
            return '';
        }

        return strtolower(trim((string) DB::table('tenants')
            ->where('id', (string) ($context['tenant_id'] ?? ''))
            ->value('slug')));
    }

    private function teacherSchedulesForDate(string $tenantId, string $teacherId, Carbon $date)
    {
        if (! Schema::hasTable('jadwal')) {
            return collect();
        }

        return $this->tenantQuery('jadwal', $tenantId)
            ->where('guru_id', $teacherId)
            ->where('hari', $this->indonesianDayName($date))
            ->select($this->existingColumns('jadwal', ['id', 'kelas_id', 'hari', 'mapel', 'jam_mulai', 'jam_selesai', 'guru_nama']))
            ->orderBy('jam_mulai')
            ->get();
    }

    private function teacherCanAccessClass(string $tenantId, string $teacherId, string $classId): bool
    {
        if (Schema::hasTable('jadwal') && $this->tenantQuery('jadwal', $tenantId)
            ->where('guru_id', $teacherId)
            ->where('kelas_id', $classId)
            ->exists()) {
            return true;
        }

        return Schema::hasTable('kelas_struktur')
            && $this->tenantQuery('kelas_struktur', $tenantId)
                ->where('wali_guru_id', $teacherId)
                ->where('kelas_id', $classId)
                ->exists();
    }

    private function activeTaskCount(string $tenantId, string $kelas): int
    {
        if (! Schema::hasTable('tugas') || $kelas === '') {
            return 0;
        }

        $query = $this->tenantQuery('tugas', $tenantId)->where('kelas', $kelas);
        if (Schema::hasColumn('tugas', 'deadline')) {
            $query->where(function ($subQuery) {
                $subQuery->whereNull('deadline')->orWhere('deadline', '>=', now('Asia/Jakarta'));
            });
        }

        return (int) $query->count();
    }

    private function activeQuizCount(string $tenantId, string $kelas): int
    {
        if (! Schema::hasTable('quizzes') || $kelas === '') {
            return 0;
        }

        return (int) $this->tenantQuery('quizzes', $tenantId)
            ->where('kelas_id', $kelas)
            ->where(function ($query) {
                $query->where('is_live', true)->orWhere('is_active', true);
            })
            ->count();
    }

    private function attendanceCounts(string $tenantId, string $date, array $classes = []): array
    {
        $base = ['hadir' => 0, 'izin' => 0, 'sakit' => 0, 'alpha' => 0];
        if (! Schema::hasTable('absensi')) {
            return $base;
        }

        $query = $this->tenantQuery('absensi', $tenantId)->where('tanggal', $date);
        if (! empty($classes)) {
            $query->whereIn('kelas', $classes);
        }

        foreach ($query->get(['status']) as $row) {
            $key = strtolower((string) ($row->status ?? ''));
            if (array_key_exists($key, $base)) {
                $base[$key]++;
            }
        }

        return $base;
    }

    private function studentAttendanceCounts(string $tenantId, string $studentId, string $start, string $end): array
    {
        $base = ['hadir' => 0, 'izin' => 0, 'sakit' => 0, 'alpha' => 0];
        if (! Schema::hasTable('absensi')) {
            return $base;
        }

        foreach ($this->tenantQuery('absensi', $tenantId)
            ->where('uid', $studentId)
            ->whereBetween('tanggal', [$start, $end])
            ->get(['status']) as $row) {
            $key = strtolower((string) ($row->status ?? ''));
            if (array_key_exists($key, $base)) {
                $base[$key]++;
            }
        }

        return $base;
    }

    private function profilePayload(Profile $profile): array
    {
        return [
            'id' => (string) $profile->id,
            'nama' => $profile->nama,
            'email' => $profile->email,
            'role' => strtolower((string) $profile->role),
            'kelas' => $profile->kelas,
            'nis' => $profile->nis,
            'photo_url' => $profile->photo_url,
        ];
    }

    private function tenantPayload(?object $tenant, string $tenantId): array
    {
        $settings = $this->tenantSettings($tenantId);
        $slug = (string) ($tenant->slug ?? '');
        $fallbackHost = (string) parse_url((string) config('app.frontend_url', config('app.url', '')), PHP_URL_HOST);
        $host = $slug !== ''
            ? $this->tenantDomainService->primaryTenantFrontendHost($tenantId, $slug, $fallbackHost)
            : $fallbackHost;

        return [
            'id' => $tenantId,
            'slug' => $slug,
            'name' => (string) ($settings?->nama_sekolah ?? $tenant->name ?? $slug),
            'host' => $host,
            'apiBaseUrl' => $host !== '' ? $this->tenantDomainService->makeUrl($host) : config('app.url'),
            'logoUrl' => $settings?->logo_url ?? null,
        ];
    }

    private function tenantSettings(string $tenantId): ?object
    {
        if (! Schema::hasTable('settings')) {
            return null;
        }

        $query = DB::table('settings')->orderBy('id');
        if (Schema::hasColumn('settings', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        return $query->first($this->existingColumns('settings', ['nama_sekolah', 'logo_url']));
    }

    private function tenantQuery(string $table, string $tenantId)
    {
        $query = DB::table($table);
        if (Schema::hasColumn($table, 'tenant_id')) {
            $query->where($table.'.tenant_id', $tenantId);
        }

        return $query;
    }

    private function existingColumns(string $table, array $columns): array
    {
        return array_values(array_filter($columns, fn ($column) => Schema::hasColumn($table, $column)));
    }

    private function today(): Carbon
    {
        return now('Asia/Jakarta');
    }

    private function validatedDate(mixed $value): ?Carbon
    {
        try {
            $text = trim((string) $value);

            return $text !== '' ? Carbon::parse($text, 'Asia/Jakarta') : null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function indonesianDayName(Carbon $date): string
    {
        return [
            1 => 'Senin',
            2 => 'Selasa',
            3 => 'Rabu',
            4 => 'Kamis',
            5 => 'Jumat',
            6 => 'Sabtu',
            7 => 'Minggu',
        ][$date->isoWeekday()] ?? 'Senin';
    }
}
