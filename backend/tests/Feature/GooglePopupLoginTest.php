<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

class GooglePopupLoginTest extends TestCase
{
    use RefreshDatabase;

    public function test_google_credential_login_logs_in_existing_user(): void
    {
        config()->set('services.google.enabled', true);
        config()->set('services.google.client_id', 'google-client-id');
        config()->set('tenancy.allow_header_override', true);

        $tenantId = $this->defaultTenantId();
        $user = $this->createUserWithProfile($tenantId, 'siswa', 'siswa-google@example.com');

        Http::fake([
            'https://oauth2.googleapis.com/tokeninfo*' => Http::response([
                'aud' => 'google-client-id',
                'iss' => 'https://accounts.google.com',
                'sub' => 'google-sub-123',
                'email' => 'siswa-google@example.com',
                'email_verified' => 'true',
                'name' => 'Siswa Google',
                'picture' => 'https://example.com/avatar.png',
            ], 200),
        ]);

        $response = $this
            ->withServerVariables(['HTTP_HOST' => 'sismu.biz.id'])
            ->withHeader('X-Tenant', 'default')
            ->postJson('/api/auth/google/credential-login', [
                'credential' => 'google-id-token',
            ]);

        $response->assertOk();
        $response->assertJsonPath('data.user.email', $user->email);
        $response->assertJsonPath('data.profile.role', 'siswa');

        $this->assertDatabaseHas('users', [
            'id' => $user->id,
            'google_id' => 'google-sub-123',
            'google_email' => 'siswa-google@example.com',
        ]);
    }

    public function test_google_credential_login_rejects_email_mismatch(): void
    {
        config()->set('services.google.enabled', true);
        config()->set('services.google.client_id', 'google-client-id');
        config()->set('tenancy.allow_header_override', true);

        $tenantId = $this->defaultTenantId();
        $user = $this->createUserWithProfile($tenantId, 'siswa', 'akun-sekolah@example.com');
        DB::table('users')
            ->where('id', $user->id)
            ->update([
                'google_id' => 'google-sub-456',
                'google_email' => 'akun-sekolah@example.com',
            ]);

        Http::fake([
            'https://oauth2.googleapis.com/tokeninfo*' => Http::response([
                'aud' => 'google-client-id',
                'iss' => 'https://accounts.google.com',
                'sub' => 'google-sub-456',
                'email' => 'akun-lain@example.com',
                'email_verified' => 'true',
                'name' => 'Akun Lain',
            ], 200),
        ]);

        $response = $this
            ->withServerVariables(['HTTP_HOST' => 'sismu.biz.id'])
            ->withHeader('X-Tenant', 'default')
            ->postJson('/api/auth/google/credential-login', [
                'credential' => 'google-id-token',
            ]);

        $response->assertStatus(422);
        $response->assertJsonPath(
            'error',
            'Email Google tidak sesuai dengan email akun. Gunakan akun Google dengan email yang sama.'
        );
    }

    public function test_google_credential_link_links_authenticated_user(): void
    {
        config()->set('services.google.enabled', true);
        config()->set('services.google.client_id', 'google-client-id');
        config()->set('tenancy.allow_header_override', true);

        $tenantId = $this->defaultTenantId();
        $user = $this->createUserWithProfile($tenantId, 'guru', 'guru-google@example.com');

        Http::fake([
            'https://oauth2.googleapis.com/tokeninfo*' => Http::response([
                'aud' => 'google-client-id',
                'iss' => 'https://accounts.google.com',
                'sub' => 'google-sub-789',
                'email' => 'guru-google@example.com',
                'email_verified' => 'true',
                'name' => 'Guru Google',
                'picture' => 'https://example.com/avatar.png',
            ], 200),
        ]);

        $response = $this
            ->actingAs($user)
            ->withServerVariables(['HTTP_HOST' => 'sismu.biz.id'])
            ->withHeader('X-Tenant', 'default')
            ->postJson('/api/auth/google/credential-link', [
                'credential' => 'google-id-token',
            ]);

        $response->assertOk();
        $response->assertJsonPath('data.user.email', $user->email);
        $response->assertJsonPath('data.profile.role', 'guru');

        $this->assertDatabaseHas('users', [
            'id' => $user->id,
            'google_id' => 'google-sub-789',
            'google_email' => 'guru-google@example.com',
        ]);
    }

    public function test_google_oauth_popup_redirect_completes_login_without_javascript_origin(): void
    {
        config()->set('services.google.enabled', true);
        config()->set('services.google.client_id', 'google-client-id');
        config()->set('services.google.client_secret', 'google-client-secret');
        config()->set('services.google.redirect_uri', 'https://sismu.biz.id/api/auth/google/callback');
        config()->set('tenancy.allow_header_override', true);
        config()->set('tenancy.root_domain', 'sismu.biz.id');

        $tenantId = $this->defaultTenantId();
        $user = $this->createUserWithProfile($tenantId, 'siswa', 'siswa-oauth@example.com');

        $redirect = $this
            ->withServerVariables(['HTTP_HOST' => 'sismu.biz.id'])
            ->withHeader('X-Tenant', 'default')
            ->get('/api/auth/google/redirect?'.http_build_query([
                'popup' => '1',
                'origin' => 'https://sismu.biz.id',
                'popup_state' => 'popup-state-123',
                'redirect' => 'https://sismu.biz.id/login',
            ]));

        $redirect->assertRedirect();
        $location = $redirect->headers->get('Location');
        $this->assertStringStartsWith('https://accounts.google.com/o/oauth2/v2/auth?', (string) $location);

        parse_str((string) parse_url((string) $location, PHP_URL_QUERY), $query);
        $this->assertSame('google-client-id', $query['client_id'] ?? null);
        $this->assertSame('https://sismu.biz.id/api/auth/google/callback', $query['redirect_uri'] ?? null);
        $this->assertNotEmpty($query['state'] ?? '');

        Http::fake([
            'https://oauth2.googleapis.com/token' => Http::response([
                'id_token' => 'google-id-token',
            ], 200),
            'https://oauth2.googleapis.com/tokeninfo*' => Http::response([
                'aud' => 'google-client-id',
                'iss' => 'https://accounts.google.com',
                'sub' => 'google-sub-oauth',
                'email' => 'siswa-oauth@example.com',
                'email_verified' => 'true',
                'name' => 'Siswa OAuth',
            ], 200),
        ]);

        $callback = $this
            ->withServerVariables(['HTTP_HOST' => 'sismu.biz.id'])
            ->get('/api/auth/google/callback?'.http_build_query([
                'state' => $query['state'],
                'code' => 'google-auth-code',
            ]));

        if ($callback->isRedirection()) {
            $handoffLocation = (string) $callback->headers->get('Location');
            $this->assertStringContainsString('/api/auth/google/finalize-login', $handoffLocation);

            $handoffParts = parse_url($handoffLocation);
            $callback = $this
                ->withServerVariables(['HTTP_HOST' => $handoffParts['host'] ?? 'sismu.biz.id'])
                ->get(($handoffParts['path'] ?? '/api/auth/google/finalize-login')
                    .(isset($handoffParts['query']) ? '?'.$handoffParts['query'] : ''));
        }

        $callback->assertOk();
        $callback->assertSee('edusmart-google-oauth-success', false);
        $callback->assertSee('popup-state-123', false);

        $this->assertDatabaseHas('users', [
            'id' => $user->id,
            'google_id' => 'google-sub-oauth',
            'google_email' => 'siswa-oauth@example.com',
        ]);
    }

    public function test_google_popup_context_accepts_allowed_origin(): void
    {
        config()->set('services.google.enabled', true);
        config()->set('services.google.client_id', 'google-client-id');
        config()->set('tenancy.root_domain', 'sismu.biz.id');

        $response = $this
            ->withServerVariables(['HTTP_HOST' => 'sismu.biz.id'])
            ->getJson('/api/auth/google/popup-context?origin=https%3A%2F%2Fsmabali.sismu.biz.id&mode=login');

        $response->assertOk();
        $response->assertJsonPath('data.origin', 'https://smabali.sismu.biz.id');
        $response->assertJsonPath('data.mode', 'login');
    }

    public function test_google_popup_context_rejects_unknown_origin(): void
    {
        config()->set('services.google.enabled', true);
        config()->set('services.google.client_id', 'google-client-id');
        config()->set('tenancy.root_domain', 'sismu.biz.id');

        $response = $this
            ->withServerVariables(['HTTP_HOST' => 'sismu.biz.id'])
            ->getJson('/api/auth/google/popup-context?origin=https%3A%2F%2Fevil.example.com&mode=login');

        $response->assertStatus(422);
        $response->assertJsonPath('error', 'Origin login Google tidak diizinkan.');
    }

    private function defaultTenantId(): string
    {
        $tenantId = (string) DB::table('tenants')
            ->where('slug', 'default')
            ->value('id');

        $this->assertNotSame('', $tenantId, 'Tenant default tidak ditemukan di database test');

        return $tenantId;
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
            'kelas' => 'kelas-a',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $user;
    }
}
