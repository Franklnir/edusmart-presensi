<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\WhatsApp\WhatsAppIntegrationService;
use Illuminate\Http\Request;

class WhatsAppWebhookController extends Controller
{
    public function __construct(
        private readonly WhatsAppIntegrationService $whatsAppIntegrationService
    ) {}

    public function handle(Request $request, string $secret, ?string $event = null)
    {
        $payload = json_decode($request->getContent(), true);
        if (! is_array($payload)) {
            $payload = $request->all();
        }

        $integration = $this->whatsAppIntegrationService->handleWebhook($secret, $event, $payload);
        if (! $integration) {
            return response()->json(['error' => 'Webhook secret tidak valid'], 404);
        }

        return response()->json(['data' => 'ok']);
    }
}
