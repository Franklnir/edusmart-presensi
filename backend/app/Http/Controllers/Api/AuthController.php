<?php

namespace App\Http\Controllers\Api;

use App\Models\Profile;
use App\Models\User;
use Illuminate\Contracts\Auth\StatefulGuard;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class AuthController extends ApiController
{
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
            ],
        ]);
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

        if (! Auth::attempt($credentials)) {
            $this->registerFailedLoginAttempt($throttleKey);
            $this->logAuthEvent($request, 'login_failed_invalid_credentials', [
                'email' => $email,
                'tenant_id' => $tenantId,
                'host' => $host,
            ]);

            return response()->json(['error' => 'Email/NIS atau password salah'], 401);
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

        if (! $profile->must_change_password) {
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
        if ($host === '') {
            return false;
        }

        $adminHosts = array_map('strtolower', config('tenancy.admin_hosts', []));
        if (in_array($host, $adminHosts, true)) {
            return true;
        }

        $root = strtolower(trim((string) config('tenancy.root_domain', '')));
        $adminSubdomain = strtolower(trim((string) config('tenancy.admin_subdomain', 'admin')));
        $allowRoot = (bool) config('tenancy.allow_root_for_super_admin', false);

        if ($root !== '') {
            $adminHost = $adminSubdomain !== '' ? ($adminSubdomain.'.'.$root) : $root;
            if ($host === $adminHost) {
                return true;
            }
            if ($allowRoot && $host === $root) {
                return true;
            }
        }

        if ($host === $adminSubdomain.'.localhost' || $host === $adminSubdomain.'.127.0.0.1') {
            return true;
        }
        if ($allowRoot && ($host === 'localhost' || $host === '127.0.0.1')) {
            return true;
        }

        return false;
    }

    private function superAdminHostMessage(): string
    {
        $root = strtolower(trim((string) config('tenancy.root_domain', '')));
        $adminSubdomain = strtolower(trim((string) config('tenancy.admin_subdomain', 'admin')));
        if ($root === '') {
            return 'Akun super admin hanya bisa login dari domain admin.';
        }

        $adminHost = $adminSubdomain !== '' ? ($adminSubdomain.'.'.$root) : $root;

        return 'Akun super admin hanya bisa login dari '.$adminHost;
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

    public function register(Request $request)
    {
        $payload = $request->only(['nama', 'email', 'password', 'role']);

        $validator = Validator::make($payload, [
            'nama' => 'required|string|max:120',
            'email' => 'required|email|max:255',
            'password' => 'required|string|min:6',
            'role' => 'required|in:siswa,guru,admin',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        // Security: Rate Limiting untuk mencegah spam registrasi
        $throttleKey = 'auth-register|'.$request->ip();
        if (RateLimiter::tooManyAttempts($throttleKey, 5)) {
            $seconds = RateLimiter::availableIn($throttleKey);

            return response()->json(['error' => "Terlalu banyak percobaan registrasi. Coba lagi dalam {$seconds} detik."], 429);
        }
        RateLimiter::hit($throttleKey, 600); // Decay 10 menit

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['error' => 'Tenant tidak valid'], 400);
        }

        $email = strtolower(trim($payload['email']));
        $role = $payload['role'];

        if ($this->isReservedSuperAdminEmail($email)) {
            return response()->json(['error' => 'Email ini tidak bisa digunakan untuk registrasi'], 403);
        }

        $allowAdminCreate = $this->isAdmin($request);
        if (! $allowAdminCreate) {
            $settings = DB::table('settings')->where('tenant_id', $tenantId)->orderBy('id')->first();
            $allow = $role !== 'admin';
            if ($role === 'siswa' && $settings && isset($settings->registrasi_siswa_aktif)) {
                $allow = (bool) $settings->registrasi_siswa_aktif;
            }
            if ($role === 'guru' && $settings && isset($settings->registrasi_guru_aktif)) {
                $allow = (bool) $settings->registrasi_guru_aktif;
            }
            if ($role === 'admin' && $settings && isset($settings->registrasi_admin_aktif)) {
                $allow = (bool) $settings->registrasi_admin_aktif;
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
        DB::transaction(function () use ($userId, $email, $payload, $role, $tenantId, &$result) {
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
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $result = ['user' => $user, 'profile' => $profile];
        });

        try {
            $result['user']?->sendEmailVerificationNotification();
        } catch (\Throwable $e) {
            // jangan gagalkan register jika SMTP bermasalah
        }

        return response()->json(['data' => $result], 201);
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
        if ($this->isReservedSuperAdminEmail($email)) {
            return response()->json(['error' => 'Reset password untuk akun super admin dinonaktifkan'], 403);
        }

        try {
            $status = Password::sendResetLink(['email' => $email]);
        } catch (\Throwable $e) {
            report($e);

            return response()->json([
                'error' => 'Layanan email sedang bermasalah. Coba lagi beberapa menit.',
            ], 503);
        }

        if ($status !== Password::RESET_LINK_SENT) {
            return response()->json(['error' => __($status)], 400);
        }

        RateLimiter::clear($throttleKey);

        return response()->json(['data' => 'Link reset password dikirim']);
    }

    public function resetPassword(Request $request)
    {
        $payload = $request->only(['email', 'token', 'password', 'password_confirmation']);

        $validator = Validator::make($payload, [
            'email' => 'required|email',
            'token' => 'required|string',
            'password' => 'required|string|min:6|confirmed',
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
        if ($this->isReservedSuperAdminEmail($email)) {
            return response()->json(['error' => 'Reset password untuk akun super admin dinonaktifkan'], 403);
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
            return response()->json(['error' => __($status)], 400);
        }

        return response()->json(['data' => 'Password berhasil diubah']);
    }

    public function updatePassword(Request $request)
    {
        $payload = $request->only(['password', 'password_confirmation']);
        $validator = Validator::make($payload, [
            'password' => 'required|string|min:6|confirmed',
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

        $user->forceFill(['password' => Hash::make($payload['password'])])->save();

        // Security: Logout perangkat lain, tapi biarkan perangkat ini tetap login
        if (method_exists($user, 'tokens')) {
            $user->tokens()->where('id', '!=', $user->currentAccessToken()->id ?? null)->delete();
        }

        return response()->json(['data' => 'Password berhasil diubah']);
    }

    public function updateAccount(Request $request)
    {
        $payload = $request->only(['email', 'password', 'password_confirmation']);
        $validator = Validator::make($payload, [
            'email' => 'required|email',
            'password' => 'required|string|min:6|confirmed',
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

        $email = strtolower(trim($payload['email']));

        if ($this->isReservedSuperAdminEmail($email)) {
            return response()->json(['error' => 'Email ini tidak bisa digunakan'], 403);
        }

        if (User::query()->where('email', $email)->where('id', '!=', $user->id)->exists()) {
            return response()->json(['error' => 'Email sudah terdaftar'], 409);
        }

        DB::transaction(function () use ($user, $email, $payload, $tenantId) {
            $user->forceFill([
                'email' => $email,
                'password' => Hash::make($payload['password']),
            ])->save();

            Profile::query()->where('id', $user->id)->where('tenant_id', $tenantId)->update([
                'email' => $email,
                'must_change_password' => false,
                'updated_at' => now(),
            ]);

            // Security: Jika password berubah, logout perangkat lain
            if (method_exists($user, 'tokens')) {
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
            ]));
        }

        $user = User::query()->find($id);
        if (! $user) {
            return redirect()->away($this->frontendAuthUrl('/login', [
                'verified' => 'invalid',
            ]));
        }

        $expectedHash = sha1((string) $user->getEmailForVerification());
        if (! hash_equals($expectedHash, (string) $hash)) {
            return redirect()->away($this->frontendAuthUrl('/login', [
                'verified' => 'invalid',
            ]));
        }

        if (! $user->hasVerifiedEmail()) {
            $user->markEmailAsVerified();
        }

        return redirect()->away($this->frontendAuthUrl('/login', [
            'verified' => 'success',
        ]));
    }

    public function logout(Request $request)
    {
        $this->logoutWebSession($request);

        return response()->json(['data' => 'Logout berhasil']);
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

    private function frontendAuthUrl(string $path, array $query = []): string
    {
        $base = $this->safeFrontendBaseUrl();
        $suffix = '/'.ltrim($path, '/');
        $qs = http_build_query($query);

        return $qs !== '' ? "{$base}{$suffix}?{$qs}" : "{$base}{$suffix}";
    }

    private function safeFrontendBaseUrl(): string
    {
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
            $host = trim((string) ($parts['host'] ?? ''));
            if ($host === '' || ! in_array($scheme, ['http', 'https'], true)) {
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
}
