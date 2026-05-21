<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class AdminTeacherNameTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_update_teacher_name_without_changing_login_and_syncs_snapshots(): void
    {
        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'Admin Sekolah', 'admin@example.com');
        $teacher = $this->createUserWithProfile($tenantId, 'guru', 'Bu Rina Lama', 'rina.lama@example.com');
        $student = $this->createUserWithProfile($tenantId, 'siswa', 'Budi Siswa', 'budi@example.com');
        $now = now();

        DB::table('kelas')->insert([
            'id' => 'X-1',
            'nama' => 'X-1',
            'grade' => 'X',
            'suffix' => '1',
            'created_at' => $now,
            'updated_at' => $now,
            'tenant_id' => $tenantId,
        ]);

        DB::table('jadwal')->insert([
            'id' => 'senin-1',
            'kelas_id' => 'X-1',
            'hari' => 'Senin',
            'mapel' => 'Matematika',
            'guru_id' => $teacher->id,
            'guru_nama' => 'Bu Rina Lama',
            'jam_mulai' => '07:00',
            'jam_selesai' => '08:00',
            'created_at' => $now,
            'updated_at' => $now,
            'tenant_id' => $tenantId,
        ]);

        DB::table('kelas_struktur')->insert([
            'kelas_id' => 'X-1',
            'wali_guru_id' => $teacher->id,
            'wali_guru_nama' => 'Bu Rina Lama',
            'created_at' => $now,
            'updated_at' => $now,
            'tenant_id' => $tenantId,
        ]);

        DB::table('struktur_sekolah')->insert([
            'id' => 'wakasek',
            'jabatan' => 'Wakasek',
            'guru_id' => $teacher->id,
            'guru_nama' => 'Bu Rina Lama',
            'created_at' => $now,
            'updated_at' => $now,
            'tenant_id' => $tenantId,
        ]);

        DB::table('organisasi')->insert([
            'id' => 'osis',
            'nama' => 'OSIS',
            'pembina_guru_id' => $teacher->id,
            'pembina_guru_nama' => 'Bu Rina Lama',
            'created_at' => $now,
            'updated_at' => $now,
            'tenant_id' => $tenantId,
        ]);

        DB::table('absensi_ajuan')->insert([
            'id' => (string) Str::uuid(),
            'kelas' => 'X-1',
            'tanggal' => '2026-05-03',
            'uid' => $student->id,
            'nama' => 'Budi Siswa',
            'alasan' => 'Izin keluarga',
            'mapel' => 'Matematika',
            'status_guru' => 'pending',
            'guru_id' => $teacher->id,
            'guru_nama' => 'Bu Rina Lama',
            'created_at' => $now,
            'tenant_id' => $tenantId,
        ]);

        $response = $this->actingAs($admin)->patchJson("/api/admin/teachers/{$teacher->id}/name", [
            'nama' => '  Bu Rina Baru  ',
            'email' => 'tidak-boleh-ikut@example.com',
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.changed', true);
        $response->assertJsonPath('data.profile.nama', 'Bu Rina Baru');
        $response->assertJsonPath('data.profile.email', 'rina.lama@example.com');

        $this->assertDatabaseHas('profiles', [
            'id' => $teacher->id,
            'tenant_id' => $tenantId,
            'nama' => 'Bu Rina Baru',
            'email' => 'rina.lama@example.com',
        ]);
        $this->assertDatabaseHas('users', [
            'id' => $teacher->id,
            'name' => 'Bu Rina Baru',
            'email' => 'rina.lama@example.com',
        ]);
        $this->assertDatabaseHas('jadwal', ['guru_id' => $teacher->id, 'guru_nama' => 'Bu Rina Baru']);
        $this->assertDatabaseHas('kelas_struktur', ['wali_guru_id' => $teacher->id, 'wali_guru_nama' => 'Bu Rina Baru']);
        $this->assertDatabaseHas('struktur_sekolah', ['guru_id' => $teacher->id, 'guru_nama' => 'Bu Rina Baru']);
        $this->assertDatabaseHas('organisasi', ['pembina_guru_id' => $teacher->id, 'pembina_guru_nama' => 'Bu Rina Baru']);
        $this->assertDatabaseHas('absensi_ajuan', ['guru_id' => $teacher->id, 'guru_nama' => 'Bu Rina Baru']);

        $audit = DB::table('audit_log')
            ->where('table_name', 'profiles')
            ->where('record_id', $teacher->id)
            ->where('action', 'UPDATE')
            ->first();

        $this->assertNotNull($audit);
        $this->assertSame($admin->id, (string) $audit->user_id);
        $this->assertNotNull($audit->timestamp);

        $oldData = json_decode((string) $audit->old_data, true);
        $newData = json_decode((string) $audit->new_data, true);
        $this->assertSame('Bu Rina Lama', $oldData['nama'] ?? null);
        $this->assertSame('Bu Rina Baru', $newData['nama'] ?? null);
        $this->assertSame($admin->id, $newData['edited_by']['id'] ?? null);
        $this->assertSame('rina.lama@example.com', $newData['email'] ?? null);
    }

    public function test_admin_can_update_teacher_profile_without_opening_sensitive_fields(): void
    {
        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'Admin Sekolah', 'admin2@example.com');
        $teacher = $this->createUserWithProfile($tenantId, 'guru', 'Pak Dedi Lama', 'dedi@example.com', [
            'nis' => 'NIP-LAMA',
            'jk' => 'L',
            'agama' => 'Islam',
            'telp' => '080000',
            'alamat' => 'Alamat lama',
            'jabatan' => 'Guru Tetap',
            'status' => 'active',
            'tanggal_lahir' => '1980-01-01',
        ]);

        $response = $this->actingAs($admin)->patchJson("/api/admin/teachers/{$teacher->id}/profile", [
            'nama' => '  Pak Dedi Baru  ',
            'nis' => ' NIP BARU ',
            'jk' => 'P',
            'agama' => 'Kristen',
            'telp' => '08123456789',
            'alamat' => 'Alamat baru',
            'tanggal_lahir' => '1981-02-03',
            'email' => 'tidak-boleh-berubah@example.com',
            'role' => 'admin',
            'status' => 'nonaktif',
            'jabatan' => 'Kepala Sekolah',
            'rfid_uid' => 'RFID-TERBUKA',
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.profile.nama', 'Pak Dedi Baru');
        $response->assertJsonPath('data.profile.email', 'dedi@example.com');

        $this->assertDatabaseHas('profiles', [
            'id' => $teacher->id,
            'tenant_id' => $tenantId,
            'nama' => 'Pak Dedi Baru',
            'nis' => 'NIPBARU',
            'jk' => 'P',
            'agama' => 'Kristen',
            'telp' => '08123456789',
            'alamat' => 'Alamat baru',
            'email' => 'dedi@example.com',
            'role' => 'guru',
            'status' => 'active',
            'jabatan' => 'Guru Tetap',
        ]);
        $this->assertDatabaseHas('users', [
            'id' => $teacher->id,
            'name' => 'Pak Dedi Baru',
            'email' => 'dedi@example.com',
        ]);
    }

    public function test_teacher_can_update_own_profile_without_sensitive_fields(): void
    {
        $tenantId = $this->defaultTenantId();
        $teacher = $this->createUserWithProfile($tenantId, 'guru', 'Bu Maya Lama', 'maya@example.com', [
            'nis' => 'NIP-MAYA',
            'jk' => 'P',
            'agama' => 'Islam',
            'telp' => '080000',
            'alamat' => 'Alamat lama',
            'jabatan' => 'Guru Tetap',
            'status' => 'active',
            'rfid_uid' => 'RFID-LAMA',
            'tanggal_lahir' => '1985-04-05',
        ]);

        $response = $this->actingAs($teacher)->patchJson('/api/profile/me', [
            'nama' => 'Bu Maya Baru',
            'jk' => 'P',
            'agama' => 'Hindu',
            'telp' => '089999',
            'alamat' => 'Alamat baru',
            'tanggal_lahir' => '1986-06-07',
            'email' => 'maya-baru@example.com',
            'role' => 'admin',
            'status' => 'nonaktif',
            'jabatan' => 'Kepala Sekolah',
            'rfid_uid' => 'RFID-BARU',
            'nis' => 'NIP-BARU',
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.nama', 'Bu Maya Baru');
        $response->assertJsonPath('data.email', 'maya@example.com');

        $this->assertDatabaseHas('profiles', [
            'id' => $teacher->id,
            'tenant_id' => $tenantId,
            'nama' => 'Bu Maya Baru',
            'email' => 'maya@example.com',
            'role' => 'guru',
            'status' => 'active',
            'jabatan' => 'Guru Tetap',
            'rfid_uid' => 'RFID-LAMA',
            'nis' => 'NIP-MAYA',
            'agama' => 'Hindu',
            'telp' => '089999',
            'alamat' => 'Alamat baru',
        ]);
    }

    private function defaultTenantId(): string
    {
        return (string) DB::table('tenants')
            ->where('slug', 'default')
            ->value('id');
    }

    private function createUserWithProfile(string $tenantId, string $role, string $name, string $email, array $profileOverrides = []): User
    {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => $name,
            'email' => $email,
            'password' => Hash::make('password123'),
        ]);

        DB::table('profiles')->insert(array_merge([
            'id' => $user->id,
            'tenant_id' => $tenantId,
            'email' => $email,
            'nama' => $name,
            'role' => $role,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ], $profileOverrides));

        return $user;
    }
}
