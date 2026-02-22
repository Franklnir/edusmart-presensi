<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
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
}

