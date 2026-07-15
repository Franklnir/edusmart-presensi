<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class ScanTempPersistenceTest extends TestCase
{
    use RefreshDatabase;

    public function test_manual_scan_temp_upsert_persists_refresh_safe_rows_per_tenant(): void
    {
        config()->set('tenancy.allow_header_override', true);

        $tenantA = $this->createTenant('sma-bali');
        $tenantB = $this->createTenant('sma-lombok');

        $adminA = $this->createUserWithProfile($tenantA->id, 'admin', 'admin-bali@example.com');
        $adminB = $this->createUserWithProfile($tenantB->id, 'admin', 'admin-lombok@example.com');
        $studentA = $this->createUserWithProfile($tenantA->id, 'siswa', 'siswa-bali@example.com', 'XI-A');
        $studentB = $this->createUserWithProfile($tenantB->id, 'siswa', 'siswa-lombok@example.com', 'XI-A');

        $this->actingAs($adminA)
            ->withHeader('X-Tenant', 'sma-bali')
            ->postJson('/api/v2/attendance/scanner/temp', $this->scanTempPayload([
                'siswa_id' => $studentA->id,
                'kelas' => 'XI-A',
                'card_uid' => 'AAAA1111',
                'scan_at' => '2026-05-03T07:00:00+07:00',
                'idempotency_key' => 'scan-bali-1',
            ]))
            ->assertCreated()
            ->assertJsonPath('success', true);

        $this->actingAs($adminA)
            ->withHeader('X-Tenant', 'sma-bali')
            ->postJson('/api/v2/attendance/scanner/temp', $this->scanTempPayload([
                'siswa_id' => $studentA->id,
                'kelas' => 'XI-A',
                'card_uid' => 'BBBB2222',
                'scan_at' => '2026-05-03T07:05:00+07:00',
                'idempotency_key' => 'scan-bali-2',
            ]))
            ->assertCreated()
            ->assertJsonPath('success', true);

        $this->actingAs($adminB)
            ->withHeader('X-Tenant', 'sma-lombok')
            ->postJson('/api/v2/attendance/scanner/temp', $this->scanTempPayload([
                'siswa_id' => $studentB->id,
                'kelas' => 'XI-A',
                'card_uid' => 'CCCC3333',
                'scan_at' => '2026-05-03T07:00:00+07:00',
                'idempotency_key' => 'scan-lombok-1',
            ]))
            ->assertCreated()
            ->assertJsonPath('success', true);

        $this->assertSame(1, DB::table('absensi_scan_temp')
            ->where('tenant_id', $tenantA->id)
            ->where('tanggal', '2026-05-03')
            ->where('siswa_id', $studentA->id)
            ->where('sesi', 'masuk')
            ->count());

        $this->assertDatabaseHas('absensi_scan_temp', [
            'tenant_id' => $tenantA->id,
            'tanggal' => '2026-05-03',
            'siswa_id' => $studentA->id,
            'sesi' => 'masuk',
            'card_uid' => 'BBBB2222',
        ]);

        $this->assertDatabaseHas('absensi_scan_temp', [
            'tenant_id' => $tenantB->id,
            'tanggal' => '2026-05-03',
            'siswa_id' => $studentB->id,
            'sesi' => 'masuk',
            'card_uid' => 'CCCC3333',
        ]);

        $response = $this->actingAs($adminA)
            ->withHeader('X-Tenant', 'sma-bali')
            ->postJson('/api/db', [
                'table' => 'absensi_scan_temp',
                'action' => 'select',
                'columns' => 'siswa_id,card_uid,tanggal,sesi',
                'filters' => [
                    'eq' => [
                        'tanggal' => '2026-05-03',
                    ],
                ],
            ]);

        $response->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.siswa_id', $studentA->id)
            ->assertJsonPath('data.0.card_uid', 'BBBB2222');
    }

    private function scanTempPayload(array $overrides): array
    {
        return array_merge([
            'tanggal' => '2026-05-03',
            'siswa_id' => null,
            'kelas' => 'XI-A',
            'sesi' => 'masuk',
            'scan_at' => '2026-05-03T07:00:00+07:00',
            'mapel_count' => 6,
            'source' => 'web_admin',
            'card_uid' => 'AAAA1111',
        ], $overrides);
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

    private function createUserWithProfile(string $tenantId, string $role, string $email, ?string $kelas = null): User
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
