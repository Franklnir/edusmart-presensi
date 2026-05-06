<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class StorageSecurityTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_cannot_upload_storage_file(): void
    {
        $response = $this->post('/api/storage/upload', [
            'bucket' => 'assignments',
            'path' => 'x-1/test.pdf',
            'file' => UploadedFile::fake()->create('test.pdf', 10, 'application/pdf'),
        ]);

        $response->assertStatus(401);
    }

    public function test_authenticated_upload_blocks_dangerous_extension(): void
    {
        $tenantId = $this->defaultTenantId();
        [$user] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');
        Sanctum::actingAs($user);

        $response = $this->post('/api/storage/upload', [
            'bucket' => 'assignments',
            'path' => 'X-1/'.$user->id.'-shell.php',
            'file' => UploadedFile::fake()->create('shell.php', 10, 'application/x-php'),
        ]);

        $response->assertStatus(422);
        $response->assertJsonPath('error', 'Ekstensi file tidak diizinkan');
    }

    public function test_assignment_pdf_upload_is_limited_to_two_mb_when_drive_is_not_ready(): void
    {
        $tenantId = $this->defaultTenantId();
        [$user] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');
        Sanctum::actingAs($user);

        $response = $this->post('/api/storage/upload', [
            'bucket' => 'assignments',
            'path' => 'X-1/'.$user->id.'-large.pdf',
            'file' => UploadedFile::fake()->create('large.pdf', 4096, 'application/pdf'),
        ]);

        $response->assertStatus(422);
        $this->assertStringContainsString('maksimal 2 MB', (string) $response->json('error'));
    }

    public function test_assignment_presentation_upload_is_limited_to_two_mb_when_drive_is_not_ready(): void
    {
        $tenantId = $this->defaultTenantId();
        [$user] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');
        Sanctum::actingAs($user);

        $response = $this->post('/api/storage/upload', [
            'bucket' => 'assignments',
            'path' => 'X-1/'.$user->id.'-large.pptx',
            'file' => UploadedFile::fake()->create(
                'large.pptx',
                6144,
                'application/vnd.openxmlformats-officedocument.presentationml.presentation'
            ),
        ]);

        $response->assertStatus(422);
        $this->assertStringContainsString('maksimal 2 MB', (string) $response->json('error'));
    }

    public function test_guest_object_access_requires_valid_signature(): void
    {
        Storage::fake('local');
        $tenantId = $this->defaultTenantId();

        DB::table('settings')->insert([
            'tenant_id' => $tenantId,
            'nama_sekolah' => 'Sekolah Aman',
            'logo_path' => 'logo_sekolah.png',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Storage::disk('local')->put('private/profile-photos/logo_sekolah.png', 'image-bytes');

        $unsigned = $this->get('/api/storage/object?bucket=profile-photos&path=logo_sekolah.png');
        $unsigned->assertStatus(403);

        $signed = $this->getJson('/api/storage/signed?bucket=profile-photos&path=logo_sekolah.png&expires=300');
        $signed->assertOk();

        $signedUrl = (string) $signed->json('data.signedUrl');
        $this->assertNotSame('', $signedUrl);

        $file = $this->get($signedUrl);
        $file->assertOk();
    }

    private function defaultTenantId(): string
    {
        $tenantId = (string) DB::table('tenants')
            ->where('slug', 'default')
            ->value('id');

        $this->assertNotSame('', $tenantId, 'Tenant default tidak ditemukan di database test');

        return $tenantId;
    }

    private function createUserWithProfile(string $tenantId, string $role, string $kelas): array
    {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => $role.' test',
            'email' => Str::uuid().'@example.com',
            'password' => Hash::make('password123'),
        ]);

        DB::table('profiles')->insert([
            'id' => $user->id,
            'tenant_id' => $tenantId,
            'email' => $user->email,
            'nama' => $user->name,
            'role' => $role,
            'kelas' => $kelas,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$user];
    }
}
