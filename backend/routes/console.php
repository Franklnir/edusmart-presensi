<?php

use App\Services\Rfid\MqttBridgeService;
use App\Services\Quiz\QuizScoringService;
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
