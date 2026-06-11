<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class MobileRfidApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_guru_can_send_mobile_nfc_scan_through_existing_rfid_logic(): void
    {
        config()->set('tenancy.allow_header_override', true);
        $tenant = $this->createTenant('sma-bali');
        $guru = $this->createUserWithProfile($tenant->id, 'guru', 'guru-mobile-rfid@example.com');

        $response = $this->actingAs($guru)->postJson('/api/mobile/guru/rfid/scan', [
            'card_uid' => 'A1B2C3D4',
            'mode' => 'enroll',
            'event_id' => 'mobile-event-001',
        ], [
            'X-Tenant' => 'sma-bali',
        ]);

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('reason', 'enroll_success')
            ->assertJsonPath('tenant_slug', 'sma-bali')
            ->assertJsonPath('event_id', 'mobile-event-001');

        $this->assertDatabaseHas('rfid_scans', [
            'tenant_id' => $tenant->id,
            'card_uid' => 'A1B2C3D4',
            'status' => 'raw',
        ]);

        $this->assertDatabaseHas('rfid_device_events', [
            'tenant_id' => $tenant->id,
            'event_id' => 'mobile-event-001',
            'source' => 'mobile-nfc',
        ]);
    }

    public function test_siswa_cannot_use_guru_mobile_rfid_scan(): void
    {
        config()->set('tenancy.allow_header_override', true);
        $tenant = $this->createTenant('sma-bali');
        $siswa = $this->createUserWithProfile($tenant->id, 'siswa', 'siswa-mobile-rfid@example.com');

        $this->actingAs($siswa)
            ->postJson('/api/mobile/guru/rfid/scan', [
                'card_uid' => 'A1B2C3D4',
            ], [
                'X-Tenant' => 'sma-bali',
            ])
            ->assertStatus(403);
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

    private function createUserWithProfile(string $tenantId, string $role, string $email): User
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
            'kelas' => 'X-1',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $user;
    }
}
