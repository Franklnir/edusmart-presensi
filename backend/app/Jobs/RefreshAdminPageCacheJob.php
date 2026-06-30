<?php

namespace App\Jobs;

use App\Services\Admin\AdminPageCacheService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class RefreshAdminPageCacheJob implements ShouldBeUnique, ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public int $tries = 2;

    public int $uniqueFor = 60;

    public function __construct(
        public string $tenantId,
        public array $scopes = [],
        public array $years = []
    ) {
        $this->onQueue('default');
    }

    public function uniqueId(): string
    {
        $scopes = array_values(array_unique(array_filter($this->scopes)));
        sort($scopes);
        $years = array_values(array_unique(array_filter($this->years)));
        sort($years);

        return $this->tenantId.':'.implode(',', $scopes).':'.implode(',', $years);
    }

    public function handle(AdminPageCacheService $cache): void
    {
        if (trim($this->tenantId) === '') {
            return;
        }

        $cache->warmTenant($this->tenantId, $this->scopes, $this->years);
    }
}
