<?php

namespace Tests\Feature\Api\V2;

use App\Models\Profile;
use App\Models\Tugas;
use App\Models\TugasJawaban;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AssignmentControllerTest extends TestCase
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
        foreach (['10A', '10B'] as $class) {
            DB::table('kelas')->insert([
                'id' => $class,
                'nama' => $class,
                'tenant_id' => 'tenant-a',
            ]);
        }
    }

    private function user(string $tenantId, string $role, array $profile = []): User
    {
        $user = User::factory()->create(['id' => Str::uuid()->toString()]);
        Profile::forceCreate(array_merge([
            'id' => $user->id,
            'email' => $user->email,
            'tenant_id' => $tenantId,
            'role' => $role,
            'nama' => "Test {$role}",
            'status' => 'active',
        ], $profile));

        return $user;
    }

    private function schedule(User $teacher, string $class = '10A', string $subject = 'Matematika'): void
    {
        $tenant = $teacher->profile->tenant_id;
        DB::table('jadwal')->insert([
            'id' => (string) Str::uuid(),
            'kelas_id' => $class,
            'hari' => 'Senin',
            'mapel' => $subject,
            'guru_id' => $teacher->id,
            'jam_mulai' => '08:00',
            'jam_selesai' => '09:00',
            'tenant_id' => $tenant,
        ]);
    }

    private function assignment(User $teacher, array $values = []): Tugas
    {
        return Tugas::forceCreate(array_merge([
            'kelas' => '10A',
            'judul' => 'Tugas Matematika',
            'mapel' => 'Matematika',
            'mulai' => now()->subMinute(),
            'deadline' => now()->addDays(7),
            'created_by' => $teacher->id,
            'tenant_id' => $teacher->profile->tenant_id,
            'status' => 'published',
        ], $values));
    }

    public function test_assigned_teacher_creates_idempotently_and_audit_is_written(): void
    {
        $teacher = $this->user('tenant-a', 'guru');
        $this->schedule($teacher);
        Sanctum::actingAs($teacher);
        $payload = [
            'kelas' => '10A',
            'judul' => 'Tugas Matematika',
            'mapel' => 'Matematika',
            'deadline' => now()->addDays(7)->toIso8601String(),
        ];

        $this->postJson('/api/v2/assignments', $payload, ['X-Tenant' => 'tenant-a'])
            ->assertStatus(422)->assertJsonPath('code', 'IDEMPOTENCY_KEY_REQUIRED');

        $headers = ['X-Tenant' => 'tenant-a', 'Idempotency-Key' => 'assignment-create-1'];
        $first = $this->postJson('/api/v2/assignments', $payload, $headers)
            ->assertCreated()->assertJsonPath('data.created_by', $teacher->id);
        $this->postJson('/api/v2/assignments', $payload, $headers)
            ->assertCreated()->assertHeader('Idempotency-Replayed', 'true');
        $this->assertDatabaseCount('tugas', 1);
        $this->assertDatabaseHas('audit_log', [
            'tenant_id' => 'tenant-a',
            'table_name' => 'tugas',
            'record_id' => (string) $first->json('data.id'),
            'action' => 'INSERT',
        ]);

        $this->postJson('/api/v2/assignments', [...$payload, 'judul' => 'Berubah'], $headers)
            ->assertStatus(409)->assertJsonPath('code', 'IDEMPOTENCY_CONFLICT');
    }

    public function test_teacher_cannot_create_for_unassigned_class_or_subject(): void
    {
        $teacher = $this->user('tenant-a', 'guru');
        $this->schedule($teacher, '10A', 'Matematika');
        Sanctum::actingAs($teacher);

        $this->postJson('/api/v2/assignments', [
            'kelas' => '10B',
            'judul' => 'Tugas',
            'mapel' => 'Matematika',
            'deadline' => now()->addDay()->toIso8601String(),
        ], ['X-Tenant' => 'tenant-a', 'Idempotency-Key' => 'wrong-class'])
            ->assertForbidden()->assertJsonPath('code', 'ASSIGNMENT_SCOPE_FORBIDDEN');
    }

    public function test_student_only_sees_published_assignments_for_own_class(): void
    {
        $teacher = $this->user('tenant-a', 'guru');
        $student = $this->user('tenant-a', 'siswa', ['kelas' => '10A']);
        $this->assignment($teacher, ['judul' => 'Visible']);
        $this->assignment($teacher, ['judul' => 'Draft', 'status' => 'draft']);
        $this->assignment($teacher, ['judul' => 'Other class', 'kelas' => '10B']);
        Sanctum::actingAs($student);

        $this->getJson('/api/v2/assignments', ['X-Tenant' => 'tenant-a'])
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.judul', 'Visible');
    }

    public function test_same_tenant_other_teacher_cannot_manage_assignment(): void
    {
        $owner = $this->user('tenant-a', 'guru');
        $other = $this->user('tenant-a', 'guru');
        $assignment = $this->assignment($owner);
        Sanctum::actingAs($other);

        $this->getJson("/api/v2/assignments/{$assignment->id}", ['X-Tenant' => 'tenant-a'])->assertForbidden();
        $this->patchJson("/api/v2/assignments/{$assignment->id}", ['judul' => 'Hijack'], [
            'X-Tenant' => 'tenant-a',
            'Idempotency-Key' => 'hijack',
        ])->assertForbidden();
        $this->deleteJson("/api/v2/assignments/{$assignment->id}", [], [
            'X-Tenant' => 'tenant-a',
            'Idempotency-Key' => 'other-teacher-delete',
        ])->assertForbidden();
    }

    public function test_cross_tenant_assignment_is_not_disclosed(): void
    {
        $owner = $this->user('tenant-b', 'guru');
        $actor = $this->user('tenant-a', 'admin');
        $assignment = $this->assignment($owner);
        Sanctum::actingAs($actor);

        $this->getJson("/api/v2/assignments/{$assignment->id}", ['X-Tenant' => 'tenant-a'])->assertNotFound();
    }

    public function test_assignment_with_submission_cannot_be_deleted(): void
    {
        $teacher = $this->user('tenant-a', 'guru');
        $student = $this->user('tenant-a', 'siswa', ['kelas' => '10A']);
        $assignment = $this->assignment($teacher);
        TugasJawaban::forceCreate([
            'tenant_id' => 'tenant-a',
            'tugas_id' => $assignment->id,
            'user_id' => $student->id,
            'status' => 'menunggu',
            'waktu_submit' => now(),
        ]);
        Sanctum::actingAs($teacher);

        $this->deleteJson("/api/v2/assignments/{$assignment->id}", [], [
            'X-Tenant' => 'tenant-a',
            'Idempotency-Key' => 'assignment-with-submission',
        ])
            ->assertStatus(409)->assertJsonPath('code', 'ASSIGNMENT_HAS_SUBMISSIONS');
    }

    public function test_assignment_delete_is_idempotent_and_audited(): void
    {
        $teacher = $this->user('tenant-a', 'guru');
        $assignment = $this->assignment($teacher);
        Sanctum::actingAs($teacher);
        $headers = ['X-Tenant' => 'tenant-a', 'Idempotency-Key' => 'delete-assignment'];

        $this->deleteJson("/api/v2/assignments/{$assignment->id}", [], $headers)->assertOk();
        $this->deleteJson("/api/v2/assignments/{$assignment->id}", [], $headers)
            ->assertOk()->assertHeader('Idempotency-Replayed', 'true');
        $this->assertDatabaseMissing('tugas', ['id' => $assignment->id]);
        $this->assertDatabaseHas('audit_log', [
            'tenant_id' => 'tenant-a',
            'table_name' => 'tugas',
            'record_id' => (string) $assignment->id,
            'action' => 'DELETE',
        ]);
    }
}
