<?php

namespace App\Jobs;

use App\Models\WhatsAppMessageLog;
use App\Services\WhatsApp\WhatsAppIntegrationService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Cache;

class SendWhatsAppMessageJob implements ShouldQueue
{
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public int $tries = 3;

    public array $backoff = [15, 60, 180];

    public function __construct(
        public readonly string $logId
    ) {}

    public function tags(): array
    {
        return [
            'whatsapp',
            'whatsapp-log:'.$this->logId,
        ];
    }

    public function handle(WhatsAppIntegrationService $integrationService): void
    {
        $log = WhatsAppMessageLog::query()->find($this->logId);
        if (! $log || $log->status === 'sent') {
            return;
        }

        if (! $integrationService->providerConfigured()) {
            $log->fill([
                'status' => 'failed',
                'failed_at' => now(),
                'last_error' => 'Konfigurasi gateway WhatsApp pusat belum lengkap.',
            ])->save();

            return;
        }

        if (! $log->message_text || ! $log->normalized_phone) {
            $log->fill([
                'status' => 'skipped',
                'last_error' => 'Payload pesan tidak lengkap.',
            ])->save();

            return;
        }

        if (
            $log->category === 'attendance_alpha_daily'
            && now('Asia/Jakarta')->hour >= (int) config('services.whatsapp.daily_alpha_fast_max_send_hour', 23)
        ) {
            $log->fill([
                'status' => 'failed',
                'failed_at' => now(),
                'last_error' => 'Jendela pengiriman Alpha hari ini sudah lewat.',
            ])->save();

            return;
        }

        $integration = $integrationService
            ->senderIntegrationForTenant((string) $log->tenant_id)
            ->fresh();

        if ($integrationService->providerType() !== 'fonnte') {
            $integration = $integrationService->syncIntegration($integration);
        }

        if ($integrationService->providerType() !== 'fonnte' && ! $integration->isConnected()) {
            $log->fill([
                'status' => 'failed',
                'failed_at' => now(),
                'last_error' => 'WhatsApp tenant belum terhubung.',
            ])->save();

            return;
        }

        $delaySeconds = $this->reserveSendSlot($integration->instance_name ?: $integration->id);
        if ($delaySeconds > 0) {
            $this->release($delaySeconds);

            return;
        }

        $log->attempt_count = (int) $log->attempt_count + 1;
        $log->save();

        try {
            $response = $integrationService->sendText(
                $integration,
                (string) $log->normalized_phone,
                (string) $log->message_text
            );

            $log->fill([
                'integration_id' => $integration->id,
                'status' => 'sent',
                'provider_message_id' => data_get($response, 'key.id'),
                'provider_status' => (string) (data_get($response, 'status') ?? 'sent'),
                'provider_response' => json_encode($response, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'sent_at' => now(),
                'failed_at' => null,
                'last_error' => null,
            ])->save();
        } catch (\Throwable $e) {
            if ($this->attempts() < $this->tries) {
                throw $e;
            }

            $log->fill([
                'status' => 'failed',
                'failed_at' => now(),
                'last_error' => $e->getMessage(),
            ])->save();
        }
    }

    private function reserveSendSlot(string $senderKey): int
    {
        $senderKey = preg_replace('/[^a-zA-Z0-9_.:-]+/', '-', trim($senderKey)) ?: 'central';
        $intervalSeconds = max(3, min((int) config('services.whatsapp.send_min_interval_seconds', 10), 120));
        $maxReleaseSeconds = max(10, min((int) config('services.whatsapp.send_throttle_release_max_seconds', 120), 600));
        $lock = Cache::lock('whatsapp-send-throttle-lock:'.$senderKey, 10);

        if (! $lock->get()) {
            return min($maxReleaseSeconds, $intervalSeconds);
        }

        try {
            $cacheKey = 'whatsapp-send-throttle-next-at:'.$senderKey;
            $now = now()->timestamp;
            $nextAt = (int) Cache::get($cacheKey, 0);

            if ($nextAt > $now) {
                return min($maxReleaseSeconds, max(1, $nextAt - $now));
            }

            Cache::put($cacheKey, $now + $intervalSeconds, now()->addMinutes(30));

            return 0;
        } finally {
            optional($lock)->release();
        }
    }
}
