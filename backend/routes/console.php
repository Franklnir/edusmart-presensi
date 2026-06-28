<?php

use App\Jobs\QuizWorkerHeartbeatJob;
use App\Models\Profile;
use App\Models\User;
use App\Services\Backup\TenantBackupService;
use App\Services\Quiz\QuizScoringService;
use App\Services\Rfid\MqttBridgeService;
use App\Services\Rfid\RfidDeviceService;
use App\Services\Rfid\TenantMqttConfigService;
use App\Services\Storage\StorageManagementService;
use App\Services\WhatsApp\WhatsAppIntegrationService;
use App\Services\WhatsApp\WhatsAppNotificationService;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
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

Schedule::call(function (): void {
    Cache::put('scheduler:last-heartbeat', now()->toISOString(), now()->addMinutes(10));
})
    ->name('scheduler:heartbeat')
    ->everyMinute()
    ->onOneServer();

Schedule::command('horizon:snapshot')
    ->everyFiveMinutes()
    ->onOneServer();

Schedule::command('backup:monthly-google-drive')
    ->dailyAt((string) config('backup.monthly_auto_start_time', '21:30'))
    ->timezone('Asia/Jakarta')
    ->withoutOverlapping(30)
    ->onOneServer();

Schedule::command('google-drive:health-check --recover')
    ->dailyAt('21:15')
    ->timezone('Asia/Jakarta')
    ->withoutOverlapping(30)
    ->onOneServer();

Artisan::command('backup:verify-monthly {--tenant=} {--month=}', function () {
    /** @var TenantBackupService $service */
    $service = app(TenantBackupService::class);
    $tenantFilter = trim((string) ($this->option('tenant') ?: ''));
    $monthFilter = trim((string) ($this->option('month') ?: ''));
    $tenantIds = $tenantFilter !== ''
        ? [$tenantFilter]
        : $service->tenantsEligibleForMonthlyBackup();

    if (empty($tenantIds)) {
        $this->warn('Tidak ada tenant yang Google Drive-nya aktif.');

        return 1;
    }

    $warning = 0;
    foreach ($tenantIds as $tenantId) {
        $resolvedTenantId = trim((string) $tenantId);
        if ($tenantFilter !== '') {
            $tenant = DB::table('tenants')
                ->where('id', $tenantFilter)
                ->orWhere('slug', $tenantFilter)
                ->first(['id']);
            $resolvedTenantId = (string) ($tenant->id ?? $tenantFilter);
        }

        $status = $service->monthlyStatus($resolvedTenantId, true);
        $tenantName = (string) data_get($status, 'tenant.name', $resolvedTenantId);
        $months = array_values((array) data_get($status, 'months', []));
        if ($monthFilter !== '') {
            $months = array_values(array_filter($months, fn ($month) => (string) ($month['key'] ?? '') === $monthFilter));
        }

        $this->line('Tenant: '.$tenantName);
        foreach ($months as $month) {
            $state = (string) ($month['status'] ?? 'unknown');
            $label = (string) ($month['label'] ?? $month['key'] ?? '-');
            $this->line(sprintf(
                ' - %s: %s%s',
                $label,
                $state,
                (bool) ($month['has_new_data'] ?? false) ? ' (ada data baru)' : ''
            ));
            if (in_array($state, ['pending', 'needs_update'], true)) {
                $warning++;
            }
        }
    }

    if ($warning > 0) {
        $this->warn("Ada {$warning} bulan yang belum aman / perlu update.");

        return 1;
    }

    $this->info('Backup bulanan terverifikasi.');

    return 0;
})->purpose('Memverifikasi status backup bulanan Google Drive tenant.');

Schedule::job(new QuizWorkerHeartbeatJob, (string) config('quiz.scoring_queue', 'quiz-scoring'))
    ->everyMinute()
    ->onOneServer();

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

Schedule::call(function (WhatsAppNotificationService $notificationService) {
    $notificationService->queueDailyAlphaWarnings();
})
    ->name('whatsapp:daily-alpha-warnings')
    ->everyFiveMinutes()
    ->between('12:00', '23:00')
    ->withoutOverlapping();

Schedule::call(function (WhatsAppNotificationService $notificationService) {
    $notificationService->retryFailedMessages();
})
    ->name('whatsapp:retry-failed')
    ->everyFiveMinutes()
    ->between('07:00', '22:00')
    ->withoutOverlapping();

Artisan::command('whatsapp:daily-alpha-warnings {--tenant= : Batasi tenant tertentu} {--date= : Tanggal YYYY-MM-DD} {--limit= : Maksimal pesan}', function (WhatsAppNotificationService $notificationService) {
    $summary = $notificationService->queueDailyAlphaWarnings(
        $this->option('tenant') ?: null,
        $this->option('date') ?: null,
        $this->option('limit') ? (int) $this->option('limit') : null
    );

    $this->info('Cek peringatan Alpha harian selesai.');
    $this->line('Tenant          : '.($summary['tenants'] ?? 0));
    $this->line('Siswa dicek     : '.($summary['students_checked'] ?? 0));
    $this->line('Siswa Alpha     : '.($summary['alpha_students'] ?? 0));
    $this->line('Antrean baru    : '.($summary['queued'] ?? 0));
    $this->line('Dilewati/dedupe : '.($summary['skipped'] ?? 0));
    $this->line('Siap kirim      : '.(($summary['ready'] ?? false) ? 'Ya' : 'Belum'));
    $this->line('Alasan          : '.($summary['reason'] ?? '-'));
    $this->line('Coba lagi       : '.($summary['next_run_at'] ?? '-'));
    $this->line('Batas kirim     : '.($summary['send_until'] ?? '-'));

    return 0;
})->purpose('Kirim satu ringkasan WhatsApp Alpha per siswa per hari');

Artisan::command('whatsapp:retry-failed {--limit= : Maksimal pesan}', function (WhatsAppNotificationService $notificationService) {
    $summary = $notificationService->retryFailedMessages($this->option('limit') ? (int) $this->option('limit') : null);

    $this->info('Retry pesan WhatsApp gagal selesai.');
    $this->line('Dicek  : '.($summary['checked'] ?? 0));
    $this->line('Retry  : '.($summary['retried'] ?? 0));

    return 0;
})->purpose('Retry otomatis pesan WhatsApp gagal tanpa membuat log dobel');

Schedule::call(function (StorageManagementService $storageManagementService) {
    $storageManagementService->purgeExpiredTrash();
})
    ->name('storage:purge-expired-trash')
    ->dailyAt('02:20')
    ->withoutOverlapping();

Schedule::call(function (StorageManagementService $storageManagementService) {
    $storageManagementService->syncObjectStorageInventory(null, ['max_pages' => 10]);
})
    ->name('storage:sync-object-storage')
    ->hourly()
    ->withoutOverlapping();

Artisan::command('storage:purge-expired-trash', function (StorageManagementService $storageManagementService) {
    $result = $storageManagementService->purgeExpiredTrash();

    $this->info('Trash storage kedaluwarsa berhasil diproses.');
    $this->line('File  : '.($result['files'] ?? 0));
    $this->line('Ukuran: '.($result['bytes_label'] ?? '0 B'));

    return 0;
})->purpose('Hapus permanen file storage yang sudah lebih dari 30 hari di Trash');

Artisan::command('storage:sync-object-storage {--bucket= : Batasi scan ke logical bucket tertentu} {--max-pages=10 : Maksimal halaman per bucket}', function (StorageManagementService $storageManagementService) {
    $result = $storageManagementService->syncObjectStorageInventory(null, [
        'bucket' => $this->option('bucket'),
        'max_pages' => (int) $this->option('max-pages'),
    ]);

    if (! ($result['ok'] ?? false)) {
        $this->warn($result['message'] ?? 'Sync Neva Cloud S3 gagal.');

        return 1;
    }

    $this->info('Sync Neva Cloud S3 selesai.');
    $this->line('Total      : '.($result['total_label'] ?? '0 B').' / '.($result['total_files'] ?? 0).' object');
    $this->line('Terlacak   : '.($result['tracked_label'] ?? '0 B').' / '.($result['tracked_files'] ?? 0).' object');
    $this->line('Belum track: '.($result['untracked_label'] ?? '0 B').' / '.($result['untracked_files'] ?? 0).' object');

    foreach (($result['buckets'] ?? []) as $bucket) {
        $this->line('- '.$bucket['logical_bucket'].': '.$bucket['total_label'].' (untracked '.$bucket['untracked_label'].')');
    }

    return 0;
})->purpose('Baca bucket Neva Cloud S3 dan simpan snapshot inventory platform');

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
