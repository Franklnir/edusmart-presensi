<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class AbsensiUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $kelas,
        public string $tanggal,
        public string $mapel,
        public array $data = []
    ) {}

    public function broadcastOn(): array
    {
        return [new Channel("absensi.{$this->kelas}.{$this->tanggal}.{$this->mapel}")];
    }

    public function broadcastAs(): string
    {
        return 'absensi.updated';
    }

    public function broadcastWith(): array
    {
        return ['data' => $this->data, 'kelas' => $this->kelas, 'tanggal' => $this->tanggal, 'mapel' => $this->mapel];
    }
}
