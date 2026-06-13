<?php

namespace App\Http\Controllers\Api;

use Illuminate\Database\QueryException;
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
            $studentNames = $students->take(3)->pluck('nama')->filter()->values();
            $names = $studentNames->implode(', ');
            $remaining = $studentCount > 3 ? ' dan '.($studentCount - 3).' lainnya' : '';
            $message = 'Tidak bisa hapus: kelas masih digunakan oleh '.$studentCount.' siswa. '
                .trim($names.$remaining).'. Pindahkan siswa terlebih dahulu.';

            return response()->json([
                'error' => $message,
                'code' => 'class_has_students',
                'student_count' => $studentCount,
                'student_names' => $studentNames->all(),
            ], 409);
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
        } catch (QueryException $exception) {
            $sqlState = (string) ($exception->errorInfo[0] ?? '');
            if ($sqlState === '23503') {
                return response()->json([
                    'error' => 'Tidak bisa hapus: kelas masih dipakai data terkait. Pindahkan atau bersihkan data yang masih terhubung ke kelas ini terlebih dahulu.',
                    'code' => 'class_has_related_records',
                ], 409);
            }

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
        $originalClassId = trim((string) ($classRow['id'] ?? $history->class_id ?? ''));
        if ($originalClassId === '') {
            return $this->deny('Snapshot kelas tidak valid', 422);
        }

        // Check if the class ID already exists — if so, generate a unique ID
        $existsQuery = DB::table('kelas')->where('id', $originalClassId);
        $this->whereTenant($existsQuery, 'kelas', $tenantId);
        $conflictExists = $existsQuery->exists();

        $resolvedClassId = $originalClassId;
        $resolvedClassName = (string) ($classRow['nama'] ?? $history->class_name ?? $originalClassId);

        if ($conflictExists) {
            // Generate a unique ID by appending _restored_N suffix
            $suffix = 1;
            do {
                $candidateId = $originalClassId.'_restored_'.$suffix;
                $checkQuery = DB::table('kelas')->where('id', $candidateId);
                $this->whereTenant($checkQuery, 'kelas', $tenantId);
                if (! $checkQuery->exists()) {
                    break;
                }
                $suffix++;
            } while ($suffix <= 20);

            if ($suffix > 20) {
                return $this->deny('Tidak dapat menemukan ID unik untuk kelas yang dipulihkan. Hapus kelas duplikat terlebih dahulu.', 409);
            }

            $resolvedClassId = $candidateId;
            $resolvedClassName = $resolvedClassName.' (Pulihan)';
        }

        $restored = DB::transaction(function () use ($history, $snapshot, $classRow, $tenantId, $request, $originalClassId, $resolvedClassId, $resolvedClassName, $conflictExists) {
            // Remap class row to the resolved ID
            $classRow['id'] = $resolvedClassId;
            $classRow['nama'] = $resolvedClassName;

            $this->insertSnapshotRows('kelas', [$classRow], $tenantId);

            // Remap related snapshot rows to use the new class ID
            $strukturRows = $this->remapClassId($snapshot['kelas_struktur'] ?? [], 'kelas_id', $originalClassId, $resolvedClassId);
            $jadwalRows = $this->remapClassId($snapshot['jadwal'] ?? [], 'kelas_id', $originalClassId, $resolvedClassId);
            $jamKosongRows = $this->remapClassId($snapshot['jam_kosong'] ?? [], 'kelas', $originalClassId, $resolvedClassId);
            $absensiSettingsRows = $this->remapClassId($snapshot['absensi_settings'] ?? [], 'kelas', $originalClassId, $resolvedClassId);

            $this->insertSnapshotRows('kelas_struktur', $strukturRows, $tenantId);
            $this->insertSnapshotRows('jadwal', $jadwalRows, $tenantId);
            $this->insertSnapshotRows('jam_kosong', $jamKosongRows, $tenantId);
            $this->insertSnapshotRows('absensi_settings', $absensiSettingsRows, $tenantId);

            $updatePayload = [
                'restored_by' => $request->user()?->id,
                'restored_at' => now(),
                'updated_at' => now(),
            ];

            if ($conflictExists) {
                $updatePayload['restore_note'] = "Kelas dipulihkan dengan ID baru: {$resolvedClassId} (ID asli {$originalClassId} sudah terpakai)";
            }

            DB::table('kelas_deleted_histories')
                ->where('id', $history->id)
                ->where('tenant_id', $tenantId)
                ->update($updatePayload);

            return DB::table('kelas_deleted_histories')->where('id', $history->id)->first();
        });

        $result = $this->normalizeHistoryRow($restored);
        $result['restored_class_id'] = $resolvedClassId;
        $result['conflict_resolved'] = $conflictExists;

        return $this->ok($result);
    }

    public function destroyHistory(Request $request, string $historyId)
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
            return $this->deny('Riwayat yang sudah dipulihkan tidak bisa dihapus.', 409);
        }

        DB::table('kelas_deleted_histories')
            ->where('id', $historyId)
            ->where('tenant_id', $tenantId)
            ->delete();

        return $this->ok(['deleted' => true, 'id' => $historyId]);
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

    private function remapClassId(array $rows, string $column, string $oldId, string $newId): array
    {
        if ($oldId === $newId || empty($rows)) {
            return $rows;
        }

        return array_map(function (array $row) use ($column, $oldId, $newId) {
            if (isset($row[$column]) && trim((string) $row[$column]) === $oldId) {
                $row[$column] = $newId;
            }
            // Generate a new unique ID for each related row to avoid PK conflicts
            if (isset($row['id'])) {
                $row['id'] = (string) Str::uuid();
            }

            return $row;
        }, $rows);
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
