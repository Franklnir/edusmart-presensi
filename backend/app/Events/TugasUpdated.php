<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class TugasUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $userId = '',
        public array $data = []
    ) {}

    public function broadcastOn(): array
    {
        return [new Channel("tugas.{$this->userId}")];
    }

    public function broadcastAs(): string
    {
        return 'tugas.updated';
    }

    public function broadcastWith(): array
    {
        return ['data' => $this->data, 'user_id' => $this->userId];
    }
}
