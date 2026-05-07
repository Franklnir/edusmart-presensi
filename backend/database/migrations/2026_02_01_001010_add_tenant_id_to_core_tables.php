<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        $slug = env('TENANT_DEFAULT_SLUG', 'default');
        $tenant = DB::table('tenants')->where('slug', $slug)->first();
        if (! $tenant) {
            $tenantId = (string) Str::uuid();
            DB::table('tenants')->insert([
                'id' => $tenantId,
                'name' => 'Default School',
                'slug' => $slug,
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $tenant = (object) ['id' => $tenantId];
        }

        $tables = [
            'settings',
            'profiles',
            'kelas',
            'mata_pelajaran',
            'struktur_sekolah',
            'kelas_struktur',
            'jadwal',
            'pengumuman',
            'ekskul',
            'ekskul_anggota',
            'organisasi',
            'organisasi_anggota',
            'osis_anggota',
            'absensi',
            'absensi_ajuan',
            'absensi_settings',
            'absensi_rfid_settings',
            'absensi_eskul',
            'absensi_scan_temp',
            'rfid_scans',
            'jam_kosong',
            'tugas',
            'tugas_jawaban',
            'certificates',
            'templat_sertifikat_publik',
            'printed_cards',
            'allowed_registrations',
            'registration_otps',
            'admin_users',
            'audit_log',
            'anggota_eksku1',
            'anggota_ekskul',
            'quizzes',
            'quiz_questions',
            'quiz_options',
            'quiz_submissions',
            'quiz_answers',
            'user_presence',
        ];

        foreach ($tables as $tableName) {
            if (! Schema::hasTable($tableName)) {
                continue;
            }

            if (! Schema::hasColumn($tableName, 'tenant_id')) {
                Schema::table($tableName, function (Blueprint $table) {
                    $table->uuid('tenant_id')->nullable();
                    $table->index('tenant_id');
                });
            }

            DB::table($tableName)
                ->whereNull('tenant_id')
                ->update(['tenant_id' => $tenant->id]);
        }
    }

    public function down(): void
    {
        $tables = [
            'settings',
            'profiles',
            'kelas',
            'mata_pelajaran',
            'struktur_sekolah',
            'kelas_struktur',
            'jadwal',
            'pengumuman',
            'ekskul',
            'ekskul_anggota',
            'organisasi',
            'organisasi_anggota',
            'osis_anggota',
            'absensi',
            'absensi_ajuan',
            'absensi_settings',
            'absensi_rfid_settings',
            'absensi_eskul',
            'absensi_scan_temp',
            'rfid_scans',
            'jam_kosong',
            'tugas',
            'tugas_jawaban',
            'certificates',
            'templat_sertifikat_publik',
            'printed_cards',
            'allowed_registrations',
            'registration_otps',
            'admin_users',
            'audit_log',
            'anggota_eksku1',
            'anggota_ekskul',
            'quizzes',
            'quiz_questions',
            'quiz_options',
            'quiz_submissions',
            'quiz_answers',
            'user_presence',
        ];

        foreach ($tables as $tableName) {
            if (! Schema::hasTable($tableName) || ! Schema::hasColumn($tableName, 'tenant_id')) {
                continue;
            }
            Schema::table($tableName, function (Blueprint $table) {
                $table->dropIndex(['tenant_id']);
                $table->dropColumn('tenant_id');
            });
        }
    }
};
