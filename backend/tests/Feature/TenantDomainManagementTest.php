<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class TenantDomainManagementTest extends TestCase
{
    use RefreshDatabase;

    public function test_super_admin_can_register_tenant_custom_domain_and_resolve_it(): void
    {
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);

        $superAdmin = $this->createSuperAdmin();
        $tenantId = $this->createTenant('SMA Bali', 'bali');

        $response = $this
            ->actingAs($superAdmin)
            ->postJson("http://admin.edusmart.test/api/super/tenants/{$tenantId}/domains", [
                'host' => 'smabali.sch.id',
                'is_primary' => true,
            ]);

        $response
            ->assertStatus(201)
            ->assertJsonPath('data.host', 'smabali.sch.id')
            ->assertJsonPath('data.tenant_id', $tenantId)
            ->assertJsonPath('data.domain_type', 'tenant');

        $this->getJson('http://smabali.sch.id/api/health')
            ->assertOk()
            ->assertJsonPath('status', 'ok');
    }

    public function test_custom_admin_domain_works_and_unknown_host_is_rejected(): void
    {
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);

        $superAdmin = $this->createSuperAdmin();

        $response = $this
            ->actingAs($superAdmin)
            ->postJson('http://admin.edusmart.test/api/super/domains', [
                'host' => 'panel.grupsekolah.id',
                'is_primary' => true,
            ]);

        $response
            ->assertStatus(201)
            ->assertJsonPath('data.host', 'panel.grupsekolah.id')
            ->assertJsonPath('data.domain_type', 'admin');

        $this
            ->actingAs($superAdmin)
            ->getJson('http://panel.grupsekolah.id/api/super/me')
            ->assertOk()
            ->assertJsonPath('data.is_super_admin', true);

        $this->getJson('http://asing.grupsekolah.id/api/health')
            ->assertStatus(404)
            ->assertJsonPath('error', 'Host tenant belum terdaftar. Tambahkan domain ini dari panel super admin terlebih dahulu.');
    }

    public function test_auth_me_does_not_expose_super_admin_access_on_tenant_host(): void
    {
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin26');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);

        $superAdmin = $this->createSuperAdmin();
        $tenantId = $this->createTenant('SMA Bali', 'bali');

        DB::table('profiles')->insert([
            'id' => $superAdmin->id,
            'tenant_id' => $tenantId,
            'email' => $superAdmin->email,
            'nama' => 'Admin Sekolah Bali',
            'role' => 'admin',
            'kelas' => null,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this
            ->actingAs($superAdmin)
            ->getJson('http://bali.edusmart.test/api/auth/me')
            ->assertOk()
            ->assertJsonPath('data.is_super_admin', false)
            ->assertJsonPath('data.profile.role', 'admin')
            ->assertJsonPath('data.profile.nama', 'Admin Sekolah Bali');

        $this
            ->actingAs($superAdmin)
            ->getJson('http://admin26.edusmart.test/api/auth/me')
            ->assertOk()
            ->assertJsonPath('data.is_super_admin', true);
    }

    public function test_admin_subdomain_is_reserved_even_when_reserved_env_omits_it(): void
    {
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin26');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);
        config()->set('tenancy.reserved_subdomains', ['www', 'app', 'api', 'admin']);

        $superAdmin = $this->createSuperAdmin();

        $this
            ->actingAs($superAdmin)
            ->postJson('http://admin26.edusmart.test/api/super/tenants', [
                'name' => 'Admin Host School',
                'slug' => 'admin26',
                'admin_name' => 'Admin Sekolah',
                'admin_email' => 'school-admin@example.com',
                'admin_password' => 'Admin26Strong!234',
            ])
            ->assertStatus(422)
            ->assertJsonPath('error', 'Subdomain tidak bisa digunakan');
    }

    public function test_super_admin_create_tenant_sets_first_admin_as_primary_admin(): void
    {
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin26');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);

        $superAdmin = $this->createSuperAdmin();

        $response = $this
            ->actingAs($superAdmin)
            ->postJson('http://admin26.edusmart.test/api/super/tenants', [
                'name' => 'SMA Bali',
                'slug' => 'bali',
                'admin_name' => 'Admin Bali',
                'admin_email' => 'admin-bali@example.com',
                'admin_password' => 'AdminBaliStrong!234',
            ]);

        $response->assertCreated();

        $tenantId = (string) $response->json('data.tenant.id');
        $adminUserId = (string) $response->json('data.admin.id');
        $this->assertNotSame('', $tenantId);
        $this->assertNotSame('', $adminUserId);

        $this->assertDatabaseHas('settings', [
            'tenant_id' => $tenantId,
            'approval_primary_admin_id' => $adminUserId,
        ]);

        $this
            ->actingAs($superAdmin)
            ->getJson("http://admin26.edusmart.test/api/super/tenants/{$tenantId}")
            ->assertOk()
            ->assertJsonPath('data.tenant.primary_admin_user_id', $adminUserId)
            ->assertJsonPath('data.tenant.primary_admin_email', 'admin-bali@example.com');
    }

    public function test_generated_tenant_admin_reset_password_satisfies_password_policy_shape(): void
    {
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin26');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);

        $superAdmin = $this->createSuperAdmin();
        $tenantId = $this->createTenant('SMA Bali', 'bali');
        $admin = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => 'Admin Bali',
            'email' => 'admin-reset@example.com',
            'password' => Hash::make('OldPassword!234'),
        ]);
        DB::table('profiles')->insert([
            'id' => $admin->id,
            'tenant_id' => $tenantId,
            'email' => $admin->email,
            'nama' => $admin->name,
            'role' => 'admin',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('admin_users')->insert([
            'id' => $admin->id,
            'tenant_id' => $tenantId,
            'created_at' => now(),
        ]);

        $response = $this
            ->actingAs($superAdmin)
            ->postJson("http://admin26.edusmart.test/api/super/tenants/{$tenantId}/admins/{$admin->id}/reset-password");

        $response->assertOk();

        $temporaryPassword = (string) $response->json('data.temporary_password');
        $this->assertGreaterThanOrEqual(12, strlen($temporaryPassword));
        $this->assertMatchesRegularExpression('/[a-z]/', $temporaryPassword);
        $this->assertMatchesRegularExpression('/[A-Z]/', $temporaryPassword);
        $this->assertMatchesRegularExpression('/[0-9]/', $temporaryPassword);
        $this->assertMatchesRegularExpression('/[^a-zA-Z0-9]/', $temporaryPassword);
    }

    public function test_tls_ask_endpoint_allows_known_hosts_and_rejects_unknown_hosts(): void
    {
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);
        config()->set('services.caddy.ask_secret', 'test-secret');
        config()->set('services.caddy.evolution_host', 'wa.edusmart.test');
        config()->set('rfid.mosquitto.public_host', 'mqtt.edusmart.test');

        $superAdmin = $this->createSuperAdmin();
        $tenantId = $this->createTenant('SMA Bali', 'bali');

        $this
            ->actingAs($superAdmin)
            ->postJson("http://admin.edusmart.test/api/super/tenants/{$tenantId}/domains", [
                'host' => 'smabali.sch.id',
                'is_primary' => true,
            ])
            ->assertCreated();

        $this->get('http://nginx/api/internal/tls/authorize?secret=test-secret&domain=bali.edusmart.test')
            ->assertNoContent();

        $this->get('http://nginx/api/internal/tls/authorize?secret=test-secret&domain=smabali.sch.id')
            ->assertNoContent();

        $this->get('http://nginx/api/internal/tls/authorize?secret=test-secret&domain=wa.edusmart.test')
            ->assertNoContent();

        $this->get('http://nginx/api/internal/tls/authorize?secret=test-secret&domain=mqtt.edusmart.test')
            ->assertNoContent();

        $this->get('http://nginx/api/internal/tls/authorize?secret=test-secret&domain=asing.edusmart.test')
            ->assertStatus(403)
            ->assertJsonPath('error', 'Domain belum terdaftar untuk auto TLS.');
    }

    public function test_tls_ask_endpoint_rejects_invalid_secret(): void
    {
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);
        config()->set('services.caddy.ask_secret', 'test-secret');

        $this->createTenant('SMA Bali', 'bali');

        $this->get('http://nginx/api/internal/tls/authorize?secret=salah&domain=bali.edusmart.test')
            ->assertStatus(403)
            ->assertJsonPath('error', 'Permintaan TLS tidak valid.');
    }

    public function test_super_admin_tenant_detail_prepares_stable_rfid_device_but_requires_tenant_mqtt_config(): void
    {
        config()->set('app.url', 'https://edusmart.test');
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);
        config()->set('rfid.mqtt.host', 'mqtt.edusmart.test');
        config()->set('rfid.mqtt.port', 8883);
        config()->set('rfid.mqtt.username', 'mqtt-user');
        config()->set('rfid.mqtt.password', 'mqtt-pass');
        config()->set('rfid.mqtt.scan_topic_template', 'edusmart/{tenant}/rfid/{device}/scan');
        config()->set('rfid.mqtt.response_topic_template', 'edusmart/{tenant}/rfid/{device}/response');
        config()->set('rfid.mqtt.mode_topic_template', 'edusmart/{tenant}/rfid/{device}/mode');

        $superAdmin = $this->createSuperAdmin();
        $tenantId = $this->createTenant('SMA Bali', 'bali');

        $response = $this
            ->actingAs($superAdmin)
            ->getJson("http://admin.edusmart.test/api/super/tenants/{$tenantId}");

        $response
            ->assertOk()
            ->assertJsonPath('data.rfid_template.available', false)
            ->assertJsonPath('data.rfid_template.message', 'Klik Pakai Mosquitto agar sekolah ini punya credential dan topic MQTT sendiri.')
            ->assertJsonPath('data.rfid_template.tenant_slug', 'bali')
            ->assertJsonPath('data.rfid_template.device_id', 'rfid-template-bali-01')
            ->assertJsonPath('data.rfid_template.api_base_url', 'https://edusmart.test')
            ->assertJsonPath('data.rfid_template.mqtt.host', 'mqtt.edusmart.test')
            ->assertJsonPath('data.rfid_template.topics.scan', 'edusmart/bali/rfid/rfid-template-bali-01/scan');

        $secret = data_get($response->json(), 'data.rfid_template.device_secret');
        $this->assertNotEmpty($secret);

        $this->assertDatabaseHas('rfid_devices', [
            'tenant_id' => $tenantId,
            'device_id' => 'rfid-template-bali-01',
        ]);

        $repeat = $this
            ->actingAs($superAdmin)
            ->getJson("http://admin.edusmart.test/api/super/tenants/{$tenantId}");

        $repeat->assertOk();
        $this->assertSame($secret, data_get($repeat->json(), 'data.rfid_template.device_secret'));
    }

    public function test_super_admin_can_store_tenant_mqtt_config_and_template_uses_it(): void
    {
        config()->set('app.url', 'https://edusmart.test');
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);

        $superAdmin = $this->createSuperAdmin();
        $tenantId = $this->createTenant('SMA Bali', 'bali');

        $response = $this
            ->actingAs($superAdmin)
            ->patchJson("http://admin.edusmart.test/api/super/tenants/{$tenantId}/rfid-mqtt", [
                'enabled' => true,
                'host' => 'mqtt.bali.test',
                'port' => 8883,
                'username' => 'bali-user',
                'password' => 'bali-secret',
                'use_tls' => true,
                'tls_verify_peer' => true,
                'tls_verify_peer_name' => true,
                'tls_allow_self_signed' => false,
                'qos' => 1,
                'client_id_prefix' => 'bridge-bali',
                'scan_topic_template' => 'school/{tenant}/scan',
                'response_topic_template' => 'school/{tenant}/response',
                'mode_topic_template' => 'school/{tenant}/mode',
                'connect_timeout' => 20,
                'socket_timeout' => 5,
                'keep_alive' => 20,
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('data.rfid_mqtt_config.source', 'tenant')
            ->assertJsonPath('data.rfid_mqtt_config.available', true)
            ->assertJsonPath('data.rfid_mqtt_config.host', 'mqtt.bali.test')
            ->assertJsonPath('data.rfid_mqtt_config.password_set', true)
            ->assertJsonPath('data.rfid_template.available', true)
            ->assertJsonPath('data.rfid_template.mqtt.host', 'mqtt.bali.test')
            ->assertJsonPath('data.rfid_template.mqtt.password', 'bali-secret')
            ->assertJsonPath('data.rfid_template.topics.scan', 'school/bali/scan');

        $this->assertArrayNotHasKey('password', data_get($response->json(), 'data.rfid_mqtt_config', []));
        $this->assertDatabaseHas('tenant_mqtt_configs', [
            'tenant_id' => $tenantId,
            'host' => 'mqtt.bali.test',
            'username' => 'bali-user',
        ]);

        $storedPassword = DB::table('tenant_mqtt_configs')
            ->where('tenant_id', $tenantId)
            ->value('password_ciphertext');
        $this->assertNotSame('bali-secret', $storedPassword);
        $this->assertNotEmpty($storedPassword);

        $detail = $this
            ->actingAs($superAdmin)
            ->getJson("http://admin.edusmart.test/api/super/tenants/{$tenantId}");

        $detail
            ->assertOk()
            ->assertJsonPath('data.rfid_mqtt_config.password_set', true)
            ->assertJsonPath('data.rfid_template.mqtt.host', 'mqtt.bali.test')
            ->assertJsonPath('data.rfid_template.topics.response', 'school/bali/response');
    }

    public function test_super_admin_can_provision_managed_mosquitto_for_tenant(): void
    {
        config()->set('app.url', 'https://edusmart.test');
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);

        $passwordFile = storage_path('framework/testing/mosquitto-passwords');
        $aclFile = storage_path('framework/testing/mosquitto-aclfile');
        @unlink($passwordFile);
        @unlink($aclFile);

        config()->set('rfid.mosquitto.enabled', true);
        config()->set('rfid.mosquitto.public_host', 'mqtt.edusmart.test');
        config()->set('rfid.mosquitto.public_port', 8883);
        config()->set('rfid.mosquitto.public_use_tls', true);
        config()->set('rfid.mosquitto.internal_host', 'mosquitto');
        config()->set('rfid.mosquitto.internal_port', 1883);
        config()->set('rfid.mosquitto.internal_use_tls', false);
        config()->set('rfid.mosquitto.bridge_username', 'edusmart_bridge');
        config()->set('rfid.mosquitto.bridge_password', 'bridge-secret-long');
        config()->set('rfid.mosquitto.tenant_username_prefix', 'edusmart');
        config()->set('rfid.mosquitto.topic_prefix', 'edusmart');
        config()->set('rfid.mosquitto.password_file', $passwordFile);
        config()->set('rfid.mosquitto.acl_file', $aclFile);

        $superAdmin = $this->createSuperAdmin();
        $tenantId = $this->createTenant('SMA Bali', 'bali');

        $response = $this
            ->actingAs($superAdmin)
            ->postJson("http://admin.edusmart.test/api/super/tenants/{$tenantId}/rfid-mqtt/mosquitto");

        $response
            ->assertOk()
            ->assertJsonPath('data.rfid_mqtt_config.provider', 'mosquitto')
            ->assertJsonPath('data.rfid_mqtt_config.managed_by_platform', true)
            ->assertJsonPath('data.rfid_mqtt_config.host', 'mqtt.edusmart.test')
            ->assertJsonPath('data.rfid_mqtt_config.port', 8883)
            ->assertJsonPath('data.rfid_mqtt_config.username', 'edusmart_bali_rfid')
            ->assertJsonPath('data.rfid_mqtt_config.password_set', true)
            ->assertJsonPath('data.rfid_template.mqtt.provider', 'mosquitto')
            ->assertJsonPath('data.rfid_template.mqtt.managed_by_platform', true)
            ->assertJsonPath('data.rfid_template.mqtt.host', 'mqtt.edusmart.test')
            ->assertJsonPath('data.rfid_template.mqtt.use_tls', true)
            ->assertJsonPath('data.rfid_template.mqtt.tls_verify_peer', true)
            ->assertJsonPath('data.rfid_template.mqtt.tls_verify_peer_name', true)
            ->assertJsonPath('data.rfid_template.mqtt.tls_allow_self_signed', false)
            ->assertJsonPath('data.rfid_template.topic_templates.scan', 'edusmart/{tenant}/rfid/{device}/scan')
            ->assertJsonPath('data.rfid_template.topics.scan', 'edusmart/bali/rfid/rfid-template-bali-01/scan')
            ->assertJsonPath('data.mosquitto_sync.synced', true);

        $devicePassword = (string) data_get($response->json(), 'data.rfid_template.mqtt.password');
        $this->assertNotEmpty($devicePassword);

        $this->assertFileExists($passwordFile);
        $this->assertFileExists($aclFile);
        $passwordContents = file_get_contents($passwordFile);
        $aclContents = file_get_contents($aclFile);

        $this->assertStringContainsString('edusmart_bridge:', $passwordContents);
        $this->assertStringContainsString('edusmart_bali_rfid:', $passwordContents);
        $this->assertStringNotContainsString($devicePassword, $passwordContents);
        $this->assertStringContainsString('user edusmart_bridge', $aclContents);
        $this->assertStringContainsString('topic read edusmart/bali/rfid/+/scan', $aclContents);
        $this->assertStringContainsString('user edusmart_bali_rfid', $aclContents);
        $this->assertStringContainsString('topic write edusmart/bali/rfid/+/scan', $aclContents);
        $this->assertStringContainsString('topic read edusmart/bali/rfid/+/response', $aclContents);

        $this->assertDatabaseHas('tenant_mqtt_configs', [
            'tenant_id' => $tenantId,
            'provider' => 'mosquitto',
            'managed_by_platform' => true,
            'use_tls' => true,
            'tls_verify_peer' => true,
            'tls_verify_peer_name' => true,
            'tls_allow_self_signed' => false,
        ]);

        DB::table('tenant_mqtt_configs')->where('tenant_id', $tenantId)->update([
            'tls_verify_peer' => false,
            'tls_verify_peer_name' => false,
            'tls_allow_self_signed' => true,
        ]);

        $this
            ->actingAs($superAdmin)
            ->getJson("http://admin.edusmart.test/api/super/tenants/{$tenantId}")
            ->assertOk()
            ->assertJsonPath('data.rfid_template.mqtt.tls_verify_peer', true)
            ->assertJsonPath('data.rfid_template.mqtt.tls_verify_peer_name', true)
            ->assertJsonPath('data.rfid_template.mqtt.tls_allow_self_signed', false);
    }

    public function test_managed_mosquitto_replaces_previous_custom_mqtt_credentials(): void
    {
        config()->set('app.url', 'https://edusmart.test');
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);

        $passwordFile = storage_path('framework/testing/mosquitto-passwords-switch');
        $aclFile = storage_path('framework/testing/mosquitto-aclfile-switch');
        @unlink($passwordFile);
        @unlink($aclFile);

        config()->set('rfid.mosquitto.enabled', true);
        config()->set('rfid.mosquitto.public_host', 'mqtt.edusmart.test');
        config()->set('rfid.mosquitto.public_port', 8883);
        config()->set('rfid.mosquitto.public_use_tls', true);
        config()->set('rfid.mosquitto.internal_host', 'mosquitto');
        config()->set('rfid.mosquitto.internal_port', 1883);
        config()->set('rfid.mosquitto.internal_use_tls', false);
        config()->set('rfid.mosquitto.bridge_username', 'edusmart_bridge');
        config()->set('rfid.mosquitto.bridge_password', 'bridge-secret-long');
        config()->set('rfid.mosquitto.tenant_username_prefix', 'edusmart');
        config()->set('rfid.mosquitto.topic_prefix', 'edusmart');
        config()->set('rfid.mosquitto.password_file', $passwordFile);
        config()->set('rfid.mosquitto.acl_file', $aclFile);

        $superAdmin = $this->createSuperAdmin();
        $tenantId = $this->createTenant('SMA Bali', 'bali');

        $this
            ->actingAs($superAdmin)
            ->patchJson("http://admin.edusmart.test/api/super/tenants/{$tenantId}/rfid-mqtt", [
                'enabled' => true,
                'host' => 'old-cloud-mqtt.test',
                'port' => 8883,
                'username' => 'old-cloud-user',
                'password' => 'old-cloud-secret',
                'use_tls' => true,
                'qos' => 1,
                'scan_topic_template' => 'legacy/{tenant}/scan',
                'response_topic_template' => 'legacy/{tenant}/response',
                'mode_topic_template' => 'legacy/{tenant}/mode',
            ])
            ->assertOk();

        $response = $this
            ->actingAs($superAdmin)
            ->postJson("http://admin.edusmart.test/api/super/tenants/{$tenantId}/rfid-mqtt/mosquitto");

        $response
            ->assertOk()
            ->assertJsonPath('data.rfid_mqtt_config.provider', 'mosquitto')
            ->assertJsonPath('data.rfid_mqtt_config.managed_by_platform', true)
            ->assertJsonPath('data.rfid_mqtt_config.host', 'mqtt.edusmart.test')
            ->assertJsonPath('data.rfid_mqtt_config.username', 'edusmart_bali_rfid')
            ->assertJsonPath('data.rfid_template.available', true)
            ->assertJsonPath('data.rfid_template.mqtt.host', 'mqtt.edusmart.test')
            ->assertJsonPath('data.rfid_template.topic_templates.scan', 'edusmart/{tenant}/rfid/{device}/scan')
            ->assertJsonPath('data.rfid_template.topics.scan', 'edusmart/bali/rfid/rfid-template-bali-01/scan');

        $this->assertNotSame(
            'old-cloud-secret',
            (string) data_get($response->json(), 'data.rfid_template.mqtt.password')
        );

        $this->assertDatabaseHas('tenant_mqtt_configs', [
            'tenant_id' => $tenantId,
            'provider' => 'mosquitto',
            'managed_by_platform' => true,
            'host' => 'mqtt.edusmart.test',
            'runtime_host' => 'mosquitto',
            'username' => 'edusmart_bali_rfid',
        ]);
    }

    public function test_super_admin_can_manage_tenant_rfid_devices(): void
    {
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);

        $superAdmin = $this->createSuperAdmin();
        $tenantId = $this->createTenant('SMA Bali', 'bali');

        $this
            ->actingAs($superAdmin)
            ->postJson("http://admin.edusmart.test/api/super/tenants/{$tenantId}/rfid-devices", [
                'device_id' => 'esp32-gerbang-utara',
                'name' => 'Gerbang Utara',
                'transport' => 'mqtt',
                'board_type' => 'esp32',
                'location' => 'Gerbang utara',
                'reader_model' => 'pn532-spi',
            ])
            ->assertOk()
            ->assertJsonPath('data.data.device_id', 'esp32-gerbang-utara');

        $this
            ->actingAs($superAdmin)
            ->getJson("http://admin.edusmart.test/api/super/tenants/{$tenantId}/rfid-devices")
            ->assertOk()
            ->assertJsonPath('data.summary.total', 1)
            ->assertJsonPath('data.devices.0.device_id', 'esp32-gerbang-utara')
            ->assertJsonPath('data.devices.0.board_type', 'esp32')
            ->assertJsonPath('data.devices.0.location', 'Gerbang utara')
            ->assertJsonPath('data.devices.0.reader_model', 'pn532-spi');

        $this
            ->actingAs($superAdmin)
            ->deleteJson("http://admin.edusmart.test/api/super/tenants/{$tenantId}/rfid-devices/esp32-gerbang-utara")
            ->assertOk()
            ->assertJsonPath('data.data.device_id', 'esp32-gerbang-utara');

        $this->assertDatabaseMissing('rfid_devices', [
            'tenant_id' => $tenantId,
            'device_id' => 'esp32-gerbang-utara',
        ]);
    }

    public function test_super_admin_rfid_device_id_is_normalized_for_mqtt_topics(): void
    {
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);

        $superAdmin = $this->createSuperAdmin();
        $tenantId = $this->createTenant('SMA Bali', 'bali');

        $this
            ->actingAs($superAdmin)
            ->postJson("http://admin.edusmart.test/api/super/tenants/{$tenantId}/rfid-devices", [
                'device_id' => 'Gerbang 2 / Utara',
                'name' => 'Gerbang 2 Utara',
                'transport' => 'mqtt',
                'board_type' => 'esp8266',
            ])
            ->assertOk()
            ->assertJsonPath('data.data.device_id', 'gerbang-2-utara')
            ->assertJsonPath('data.data.requested_device_id', 'Gerbang 2 / Utara');

        $this->assertDatabaseHas('rfid_devices', [
            'tenant_id' => $tenantId,
            'device_id' => 'gerbang-2-utara',
        ]);
    }

    public function test_tenant_mqtt_config_rejects_topic_templates_with_spaces(): void
    {
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);

        $superAdmin = $this->createSuperAdmin();
        $tenantId = $this->createTenant('SMA Bali', 'bali');

        $this
            ->actingAs($superAdmin)
            ->patchJson("http://admin.edusmart.test/api/super/tenants/{$tenantId}/rfid-mqtt", [
                'enabled' => true,
                'host' => 'mqtt.shared.test',
                'port' => 1883,
                'username' => 'rfid-user',
                'password' => 'rfid-secret',
                'use_tls' => false,
                'qos' => 1,
                'scan_topic_template' => 'edusmart/{tenant}/rfid/gerbang 2/scan',
                'response_topic_template' => 'edusmart/{tenant}/rfid/{device}/response',
                'mode_topic_template' => 'edusmart/{tenant}/rfid/{device}/mode',
            ])
            ->assertStatus(422)
            ->assertJsonPath('error', 'Topik MQTT RFID tidak boleh mengandung spasi. Gunakan minus untuk pemisah, misalnya gerbang-2.');
    }

    public function test_tenant_mqtt_config_rejects_scan_topic_conflict_on_same_host(): void
    {
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);

        $superAdmin = $this->createSuperAdmin();
        $baliTenantId = $this->createTenant('SMA Bali', 'bali');
        $jawaTenantId = $this->createTenant('SMA Jawa', 'jawa');

        $payload = [
            'enabled' => true,
            'host' => 'mqtt.shared.test',
            'port' => 1883,
            'username' => 'rfid-user',
            'use_tls' => false,
            'qos' => 1,
            'scan_topic_template' => 'rfid/scan',
            'response_topic_template' => 'rfid/response',
            'mode_topic_template' => 'rfid/mode',
        ];

        $this
            ->actingAs($superAdmin)
            ->patchJson("http://admin.edusmart.test/api/super/tenants/{$baliTenantId}/rfid-mqtt", $payload)
            ->assertOk();

        $this
            ->actingAs($superAdmin)
            ->patchJson("http://admin.edusmart.test/api/super/tenants/{$jawaTenantId}/rfid-mqtt", $payload)
            ->assertStatus(422)
            ->assertJsonPath('error', 'Topik scan MQTT rfid/scan sudah dipakai oleh tenant SMA Bali pada host/port yang sama.');
    }

    public function test_super_admin_monitoring_includes_queue_snapshot(): void
    {
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin26');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);

        $superAdmin = $this->createSuperAdmin();

        $this
            ->actingAs($superAdmin)
            ->getJson('http://admin26.edusmart.test/api/super/monitoring')
            ->assertOk()
            ->assertJsonStructure([
                'data' => [
                    'jobs' => [
                        'generated_at',
                        'status' => ['level', 'label', 'issues'],
                        'redis' => ['ok', 'status'],
                        'horizon' => ['installed', 'status', 'dashboard_url', 'counts'],
                        'queues',
                        'database_failed_jobs' => ['available', 'total', 'last_hour', 'last_24h', 'recent'],
                        'heartbeats' => [
                            'scheduler' => ['status', 'last_seen_at', 'age_seconds', 'max_age_seconds'],
                            'quiz_worker' => ['status', 'last_seen_at', 'age_seconds', 'max_age_seconds'],
                        ],
                    ],
                ],
            ])
            ->assertJsonPath('data.jobs.horizon.installed', true)
            ->assertJsonPath('data.jobs.horizon.dashboard_url', 'http://admin26.edusmart.test/horizon');
    }

    private function createSuperAdmin(): User
    {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => 'Super Admin',
            'email' => 'super-admin@example.com',
            'password' => Hash::make('password123'),
        ]);

        DB::table('super_admins')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $user->id,
            'email' => $user->email,
            'name' => $user->name,
            'created_at' => now(),
        ]);

        return $user;
    }

    private function createTenant(string $name, string $slug): string
    {
        $tenantId = (string) Str::uuid();

        DB::table('tenants')->insert([
            'id' => $tenantId,
            'name' => $name,
            'slug' => $slug,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $tenantId;
    }
}
