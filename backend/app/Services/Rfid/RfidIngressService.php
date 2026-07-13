<?php

namespace App\Services\Rfid;

use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class RfidIngressService
{
    public function __construct(
        private readonly RfidScanService $rfidScanService,
        private readonly RfidLiveEventStreamService $rfidLiveEventStream,
    ) {}

    public function processScanByTenantSlug(
        string $tenantSlug,
        string $cardUid,
        ?string $deviceId = null,
        ?string $mode = null,
        string $source = 'http-scan',
        ?string $eventId = null,
        ?string $scannedAt = null,
        ?array $payload = null
    ): array {
        $deviceId = $this->normalizeDeviceId($deviceId);
        $tenantId = $this->resolveTenantId($tenantSlug);
        $rawScannedAt = $scannedAt ?? ($payload['scanned_at'] ?? $payload['timestamp'] ?? null);
        $scannedAt = $this->normalizeTimestamp($rawScannedAt)
            ?? now('Asia/Jakarta')->startOfMinute()->toDateTimeString();
        $eventId = $this->normalizeEventId(
            $eventId,
            $tenantId,
            $tenantSlug,
            $deviceId,
            $cardUid,
            $mode,
            $scannedAt
        );
        if (is_array($payload)) {
            $payload['event_id'] = $payload['event_id'] ?? $eventId;
            $payload['scanned_at'] = $payload['scanned_at'] ?? $scannedAt;
        }

        if ($eventId !== '') {
            $eventCacheKey = $this->eventCacheKey($tenantId, $deviceId, $eventId);
            if ($eventCacheKey !== null && $this->shouldUseEventCache() && Cache::get($eventCacheKey) === true) {
                return $this->duplicateEventResult((object) [
                    'event_id' => $eventId,
                    'device_id' => $deviceId,
                    'response_code' => 200,
                    'response_payload' => null,
                ]);
            }

            $existing = $this->findExistingEvent($tenantId, $deviceId, $eventId);
            if ($existing) {
                if ($eventCacheKey !== null && $this->shouldUseEventCache()) {
                    Cache::put($eventCacheKey, true, $this->eventCacheTtl());
                }

                return $this->duplicateEventResult($existing);
            }
        }

        $eventRowId = $this->beginEventRecord(
            tenantId: $tenantId,
            deviceId: $deviceId,
            cardUid: $cardUid,
            mode: $mode,
            source: $source,
            eventId: $eventId,
            scannedAt: $scannedAt,
            payload: $payload,
        );

        if ($eventRowId === null && $eventId !== '') {
            $existing = $this->findExistingEvent($tenantId, $deviceId, $eventId);
            if ($existing) {
                return $this->duplicateEventResult($existing);
            }
        }

        $result = $this->rfidScanService->processScanByTenantSlug($tenantSlug, $cardUid, $deviceId, $mode);
        $result['data'] = is_array($result['data'] ?? null) ? $result['data'] : [];
        $result['data']['event_id'] = $result['data']['event_id'] ?? $eventId;
        $result['data']['device_id'] = $result['data']['device_id'] ?? $deviceId;

        $this->finishEventRecord($eventRowId, $result);
        $this->rfidLiveEventStream->publishPersistedEvent($eventRowId);

        if ($eventId !== '' && (int) ($result['status'] ?? 500) < 500) {
            $eventCacheKey = $this->eventCacheKey($tenantId, $deviceId, $eventId);
            if ($eventCacheKey !== null && $this->shouldUseEventCache()) {
                Cache::put($eventCacheKey, true, $this->eventCacheTtl());
            }
        }

        return $result;
    }

    public function syncBatchByTenantSlug(
        string $tenantSlug,
        array $events,
        ?string $deviceId = null,
        string $source = 'http-sync'
    ): array {
        $items = [];
        $successCount = 0;
        $failedCount = 0;
        $duplicateCount = 0;

        foreach (array_values($events) as $index => $event) {
            if (! is_array($event)) {
                $failedCount++;
                $items[] = [
                    'index' => $index,
                    'success' => false,
                    'duplicate' => false,
                    'status' => 422,
                    'reason' => 'invalid_event_payload',
                    'message' => 'Format event RFID harus berupa object/array',
                ];

                continue;
            }

            $currentDeviceId = $this->normalizeDeviceId((string) ($event['device_id'] ?? $deviceId));
            $currentEventId = trim((string) ($event['event_id'] ?? $event['scan_id'] ?? ''));
            $currentCardUid = trim((string) ($event['card_uid'] ?? ''));
            $currentMode = trim((string) ($event['mode'] ?? ''));
            $currentScannedAt = $this->normalizeTimestamp($event['scanned_at'] ?? $event['timestamp'] ?? null);

            if ($currentCardUid === '') {
                $failedCount++;
                $items[] = [
                    'index' => $index,
                    'event_id' => $currentEventId !== '' ? $currentEventId : null,
                    'device_id' => $currentDeviceId,
                    'success' => false,
                    'duplicate' => false,
                    'status' => 422,
                    'reason' => 'card_uid_required',
                    'message' => 'card_uid wajib diisi untuk setiap event RFID',
                ];

                continue;
            }

            $result = $this->processScanByTenantSlug(
                tenantSlug: $tenantSlug,
                cardUid: $currentCardUid,
                deviceId: $currentDeviceId,
                mode: $currentMode,
                source: $source,
                eventId: $currentEventId,
                scannedAt: $currentScannedAt,
                payload: $event,
            );

            $data = $result['data'] ?? [];
            $isDuplicate = (bool) ($data['duplicate'] ?? false)
                || ((string) ($data['reason'] ?? '') === 'duplicate_event');

            if ($isDuplicate) {
                $duplicateCount++;
            } elseif ((bool) ($data['success'] ?? false)) {
                $successCount++;
            } else {
                $failedCount++;
            }

            $items[] = [
                'index' => $index,
                'event_id' => $data['event_id'] ?? ($currentEventId !== '' ? $currentEventId : null),
                'device_id' => $currentDeviceId,
                'card_uid' => $data['card_uid'] ?? $currentCardUid,
                'success' => (bool) ($data['success'] ?? false),
                'duplicate' => $isDuplicate,
                'status' => (int) ($result['status'] ?? 500),
                'reason' => $data['reason'] ?? null,
                'message' => $data['message'] ?? null,
            ];
        }

        $status = $failedCount > 0 ? 207 : 200;

        return [
            'status' => $status,
            'data' => [
                'success' => $failedCount === 0,
                'tenant_slug' => trim($tenantSlug),
                'message' => $failedCount === 0
                    ? 'Sinkronisasi RFID berhasil diproses'
                    : 'Sebagian event RFID gagal diproses',
                'summary' => [
                    'total' => count($events),
                    'processed' => $successCount,
                    'duplicates' => $duplicateCount,
                    'failed' => $failedCount,
                ],
                'items' => $items,
            ],
        ];
    }

    private function beginEventRecord(
        ?string $tenantId,
        string $deviceId,
        string $cardUid,
        ?string $mode,
        string $source,
        ?string $eventId,
        ?string $scannedAt,
        ?array $payload
    ): ?int {
        if (! $this->shouldPersistDeviceEvents()) {
            return null;
        }

        try {
            return DB::table('rfid_device_events')->insertGetId([
                'tenant_id' => $tenantId,
                'device_id' => $deviceId,
                'event_id' => $eventId !== '' ? $eventId : null,
                'card_uid' => $this->normalizeCardUid($cardUid),
                'mode' => $this->nullableString($mode),
                'source' => trim($source) !== '' ? trim($source) : 'http',
                'status' => 'received',
                'scanned_at' => $this->normalizeTimestamp($scannedAt),
                'payload' => $payload !== null
                    ? json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                    : null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } catch (QueryException $e) {
            if ($eventId !== '' && $this->isDuplicateKeyException($e->getMessage())) {
                return null;
            }

            return null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function finishEventRecord(?int $eventRowId, array $result): void
    {
        if (! $eventRowId) {
            return;
        }

        try {
            DB::table('rfid_device_events')
                ->where('id', $eventRowId)
                ->update([
                    'status' => $this->normalizeEventStatus($result),
                    'processed_at' => now(),
                    'response_code' => (int) ($result['status'] ?? 500),
                    'response_payload' => json_encode(
                        $result['data'] ?? [],
                        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
                    ),
                    'updated_at' => now(),
                ]);
        } catch (\Throwable $e) {
            // Event log bersifat observability, jangan gagalkan proses scan.
        }
    }

    private function findExistingEvent(?string $tenantId, string $deviceId, string $eventId): ?object
    {
        if (! $this->shouldPersistDeviceEvents()) {
            return null;
        }

        $query = DB::table('rfid_device_events')
            ->whereRaw('lower(device_id) = ?', [Str::lower($deviceId)])
            ->where('event_id', $eventId);

        if ($tenantId !== null && trim($tenantId) !== '') {
            $query->where('tenant_id', $tenantId);
        } else {
            $query->whereNull('tenant_id');
        }

        return $query->first([
            'id',
            'event_id',
            'device_id',
            'response_code',
            'response_payload',
        ]);
    }

    private function resolveTenantId(string $tenantSlug): ?string
    {
        try {
            $tenant = $this->rfidScanService->resolveTenantBySlug($tenantSlug);

            return $tenant?->id ? (string) $tenant->id : null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function eventCacheKey(?string $tenantId, string $deviceId, string $eventId): ?string
    {
        $eventId = trim($eventId);
        if ($eventId === '') {
            return null;
        }

        return 'rfid:event:'.hash('sha256', implode('|', [
            trim((string) ($tenantId ?? '')),
            Str::lower(trim($deviceId)),
            $eventId,
        ]));
    }

    private function eventCacheTtl(): int
    {
        return max(60, (int) config('rfid.performance.device_event_cache_ttl_seconds', 3600));
    }

    private function shouldPersistDeviceEvents(): bool
    {
        return (bool) config('rfid.performance.device_event_log_enabled', true);
    }

    private function shouldUseEventCache(): bool
    {
        return ! app()->runningUnitTests();
    }

    private function duplicateEventResult(object $row): array
    {
        $storedPayload = $this->decodeJsonPayload($row->response_payload ?? null);
        $status = (int) ($row->response_code ?? 200);

        if (is_array($storedPayload) && ! empty($storedPayload)) {
            $storedPayload['duplicate'] = true;
            $storedPayload['reason'] = $storedPayload['reason'] ?? 'duplicate_event';
            $storedPayload['message'] = $storedPayload['message'] ?? 'Event RFID sudah pernah diproses';

            return [
                'status' => $status > 0 ? $status : 200,
                'data' => $storedPayload,
            ];
        }

        return [
            'status' => 200,
            'data' => [
                'success' => true,
                'duplicate' => true,
                'reason' => 'duplicate_event',
                'message' => 'Event RFID sudah pernah diproses',
                'event_id' => $row->event_id ?? null,
                'device_id' => $row->device_id ?? null,
            ],
        ];
    }

    private function decodeJsonPayload(mixed $payload): ?array
    {
        if (is_array($payload)) {
            return $payload;
        }

        if (! is_string($payload) || trim($payload) === '') {
            return null;
        }

        $decoded = json_decode($payload, true);

        return is_array($decoded) ? $decoded : null;
    }

    private function normalizeEventStatus(array $result): string
    {
        if ((bool) (($result['data']['success'] ?? false)) === true) {
            return 'processed';
        }

        return 'error';
    }

    private function normalizeTimestamp(mixed $timestamp): ?string
    {
        if ($timestamp === null || trim((string) $timestamp) === '') {
            return null;
        }

        try {
            return Carbon::parse((string) $timestamp)->toDateTimeString();
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function normalizeEventId(
        mixed $eventId,
        ?string $tenantId,
        string $tenantSlug,
        string $deviceId,
        string $cardUid,
        ?string $mode,
        string $scannedAt
    ): string {
        $eventId = trim((string) $eventId);
        if ($eventId !== '') {
            return Str::limit($eventId, 190, '');
        }

        if (! (bool) config('rfid.performance.require_idempotency_key', true)) {
            return '';
        }

        $fingerprint = implode('|', [
            trim((string) ($tenantId ?? '')),
            Str::lower(trim($tenantSlug)),
            Str::lower(trim($deviceId)),
            $this->normalizeCardUid($cardUid),
            Str::lower(trim((string) $mode)),
            trim($scannedAt),
        ]);

        return 'auto-'.hash('sha256', $fingerprint);
    }

    private function normalizeCardUid(string $cardUid): string
    {
        return strtoupper(preg_replace('/\s+/', '', trim($cardUid)) ?? '');
    }

    private function normalizeDeviceId(?string $deviceId): string
    {
        $deviceId = trim((string) $deviceId);

        return $deviceId !== '' ? $deviceId : 'RFID_DEVICE';
    }

    private function nullableString(?string $value): ?string
    {
        $value = trim((string) $value);

        return $value !== '' ? $value : null;
    }

    private function isDuplicateKeyException(string $message): bool
    {
        $normalized = Str::lower($message);

        return Str::contains($normalized, [
            'duplicate',
            'unique constraint',
            'duplicate key',
            'already exists',
        ]);
    }
}
