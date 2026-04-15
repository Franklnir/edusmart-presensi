<?php

namespace App\Services\WhatsApp;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class EvolutionApiClient
{
    public function isConfigured(): bool
    {
        return $this->baseUrl() !== '' && $this->apiKey() !== '';
    }

    public function assertConfigured(): void
    {
        if ($this->isConfigured()) {
            return;
        }

        throw new RuntimeException('Konfigurasi Evolution API belum lengkap.');
    }

    public function fetchAllInstances(): array
    {
        $response = $this->send('GET', '/instance/fetchInstances');
        $items = is_array($response) ? $response : [];

        return array_values(array_filter(array_map(
            fn ($item) => $this->normalizeInstanceRecord($item),
            $items
        )));
    }

    public function fetchInstance(string $instanceName): ?array
    {
        $instanceName = trim($instanceName);
        if ($instanceName === '') {
            return null;
        }

        $response = $this->send('GET', '/instance/fetchInstances', query: [
            'instanceName' => $instanceName,
        ]);

        $items = is_array($response) ? $response : [];
        foreach ($items as $item) {
            $record = $this->normalizeInstanceRecord($item);
            if (! empty($record['instanceName']) && $record['instanceName'] === $instanceName) {
                return $record;
            }
        }

        return null;
    }

    public function createInstance(array $payload): array
    {
        return $this->send('POST', '/instance/create', payload: $payload);
    }

    public function connectInstance(string $instanceName, ?string $number = null): array
    {
        $payload = [];
        if ($number !== null && trim($number) !== '') {
            $payload['number'] = trim($number);
        }

        return $this->send('GET', '/instance/connect/'.rawurlencode($instanceName), payload: $payload);
    }

    public function setWebhook(string $instanceName, string $url, array $events): array
    {
        return $this->send('POST', '/webhook/set/'.rawurlencode($instanceName), payload: [
            'enabled' => true,
            'url' => $url,
            'webhookByEvents' => true,
            'webhookBase64' => true,
            'events' => array_values($events),
        ]);
    }

    public function logoutInstance(string $instanceName): array
    {
        return $this->send('DELETE', '/instance/logout/'.rawurlencode($instanceName));
    }

    public function sendText(string $instanceName, string $number, string $text): array
    {
        return $this->send('POST', '/message/sendText/'.rawurlencode($instanceName), payload: [
            'number' => $number,
            'text' => $text,
            'delay' => 0,
            'linkPreview' => false,
        ]);
    }

    private function request(): PendingRequest
    {
        return Http::baseUrl($this->baseUrl())
            ->acceptJson()
            ->asJson()
            ->timeout((int) config('services.evolution_api.timeout', 20))
            ->connectTimeout(10)
            ->withHeaders([
                'apikey' => $this->apiKey(),
            ])
            ->withOptions([
                'verify' => (bool) config('services.evolution_api.verify_ssl', true),
            ]);
    }

    private function send(string $method, string $uri, array $payload = [], array $query = []): array
    {
        $this->assertConfigured();

        $options = [];
        if (! empty($query)) {
            $options['query'] = $query;
        }
        if (! empty($payload)) {
            $options['json'] = $payload;
        }

        $response = $this->request()->send($method, $uri, $options);
        if (! $response->successful()) {
            throw new RuntimeException($this->buildErrorMessage($response));
        }

        $decoded = $response->json();
        if (is_array($decoded)) {
            return $decoded;
        }

        return [];
    }

    private function buildErrorMessage(Response $response): string
    {
        $json = $response->json();
        $message = Arr::get($json, 'message')
            ?: Arr::get($json, 'error')
            ?: Arr::get($json, 'response.message');

        if (is_string($message) && trim($message) !== '') {
            return trim($message);
        }

        return 'Evolution API error HTTP '.$response->status();
    }

    private function normalizeInstanceRecord($item): array
    {
        if (! is_array($item)) {
            return [];
        }

        if (isset($item['instance']) && is_array($item['instance'])) {
            return $item['instance'];
        }

        return $item;
    }

    private function baseUrl(): string
    {
        return rtrim((string) config('services.evolution_api.base_url', ''), '/');
    }

    private function apiKey(): string
    {
        return trim((string) config('services.evolution_api.api_key', ''));
    }
}
