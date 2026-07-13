<?php

namespace App\Services\Rfid;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;

class RfidLiveEventStreamService
{
    public function enabled(): bool
    {
        return (bool) config('rfid.live_events.redis_enabled', false);
    }

    public function publishPersistedEvent(?int $eventRowId): bool
    {
        if (! $this->enabled() || ! $eventRowId) {
            return false;
        }

        try {
            $row = DB::table('rfid_device_events')->where('id', $eventRowId)->first();
            if (! $row || empty($row->tenant_id) || empty($row->processed_at)) {
                return false;
            }

            $payload = json_encode(
                $this->formatPayload($row),
                JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
            );
            if (! is_string($payload)) {
                return false;
            }

            $connection = Redis::connection((string) config('rfid.live_events.redis_connection', 'default'));
            $key = $this->streamKey((string) $row->tenant_id);
            $maxLength = (int) config('rfid.live_events.stream_max_length', 1000);
            $streamId = $connection->xadd($key, $eventRowId.'-0', ['payload' => $payload], $maxLength, true);
            $connection->expire($key, (int) config('rfid.live_events.stream_ttl_seconds', 86400));

            return is_string($streamId) && $streamId !== '';
        } catch (\Throwable $e) {
            // Redis adalah jalur cepat. Event tetap aman di PostgreSQL dan SSE akan catch-up dari sana.
            return false;
        }
    }

    /**
     * @return array{available: bool, events: array<int, array<string, mixed>>}
     */
    public function readAfter(string $tenantId, int $cursor, int $count = 25): array
    {
        if (! $this->enabled()) {
            return ['available' => false, 'events' => []];
        }

        try {
            $connection = Redis::connection((string) config('rfid.live_events.redis_connection', 'default'));
            $key = $this->streamKey($tenantId);
            $rows = $connection->xread(
                [$key => max(0, $cursor).'-0'],
                max(1, min(100, $count)),
                (int) config('rfid.live_events.read_block_milliseconds', 1000)
            );

            return [
                'available' => true,
                'events' => $this->normalizeReadResult($rows, $key),
            ];
        } catch (\Throwable $e) {
            return ['available' => false, 'events' => []];
        }
    }

    public function formatPayload(object $row): array
    {
        $response = json_decode((string) ($row->response_payload ?? ''), true);
        if (! is_array($response)) {
            $response = [];
        }

        $processingMs = $this->durationMilliseconds($row->created_at ?? null, $row->processed_at ?? null);
        $transportMs = $this->durationMilliseconds($row->scanned_at ?? null, $row->created_at ?? null);

        return [
            'id' => (int) $row->id,
            'event_id' => $row->event_id ?? null,
            'device_id' => $row->device_id ?? null,
            'card_uid' => $row->card_uid ?? ($response['card_uid'] ?? null),
            'mode' => $row->mode ?? ($response['mode'] ?? null),
            'source' => $row->source ?? null,
            'status' => $row->status ?? null,
            'response_code' => $row->response_code ?? null,
            'success' => (bool) ($response['success'] ?? false),
            'reason' => $response['reason'] ?? null,
            'message' => $response['message'] ?? null,
            'nama' => $response['nama'] ?? null,
            'kelas' => $response['kelas'] ?? null,
            'mapel' => $response['mapel'] ?? null,
            'waktu_absen' => $response['waktu_absen'] ?? ($response['waktu'] ?? null),
            'absen_id' => $response['absen_id'] ?? null,
            'response' => $response,
            'scanned_at' => $row->scanned_at ?? null,
            'processed_at' => $row->processed_at ?? null,
            'created_at' => $row->created_at ?? null,
            'processing_ms' => $processingMs,
            'transport_ms' => $transportMs !== null && $transportMs <= 300000 ? $transportMs : null,
            'stream_published_at' => now()->toIso8601String(),
        ];
    }

    private function streamKey(string $tenantId): string
    {
        $prefix = trim((string) config('rfid.live_events.stream_prefix', 'rfid:live'), ':');

        return $prefix.':'.hash('sha256', trim($tenantId));
    }

    private function normalizeReadResult(mixed $rows, string $key): array
    {
        if (! is_array($rows) || $rows === []) {
            return [];
        }

        $streamRows = $rows[$key] ?? reset($rows);
        if (! is_array($streamRows)) {
            return [];
        }

        $events = [];
        foreach ($streamRows as $streamId => $fields) {
            if (! is_array($fields)) {
                continue;
            }
            $payload = json_decode((string) ($fields['payload'] ?? ''), true);
            if (! is_array($payload)) {
                continue;
            }
            $payload['id'] = max((int) ($payload['id'] ?? 0), (int) explode('-', (string) $streamId, 2)[0]);
            $events[] = $payload;
        }

        usort($events, fn (array $left, array $right) => ((int) $left['id']) <=> ((int) $right['id']));

        return $events;
    }

    private function durationMilliseconds(mixed $start, mixed $end): ?int
    {
        if ($start === null || $end === null || trim((string) $start) === '' || trim((string) $end) === '') {
            return null;
        }

        try {
            $startAt = Carbon::parse((string) $start);
            $endAt = Carbon::parse((string) $end);
            if ($endAt->lessThan($startAt)) {
                return null;
            }

            return (int) round($startAt->diffInMilliseconds($endAt));
        } catch (\Throwable $e) {
            return null;
        }
    }
}
