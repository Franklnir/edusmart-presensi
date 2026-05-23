<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class JadwalController extends ApiController
{
    public function index(Request $request)
    {
        $query = DB::table('jadwal');

        if ($this->isAdmin($request)) {
            // full
        } elseif ($this->isGuru($request)) {
            $query->where('guru_id', $request->user()->id);
        } else {
            $kelas = $this->currentKelas($request);
            if ($kelas) {
                $query->where('kelas_id', $kelas);
            } else {
                return response()->json(['data' => []]);
            }
        }

        if ($kelasId = $request->query('kelas_id')) {
            $query->where('kelas_id', $kelasId);
        }
        if ($guruId = $request->query('guru_id')) {
            $query->where('guru_id', $guruId);
        }
        if ($hari = $request->query('hari')) {
            $query->where('hari', $hari);
        }

        $query->orderBy('hari')->orderBy('jam_mulai');

        return response()->json(['data' => $query->get()]);
    }

    public function store(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }
        $payload = $request->all();
        $payload['created_at'] = now();
        $payload['updated_at'] = now();
        DB::table('jadwal')->insert($payload);

        return response()->json(['data' => $payload], 201);
    }

    public function update(Request $request, string $id)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }
        $payload = $request->all();
        $payload['updated_at'] = now();
        DB::table('jadwal')->where('id', $id)->update($payload);
        $row = DB::table('jadwal')->where('id', $id)->first();

        return response()->json(['data' => $row]);
    }

    public function destroy(Request $request, string $id)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }
        DB::table('jadwal')->where('id', $id)->delete();

        return response()->json(['data' => 'deleted']);
    }

    public function updateJamKosongReplacement(Request $request, string $id)
    {
        if (! $this->isGuru($request)) {
            return $this->deny();
        }

        $action = strtolower(trim((string) $request->input('action', 'take')));
        if (! in_array($action, ['take', 'cancel'], true)) {
            return $this->deny('Aksi jam kosong tidak valid.', 422);
        }

        $profile = $this->profile($request);
        $userId = (string) ($request->user()?->id ?? '');
        $tenantId = $this->tenantId($request);
        $teacherName = $this->normalizeDisplayName($profile?->nama ?? $request->user()?->email ?? 'Guru');

        if ($userId === '' || $teacherName === '') {
            return $this->deny('Profil guru tidak valid. Silakan login ulang.', 422);
        }

        try {
            $result = DB::transaction(function () use ($id, $action, $userId, $tenantId, $teacherName) {
                $targetQuery = DB::table('jam_kosong')->where('id', $id);
                $this->applyTenantScope($targetQuery, 'jam_kosong', $tenantId);
                $target = $targetQuery->lockForUpdate()->first();

                if (! $target) {
                    return $this->jamKosongResult(false, 'Jam kosong tidak ditemukan atau sudah tidak tersedia.', 404);
                }

                if ((string) ($target->created_by ?? '') === $userId) {
                    return $this->jamKosongResult(false, 'Guru tidak bisa mengambil jam kosong yang diajukan oleh dirinya sendiri.', 409);
                }

                $currentReplacement = $this->normalizeDisplayName($target->guru_pengganti ?? '');
                $currentReplacementKey = $this->normalizeTeacherKey($currentReplacement);
                $teacherKey = $this->normalizeTeacherKey($teacherName);

                if ($action === 'cancel') {
                    if ($currentReplacementKey === '' || $currentReplacementKey !== $teacherKey) {
                        return $this->jamKosongResult(false, 'Jam kosong ini tidak sedang Anda ambil.', 409);
                    }

                    $updated = $this->scopedJamKosongUpdate($id, $tenantId)
                        ->whereRaw('LOWER(TRIM(guru_pengganti)) = ?', [$teacherKey])
                        ->update([
                            'guru_pengganti' => null,
                            'updated_at' => now(),
                        ]);

                    if ($updated < 1) {
                        return $this->jamKosongResult(false, 'Jam kosong sudah berubah. Data akan diperbarui.', 409);
                    }

                    return $this->jamKosongResult(true, data: $this->freshJamKosongRow($id, $tenantId));
                }

                if ($currentReplacementKey !== '') {
                    return $this->jamKosongResult(false, 'Jam kosong sudah diambil guru lain atau tidak tersedia lagi.', 409);
                }

                $validation = $this->validateJamKosongReplacementTarget($target, $tenantId, $userId, $teacherName);
                if ($validation !== null) {
                    return $validation;
                }

                $updated = $this->scopedJamKosongUpdate($id, $tenantId)
                    ->where(function ($query) use ($userId) {
                        $query->whereNull('created_by')
                            ->orWhere('created_by', '!=', $userId);
                    })
                    ->whereNull('guru_pengganti')
                    ->update([
                        'guru_pengganti' => $teacherName,
                        'updated_at' => now(),
                    ]);

                if ($updated < 1) {
                    return $this->jamKosongResult(false, 'Jam kosong sudah diambil guru lain atau tidak tersedia lagi.', 409);
                }

                return $this->jamKosongResult(true, data: $this->freshJamKosongRow($id, $tenantId));
            });

            if (! ($result['ok'] ?? false)) {
                return response()->json(['error' => $result['message']], $result['status'] ?? 422);
            }

            return response()->json(['data' => $result['data'] ?? null]);
        } catch (\Throwable $e) {
            report($e);

            return $this->deny('Gagal memperbarui jam kosong. Silakan refresh data lalu coba lagi.', 500);
        }
    }

    private function validateJamKosongReplacementTarget($target, ?string $tenantId, string $userId, string $teacherName): ?array
    {
        $tanggal = trim((string) ($target->tanggal ?? ''));
        $jamMulai = $this->normalizeClockForQuery($target->jam_mulai ?? null);
        $jamSelesai = $this->normalizeClockForQuery($target->jam_selesai ?? null);
        $hari = $this->dayNameForDateKey($tanggal);

        if ($tanggal === '' || $jamMulai === null || $jamSelesai === null || $hari === null) {
            return $this->jamKosongResult(false, 'Data jam kosong tidak lengkap. Minta guru pengaju memperbaiki tanggal dan jam.', 422);
        }

        $jadwalQuery = DB::table('jadwal')
            ->where('guru_id', $userId)
            ->where('hari', $hari);
        $this->applyTenantScope($jadwalQuery, 'jadwal', $tenantId);
        $this->applyTargetPeriodScope($jadwalQuery, 'jadwal', $target);
        $this->applyClockOverlap($jadwalQuery, $jamMulai, $jamSelesai);

        $jadwalConflict = $jadwalQuery->first(['mapel', 'kelas_id', 'jam_mulai', 'jam_selesai']);
        if ($jadwalConflict) {
            return $this->jamKosongResult(false, sprintf(
                'Tidak bisa mengambil jam kosong. Anda masih punya jadwal %s kelas %s pukul %s-%s.',
                $jadwalConflict->mapel ?: 'mengajar',
                $jadwalConflict->kelas_id ?: '-',
                $this->formatClockForMessage($jadwalConflict->jam_mulai ?? null),
                $this->formatClockForMessage($jadwalConflict->jam_selesai ?? null)
            ), 409);
        }

        $replacementName = $this->normalizeTeacherKey($teacherName);
        if ($replacementName === '') {
            return $this->jamKosongResult(false, 'Nama guru pengganti tidak valid.', 422);
        }

        $jamConflictQuery = DB::table('jam_kosong')
            ->where('tanggal', $tanggal)
            ->where('id', '!=', $target->id)
            ->whereRaw('LOWER(TRIM(guru_pengganti)) = ?', [$replacementName]);
        $this->applyTenantScope($jamConflictQuery, 'jam_kosong', $tenantId);
        $this->applyTargetPeriodScope($jamConflictQuery, 'jam_kosong', $target);
        $this->applyClockOverlap($jamConflictQuery, $jamMulai, $jamSelesai);

        $jamConflict = $jamConflictQuery->first(['mapel', 'kelas', 'jam_mulai', 'jam_selesai']);
        if ($jamConflict) {
            return $this->jamKosongResult(false, sprintf(
                'Tidak bisa mengambil jam kosong. Anda sudah mengambil jam kosong %s kelas %s pukul %s-%s.',
                $jamConflict->mapel ?: 'lain',
                $jamConflict->kelas ?: '-',
                $this->formatClockForMessage($jamConflict->jam_mulai ?? null),
                $this->formatClockForMessage($jamConflict->jam_selesai ?? null)
            ), 409);
        }

        return null;
    }

    private function scopedJamKosongUpdate(string $id, ?string $tenantId)
    {
        $query = DB::table('jam_kosong')->where('id', $id);
        $this->applyTenantScope($query, 'jam_kosong', $tenantId);

        return $query;
    }

    private function freshJamKosongRow(string $id, ?string $tenantId)
    {
        $query = DB::table('jam_kosong')->where('id', $id);
        $this->applyTenantScope($query, 'jam_kosong', $tenantId);

        return $query->first();
    }

    private function jamKosongResult(bool $ok, string $message = '', int $status = 200, $data = null): array
    {
        return [
            'ok' => $ok,
            'message' => $message,
            'status' => $status,
            'data' => $data,
        ];
    }

    private function applyTenantScope($query, string $table, ?string $tenantId): void
    {
        if ($tenantId && Schema::hasColumn($table, 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }
    }

    private function applyTargetPeriodScope($query, string $table, $target): void
    {
        if (Schema::hasColumn($table, 'tahun_ajaran')) {
            $tahunAjaran = trim((string) ($target->tahun_ajaran ?? ''));
            if ($tahunAjaran !== '') {
                $query->where('tahun_ajaran', $tahunAjaran);
            }
        }

        if (Schema::hasColumn($table, 'semester')) {
            $semester = trim((string) ($target->semester ?? ''));
            if ($semester !== '') {
                $query->where('semester', $semester);
            }
        }
    }

    private function applyClockOverlap($query, string $start, string $end): void
    {
        $query->where('jam_mulai', '<', $end)
            ->where('jam_selesai', '>', $start);
    }

    private function dayNameForDateKey(string $dateKey): ?string
    {
        try {
            $date = Carbon::parse($dateKey, 'Asia/Jakarta');
        } catch (\Throwable $e) {
            return null;
        }

        return [
            0 => 'Minggu',
            1 => 'Senin',
            2 => 'Selasa',
            3 => 'Rabu',
            4 => 'Kamis',
            5 => 'Jumat',
            6 => 'Sabtu',
        ][$date->dayOfWeek] ?? null;
    }

    private function normalizeClockForQuery($value): ?string
    {
        $raw = trim((string) ($value ?? ''));
        if ($raw === '') {
            return null;
        }

        if (preg_match('/^(\d{1,2}):(\d{2})(?::(\d{2}))?/', $raw, $matches) !== 1) {
            return null;
        }

        return sprintf(
            '%02d:%02d:%02d',
            (int) $matches[1],
            (int) $matches[2],
            isset($matches[3]) ? (int) $matches[3] : 0
        );
    }

    private function formatClockForMessage($value): string
    {
        $clock = $this->normalizeClockForQuery($value);
        if ($clock === null) {
            return '-';
        }

        return substr($clock, 0, 5);
    }

    private function normalizeDisplayName($value): string
    {
        return preg_replace('/\s+/', ' ', trim((string) $value)) ?? '';
    }

    private function normalizeTeacherKey($value): string
    {
        return Str::lower($this->normalizeDisplayName($value));
    }
}
