<?php

namespace App\Services\Actions\Attendance;

use App\Models\Profile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class BulkCreateAttendance
{
    public function execute(array $records, Profile $creator, string $tenantId): array
    {
        if (empty($records)) {
            return [];
        }

        return DB::transaction(function () use ($records, $creator, $tenantId) {
            $now = now();
            $insertData = [];
            $auditData = [];
            $insertedUids = [];

            // Prevent duplicate insertions
            // First we need to get existing attendances for the given date and classes
            $tanggals = array_unique(array_column($records, 'tanggal'));
            $uids = array_unique(array_column($records, 'uid'));
            $kelasIds = array_unique(array_column($records, 'kelas'));

            $existingQuery = DB::table('absensi')
                ->where('tenant_id', $tenantId)
                ->whereIn('uid', $uids)
                ->whereIn('tanggal', $tanggals)
                ->whereIn('kelas', $kelasIds)
                ->get(['uid', 'tanggal', 'kelas', 'mapel']);

            $existingMap = [];
            foreach ($existingQuery as $ex) {
                $exTanggal = substr($ex->tanggal, 0, 10);
                $key = "{$ex->uid}|{$exTanggal}|{$ex->kelas}|{$ex->mapel}";
                $existingMap[$key] = true;
            }

            foreach ($records as $record) {
                $mapel = $record['mapel'] ?? '';
                $recTanggal = substr($record['tanggal'], 0, 10);
                $key = "{$record['uid']}|{$recTanggal}|{$record['kelas']}|{$mapel}";

                // Skip if already exists
                if (isset($existingMap[$key])) {
                    continue;
                }

                // Prevent duplicate within the same batch
                $existingMap[$key] = true;

                $id = (string) Str::uuid(); // Generate ID for audit if needed? Wait, absensi table uses bigIncrements 'id'. We don't have to provide UUID for ID. We'll use insertGetId or just let it auto-increment.
                // But for audit log, we need the inserted IDs. Since we might do bulk insert, we can't easily get the auto-increment IDs for audit log without doing it one by one or using returning().
                // However, Laravel's insert() doesn't return IDs by default.

                $insertData[] = [
                    'tenant_id' => $tenantId,
                    'uid' => $record['uid'],
                    'kelas' => $record['kelas'],
                    'tanggal' => $record['tanggal'],
                    'status' => $record['status'],
                    'mapel' => $mapel,
                    'tahun_ajaran' => $record['tahun_ajaran'] ?? null,
                    'semester' => $record['semester'] ?? null,
                    'nama' => $record['nama'] ?? null,
                    'waktu' => $now,
                    'komentar' => $record['komentar'] ?? null,
                    'oleh' => $record['oleh'] ?? $creator->nama,
                    'dikonfirmasi' => $creator->id,
                ];
            }

            if (empty($insertData)) {
                return [];
            }

            // In order to get the IDs for the audit log, we will insert them one by one.
            // Since it's a scanner operation, the batch size is usually bounded by the number of students * mapel per day.
            $results = [];
            foreach ($insertData as $data) {
                $id = DB::table('absensi')->insertGetId($data);
                $data['id'] = $id;
                $results[] = $data;

                $auditData[] = [
                    'tenant_id' => $tenantId,
                    'table_name' => 'absensi',
                    'record_id' => (string) $id,
                    'action' => 'INSERT',
                    'old_data' => null,
                    'new_data' => json_encode([
                        'uid' => $data['uid'],
                        'kelas' => $data['kelas'],
                        'tanggal' => $data['tanggal'],
                        'mapel' => $data['mapel'],
                        'status' => $data['status'],
                    ]),
                    'user_id' => $creator->id,
                    'user_role' => $creator->role,
                    'timestamp' => clone $now,
                ];
            }

            DB::table('audit_log')->insert($auditData);

            return $results;
        });
    }
}
