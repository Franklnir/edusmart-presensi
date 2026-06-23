<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class RfidApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_rfid_mode_returns_tenant_specific_settings(): void
    {
        $tenant = $this->createTenant('sma-bali');

        DB::table('settings')->insert([
            'tenant_id' => $tenant->id,
            'scan_manual_enabled' => true,
            'manual_jam_masuk_mulai' => '07:00:00',
            'manual_jam_masuk_selesai' => '08:00:00',
            'manual_jam_pulang_mulai' => '13:00:00',
            'manual_jam_pulang_selesai' => '14:00:00',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('absensi_rfid_settings')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenant->id,
            'rfid_aktif' => true,
            'rfid_mulai' => '06:30:00',
            'rfid_selesai' => '15:30:00',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->getJson('/api/rfid/mode?tenant_slug=sma-bali');

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('tenant_slug', 'sma-bali')
            ->assertJsonPath('mode', 'manual')
            ->assertJsonPath('scan_manual_enabled', true)
            ->assertJsonPath('rfid_aktif', true);
    }

    public function test_rfid_mode_handles_missing_settings_row_with_safe_default(): void
    {
        $this->createTenant('sma-bali-no-settings');

        $response = $this->getJson('/api/rfid/mode?tenant_slug=sma-bali-no-settings');

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('tenant_slug', 'sma-bali-no-settings')
            ->assertJsonPath('mode', 'auto')
            ->assertJsonPath('scan_manual_enabled', false)
            ->assertJsonPath('rfid_aktif', true);
    }

    public function test_rfid_mode_repairs_invalid_runtime_tenant_cache(): void
    {
        config()->set('rfid.performance.runtime_cache_enabled', true);
        $tenant = $this->createTenant('sma-cache-bali');
        Cache::put('rfid:tenant:sma-cache-bali', (object) ['broken' => true], 300);

        $response = $this->getJson('/api/rfid/mode?tenant_slug=sma-cache-bali');

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('tenant_id', $tenant->id)
            ->assertJsonPath('tenant_slug', 'sma-cache-bali');

        $cached = Cache::get('rfid:tenant:sma-cache-bali');
        $this->assertIsArray($cached);
        $this->assertSame($tenant->id, $cached['id'] ?? null);
        $this->assertSame('sma-cache-bali', $cached['slug'] ?? null);
    }

    public function test_admin_can_update_scan_settings_through_backend_endpoint(): void
    {
        $tenantId = (string) DB::table('tenants')->where('slug', 'default')->value('id');
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'scan-settings-admin@example.com');

        DB::table('settings')->insert([
            'tenant_id' => $tenantId,
            'scan_manual_enabled' => false,
            'scan_always_active' => false,
            'manual_jam_masuk_mulai' => '06:00:00',
            'manual_jam_masuk_selesai' => '08:00:00',
            'manual_jam_pulang_mulai' => '14:00:00',
            'manual_jam_pulang_selesai' => '16:00:00',
            'auto_alpha_enabled' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->actingAs($admin)->patchJson('/api/admin/scan-settings', [
            'scan_always_active' => true,
            'scan_manual_enabled' => true,
            'manual_jam_masuk_mulai' => '06:30',
            'manual_jam_masuk_selesai' => '08:15',
            'manual_jam_pulang_mulai' => '14:10',
            'manual_jam_pulang_selesai' => '16:05',
            'auto_alpha_enabled' => false,
        ]);

        $response->assertOk()
            ->assertJsonPath('data.scan_always_active', true)
            ->assertJsonPath('data.scan_manual_enabled', true)
            ->assertJsonPath('data.manual_jam_masuk_mulai', '06:30')
            ->assertJsonPath('data.auto_alpha_enabled', false);

        $this->assertDatabaseHas('settings', [
            'tenant_id' => $tenantId,
            'scan_always_active' => true,
            'scan_manual_enabled' => true,
            'manual_jam_masuk_mulai' => '06:30',
            'auto_alpha_enabled' => false,
        ]);
    }

    public function test_rfid_http_rejects_open_access_when_shared_key_is_required(): void
    {
        config()->set('rfid.shared_key', '');
        config()->set('rfid.allow_open_http', false);

        $this->createTenant('sma-bali');

        $response = $this->postJson('/api/rfid/scan', [
            'tenant_slug' => 'sma-bali',
            'card_uid' => 'A1B2C3D4',
            'device_id' => 'LEGACY_READER',
        ]);

        $response->assertStatus(401)
            ->assertJsonPath('success', false)
            ->assertJsonPath('reason', 'rfid_key_required');
    }

    public function test_rfid_scan_rejects_invalid_uid_format(): void
    {
        $this->createTenant('sma-bali');

        $response = $this->postJson('/api/rfid/scan', [
            'tenant_slug' => 'sma-bali',
            'card_uid' => 'ABC',
            'device_id' => 'WEMOS_D1',
        ]);

        $response->assertStatus(422)
            ->assertJsonPath('success', false)
            ->assertJsonPath('reason', 'invalid_card_uid');
    }

    public function test_rfid_scan_returns_function_not_ready_on_sqlite_test_driver(): void
    {
        $this->createTenant('sma-bali');

        $response = $this->postJson('/api/rfid/scan', [
            'tenant_slug' => 'sma-bali',
            'card_uid' => 'A1B2C3D4',
            'device_id' => 'WEMOS_D1',
        ]);

        $response->assertStatus(503)
            ->assertJsonPath('success', false)
            ->assertJsonPath('reason', 'rfid_function_not_ready');
    }

    public function test_rfid_mode_requires_existing_tenant_slug(): void
    {
        $response = $this->getJson('/api/rfid/mode?tenant_slug=unknown-tenant');

        $response->assertStatus(404)
            ->assertJsonPath('success', false)
            ->assertJsonPath('reason', 'tenant_not_found');
    }

    public function test_rfid_scan_can_resolve_tenant_from_registered_device_secret_in_enroll_mode(): void
    {
        $tenant = $this->createTenant('sma-bali');
        $this->createRegisteredDevice($tenant->id, 'GERBANG_UTAMA', 'secret-device-1');

        $response = $this->withHeaders([
            'X-RFID-Device' => 'GERBANG_UTAMA',
            'X-RFID-Secret' => 'secret-device-1',
        ])->postJson('/api/rfid/scan', [
            'card_uid' => 'A1B2C3D4',
            'mode' => 'enroll',
            'event_id' => 'evt-001',
        ]);

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('reason', 'enroll_success')
            ->assertJsonPath('tenant_slug', 'sma-bali');

        $this->assertDatabaseHas('rfid_scans', [
            'tenant_id' => $tenant->id,
            'device_id' => 'GERBANG_UTAMA',
            'card_uid' => 'A1B2C3D4',
            'status' => 'raw',
        ]);
    }

    public function test_rfid_scan_rejects_invalid_device_secret(): void
    {
        $tenant = $this->createTenant('sma-bali');
        $this->createRegisteredDevice($tenant->id, 'GERBANG_UTAMA', 'secret-device-1');

        $response = $this->withHeaders([
            'X-RFID-Device' => 'GERBANG_UTAMA',
            'X-RFID-Secret' => 'secret-salah',
        ])->postJson('/api/rfid/scan', [
            'card_uid' => 'A1B2C3D4',
            'mode' => 'enroll',
        ]);

        $response->assertStatus(401)
            ->assertJsonPath('success', false)
            ->assertJsonPath('reason', 'invalid_device_secret');
    }

    public function test_rfid_heartbeat_updates_registered_device_presence(): void
    {
        $tenant = $this->createTenant('sma-bali');
        $this->createRegisteredDevice($tenant->id, 'GERBANG_UTAMA', 'secret-device-1');

        $response = $this->withHeaders([
            'X-RFID-Device' => 'GERBANG_UTAMA',
            'X-RFID-Secret' => 'secret-device-1',
        ])->postJson('/api/rfid/heartbeat', [
            'transport' => 'mqtt',
            'firmware_version' => '1.0.0',
            'wifi_rssi' => -61,
            'free_heap' => 28640,
            'meta' => [
                'board' => 'ESP8266',
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('tenant_slug', 'sma-bali')
            ->assertJsonPath('device_id', 'GERBANG_UTAMA')
            ->assertJsonPath('device_registered', true)
            ->assertJsonPath('mode_context.success', true);

        $device = DB::table('rfid_devices')
            ->where('device_id', 'GERBANG_UTAMA')
            ->first();

        $this->assertNotNull($device);
        $this->assertSame('mqtt', $device->last_transport);
        $this->assertNotNull($device->last_seen_at);
    }

    public function test_rfid_sync_marks_duplicate_event_without_reprocessing(): void
    {
        $tenant = $this->createTenant('sma-bali');
        $this->createRegisteredDevice($tenant->id, 'GERBANG_UTAMA', 'secret-device-1');

        $response = $this->withHeaders([
            'X-RFID-Device' => 'GERBANG_UTAMA',
            'X-RFID-Secret' => 'secret-device-1',
        ])->postJson('/api/rfid/sync', [
            'events' => [
                [
                    'event_id' => 'evt-001',
                    'card_uid' => 'A1B2C3D4',
                    'mode' => 'enroll',
                ],
                [
                    'event_id' => 'evt-001',
                    'card_uid' => 'A1B2C3D4',
                    'mode' => 'enroll',
                ],
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('summary.total', 2)
            ->assertJsonPath('summary.processed', 1)
            ->assertJsonPath('summary.duplicates', 1)
            ->assertJsonPath('summary.failed', 0)
            ->assertJsonPath('items.0.duplicate', false)
            ->assertJsonPath('items.1.duplicate', true);

        $this->assertDatabaseCount('rfid_device_events', 1);
        $this->assertDatabaseCount('rfid_scans', 1);
    }

    public function test_rfid_sync_generates_fallback_event_id_for_legacy_device_without_event_id(): void
    {
        config()->set('rfid.performance.require_idempotency_key', true);

        $tenant = $this->createTenant('sma-bali');
        $this->createRegisteredDevice($tenant->id, 'GERBANG_UTAMA', 'secret-device-1');

        $response = $this->withHeaders([
            'X-RFID-Device' => 'GERBANG_UTAMA',
            'X-RFID-Secret' => 'secret-device-1',
        ])->postJson('/api/rfid/sync', [
            'events' => [
                [
                    'card_uid' => 'A1B2C3D4',
                    'mode' => 'enroll',
                ],
                [
                    'card_uid' => 'A1B2C3D4',
                    'mode' => 'enroll',
                ],
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('summary.total', 2)
            ->assertJsonPath('summary.processed', 1)
            ->assertJsonPath('summary.duplicates', 1)
            ->assertJsonPath('summary.failed', 0)
            ->assertJsonPath('items.0.duplicate', false)
            ->assertJsonPath('items.1.duplicate', true);

        $firstEventId = (string) data_get($response->json(), 'items.0.event_id');
        $secondEventId = (string) data_get($response->json(), 'items.1.event_id');

        $this->assertStringStartsWith('auto-', $firstEventId);
        $this->assertSame($firstEventId, $secondEventId);
        $this->assertDatabaseHas('rfid_device_events', [
            'tenant_id' => $tenant->id,
            'device_id' => 'GERBANG_UTAMA',
            'event_id' => $firstEventId,
        ]);
        $this->assertDatabaseCount('rfid_device_events', 1);
        $this->assertDatabaseCount('rfid_scans', 1);
    }

    public function test_rfid_sync_dedupes_events_inside_each_tenant_scope(): void
    {
        $tenantA = $this->createTenant('sma-bali');
        $tenantB = $this->createTenant('sma-lombok');

        foreach (['sma-bali', 'sma-lombok'] as $slug) {
            $response = $this->postJson('/api/rfid/sync', [
                'tenant_slug' => $slug,
                'device_id' => 'LEGACY_READER',
                'events' => [
                    [
                        'event_id' => 'evt-sama-001',
                        'card_uid' => 'A1B2C3D4',
                        'mode' => 'enroll',
                    ],
                ],
            ]);

            $response->assertOk()
                ->assertJsonPath('success', true)
                ->assertJsonPath('summary.processed', 1)
                ->assertJsonPath('summary.duplicates', 0);
        }

        $this->assertDatabaseHas('rfid_device_events', [
            'tenant_id' => $tenantA->id,
            'device_id' => 'LEGACY_READER',
            'event_id' => 'evt-sama-001',
        ]);
        $this->assertDatabaseHas('rfid_device_events', [
            'tenant_id' => $tenantB->id,
            'device_id' => 'LEGACY_READER',
            'event_id' => 'evt-sama-001',
        ]);
        $this->assertDatabaseCount('rfid_device_events', 2);
        $this->assertDatabaseCount('rfid_scans', 2);
    }

    public function test_rfid_set_mode_cannot_target_another_tenant_for_school_admin(): void
    {
        $defaultTenantId = (string) DB::table('tenants')->where('slug', 'default')->value('id');
        $otherTenant = $this->createTenant('sma-lombok');
        $admin = $this->createUserWithProfile($defaultTenantId, 'admin', 'admin-rfid@example.com');

        DB::table('settings')->insert([
            'tenant_id' => $otherTenant->id,
            'rfid_mode' => 'auto',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->actingAs($admin)->postJson('/api/rfid/set-mode', [
            'tenant_slug' => 'sma-lombok',
            'mode' => 'enroll',
        ]);

        $response->assertStatus(403)
            ->assertJsonPath('error', 'Tenant RFID tidak sesuai dengan sesi login');

        $this->assertDatabaseHas('settings', [
            'tenant_id' => $otherTenant->id,
            'rfid_mode' => 'auto',
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

    private function createRegisteredDevice(string $tenantId, string $deviceId, string $secret): void
    {
        DB::table('rfid_devices')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'device_id' => $deviceId,
            'name' => 'Device '.$deviceId,
            'secret_hash' => Hash::make($secret),
            'status' => 'active',
            'transport' => 'hybrid',
            'fallback_http_enabled' => true,
            'metadata' => json_encode(['created_for_test' => true]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
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
            'kelas' => 'admin-room',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $user;
    }
}
