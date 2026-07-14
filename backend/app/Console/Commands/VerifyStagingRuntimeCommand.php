<?php

namespace App\Console\Commands;

use App\Contracts\UploadStorageProvider;
use App\Jobs\StagingQueueProbeJob;
use App\Services\StagingIsolationGuard;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class VerifyStagingRuntimeCommand extends Command
{
    protected $signature = 'staging:verify-runtime {--wait=20 : Seconds to wait for queue processing}';

    protected $description = 'Verify isolated staging database, Redis, queue, scheduler, runtime, and upload provider';

    public function handle(StagingIsolationGuard $guard, UploadStorageProvider $provider): int
    {
        if (! app()->environment('staging')) {
            $this->error('This command may only run in staging.');

            return self::FAILURE;
        }

        $guard->assertSafe();
        $this->pass('isolation guard');

        $database = DB::selectOne('select current_database() as name');
        if (! $database || ! hash_equals((string) config('staging.database'), (string) $database->name)) {
            return $this->failedCheck('database identity');
        }
        $this->pass('database identity');

        $cacheKey = 'staging:runtime-probe:'.Str::uuid();
        Cache::put($cacheKey, 'ok', 30);
        if (Cache::get($cacheKey) !== 'ok') {
            return $this->failedCheck('Redis set/get/TTL');
        }
        Cache::forget($cacheKey);
        $this->pass('Redis set/get/TTL');

        $lock = Cache::lock('staging:runtime-lock:'.Str::uuid(), 10);
        if (! $lock->get() || trim((string) $lock->owner()) === '') {
            return $this->failedCheck('Redis atomic lock owner');
        }
        $lock->release();
        $this->pass('Redis atomic lock owner');

        if (! $provider->ready() || ! hash_equals((string) config('staging.storage_bucket'), $provider->bucket())) {
            return $this->failedCheck('upload provider and bucket');
        }
        $this->pass('upload provider and bucket');

        foreach (['zip', 'pdo_pgsql', 'redis'] as $extension) {
            if (! extension_loaded($extension)) {
                return $this->failedCheck('PHP extension '.$extension);
            }
        }
        $this->pass('required PHP extensions');

        $queueToken = (string) Str::uuid();
        StagingQueueProbeJob::dispatch($queueToken)->onQueue('staging-default');
        $wait = max(1, min(60, (int) $this->option('wait')));
        $processed = false;
        for ($second = 0; $second < $wait; $second++) {
            if (Cache::pull('staging:queue-probe:'.$queueToken) === config('app.release_sha')) {
                $processed = true;
                break;
            }
            sleep(1);
        }
        if (! $processed) {
            return $this->failedCheck('queue enqueue/dequeue');
        }
        $this->pass('queue enqueue/dequeue');

        if (! Cache::has('scheduler:last-heartbeat')) {
            return $this->failedCheck('scheduler heartbeat');
        }
        $this->pass('scheduler heartbeat');

        $this->info('Staging runtime verification passed for release '.config('app.release_sha').'.');

        return self::SUCCESS;
    }

    private function pass(string $label): void
    {
        $this->line('[PASS] '.$label);
    }

    private function failedCheck(string $label): int
    {
        $this->error('[FAIL] '.$label);

        return self::FAILURE;
    }
}
