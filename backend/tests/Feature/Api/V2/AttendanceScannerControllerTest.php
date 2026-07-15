<?php

namespace Tests\Feature\Api\V2;

use App\Models\Absensi;
use App\Models\Profile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AttendanceScannerControllerTest extends TestCase
{
    use RefreshDatabase;

    private Profile $admin;

    private Profile $student;

    private string $tenantId = 'test-tenant';

    protected function setUp(): void
    {
        parent::setUp();
        config(['tenancy.allow_header_override' => true]);

        $this->tenantId = (string) DB::table('tenants')->where('slug', 'default')->value('id');
        if (! $this->tenantId) {
            $this->tenantId = 'test-tenant';
            DB::table('tenants')->insert(['id' => $this->tenantId, 'slug' => 'default', 'nama' => 'Test', 'created_at' => now(), 'updated_at' => now()]);
        }

        $adminUser = User::factory()->create([
            'id' => Str::uuid()->toString(),
        ]);
        $this->admin = Profile::create([
            'id' => $adminUser->id,
            'user_id' => $adminUser->id,
            'nama' => 'Admin Test',
            'email' => $adminUser->email,
            'tenant_id' => $this->tenantId,
            'role' => 'admin',
            'status' => 'active',
        ]);
        $this->admin->user = $adminUser;

        $studentUser = User::factory()->create([
            'id' => Str::uuid()->toString(),
        ]);
        $this->student = Profile::create([
            'id' => $studentUser->id,
            'user_id' => $studentUser->id,
            'nama' => 'Student Test',
            'email' => $studentUser->email,
            'tenant_id' => $this->tenantId,
            'role' => 'siswa',
            'kelas' => '10-A',
            'status' => 'active',
        ]);
        $this->student->user = $studentUser;
    }

    public function test_can_bulk_store_attendance()
    {
        $payload = [
            'idempotency_key' => 'test-bulk-1',
            'records' => [
                [
                    'uid' => $this->student->id,
                    'kelas' => '10-A',
                    'tanggal' => now()->format('Y-m-d'),
                    'status' => 'Hadir',
                    'mapel' => 'Matematika',
                    'nama' => $this->student->nama,
                    'oleh' => 'SYSTEM_RFID',
                ],
            ],
        ];

        Sanctum::actingAs($this->admin->user);
        $response = $this->withHeaders(['X-Tenant' => 'default'])
            ->postJson('/api/v2/attendance/scanner/bulk', $payload);

        $response->assertStatus(201)
            ->assertJsonPath('success', true);

        $this->assertDatabaseHas('absensi', [
            'tenant_id' => $this->tenantId,
            'uid' => $this->student->id,
            'mapel' => 'Matematika',
            'status' => 'Hadir',
        ]);

        $this->assertDatabaseHas('audit_log', [
            'tenant_id' => $this->tenantId,
            'table_name' => 'absensi',
            'action' => 'INSERT',
        ]);
    }

    public function test_bulk_store_prevents_duplicate()
    {
        DB::table('absensi')->insert([
            'tenant_id' => $this->tenantId,
            'uid' => $this->student->id,
            'tanggal' => now()->format('Y-m-d'),
            'kelas' => '10-A',
            'mapel' => 'Fisika',
            'status' => 'Hadir',
        ]);

        $payload = [
            'idempotency_key' => 'test-bulk-2',
            'records' => [
                [
                    'uid' => $this->student->id,
                    'kelas' => '10-A',
                    'tanggal' => now()->format('Y-m-d'),
                    'status' => 'Hadir',
                    'mapel' => 'Fisika',
                ],
                [
                    'uid' => $this->student->id,
                    'kelas' => '10-A',
                    'tanggal' => now()->format('Y-m-d'),
                    'status' => 'Hadir',
                    'mapel' => 'Kimia',
                ],
            ],
        ];

        Sanctum::actingAs($this->admin->user);
        $response = $this->withHeaders(['X-Tenant' => 'default'])
            ->postJson('/api/v2/attendance/scanner/bulk', $payload);

        $response->assertStatus(201);

        // Fisika should not be duplicated, Kimia should be inserted
        $this->assertEquals(1, Absensi::where('mapel', 'Fisika')->count());
        $this->assertEquals(1, Absensi::where('mapel', 'Kimia')->count());
    }

    public function test_can_store_temp_scan()
    {
        $payload = [
            'tanggal' => now()->format('Y-m-d'),
            'siswa_id' => $this->student->id,
            'kelas' => '10-A',
            'sesi' => 'masuk',
            'scan_at' => now()->toIso8601String(),
            'source' => 'MANUAL_SCAN',
            'card_uid' => '12345',
            'mapel_count' => 3,
        ];

        Sanctum::actingAs($this->admin->user);
        $response = $this->withHeaders(['X-Tenant' => 'default'])
            ->postJson('/api/v2/attendance/scanner/temp', $payload);

        $response->assertStatus(201)
            ->assertJsonPath('success', true);

        $this->assertDatabaseHas('absensi_scan_temp', [
            'tenant_id' => $this->tenantId,
            'siswa_id' => $this->student->id,
            'sesi' => 'masuk',
            'card_uid' => '12345',
        ]);
    }
}
