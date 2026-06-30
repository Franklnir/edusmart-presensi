<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // Pastikan ini adalah driver PostgreSQL
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        // 1. Rename existing table
        if (Schema::hasTable('absensi')) {
            Schema::rename('absensi', 'absensi_old');
            
            // Hapus constraint primary key lama agar tidak bentrok (biasanya bernama absensi_pkey)
            DB::statement('ALTER TABLE absensi_old DROP CONSTRAINT IF EXISTS absensi_pkey CASCADE');
        }

        // 2. Buat tabel partitioned baru dengan struktur yang sama
        DB::statement('
            CREATE TABLE absensi (
                id BIGSERIAL,
                kelas TEXT NOT NULL,
                tanggal DATE NOT NULL,
                uid UUID NOT NULL,
                mapel TEXT NOT NULL,
                status TEXT NOT NULL,
                nama TEXT,
                waktu TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                komentar TEXT,
                oleh TEXT,
                dikonfirmasi UUID,
                tenant_id UUID,
                PRIMARY KEY (id, tanggal)
            ) PARTITION BY RANGE (tanggal)
        ');

        // 3. Buat partisi bulanan dari 2020 hingga 2035
        $years = range(2020, 2035);
        foreach ($years as $year) {
            for ($month = 1; $month <= 12; $month++) {
                $monthStr = str_pad((string)$month, 2, "0", STR_PAD_LEFT);
                $nextMonth = $month == 12 ? 1 : $month + 1;
                $nextYear = $month == 12 ? $year + 1 : $year;
                $nextMonthStr = str_pad((string)$nextMonth, 2, "0", STR_PAD_LEFT);
                
                $partitionName = "absensi_{$year}_{$monthStr}";
                $startDate = "{$year}-{$monthStr}-01";
                $endDate = "{$nextYear}-{$nextMonthStr}-01";
                
                DB::statement("CREATE TABLE IF NOT EXISTS {$partitionName} PARTITION OF absensi FOR VALUES FROM ('{$startDate}') TO ('{$endDate}')");
            }
        }

        // Buat partisi DEFAULT untuk menampung tanggal di luar jangkauan (sebelum 2020 atau setelah 2035)
        DB::statement('CREATE TABLE IF NOT EXISTS absensi_default PARTITION OF absensi DEFAULT');

        // 4. Pindahkan data dari tabel lama ke tabel berpartisi (jika tabel lama ada datanya)
        if (Schema::hasTable('absensi_old')) {
            DB::statement('
                INSERT INTO absensi (id, kelas, tanggal, uid, mapel, status, nama, waktu, komentar, oleh, dikonfirmasi, tenant_id)
                SELECT id, kelas, tanggal, uid, mapel, status, nama, waktu, komentar, oleh, dikonfirmasi, tenant_id
                FROM absensi_old
                ON CONFLICT DO NOTHING
            ');
            
            // Set sequence agar id berlanjut dengan benar
            DB::statement("SELECT setval('absensi_id_seq', (SELECT COALESCE(MAX(id), 1) FROM absensi_old))");
        }

        // 5. Buat ulang indeks-indeks penting
        DB::statement('CREATE INDEX IF NOT EXISTS absensi_uid_idx ON absensi (uid)');
        DB::statement('CREATE INDEX IF NOT EXISTS absensi_tenant_tanggal_idx ON absensi (tenant_id, tanggal)');
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        Schema::dropIfExists('absensi');
        
        if (Schema::hasTable('absensi_old')) {
            Schema::rename('absensi_old', 'absensi');
            DB::statement('ALTER TABLE absensi ADD PRIMARY KEY (id)');
        }
    }
};
