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

class SubmissionControllerTest extends TestCase
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

    private function user(string $tenant, string $role, array $profile = []): User
    {
        $user = User::factory()->create(['id' => Str::uuid()->toString()]);
        Profile::forceCreate(array_merge([
            'id' => $user->id,
            'email' => $user->email,
            'tenant_id' => $tenant,
            'role' => $role,
            'nama' => "Test {$role}",
            'status' => 'active',
        ], $profile));

        return $user;
    }

    private function assignment(User $teacher, array $values = []): Tugas
    {
        return Tugas::forceCreate(array_merge([
            'tenant_id' => $teacher->profile->tenant_id,
            'kelas' => '10A',
            'judul' => 'Tugas',
            'mapel' => 'Matematika',
            'mulai' => now()->subMinute(),
            'deadline' => now()->addDay(),
            'status' => 'published',
            'created_by' => $teacher->id,
        ], $values));
    }

    private function submission(Tugas $assignment, User $student): TugasJawaban
    {
        return TugasJawaban::forceCreate([
            'tenant_id' => $assignment->tenant_id,
            'tugas_id' => $assignment->id,
            'user_id' => $student->id,
            'status' => 'menunggu',
            'waktu_submit' => now(),
        ]);
    }

    public function test_student_submits_idempotently_and_duplicate_record_is_blocked(): void
    {
        $teacher = $this->user('tenant-a', 'guru');
        $student = $this->user('tenant-a', 'siswa', ['kelas' => '10A']);
        $assignment = $this->assignment($teacher);
        Sanctum::actingAs($student);
        $payload = ['tugas_id' => $assignment->id, 'komentar_siswa' => 'Jawaban'];

        $this->postJson('/api/v2/submissions', $payload, ['X-Tenant' => 'tenant-a'])
            ->assertStatus(422)->assertJsonPath('code', 'IDEMPOTENCY_KEY_REQUIRED');
        $headers = ['X-Tenant' => 'tenant-a', 'Idempotency-Key' => 'submit-1'];
        $first = $this->postJson('/api/v2/submissions', $payload, $headers)
            ->assertCreated()->assertJsonPath('data.user_id', $student->id);
        $this->postJson('/api/v2/submissions', $payload, $headers)
            ->assertCreated()->assertHeader('Idempotency-Replayed', 'true');
        $this->assertDatabaseCount('tugas_jawaban', 1);
        $this->assertDatabaseHas('audit_log', [
            'table_name' => 'tugas_jawaban',
            'record_id' => (string) $first->json('data.id'),
            'action' => 'INSERT',
        ]);

        $this->postJson('/api/v2/submissions', $payload, [
            'X-Tenant' => 'tenant-a',
            'Idempotency-Key' => 'submit-2',
        ])->assertStatus(409)->assertJsonPath('code', 'SUBMISSION_ALREADY_EXISTS');
    }

    public function test_closed_future_and_expired_assignments_reject_submission(): void
    {
        $teacher = $this->user('tenant-a', 'guru');
        $student = $this->user('tenant-a', 'siswa', ['kelas' => '10A']);
        Sanctum::actingAs($student);
        $cases = [
            [$this->assignment($teacher, ['status' => 'closed']), 'ASSIGNMENT_NOT_OPEN'],
            [$this->assignment($teacher, ['mulai' => now()->addHour()]), 'ASSIGNMENT_NOT_STARTED'],
            [$this->assignment($teacher, ['deadline' => now()->subMinute()]), 'ASSIGNMENT_DEADLINE_PASSED'],
        ];

        foreach ($cases as $index => [$assignment, $code]) {
            $this->postJson('/api/v2/submissions', ['tugas_id' => $assignment->id], [
                'X-Tenant' => 'tenant-a',
                'Idempotency-Key' => "closed-{$index}",
            ])->assertStatus(409)->assertJsonPath('code', $code);
        }
    }

    public function test_student_cannot_submit_for_other_class(): void
    {
        $teacher = $this->user('tenant-a', 'guru');
        $student = $this->user('tenant-a', 'siswa', ['kelas' => '10B']);
        $assignment = $this->assignment($teacher);
        Sanctum::actingAs($student);

        $this->postJson('/api/v2/submissions', ['tugas_id' => $assignment->id], [
            'X-Tenant' => 'tenant-a',
            'Idempotency-Key' => 'wrong-class',
        ])->assertForbidden();
    }

    public function test_student_cannot_read_or_change_another_students_submission(): void
    {
        $teacher = $this->user('tenant-a', 'guru');
        $owner = $this->user('tenant-a', 'siswa', ['kelas' => '10A']);
        $other = $this->user('tenant-a', 'siswa', ['kelas' => '10A']);
        $submission = $this->submission($this->assignment($teacher), $owner);
        Sanctum::actingAs($other);

        $this->getJson("/api/v2/submissions/{$submission->id}", ['X-Tenant' => 'tenant-a'])->assertForbidden();
        $this->patchJson("/api/v2/submissions/{$submission->id}", ['komentar_siswa' => 'Hijack'], [
            'X-Tenant' => 'tenant-a',
            'Idempotency-Key' => 'hijack-update',
        ])->assertForbidden();
        $this->deleteJson("/api/v2/submissions/{$submission->id}", [], [
            'X-Tenant' => 'tenant-a',
            'Idempotency-Key' => 'hijack-delete',
        ])->assertForbidden();
    }

    public function test_only_assignment_owner_can_grade_and_grade_is_audited(): void
    {
        $owner = $this->user('tenant-a', 'guru');
        $other = $this->user('tenant-a', 'guru');
        $student = $this->user('tenant-a', 'siswa', ['kelas' => '10A']);
        $submission = $this->submission($this->assignment($owner), $student);

        Sanctum::actingAs($other);
        $this->patchJson("/api/v2/submissions/{$submission->id}/grade", ['nilai' => 90], [
            'X-Tenant' => 'tenant-a',
            'Idempotency-Key' => 'other-grade',
        ])->assertForbidden();

        Sanctum::actingAs($owner);
        $this->patchJson("/api/v2/submissions/{$submission->id}/grade", ['nilai' => 95], [
            'X-Tenant' => 'tenant-a',
            'Idempotency-Key' => 'owner-grade',
        ])->assertOk()->assertJsonPath('data.nilai', 95)->assertJsonPath('data.dinilai_oleh', $owner->id);
        $this->assertDatabaseHas('audit_log', [
            'tenant_id' => 'tenant-a',
            'table_name' => 'tugas_jawaban',
            'record_id' => (string) $submission->id,
            'action' => 'UPDATE',
            'user_id' => $owner->id,
        ]);
    }

    public function test_grade_validation_and_grade_by_user_require_existing_submission(): void
    {
        $teacher = $this->user('tenant-a', 'guru');
        $student = $this->user('tenant-a', 'siswa', ['kelas' => '10A']);
        $assignment = $this->assignment($teacher);
        $submission = $this->submission($assignment, $student);
        Sanctum::actingAs($teacher);

        $this->patchJson("/api/v2/submissions/{$submission->id}/grade", ['nilai' => 101], [
            'X-Tenant' => 'tenant-a',
            'Idempotency-Key' => 'invalid-grade',
        ])->assertUnprocessable();

        $otherStudent = $this->user('tenant-a', 'siswa', ['kelas' => '10A']);
        $this->postJson('/api/v2/submissions/grade-by-user', [
            'tugas_id' => $assignment->id,
            'user_id' => $otherStudent->id,
            'nilai' => 80,
        ], ['X-Tenant' => 'tenant-a', 'Idempotency-Key' => 'missing-submission'])
            ->assertStatus(409)->assertJsonPath('code', 'SUBMISSION_NOT_FOUND');
    }

    public function test_cross_tenant_submission_is_not_disclosed(): void
    {
        $teacherB = $this->user('tenant-b', 'guru');
        $studentB = $this->user('tenant-b', 'siswa', ['kelas' => '10A']);
        $submission = $this->submission($this->assignment($teacherB), $studentB);
        $adminA = $this->user('tenant-a', 'admin');
        Sanctum::actingAs($adminA);

        $this->getJson("/api/v2/submissions/{$submission->id}", ['X-Tenant' => 'tenant-a'])->assertNotFound();
    }
}
