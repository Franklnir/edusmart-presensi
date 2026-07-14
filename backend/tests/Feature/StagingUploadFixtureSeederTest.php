<?php

namespace Tests\Feature;

use Database\Seeders\StagingUploadFixtureSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class StagingUploadFixtureSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_creates_synthetic_multi_tenant_upload_fixtures(): void
    {
        $this->app->detectEnvironment(fn () => 'staging');
        config(['staging.test_password' => 'Synthetic-Only!Password-2026']);

        $this->seed(StagingUploadFixtureSeeder::class);

        $this->assertDatabaseHas('tenants', ['slug' => 'tenant-a']);
        $this->assertDatabaseHas('tenants', ['slug' => 'tenant-b']);
        $this->assertDatabaseHas('profiles', ['email' => 'guru-a2@staging.invalid', 'role' => 'guru']);
        $this->assertDatabaseHas('profiles', ['email' => 'siswa-b1@staging.invalid', 'role' => 'siswa']);
        $this->assertDatabaseHas('kelas', ['nama' => 'Kelas A2']);
        $this->assertDatabaseHas('tugas', ['id' => 91001, 'judul' => 'Synthetic Assignment A1']);
        $this->assertDatabaseHas('tugas', ['id' => 92001, 'judul' => 'Synthetic Assignment B1']);
    }
}
