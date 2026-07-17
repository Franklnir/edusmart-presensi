<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class SettingsUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $tenantId = '',
        public array $data = []
    ) {}

    public function broadcastOn(): array
    {
        return [new Channel("settings.{$this->tenantId}")];
    }

    public function broadcastAs(): string
    {
        return 'settings.updated';
    }

    public function broadcastWith(): array
    {
        return ['data' => $this->data, 'tenant_id' => $this->tenantId];
    }
}
