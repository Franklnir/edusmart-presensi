<?php

namespace Tests\Feature\Api\V2;

use App\Models\AbsensiAjuan;
use App\Models\Profile;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AttendanceRequestControllerTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['tenancy.allow_header_override' => true]);

        DB::table('tenants')->insertOrIgnore([
            ['id' => 'tenant-a', 'slug' => 'tenant-a', 'name' => 'Tenant A'],
            ['id' => 'tenant-b', 'slug' => 'tenant-b', 'name' => 'Tenant B'],
        ]);
    }

    private function createUserWithRole(string $tenantId, string $role): User
    {
        $user = User::factory()->create([
            'id' => Str::uuid()->toString(),
        ]);
        Profile::forceCreate([
            'id' => $user->id,
            'email' => $user->email,
            'tenant_id' => $tenantId,
            'role' => $role,
            'nama' => 'Test '.$role,
        ]);

        return $user;
    }

    private function grantTeacherClass(User $teacher, string $tenantId, string $classId, string $subject): void
    {
        DB::table('kelas')->insertOrIgnore(['id' => $classId, 'nama' => $classId, 'tenant_id' => $tenantId]);
        DB::table('jadwal')->insert([
            'id' => 'schedule-'.Str::uuid(),
            'kelas_id' => $classId,
            'hari' => 'Senin',
            'mapel' => $subject,
            'guru_id' => $teacher->id,
            'jam_mulai' => '08:00',
            'jam_selesai' => '09:00',
            'tenant_id' => $tenantId,
        ]);
    }

    public function test_siswa_can_create_ajuan()
    {
        $siswa = $this->createUserWithRole('tenant-a', 'siswa');
        $siswa->profile->update(['kelas' => '10A']);

        Sanctum::actingAs($siswa);

        $response = $this->postJson('/api/v2/attendance-requests', [
            'kelas' => '10A',
            'tanggal' => Carbon::today()->format('Y-m-d'),
            'mapel' => 'Matematika',
            'alasan' => 'Sakit perut',
            'idempotency_key' => Str::uuid()->toString(),
        ], [
            'X-Tenant' => 'tenant-a',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.status_guru', 'pending');

        $this->assertDatabaseHas('absensi_ajuan', [
            'uid' => $siswa->id,
            'kelas' => '10A',
            'status_guru' => 'pending',
            'alasan' => 'Sakit perut',
        ]);
    }

    public function test_guru_can_approve_ajuan()
    {
        $guru = $this->createUserWithRole('tenant-a', 'guru');
        $siswa = $this->createUserWithRole('tenant-a', 'siswa');
        $siswa->profile->update(['kelas' => '10A']);
        $this->grantTeacherClass($guru, 'tenant-a', '10A', 'Fisika');

        $ajuan = AbsensiAjuan::forceCreate([
            'tenant_id' => 'tenant-a',
            'uid' => $siswa->id,
            'nama' => 'Test siswa',
            'kelas' => '10A',
            'tanggal' => Carbon::today(),
            'mapel' => 'Fisika',
            'alasan' => 'Ada acara keluarga',
            'status_guru' => 'pending',
        ]);

        Sanctum::actingAs($guru);

        $response = $this->patchJson('/api/v2/attendance-requests/'.$ajuan->id, [
            'action' => 'izin',
            'idempotency_key' => 'approve-request',
        ], [
            'X-Tenant' => 'tenant-a',
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.status_guru', 'terima')
            ->assertJsonPath('data.kategori_final', 'Izin');

        $this->assertDatabaseHas('absensi_ajuan', [
            'id' => $ajuan->id,
            'status_guru' => 'terima',
        ]);

        $this->assertDatabaseHas('absensi', [
            'uid' => $siswa->id,
            'status' => 'Izin',
        ]);
    }

    public function test_siswa_cannot_approve_ajuan()
    {
        $siswa = $this->createUserWithRole('tenant-a', 'siswa');
        $siswa->profile->update(['kelas' => '10A']);

        $ajuan = AbsensiAjuan::forceCreate([
            'tenant_id' => 'tenant-a',
            'uid' => $siswa->id,
            'nama' => 'Test siswa',
            'kelas' => '10A',
            'tanggal' => Carbon::today(),
            'mapel' => 'Fisika',
            'alasan' => 'Ada acara keluarga',
            'status_guru' => 'pending',
        ]);

        Sanctum::actingAs($siswa);

        $response = $this->patchJson('/api/v2/attendance-requests/'.$ajuan->id, [
            'action' => 'izin',
            'idempotency_key' => 'student-approve-request',
        ], [
            'X-Tenant' => 'tenant-a',
        ]);

        $response->assertStatus(403);
    }

    public function test_decision_is_atomic_final_and_audited(): void
    {
        $guru = $this->createUserWithRole('tenant-a', 'guru');
        $siswa = $this->createUserWithRole('tenant-a', 'siswa');
        $siswa->profile->update(['kelas' => '10A']);
        $this->grantTeacherClass($guru, 'tenant-a', '10A', 'Fisika');
        $ajuan = AbsensiAjuan::forceCreate([
            'tenant_id' => 'tenant-a',
            'uid' => $siswa->id,
            'nama' => 'Test siswa',
            'kelas' => '10A',
            'tanggal' => Carbon::today(),
            'mapel' => 'Fisika',
            'alasan' => 'Sakit',
            'status_guru' => 'pending',
        ]);
        Sanctum::actingAs($guru);

        $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->patchJson('/api/v2/attendance-requests/'.$ajuan->id, [
                'action' => 'sakit',
                'idempotency_key' => 'final-sakit',
            ])
            ->assertOk()
            ->assertJsonPath('data.status_guru', 'sakit')
            ->assertJsonPath('data.kategori_final', 'Sakit');

        $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->patchJson('/api/v2/attendance-requests/'.$ajuan->id, [
                'action' => 'izin',
                'idempotency_key' => 'final-izin',
            ])
            ->assertStatus(409)
            ->assertJsonPath('code', 'ATTENDANCE_REQUEST_ALREADY_PROCESSED');

        $this->assertDatabaseCount('absensi', 1);
        $this->assertDatabaseHas('audit_log', [
            'tenant_id' => 'tenant-a',
            'table_name' => 'absensi_ajuan',
            'record_id' => $ajuan->id,
            'action' => 'UPDATE',
            'user_id' => $guru->id,
        ]);
    }

    public function test_unassigned_teacher_and_other_tenant_cannot_process_request(): void
    {
        $assignedGuru = $this->createUserWithRole('tenant-a', 'guru');
        $unassignedGuru = $this->createUserWithRole('tenant-a', 'guru');
        $otherTenantGuru = $this->createUserWithRole('tenant-b', 'guru');
        $siswa = $this->createUserWithRole('tenant-a', 'siswa');
        $siswa->profile->update(['kelas' => '10A']);
        $this->grantTeacherClass($assignedGuru, 'tenant-a', '10A', 'Fisika');
        $ajuan = AbsensiAjuan::forceCreate([
            'tenant_id' => 'tenant-a',
            'uid' => $siswa->id,
            'nama' => 'Test siswa',
            'kelas' => '10A',
            'tanggal' => Carbon::today(),
            'mapel' => 'Fisika',
            'alasan' => 'Izin',
            'status_guru' => 'pending',
        ]);

        Sanctum::actingAs($unassignedGuru);
        $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->patchJson('/api/v2/attendance-requests/'.$ajuan->id, [
                'action' => 'izin',
                'idempotency_key' => 'unassigned-decision',
            ])
            ->assertForbidden();

        Sanctum::actingAs($otherTenantGuru);
        $this->withHeaders(['X-Tenant' => 'tenant-b'])
            ->patchJson('/api/v2/attendance-requests/'.$ajuan->id, [
                'action' => 'izin',
                'idempotency_key' => 'other-tenant-decision',
            ])
            ->assertNotFound();
    }

    public function test_student_identity_and_class_come_from_authenticated_profile(): void
    {
        $siswa = $this->createUserWithRole('tenant-a', 'siswa');
        $other = $this->createUserWithRole('tenant-a', 'siswa');
        $siswa->profile->update(['kelas' => '10A']);
        Sanctum::actingAs($siswa);

        $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->postJson('/api/v2/attendance-requests', [
                'uid' => $other->id,
                'kelas' => '10B',
                'tanggal' => Carbon::today()->format('Y-m-d'),
                'mapel' => 'Fisika',
                'alasan' => 'Izin',
                'idempotency_key' => (string) Str::uuid(),
            ])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'ATTENDANCE_CLASS_MISMATCH');

        $this->assertDatabaseMissing('absensi_ajuan', ['uid' => $other->id]);
    }

    public function test_only_pending_request_can_be_deleted_by_owner(): void
    {
        $siswa = $this->createUserWithRole('tenant-a', 'siswa');
        $siswa->profile->update(['kelas' => '10A']);
        $pending = AbsensiAjuan::forceCreate([
            'tenant_id' => 'tenant-a',
            'uid' => $siswa->id,
            'nama' => 'Test siswa',
            'kelas' => '10A',
            'tanggal' => Carbon::today(),
            'mapel' => 'Fisika',
            'alasan' => 'Izin',
            'status_guru' => 'pending',
        ]);
        $final = AbsensiAjuan::forceCreate([
            'tenant_id' => 'tenant-a',
            'uid' => $siswa->id,
            'nama' => 'Test siswa',
            'kelas' => '10A',
            'tanggal' => Carbon::yesterday(),
            'mapel' => 'Fisika',
            'alasan' => 'Izin',
            'status_guru' => 'tolak',
        ]);
        Sanctum::actingAs($siswa);

        $this->withHeaders(['X-Tenant' => 'tenant-a', 'Idempotency-Key' => 'delete-final'])
            ->deleteJson('/api/v2/attendance-requests/'.$final->id)
            ->assertForbidden();
        $this->withHeaders(['X-Tenant' => 'tenant-a', 'Idempotency-Key' => 'delete-pending'])
            ->deleteJson('/api/v2/attendance-requests/'.$pending->id)
            ->assertOk();
        $this->withHeaders(['X-Tenant' => 'tenant-a', 'Idempotency-Key' => 'delete-pending'])
            ->deleteJson('/api/v2/attendance-requests/'.$pending->id)
            ->assertOk()
            ->assertHeader('Idempotency-Replayed', 'true');

        $this->assertDatabaseMissing('absensi_ajuan', ['id' => $pending->id]);
        $this->assertDatabaseHas('absensi_ajuan', ['id' => $final->id]);
    }
}
