<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

class ClassHistoryController extends ApiController
{
    public function index(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $rows = DB::table('kelas_deleted_histories')
            ->where('tenant_id', $tenantId)
            ->orderByDesc('deleted_at')
            ->limit(100)
            ->get()
            ->map(fn ($row) => $this->normalizeHistoryRow($row))
            ->values();

        return $this->ok($rows);
    }

    public function destroyClass(Request $request, string $classId)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $classId = trim($classId);
        if ($classId === '') {
            return $this->deny('Kelas tidak valid', 422);
        }

        $studentQuery = DB::table('profiles')->where('kelas', $classId);
        $this->whereTenant($studentQuery, 'profiles', $tenantId);
        $students = $studentQuery->limit(4)->get(['id', 'nama', 'kelas']);
        $studentCount = $this->countRows('profiles', 'kelas', $classId, $tenantId);
        if ($studentCount > 0) {
            $names = $students->take(3)->pluck('nama')->filter()->implode(', ');
            $remaining = $studentCount > 3 ? ' dan '.($studentCount - 3).' lainnya' : '';

            return $this->deny(
                'Tidak bisa hapus: kelas masih digunakan oleh '.$studentCount.' siswa. '
                .trim($names.$remaining).'. Pindahkan siswa terlebih dahulu.',
                409
            );
        }

        try {
            $history = DB::transaction(function () use ($request, $tenantId, $classId) {
                $classQuery = DB::table('kelas')->where('id', $classId);
                $this->whereTenant($classQuery, 'kelas', $tenantId);
                $class = $classQuery->first();
                if (! $class) {
                    abort(response()->json(['error' => 'Kelas tidak ditemukan'], 404));
                }

                $snapshot = [
                    'kelas' => (array) $class,
                    'kelas_struktur' => $this->fetchRows('kelas_struktur', 'kelas_id', $classId, $tenantId),
                    'jadwal' => $this->fetchRows('jadwal', 'kelas_id', $classId, $tenantId),
                    'jam_kosong' => $this->fetchRows('jam_kosong', 'kelas', $classId, $tenantId),
                    'absensi_settings' => $this->fetchRows('absensi_settings', 'kelas', $classId, $tenantId),
                ];

                $summary = [
                    'siswa_count' => 0,
                    'jadwal_count' => count($snapshot['jadwal']),
                    'struktur_count' => count($snapshot['kelas_struktur']),
                    'jam_kosong_count' => count($snapshot['jam_kosong']),
                    'absensi_settings_count' => count($snapshot['absensi_settings']),
                    'absensi_count' => $this->countRows('absensi', 'kelas', $classId, $tenantId),
                    'tugas_count' => $this->countRows('tugas', 'kelas', $classId, $tenantId),
                    'quizzes_count' => $this->countRows('quizzes', 'kelas_id', $classId, $tenantId),
                ];

                $historyId = (string) Str::uuid();
                $user = $request->user();
                $profile = $this->profile($request);
                $now = now();

                DB::table('kelas_deleted_histories')->insert([
                    'id' => $historyId,
                    'tenant_id' => $tenantId,
                    'class_id' => $classId,
                    'class_name' => (string) ($class->nama ?? $classId),
                    'grade' => $class->grade ?? null,
                    'suffix' => $class->suffix ?? null,
                    'angkatan' => $class->angkatan ?? null,
                    'tahun_ajaran' => $class->tahun_ajaran ?? null,
                    'semester' => $class->semester ?? null,
                    'snapshot' => json_encode($snapshot),
                    'summary' => json_encode($summary),
                    'deleted_by' => $user?->id,
                    'deleted_by_name' => $profile?->nama ?? $user?->name ?? $user?->email,
                    'deleted_at' => $now,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);

                $this->deleteRows('jam_kosong', 'kelas', $classId, $tenantId);
                $this->deleteRows('absensi_settings', 'kelas', $classId, $tenantId);
                $this->deleteRows('jadwal', 'kelas_id', $classId, $tenantId);
                $this->deleteRows('kelas_struktur', 'kelas_id', $classId, $tenantId);

                $deleteClass = DB::table('kelas')->where('id', $classId);
                $this->whereTenant($deleteClass, 'kelas', $tenantId);
                $deleteClass->delete();

                return DB::table('kelas_deleted_histories')->where('id', $historyId)->first();
            });
        } catch (HttpExceptionInterface $exception) {
            throw $exception;
        }

        return $this->ok($this->normalizeHistoryRow($history));
    }

    public function restore(Request $request, string $historyId)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $history = DB::table('kelas_deleted_histories')
            ->where('id', $historyId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $history) {
            return $this->deny('Riwayat kelas tidak ditemukan', 404);
        }
        if ($history->restored_at) {
            return $this->deny('Kelas ini sudah dipulihkan', 409);
        }

        $snapshot = $this->decodeJson($history->snapshot);
        $classRow = $snapshot['kelas'] ?? null;
        $classId = trim((string) ($classRow['id'] ?? $history->class_id ?? ''));
        if ($classId === '') {
            return $this->deny('Snapshot kelas tidak valid', 422);
        }

        $existsQuery = DB::table('kelas')->where('id', $classId);
        $this->whereTenant($existsQuery, 'kelas', $tenantId);
        if ($existsQuery->exists()) {
            return $this->deny('Kelas aktif dengan ID ini sudah ada. Pulihkan dibatalkan agar tidak menimpa data aktif.', 409);
        }

        $restored = DB::transaction(function () use ($history, $snapshot, $classRow, $tenantId, $request) {
            $this->insertSnapshotRows('kelas', [$classRow], $tenantId);
            $this->insertSnapshotRows('kelas_struktur', $snapshot['kelas_struktur'] ?? [], $tenantId);
            $this->insertSnapshotRows('jadwal', $snapshot['jadwal'] ?? [], $tenantId);
            $this->insertSnapshotRows('jam_kosong', $snapshot['jam_kosong'] ?? [], $tenantId);
            $this->insertSnapshotRows('absensi_settings', $snapshot['absensi_settings'] ?? [], $tenantId);

            DB::table('kelas_deleted_histories')
                ->where('id', $history->id)
                ->where('tenant_id', $tenantId)
                ->update([
                    'restored_by' => $request->user()?->id,
                    'restored_at' => now(),
                    'updated_at' => now(),
                ]);

            return DB::table('kelas_deleted_histories')->where('id', $history->id)->first();
        });

        return $this->ok($this->normalizeHistoryRow($restored));
    }

    private function fetchRows(string $table, string $column, string $value, string $tenantId): array
    {
        if (! Schema::hasTable($table) || ! Schema::hasColumn($table, $column)) {
            return [];
        }

        $query = DB::table($table)->where($column, $value);
        $this->whereTenant($query, $table, $tenantId);

        return $query->get()->map(fn ($row) => (array) $row)->values()->all();
    }

    private function countRows(string $table, string $column, string $value, string $tenantId): int
    {
        if (! Schema::hasTable($table) || ! Schema::hasColumn($table, $column)) {
            return 0;
        }

        $query = DB::table($table)->where($column, $value);
        $this->whereTenant($query, $table, $tenantId);

        return (int) $query->count();
    }

    private function deleteRows(string $table, string $column, string $value, string $tenantId): void
    {
        if (! Schema::hasTable($table) || ! Schema::hasColumn($table, $column)) {
            return;
        }

        $query = DB::table($table)->where($column, $value);
        $this->whereTenant($query, $table, $tenantId);
        $query->delete();
    }

    private function insertSnapshotRows(string $table, array $rows, string $tenantId): void
    {
        if (! Schema::hasTable($table) || empty($rows)) {
            return;
        }

        $filtered = [];
        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }
            if (Schema::hasColumn($table, 'tenant_id')) {
                $row['tenant_id'] = $tenantId;
            }
            $payload = [];
            foreach ($row as $column => $value) {
                if (Schema::hasColumn($table, $column)) {
                    $payload[$column] = $value;
                }
            }
            if (! empty($payload)) {
                $filtered[] = $payload;
            }
        }

        if (! empty($filtered)) {
            DB::table($table)->insert($filtered);
        }
    }

    private function whereTenant($query, string $table, string $tenantId): void
    {
        if (Schema::hasColumn($table, 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }
    }

    private function normalizeHistoryRow($row): array
    {
        $data = (array) $row;
        $data['snapshot'] = $this->decodeJson($data['snapshot'] ?? []);
        $data['summary'] = $this->decodeJson($data['summary'] ?? []);
        foreach ([
            'siswa' => 'siswa_count',
            'jadwal' => 'jadwal_count',
            'struktur' => 'struktur_count',
            'jam_kosong' => 'jam_kosong_count',
            'absensi_settings' => 'absensi_settings_count',
            'absensi' => 'absensi_count',
            'tugas' => 'tugas_count',
            'quizzes' => 'quizzes_count',
        ] as $alias => $source) {
            if (! array_key_exists($alias, $data['summary'])) {
                $data['summary'][$alias] = (int) ($data['summary'][$source] ?? 0);
            }
        }

        return $data;
    }

    private function decodeJson($value): array
    {
        if (is_array($value)) {
            return $value;
        }
        if (is_object($value)) {
            return (array) $value;
        }
        if (! is_string($value) || trim($value) === '') {
            return [];
        }

        $decoded = json_decode($value, true);

        return is_array($decoded) ? $decoded : [];
    }
}
