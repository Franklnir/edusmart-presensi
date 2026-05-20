<?php

namespace Tests\Feature;

use App\Jobs\SendWhatsAppMessageJob;
use App\Services\WhatsApp\WhatsAppIntegrationService;
use App\Services\WhatsApp\WhatsAppNotificationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

class WhatsAppAttendanceProblemNotificationTest extends TestCase
{
    use RefreshDatabase;

    public function test_attendance_whatsapp_skips_normal_complete_attendance(): void
    {
        Queue::fake();

        $tenant = $this->createTenant('sma-bali');
        $student = $this->createStudent($tenant->id, 'Siswa Lengkap', 'XI-A', '081234567890');

        DB::table('absensi_scan_temp')->insert([
            [
                'tenant_id' => $tenant->id,
                'tanggal' => '2026-05-03',
                'siswa_id' => $student->id,
                'kelas' => 'XI-A',
                'sesi' => 'masuk',
                'scan_at' => '2026-05-03T07:05:00+07:00',
                'source' => 'web_admin',
                'card_uid' => 'AAAA1111',
                'created_at' => now(),
            ],
            [
                'tenant_id' => $tenant->id,
                'tanggal' => '2026-05-03',
                'siswa_id' => $student->id,
                'kelas' => 'XI-A',
                'sesi' => 'pulang',
                'scan_at' => '2026-05-03T14:10:00+07:00',
                'source' => 'web_admin',
                'card_uid' => 'AAAA1111',
                'created_at' => now(),
            ],
        ]);

        app(WhatsAppNotificationService::class)->handleTableMutation($tenant->id, 'absensi', 'insert', [], [[
            'id' => 1,
            'tenant_id' => $tenant->id,
            'kelas' => 'XI-A',
            'tanggal' => '2026-05-03',
            'uid' => $student->id,
            'mapel' => 'Matematika',
            'status' => 'Hadir',
            'nama' => 'Siswa Lengkap',
            'waktu' => '2026-05-03T08:00:00+07:00',
        ]]);

        $this->assertDatabaseCount('whatsapp_message_logs', 0);
        Queue::assertNothingPushed();
    }

    public function test_attendance_whatsapp_sends_one_no_checkin_alpha_problem_per_student_day(): void
    {
        Queue::fake();

        $tenant = $this->createTenant('sma-lombok');
        $student = $this->createStudent($tenant->id, 'Siswa Alpha', 'XI-A', '081234567891');

        app(WhatsAppNotificationService::class)->handleTableMutation($tenant->id, 'absensi', 'insert', [], [
            [
                'id' => 10,
                'tenant_id' => $tenant->id,
                'kelas' => 'XI-A',
                'tanggal' => '2026-05-03',
                'uid' => $student->id,
                'mapel' => 'Matematika',
                'status' => 'Alpha',
                'nama' => 'Siswa Alpha',
                'waktu' => '2026-05-03T08:01:00+07:00',
            ],
            [
                'id' => 11,
                'tenant_id' => $tenant->id,
                'kelas' => 'XI-A',
                'tanggal' => '2026-05-03',
                'uid' => $student->id,
                'mapel' => 'Bahasa Indonesia',
                'status' => 'Alpha',
                'nama' => 'Siswa Alpha',
                'waktu' => '2026-05-03T08:02:00+07:00',
            ],
        ]);

        $this->assertDatabaseCount('whatsapp_message_logs', 1);

        $log = DB::table('whatsapp_message_logs')->first();
        $this->assertSame('attendance_problem', $log->category);
        $this->assertStringContainsString('attendance-problem:no_checkin:'.$student->id.':2026-05-03', $log->event_key);
        $this->assertStringContainsString('Tidak scan masuk / Alpha', $log->message_text);
        $this->assertStringContainsString('Tanggal: 03-05-2026', $log->message_text);
        $this->assertStringContainsString('Waktu tercatat: 03-05-2026 08:01', $log->message_text);

        Queue::assertPushed(SendWhatsAppMessageJob::class, 1);
    }

    public function test_attendance_whatsapp_sends_missing_checkout_with_real_scan_time(): void
    {
        Queue::fake();

        $tenant = $this->createTenant('sma-jakarta');
        $student = $this->createStudent($tenant->id, 'Siswa Masuk Saja', 'XI-B', '081234567892');

        DB::table('absensi_scan_temp')->insert([
            'tenant_id' => $tenant->id,
            'tanggal' => '2026-05-03',
            'siswa_id' => $student->id,
            'kelas' => 'XI-B',
            'sesi' => 'masuk',
            'scan_at' => '2026-05-03T07:05:00+07:00',
            'source' => 'web_admin',
            'card_uid' => 'BBBB2222',
            'created_at' => now(),
        ]);

        app(WhatsAppNotificationService::class)->handleTableMutation($tenant->id, 'absensi', 'insert', [], [[
            'id' => 20,
            'tenant_id' => $tenant->id,
            'kelas' => 'XI-B',
            'tanggal' => '2026-05-03',
            'uid' => $student->id,
            'mapel' => 'Fisika',
            'status' => 'Hadir',
            'nama' => 'Siswa Masuk Saja',
            'waktu' => '2026-05-03T14:30:00+07:00',
        ]]);

        $this->assertDatabaseCount('whatsapp_message_logs', 1);

        $log = DB::table('whatsapp_message_logs')->first();
        $this->assertSame('attendance_problem', $log->category);
        $this->assertStringContainsString('attendance-problem:missing_checkout:'.$student->id.':2026-05-03', $log->event_key);
        $this->assertStringContainsString('Scan masuk, tetapi belum scan pulang', $log->message_text);
        $this->assertStringContainsString('Scan masuk: 07:05', $log->message_text);
        $this->assertStringContainsString('Scan pulang: -', $log->message_text);
        $this->assertStringContainsString('Waktu tercatat: 03-05-2026 14:30', $log->message_text);

        Queue::assertPushed(SendWhatsAppMessageJob::class, 1);
    }

    public function test_attendance_whatsapp_sends_no_checkin_when_only_checkout_exists(): void
    {
        Queue::fake();

        $tenant = $this->createTenant('sma-surabaya');
        $student = $this->createStudent($tenant->id, 'Siswa Pulang Saja', 'XI-C', '081234567893');

        DB::table('absensi_scan_temp')->insert([
            'tenant_id' => $tenant->id,
            'tanggal' => '2026-05-03',
            'siswa_id' => $student->id,
            'kelas' => 'XI-C',
            'sesi' => 'pulang',
            'scan_at' => '2026-05-03T14:10:00+07:00',
            'source' => 'web_admin',
            'card_uid' => 'CCCC3333',
            'created_at' => now(),
        ]);

        app(WhatsAppNotificationService::class)->handleTableMutation($tenant->id, 'absensi', 'insert', [], [[
            'id' => 30,
            'tenant_id' => $tenant->id,
            'kelas' => 'XI-C',
            'tanggal' => '2026-05-03',
            'uid' => $student->id,
            'mapel' => 'Kimia',
            'status' => 'Hadir',
            'nama' => 'Siswa Pulang Saja',
            'waktu' => '2026-05-03T14:15:00+07:00',
        ]]);

        $this->assertDatabaseCount('whatsapp_message_logs', 1);

        $log = DB::table('whatsapp_message_logs')->first();
        $this->assertSame('attendance_problem', $log->category);
        $this->assertStringContainsString('attendance-problem:no_checkin:'.$student->id.':2026-05-03', $log->event_key);
        $this->assertStringContainsString('Scan pulang tanpa scan masuk', $log->message_text);
        $this->assertStringContainsString('Scan masuk: -', $log->message_text);
        $this->assertStringContainsString('Scan pulang: 14:10', $log->message_text);
        $this->assertStringContainsString('Waktu tercatat: 03-05-2026 14:15', $log->message_text);

        Queue::assertPushed(SendWhatsAppMessageJob::class, 1);
    }

    public function test_whatsapp_assignment_submission_notification_is_not_sent(): void
    {
        Queue::fake();

        $tenant = $this->createTenant('sma-tugas');
        $student = $this->createStudent($tenant->id, 'Siswa Tugas', 'XI-D', '081234567894');
        $this->enableNotificationFlags($tenant->id, [
            'send_assignment_updates' => true,
        ]);

        DB::table('tugas')->insert([
            'id' => 1001,
            'tenant_id' => $tenant->id,
            'kelas' => 'XI-D',
            'judul' => 'Laporan Praktikum',
            'mapel' => 'Biologi',
            'deadline' => '2026-05-21T10:00:00+07:00',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        app(WhatsAppNotificationService::class)->handleTableMutation($tenant->id, 'tugas_jawaban', 'insert', [], [[
            'id' => 2001,
            'tenant_id' => $tenant->id,
            'tugas_id' => 1001,
            'user_id' => $student->id,
            'file_url' => 'https://example.test/laporan.pdf',
            'status' => 'terkirim',
            'waktu_submit' => '2026-05-20T09:30:00+07:00',
        ]]);

        $this->assertDatabaseCount('whatsapp_message_logs', 0);
        Queue::assertNothingPushed();
    }

    public function test_whatsapp_quiz_grade_notification_is_not_sent(): void
    {
        Queue::fake();

        $tenant = $this->createTenant('sma-quiz-wa');
        $student = $this->createStudent($tenant->id, 'Siswa Quiz', 'XI-E', '081234567895');
        $this->enableNotificationFlags($tenant->id, [
            'send_grade_updates' => true,
        ]);

        DB::table('quizzes')->insert([
            'id' => 'quiz-wa-1',
            'tenant_id' => $tenant->id,
            'guru_id' => $student->id,
            'kelas_id' => 'XI-E',
            'mapel' => 'Matematika',
            'nama' => 'Quiz Persamaan Linear',
            'deadline_at' => '2026-05-21T10:00:00+07:00',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        app(WhatsAppNotificationService::class)->handleTableMutation($tenant->id, 'quiz_submissions', 'insert', [], [[
            'id' => 'submission-wa-1',
            'tenant_id' => $tenant->id,
            'quiz_id' => 'quiz-wa-1',
            'siswa_id' => $student->id,
            'score' => 88,
            'status' => 'finished',
            'updated_at' => '2026-05-20T11:00:00+07:00',
        ]]);

        $this->assertDatabaseCount('whatsapp_message_logs', 0);
        Queue::assertNothingPushed();
    }

    private function createTenant(string $slug): object
    {
        $id = (string) Str::uuid();
        DB::table('tenants')->insert([
            'id' => $id,
            'name' => strtoupper(str_replace('-', ' ', $slug)),
            'slug' => $slug,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return (object) [
            'id' => $id,
            'slug' => $slug,
        ];
    }

    private function createStudent(string $tenantId, string $name, string $class, string $parentPhone): object
    {
        $id = (string) Str::uuid();
        $email = Str::slug($name).'@example.com';

        DB::table('users')->insert([
            'id' => $id,
            'name' => $name,
            'email' => $email,
            'password' => Hash::make('password123'),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('profiles')->insert([
            'id' => $id,
            'tenant_id' => $tenantId,
            'email' => $email,
            'nama' => $name,
            'role' => 'siswa',
            'kelas' => $class,
            'status' => 'active',
            'no_hp_wali' => $parentPhone,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return (object) [
            'id' => $id,
            'nama' => $name,
            'kelas' => $class,
        ];
    }

    private function enableNotificationFlags(string $tenantId, array $flags): void
    {
        $integrationService = app(WhatsAppIntegrationService::class);
        $integration = $integrationService->getOrCreateIntegration($tenantId);
        $settings = $integrationService->getOrCreateNotificationSettings($tenantId, $integration);

        $settings->fill(array_merge([
            'is_enabled' => true,
            'recipient_mode' => 'wali',
        ], $flags));
        $settings->save();
    }
}
