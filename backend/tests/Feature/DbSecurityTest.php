<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\AcademicPeriod;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class DbSecurityTest extends TestCase
{
    use RefreshDatabase;

    public function test_public_settings_select_is_sanitized(): void
    {
        $tenantId = $this->defaultTenantId();

        DB::table('settings')->insert([
            'tenant_id' => $tenantId,
            'nama_sekolah' => 'Sekolah Aman',
            'email' => 'sekolah@example.com',
            'manual_jam_masuk_mulai' => '07:00:00',
            'manual_jam_masuk_selesai' => '08:00:00',
            'admin_lock_enabled' => true,
            'registrasi_admin_aktif' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->postJson('/api/db', [
            'table' => 'settings',
            'action' => 'select',
            'columns' => '*',
        ]);

        $response->assertOk();
        $row = $response->json('data.0');

        $this->assertIsArray($row);
        $this->assertSame('Sekolah Aman', $row['nama_sekolah'] ?? null);
        $this->assertArrayNotHasKey('manual_jam_masuk_mulai', $row);
        $this->assertArrayNotHasKey('manual_jam_masuk_selesai', $row);
        $this->assertArrayNotHasKey('admin_lock_enabled', $row);
        $this->assertArrayNotHasKey('registrasi_admin_aktif', $row);
    }

    public function test_authenticated_non_admin_settings_select_is_sanitized(): void
    {
        $tenantId = $this->defaultTenantId();
        [$user] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');

        DB::table('settings')->insert([
            'tenant_id' => $tenantId,
            'nama_sekolah' => 'Sekolah Aman',
            'email' => 'sekolah@example.com',
            'tahun_ajaran' => '2026/2027',
            'semester_aktif' => 'ganjil',
            'ranking_weight_tugas' => 40,
            'ranking_weight_quiz' => 40,
            'ranking_weight_absensi' => 20,
            'ranking_tiebreak_order' => json_encode(['nilai_akhir', 'nama']),
            'ranking_core_mapel' => json_encode(['Matematika']),
            'nilai_freeze_enabled' => true,
            'nilai_freeze_reason' => 'Rilis rapor',
            'manual_jam_masuk_mulai' => '07:00:00',
            'manual_jam_masuk_selesai' => '08:00:00',
            'admin_lock_enabled' => true,
            'registrasi_admin_aktif' => true,
            'approval_maker_checker_enabled' => true,
            'approval_require_second_approver' => true,
            'anomaly_alert_enabled' => true,
            'anomaly_bulk_threshold' => 30,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->actingAs($user)->postJson('/api/db', [
            'table' => 'settings',
            'action' => 'select',
            'columns' => '*',
        ]);

        $response->assertOk();
        $row = $response->json('data.0');

        $this->assertIsArray($row);
        $this->assertSame('Sekolah Aman', $row['nama_sekolah'] ?? null);
        $this->assertSame('2026/2027', $row['tahun_ajaran'] ?? null);
        $this->assertArrayHasKey('ranking_weight_tugas', $row);
        $this->assertArrayHasKey('nilai_freeze_enabled', $row);
        $this->assertArrayNotHasKey('manual_jam_masuk_mulai', $row);
        $this->assertArrayNotHasKey('manual_jam_masuk_selesai', $row);
        $this->assertArrayNotHasKey('admin_lock_enabled', $row);
        $this->assertArrayNotHasKey('registrasi_admin_aktif', $row);
        $this->assertArrayNotHasKey('approval_maker_checker_enabled', $row);
        $this->assertArrayNotHasKey('approval_require_second_approver', $row);
        $this->assertArrayNotHasKey('anomaly_alert_enabled', $row);
        $this->assertArrayNotHasKey('anomaly_bulk_threshold', $row);
    }

    public function test_db_rejects_unknown_filter_and_order_columns(): void
    {
        $tenantId = $this->defaultTenantId();
        [$user] = $this->createUserWithProfile($tenantId, 'admin', 'X-1');

        $badFilter = $this->actingAs($user)->postJson('/api/db', [
            'table' => 'profiles',
            'action' => 'select',
            'filters' => [
                'eq' => ['not_a_column' => 'x'],
            ],
        ]);

        $badFilter->assertStatus(422);
        $badFilter->assertJsonPath('error', 'Kolom filter tidak diizinkan');

        $badOrder = $this->actingAs($user)->postJson('/api/db', [
            'table' => 'profiles',
            'action' => 'select',
            'order' => [
                ['field' => 'not_a_column', 'dir' => 'asc'],
            ],
        ]);

        $badOrder->assertStatus(422);
        $badOrder->assertJsonPath('error', 'Kolom order tidak diizinkan');
    }

    public function test_siswa_cannot_insert_tugas_jawaban_for_other_class(): void
    {
        $tenantId = $this->defaultTenantId();
        [$user] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');

        $tugasId = DB::table('tugas')->insertGetId([
            'kelas' => 'X-2',
            'judul' => 'PR Matematika',
            'mapel' => 'Matematika',
            'created_at' => now(),
            'updated_at' => now(),
            'tenant_id' => $tenantId,
        ]);

        $response = $this->actingAs($user)->postJson('/api/db', [
            'table' => 'tugas_jawaban',
            'action' => 'insert',
            'payload' => [
                'tugas_id' => $tugasId,
                'file_name' => 'jawaban.pdf',
            ],
        ]);

        $response->assertStatus(422);
        $response->assertJsonPath('error', 'Tugas tidak diizinkan');
    }

    public function test_siswa_can_insert_tugas_jawaban_for_own_class(): void
    {
        $tenantId = $this->defaultTenantId();
        [$user] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');

        $tugasId = DB::table('tugas')->insertGetId([
            'kelas' => 'X-1',
            'judul' => 'PR Bahasa',
            'mapel' => 'Bahasa Indonesia',
            'created_at' => now(),
            'updated_at' => now(),
            'tenant_id' => $tenantId,
        ]);

        $response = $this->actingAs($user)->postJson('/api/db', [
            'table' => 'tugas_jawaban',
            'action' => 'insert',
            'payload' => [
                'tugas_id' => $tugasId,
                'file_name' => 'jawaban.pdf',
            ],
        ]);

        $response->assertOk();

        $this->assertDatabaseHas('tugas_jawaban', [
            'tugas_id' => $tugasId,
            'user_id' => $user->id,
            'tenant_id' => $tenantId,
        ]);
    }

    public function test_profiles_select_hides_sensitive_fields_for_other_users(): void
    {
        $tenantId = $this->defaultTenantId();
        [$userA] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');
        [$userB] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');

        DB::table('profiles')->where('id', $userA->id)->update([
            'telp' => '081111111111',
            'alamat' => 'Alamat A',
            'no_hp_siswa' => '081111111112',
            'updated_at' => now(),
        ]);

        DB::table('profiles')->where('id', $userB->id)->update([
            'telp' => '082222222222',
            'alamat' => 'Alamat B',
            'no_hp_siswa' => '082222222223',
            'updated_at' => now(),
        ]);

        $response = $this->actingAs($userA)->postJson('/api/db', [
            'table' => 'profiles',
            'action' => 'select',
            'columns' => '*',
        ]);

        $response->assertOk();
        $rows = $response->json('data');

        $this->assertIsArray($rows);
        $own = collect($rows)->firstWhere('id', $userA->id);
        $other = collect($rows)->firstWhere('id', $userB->id);

        $this->assertIsArray($own);
        $this->assertSame('081111111111', $own['telp'] ?? null);
        $this->assertSame('Alamat A', $own['alamat'] ?? null);

        $this->assertIsArray($other);
        $this->assertArrayNotHasKey('telp', $other);
        $this->assertArrayNotHasKey('alamat', $other);
        $this->assertArrayNotHasKey('no_hp_siswa', $other);
    }

    public function test_wali_kelas_can_see_sensitive_student_fields_only_for_own_homeroom(): void
    {
        $tenantId = $this->defaultTenantId();
        [$guru] = $this->createUserWithProfile($tenantId, 'guru', 'X-1');
        [$siswaWali] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');
        [$siswaMapel] = $this->createUserWithProfile($tenantId, 'siswa', 'X-2');
        $period = AcademicPeriod::current();

        DB::table('kelas')->updateOrInsert(
            ['id' => 'X-1'],
            [
                'nama' => 'X-1',
                'grade' => 'X',
                'suffix' => '1',
                'created_at' => now(),
                'updated_at' => now(),
                'tenant_id' => $tenantId,
            ]
        );
        DB::table('kelas')->updateOrInsert(
            ['id' => 'X-2'],
            [
                'nama' => 'X-2',
                'grade' => 'X',
                'suffix' => '2',
                'created_at' => now(),
                'updated_at' => now(),
                'tenant_id' => $tenantId,
            ]
        );
        DB::table('kelas_struktur')->updateOrInsert(
            ['kelas_id' => 'X-1'],
            [
                'wali_guru_id' => $guru->id,
                'wali_guru_nama' => 'Guru Wali',
                'created_at' => now(),
                'updated_at' => now(),
                'tenant_id' => $tenantId,
            ]
        );
        DB::table('jadwal')->updateOrInsert(
            ['id' => 'J-1', 'kelas_id' => 'X-2'],
            [
                'hari' => 'Senin',
                'mapel' => 'Matematika',
                'guru_id' => $guru->id,
                'guru_nama' => 'Guru Wali',
                'jam_mulai' => '07:00:00',
                'jam_selesai' => '08:00:00',
                'tahun_ajaran' => $period['tahun_ajaran'],
                'semester' => $period['semester'],
                'created_at' => now(),
                'updated_at' => now(),
                'tenant_id' => $tenantId,
            ]
        );

        DB::table('profiles')->where('id', $siswaWali->id)->update([
            'telp' => '081234567890',
            'alamat' => 'Alamat Wali',
            'tanggal_lahir' => '2009-01-02',
            'no_hp_siswa' => '081234567891',
            'no_hp_wali' => '081234567892',
            'updated_at' => now(),
        ]);
        DB::table('profiles')->where('id', $siswaMapel->id)->update([
            'telp' => '089999999999',
            'alamat' => 'Alamat Mapel',
            'tanggal_lahir' => '2009-03-04',
            'no_hp_siswa' => '089999999998',
            'no_hp_wali' => '089999999997',
            'updated_at' => now(),
        ]);

        $response = $this->actingAs($guru)->postJson('/api/db', [
            'table' => 'profiles',
            'action' => 'select',
            'columns' => '*',
        ]);

        $response->assertOk();
        $rows = $response->json('data');
        $this->assertIsArray($rows);

        $waliRow = collect($rows)->firstWhere('id', $siswaWali->id);
        $mapelRow = collect($rows)->firstWhere('id', $siswaMapel->id);

        $this->assertIsArray($waliRow);
        $this->assertSame('081234567891', $waliRow['no_hp_siswa'] ?? null);
        $this->assertSame('081234567892', $waliRow['no_hp_wali'] ?? null);
        $this->assertSame('Alamat Wali', $waliRow['alamat'] ?? null);
        $this->assertSame('2009-01-02', $waliRow['tanggal_lahir'] ?? null);

        $this->assertIsArray($mapelRow);
        $this->assertArrayNotHasKey('no_hp_siswa', $mapelRow);
        $this->assertArrayNotHasKey('no_hp_wali', $mapelRow);
        $this->assertArrayNotHasKey('alamat', $mapelRow);
        $this->assertArrayNotHasKey('tanggal_lahir', $mapelRow);
    }

    public function test_siswa_cannot_insert_tugas_jawaban_before_mulai(): void
    {
        $tenantId = $this->defaultTenantId();
        [$user] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');

        $tugasId = DB::table('tugas')->insertGetId([
            'kelas' => 'X-1',
            'judul' => 'PR Fisika',
            'mapel' => 'Fisika',
            'mulai' => now()->addHour(),
            'deadline' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
            'tenant_id' => $tenantId,
        ]);

        $response = $this->actingAs($user)->postJson('/api/db', [
            'table' => 'tugas_jawaban',
            'action' => 'insert',
            'payload' => [
                'tugas_id' => $tugasId,
                'file_name' => 'jawaban.pdf',
            ],
        ]);

        $response->assertStatus(422);
        $response->assertJsonPath('error', 'Tugas belum dimulai');
    }

    public function test_siswa_cannot_insert_tugas_jawaban_after_deadline(): void
    {
        $tenantId = $this->defaultTenantId();
        [$user] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');

        $tugasId = DB::table('tugas')->insertGetId([
            'kelas' => 'X-1',
            'judul' => 'PR Kimia',
            'mapel' => 'Kimia',
            'mulai' => now()->subDay(),
            'deadline' => now()->subMinute(),
            'created_at' => now(),
            'updated_at' => now(),
            'tenant_id' => $tenantId,
        ]);

        $response = $this->actingAs($user)->postJson('/api/db', [
            'table' => 'tugas_jawaban',
            'action' => 'insert',
            'payload' => [
                'tugas_id' => $tugasId,
                'file_name' => 'jawaban.pdf',
            ],
        ]);

        $response->assertStatus(422);
        $response->assertJsonPath('error', 'Deadline tugas sudah lewat');
    }

    public function test_siswa_cannot_update_or_delete_graded_tugas_jawaban(): void
    {
        $tenantId = $this->defaultTenantId();
        [$user] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');

        $tugasId = DB::table('tugas')->insertGetId([
            'kelas' => 'X-1',
            'judul' => 'PR Sejarah',
            'mapel' => 'Sejarah',
            'mulai' => now()->subDay(),
            'deadline' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
            'tenant_id' => $tenantId,
        ]);

        $jawabanId = DB::table('tugas_jawaban')->insertGetId([
            'tugas_id' => $tugasId,
            'user_id' => $user->id,
            'status' => 'dinilai',
            'nilai' => 88,
            'waktu_submit' => now()->subHour(),
            'tenant_id' => $tenantId,
        ]);

        $update = $this->actingAs($user)->postJson('/api/db', [
            'table' => 'tugas_jawaban',
            'action' => 'update',
            'payload' => [
                'link_url' => 'https://example.com/new-link',
            ],
            'filters' => [
                'eq' => ['id' => $jawabanId],
            ],
        ]);

        $update->assertStatus(422);
        $update->assertJsonPath('error', 'Jawaban yang sudah dinilai tidak boleh diubah');

        $delete = $this->actingAs($user)->postJson('/api/db', [
            'table' => 'tugas_jawaban',
            'action' => 'delete',
            'filters' => [
                'eq' => ['id' => $jawabanId],
            ],
        ]);

        $delete->assertStatus(422);
        $delete->assertJsonPath('error', 'Jawaban yang sudah dinilai tidak boleh diubah');
    }

    public function test_guru_cannot_create_tugas_with_past_mulai(): void
    {
        $tenantId = $this->defaultTenantId();
        [$guru] = $this->createUserWithProfile($tenantId, 'guru', 'X-1');

        $response = $this->actingAs($guru)->postJson('/api/db', [
            'table' => 'tugas',
            'action' => 'insert',
            'payload' => [
                'kelas' => 'X-1',
                'judul' => 'Tugas Baru',
                'mapel' => 'Matematika',
                'mulai' => now()->subMinute()->toIso8601String(),
                'deadline' => now()->addDay()->toIso8601String(),
            ],
        ]);

        $response->assertStatus(422);
        $response->assertJsonPath('error', 'Waktu mulai tidak boleh di masa lalu');
    }

    public function test_guru_cannot_update_tugas_deadline_to_past(): void
    {
        $tenantId = $this->defaultTenantId();
        [$guru] = $this->createUserWithProfile($tenantId, 'guru', 'X-1');

        $tugasId = DB::table('tugas')->insertGetId([
            'kelas' => 'X-1',
            'judul' => 'Tugas Biologi',
            'mapel' => 'Biologi',
            'mulai' => now()->addHour(),
            'deadline' => now()->addDays(2),
            'created_by' => $guru->id,
            'created_at' => now(),
            'updated_at' => now(),
            'tenant_id' => $tenantId,
        ]);

        $response = $this->actingAs($guru)->postJson('/api/db', [
            'table' => 'tugas',
            'action' => 'update',
            'payload' => [
                'deadline' => now()->subMinute()->toIso8601String(),
            ],
            'filters' => [
                'eq' => ['id' => $tugasId],
            ],
        ]);

        $response->assertStatus(422);
        $response->assertJsonPath('error', 'Deadline tidak boleh di masa lalu');
    }

    public function test_guru_cannot_delete_tugas_that_already_has_graded_submission(): void
    {
        $tenantId = $this->defaultTenantId();
        [$guru] = $this->createUserWithProfile($tenantId, 'guru', 'X-1');
        [$siswa] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');

        $tugasId = DB::table('tugas')->insertGetId([
            'kelas' => 'X-1',
            'judul' => 'Tugas Geografi',
            'mapel' => 'Geografi',
            'mulai' => now()->subDay(),
            'deadline' => now()->addDay(),
            'created_by' => $guru->id,
            'created_at' => now(),
            'updated_at' => now(),
            'tenant_id' => $tenantId,
        ]);

        DB::table('tugas_jawaban')->insert([
            'tugas_id' => $tugasId,
            'user_id' => $siswa->id,
            'status' => 'dinilai',
            'nilai' => 95,
            'waktu_submit' => now()->subHour(),
            'tenant_id' => $tenantId,
        ]);

        $response = $this->actingAs($guru)->postJson('/api/db', [
            'table' => 'tugas',
            'action' => 'delete',
            'filters' => [
                'eq' => ['id' => $tugasId],
            ],
        ]);

        $response->assertStatus(422);
        $response->assertJsonPath('error', 'Tugas yang sudah memiliki nilai tidak boleh dihapus');
    }

    public function test_admin_can_insert_sertifikat_template_with_array_fields_payload(): void
    {
        $tenantId = $this->defaultTenantId();
        [$admin] = $this->createUserWithProfile($tenantId, 'admin', 'X-1');

        $response = $this->actingAs($admin)->postJson('/api/db', [
            'table' => 'templat_sertifikat_publik',
            'action' => 'insert',
            'payload' => [
                'id' => (string) Str::uuid(),
                'nama' => 'Template Event',
                'deskripsi' => 'Template test json fields',
                'background_url' => 'templates/default.png',
                'text_color' => '#000000',
                'font_family' => 'Helvetica',
                'font_size' => 20,
                'nama_x' => 460,
                'nama_y' => 260,
                'event_x' => 500,
                'event_y' => 300,
                'tanggal_x' => 420,
                'tanggal_y' => 360,
                'is_active' => true,
                'created_by' => $admin->id,
                'fields' => [
                    [
                        'key' => 'nama',
                        'label' => 'Nama',
                        'x' => 460,
                        'y' => 260,
                    ],
                    [
                        'key' => 'event',
                        'label' => 'Event',
                        'x' => 500,
                        'y' => 300,
                    ],
                ],
            ],
        ]);

        $response->assertOk();
        $this->assertIsArray($response->json('data'));

        $stored = DB::table('templat_sertifikat_publik')
            ->where('tenant_id', $tenantId)
            ->where('nama', 'Template Event')
            ->first();

        $this->assertNotNull($stored);
        $fields = json_decode((string) ($stored->fields ?? ''), true);
        $this->assertIsArray($fields);
        $this->assertCount(2, $fields);
        $this->assertSame('nama', $fields[0]['key'] ?? null);
    }

    private function defaultTenantId(): string
    {
        $tenantId = (string) DB::table('tenants')
            ->where('slug', 'default')
            ->value('id');

        $this->assertNotSame('', $tenantId, 'Tenant default tidak ditemukan di database test');

        return $tenantId;
    }

    private function createUserWithProfile(string $tenantId, string $role, string $kelas): array
    {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => $role.' test',
            'email' => $role.'_'.Str::random(8).'@example.com',
            'password' => Hash::make('password123'),
        ]);

        DB::table('profiles')->insert([
            'id' => $user->id,
            'tenant_id' => $tenantId,
            'email' => $user->email,
            'nama' => $user->name,
            'role' => $role,
            'kelas' => $kelas,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$user];
    }
}
