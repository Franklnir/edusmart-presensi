<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class BrowserNfcApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_send_browser_nfc_event_through_rfid_ingress(): void
    {
        config()->set('tenancy.allow_header_override', true);
        $tenant = $this->createTenant('sma-bali');
        $admin = $this->createUserWithProfile($tenant->id, 'admin', 'admin-browser-nfc@example.com');

        $response = $this->actingAs($admin)->postJson('/api/admin/rfid/browser-event', [
            'card_uid' => 'A1B2C3D4',
            'mode' => 'enroll',
            'event_id' => 'web-nfc-event-001',
            'scanned_at' => now()->toIso8601String(),
            'browser_device_id' => 'WEB_NFC_BROWSER',
            'browser' => [
                'platform' => 'Android',
                'language' => 'id-ID',
            ],
        ], [
            'X-Tenant' => 'sma-bali',
        ]);

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('reason', 'enroll_success')
            ->assertJsonPath('tenant_slug', 'sma-bali')
            ->assertJsonPath('event_id', 'web-nfc-event-001')
            ->assertJsonPath('source', 'web-nfc')
            ->assertJsonPath('actor.id', $admin->id);

        $this->assertDatabaseHas('rfid_scans', [
            'tenant_id' => $tenant->id,
            'card_uid' => 'A1B2C3D4',
            'status' => 'raw',
        ]);

        $this->assertDatabaseHas('rfid_device_events', [
            'tenant_id' => $tenant->id,
            'event_id' => 'web-nfc-event-001',
            'source' => 'web-nfc',
            'card_uid' => 'A1B2C3D4',
        ]);

        $event = DB::table('rfid_device_events')
            ->where('tenant_id', $tenant->id)
            ->where('event_id', 'web-nfc-event-001')
            ->first();

        $payload = json_decode((string) ($event->payload ?? ''), true);
        $this->assertTrue((bool) ($payload['browser_nfc'] ?? false));
        $this->assertSame('WEB_NFC_BROWSER', $payload['browser_device_id'] ?? null);
        $this->assertSame($admin->id, $payload['actor_id'] ?? null);
    }

    public function test_siswa_cannot_send_browser_nfc_event(): void
    {
        config()->set('tenancy.allow_header_override', true);
        $tenant = $this->createTenant('sma-bali');
        $siswa = $this->createUserWithProfile($tenant->id, 'siswa', 'siswa-browser-nfc@example.com');

        $this->actingAs($siswa)
            ->postJson('/api/admin/rfid/browser-event', [
                'card_uid' => 'A1B2C3D4',
                'mode' => 'enroll',
                'event_id' => 'web-nfc-siswa-001',
            ], [
                'X-Tenant' => 'sma-bali',
            ])
            ->assertForbidden();

        $this->assertDatabaseMissing('rfid_device_events', [
            'tenant_id' => $tenant->id,
            'event_id' => 'web-nfc-siswa-001',
        ]);
    }

    public function test_delegated_live_scan_teacher_can_send_browser_nfc_event(): void
    {
        config()->set('tenancy.allow_header_override', true);
        $tenant = $this->createTenant('sma-bali');
        $guru = $this->createUserWithProfile($tenant->id, 'guru', 'guru-browser-nfc@example.com');

        DB::table('admin_feature_permissions')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenant->id,
            'target_type' => 'teacher',
            'target_teacher_id' => $guru->id,
            'target_label' => 'Guru Live Scan',
            'target_class_id' => '',
            'feature_key' => 'scan-kehadiran-live',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->actingAs($guru)
            ->postJson('/api/admin/rfid/browser-event', [
                'card_uid' => 'E5F6A7B8',
                'mode' => 'enroll',
                'event_id' => 'web-nfc-guru-001',
            ], [
                'X-Tenant' => 'sma-bali',
            ])
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('source', 'web-nfc')
            ->assertJsonPath('actor.id', $guru->id);

        $this->assertDatabaseHas('rfid_device_events', [
            'tenant_id' => $tenant->id,
            'event_id' => 'web-nfc-guru-001',
            'source' => 'web-nfc',
        ]);
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
