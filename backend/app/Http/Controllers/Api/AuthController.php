<?php

namespace App\Http\Controllers\Api;

use App\Models\Profile;
use App\Models\User;
use App\Support\Tenancy\TenantDomainService;
use Illuminate\Contracts\Auth\StatefulGuard;
use Illuminate\Http\Client\Response;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Js;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password as PasswordRule;

class AuthController extends ApiController
{
    private const GOOGLE_STATE_SESSION_KEY = 'google_oauth_states';

    private const GOOGLE_STATE_CACHE_KEY_PREFIX = 'google_oauth_state:';

    private const GOOGLE_STATE_TTL_SECONDS = 600;

    private const GOOGLE_LOGIN_HANDOFF_CACHE_KEY_PREFIX = 'google_oauth_login_handoff:';

    private const GOOGLE_LOGIN_HANDOFF_TTL_SECONDS = 180;

    private const PASSWORD_CHANGE_CODE_TTL_SECONDS = 600;

    private const PASSWORD_CHANGE_CODE_MAX_ATTEMPTS = 5;

    private const EMAIL_VERIFICATION_CODE_TTL_SECONDS = 600;

    private const EMAIL_VERIFICATION_CODE_MAX_ATTEMPTS = 5;

    private const BOOTSTRAP_SETTINGS_COLUMNS = [
        'id',
        'nama_sekolah',
        'logo_url',
        'logo_path',
        'admin_lock_enabled',
        'tahun_ajaran',
        'semester_aktif',
        'updated_at',
    ];

    public function __construct(
        private readonly TenantDomainService $tenantDomainService
    ) {}

    public function me(Request $request)
    {
        $user = $this->user($request);
        if (! $user) {
            return response()->json(['data' => null]);
        }

        $profile = $this->profile($request);

        return response()->json([
            'data' => [
                'user' => $user,
                'profile' => $profile,
                'settings' => $this->bootstrapSettings($request),
                'is_super_admin' => $this->isSuperAdmin($request),
            ],
        ]);
    }

    private function bootstrapSettings(Request $request): ?array
    {
        try {
            if (! Schema::hasTable('settings')) {
                return null;
            }

            $availableColumns = Schema::getColumnListing('settings');
            $columns = array_values(array_filter(
                self::BOOTSTRAP_SETTINGS_COLUMNS,
                fn (string $column) => in_array($column, $availableColumns, true)
            ));

            if (empty($columns)) {
                return null;
            }

            $query = DB::table('settings')->orderBy('id');
            $tenantId = $this->tenantId($request);
            if ($tenantId && in_array('tenant_id', $availableColumns, true)) {
                $query->where('tenant_id', $tenantId);
            }

            $settings = $query->first($columns);

            return $settings ? (array) $settings : null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    public function googleRedirect(Request $request): RedirectResponse
    {
        $redirectTarget = $this->sanitizeFrontendRedirect(
            $request,
            (string) $request->query('redirect', $request->query('next', ''))
        );

        if (! $this->isGoogleAuthEnabled()) {
            return redirect()->away($this->appendQueryToUrl($redirectTarget, [
                'google' => 'disabled',
            ]));
        }

        if ($this->googleClientId() === '' || $this->googleClientSecret() === '') {
            return redirect()->away($this->appendQueryToUrl($redirectTarget, [
                'google' => 'failed',
                'google_error' => 'Konfigurasi Google OAuth belum lengkap.',
            ]));
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return redirect()->away($this->appendQueryToUrl($redirectTarget, [
                'google' => 'tenant_invalid',
            ]));
        }

        $state = $this->createGoogleState($request, 'login', array_merge([
            'tenant_id' => $tenantId,
            'host' => $this->currentHost($request),
            'redirect' => $redirectTarget,
        ], $this->googlePopupStatePayload($request)));

        return redirect()->away($this->googleAuthorizationUrl($request, $state));
    }

    public function googleLinkRedirect(Request $request): RedirectResponse
    {
        $redirectTarget = $this->sanitizeFrontendRedirect(
            $request,
            (string) $request->query('redirect', $request->query('next', ''))
        );

        if (! $this->isGoogleAuthEnabled()) {
            return redirect()->away($this->appendQueryToUrl($redirectTarget, [
                'google' => 'disabled',
            ]));
        }

        if ($this->googleClientId() === '' || $this->googleClientSecret() === '') {
            return redirect()->away($this->appendQueryToUrl($redirectTarget, [
                'google' => 'failed',
                'google_error' => 'Konfigurasi Google OAuth belum lengkap.',
            ]));
        }

        $user = $request->user();
        if (! $user?->id) {
            return redirect()->away($this->appendQueryToUrl($redirectTarget, [
                'google' => 'unauthenticated',
            ]));
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return redirect()->away($this->appendQueryToUrl($redirectTarget, [
                'google' => 'tenant_invalid',
            ]));
        }

        $state = $this->createGoogleState($request, 'link', array_merge([
            'tenant_id' => $tenantId,
            'host' => $this->currentHost($request),
            'redirect' => $redirectTarget,
            'link_user_id' => (string) $user->id,
        ], $this->googlePopupStatePayload($request)));

        return redirect()->away($this->googleAuthorizationUrl($request, $state));
    }

    public function googlePopupContext(Request $request)
    {
        if (! $this->isGoogleAuthEnabled()) {
            return response()->json(['error' => 'Login Google belum diaktifkan oleh administrator.'], 422);
        }

        if ($this->googleClientId() === '') {
            return response()->json(['error' => 'Konfigurasi Google OAuth belum lengkap.'], 422);
        }

        $validated = $request->validate([
            'origin' => ['required', 'string', 'max:2048'],
            'mode' => ['nullable', 'string', 'in:login,link'],
        ]);

        $origin = $this->sanitizeAllowedFrontendOrigin((string) $validated['origin']);
        if ($origin === null) {
            return response()->json(['error' => 'Origin login Google tidak diizinkan.'], 422);
        }

        return response()->json([
            'data' => [
                'origin' => $origin,
                'mode' => (string) ($validated['mode'] ?? 'login'),
                'client_id' => $this->googleClientId(),
            ],
        ]);
    }

    public function googleCodeLogin(Request $request)
    {
        if (! $this->isGoogleAuthEnabled()) {
            return response()->json(['error' => 'Login Google belum diaktifkan oleh administrator.'], 422);
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['error' => 'Tenant sekolah tidak valid untuk login Google.'], 400);
        }

        $validated = $request->validate([
            'code' => ['required', 'string', 'max:4096'],
        ]);

        $googleUser = $this->exchangeGooglePopupCodeForUser((string) $validated['code']);
        if (! ($googleUser['ok'] ?? false)) {
            return response()->json([
                'error' => $this->safeGoogleErrorMessage((string) ($googleUser['message'] ?? 'Login Google gagal diproses.')),
            ], 422);
        }

        try {
            $user = $this->completeGoogleLogin($request, [
                'tenant_id' => $tenantId,
                'host' => $this->currentHost($request),
            ], $googleUser);
        } catch (\Throwable $e) {
            report($e);

            return response()->json([
                'error' => $this->safeGoogleErrorMessage($e->getMessage()),
            ], 422);
        }

        return response()->json([
            'data' => [
                'user' => $user->fresh(),
                'profile' => $this->profile($request),
            ],
        ]);
    }

    public function googleCredentialLogin(Request $request)
    {
        if (! $this->isGoogleAuthEnabled()) {
            return response()->json(['error' => 'Login Google belum diaktifkan oleh administrator.'], 422);
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['error' => 'Tenant sekolah tidak valid untuk login Google.'], 400);
        }

        $clientId = $this->googleClientId();
        if ($clientId === '') {
            return response()->json(['error' => 'Konfigurasi Google OAuth belum lengkap.'], 422);
        }

        $validated = $request->validate([
            'credential' => ['required', 'string', 'max:4096'],
        ]);

        $googleUser = $this->verifyGoogleIdToken(
            (string) $validated['credential'],
            $clientId
        );
        if (! ($googleUser['ok'] ?? false)) {
            return response()->json([
                'error' => $this->safeGoogleErrorMessage((string) ($googleUser['message'] ?? 'Login Google gagal diproses.')),
            ], 422);
        }

        try {
            $user = $this->completeGoogleLogin($request, [
                'tenant_id' => $tenantId,
                'host' => $this->currentHost($request),
            ], $googleUser);
        } catch (\Throwable $e) {
            report($e);

            return response()->json([
                'error' => $this->safeGoogleErrorMessage($e->getMessage()),
            ], 422);
        }

        return response()->json([
            'data' => [
                'user' => $user->fresh(),
                'profile' => $this->profile($request),
            ],
        ]);
    }

    public function googleCredentialLink(Request $request)
    {
        if (! $this->isGoogleAuthEnabled()) {
            return response()->json(['error' => 'Login Google belum diaktifkan oleh administrator.'], 422);
        }

        $user = $request->user();
        if (! $user?->id) {
            return response()->json(['error' => 'Unauthenticated'], 401);
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['error' => 'Tenant sekolah tidak valid untuk tautkan Google.'], 400);
        }

        $clientId = $this->googleClientId();
        if ($clientId === '') {
            return response()->json(['error' => 'Konfigurasi Google OAuth belum lengkap.'], 422);
        }

        $validated = $request->validate([
            'credential' => ['required', 'string', 'max:4096'],
        ]);

        $googleUser = $this->verifyGoogleIdToken(
            (string) $validated['credential'],
            $clientId
        );
        if (! ($googleUser['ok'] ?? false)) {
            return response()->json([
                'error' => $this->safeGoogleErrorMessage((string) ($googleUser['message'] ?? 'Tautkan Google gagal diproses.')),
            ], 422);
        }

        try {
            $this->completeGoogleLink($request, [
                'tenant_id' => $tenantId,
                'link_user_id' => (string) $user->id,
            ], $googleUser);
        } catch (\Throwable $e) {
            report($e);

            return response()->json([
                'error' => $this->safeGoogleErrorMessage($e->getMessage()),
            ], 422);
        }

        return response()->json([
            'data' => [
                'user' => User::query()->find($user->id),
                'profile' => $this->profile($request),
            ],
        ]);
    }

    public function googleUnlink(Request $request)
    {
        $user = $request->user();
        if (! $user?->id) {
            return response()->json(['error' => 'Unauthenticated'], 401);
        }

        $tenantId = trim((string) ($this->tenantId($request) ?? ''));
        $isSuperAdminIdentity = $this->isSuperAdminByIdentity(
            (string) $user->id,
            (string) ($user->email ?? '')
        );
        if (! $isSuperAdminIdentity && $tenantId !== '') {
            $profile = Profile::query()
                ->where('id', $user->id)
                ->where('tenant_id', $tenantId)
                ->first();
            if (! $profile) {
                return response()->json([
                    'error' => 'Akun tidak memiliki akses tenant ini.',
                ], 403);
            }
        }

        $alreadyUnlinked = trim((string) ($user->google_id ?? '')) === ''
            && trim((string) ($user->google_email ?? '')) === ''
            && $user->google_linked_at === null;

        if (! $alreadyUnlinked) {
            $user->forceFill([
                'google_id' => null,
                'google_email' => null,
                'google_avatar_url' => null,
                'google_linked_at' => null,
            ])->save();
        }

        $freshUser = User::query()->find($user->id);
        $profile = Profile::query()->where('id', $user->id)->first();

        return response()->json([
            'data' => [
                'user' => $freshUser,
                'profile' => $profile,
            ],
        ]);
    }

    public function googleCallback(Request $request)
    {
        $defaultReturn = $this->frontendAuthUrl('/login', [], $request);

        if (! $this->isGoogleAuthEnabled()) {
            return redirect()->away($this->appendQueryToUrl($defaultReturn, [
                'google' => 'disabled',
            ]));
        }

        $state = trim((string) $request->query('state', ''));
        $statePayload = $this->pullGoogleState($request, $state);
        if (! $statePayload) {
            return redirect()->away($this->appendQueryToUrl($defaultReturn, [
                'google' => 'state_invalid',
            ]));
        }

        $redirectTarget = $statePayload['redirect'] ?? $defaultReturn;

        $googleError = trim((string) $request->query('error', ''));
        if ($googleError !== '') {
            if ($popupResponse = $this->googlePopupErrorResponse($statePayload, 'Login Google dibatalkan atau ditolak.')) {
                return $popupResponse;
            }

            return redirect()->away($this->appendQueryToUrl($redirectTarget, [
                'google' => 'failed',
                'google_error' => 'Login Google dibatalkan atau ditolak.',
            ]));
        }

        $code = trim((string) $request->query('code', ''));
        if ($code === '') {
            if ($popupResponse = $this->googlePopupErrorResponse($statePayload, 'Kode autentikasi Google tidak ditemukan.')) {
                return $popupResponse;
            }

            return redirect()->away($this->appendQueryToUrl($redirectTarget, [
                'google' => 'failed',
                'google_error' => 'Kode autentikasi Google tidak ditemukan.',
            ]));
        }

        $googleUser = $this->exchangeGoogleCodeForUser($request, $code);
        if (! $googleUser['ok']) {
            if ($popupResponse = $this->googlePopupErrorResponse($statePayload, (string) $googleUser['message'])) {
                return $popupResponse;
            }

            return redirect()->away($this->appendQueryToUrl($redirectTarget, [
                'google' => 'failed',
                'google_error' => $googleUser['message'],
            ]));
        }

        try {
            $mode = (string) ($statePayload['mode'] ?? 'login');
            if ($mode === 'link') {
                $this->completeGoogleLink($request, $statePayload, $googleUser);

                if ($popupResponse = $this->googlePopupSuccessResponse($statePayload, 'linked')) {
                    return $popupResponse;
                }

                return redirect()->away($this->appendQueryToUrl($redirectTarget, [
                    'google' => 'linked',
                ]));
            }

            $user = $this->completeGoogleLogin($request, $statePayload, $googleUser);
            $handoffResponse = $this->buildGoogleLoginHandoffRedirect(
                $request,
                $statePayload,
                $redirectTarget,
                $user
            );
            if ($handoffResponse instanceof RedirectResponse) {
                return $handoffResponse;
            }

            if ($popupResponse = $this->googlePopupSuccessResponse($statePayload, 'success')) {
                return $popupResponse;
            }

            return redirect()->away($this->appendQueryToUrl($redirectTarget, [
                'google' => 'success',
            ]));
        } catch (\Throwable $e) {
            report($e);

            if ($popupResponse = $this->googlePopupErrorResponse($statePayload, $this->safeGoogleErrorMessage($e->getMessage()))) {
                return $popupResponse;
            }

            return redirect()->away($this->appendQueryToUrl($redirectTarget, [
                'google' => 'failed',
                'google_error' => $this->safeGoogleErrorMessage($e->getMessage()),
            ]));
        }
    }

    public function login(Request $request)
    {
        $payload = $request->only(['email', 'password']);

        $validator = Validator::make($payload, [
            'email' => 'required|string',
            'password' => 'required|string',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['error' => 'Tenant tidak valid'], 400);
        }

        $identifier = trim((string) $payload['email']);
        $password = (string) $payload['password'];
        $host = $this->currentHost($request);
        $throttleKey = $this->loginThrottleKey($request, $tenantId, $identifier);
        $maxAttempts = $this->maxLoginAttempts();

        if (RateLimiter::tooManyAttempts($throttleKey, $maxAttempts)) {
            $seconds = max(1, RateLimiter::availableIn($throttleKey));
            $this->logAuthEvent($request, 'login_locked', [
                'identifier' => $identifier,
                'tenant_id' => $tenantId,
                'host' => $host,
                'seconds_remaining' => $seconds,
            ]);

            return response()->json([
                'error' => "Terlalu banyak percobaan login. Coba lagi dalam {$seconds} detik.",
            ], 429);
        }

        $resolved = $this->resolveLoginEmail($identifier, $tenantId);
        if (isset($resolved['error'])) {
            $this->registerFailedLoginAttempt($throttleKey);
            $this->logAuthEvent($request, 'login_failed_resolution', [
                'identifier' => $identifier,
                'tenant_id' => $tenantId,
                'error' => $resolved['error'],
            ]);

            return response()->json(['error' => $resolved['error']], $resolved['code']);
        }
        $email = $resolved['email'];

        $credentials = [
            'email' => $email,
            'password' => $password,
        ];

        $identityUserId = User::query()
            ->where('email', $email)
            ->value('id');
        $isSuperAdminIdentity = $this->isSuperAdminByIdentity(
            $identityUserId ? (string) $identityUserId : null,
            $email
        );
        if ($isSuperAdminIdentity && ! $this->isAdminHost($host)) {
            $this->registerFailedLoginAttempt($throttleKey);
            $this->logAuthEvent($request, 'login_denied_super_admin_wrong_host', [
                'email' => $email,
                'tenant_id' => $tenantId,
                'host' => $host,
            ]);

            return response()->json(['error' => $this->superAdminHostMessage()], 403);
        }

        if (! $isSuperAdminIdentity && $this->isAdminHost($host)) {
            $this->registerFailedLoginAttempt($throttleKey);
            $this->logAuthEvent($request, 'login_denied_non_super_admin_on_admin_host', [
                'email' => $email,
                'tenant_id' => $tenantId,
                'host' => $host,
            ]);

            return response()->json([
                'error' => 'Login admin sekolah/guru/siswa harus lewat subdomain sekolah masing-masing.',
            ], 403);
        }

        $profileForLogin = $this->resolveProfileForLoginEmail(
            $tenantId,
            $email,
            $identityUserId ? (string) $identityUserId : null
        );
        $usedInitialPasswordAlias = false;

        if (! Auth::attempt($credentials)) {
            $initialAliasPassword = $this->resolveInitialPasswordAliasForLogin($profileForLogin, $password);

            if ($initialAliasPassword !== null && Auth::attempt([
                'email' => $email,
                'password' => $initialAliasPassword,
            ])) {
                $usedInitialPasswordAlias = true;
            } else {
                $this->registerFailedLoginAttempt($throttleKey);
                $this->logAuthEvent($request, 'login_failed_invalid_credentials', [
                    'email' => $email,
                    'tenant_id' => $tenantId,
                    'host' => $host,
                ]);

                return response()->json(['error' => 'Email/NIS atau password salah'], 401);
            }
        }

        if ($request->hasSession()) {
            $request->session()->regenerate();
        }

        $user = $request->user();
        $profile = $this->profile($request);

        if (! $profile || $profile->tenant_id !== $tenantId) {
            $this->logoutWebSession($request);
            $this->registerFailedLoginAttempt($throttleKey);
            $this->logAuthEvent($request, 'login_failed_tenant_mismatch', [
                'email' => $email,
                'tenant_id' => $tenantId,
                'host' => $host,
            ]);

            return response()->json(['error' => 'Akun tidak terdaftar di sekolah ini'], 403);
        }

        if ($profile && $profile->status === 'nonaktif') {
            $this->logoutWebSession($request);
            $this->registerFailedLoginAttempt($throttleKey);
            $this->logAuthEvent($request, 'login_failed_profile_inactive', [
                'email' => $email,
                'tenant_id' => $tenantId,
                'host' => $host,
            ]);
            $message = 'Akun ini dinonaktifkan. Hubungi administrator.';
            if ($profile->alasan_nonaktif) {
                $message .= ' Alasan: '.$profile->alasan_nonaktif;
            }

            return response()->json(['error' => $message], 403);
        }

        RateLimiter::clear($throttleKey);
        $this->logAuthEvent($request, 'login_success', [
            'email' => $email,
            'tenant_id' => $tenantId,
            'host' => $host,
            'user_id' => (string) ($user->id ?? ''),
            'role' => $profile->role ?? null,
            'is_super_admin' => $isSuperAdminIdentity,
            'used_initial_password_alias' => $usedInitialPasswordAlias,
        ], $user->id ?? null, $profile->role ?? null);

        return response()->json([
            'data' => [
                'user' => $user,
                'profile' => $profile,
            ],
        ]);
    }

    private function resolveLoginEmail(string $identifier, string $tenantId): array
    {
        if (str_contains($identifier, '@')) {
            if (! filter_var($identifier, FILTER_VALIDATE_EMAIL)) {
                return ['error' => 'Format email tidak valid', 'code' => 422];
            }

            return ['email' => strtolower($identifier)];
        }

        // NIS Logic
        $profile = Profile::query()
            ->where('tenant_id', $tenantId)
            ->where('nis', $identifier)
            ->first();

        if (! $profile) {
            return ['error' => 'NIS atau password salah', 'code' => 401];
        }

        $email = strtolower(trim((string) ($profile->email ?? '')));
        if ($email === '') {
            // Backward compatibility
            $fallbackUser = User::query()->select('email')->where('id', $profile->id)->first();
            $email = strtolower(trim((string) ($fallbackUser->email ?? '')));
        }

        if ($email === '') {
            return ['error' => 'Akun tidak memiliki email login. Hubungi admin.', 'code' => 403];
        }

        if (($profile->role ?? null) === 'guru') {
            return ['error' => 'Akun guru harus login menggunakan email', 'code' => 403];
        }

        if (! $this->isInitialAccountSetupPending($profile, $email)) {
            if (Str::endsWith($email, '@import.local')) {
                return ['error' => 'Email akun belum aktif. Hubungi admin.', 'code' => 403];
            }

            return ['error' => 'Gunakan email untuk login', 'code' => 403];
        }

        return ['email' => $email];
    }

    private function loginThrottleKey(Request $request, string $tenantId, string $identifier): string
    {
        $normalized = strtolower(trim($identifier));

        return 'auth-login|'.$tenantId.'|'.$request->ip().'|'.sha1($normalized);
    }

    private function maxLoginAttempts(): int
    {
        return max(3, (int) env('AUTH_LOGIN_MAX_ATTEMPTS', 5));
    }

    private function registerFailedLoginAttempt(string $key): void
    {
        $attempts = RateLimiter::attempts($key) + 1;
        $decaySeconds = 60;
        if ($attempts >= 6) {
            $decaySeconds = 900;
        } elseif ($attempts >= 4) {
            $decaySeconds = 300;
        }

        RateLimiter::hit($key, $decaySeconds);
    }

    private function currentHost(Request $request): string
    {
        return strtolower(trim((string) $request->getHost()));
    }

    private function isAdminHost(string $host): bool
    {
        return $this->tenantDomainService->isAdminHost($host);
    }

    private function superAdminHostMessage(): string
    {
        return str_replace(
            'Panel super admin',
            'Akun super admin',
            $this->tenantDomainService->adminHostMessage()
        );
    }

    private function logAuthEvent(
        Request $request,
        string $event,
        array $newData = [],
        ?string $userId = null,
        ?string $userRole = null
    ): void {
        try {
            $payload = [
                'table_name' => 'auth_events',
                'record_id' => (string) Str::uuid(),
                'action' => 'INSERT',
                'old_data' => null,
                'new_data' => json_encode(array_merge([
                    'event' => $event,
                    'ip' => $request->ip(),
                    'user_agent' => (string) $request->userAgent(),
                    'host' => $this->currentHost($request),
                ], $newData)),
                'user_id' => $userId,
                'user_role' => $userRole,
                'timestamp' => now(),
            ];

            $tenantId = $this->tenantId($request);
            if ($tenantId) {
                $payload['tenant_id'] = $tenantId;
            }

            DB::table('audit_log')->insert($payload);
        } catch (\Throwable $e) {
            // never break auth flow on audit failure
        }
    }

    private function isGoogleAuthEnabled(): bool
    {
        return (bool) config('services.google.enabled', false);
    }

    private function googleClientId(): string
    {
        return trim((string) config('services.google.client_id', ''));
    }

    private function googleClientSecret(): string
    {
        return trim((string) config('services.google.client_secret', ''));
    }

    private function googleRedirectUri(Request $request): string
    {
        $socialiteConfigured = trim((string) config('services.google.redirect', ''));
        if ($socialiteConfigured !== '') {
            return $socialiteConfigured;
        }

        $configured = trim((string) config('services.google.redirect_uri', ''));
        if ($configured !== '') {
            return $configured;
        }

        return rtrim($request->getSchemeAndHttpHost(), '/').'/api/auth/google/callback';
    }

    private function googleAuthorizationUrl(Request $request, string $state): string
    {
        $query = [
            'client_id' => $this->googleClientId(),
            'redirect_uri' => $this->googleRedirectUri($request),
            'response_type' => 'code',
            'scope' => 'openid email profile',
            'state' => $state,
            'include_granted_scopes' => 'true',
        ];

        $prompt = trim((string) config('services.google.prompt', 'select_account'));
        if ($prompt !== '') {
            $query['prompt'] = $prompt;
        }

        return 'https://accounts.google.com/o/oauth2/v2/auth?'.http_build_query(
            $query,
            '',
            '&',
            PHP_QUERY_RFC3986
        );
    }

    private function googlePopupStatePayload(Request $request): array
    {
        if (! $request->boolean('popup')) {
            return [];
        }

        $origin = $this->sanitizeAllowedFrontendOrigin((string) $request->query('origin', ''));
        $popupState = trim((string) $request->query('popup_state', ''));
        if ($origin === null || $popupState === '') {
            return [];
        }

        return [
            'popup' => true,
            'popup_origin' => $origin,
            'popup_state' => $popupState,
        ];
    }

    private function createGoogleState(Request $request, string $mode, array $payload = []): string
    {
        $state = Str::random(56);
        $states = $request->session()->get(self::GOOGLE_STATE_SESSION_KEY, []);
        $now = time();

        $filteredStates = [];
        foreach ((array) $states as $key => $value) {
            $createdAt = (int) ($value['created_at'] ?? 0);
            if ($createdAt <= 0 || ($now - $createdAt) > self::GOOGLE_STATE_TTL_SECONDS) {
                continue;
            }
            $filteredStates[$key] = $value;
        }

        $nextPayload = array_merge($payload, [
            'mode' => $mode,
            'created_at' => $now,
        ]);
        $filteredStates[$state] = $nextPayload;

        $request->session()->put(self::GOOGLE_STATE_SESSION_KEY, $filteredStates);
        $request->session()->save();
        $this->storeGoogleStateInCache($state, $nextPayload);

        return $state;
    }

    private function pullGoogleState(Request $request, string $state): ?array
    {
        if ($state === '') {
            return null;
        }

        $states = (array) $request->session()->get(self::GOOGLE_STATE_SESSION_KEY, []);
        $sessionPayload = $states[$state] ?? null;
        if (is_array($sessionPayload)) {
            unset($states[$state]);
            $request->session()->put(self::GOOGLE_STATE_SESSION_KEY, $states);

            if ($this->isGoogleStatePayloadFresh($sessionPayload)) {
                $this->forgetGoogleStateCache($state);

                return $sessionPayload;
            }
        }

        $cachePayload = $this->pullGoogleStateFromCache($state);
        if (! is_array($cachePayload)) {
            return null;
        }

        if (! $this->isGoogleStatePayloadFresh($cachePayload)) {
            return null;
        }

        return $cachePayload;
    }

    private function googleStateCacheKey(string $state): string
    {
        return self::GOOGLE_STATE_CACHE_KEY_PREFIX.$state;
    }

    private function storeGoogleStateInCache(string $state, array $payload): void
    {
        try {
            Cache::put(
                $this->googleStateCacheKey($state),
                $payload,
                now()->addSeconds(self::GOOGLE_STATE_TTL_SECONDS)
            );
        } catch (\Throwable $e) {
            // fallback still available via session
        }
    }

    private function pullGoogleStateFromCache(string $state): ?array
    {
        try {
            $payload = Cache::pull($this->googleStateCacheKey($state));

            return is_array($payload) ? $payload : null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function forgetGoogleStateCache(string $state): void
    {
        try {
            Cache::forget($this->googleStateCacheKey($state));
        } catch (\Throwable $e) {
            // ignore cache cleanup failures
        }
    }

    private function isGoogleStatePayloadFresh(array $payload): bool
    {
        $createdAt = (int) ($payload['created_at'] ?? 0);

        return $createdAt > 0 && (time() - $createdAt) <= self::GOOGLE_STATE_TTL_SECONDS;
    }

    private function exchangeGoogleCodeForUser(Request $request, string $code): array
    {
        if (trim($code) === '') {
            return [
                'ok' => false,
                'message' => 'Kode autentikasi Google tidak ditemukan.',
            ];
        }

        $clientId = $this->googleClientId();
        $clientSecret = $this->googleClientSecret();
        if ($clientId === '' || $clientSecret === '') {
            return [
                'ok' => false,
                'message' => 'Konfigurasi Google OAuth belum lengkap.',
            ];
        }

        try {
            $tokenResponse = Http::asForm()
                ->acceptJson()
                ->timeout(20)
                ->post('https://oauth2.googleapis.com/token', [
                    'code' => trim($code),
                    'client_id' => $clientId,
                    'client_secret' => $clientSecret,
                    'redirect_uri' => $this->googleRedirectUri($request),
                    'grant_type' => 'authorization_code',
                ]);
        } catch (\Throwable $e) {
            report($e);

            return [
                'ok' => false,
                'message' => 'Tidak dapat menghubungi layanan Google OAuth.',
            ];
        }

        if (! $tokenResponse->successful()) {
            return [
                'ok' => false,
                'message' => $this->extractGoogleApiErrorMessage(
                    $tokenResponse,
                    'Kode autentikasi Google tidak valid atau sudah kedaluwarsa.'
                ),
            ];
        }

        $payload = is_array($tokenResponse->json()) ? $tokenResponse->json() : [];
        $idToken = trim((string) ($payload['id_token'] ?? ''));
        if ($idToken === '') {
            return [
                'ok' => false,
                'message' => 'Google tidak mengembalikan identitas akun.',
            ];
        }

        return $this->verifyGoogleIdToken($idToken, $clientId);
    }

    private function exchangeGooglePopupCodeForUser(string $code): array
    {
        if (trim($code) === '') {
            return [
                'ok' => false,
                'message' => 'Kode login Google tidak ditemukan.',
            ];
        }

        $clientId = $this->googleClientId();
        $clientSecret = $this->googleClientSecret();
        if ($clientId === '' || $clientSecret === '') {
            return [
                'ok' => false,
                'message' => 'Konfigurasi Google OAuth belum lengkap.',
            ];
        }

        try {
            $tokenResponse = Http::asForm()
                ->acceptJson()
                ->timeout(20)
                ->post('https://oauth2.googleapis.com/token', [
                    'code' => trim($code),
                    'client_id' => $clientId,
                    'client_secret' => $clientSecret,
                    'redirect_uri' => 'postmessage',
                    'grant_type' => 'authorization_code',
                ]);
        } catch (\Throwable $e) {
            report($e);

            return [
                'ok' => false,
                'message' => 'Tidak dapat menghubungi layanan Google OAuth.',
            ];
        }

        if (! $tokenResponse->successful()) {
            return [
                'ok' => false,
                'message' => $this->extractGoogleApiErrorMessage(
                    $tokenResponse,
                    'Kode login Google tidak valid atau sudah kedaluwarsa.'
                ),
            ];
        }

        $payload = is_array($tokenResponse->json()) ? $tokenResponse->json() : [];
        $idToken = trim((string) ($payload['id_token'] ?? ''));
        if ($idToken === '') {
            return [
                'ok' => false,
                'message' => 'Google tidak mengembalikan identitas akun.',
            ];
        }

        return $this->verifyGoogleIdToken($idToken, $clientId);
    }

    private function verifyGoogleIdToken(string $idToken, string $expectedClientId): array
    {
        try {
            $response = Http::acceptJson()
                ->timeout(20)
                ->get('https://oauth2.googleapis.com/tokeninfo', [
                    'id_token' => $idToken,
                ]);
        } catch (\Throwable $e) {
            report($e);

            return [
                'ok' => false,
                'message' => 'Tidak dapat memverifikasi identitas Google.',
            ];
        }

        if (! $response->successful()) {
            return [
                'ok' => false,
                'message' => $this->extractGoogleApiErrorMessage(
                    $response,
                    'Identitas Google tidak valid atau sudah kedaluwarsa.'
                ),
            ];
        }

        $payload = is_array($response->json()) ? $response->json() : [];
        $audience = trim((string) ($payload['aud'] ?? ''));
        if ($audience === '' || $audience !== $expectedClientId) {
            return [
                'ok' => false,
                'message' => 'Google mengembalikan client yang tidak cocok.',
            ];
        }

        $issuer = trim((string) ($payload['iss'] ?? ''));
        if (! in_array($issuer, ['accounts.google.com', 'https://accounts.google.com'], true)) {
            return [
                'ok' => false,
                'message' => 'Issuer Google tidak valid.',
            ];
        }

        $email = strtolower(trim((string) ($payload['email'] ?? '')));
        $sub = trim((string) ($payload['sub'] ?? ''));
        if ($email === '' || $sub === '') {
            return [
                'ok' => false,
                'message' => 'Akun Google tidak mengembalikan identitas email.',
            ];
        }

        return [
            'ok' => true,
            'sub' => $sub,
            'email' => $email,
            'name' => trim((string) ($payload['name'] ?? '')),
            'avatar' => trim((string) ($payload['picture'] ?? '')),
            'email_verified' => $this->toBoolean($payload['email_verified'] ?? false),
        ];
    }

    private function extractGoogleApiErrorMessage(Response $response, string $fallback): string
    {
        $json = $response->json();
        $message = data_get($json, 'error_description')
            ?: data_get($json, 'error.message')
            ?: data_get($json, 'error')
            ?: data_get($json, 'message');

        $clean = trim((string) $message);

        return $clean !== '' ? $clean : $fallback;
    }

    private function toBoolean($value): bool
    {
        $normalized = filter_var($value, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE);

        return $normalized ?? (bool) $value;
    }

    private function completeGoogleLink(Request $request, array $statePayload, array $googleUser): void
    {
        $linkUserId = trim((string) ($statePayload['link_user_id'] ?? ''));
        if ($linkUserId === '') {
            throw new \RuntimeException('Sesi tautkan Google tidak valid.');
        }

        $tenantId = trim((string) ($statePayload['tenant_id'] ?? ''));
        if ($tenantId === '') {
            throw new \RuntimeException('Tenant untuk tautkan Google tidak valid.');
        }

        $user = User::query()->find($linkUserId);
        if (! $user) {
            throw new \RuntimeException('Akun tidak ditemukan saat proses tautkan Google.');
        }

        $currentEmail = strtolower(trim((string) ($user->email ?? '')));
        $googleEmail = strtolower(trim((string) ($googleUser['email'] ?? '')));
        if ($currentEmail === '' || Str::endsWith($currentEmail, '@import.local')) {
            throw new \RuntimeException(
                'Email akun masih email buatan sistem. Ganti dulu ke email aktif yang sama dengan akun Google Anda sebelum menautkan Google.'
            );
        }
        if ($googleEmail === '' || $currentEmail !== $googleEmail) {
            throw new \RuntimeException(
                'Email akun Google harus sama dengan email akun saat ini untuk proses tautkan.'
            );
        }

        $profile = Profile::query()->where('id', $user->id)->first();
        if (! $this->isSuperAdminByIdentity((string) $user->id, (string) ($user->email ?? ''))) {
            if (! $profile || (string) $profile->tenant_id !== $tenantId) {
                throw new \RuntimeException('Akun tidak memiliki akses tenant ini.');
            }
        }

        if ($profile && $this->shouldBlockGoogleLinkUntilPasswordChanged($profile)) {
            throw new \RuntimeException(
                'Akun siswa hasil import harus mengganti password terlebih dahulu sebelum menautkan Google.'
            );
        }

        $existingByGoogleId = User::query()
            ->where('google_id', $googleUser['sub'])
            ->where('id', '!=', $user->id)
            ->exists();
        if ($existingByGoogleId) {
            throw new \RuntimeException('Akun Google sudah tertaut pada pengguna lain.');
        }

        $existingByEmail = User::query()
            ->whereRaw('lower(email) = ?', [$googleEmail])
            ->where('id', '!=', $user->id)
            ->exists();
        if ($existingByEmail) {
            throw new \RuntimeException('Email Google sudah digunakan akun lain.');
        }

        DB::transaction(function () use ($user, $profile, $googleUser, $currentEmail) {
            $user->forceFill([
                'name' => $user->name ?: $googleUser['name'],
                'google_id' => $googleUser['sub'],
                'google_email' => strtolower(trim((string) ($googleUser['email'] ?? ''))),
                'google_avatar_url' => $googleUser['avatar'] ?: null,
                'google_linked_at' => now(),
                'email_verified_at' => $googleUser['email_verified']
                    ? ($user->email_verified_at ?: now())
                    : $user->email_verified_at,
            ])->save();

            $profileEmail = strtolower(trim((string) ($profile->email ?? '')));
            if ($profile && $currentEmail !== '' && $profileEmail !== $currentEmail) {
                Profile::query()->where('id', $profile->id)->update([
                    'email' => $currentEmail,
                    'updated_at' => now(),
                ]);
            }
        });
    }

    public function googleFinalizeLogin(Request $request)
    {
        $defaultReturn = $this->frontendAuthUrl('/login', [], $request);
        $ticket = trim((string) $request->query('ticket', ''));
        if ($ticket === '') {
            return redirect()->away($this->appendQueryToUrl($defaultReturn, [
                'google' => 'state_invalid',
            ]));
        }

        $payload = $this->pullGoogleLoginHandoffTicket($ticket);
        if (! is_array($payload)) {
            return redirect()->away($this->appendQueryToUrl($defaultReturn, [
                'google' => 'state_invalid',
            ]));
        }

        $createdAt = (int) ($payload['created_at'] ?? 0);
        if ($createdAt <= 0 || (time() - $createdAt) > self::GOOGLE_LOGIN_HANDOFF_TTL_SECONDS) {
            if ($popupResponse = $this->googlePopupErrorResponse($payload, 'Sesi login Google sudah kedaluwarsa.')) {
                return $popupResponse;
            }

            return redirect()->away($this->appendQueryToUrl($defaultReturn, [
                'google' => 'state_invalid',
            ]));
        }

        $expectedHost = strtolower(trim((string) ($payload['host'] ?? '')));
        $currentHost = $this->currentHost($request);
        if ($expectedHost === '' || $expectedHost !== $currentHost) {
            if ($popupResponse = $this->googlePopupErrorResponse($payload, 'Sesi login Google tidak cocok dengan domain aplikasi.')) {
                return $popupResponse;
            }

            return redirect()->away($this->appendQueryToUrl($defaultReturn, [
                'google' => 'state_invalid',
            ]));
        }

        $userId = trim((string) ($payload['user_id'] ?? ''));
        if ($userId === '') {
            if ($popupResponse = $this->googlePopupErrorResponse($payload, 'Sesi login Google tidak valid.')) {
                return $popupResponse;
            }

            return redirect()->away($this->appendQueryToUrl($defaultReturn, [
                'google' => 'failed',
                'google_error' => 'Sesi login Google tidak valid.',
            ]));
        }

        $user = User::query()->find($userId);
        if (! $user) {
            if ($popupResponse = $this->googlePopupErrorResponse($payload, 'Akun pengguna tidak ditemukan.')) {
                return $popupResponse;
            }

            return redirect()->away($this->appendQueryToUrl($defaultReturn, [
                'google' => 'failed',
                'google_error' => 'Akun pengguna tidak ditemukan.',
            ]));
        }

        $tenantId = trim((string) ($payload['tenant_id'] ?? ''));
        $isSuperAdminIdentity = $this->isSuperAdminByIdentity(
            (string) $user->id,
            (string) ($user->email ?? '')
        );
        if (! $isSuperAdminIdentity && $tenantId !== '') {
            $profile = Profile::query()
                ->where('id', $user->id)
                ->where('tenant_id', $tenantId)
                ->first();
            if (! $profile) {
                if ($popupResponse = $this->googlePopupErrorResponse($payload, 'Akun tidak memiliki akses tenant ini.')) {
                    return $popupResponse;
                }

                return redirect()->away($this->appendQueryToUrl($defaultReturn, [
                    'google' => 'failed',
                    'google_error' => 'Akun tidak memiliki akses tenant ini.',
                ]));
            }
        }

        Auth::login($user);
        if ($request->hasSession()) {
            $request->session()->regenerate();
        }

        $redirectTarget = $this->sanitizeFrontendRedirect(
            $request,
            (string) ($payload['redirect'] ?? $defaultReturn)
        );

        if ($popupResponse = $this->googlePopupSuccessResponse($payload, 'success')) {
            return $popupResponse;
        }

        return redirect()->away($this->appendQueryToUrl($redirectTarget, [
            'google' => 'success',
        ]));
    }

    private function completeGoogleLogin(Request $request, array $statePayload, array $googleUser): User
    {
        $tenantId = trim((string) ($statePayload['tenant_id'] ?? ''));
        if ($tenantId === '') {
            throw new \RuntimeException('Tenant login Google tidak valid.');
        }

        $host = trim((string) ($statePayload['host'] ?? $this->currentHost($request)));
        if ($host === '') {
            $host = $this->currentHost($request);
        }

        $user = User::query()
            ->where('google_id', $googleUser['sub'])
            ->first();

        if (! $user) {
            $user = User::query()
                ->whereRaw('lower(email) = ?', [$googleUser['email']])
                ->first();
        }

        if (! $user) {
            throw new \RuntimeException('Akun Google belum terdaftar di sistem sekolah ini.');
        }

        $currentEmail = strtolower(trim((string) ($user->email ?? '')));
        $googleEmail = strtolower(trim((string) ($googleUser['email'] ?? '')));
        if ($currentEmail === '' || Str::endsWith($currentEmail, '@import.local')) {
            throw new \RuntimeException(
                'Email akun belum valid. Perbarui email akun terlebih dahulu sebelum login Google.'
            );
        }
        if ($googleEmail === '' || $currentEmail !== $googleEmail) {
            throw new \RuntimeException(
                'Email Google tidak sesuai dengan email akun. Gunakan akun Google dengan email yang sama.'
            );
        }

        if ($user->google_id && (string) $user->google_id !== (string) $googleUser['sub']) {
            throw new \RuntimeException('Akun Google tidak cocok dengan akun yang terdaftar.');
        }

        $isSuperAdminIdentity = $this->isSuperAdminByIdentity(
            (string) $user->id,
            (string) ($user->email ?? '')
        );
        if ($isSuperAdminIdentity && ! $this->isAdminHost($host)) {
            throw new \RuntimeException($this->superAdminHostMessage());
        }
        if (! $isSuperAdminIdentity && $this->isAdminHost($host)) {
            throw new \RuntimeException(
                'Login admin sekolah/guru/siswa harus lewat subdomain sekolah masing-masing.'
            );
        }

        $profile = Profile::query()
            ->where('id', $user->id)
            ->where('tenant_id', $tenantId)
            ->first();
        if (! $profile && ! $isSuperAdminIdentity) {
            throw new \RuntimeException('Akun Google tidak terdaftar di tenant ini.');
        }
        if ($profile && $profile->status === 'nonaktif') {
            $message = 'Akun ini dinonaktifkan. Hubungi administrator.';
            if ($profile->alasan_nonaktif) {
                $message .= ' Alasan: '.$profile->alasan_nonaktif;
            }
            throw new \RuntimeException($message);
        }

        DB::transaction(function () use ($user, $profile, $googleUser, $currentEmail) {
            $user->forceFill([
                'name' => $user->name ?: $googleUser['name'],
                'google_id' => $googleUser['sub'],
                'google_email' => strtolower(trim((string) ($googleUser['email'] ?? ''))),
                'google_avatar_url' => $googleUser['avatar'] ?: null,
                'google_linked_at' => now(),
                'email_verified_at' => $googleUser['email_verified']
                    ? ($user->email_verified_at ?: now())
                    : $user->email_verified_at,
            ])->save();

            $profileEmail = strtolower(trim((string) ($profile->email ?? '')));
            if ($profile && $currentEmail !== '' && $profileEmail !== $currentEmail) {
                Profile::query()->where('id', $profile->id)->update([
                    'email' => $currentEmail,
                    'updated_at' => now(),
                ]);
            }
        });

        Auth::login($user);
        if ($request->hasSession()) {
            $request->session()->regenerate();
        }

        return $user;
    }

    private function buildGoogleLoginHandoffRedirect(
        Request $request,
        array $statePayload,
        string $redirectTarget,
        User $user
    ): ?RedirectResponse {
        $originHost = strtolower(trim((string) ($statePayload['host'] ?? '')));
        if ($originHost === '' || ! $this->isAllowedFrontendHost($originHost)) {
            return null;
        }

        $currentHost = $this->currentHost($request);
        if ($originHost === $currentHost) {
            return null;
        }

        $ticket = $this->createGoogleLoginHandoffTicket([
            'user_id' => (string) $user->id,
            'tenant_id' => (string) ($statePayload['tenant_id'] ?? ''),
            'host' => $originHost,
            'redirect' => $redirectTarget,
            'mode' => (string) ($statePayload['mode'] ?? 'login'),
            'popup' => (bool) ($statePayload['popup'] ?? false),
            'popup_origin' => (string) ($statePayload['popup_origin'] ?? ''),
            'popup_state' => (string) ($statePayload['popup_state'] ?? ''),
            'created_at' => time(),
        ]);
        if ($ticket === '') {
            return null;
        }

        $handoffUrl = $this->buildHostAwareUrl(
            $request,
            $originHost,
            '/api/auth/google/finalize-login',
            ['ticket' => $ticket]
        );

        $this->logoutWebSession($request);

        return redirect()->away($handoffUrl);
    }

    private function buildHostAwareUrl(
        Request $request,
        string $targetHost,
        string $path,
        array $query = []
    ): string {
        $candidateBase = $this->resolveFrontendBaseFromRequest($request);
        if ($candidateBase === null) {
            $candidateBase = rtrim((string) $request->getSchemeAndHttpHost(), '/');
        }

        $parts = parse_url($candidateBase);
        $scheme = is_array($parts) ? strtolower((string) ($parts['scheme'] ?? '')) : '';
        if (! in_array($scheme, ['http', 'https'], true)) {
            $scheme = 'https';
        }

        $port = is_array($parts) && isset($parts['port']) ? ':'.((int) $parts['port']) : '';
        $url = rtrim($scheme.'://'.$targetHost.$port, '/').'/'.ltrim($path, '/');
        $qs = http_build_query($query);

        return $qs !== '' ? $url.'?'.$qs : $url;
    }

    private function googleLoginHandoffCacheKey(string $ticket): string
    {
        return self::GOOGLE_LOGIN_HANDOFF_CACHE_KEY_PREFIX.$ticket;
    }

    private function createGoogleLoginHandoffTicket(array $payload): string
    {
        $ticket = Str::random(64);
        try {
            Cache::put(
                $this->googleLoginHandoffCacheKey($ticket),
                $payload,
                now()->addSeconds(self::GOOGLE_LOGIN_HANDOFF_TTL_SECONDS)
            );
        } catch (\Throwable $e) {
            return '';
        }

        return $ticket;
    }

    private function pullGoogleLoginHandoffTicket(string $ticket): ?array
    {
        if ($ticket === '') {
            return null;
        }

        try {
            $payload = Cache::pull($this->googleLoginHandoffCacheKey($ticket));

            return is_array($payload) ? $payload : null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function appendQueryToUrl(string $url, array $query = []): string
    {
        $clean = trim($url);
        if ($clean === '') {
            return $this->frontendAuthUrl('/login');
        }

        $separator = str_contains($clean, '?') ? '&' : '?';
        $qs = http_build_query($query);
        if ($qs === '') {
            return $clean;
        }

        return $clean.$separator.$qs;
    }

    private function sanitizeFrontendRedirect(Request $request, string $raw): string
    {
        $raw = trim($raw);
        $fallback = $this->frontendAuthUrl('/login', [], $request);
        if ($raw === '') {
            return $fallback;
        }

        if (str_starts_with($raw, '/')) {
            return rtrim($this->safeFrontendBaseUrl($request), '/').$raw;
        }

        $base = $this->safeFrontendBaseUrl($request);
        $baseParts = parse_url($base);
        $targetParts = parse_url($raw);
        if (! is_array($baseParts) || ! is_array($targetParts)) {
            return $fallback;
        }

        $targetHost = strtolower((string) ($targetParts['host'] ?? ''));
        $targetScheme = strtolower((string) ($targetParts['scheme'] ?? ''));
        if ($targetHost === '' || ! in_array($targetScheme, ['http', 'https'], true)) {
            return $fallback;
        }

        if (! $this->isAllowedFrontendHost($targetHost)) {
            return $fallback;
        }

        $path = '/'.ltrim((string) ($targetParts['path'] ?? '/'), '/');
        $query = trim((string) ($targetParts['query'] ?? ''));
        $port = isset($targetParts['port']) ? ':'.((int) $targetParts['port']) : '';
        $safe = $targetScheme.'://'.$targetHost.$port.$path;
        if ($query !== '') {
            $safe .= '?'.$query;
        }

        return $safe;
    }

    private function sanitizeAllowedFrontendOrigin(string $raw): ?string
    {
        $value = trim($raw);
        if ($value === '') {
            return null;
        }

        $parts = parse_url($value);
        if (! is_array($parts)) {
            return null;
        }

        $host = strtolower(trim((string) ($parts['host'] ?? '')));
        $scheme = strtolower(trim((string) ($parts['scheme'] ?? '')));
        if ($host === '' || ! in_array($scheme, ['http', 'https'], true)) {
            return null;
        }

        if (! $this->isAllowedFrontendHost($host)) {
            return null;
        }

        $port = isset($parts['port']) ? ':'.((int) $parts['port']) : '';

        return $scheme.'://'.$host.$port;
    }

    private function safeGoogleErrorMessage(?string $message): string
    {
        $value = trim(strip_tags((string) $message));
        if ($value === '') {
            return 'Login Google gagal diproses.';
        }

        return Str::limit($value, 140, '...');
    }

    private function googlePopupSuccessResponse(array $statePayload, string $status): ?\Illuminate\Http\Response
    {
        return $this->googlePopupResponse($statePayload, [
            'type' => 'edusmart-google-oauth-success',
            'status' => $status,
        ]);
    }

    private function googlePopupErrorResponse(array $statePayload, string $message): ?\Illuminate\Http\Response
    {
        return $this->googlePopupResponse($statePayload, [
            'type' => 'edusmart-google-error',
            'error' => $this->safeGoogleErrorMessage($message),
        ]);
    }

    private function googlePopupResponse(array $statePayload, array $payload): ?\Illuminate\Http\Response
    {
        if (! (bool) ($statePayload['popup'] ?? false)) {
            return null;
        }

        $origin = $this->sanitizeAllowedFrontendOrigin((string) ($statePayload['popup_origin'] ?? ''));
        $popupState = trim((string) ($statePayload['popup_state'] ?? ''));
        if ($origin === null || $popupState === '') {
            return null;
        }

        $message = array_merge([
            'source' => 'edusmart-google-popup',
            'state' => $popupState,
            'mode' => (string) ($statePayload['mode'] ?? 'login'),
        ], $payload);

        $html = '<!doctype html><html lang="id"><head><meta charset="utf-8">'
            .'<meta name="viewport" content="width=device-width,initial-scale=1">'
            .'<title>Google Login - EduSmart</title></head>'
            .'<body style="font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:24px;color:#0f172a">'
            .'<p>Proses Google selesai. Jendela ini akan tertutup otomatis.</p>'
            .'<script>'
            .'const payload = '.Js::from($message).';'
            .'const targetOrigin = '.Js::from($origin).';'
            .'let attempts = 0;'
            .'const notify = () => {'
            .'attempts += 1;'
            .'try { if (window.opener && !window.opener.closed) window.opener.postMessage(payload, targetOrigin); } catch (error) {}'
            .'};'
            .'notify();'
            .'const timer = window.setInterval(() => { notify(); if (attempts >= 8) window.clearInterval(timer); }, 120);'
            .'window.setTimeout(() => { window.clearInterval(timer); window.close(); }, 1200);'
            .'</script></body></html>';

        return response($html, 200)->header('Content-Type', 'text/html; charset=UTF-8');
    }

    public function register(Request $request)
    {
        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['error' => 'Tenant tidak valid'], 400);
        }

        $payload = $request->only(['nama', 'email', 'password', 'role']);
        $allowAdminCreate = $this->isAdmin($request);
        if ($allowAdminCreate) {
            $payload['password'] = $this->normalizeAdminCreatedPassword((string) ($payload['password'] ?? ''));
        }

        $validator = Validator::make($payload, [
            'nama' => 'required|string|max:120',
            'email' => 'required|email|max:255',
            'password' => ['required', 'string', PasswordRule::defaults()],
            'role' => 'required|in:siswa,guru,admin',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        if (! $allowAdminCreate) {
            // Security: Rate Limiting untuk mencegah spam registrasi publik
            $throttleKey = 'auth-register|'.$request->ip();
            if (RateLimiter::tooManyAttempts($throttleKey, 5)) {
                $seconds = RateLimiter::availableIn($throttleKey);

                return response()->json(['error' => "Terlalu banyak percobaan registrasi. Coba lagi dalam {$seconds} detik."], 429);
            }
            RateLimiter::hit($throttleKey, 600); // Decay 10 menit
        }

        $email = strtolower(trim($payload['email']));
        $role = $payload['role'];

        if (! $allowAdminCreate && $role === 'admin') {
            return response()->json([
                'error' => 'Registrasi admin publik tidak diizinkan. Admin baru harus dibuat dari panel admin.',
            ], 403);
        }

        if ($this->isReservedSuperAdminEmail($email)) {
            return response()->json(['error' => 'Email ini tidak bisa digunakan untuk registrasi'], 403);
        }

        if (! $allowAdminCreate) {
            $settings = DB::table('settings')->where('tenant_id', $tenantId)->orderBy('id')->first();
            $allow = $role === 'siswa';
            if ($role === 'siswa' && $settings && isset($settings->registrasi_siswa_aktif)) {
                $allow = (bool) $settings->registrasi_siswa_aktif;
            }
            if ($role === 'guru' && $settings && isset($settings->registrasi_guru_aktif)) {
                $allow = (bool) $settings->registrasi_guru_aktif;
            }

            if (! $allow) {
                return response()->json(['error' => 'Registrasi role ini tidak dibuka'], 403);
            }
        }

        if (User::query()->where('email', $email)->exists()) {
            return response()->json(['error' => 'Email sudah terdaftar'], 409);
        }

        $userId = (string) Str::uuid();

        $result = null;
        DB::transaction(function () use ($userId, $email, $payload, $role, $tenantId, $allowAdminCreate, &$result) {
            $user = User::query()->create([
                'id' => $userId,
                'name' => $payload['nama'],
                'email' => $email,
                'password' => Hash::make($payload['password']),
            ]);

            $profile = Profile::query()->create([
                'id' => $userId,
                'tenant_id' => $tenantId,
                'email' => $email,
                'nama' => $payload['nama'],
                'role' => $role,
                'status' => 'active',
                'must_change_password' => $allowAdminCreate && in_array($role, ['siswa', 'guru'], true),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $result = ['user' => $user, 'profile' => $profile];
        });

        if (! Str::endsWith($email, '@import.local')) {
            try {
                $result['user']?->sendEmailVerificationNotification();
            } catch (\Throwable $e) {
                // jangan gagalkan register jika SMTP bermasalah
            }
        }

        return response()->json(['data' => $result], 201);
    }

    private function normalizeAdminCreatedPassword(string $password): string
    {
        $raw = trim($password);
        if ($this->looksLikeStrongPassword($raw)) {
            return $raw;
        }

        $digits = preg_replace('/\D+/', '', $raw) ?? '';
        $digits = $digits !== '' ? $digits : '123456';
        if (strlen($digits) < 6) {
            $digits = str_pad($digits, 6, '0');
        }

        $generated = 'Aa'.$digits.'!Edu';
        while (strlen($generated) < $this->passwordMinLength()) {
            $generated .= '9';
        }

        return $generated;
    }

    private function looksLikeStrongPassword(string $password): bool
    {
        if (strlen($password) < $this->passwordMinLength()) {
            return false;
        }

        return preg_match('/[a-z]/', $password)
            && preg_match('/[A-Z]/', $password)
            && preg_match('/\d/', $password)
            && preg_match('/[^a-zA-Z0-9]/', $password);
    }

    private function passwordMinLength(): int
    {
        return max(12, (int) env('PASSWORD_MIN_LENGTH', 12));
    }

    private function resolveProfileForLoginEmail(string $tenantId, string $email, ?string $userId = null): ?Profile
    {
        $normalizedEmail = strtolower(trim($email));
        $query = Profile::query()->where('tenant_id', $tenantId);

        if ($userId) {
            $byId = (clone $query)->where('id', $userId)->first();
            if ($byId) {
                return $byId;
            }
        }

        if ($normalizedEmail === '') {
            return null;
        }

        return (clone $query)
            ->whereRaw('lower(email) = ?', [$normalizedEmail])
            ->first();
    }

    private function resolveInitialPasswordAliasForLogin(?Profile $profile, string $inputPassword): ?string
    {
        if (! $profile || ! $profile->must_change_password) {
            return null;
        }

        $normalizedInput = $this->normalizeInitialPasswordSeed($inputPassword);
        if ($normalizedInput === '') {
            return null;
        }

        foreach ($this->initialPasswordSeedsForProfile($profile) as $seed) {
            if ($normalizedInput === $seed) {
                return $this->normalizeAdminCreatedPassword($seed);
            }
        }

        return null;
    }

    private function initialPasswordSeedsForProfile(Profile $profile): array
    {
        $seeds = [];
        $birthSeed = $this->buildBirthDatePasswordSeed($profile->tanggal_lahir);
        if ($birthSeed !== '') {
            $seeds[] = $birthSeed;
        } elseif (($nis = trim((string) ($profile->nis ?? ''))) !== '') {
            $digits = preg_replace('/\D+/', '', $nis) ?? '';
            $seeds[] = $digits !== '' ? $digits : $nis;
        }

        return array_values(array_unique(array_filter($seeds)));
    }

    private function buildBirthDatePasswordSeed(mixed $tanggalLahir): string
    {
        if (! $tanggalLahir) {
            return '';
        }

        try {
            $date = date_create((string) $tanggalLahir);
            if (! $date) {
                return '';
            }

            return $date->format('dmY');
        } catch (\Throwable $e) {
            return '';
        }
    }

    private function normalizeInitialPasswordSeed(string $value): string
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return '';
        }

        if (preg_match('/^[0-9\s\/\-.]+$/', $trimmed)) {
            return preg_replace('/\D+/', '', $trimmed) ?? '';
        }

        return $trimmed;
    }

    private function isInitialAccountSetupPending(Profile $profile, string $email = ''): bool
    {
        $role = strtolower(trim((string) ($profile->role ?? '')));
        if (! in_array($role, ['siswa', 'guru'], true)) {
            return false;
        }

        $loginEmail = strtolower(trim($email !== '' ? $email : (string) ($profile->email ?? '')));

        return (bool) ($profile->must_change_password || ! $this->hasRealLoginEmail($loginEmail));
    }

    private function shouldBlockGoogleLinkUntilPasswordChanged(Profile $profile): bool
    {
        $role = strtolower(trim((string) ($profile->role ?? '')));

        return $role === 'siswa' && (bool) $profile->must_change_password;
    }

    private function hasRealLoginEmail(string $email): bool
    {
        $normalized = strtolower(trim($email));
        if ($normalized === '' || ! filter_var($normalized, FILTER_VALIDATE_EMAIL)) {
            return false;
        }

        return ! Str::endsWith($normalized, '@import.local');
    }

    public function forgotPassword(Request $request)
    {
        $payload = $request->only(['email']);
        $validator = Validator::make($payload, [
            'email' => 'required|email',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        // Security: Rate Limiting untuk mencegah spam email
        $throttleKey = 'auth-forgot-password|'.$request->ip();
        if (RateLimiter::tooManyAttempts($throttleKey, 3)) {
            $seconds = RateLimiter::availableIn($throttleKey);

            return response()->json(['error' => "Terlalu banyak permintaan. Coba lagi dalam {$seconds} detik."], 429);
        }
        RateLimiter::hit($throttleKey, 300); // Decay 5 menit

        $email = strtolower(trim($payload['email']));
        $eligibility = $this->passwordResetEligibility($email);
        if ($eligibility['allowed']) {
            try {
                Password::sendResetLink(['email' => $email]);
            } catch (\Throwable $e) {
                report($e);
            }
        }

        return response()->json(['data' => $this->passwordResetRequestAcceptedMessage()]);
    }

    public function resetPassword(Request $request)
    {
        $payload = $request->only(['email', 'token', 'password', 'password_confirmation']);

        $validator = Validator::make($payload, [
            'email' => 'required|email',
            'token' => 'required|string',
            'password' => ['required', 'string', 'confirmed', PasswordRule::defaults()],
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        // Security: Rate Limiting untuk mencegah spam email
        $throttleKey = 'auth-forgot-password|'.$request->ip();
        if (RateLimiter::tooManyAttempts($throttleKey, 3)) {
            $seconds = RateLimiter::availableIn($throttleKey);

            return response()->json(['error' => "Terlalu banyak permintaan. Coba lagi dalam {$seconds} detik."], 429);
        }
        RateLimiter::hit($throttleKey, 300); // Decay 5 menit

        $email = strtolower(trim($payload['email']));
        $eligibility = $this->passwordResetEligibility($email);
        if (! $eligibility['allowed']) {
            return response()->json(['error' => $this->passwordResetFailureMessage()], 400);
        }

        $status = Password::reset(
            [
                'email' => $email,
                'token' => $payload['token'],
                'password' => $payload['password'],
                'password_confirmation' => $payload['password_confirmation'],
            ],
            function ($user, $password) {
                $user->forceFill(['password' => Hash::make($password)])->save();
                // Security: Logout semua perangkat lain setelah reset password
                if (method_exists($user, 'tokens')) {
                    $user->tokens()->delete();
                }
            }
        );

        if ($status !== Password::PASSWORD_RESET) {
            return response()->json(['error' => $this->passwordResetFailureMessage()], 400);
        }

        return response()->json(['data' => 'Password berhasil diubah']);
    }

    public function sendPasswordChangeCode(Request $request)
    {
        $user = $request->user();
        if (! $user) {
            return response()->json(['error' => 'Unauthenticated'], 401);
        }

        if (! $this->requiresPasswordChangeVerification($request)) {
            return response()->json([
                'error' => 'Verifikasi kode hanya berlaku untuk akun guru dan siswa.',
            ], 403);
        }

        if (! Schema::hasTable('password_change_verifications')) {
            return response()->json([
                'error' => 'Fitur verifikasi password belum aktif. Jalankan migrasi terbaru terlebih dahulu.',
            ], 503);
        }

        $payload = $request->only(['email']);
        $validator = Validator::make($payload, [
            'email' => 'nullable|email|max:255',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $targetEmail = strtolower(trim((string) ($payload['email'] ?? $user->email)));
        $currentEmail = strtolower(trim((string) ($user->email ?? '')));
        if ($targetEmail === '' || ! filter_var($targetEmail, FILTER_VALIDATE_EMAIL)) {
            return response()->json(['error' => 'Email tujuan verifikasi tidak valid'], 422);
        }
        if (Str::endsWith($targetEmail, '@import.local')) {
            return response()->json([
                'error' => 'Email akun belum aktif. Isi email aktif dulu, lalu kirim kode verifikasi.',
            ], 422);
        }
        if ($this->shouldRequireGoogleUnlinkBeforeEmailChange($user, $currentEmail, $targetEmail)) {
            return response()->json([
                'error' => 'Lepas tautan Google terlebih dahulu sebelum mengganti email akun.',
            ], 422);
        }

        $throttleKey = 'auth-password-change-code|'.$user->id;
        if (RateLimiter::tooManyAttempts($throttleKey, 5)) {
            $seconds = max(1, RateLimiter::availableIn($throttleKey));

            return response()->json([
                'error' => "Terlalu banyak permintaan kode. Coba lagi dalam {$seconds} detik.",
            ], 429);
        }
        RateLimiter::hit($throttleKey, 600);

        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $tenantId = $this->tenantId($request);
        $now = now();
        $expiresAt = $now->copy()->addSeconds(self::PASSWORD_CHANGE_CODE_TTL_SECONDS);
        $supportsTargetEmail = $this->passwordChangeVerificationsSupportsTargetEmail();

        DB::transaction(function () use ($user, $tenantId, $targetEmail, $code, $now, $expiresAt, $supportsTargetEmail) {
            DB::table('password_change_verifications')
                ->where('user_id', $user->id)
                ->whereNull('used_at')
                ->update([
                    'used_at' => $now,
                    'updated_at' => $now,
                ]);

            $insertPayload = [
                'id' => (string) Str::uuid(),
                'user_id' => (string) $user->id,
                'tenant_id' => $tenantId ?: null,
                'code_hash' => Hash::make($code),
                'expires_at' => $expiresAt,
                'attempt_count' => 0,
                'used_at' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ];

            if ($supportsTargetEmail) {
                $insertPayload['target_email'] = $targetEmail;
            }

            DB::table('password_change_verifications')->insert($insertPayload);
        });

        $schoolName = 'EduSmart';
        if ($tenantId) {
            try {
                $schoolName = (string) (DB::table('settings')
                    ->where('tenant_id', $tenantId)
                    ->orderBy('id')
                    ->value('nama_sekolah') ?: $schoolName);
            } catch (\Throwable $e) {
                // ignore, fallback ke default school name
            }
        }

        $mailBody = implode("\n", [
            "Kode verifikasi perubahan akun Anda: {$code}",
            '',
            'Kode berlaku selama 10 menit dan hanya bisa digunakan 1 kali untuk perubahan email atau password.',
            "Sekolah: {$schoolName}",
            '',
            'Jika Anda tidak meminta perubahan akun ini, abaikan email ini.',
        ]);

        try {
            Mail::raw($mailBody, function ($message) use ($targetEmail) {
                $message->to($targetEmail)
                    ->subject('Kode Verifikasi Perubahan Akun');
            });
        } catch (\Throwable $e) {
            report($e);

            DB::table('password_change_verifications')
                ->where('user_id', $user->id)
                ->whereNull('used_at')
                ->update([
                    'used_at' => now(),
                    'updated_at' => now(),
                ]);

            return response()->json([
                'error' => 'Gagal mengirim email verifikasi. Cek konfigurasi SMTP lalu coba lagi.',
            ], 503);
        }

        return response()->json([
            'data' => [
                'message' => 'Kode verifikasi telah dikirim ke email tujuan.',
                'target_email' => $this->maskEmail($targetEmail),
                'expires_in_seconds' => self::PASSWORD_CHANGE_CODE_TTL_SECONDS,
            ],
        ]);
    }

    public function updatePassword(Request $request)
    {
        $payload = $request->only(['password', 'password_confirmation', 'verification_code']);
        $validator = Validator::make($payload, [
            'password' => ['required', 'string', 'confirmed', PasswordRule::defaults()],
            'verification_code' => 'nullable|digits:6',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $user = $request->user();
        if (! $user) {
            return response()->json(['error' => 'Unauthenticated'], 401);
        }
        if ($this->isSuperAdminByIdentity((string) $user->id, (string) ($user->email ?? ''))) {
            return response()->json(['error' => 'Reset password untuk akun super admin dinonaktifkan'], 403);
        }

        $otpResponse = $this->consumePasswordChangeVerificationCode(
            $request,
            $user,
            (string) ($payload['verification_code'] ?? ''),
            strtolower(trim((string) ($user->email ?? '')))
        );
        if ($otpResponse) {
            return $otpResponse;
        }

        $user->forceFill(['password' => Hash::make($payload['password'])])->save();

        $tenantId = $this->tenantId($request);
        $profileQuery = Profile::query()->where('id', $user->id);
        if ($tenantId) {
            $profileQuery->where('tenant_id', $tenantId);
        }
        $profileQuery->update([
            'must_change_password' => false,
            'updated_at' => now(),
        ]);

        // Security: Logout perangkat lain, tapi biarkan perangkat ini tetap login
        if (method_exists($user, 'tokens')) {
            $user->tokens()->where('id', '!=', $user->currentAccessToken()->id ?? null)->delete();
        }

        return response()->json(['data' => 'Password berhasil diubah']);
    }

    public function updateAccount(Request $request)
    {
        $payload = $request->only(['email', 'password', 'password_confirmation', 'verification_code']);
        $validator = Validator::make($payload, [
            'email' => 'required|email',
            'password' => ['nullable', 'string', 'confirmed', PasswordRule::defaults()],
            'verification_code' => 'nullable|digits:6',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $user = $request->user();
        if (! $user) {
            return response()->json(['error' => 'Unauthenticated'], 401);
        }
        if ($this->isSuperAdminByIdentity((string) $user->id, (string) ($user->email ?? ''))) {
            return response()->json(['error' => 'Reset password untuk akun super admin dinonaktifkan'], 403);
        }
        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['error' => 'Tenant tidak valid'], 400);
        }

        $profile = $this->profile($request);
        $currentEmail = strtolower(trim((string) ($user->email ?? '')));
        $email = strtolower(trim($payload['email']));
        $password = (string) ($payload['password'] ?? '');
        $hasPasswordChange = trim($password) !== '';
        $emailChanged = $email !== '' && $email !== $currentEmail;

        if (! $emailChanged && ! $hasPasswordChange) {
            return response()->json(['error' => 'Tidak ada perubahan akun yang disimpan'], 422);
        }

        if ($this->isReservedSuperAdminEmail($email)) {
            return response()->json(['error' => 'Email ini tidak bisa digunakan'], 403);
        }
        if ($this->shouldRequireGoogleUnlinkBeforeEmailChange($user, $currentEmail, $email)) {
            return response()->json([
                'error' => 'Lepas tautan Google terlebih dahulu sebelum mengganti email akun ini.',
            ], 422);
        }

        if (User::query()->where('email', $email)->where('id', '!=', $user->id)->exists()) {
            return response()->json(['error' => 'Email sudah terdaftar'], 409);
        }

        $requiresVerification = $this->requiresPasswordChangeVerification($request)
            && ! $this->shouldBypassSensitiveActionVerification($request, $user, $profile, $emailChanged, $email);

        $otpResponse = $this->consumePasswordChangeVerificationCode(
            $request,
            $user,
            (string) ($payload['verification_code'] ?? ''),
            $email,
            $emailChanged,
            $profile
        );
        if ($otpResponse) {
            return $otpResponse;
        }

        DB::transaction(function () use ($user, $email, $password, $tenantId, $emailChanged, $hasPasswordChange, $requiresVerification, $profile) {
            $now = now();
            $userPayload = [];
            if ($emailChanged) {
                $userPayload['email'] = $email;
                $userPayload['email_verified_at'] = $requiresVerification ? $now : null;
            }
            if ($hasPasswordChange) {
                $userPayload['password'] = Hash::make($password);
            }
            if (! empty($userPayload)) {
                $user->forceFill($userPayload)->save();
            }

            $profilePayload = [
                'updated_at' => $now,
            ];
            if ($emailChanged) {
                $profilePayload['email'] = $email;
            }
            if ($hasPasswordChange) {
                $profilePayload['must_change_password'] = false;
            }

            Profile::query()->where('id', $user->id)->where('tenant_id', $tenantId)->update($profilePayload);

            $role = strtolower((string) ($profile?->role ?? ''));
            if ($emailChanged && in_array($role, ['guru', 'teacher'], true)) {
                $this->syncTeacherDisplayNameSnapshots(
                    (string) $tenantId,
                    (string) $user->id,
                    (string) ($profile?->nama ?? $user->name ?? ''),
                    $now
                );
            }

            // Security: Jika password berubah, logout perangkat lain
            if ($hasPasswordChange && method_exists($user, 'tokens')) {
                $user->tokens()->where('id', '!=', $user->currentAccessToken()->id ?? null)->delete();
            }
        });

        return response()->json(['data' => 'Akun berhasil diperbarui']);
    }

    public function resendVerificationEmail(Request $request)
    {
        $user = $request->user();
        if (! $user) {
            return response()->json(['error' => 'Unauthenticated'], 401);
        }

        if ($user->hasVerifiedEmail()) {
            return response()->json(['data' => 'Email sudah terverifikasi']);
        }

        // Security: Rate Limiting untuk resend verification
        $throttleKey = 'auth-resend-verification|'.$user->id;
        if (RateLimiter::tooManyAttempts($throttleKey, 3)) {
            $seconds = RateLimiter::availableIn($throttleKey);

            return response()->json(['error' => "Terlalu banyak permintaan. Coba lagi dalam {$seconds} detik."], 429);
        }
        RateLimiter::hit($throttleKey, 300);

        try {
            $user->sendEmailVerificationNotification();
        } catch (\Throwable $e) {
            report($e);

            return response()->json([
                'error' => 'Layanan email sedang bermasalah. Coba lagi beberapa menit.',
            ], 503);
        }

        return response()->json(['data' => 'Link verifikasi email dikirim']);
    }

    public function verifyEmail(Request $request, string $id, string $hash): RedirectResponse
    {
        if (! $request->hasValidSignature()) {
            return redirect()->away($this->frontendAuthUrl('/login', [
                'verified' => 'expired',
            ], $request));
        }

        $user = User::query()->find($id);
        if (! $user) {
            return redirect()->away($this->frontendAuthUrl('/login', [
                'verified' => 'invalid',
            ], $request));
        }

        $expectedHash = sha1((string) $user->getEmailForVerification());
        if (! hash_equals($expectedHash, (string) $hash)) {
            return redirect()->away($this->frontendAuthUrl('/login', [
                'verified' => 'invalid',
            ], $request));
        }

        if (! $user->hasVerifiedEmail()) {
            $user->markEmailAsVerified();
        }

        return redirect()->away($this->frontendAuthUrl('/login', [
            'verified' => 'success',
        ], $request));
    }

    public function logout(Request $request)
    {
        $this->logoutWebSession($request);

        return response()->json(['data' => 'Logout berhasil']);
    }

    private function requiresPasswordChangeVerification(Request $request): bool
    {
        $profile = $this->profile($request);
        $role = strtolower((string) ($profile->role ?? ''));

        return in_array($role, ['guru', 'siswa'], true);
    }

    private function shouldBypassSensitiveActionVerification(
        Request $request,
        User $user,
        ?Profile $profile = null,
        bool $emailChanged = false,
        ?string $targetEmail = null
    ): bool {
        if (! $this->requiresPasswordChangeVerification($request)) {
            return true;
        }

        $resolvedProfile = $profile ?: $this->profile($request);
        if (! $resolvedProfile) {
            return false;
        }

        $currentEmail = strtolower(trim((string) ($user->email ?? '')));
        if (! $this->isInitialAccountSetupPending($resolvedProfile, $currentEmail)) {
            return false;
        }

        if (! $emailChanged) {
            return true;
        }

        $normalizedTargetEmail = strtolower(trim((string) $targetEmail));

        return ! $this->hasRealLoginEmail($normalizedTargetEmail);
    }

    private function consumePasswordChangeVerificationCode(
        Request $request,
        User $user,
        string $code,
        ?string $expectedEmail = null,
        bool $emailChanged = false,
        ?Profile $profile = null
    ) {
        if (! $this->requiresPasswordChangeVerification($request)) {
            return null;
        }

        if ($this->shouldBypassSensitiveActionVerification($request, $user, $profile, $emailChanged, $expectedEmail)) {
            return null;
        }

        if (! Schema::hasTable('password_change_verifications')) {
            return response()->json([
                'error' => 'Fitur verifikasi password belum aktif. Jalankan migrasi terbaru terlebih dahulu.',
            ], 503);
        }

        $normalizedCode = trim($code);
        if (! preg_match('/^\d{6}$/', $normalizedCode)) {
            return response()->json([
                'error' => 'Kode verifikasi 6 digit wajib diisi.',
            ], 422);
        }

        $result = DB::transaction(function () use ($user, $normalizedCode, $expectedEmail) {
            $record = DB::table('password_change_verifications')
                ->where('user_id', (string) $user->id)
                ->whereNull('used_at')
                ->orderByDesc('created_at')
                ->lockForUpdate()
                ->first();

            if (! $record) {
                return [
                    'ok' => false,
                    'status' => 422,
                    'message' => 'Kode verifikasi belum dibuat. Klik "Kirim Kode Verifikasi" terlebih dahulu.',
                ];
            }

            $now = now();
            $expiresAt = $record->expires_at ? now()->parse($record->expires_at) : null;
            if (! $expiresAt || $now->greaterThan($expiresAt)) {
                DB::table('password_change_verifications')
                    ->where('id', $record->id)
                    ->update([
                        'used_at' => $now,
                        'updated_at' => $now,
                    ]);

                return [
                    'ok' => false,
                    'status' => 422,
                    'message' => 'Kode verifikasi sudah kedaluwarsa. Silakan kirim ulang.',
                ];
            }

            $attemptCount = (int) ($record->attempt_count ?? 0);
            if ($attemptCount >= self::PASSWORD_CHANGE_CODE_MAX_ATTEMPTS) {
                DB::table('password_change_verifications')
                    ->where('id', $record->id)
                    ->update([
                        'used_at' => $now,
                        'updated_at' => $now,
                    ]);

                return [
                    'ok' => false,
                    'status' => 429,
                    'message' => 'Kode verifikasi sudah terlalu sering salah. Kirim ulang kode baru.',
                ];
            }

            $recordEmail = $this->passwordChangeVerificationsSupportsTargetEmail()
                ? strtolower(trim((string) ($record->target_email ?? '')))
                : '';
            $expected = strtolower(trim((string) $expectedEmail));
            if ($expected !== '' && $recordEmail !== '' && $recordEmail !== $expected) {
                return [
                    'ok' => false,
                    'status' => 422,
                    'message' => 'Kode verifikasi dibuat untuk email lain. Kirim ulang kode untuk email saat ini.',
                ];
            }

            if (! Hash::check($normalizedCode, (string) ($record->code_hash ?? ''))) {
                $nextAttempt = $attemptCount + 1;
                $updatePayload = [
                    'attempt_count' => $nextAttempt,
                    'updated_at' => $now,
                ];
                if ($nextAttempt >= self::PASSWORD_CHANGE_CODE_MAX_ATTEMPTS) {
                    $updatePayload['used_at'] = $now;
                }

                DB::table('password_change_verifications')
                    ->where('id', $record->id)
                    ->update($updatePayload);

                return [
                    'ok' => false,
                    'status' => 422,
                    'message' => 'Kode verifikasi tidak valid.',
                ];
            }

            DB::table('password_change_verifications')
                ->where('id', $record->id)
                ->update([
                    'used_at' => $now,
                    'updated_at' => $now,
                ]);

            return ['ok' => true];
        });

        if (! ($result['ok'] ?? false)) {
            return response()->json([
                'error' => (string) ($result['message'] ?? 'Verifikasi kode gagal.'),
            ], (int) ($result['status'] ?? 422));
        }

        return null;
    }

    private function hasGoogleLinkedAccount(User $user): bool
    {
        return trim((string) ($user->google_id ?? '')) !== ''
            || trim((string) ($user->google_email ?? '')) !== ''
            || $user->google_linked_at !== null;
    }

    private function shouldRequireGoogleUnlinkBeforeEmailChange(
        User $user,
        string $currentEmail,
        string $targetEmail
    ): bool {
        $normalizedCurrentEmail = strtolower(trim($currentEmail));
        $normalizedTargetEmail = strtolower(trim($targetEmail));

        if (
            $normalizedCurrentEmail === ''
            || $normalizedTargetEmail === ''
            || $normalizedCurrentEmail === $normalizedTargetEmail
        ) {
            return false;
        }

        if (! $this->hasGoogleLinkedAccount($user)) {
            return false;
        }

        return $this->hasRealLoginEmail($normalizedCurrentEmail);
    }

    private function passwordChangeVerificationsSupportsTargetEmail(): bool
    {
        return Schema::hasTable('password_change_verifications')
            && Schema::hasColumn('password_change_verifications', 'target_email');
    }

    private function maskEmail(string $email): string
    {
        $value = strtolower(trim($email));
        if (! str_contains($value, '@')) {
            return $value;
        }

        [$local, $domain] = explode('@', $value, 2);
        $localLen = strlen($local);
        if ($localLen <= 2) {
            $maskedLocal = substr($local, 0, 1).'*';
        } else {
            $maskedLocal = substr($local, 0, 2).str_repeat('*', max(2, $localLen - 2));
        }

        return $maskedLocal.'@'.$domain;
    }

    private function logoutWebSession(Request $request): void
    {
        try {
            $guard = Auth::guard('web');
            if ($guard instanceof StatefulGuard) {
                $guard->logout();
            }
        } catch (\Throwable $e) {
            // keep request flow safe for deployments that resolve request guard only
        }

        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }
    }

    private function frontendAuthUrl(string $path, array $query = [], ?Request $request = null): string
    {
        $base = $this->safeFrontendBaseUrl($request);
        $suffix = '/'.ltrim($path, '/');
        $qs = http_build_query($query);

        return $qs !== '' ? "{$base}{$suffix}?{$qs}" : "{$base}{$suffix}";
    }

    private function safeFrontendBaseUrl(?Request $request = null): string
    {
        if ($request) {
            $requestBase = $this->resolveFrontendBaseFromRequest($request);
            if ($requestBase !== null) {
                return $requestBase;
            }
        }

        $candidates = [
            (string) config('app.frontend_url', ''),
            (string) config('app.url', ''),
        ];

        foreach ($candidates as $candidate) {
            $candidate = trim($candidate);
            if ($candidate === '') {
                continue;
            }

            $parts = parse_url($candidate);
            if (! is_array($parts)) {
                continue;
            }

            $scheme = strtolower((string) ($parts['scheme'] ?? ''));
            $host = strtolower(trim((string) ($parts['host'] ?? '')));
            if ($host === '' || ! in_array($scheme, ['http', 'https'], true)) {
                continue;
            }
            if (! $this->isAllowedFrontendHost($host)) {
                continue;
            }

            $port = isset($parts['port']) ? ':'.((int) $parts['port']) : '';
            $safeBase = $scheme.'://'.$host.$port;
            $basePath = trim((string) ($parts['path'] ?? ''));
            if ($basePath !== '' && $basePath !== '/') {
                $safeBase .= '/'.trim($basePath, '/');
            }

            return rtrim($safeBase, '/');
        }

        return 'http://localhost:5173';
    }

    private function isAllowedFrontendHost(string $host): bool
    {
        $normalizedHost = strtolower(trim($host));
        if ($normalizedHost === '') {
            return false;
        }

        if (
            $normalizedHost === 'localhost'
            || $normalizedHost === '127.0.0.1'
            || str_ends_with($normalizedHost, '.localhost')
        ) {
            return true;
        }

        $root = strtolower(trim((string) config('tenancy.root_domain', '')));
        if ($root !== '' && ($normalizedHost === $root || str_ends_with($normalizedHost, '.'.$root))) {
            return true;
        }

        if ($this->tenantDomainService->isAdminHost($normalizedHost)) {
            return true;
        }

        if ($this->tenantDomainService->resolveTenantForHost($normalizedHost)) {
            return true;
        }

        $candidateHosts = [];
        foreach ([
            (string) config('app.frontend_url', ''),
            (string) config('app.url', ''),
        ] as $candidate) {
            $parts = parse_url(trim($candidate));
            if (! is_array($parts)) {
                continue;
            }

            $configuredHost = strtolower(trim((string) ($parts['host'] ?? '')));
            if ($configuredHost !== '') {
                $candidateHosts[] = $configuredHost;
            }
        }

        foreach ((array) config('tenancy.admin_hosts', []) as $adminHost) {
            $normalizedAdminHost = strtolower(trim((string) $adminHost));
            if ($normalizedAdminHost !== '') {
                $candidateHosts[] = $normalizedAdminHost;
            }
        }

        return in_array($normalizedHost, array_values(array_unique($candidateHosts)), true);
    }

    private function resolveFrontendBaseFromRequest(Request $request): ?string
    {
        $schemeSource = trim((string) $request->headers->get('X-Forwarded-Proto', (string) $request->getScheme()));
        $schemeParts = array_values(array_filter(array_map('trim', explode(',', $schemeSource))));
        $scheme = strtolower((string) ($schemeParts[0] ?? ''));
        if (! in_array($scheme, ['http', 'https'], true)) {
            $scheme = 'https';
        }

        $hostCandidates = [
            (string) $request->headers->get('X-Forwarded-Host', ''),
            (string) $request->headers->get('Host', ''),
        ];

        foreach ($hostCandidates as $candidate) {
            $value = trim($candidate);
            if ($value === '') {
                continue;
            }

            $parts = array_values(array_filter(array_map('trim', explode(',', $value))));
            $hostPort = (string) ($parts[0] ?? '');
            if ($hostPort === '') {
                continue;
            }

            $parsed = parse_url('http://'.$hostPort);
            if (! is_array($parsed)) {
                continue;
            }

            $host = strtolower(trim((string) ($parsed['host'] ?? '')));
            if ($host === '' || ! $this->isAllowedFrontendHost($host)) {
                continue;
            }

            $port = isset($parsed['port']) ? ':'.((int) $parsed['port']) : '';

            return rtrim($scheme.'://'.$host.$port, '/');
        }

        $requestBase = trim((string) $request->getSchemeAndHttpHost());
        $requestParts = parse_url($requestBase);
        $requestHost = is_array($requestParts)
            ? strtolower(trim((string) ($requestParts['host'] ?? '')))
            : '';
        if ($requestHost !== '' && $this->isAllowedFrontendHost($requestHost)) {
            if ($requestBase !== '' && is_array($requestParts)) {
                $requestScheme = strtolower(trim((string) ($requestParts['scheme'] ?? '')));
                if (in_array($requestScheme, ['http', 'https'], true)) {
                    return rtrim($requestBase, '/');
                }
            }
        }

        return null;
    }

    private function passwordResetEligibility(string $email): array
    {
        $normalizedEmail = strtolower(trim($email));

        if ($this->isReservedSuperAdminEmail($normalizedEmail)) {
            return [
                'allowed' => false,
                'message' => 'Reset password untuk akun super admin dinonaktifkan',
            ];
        }

        $userId = (string) User::query()
            ->whereRaw('lower(email) = ?', [$normalizedEmail])
            ->value('id');

        if ($userId === '') {
            return ['allowed' => true];
        }

        $role = (string) Profile::query()
            ->where('id', $userId)
            ->value('role');

        if (strtolower($role) === 'admin') {
            return [
                'allowed' => false,
                'message' => 'Reset password untuk akun admin dinonaktifkan. Hubungi super admin.',
            ];
        }

        return ['allowed' => true];
    }

    private function passwordResetRequestAcceptedMessage(): string
    {
        return 'Jika email terdaftar dan memenuhi syarat, link reset password akan dikirim.';
    }

    private function passwordResetFailureMessage(): string
    {
        return 'Token reset tidak valid, sudah kedaluwarsa, atau akun tidak memenuhi syarat untuk reset mandiri.';
    }

    private function isReservedSuperAdminEmail(string $email): bool
    {
        $normalizedEmail = strtolower(trim($email));
        if ($normalizedEmail === '') {
            return false;
        }

        $envEmails = array_map('strtolower', config('superadmin.emails', []));
        if (in_array($normalizedEmail, $envEmails, true)) {
            return true;
        }

        try {
            $exists = DB::table('super_admins as s')
                ->join('users as u', 'u.id', '=', 's.user_id')
                ->whereRaw('lower(u.email) = ?', [$normalizedEmail])
                ->exists();

            if ($exists) {
                return true;
            }
        } catch (\Throwable $e) {
            // fallback ke env bila tabel belum ada
        }

        return false;
    }

    /* ========== Email Verification via 6-digit OTP ========== */

    public function sendEmailVerificationCode(Request $request)
    {
        return response()->json([
            'error' => 'Verifikasi email 6 digit sudah dinonaktifkan. Kode 6 digit sekarang dipakai saat mengganti email atau password akun.',
        ], 410);
    }

    public function verifyEmailCode(Request $request)
    {
        return response()->json([
            'error' => 'Verifikasi email 6 digit sudah dinonaktifkan. Kode 6 digit sekarang dipakai saat mengganti email atau password akun.',
        ], 410);
    }
}
