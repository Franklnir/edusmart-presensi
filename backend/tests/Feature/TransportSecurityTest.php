<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class TransportSecurityTest extends TestCase
{
    use RefreshDatabase;

    public function test_api_health_has_security_headers(): void
    {
        $response = $this->getJson('/api/health');

        $response->assertOk();
        $response->assertHeader('X-Frame-Options', 'SAMEORIGIN');
        $response->assertHeader('X-Content-Type-Options', 'nosniff');
        $response->assertHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        $response->assertHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=(), usb=()');
        $response->assertHeader('Cross-Origin-Opener-Policy', 'same-origin');
        $response->assertHeader('Cross-Origin-Resource-Policy', 'same-site');
        $response->assertHeader('X-Permitted-Cross-Domain-Policies', 'none');
        $response->assertHeader(
            'Content-Security-Policy',
            "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
        );
    }

    public function test_frontend_html_allows_google_popup_window_checks(): void
    {
        $response = $this->get('/');

        $response->assertOk();
        $response->assertHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    }

    public function test_google_oauth_redirect_allows_popup_opener_window(): void
    {
        config()->set('services.google.enabled', true);
        config()->set('services.google.client_id', 'google-client-id');
        config()->set('services.google.client_secret', 'google-client-secret');
        config()->set('services.google.redirect_uri', 'https://sismu.biz.id/api/auth/google/callback');
        config()->set('tenancy.allow_header_override', true);

        $response = $this
            ->withServerVariables(['HTTP_HOST' => 'sismu.biz.id'])
            ->withHeader('X-Tenant', 'default')
            ->get('/api/auth/google/redirect?'.http_build_query([
                'popup' => '1',
                'origin' => 'https://sismu.biz.id',
                'popup_state' => 'popup-state-123',
                'redirect' => 'https://sismu.biz.id/login?google_popup_state=popup-state-123',
            ]));

        $response->assertRedirect();
        $response->assertHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    }

    public function test_authenticated_api_response_is_not_cacheable(): void
    {
        $tenantId = $this->defaultTenantId();
        [$user] = $this->createUserWithProfile($tenantId, 'admin', 'X-1');

        $response = $this->actingAs($user)->getJson('/api/auth/me');

        $response->assertOk();
        $response->assertHeader('Cache-Control', 'no-store, private');
        $response->assertHeader('Pragma', 'no-cache');
        $response->assertHeader('Expires', '0');
    }

    public function test_cors_preflight_allows_frontend_csrf_header(): void
    {
        $response = $this
            ->withHeaders([
                'Origin' => 'http://localhost:5173',
                'Access-Control-Request-Method' => 'POST',
                'Access-Control-Request-Headers' => 'content-type,x-xsrf-token,x-tenant',
            ])
            ->options('/api/db');

        $this->assertTrue(
            in_array($response->getStatusCode(), [200, 204], true),
            'CORS preflight harus sukses.'
        );

        $allowedHeaders = strtolower((string) $response->headers->get('Access-Control-Allow-Headers'));
        $this->assertStringContainsString('x-xsrf-token', $allowedHeaders);
        $this->assertStringContainsString('x-tenant', $allowedHeaders);
    }

    public function test_local_loopback_frontend_can_fetch_csrf_cookie(): void
    {
        $response = $this
            ->withHeaders([
                'Origin' => 'http://127.0.0.1:5173',
            ])
            ->get('/sanctum/csrf-cookie');

        $this->assertTrue(
            in_array($response->getStatusCode(), [200, 204], true),
            'CSRF cookie endpoint harus bisa dipanggil dari frontend loopback lokal.'
        );

        $response->assertHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5173');
        $response->assertHeader('Access-Control-Allow-Credentials', 'true');
    }

    private function defaultTenantId(): string
    {
        $tenantId = (string) DB::table('tenants')
            ->where('slug', 'default')
            ->value('id');

        $this->assertNotSame('', $tenantId, 'Tenant default tidak ditemukan di database test');

        return $tenantId;
    }

    private function createUserWithProfile(string $tenantId, string $role, string $kelas): array
    {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => $role.' test',
            'email' => Str::uuid().'@example.com',
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

        return [$user];
    }
}
