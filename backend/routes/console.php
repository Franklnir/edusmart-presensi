<?php

use App\Models\Profile;
use App\Models\User;
use App\Services\Quiz\QuizScoringService;
use App\Services\Rfid\MqttBridgeService;
use App\Services\Rfid\RfidDeviceService;
use App\Services\Rfid\TenantMqttConfigService;
use App\Services\WhatsApp\WhatsAppIntegrationService;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schedule;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password as PasswordRule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('super-admin:bootstrap {--force-password : Reset password user yang sudah ada}', function () {
    $email = strtolower(trim((string) env('SUPER_ADMIN_BOOTSTRAP_EMAIL', '')));
    if ($email === '') {
        $emails = array_values(array_filter(array_map(
            static fn ($item) => strtolower(trim((string) $item)),
            (array) config('superadmin.emails', [])
        )));
        $email = (string) ($emails[0] ?? '');
    }

    if ($email === '') {
        $this->warn('SUPER_ADMIN_EMAILS belum diisi; bootstrap super admin dilewati.');

        return 0;
    }

    if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $this->error('Email bootstrap super admin tidak valid.');

        return 1;
    }

    $password = (string) env('SUPER_ADMIN_BOOTSTRAP_PASSWORD', '');
    $name = trim((string) env('SUPER_ADMIN_BOOTSTRAP_NAME', 'Super Admin'));
    if ($name === '') {
        $name = 'Super Admin';
    }

    $tenantSlug = strtolower(trim((string) env(
        'SUPER_ADMIN_BOOTSTRAP_TENANT_SLUG',
        (string) config('tenancy.default_slug', 'default')
    )));
    if ($tenantSlug === '') {
        $tenantSlug = 'default';
    }

    $forcedId = trim((string) env('SUPER_ADMIN_BOOTSTRAP_ID', ''));
    if ($forcedId === '') {
        $ids = array_values(array_filter(array_map(
            static fn ($item) => trim((string) $item),
            (array) config('superadmin.ids', [])
        )));
        $forcedId = (string) ($ids[0] ?? '');
    }
    if ($forcedId !== '' && ! Str::isUuid($forcedId)) {
        $this->error('SUPER_ADMIN_BOOTSTRAP_ID / SUPER_ADMIN_IDS harus berupa UUID valid.');

        return 1;
    }

    $forcePassword = (bool) $this->option('force-password')
        || filter_var(env('SUPER_ADMIN_BOOTSTRAP_FORCE', false), FILTER_VALIDATE_BOOL);

    $tenant = DB::table('tenants')->where('slug', $tenantSlug)->first(['id', 'name', 'slug']);
    if (! $tenant) {
        $this->error("Tenant '{$tenantSlug}' tidak ditemukan. Jalankan migrasi terlebih dahulu.");

        return 1;
    }

    $existingUser = null;
    if ($forcedId !== '') {
        $existingUser = User::query()->where('id', $forcedId)->first();
    }
    if (! $existingUser) {
        $existingUser = User::query()->whereRaw('lower(email) = ?', [$email])->first();
    }

    $mustSetPassword = ! $existingUser || $forcePassword;
    if ($mustSetPassword) {
        if ($password === '') {
            $this->error('SUPER_ADMIN_BOOTSTRAP_PASSWORD wajib diisi untuk membuat/reset user bootstrap.');

            return 1;
        }

        $validator = Validator::make(
            ['password' => $password],
            ['password' => ['required', 'string', PasswordRule::defaults()]]
        );
        if ($validator->fails()) {
            $this->error($validator->errors()->first());

            return 1;
        }
    }

    try {
        DB::transaction(function () use ($email, $password, $name, $tenant, $forcedId, $existingUser, $forcePassword): void {
            $now = now();
            $user = $existingUser;

            if (! $user) {
                $user = User::query()->create([
                    'id' => $forcedId !== '' ? $forcedId : (string) Str::uuid(),
                    'name' => $name,
                    'email' => $email,
                    'password' => Hash::make($password),
                    'email_verified_at' => $now,
                ]);
            } else {
                $updates = [
                    'name' => $name,
                    'email' => $email,
                    'email_verified_at' => $user->email_verified_at ?: $now,
                    'updated_at' => $now,
                ];
                if ($forcePassword) {
                    $updates['password'] = Hash::make($password);
                }
                $user->forceFill($updates)->save();
            }

            $profile = Profile::query()->where('id', $user->id)->first();
            if ($profile && (string) $profile->tenant_id !== (string) $tenant->id) {
                throw new RuntimeException('User bootstrap sudah terdaftar di tenant lain.');
            }
            if ($profile && strtolower((string) $profile->role) !== 'admin') {
                throw new RuntimeException('User bootstrap sudah terdaftar sebagai non-admin.');
            }

            if (! $profile) {
                Profile::query()->create([
                    'id' => (string) $user->id,
                    'tenant_id' => (string) $tenant->id,
                    'email' => $email,
                    'nama' => $name,
                    'role' => 'admin',
                    'status' => 'active',
                    'must_change_password' => false,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            } else {
                $profile->fill([
                    'email' => $email,
                    'nama' => $name,
                    'role' => 'admin',
                    'status' => 'active',
                    'must_change_password' => false,
                    'updated_at' => $now,
                ])->save();
            }

            $adminPayload = ['id' => (string) $user->id, 'created_at' => $now];
            if (Schema::hasColumn('admin_users', 'tenant_id')) {
                $adminPayload['tenant_id'] = (string) $tenant->id;
            }
            if (! DB::table('admin_users')->where('id', $user->id)->exists()) {
                DB::table('admin_users')->insert($adminPayload);
            } elseif (isset($adminPayload['tenant_id'])) {
                DB::table('admin_users')->where('id', $user->id)->update([
                    'tenant_id' => (string) $tenant->id,
                ]);
            }

            $superAdmin = DB::table('super_admins')
                ->where('user_id', $user->id)
                ->orWhereRaw('lower(email) = ?', [$email])
                ->first();
            if (! $superAdmin) {
                DB::table('super_admins')->insert([
                    'id' => (string) Str::uuid(),
                    'user_id' => (string) $user->id,
                    'email' => $email,
                    'name' => $name,
                    'created_at' => $now,
                ]);
            } else {
                DB::table('super_admins')->where('id', $superAdmin->id)->update([
                    'user_id' => (string) $user->id,
                    'email' => $email,
                    'name' => $name,
                ]);
            }

            if (Schema::hasTable('settings') && Schema::hasColumn('settings', 'tenant_id')) {
                $settings = DB::table('settings')->where('tenant_id', $tenant->id)->orderBy('id')->first(['id']);
                if (! $settings) {
                    DB::table('settings')->insert([
                        'tenant_id' => (string) $tenant->id,
                        'nama_sekolah' => (string) ($tenant->name ?? 'EduSmart'),
                        'email' => $email,
                        'registrasi_siswa_aktif' => true,
                        'registrasi_guru_aktif' => false,
                        'registrasi_admin_aktif' => false,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]);
                    $settings = DB::table('settings')->where('tenant_id', $tenant->id)->orderBy('id')->first(['id']);
                }

                if ($settings && Schema::hasColumn('settings', 'approval_primary_admin_id')) {
                    DB::table('settings')->where('id', $settings->id)->update([
                        'approval_primary_admin_id' => (string) $user->id,
                        'updated_at' => $now,
                    ]);
                }
            }
        });
    } catch (Throwable $e) {
        $this->error('Bootstrap super admin gagal: '.$e->getMessage());

        return 1;
    }

    $this->info('Super admin bootstrap siap.');
    $this->line('Email  : '.$email);
    $this->line('Tenant : '.$tenantSlug);

    return 0;
})->purpose('Bootstrap super admin utama dari env production tanpa membuka password di log');

Schedule::call(function (QuizScoringService $scoringService) {
    $scoringService->finalizeExpiredSubmissions();
})
    ->name('quiz:auto-finalize-expired')
    ->everyMinute()
    ->withoutOverlapping();

Schedule::call(function (WhatsAppIntegrationService $integrationService) {
    if (! $integrationService->providerConfigured()) {
        return;
    }

    $integrationService->syncAll();
})
    ->name('whatsapp:sync-integrations')
    ->everyMinute()
    ->withoutOverlapping();

Artisan::command('rfid:mqtt-bridge {--once : Jalankan sekali lalu keluar} {--tenant=* : Batasi publish mode ke tenant slug tertentu}', function (MqttBridgeService $bridge) {
    $once = (bool) $this->option('once');
    $tenants = array_values(array_filter(array_map(
        fn ($value) => trim((string) $value),
        (array) $this->option('tenant')
    )));

    $this->info('RFID MQTT bridge starting...');
    $bridge->run(
        log: function (string $level, string $message) {
            $line = '['.strtoupper($level).'] '.$message;
            if (in_array($level, ['error'], true)) {
                $this->error($line);

                return;
            }
            if (in_array($level, ['warning'], true)) {
                $this->warn($line);

                return;
            }
            $this->line($line);
        },
        once: $once,
        forcedTenants: $tenants
    );
})->purpose('Bridge MQTT RFID scan dari device ke proses absensi tenant-aware');

Artisan::command('rfid:mosquitto-sync', function (TenantMqttConfigService $configs) {
    try {
        $result = $configs->syncManagedMosquittoFiles();
    } catch (Throwable $e) {
        $this->error('Gagal sync Mosquitto: '.$e->getMessage());

        return 1;
    }

    if (! ($result['synced'] ?? false)) {
        $this->warn((string) ($result['message'] ?? 'Mosquitto tidak disync.'));

        return 0;
    }

    $this->info('Mosquitto password_file dan acl_file berhasil disync.');
    $this->line('Tenant managed : '.(int) ($result['tenant_count'] ?? 0));
    $this->line('Password file  : '.(string) ($result['password_file'] ?? '-'));
    $this->line('ACL file       : '.(string) ($result['acl_file'] ?? '-'));

    return 0;
})->purpose('Generate ulang password_file dan acl_file Mosquitto untuk MQTT RFID multi tenant');

Artisan::command('rfid:device-register {tenant : Tenant slug} {device_id : Device ID unik} {--name= : Nama device yang tampil di dashboard/ops} {--secret= : Secret device RFID. Jika kosong akan digenerate otomatis} {--transport=mqtt : mqtt|http|hybrid}', function (RfidDeviceService $devices) {
    $result = $devices->registerDevice(
        tenantSlug: (string) $this->argument('tenant'),
        deviceId: (string) $this->argument('device_id'),
        name: $this->option('name') ? (string) $this->option('name') : null,
        transport: (string) $this->option('transport'),
        plainSecret: $this->option('secret') ? (string) $this->option('secret') : null,
    );

    if (! ($result['success'] ?? false)) {
        $this->error((string) ($result['message'] ?? 'Gagal mendaftarkan device RFID'));

        return 1;
    }

    $this->info('Device RFID berhasil didaftarkan.');
    $this->line('Tenant     : '.($result['tenant_slug'] ?? '-'));
    $this->line('Device ID  : '.($result['device_id'] ?? '-'));
    $this->line('Nama       : '.($result['device_name'] ?? '-'));
    $this->line('Transport  : '.($result['transport'] ?? '-'));
    $this->line('Secret     : '.($result['secret'] ?? '-'));
    $this->warn('Simpan secret ini sekarang. Nilainya tidak akan bisa dilihat ulang dari database.');

    return 0;
})->purpose('Daftarkan device RFID tenant-aware dengan secret per-device');

Artisan::command('rfid:device-list {tenant? : Filter tenant slug tertentu}', function (RfidDeviceService $devices) {
    $rows = $devices->listDevices(
        $this->argument('tenant') ? (string) $this->argument('tenant') : null
    );

    if (empty($rows)) {
        $this->warn('Belum ada device RFID yang terdaftar.');

        return 0;
    }

    $this->table(
        ['Tenant', 'Device ID', 'Nama', 'Status', 'Transport', 'HTTP Fallback', 'Last Seen', 'Last IP'],
        array_map(fn (array $row) => [
            $row['tenant_slug'] ?: '-',
            $row['device_id'] ?: '-',
            $row['name'] ?: '-',
            $row['status'] ?: '-',
            $row['transport'] ?: '-',
            $row['fallback_http_enabled'] ? 'yes' : 'no',
            $row['last_seen_at'] ?: '-',
            $row['last_ip'] ?: '-',
        ], $rows)
    );

    return 0;
})->purpose('Lihat daftar device RFID yang terdaftar');

Artisan::command('rfid:device-rotate-secret {device_id : Device ID yang secret-nya akan diganti} {--secret= : Secret baru. Jika kosong akan digenerate otomatis}', function (RfidDeviceService $devices) {
    $result = $devices->rotateSecret(
        deviceId: (string) $this->argument('device_id'),
        plainSecret: $this->option('secret') ? (string) $this->option('secret') : null,
    );

    if (! ($result['success'] ?? false)) {
        $this->error((string) ($result['message'] ?? 'Gagal merotasi secret device RFID'));

        return 1;
    }

    $this->info('Secret device RFID berhasil dirotasi.');
    $this->line('Tenant     : '.($result['tenant_slug'] ?? '-'));
    $this->line('Device ID  : '.($result['device_id'] ?? '-'));
    $this->line('Nama       : '.($result['device_name'] ?? '-'));
    $this->line('Secret     : '.($result['secret'] ?? '-'));
    $this->warn('Simpan secret baru ini sekarang. Nilainya tidak akan bisa dilihat ulang dari database.');

    return 0;
})->purpose('Rotasi secret device RFID tanpa edit database manual');
