<?php

namespace Tests\Feature;

use Tests\TestCase;

class VerifyStagingRuntimeCommandTest extends TestCase
{
    public function test_runtime_probe_refuses_to_run_outside_staging(): void
    {
        $this->artisan('staging:verify-runtime')
            ->expectsOutput('This command may only run in staging.')
            ->assertFailed();
    }
}
