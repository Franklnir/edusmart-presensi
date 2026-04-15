<?php

namespace App\Jobs;

use App\Models\WhatsAppMessageLog;
use App\Services\WhatsApp\WhatsAppIntegrationService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

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
                'last_error' => 'Konfigurasi Evolution API belum lengkap.',
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

        $log->attempt_count = (int) $log->attempt_count + 1;
        $log->save();

        $integration = $integrationService
            ->getOrCreateIntegration((string) $log->tenant_id)
            ->fresh();
        $integration = $integrationService->syncIntegration($integration);

        if (! $integration->isConnected()) {
            $log->fill([
                'status' => 'failed',
                'failed_at' => now(),
                'last_error' => 'WhatsApp tenant belum terhubung.',
            ])->save();

            return;
        }

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
}
