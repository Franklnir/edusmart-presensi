<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class MobileSchoolDirectoryTest extends TestCase
{
    use RefreshDatabase;

    public function test_mobile_school_directory_returns_active_registered_schools(): void
    {
        config()->set('app.url', 'https://sismu.biz.id');
        config()->set('app.frontend_url', 'https://sismu.biz.id');
        config()->set('tenancy.root_domain', 'sismu.biz.id');
        config()->set('tenancy.default_slug', 'default');
        config()->set('tenancy.admin_subdomain', 'admin26');
        config()->set('tenancy.reserved_subdomains', ['www', 'app', 'api', 'admin', 'admin26']);

        $baliId = (string) Str::uuid();
        $inactiveId = (string) Str::uuid();

        DB::table('tenants')->insert([
            [
                'id' => $baliId,
                'name' => 'SMA Bali',
                'slug' => 'sma-bali',
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => $inactiveId,
                'name' => 'SMA Nonaktif',
                'slug' => 'sma-nonaktif',
                'status' => 'suspended',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => (string) Str::uuid(),
                'name' => 'Admin Reserved',
                'slug' => 'admin26',
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        DB::table('settings')->insert([
            'tenant_id' => $baliId,
            'nama_sekolah' => 'SMA Bali Mandara',
            'logo_url' => 'https://cdn.example.test/logo.png',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this
            ->getJson('https://admin26.sismu.biz.id/api/mobile/schools?search=bali')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'SMA Bali Mandara')
            ->assertJsonPath('data.0.slug', 'sma-bali')
            ->assertJsonPath('data.0.host', 'sma-bali.sismu.biz.id')
            ->assertJsonPath('data.0.apiBaseUrl', 'https://sma-bali.sismu.biz.id')
            ->assertJsonPath('data.0.logoUrl', 'https://cdn.example.test/logo.png');
    }
}
