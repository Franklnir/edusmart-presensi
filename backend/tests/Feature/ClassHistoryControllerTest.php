<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class ClassHistoryControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_archive_delete_and_restore_class(): void
    {
        $tenantId = (string) DB::table('tenants')->where('slug', 'default')->value('id');
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'admin-history@example.com');
        $teacher = $this->createUserWithProfile($tenantId, 'guru', 'teacher-history@example.com');

        DB::table('kelas')->insert([
            'id' => 'x-a',
            'tenant_id' => $tenantId,
            'nama' => 'X A',
            'grade' => 'X',
            'suffix' => 'A',
            'angkatan' => '2026',
            'tahun_ajaran' => '2026/2027',
            'semester' => 'Ganjil',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('kelas_struktur')->insert([
            'tenant_id' => $tenantId,
            'kelas_id' => 'x-a',
            'wali_guru_id' => $teacher->id,
            'wali_guru_nama' => 'guru test',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('jadwal')->insert([
            'id' => 'x-a-20262027-ganjil-senin-matematika-0700-0800',
            'tenant_id' => $tenantId,
            'kelas_id' => 'x-a',
            'hari' => 'Senin',
            'mapel' => 'MATEMATIKA',
            'guru_id' => $teacher->id,
            'guru_nama' => 'guru test',
            'jam_mulai' => '07:00',
            'jam_selesai' => '08:00',
            'tahun_ajaran' => '2026/2027',
            'semester' => 'Ganjil',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $deleteResponse = $this
            ->actingAs($admin)
            ->deleteJson('/api/admin/classes/x-a');

        $deleteResponse->assertOk()
            ->assertJsonPath('data.class_id', 'x-a')
            ->assertJsonPath('data.summary.jadwal_count', 1)
            ->assertJsonPath('data.summary.jadwal', 1);

        $this->assertDatabaseMissing('kelas', ['id' => 'x-a', 'tenant_id' => $tenantId]);
        $this->assertDatabaseMissing('jadwal', ['kelas_id' => 'x-a', 'tenant_id' => $tenantId]);

        $historyId = $deleteResponse->json('data.id');
        $restoreResponse = $this
            ->actingAs($admin)
            ->postJson("/api/admin/classes/deleted-history/{$historyId}/restore");

        $restoreResponse->assertOk()
            ->assertJsonPath('data.class_id', 'x-a');

        $this->assertDatabaseHas('kelas', ['id' => 'x-a', 'tenant_id' => $tenantId, 'nama' => 'X A']);
        $this->assertDatabaseHas('jadwal', ['kelas_id' => 'x-a', 'tenant_id' => $tenantId, 'mapel' => 'MATEMATIKA']);
        $this->assertDatabaseHas('kelas_deleted_histories', ['id' => $historyId, 'tenant_id' => $tenantId]);
        $this->assertNotNull(DB::table('kelas_deleted_histories')->where('id', $historyId)->value('restored_at'));
    }

    public function test_admin_cannot_delete_class_that_still_has_students(): void
    {
        $tenantId = (string) DB::table('tenants')->where('slug', 'default')->value('id');
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'admin-blocked-class@example.com');
        $this->createUserWithProfile($tenantId, 'siswa', 'student-blocked-class@example.com', 'x-a');

        DB::table('kelas')->insert([
            'id' => 'x-a',
            'tenant_id' => $tenantId,
            'nama' => 'X A',
            'grade' => 'X',
            'suffix' => 'A',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this
            ->actingAs($admin)
            ->deleteJson('/api/admin/classes/x-a');

        $response->assertStatus(409);
        $this->assertDatabaseHas('kelas', ['id' => 'x-a', 'tenant_id' => $tenantId]);
        $this->assertDatabaseMissing('kelas_deleted_histories', ['class_id' => 'x-a', 'tenant_id' => $tenantId]);
    }

    private function createUserWithProfile(string $tenantId, string $role, string $email, string $kelas = ''): User
    {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => $role.' test',
            'email' => $email,
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

        return $user;
    }
}
