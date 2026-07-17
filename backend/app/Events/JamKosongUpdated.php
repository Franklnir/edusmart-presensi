<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class JamKosongUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $teacherId = '',
        public array $data = []
    ) {}

    public function broadcastOn(): array
    {
        return [new Channel("jam-kosong.{$this->teacherId}")];
    }

    public function broadcastAs(): string
    {
        return 'jam-kosong.updated';
    }

    public function broadcastWith(): array
    {
        return ['data' => $this->data, 'teacher_id' => $this->teacherId];
    }
}
