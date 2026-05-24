<?php

namespace App\Services\WhatsApp;

use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class FonnteApiClient
{
    public function isConfigured(): bool
    {
        return $this->token() !== '';
    }

    public function sendText(string $number, string $text): array
    {
        if (! $this->isConfigured()) {
            throw new RuntimeException('Token Fonnte belum dikonfigurasi.');
        }

        $response = Http::baseUrl($this->baseUrl())
            ->acceptJson()
            ->asForm()
            ->timeout((int) config('services.fonnte.timeout', 20))
            ->connectTimeout(10)
            ->withHeaders([
                'Authorization' => $this->token(),
            ])
            ->post('/send', [
                'target' => $number,
                'message' => $text,
                'countryCode' => '62',
            ]);

        if (! $response->successful()) {
            throw new RuntimeException($this->errorMessage($response));
        }

        $payload = $response->json();
        if (! is_array($payload)) {
            return ['status' => 'sent'];
        }

        $status = $payload['status'] ?? $payload['success'] ?? true;
        if ($status === false || $status === 'false') {
            $reason = $payload['reason'] ?? $payload['message'] ?? 'Fonnte menolak pesan.';
            throw new RuntimeException(is_array($reason) ? json_encode($reason) : (string) $reason);
        }

        return $payload;
    }

    private function baseUrl(): string
    {
        return rtrim((string) config('services.fonnte.base_url', 'https://api.fonnte.com'), '/');
    }

    private function token(): string
    {
        return trim((string) config('services.fonnte.token', ''));
    }

    private function errorMessage(Response $response): string
    {
        $json = $response->json();
        $message = is_array($json)
            ? ($json['reason'] ?? $json['message'] ?? $json['error'] ?? null)
            : null;

        if (is_array($message)) {
            $message = json_encode($message, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }

        $message = trim((string) $message);

        return $message !== ''
            ? $message
            : 'Fonnte API error HTTP '.$response->status();
    }
}
