<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class MobileGoogleAuthTest extends TestCase
{
    use RefreshDatabase;

    public function test_mobile_google_redirect_returns_to_app_when_google_is_disabled(): void
    {
        config()->set('services.google.enabled', false);
        config()->set('services.google.mobile_redirect_schemes', ['edusmart-presensi']);
        $this->configureTenancy();
        $this->createTenant('sman3bogor');

        $this
            ->get('https://sman3bogor.sismu.biz.id/api/auth/google/mobile/redirect?redirect_uri=edusmart-presensi://google-auth')
            ->assertRedirect('edusmart-presensi://google-auth?google=disabled');
    }

    public function test_mobile_google_redirect_rejects_unknown_app_scheme(): void
    {
        config()->set('services.google.enabled', true);
        config()->set('services.google.client_id', 'client-id.test');
        config()->set('services.google.client_secret', 'secret.test');
        config()->set('services.google.mobile_redirect_schemes', ['edusmart-presensi']);
        $this->configureTenancy();
        $this->createTenant('sman3bogor');

        $this
            ->get('https://sman3bogor.sismu.biz.id/api/auth/google/mobile/redirect?redirect_uri=evil-app://google-auth')
            ->assertRedirect('edusmart-presensi://google-auth?google=failed&google_error=Redirect+aplikasi+mobile+tidak+valid.');
    }

    private function createTenant(string $slug): void
    {
        DB::table('tenants')->insert([
            'id' => (string) Str::uuid(),
            'name' => $slug,
            'slug' => $slug,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function configureTenancy(): void
    {
        config()->set('app.url', 'https://sismu.biz.id');
        config()->set('app.frontend_url', 'https://sismu.biz.id');
        config()->set('tenancy.root_domain', 'sismu.biz.id');
        config()->set('tenancy.admin_subdomain', 'admin26');
        config()->set('tenancy.reserved_subdomains', ['www', 'app', 'api', 'admin', 'admin26']);
    }
}
