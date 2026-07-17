<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class JadwalUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $guruId = '',
        public array $data = []
    ) {}

    public function broadcastOn(): array
    {
        return [new Channel("jadwal.{$this->guruId}")];
    }

    public function broadcastAs(): string
    {
        return 'jadwal.updated';
    }

    public function broadcastWith(): array
    {
        return ['data' => $this->data, 'guru_id' => $this->guruId];
    }
}
