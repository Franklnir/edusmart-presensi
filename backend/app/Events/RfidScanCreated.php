<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class RfidScanCreated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $kelas = '',
        public array $data = []
    ) {}

    public function broadcastOn(): array
    {
        return [new Channel("rfid.{$this->kelas}")];
    }

    public function broadcastAs(): string
    {
        return 'rfid.scan';
    }

    public function broadcastWith(): array
    {
        return ['data' => $this->data, 'kelas' => $this->kelas];
    }
}
