<?php

namespace App\Services\WhatsApp;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class EvolutionApiClient
{
    public function isConfigured(): bool
    {
        return ! empty($this->baseUrls()) && $this->apiKey() !== '';
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
        $items = $this->extractInstanceItems($response);

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

        $maxRetries = (int) config('services.evolution_api.retries', 2);
        $retryDelayMs = (int) config('services.evolution_api.retry_delay_ms', 500);

        $response = null;
        $lastServerError = null;
        $lastConnectionException = null;

        for ($attempt = 0; $attempt <= $maxRetries; $attempt++) {
            foreach ($this->baseUrls() as $baseUrl) {
                try {
                    $response = $this->request($baseUrl)->get('/instance/fetchInstances', [
                        'instanceName' => $instanceName,
                    ]);
                } catch (ConnectionException $e) {
                    $lastConnectionException = $e;

                    continue;
                }

                if ($response->status() === 404) {
                    return null;
                }
                if (! $response->successful()) {
                    if ($response->serverError()) {
                        $lastServerError = $response;

                        continue;
                    }

                    throw new RuntimeException($this->buildErrorMessage($response));
                }

                break 2;
            }

            if ($attempt < $maxRetries) {
                usleep($retryDelayMs * 1000 * ($attempt + 1));
            }
        }

        if (! $response instanceof Response) {
            if ($lastServerError instanceof Response) {
                throw new RuntimeException($this->buildErrorMessage($lastServerError));
            }

            throw new RuntimeException($this->buildConnectionErrorMessage($lastConnectionException));
        }

        if (! $response->successful()) {
            throw new RuntimeException($this->buildErrorMessage($response));
        }

        $items = $this->extractInstanceItems($response->json());
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
        $query = [];
        if ($number !== null && trim($number) !== '') {
            $query['number'] = trim($number);
        }

        return $this->send('GET', '/instance/connect/'.rawurlencode($instanceName), query: $query);
    }

    public function setWebhook(string $instanceName, string $url, array $events): array
    {
        return $this->send('POST', '/webhook/set/'.rawurlencode($instanceName), payload: [
            // Evolution v2.1.1 runtime expects the webhook config under a nested
            // "webhook" key, even though parts of the public docs still show a
            // flat payload for this endpoint.
            'webhook' => [
                'enabled' => true,
                'url' => $url,
                'webhookByEvents' => true,
                'webhookBase64' => true,
                'events' => array_values($events),
            ],
        ]);
    }

    public function logoutInstance(string $instanceName): array
    {
        return $this->send('DELETE', '/instance/logout/'.rawurlencode($instanceName));
    }

    public function deleteInstance(string $instanceName): array
    {
        return $this->send('DELETE', '/instance/delete/'.rawurlencode($instanceName));
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

    private function request(?string $baseUrl = null): PendingRequest
    {
        $url = $baseUrl ?: ($this->baseUrls()[0] ?? '');

        return Http::baseUrl($url)
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

        $maxRetries = (int) config('services.evolution_api.retries', 2);
        $retryDelayMs = (int) config('services.evolution_api.retry_delay_ms', 500);

        $lastServerError = null;
        $lastConnectionException = null;

        for ($attempt = 0; $attempt <= $maxRetries; $attempt++) {
            foreach ($this->baseUrls() as $baseUrl) {
                try {
                    $response = $this->request($baseUrl)->send($method, $uri, $options);
                } catch (ConnectionException $e) {
                    $lastConnectionException = $e;

                    continue;
                }

                if (! $response->successful()) {
                    if ($response->serverError()) {
                        $lastServerError = $response;

                        continue;
                    }

                    throw new RuntimeException($this->buildErrorMessage($response));
                }

                $decoded = $response->json();
                if (is_array($decoded)) {
                    return $decoded;
                }

                return [];
            }

            if ($attempt < $maxRetries) {
                usleep($retryDelayMs * 1000 * ($attempt + 1));
            }
        }

        if ($lastServerError instanceof Response) {
            throw new RuntimeException($this->buildErrorMessage($lastServerError));
        }

        throw new RuntimeException($this->buildConnectionErrorMessage($lastConnectionException));
    }

    private function extractInstanceItems($payload): array
    {
        if (! is_array($payload)) {
            return [];
        }

        if ($this->looksLikeInstanceRecord($payload)) {
            return [$payload];
        }

        if (array_is_list($payload)) {
            return $payload;
        }

        foreach (['instances', 'data', 'response', 'result'] as $key) {
            $value = $payload[$key] ?? null;
            if (! is_array($value)) {
                continue;
            }

            if ($this->looksLikeInstanceRecord($value)) {
                return [$value];
            }

            if (array_is_list($value)) {
                return $value;
            }

            $nested = $this->extractInstanceItems($value);
            if (! empty($nested)) {
                return $nested;
            }
        }

        return [];
    }

    private function looksLikeInstanceRecord(array $item): bool
    {
        if (isset($item['instance']) && is_array($item['instance'])) {
            return true;
        }

        return isset($item['instanceName'])
            || isset($item['name'])
            || isset($item['connectionStatus']);
    }

    private function buildErrorMessage(Response $response): string
    {
        $json = $response->json();
        $message = Arr::get($json, 'message')
            ?: Arr::get($json, 'error')
            ?: Arr::get($json, 'response.message');

        if (is_string($message) && trim($message) !== '') {
            $message = trim($message);
            if ($response->status() >= 500 && strcasecmp($message, 'Internal Server Error') === 0) {
                return 'Evolution API sedang gagal memproses request instance (HTTP '
                    .$response->status().'). Service publik hidup, tetapi operasi QR/instance belum siap.';
            }

            return $message;
        }

        return 'Evolution API error HTTP '.$response->status();
    }

    private function buildConnectionErrorMessage(?ConnectionException $exception): string
    {
        $detail = trim((string) ($exception?->getMessage() ?? ''));
        if ($detail !== '') {
            $host = $this->failedHostFromMessage($detail);
            if ($host !== '') {
                return "Evolution API tidak bisa dijangkau dari backend. Host {$host} tidak merespons atau tidak bisa di-resolve. "
                    .'Pastikan service Evolution aktif dan EVOLUTION_PUBLIC_URL/EVOLUTION_API_BASE_URL benar.';
            }
        }

        return 'Evolution API tidak bisa dijangkau dari backend. '
            .'Pastikan service Evolution aktif dan konfigurasi host Evolution benar.';
    }

    private function normalizeInstanceRecord($item): array
    {
        if (! is_array($item)) {
            return [];
        }

        $record = $item;
        if (isset($item['instance']) && is_array($item['instance'])) {
            $record = array_merge($item, $item['instance']);
        }

        $instanceName = trim((string) ($record['instanceName'] ?? $record['name'] ?? ''));
        $status = trim((string) ($record['status'] ?? $record['connectionStatus'] ?? ''));
        $owner = trim((string) ($record['owner'] ?? $record['ownerJid'] ?? $record['number'] ?? ''));
        $profileName = trim((string) ($record['profileName'] ?? $record['profile_name'] ?? ''));

        if ($instanceName !== '') {
            $record['instanceName'] = $instanceName;
        }
        if ($status !== '') {
            $record['status'] = $status;
        }
        if ($owner !== '') {
            $record['owner'] = $owner;
        }
        if ($profileName !== '') {
            $record['profileName'] = $profileName;
        }

        return $record;
    }

    private function baseUrls(): array
    {
        $urls = [
            config('services.evolution_api.base_url', ''),
            config('services.evolution_api.public_url', ''),
        ];

        $normalized = [];
        foreach ($urls as $url) {
            $url = rtrim(trim((string) $url), '/');
            if ($url !== '') {
                $normalized[$url] = $url;
            }
        }

        return array_values($normalized);
    }

    private function failedHostFromMessage(string $message): string
    {
        if (preg_match('/Could not resolve host:\s*([^)\s]+)/i', $message, $matches)) {
            return trim($matches[1]);
        }

        return '';
    }

    private function apiKey(): string
    {
        return trim((string) config('services.evolution_api.api_key', ''));
    }
}
