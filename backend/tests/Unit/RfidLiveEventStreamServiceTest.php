<?php

namespace Tests\Unit;

use App\Services\Rfid\RfidLiveEventStreamService;
use Tests\TestCase;

class RfidLiveEventStreamServiceTest extends TestCase
{
    public function test_disabled_stream_returns_database_fallback_signal(): void
    {
        config()->set('rfid.live_events.redis_enabled', false);

        $result = app(RfidLiveEventStreamService::class)->readAfter('tenant-id', 10);

        $this->assertFalse($result['available']);
        $this->assertSame([], $result['events']);
    }

    public function test_event_payload_keeps_live_scan_contract(): void
    {
        $payload = app(RfidLiveEventStreamService::class)->formatPayload((object) [
            'id' => 42,
            'event_id' => 'scan-42',
            'device_id' => 'gerbang-01',
            'card_uid' => 'A1B2C3D4',
            'mode' => 'auto',
            'source' => 'mqtt',
            'status' => 'processed',
            'response_code' => 200,
            'response_payload' => json_encode([
                'success' => true,
                'nama' => 'Siswa Uji',
                'kelas' => 'X A',
            ]),
            'scanned_at' => '2026-07-13 08:00:00+07',
            'processed_at' => '2026-07-13 08:00:00+07',
            'created_at' => '2026-07-13 08:00:00+07',
        ]);

        $this->assertSame(42, $payload['id']);
        $this->assertTrue($payload['success']);
        $this->assertSame('Siswa Uji', $payload['nama']);
        $this->assertSame('X A', $payload['kelas']);
        $this->assertSame('mqtt', $payload['source']);
    }
}
