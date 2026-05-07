<?php

namespace App\Http\Controllers\Api;

use App\Support\AcademicPeriod;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use RuntimeException;

class AttendanceQrController extends ApiController
{
    private const TOKEN_PREFIX = 'ESPRESQR1.';

    private const TOKEN_TTL_SECONDS = 90;

    private const CLOCK_SKEW_SECONDS = 30;

    private const SCHOOL_TIMEZONE = 'Asia/Jakarta';

    private const DAYS = [
        0 => 'Minggu',
        1 => 'Senin',
        2 => 'Selasa',
        3 => 'Rabu',
        4 => 'Kamis',
        5 => 'Jumat',
        6 => 'Sabtu',
    ];

    private const MONTHS = [
        1 => 'Januari',
        2 => 'Februari',
        3 => 'Maret',
        4 => 'April',
        5 => 'Mei',
        6 => 'Juni',
        7 => 'Juli',
        8 => 'Agustus',
        9 => 'September',
        10 => 'Oktober',
        11 => 'November',
        12 => 'Desember',
    ];

    public function session(Request $request)
    {
        if (! $this->isGuru($request) && ! $this->isAdmin($request)) {
            return $this->deny('Hanya guru atau admin yang dapat menampilkan QR absensi.');
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->errorResponse('tenant_required', 'Tenant sekolah tidak valid.', 400);
        }

        $validated = $request->validate([
            'jadwal_id' => ['required', 'string', 'max:191'],
            'kelas_id' => ['required', 'string', 'max:191'],
        ]);

        $jadwal = $this->findSchedule(
            $tenantId,
            (string) $validated['jadwal_id'],
            (string) $validated['kelas_id']
        );

        if (! $jadwal) {
            return $this->errorResponse('schedule_not_found', 'Jadwal tidak ditemukan untuk sekolah ini.', 404);
        }

        if ($this->isGuru($request) && (string) ($jadwal->guru_id ?? '') !== (string) ($request->user()?->id ?? '')) {
            return $this->deny('Jadwal ini bukan milik guru yang sedang login.');
        }

        $now = Carbon::now(self::SCHOOL_TIMEZONE);
        $window = $this->activeClassWindow($jadwal, $now);
        if (! ($window['ok'] ?? false)) {
            return $this->errorResponse(
                (string) $window['reason'],
                (string) $window['message'],
                (int) $window['status'],
                $this->schedulePayload($jadwal, $now, $window)
            );
        }

        $expiresAt = $now->copy()->addSeconds(self::TOKEN_TTL_SECONDS);
        $payload = [
            'v' => 1,
            'typ' => 'attendance_qr',
            'tenant_id' => (string) $tenantId,
            'jadwal_id' => (string) $jadwal->id,
            'kelas_id' => (string) $jadwal->kelas_id,
            'mapel' => (string) $jadwal->mapel,
            'guru_id' => (string) ($jadwal->guru_id ?? ''),
            'date' => $now->toDateString(),
            'iat' => $now->timestamp,
            'exp' => $expiresAt->timestamp,
            'nonce' => Str::random(24),
        ];

        try {
            $token = $this->makeToken($payload);
        } catch (RuntimeException $e) {
            return $this->errorResponse('signing_key_missing', $e->getMessage(), 500);
        }

        return $this->ok([
            'success' => true,
            'token' => $token,
            'ttl_seconds' => self::TOKEN_TTL_SECONDS,
            'refresh_after_seconds' => 45,
            'issued_at' => $now->toIso8601String(),
            'expires_at' => $expiresAt->toIso8601String(),
            'schedule' => $this->schedulePayload($jadwal, $now, $window),
        ]);
    }

    public function scan(Request $request)
    {
        if (! $this->isSiswa($request)) {
            return $this->deny('Hanya siswa yang dapat scan QR absensi.');
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->errorResponse('tenant_required', 'Tenant sekolah tidak valid.', 400);
        }

        $validated = $request->validate([
            'token' => ['required', 'string', 'max:4096'],
        ]);

        $decoded = $this->decodeToken($this->extractToken((string) $validated['token']));
        if (! ($decoded['ok'] ?? false)) {
            return $this->errorResponse(
                (string) $decoded['reason'],
                (string) $decoded['message'],
                (int) $decoded['status']
            );
        }

        $payload = $decoded['payload'];
        $now = Carbon::now(self::SCHOOL_TIMEZONE);

        if ((string) ($payload['tenant_id'] ?? '') !== (string) $tenantId) {
            return $this->errorResponse('tenant_mismatch', 'QR ini bukan untuk sekolah tempat Anda login.', 403);
        }

        if ((int) ($payload['exp'] ?? 0) < $now->timestamp) {
            return $this->errorResponse('qr_expired', 'QR absensi sudah kedaluwarsa. Minta guru menampilkan QR terbaru.', 410);
        }

        if ((int) ($payload['iat'] ?? 0) > ($now->timestamp + self::CLOCK_SKEW_SECONDS)) {
            return $this->errorResponse('qr_invalid_time', 'Waktu QR tidak valid. Coba scan QR terbaru.', 422);
        }

        if ((string) ($payload['date'] ?? '') !== $now->toDateString()) {
            return $this->errorResponse('qr_wrong_date', 'QR absensi ini bukan untuk hari ini.', 422);
        }

        $profile = $this->profile($request);
        if (! $profile) {
            return $this->errorResponse('profile_missing', 'Profil siswa belum tersedia.', 403);
        }

        if ($this->isInactiveProfile($profile)) {
            return $this->errorResponse('inactive_profile', 'Akun siswa tidak aktif.', 403);
        }

        $kelasId = (string) ($payload['kelas_id'] ?? '');
        if ((string) ($profile->kelas ?? '') !== $kelasId) {
            return $this->errorResponse('class_mismatch', 'QR ini hanya berlaku untuk kelas '.$this->formatClassLabel($kelasId).'.', 403);
        }

        $jadwal = $this->findSchedule(
            $tenantId,
            (string) ($payload['jadwal_id'] ?? ''),
            $kelasId
        );

        if (! $jadwal) {
            return $this->errorResponse('schedule_not_found', 'Jadwal QR tidak ditemukan untuk sekolah ini.', 404);
        }

        if (
            (string) $jadwal->mapel !== (string) ($payload['mapel'] ?? '')
            || (string) ($jadwal->guru_id ?? '') !== (string) ($payload['guru_id'] ?? '')
        ) {
            return $this->errorResponse('schedule_changed', 'Data jadwal QR sudah berubah. Minta guru menampilkan QR terbaru.', 409);
        }

        $window = $this->activeClassWindow($jadwal, $now);
        if (! ($window['ok'] ?? false)) {
            return $this->errorResponse(
                (string) $window['reason'],
                (string) $window['message'],
                (int) $window['status'],
                $this->schedulePayload($jadwal, $now, $window)
            );
        }

        try {
            $result = DB::transaction(function () use ($tenantId, $profile, $jadwal, $now) {
                $existing = DB::table('absensi')
                    ->where('tenant_id', $tenantId)
                    ->where('kelas', $profile->kelas)
                    ->where('tanggal', $now->toDateString())
                    ->where('uid', $profile->id)
                    ->where('mapel', $jadwal->mapel)
                    ->lockForUpdate()
                    ->first();

                if ($existing) {
                    return ['existing' => $existing];
                }

                $insert = [
                    'tenant_id' => $tenantId,
                    'kelas' => $profile->kelas,
                    'tanggal' => $now->toDateString(),
                    'uid' => $profile->id,
                    'mapel' => $jadwal->mapel,
                    'status' => 'Hadir',
                    'nama' => $profile->nama,
                    'waktu' => $now,
                    'komentar' => 'Hadir via QR absensi',
                    'oleh' => 'qr:'.((string) ($jadwal->guru_id ?? '')),
                ];

                $period = $this->currentAcademicPeriodForTenant($tenantId);
                if (Schema::hasColumn('absensi', 'tahun_ajaran')) {
                    $insert['tahun_ajaran'] = $period['tahun_ajaran'];
                }
                if (Schema::hasColumn('absensi', 'semester')) {
                    $insert['semester'] = $period['semester'];
                }

                $id = DB::table('absensi')->insertGetId($insert);

                $row = DB::table('absensi')
                    ->where('tenant_id', $tenantId)
                    ->where('id', $id)
                    ->first();

                return ['row' => $row];
            });
        } catch (QueryException $e) {
            return $this->duplicateOrDatabaseError($tenantId, $profile, $jadwal, $now, $e);
        }

        if (! empty($result['existing'])) {
            $existingAt = $this->parseSchoolTime($result['existing']->waktu ?? null, $now);

            return response()->json([
                'success' => false,
                'reason' => 'already_attended',
                'error' => 'Anda sudah absen untuk mata pelajaran ini.',
                'data' => $this->attendancePayload($profile, $jadwal, $existingAt, (int) $result['existing']->id),
            ], 409);
        }

        $row = $result['row'] ?? null;
        $attendanceId = $row ? (int) $row->id : null;

        return $this->ok([
            'success' => true,
            'message' => 'Absensi QR berhasil.',
            ...$this->attendancePayload($profile, $jadwal, $now, $attendanceId),
        ]);
    }

    private function findSchedule(string $tenantId, string $scheduleId, string $classId): ?object
    {
        if ($scheduleId === '' || $classId === '') {
            return null;
        }

        return DB::table('jadwal')
            ->where('tenant_id', $tenantId)
            ->where('id', $scheduleId)
            ->where('kelas_id', $classId)
            ->first();
    }

    private function currentAcademicPeriodForTenant(?string $tenantId): array
    {
        $settings = null;
        if (Schema::hasTable('settings')) {
            $query = DB::table('settings')->orderBy('id');
            if ($tenantId && Schema::hasColumn('settings', 'tenant_id')) {
                $query->where('tenant_id', $tenantId);
            }
            $settings = $query->first(['tahun_ajaran', 'semester_aktif']);
        }

        return AcademicPeriod::fromSettings($settings);
    }

    private function activeClassWindow(object $jadwal, Carbon $now): array
    {
        $today = $now->toDateString();
        $start = $this->combineDateAndTime($today, (string) ($jadwal->jam_mulai ?? '00:00:00'));
        $end = $this->combineDateAndTime($today, (string) ($jadwal->jam_selesai ?? '00:00:00'));
        if ($end->lessThan($start)) {
            $end->addDay();
        }

        $todayName = $this->dayName($now);
        if (Str::lower((string) ($jadwal->hari ?? '')) !== Str::lower($todayName)) {
            return [
                'ok' => false,
                'status' => 422,
                'reason' => 'schedule_not_today',
                'message' => 'Jadwal ini bukan untuk hari '.$todayName.'.',
                'start' => $start,
                'end' => $end,
            ];
        }

        if ($now->lt($start)) {
            return [
                'ok' => false,
                'status' => 422,
                'reason' => 'class_not_started',
                'message' => 'Jam pelajaran belum dimulai.',
                'start' => $start,
                'end' => $end,
            ];
        }

        if ($now->gt($end)) {
            return [
                'ok' => false,
                'status' => 422,
                'reason' => 'class_ended',
                'message' => 'Jam pelajaran sudah selesai. Absensi QR ditutup.',
                'start' => $start,
                'end' => $end,
            ];
        }

        return [
            'ok' => true,
            'start' => $start,
            'end' => $end,
        ];
    }

    private function combineDateAndTime(string $date, string $time): Carbon
    {
        $cleanTime = trim($time);
        if ($cleanTime === '') {
            $cleanTime = '00:00:00';
        }

        return Carbon::parse($date.' '.$cleanTime, self::SCHOOL_TIMEZONE);
    }

    private function makeToken(array $payload): string
    {
        $body = $this->base64UrlEncode(json_encode($payload, JSON_UNESCAPED_SLASHES));
        $signature = hash_hmac('sha256', $body, $this->signingKey());

        return self::TOKEN_PREFIX.$body.'.'.$signature;
    }

    private function decodeToken(string $token): array
    {
        if (! str_starts_with($token, self::TOKEN_PREFIX)) {
            return [
                'ok' => false,
                'status' => 422,
                'reason' => 'qr_invalid',
                'message' => 'Format QR absensi tidak valid.',
            ];
        }

        $raw = substr($token, strlen(self::TOKEN_PREFIX));
        $parts = explode('.', $raw);
        if (count($parts) !== 2) {
            return [
                'ok' => false,
                'status' => 422,
                'reason' => 'qr_invalid',
                'message' => 'Format QR absensi tidak lengkap.',
            ];
        }

        [$body, $signature] = $parts;

        try {
            $expected = hash_hmac('sha256', $body, $this->signingKey());
        } catch (RuntimeException $e) {
            return [
                'ok' => false,
                'status' => 500,
                'reason' => 'signing_key_missing',
                'message' => $e->getMessage(),
            ];
        }

        if (! hash_equals($expected, $signature)) {
            return [
                'ok' => false,
                'status' => 422,
                'reason' => 'qr_signature_invalid',
                'message' => 'Tanda tangan QR tidak valid.',
            ];
        }

        $json = $this->base64UrlDecode($body);
        if ($json === null) {
            return [
                'ok' => false,
                'status' => 422,
                'reason' => 'qr_invalid_payload',
                'message' => 'Payload QR tidak dapat dibaca.',
            ];
        }

        $payload = json_decode($json, true);
        if (! is_array($payload) || ($payload['typ'] ?? '') !== 'attendance_qr' || (int) ($payload['v'] ?? 0) !== 1) {
            return [
                'ok' => false,
                'status' => 422,
                'reason' => 'qr_invalid_payload',
                'message' => 'Payload QR absensi tidak valid.',
            ];
        }

        return [
            'ok' => true,
            'payload' => $payload,
        ];
    }

    private function extractToken(string $raw): string
    {
        $value = trim($raw);

        if (filter_var($value, FILTER_VALIDATE_URL)) {
            $query = parse_url($value, PHP_URL_QUERY);
            if (is_string($query) && $query !== '') {
                parse_str($query, $params);
                foreach (['qr', 'token', 'attendance_qr'] as $key) {
                    if (! empty($params[$key]) && is_string($params[$key])) {
                        return trim($params[$key]);
                    }
                }
            }
        }

        if (preg_match('/(?:^|[?&])(qr|token|attendance_qr)=([^&#]+)/', $value, $matches)) {
            return trim(rawurldecode((string) $matches[2]));
        }

        return $value;
    }

    private function signingKey(): string
    {
        $key = (string) config('app.key', '');
        if (trim($key) === '') {
            throw new RuntimeException('APP_KEY belum diset sehingga QR absensi belum bisa ditandatangani.');
        }

        if (str_starts_with($key, 'base64:')) {
            $decoded = base64_decode(substr($key, 7), true);
            if ($decoded !== false && $decoded !== '') {
                return $decoded;
            }
        }

        return $key;
    }

    private function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private function base64UrlDecode(string $value): ?string
    {
        $padding = strlen($value) % 4;
        if ($padding > 0) {
            $value .= str_repeat('=', 4 - $padding);
        }

        $decoded = base64_decode(strtr($value, '-_', '+/'), true);

        return $decoded === false ? null : $decoded;
    }

    private function duplicateOrDatabaseError(string $tenantId, object $profile, object $jadwal, Carbon $now, QueryException $e)
    {
        $existing = DB::table('absensi')
            ->where('tenant_id', $tenantId)
            ->where('kelas', $profile->kelas)
            ->where('tanggal', $now->toDateString())
            ->where('uid', $profile->id)
            ->where('mapel', $jadwal->mapel)
            ->first();

        if ($existing) {
            $existingAt = $this->parseSchoolTime($existing->waktu ?? null, $now);

            return response()->json([
                'success' => false,
                'reason' => 'already_attended',
                'error' => 'Anda sudah absen untuk mata pelajaran ini.',
                'data' => $this->attendancePayload($profile, $jadwal, $existingAt, (int) $existing->id),
            ], 409);
        }

        report($e);

        return $this->errorResponse('attendance_save_failed', 'Gagal menyimpan absensi QR.', 500);
    }

    private function attendancePayload(object $profile, object $jadwal, Carbon $time, ?int $attendanceId): array
    {
        $teacherName = $this->teacherName($jadwal);

        return [
            'absensi_id' => $attendanceId,
            'nama' => (string) ($profile->nama ?? ''),
            'kelas' => (string) ($profile->kelas ?? ''),
            'kelas_label' => $this->formatClassLabel((string) ($profile->kelas ?? '')),
            'mapel' => (string) ($jadwal->mapel ?? ''),
            'guru' => $teacherName,
            'guru_id' => (string) ($jadwal->guru_id ?? ''),
            'jam_absensi' => $time->format('H:i:s'),
            'hari' => $this->dayName($time),
            'tanggal' => (int) $time->format('d'),
            'bulan' => $this->monthName((int) $time->format('n')),
            'tahun' => (int) $time->format('Y'),
            'tanggal_iso' => $time->toDateString(),
            'tanggal_lengkap' => $this->fullDateLabel($time),
            'waktu_iso' => $time->toIso8601String(),
            'jadwal' => [
                'id' => (string) ($jadwal->id ?? ''),
                'jam_mulai' => (string) ($jadwal->jam_mulai ?? ''),
                'jam_selesai' => (string) ($jadwal->jam_selesai ?? ''),
            ],
        ];
    }

    private function schedulePayload(object $jadwal, Carbon $now, array $window = []): array
    {
        return [
            'id' => (string) ($jadwal->id ?? ''),
            'kelas_id' => (string) ($jadwal->kelas_id ?? ''),
            'kelas_label' => $this->formatClassLabel((string) ($jadwal->kelas_id ?? '')),
            'hari' => (string) ($jadwal->hari ?? $this->dayName($now)),
            'mapel' => (string) ($jadwal->mapel ?? ''),
            'guru_id' => (string) ($jadwal->guru_id ?? ''),
            'guru' => $this->teacherName($jadwal),
            'jam_mulai' => (string) ($jadwal->jam_mulai ?? ''),
            'jam_selesai' => (string) ($jadwal->jam_selesai ?? ''),
            'server_time' => $now->toIso8601String(),
            'window_start' => isset($window['start']) && $window['start'] instanceof Carbon
                ? $window['start']->toIso8601String()
                : null,
            'window_end' => isset($window['end']) && $window['end'] instanceof Carbon
                ? $window['end']->toIso8601String()
                : null,
        ];
    }

    private function teacherName(object $jadwal): string
    {
        $fromSchedule = trim((string) ($jadwal->guru_nama ?? ''));
        if ($fromSchedule !== '') {
            return $fromSchedule;
        }

        $guruId = (string) ($jadwal->guru_id ?? '');
        $tenantId = (string) ($jadwal->tenant_id ?? '');
        if ($guruId === '' || $tenantId === '') {
            return 'Guru';
        }

        $name = DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('id', $guruId)
            ->value('nama');

        return trim((string) $name) ?: 'Guru';
    }

    private function parseSchoolTime($value, Carbon $fallback): Carbon
    {
        try {
            if ($value) {
                return Carbon::parse((string) $value, self::SCHOOL_TIMEZONE)->setTimezone(self::SCHOOL_TIMEZONE);
            }
        } catch (\Throwable $e) {
            // gunakan fallback jika timestamp lama tidak valid
        }

        return $fallback->copy();
    }

    private function isInactiveProfile(object $profile): bool
    {
        $status = Str::lower(trim((string) ($profile->status ?? 'active')));

        return in_array($status, ['nonaktif', 'inactive', 'disabled'], true)
            || ! empty($profile->deleted_at);
    }

    private function dayName(Carbon $time): string
    {
        return self::DAYS[(int) $time->dayOfWeek] ?? '';
    }

    private function monthName(int $month): string
    {
        return self::MONTHS[$month] ?? '';
    }

    private function fullDateLabel(Carbon $time): string
    {
        return $this->dayName($time).', '.((int) $time->format('d')).' '.$this->monthName((int) $time->format('n')).' '.$time->format('Y');
    }

    private function formatClassLabel(string $kelas): string
    {
        $value = trim($kelas);
        if ($value === '') {
            return '-';
        }

        $parts = array_values(array_filter(explode('-', $value), fn ($part) => trim($part) !== ''));
        if (count($parts) >= 2) {
            return Str::upper($parts[0]).' '.Str::upper($parts[1]);
        }

        return collect($parts ?: [$value])
            ->map(fn ($part) => Str::title(str_replace('_', ' ', $part)))
            ->implode(' ');
    }

    private function errorResponse(string $reason, string $message, int $status = 422, $data = null)
    {
        $payload = [
            'success' => false,
            'reason' => $reason,
            'error' => $message,
        ];

        if ($data !== null) {
            $payload['data'] = $data;
        }

        return response()->json($payload, $status);
    }
}
