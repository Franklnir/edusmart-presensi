<?php

use App\Services\Quiz\QuizScoringService;
use App\Services\Rfid\MqttBridgeService;
use App\Services\Rfid\RfidDeviceService;
use App\Services\Rfid\TenantMqttConfigService;
use App\Services\WhatsApp\WhatsAppIntegrationService;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

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
