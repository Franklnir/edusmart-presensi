<?php

namespace App\Services\WhatsApp;

use App\Jobs\SendWhatsAppMessageJob;
use App\Models\WhatsAppMessageLog;
use App\Models\WhatsAppNotificationSetting;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class WhatsAppNotificationService
{
    private const PROFILE_FIELDS = [
        'nama' => 'Nama',
        'nis' => 'NIS',
        'kelas' => 'Kelas',
        'jk' => 'Jenis kelamin',
        'alamat' => 'Alamat',
        'email' => 'Email',
        'no_hp_siswa' => 'No. HP siswa',
        'no_hp_wali' => 'No. HP wali',
        'status' => 'Status akun',
        'tanggal_lahir' => 'Tanggal lahir',
    ];

    public function __construct(
        private readonly WhatsAppIntegrationService $integrationService,
        private readonly WhatsAppMessageBuilder $messageBuilder
    ) {}

    public function handleTableMutation(
        string $tenantId,
        string $table,
        string $action,
        array $beforeRows = [],
        array $afterRows = []
    ): void {
        if (trim($tenantId) === '') {
            return;
        }

        $table = strtolower(trim($table));
        $action = strtolower(trim($action));

        match ($table) {
            'absensi' => $this->handleAttendanceMutation($tenantId, $afterRows),
            'profiles' => $this->handleProfileMutation($tenantId, $action, $beforeRows, $afterRows),
            'tugas_jawaban' => $this->handleAssignmentMutation($tenantId, $action, $beforeRows, $afterRows),
            'quiz_submissions' => $this->handleQuizSubmissionMutation($tenantId, $action, $beforeRows, $afterRows),
            'absensi_eskul', 'ekskul_anggota' => $this->handleExtracurricularMutation($tenantId, $table, $action, $afterRows),
            default => null,
        };
    }

    public function handleRfidAttendanceResult(string $tenantId, array $rfidResult): void
    {
        $attendanceId = trim((string) ($rfidResult['absen_id'] ?? ''));
        if ($attendanceId === '') {
            return;
        }

        $attendance = DB::table('absensi')
            ->where('tenant_id', $tenantId)
            ->where('id', $attendanceId)
            ->first();

        if (! $attendance) {
            return;
        }

        $this->handleAttendanceMutation($tenantId, [(array) $attendance]);
    }

    public function queueTestMessage(string $tenantId, string $number, ?string $customMessage = null): WhatsAppMessageLog
    {
        $context = $this->notificationContext($tenantId);
        if (! $context) {
            throw new \RuntimeException('Pengaturan WhatsApp tenant belum siap.');
        }

        $normalizedPhone = $this->normalizePhone($number);
        if ($normalizedPhone === '') {
            throw new \RuntimeException('Nomor WhatsApp tujuan tidak valid.');
        }

        $message = trim((string) $customMessage);
        if ($message === '') {
            $message = $this->messageBuilder->buildTestMessage($context['school']);
        }

        return $this->createQueuedLog(
            $context['integration']->tenant_id,
            $context['integration']->id,
            'test',
            'manual-test-'.(string) Str::uuid(),
            $message,
            [
                'source_table' => 'manual_test',
                'source_record_id' => 'manual-test',
                'target_profile_id' => null,
                'target_name' => 'Manual Test',
                'target_phone' => $number,
                'normalized_phone' => $normalizedPhone,
            ]
        );
    }

    private function handleAttendanceMutation(string $tenantId, array $rows): void
    {
        $context = $this->notificationContext($tenantId);
        if (! $context || ! $context['settings']->send_attendance) {
            return;
        }

        foreach ($rows as $row) {
            $attendance = (array) $row;
            $studentId = trim((string) ($attendance['uid'] ?? ''));
            if ($studentId === '') {
                continue;
            }

            $student = $this->studentProfile($tenantId, $studentId);
            if (! $student) {
                continue;
            }

            $message = $this->messageBuilder->buildAttendanceMessage(
                $context['school'],
                $student,
                $attendance
            );

            $eventKey = implode(':', [
                'attendance',
                $studentId,
                (string) ($attendance['tanggal'] ?? ''),
                (string) ($attendance['mapel'] ?? ''),
                (string) ($attendance['status'] ?? ''),
            ]);

            $this->queueForRecipients(
                $context['integration']->tenant_id,
                $context['integration']->id,
                $context['settings'],
                $student,
                'attendance',
                $eventKey,
                $message,
                'absensi',
                (string) ($attendance['id'] ?? $eventKey)
            );
        }
    }

    private function handleProfileMutation(string $tenantId, string $action, array $beforeRows, array $afterRows): void
    {
        $context = $this->notificationContext($tenantId);
        if (! $context || ! $context['settings']->send_profile_updates) {
            return;
        }

        $beforeMap = $this->rowsByKey($beforeRows, 'id');
        $afterMap = $this->rowsByKey($afterRows, 'id');

        foreach ($afterMap as $id => $afterRow) {
            $student = (array) $afterRow;
            if (($student['role'] ?? null) !== 'siswa') {
                continue;
            }

            $before = (array) ($beforeMap[$id] ?? []);
            $changes = $this->describeProfileChanges($before, $student, $action);
            if (empty($changes)) {
                continue;
            }

            $message = $this->messageBuilder->buildProfileUpdateMessage(
                $context['school'],
                $student,
                $changes
            );

            $eventKey = 'profile-update:'.$id.':'.sha1(json_encode($changes, JSON_UNESCAPED_UNICODE));

            $this->queueForRecipients(
                $context['integration']->tenant_id,
                $context['integration']->id,
                $context['settings'],
                $student,
                'profile_update',
                $eventKey,
                $message,
                'profiles',
                (string) $id
            );
        }
    }

    private function handleAssignmentMutation(string $tenantId, string $action, array $beforeRows, array $afterRows): void
    {
        $context = $this->notificationContext($tenantId);
        if (! $context) {
            return;
        }

        $beforeMap = $this->rowsByKey($beforeRows, 'id', ['tugas_id', 'user_id']);
        foreach ($afterRows as $row) {
            $after = (array) $row;
            $key = $this->rowKey($after, 'id', ['tugas_id', 'user_id']);
            if ($key === '') {
                continue;
            }

            $before = (array) ($beforeMap[$key] ?? []);
            $studentId = trim((string) ($after['user_id'] ?? ''));
            if ($studentId === '') {
                continue;
            }

            $student = $this->studentProfile($tenantId, $studentId);
            if (! $student) {
                continue;
            }

            $task = $this->taskMeta($tenantId, (string) ($after['tugas_id'] ?? ''));

            if (
                $context['settings']->send_assignment_updates
                && ($action === 'insert' || $this->hasAnyFieldChanged($before, $after, [
                    'file_url', 'link_url', 'file_name', 'status', 'waktu_submit',
                ]))
            ) {
                $message = $this->messageBuilder->buildAssignmentSubmissionMessage(
                    $context['school'],
                    $student,
                    $task,
                    $after
                );
                $eventKey = 'assignment-submit:'.$key.':'.sha1(json_encode([
                    $after['file_url'] ?? null,
                    $after['link_url'] ?? null,
                    $after['status'] ?? null,
                    $after['waktu_submit'] ?? null,
                ]));

                $this->queueForRecipients(
                    $context['integration']->tenant_id,
                    $context['integration']->id,
                    $context['settings'],
                    $student,
                    'assignment',
                    $eventKey,
                    $message,
                    'tugas_jawaban',
                    (string) ($after['id'] ?? $key)
                );
            }

            if (
                $context['settings']->send_grade_updates
                && array_key_exists('nilai', $after)
                && $after['nilai'] !== null
                && ((string) ($before['nilai'] ?? '') !== (string) $after['nilai'])
            ) {
                $message = $this->messageBuilder->buildGradeMessage(
                    $context['school'],
                    $student,
                    [
                        'source' => 'Tugas',
                        'title' => $task['judul'] ?? '-',
                        'mapel' => $task['mapel'] ?? '-',
                        'score' => (string) $after['nilai'],
                        'updated_at' => $after['dinilai_at'] ?? $after['updated_at'] ?? now(),
                    ]
                );
                $eventKey = 'assignment-grade:'.$key.':'.$after['nilai'];

                $this->queueForRecipients(
                    $context['integration']->tenant_id,
                    $context['integration']->id,
                    $context['settings'],
                    $student,
                    'grade',
                    $eventKey,
                    $message,
                    'tugas_jawaban',
                    (string) ($after['id'] ?? $key)
                );
            }
        }
    }

    private function handleQuizSubmissionMutation(string $tenantId, string $action, array $beforeRows, array $afterRows): void
    {
        $context = $this->notificationContext($tenantId);
        if (! $context || ! $context['settings']->send_grade_updates) {
            return;
        }

        $beforeMap = $this->rowsByKey($beforeRows, 'id', ['quiz_id', 'siswa_id']);

        foreach ($afterRows as $row) {
            $after = (array) $row;
            $key = $this->rowKey($after, 'id', ['quiz_id', 'siswa_id']);
            if ($key === '' || ($after['score'] ?? null) === null) {
                continue;
            }

            $before = (array) ($beforeMap[$key] ?? []);
            if (
                $action !== 'insert'
                && (string) ($before['score'] ?? '') === (string) ($after['score'] ?? '')
                && (string) ($before['status'] ?? '') === (string) ($after['status'] ?? '')
            ) {
                continue;
            }

            $studentId = trim((string) ($after['siswa_id'] ?? ''));
            $student = $this->studentProfile($tenantId, $studentId);
            if (! $student) {
                continue;
            }

            $quiz = $this->quizMeta($tenantId, (string) ($after['quiz_id'] ?? ''));
            $message = $this->messageBuilder->buildGradeMessage(
                $context['school'],
                $student,
                [
                    'source' => 'Quiz',
                    'title' => $quiz['nama'] ?? '-',
                    'mapel' => $quiz['mapel'] ?? '-',
                    'score' => (string) $after['score'],
                    'updated_at' => $after['updated_at'] ?? now(),
                ]
            );
            $eventKey = 'quiz-grade:'.$key.':'.$after['score'].':'.($after['status'] ?? '');

            $this->queueForRecipients(
                $context['integration']->tenant_id,
                $context['integration']->id,
                $context['settings'],
                $student,
                'grade',
                $eventKey,
                $message,
                'quiz_submissions',
                (string) ($after['id'] ?? $key)
            );
        }
    }

    private function handleExtracurricularMutation(string $tenantId, string $table, string $action, array $rows): void
    {
        $context = $this->notificationContext($tenantId);
        if (! $context || ! $context['settings']->send_extracurricular_updates) {
            return;
        }

        foreach ($rows as $row) {
            $payload = (array) $row;
            $studentId = trim((string) ($payload['user_id'] ?? ''));
            if ($studentId === '') {
                continue;
            }

            $student = $this->studentProfile($tenantId, $studentId);
            if (! $student) {
                continue;
            }

            $title = $this->extracurricularTitle($tenantId, (string) ($payload['ekskul_id'] ?? ''));
            $status = $table === 'ekskul_anggota'
                ? ($action === 'delete' ? 'Keanggotaan dihapus' : 'Terdaftar')
                : (string) ($payload['status'] ?? 'Update');

            $message = $this->messageBuilder->buildExtracurricularMessage(
                $context['school'],
                $student,
                [
                    'title' => $title,
                    'status' => $status,
                    'tanggal' => $payload['tanggal'] ?? now()->toDateString(),
                ]
            );

            $eventKey = $table.':'.$studentId.':'.($payload['ekskul_id'] ?? '').':'.sha1(json_encode([
                $payload['status'] ?? $status,
                $payload['tanggal'] ?? null,
                $action,
            ]));

            $this->queueForRecipients(
                $context['integration']->tenant_id,
                $context['integration']->id,
                $context['settings'],
                $student,
                'extracurricular',
                $eventKey,
                $message,
                $table,
                (string) ($payload['id'] ?? $eventKey)
            );
        }
    }

    private function notificationContext(string $tenantId): ?array
    {
        $integration = $this->integrationService->getOrCreateIntegration($tenantId);
        $settings = $this->integrationService->getOrCreateNotificationSettings($tenantId, $integration);

        if (! $integration->is_enabled || ! $settings->is_enabled) {
            return null;
        }

        return [
            'integration' => $integration,
            'settings' => $settings,
            'school' => $this->integrationService->schoolSettings($tenantId),
        ];
    }

    private function queueForRecipients(
        string $tenantId,
        ?string $integrationId,
        WhatsAppNotificationSetting $settings,
        array $student,
        string $category,
        string $eventKey,
        string $message,
        string $sourceTable,
        string $sourceRecordId
    ): void {
        $recipients = $this->recipientsForStudent($student, $settings);
        if (empty($recipients)) {
            $this->createQueuedLog(
                $tenantId,
                $integrationId,
                $category,
                $eventKey,
                $message,
                [
                    'source_table' => $sourceTable,
                    'source_record_id' => $sourceRecordId,
                    'target_profile_id' => $student['id'] ?? null,
                    'target_name' => $student['nama'] ?? null,
                    'target_phone' => null,
                    'normalized_phone' => 'missing',
                    'status' => 'skipped',
                    'last_error' => 'Nomor WhatsApp tujuan belum tersedia.',
                ],
                false
            );

            return;
        }

        foreach ($recipients as $recipient) {
            $this->createQueuedLog(
                $tenantId,
                $integrationId,
                $category,
                $eventKey,
                $message,
                [
                    'source_table' => $sourceTable,
                    'source_record_id' => $sourceRecordId,
                    'target_profile_id' => $student['id'] ?? null,
                    'target_name' => $recipient['name'],
                    'target_phone' => $recipient['raw'],
                    'normalized_phone' => $recipient['normalized'],
                ]
            );
        }
    }

    private function createQueuedLog(
        string $tenantId,
        ?string $integrationId,
        string $category,
        string $eventKey,
        string $message,
        array $overrides = [],
        bool $dispatch = true
    ): WhatsAppMessageLog {
        $status = $overrides['status'] ?? 'queued';

        $log = WhatsAppMessageLog::query()->firstOrCreate(
            [
                'tenant_id' => $tenantId,
                'event_key' => $eventKey,
                'normalized_phone' => (string) ($overrides['normalized_phone'] ?? 'missing'),
            ],
            array_merge([
                'id' => (string) Str::uuid(),
                'integration_id' => $integrationId,
                'category' => $category,
                'message_text' => $message,
                'status' => $status,
                'attempt_count' => 0,
                'queued_at' => $status === 'queued' ? now() : null,
                'failed_at' => $status === 'failed' ? now() : null,
            ], $overrides)
        );

        if ($dispatch && $log->wasRecentlyCreated && $log->status === 'queued') {
            SendWhatsAppMessageJob::dispatch($log->id)->afterCommit();
        }

        return $log;
    }

    private function recipientsForStudent(array $student, WhatsAppNotificationSetting $settings): array
    {
        $mode = strtolower(trim((string) $settings->recipient_mode));
        $recipients = [];

        if (in_array($mode, ['wali', 'wali_and_student'], true)) {
            $normalized = $this->normalizePhone((string) ($student['no_hp_wali'] ?? ''));
            if ($normalized !== '') {
                $recipients[] = [
                    'name' => 'Wali '.($student['nama'] ?? 'Siswa'),
                    'raw' => (string) ($student['no_hp_wali'] ?? ''),
                    'normalized' => $normalized,
                ];
            }
        }

        if (in_array($mode, ['siswa', 'wali_and_student'], true)) {
            $studentPhone = (string) ($student['no_hp_siswa'] ?? $student['telp'] ?? '');
            $normalized = $this->normalizePhone($studentPhone);
            if ($normalized !== '') {
                $recipients[] = [
                    'name' => (string) ($student['nama'] ?? 'Siswa'),
                    'raw' => $studentPhone,
                    'normalized' => $normalized,
                ];
            }
        }

        $deduped = [];
        $seen = [];
        foreach ($recipients as $recipient) {
            $key = $recipient['normalized'];
            if ($key === '' || isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $deduped[] = $recipient;
        }

        return $deduped;
    }

    private function normalizePhone(string $value): string
    {
        $digits = preg_replace('/\D+/', '', $value) ?? '';
        if ($digits === '') {
            return '';
        }

        if (str_starts_with($digits, '0')) {
            $digits = '62'.substr($digits, 1);
        } elseif (str_starts_with($digits, '8')) {
            $digits = '62'.$digits;
        }

        if (! str_starts_with($digits, '62')) {
            return '';
        }

        return preg_match('/^62\d{8,14}$/', $digits) ? $digits : '';
    }

    private function studentProfile(string $tenantId, string $studentId): ?array
    {
        $row = DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('id', $studentId)
            ->first();

        return $row ? (array) $row : null;
    }

    private function taskMeta(string $tenantId, string $taskId): array
    {
        $row = DB::table('tugas')
            ->where('tenant_id', $tenantId)
            ->where('id', $taskId)
            ->first(['id', 'judul', 'mapel', 'deadline']);

        return $row ? (array) $row : [];
    }

    private function quizMeta(string $tenantId, string $quizId): array
    {
        $row = DB::table('quizzes')
            ->where('tenant_id', $tenantId)
            ->where('id', $quizId)
            ->first(['id', 'nama', 'mapel']);

        return $row ? (array) $row : [];
    }

    private function extracurricularTitle(string $tenantId, string $ekskulId): string
    {
        if ($ekskulId === '') {
            return 'Ekstrakurikuler';
        }

        $name = DB::table('ekskul')
            ->where('tenant_id', $tenantId)
            ->where('id', $ekskulId)
            ->value('nama');

        return trim((string) $name) ?: 'Ekstrakurikuler';
    }

    private function rowsByKey(array $rows, string $primaryKey, array $fallbackKeys = []): array
    {
        $result = [];
        foreach ($rows as $row) {
            $item = (array) $row;
            $key = $this->rowKey($item, $primaryKey, $fallbackKeys);
            if ($key !== '') {
                $result[$key] = $item;
            }
        }

        return $result;
    }

    private function rowKey(array $row, string $primaryKey, array $fallbackKeys = []): string
    {
        $primary = trim((string) ($row[$primaryKey] ?? ''));
        if ($primary !== '') {
            return $primary;
        }

        if (! empty($fallbackKeys)) {
            $parts = [];
            foreach ($fallbackKeys as $key) {
                $parts[] = trim((string) ($row[$key] ?? ''));
            }
            if (implode('', $parts) !== '') {
                return implode(':', $parts);
            }
        }

        return '';
    }

    private function describeProfileChanges(array $before, array $after, string $action): array
    {
        $changes = [];
        if ($action === 'insert' && empty($before)) {
            return ['Data siswa berhasil dibuat atau diaktifkan.'];
        }

        foreach (self::PROFILE_FIELDS as $field => $label) {
            $beforeValue = $this->stringifyValue($before[$field] ?? null);
            $afterValue = $this->stringifyValue($after[$field] ?? null);

            if ($beforeValue === $afterValue) {
                continue;
            }

            $changes[] = $label.": {$beforeValue} -> {$afterValue}";
        }

        return $changes;
    }

    private function stringifyValue($value): string
    {
        if ($value === null || $value === '') {
            return '-';
        }

        return trim((string) $value);
    }

    private function hasAnyFieldChanged(array $before, array $after, array $fields): bool
    {
        foreach ($fields as $field) {
            if (($before[$field] ?? null) !== ($after[$field] ?? null)) {
                return true;
            }
        }

        return false;
    }
}
