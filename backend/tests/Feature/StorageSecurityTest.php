<?php

namespace Tests\Feature;

use App\Models\TenantGoogleDriveConfig;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
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

    public function test_assignment_pdf_upload_is_limited_to_three_mb_when_drive_is_not_ready(): void
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
        $this->assertStringContainsString('maksimal 3 MB', (string) $response->json('error'));
    }

    public function test_assignment_presentation_upload_is_limited_to_five_mb_when_drive_is_not_ready(): void
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
        $this->assertStringContainsString('maksimal 5 MB', (string) $response->json('error'));
    }

    public function test_assignment_direct_upload_returns_presigned_object_storage_url_when_enabled(): void
    {
        config([
            'services.assignment_object_storage.enabled' => true,
            'services.assignment_object_storage.label' => 'Cloudflare R2',
            'services.assignment_object_storage.key' => 'test-access-key',
            'services.assignment_object_storage.secret' => 'test-secret-key',
            'services.assignment_object_storage.region' => 'auto',
            'services.assignment_object_storage.bucket' => 'edusmart-assignments',
            'services.assignment_object_storage.endpoint' => 'https://account-id.r2.cloudflarestorage.com',
            'services.assignment_object_storage.use_path_style_endpoint' => true,
            'services.assignment_object_storage.expires_seconds' => 900,
        ]);

        $tenantId = $this->defaultTenantId();
        [$user] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');
        Sanctum::actingAs($user);

        $response = $this->postJson('/api/storage/direct-upload', [
            'bucket' => 'assignments',
            'path' => 'X-1/'.$user->id.'-jawaban.pdf',
            'filename' => 'jawaban.pdf',
            'mime_type' => 'application/pdf',
            'size_bytes' => 512 * 1024,
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.available', true);
        $response->assertJsonPath('data.provider', 'object_storage');
        $response->assertJsonPath('data.providerLabel', 'Cloudflare R2');
        $response->assertJsonPath('data.upload.method', 'PUT');
        $response->assertJsonPath('data.upload.headers.Content-Type', 'application/pdf');

        $uploadUrl = (string) $response->json('data.upload.url');
        $this->assertStringContainsString('X-Amz-Signature=', $uploadUrl);
        $this->assertStringContainsString('/edusmart-assignments/private/assignments/X-1/', $uploadUrl);
        $this->assertStringNotContainsString('test-secret-key', $uploadUrl);
    }

    public function test_assignment_direct_upload_rejects_oversized_image_metadata(): void
    {
        config([
            'services.assignment_object_storage.enabled' => true,
            'services.assignment_object_storage.key' => 'test-access-key',
            'services.assignment_object_storage.secret' => 'test-secret-key',
            'services.assignment_object_storage.region' => 'auto',
            'services.assignment_object_storage.bucket' => 'edusmart-assignments',
            'services.assignment_object_storage.endpoint' => 'https://account-id.r2.cloudflarestorage.com',
            'services.assignment_object_storage.use_path_style_endpoint' => true,
        ]);

        $tenantId = $this->defaultTenantId();
        [$user] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');
        Sanctum::actingAs($user);

        $response = $this->postJson('/api/storage/direct-upload', [
            'bucket' => 'assignments',
            'path' => 'X-1/'.$user->id.'-foto.jpg',
            'filename' => 'foto.jpg',
            'mime_type' => 'image/jpeg',
            'size_bytes' => 1024 * 1024,
        ]);

        $response->assertStatus(422);
        $this->assertStringContainsString('gambar tugas maksimal', (string) $response->json('error'));
    }

    public function test_quiz_media_upload_uses_google_drive_when_connected_and_can_be_rendered(): void
    {
        config([
            'services.google.drive.enabled' => true,
            'services.google.drive.client_id' => 'client-id',
            'services.google.drive.client_secret' => 'client-secret',
        ]);

        $tenantId = $this->defaultTenantId();
        [$guru] = $this->createUserWithProfile($tenantId, 'guru', 'X-1');
        Sanctum::actingAs($guru);

        TenantGoogleDriveConfig::query()->create([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'connected_by_user_id' => $guru->id,
            'status' => 'connected',
            'is_enabled' => true,
            'google_account_email' => 'drive@example.com',
            'drive_folder_id' => 'school-folder',
            'drive_folder_name' => 'EduSmart Presensi',
            'access_token' => 'valid-token',
            'refresh_token' => 'refresh-token',
            'token_expires_at' => now()->addHour(),
        ]);

        $quizId = (string) Str::uuid();
        DB::table('quizzes')->insert([
            'id' => $quizId,
            'tenant_id' => $tenantId,
            'guru_id' => $guru->id,
            'kelas_id' => 'X-1',
            'mapel' => 'Matematika',
            'nama' => 'Quiz Gambar',
            'tahun_ajaran' => '2025/2026',
            'semester' => 'Ganjil',
            'angkatan' => '2025',
            'is_live' => false,
            'is_active' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Http::fake(function ($request) {
            $url = $request->url();
            $query = parse_url($url, PHP_URL_QUERY) ?: '';

            if (str_contains($url, '/drive/v3/files/school-folder')) {
                return Http::response([
                    'id' => 'school-folder',
                    'name' => 'EduSmart Presensi',
                    'mimeType' => 'application/vnd.google-apps.folder',
                    'webViewLink' => 'https://drive.google.com/drive/folders/school-folder',
                    'trashed' => false,
                ]);
            }

            if (str_contains($url, '/upload/drive/v3/files')) {
                return Http::response([
                    'id' => 'quiz-image-file',
                    'name' => 'question.jpg',
                    'mimeType' => 'image/jpeg',
                    'size' => '512',
                    'webViewLink' => 'https://drive.google.com/file/d/quiz-image-file/view',
                    'webContentLink' => 'https://drive.google.com/uc?id=quiz-image-file',
                ]);
            }

            if (str_contains($url, '/drive/v3/files/quiz-image-file/permissions')) {
                return Http::response(['id' => 'permission-id']);
            }

            if (str_contains($url, '/drive/v3/files/quiz-image-file') && str_contains($query, 'alt=media')) {
                return Http::response('image-bytes', 200, ['Content-Type' => 'image/jpeg']);
            }

            if (str_contains($url, '/drive/v3/files/quiz-image-file')) {
                return Http::response([
                    'id' => 'quiz-image-file',
                    'name' => 'question.jpg',
                    'mimeType' => 'image/jpeg',
                    'size' => '512',
                    'webViewLink' => 'https://drive.google.com/file/d/quiz-image-file/view',
                    'webContentLink' => 'https://drive.google.com/uc?id=quiz-image-file',
                    'createdTime' => now()->toIso8601String(),
                ]);
            }

            if (str_contains($url, '/drive/v3/about')) {
                return Http::response([
                    'storageQuota' => ['usage' => '512', 'limit' => '1000000', 'usageInDrive' => '512'],
                    'user' => ['emailAddress' => 'drive@example.com', 'displayName' => 'Drive User'],
                ]);
            }

            if (str_contains($url, '/drive/v3/files') && $request->method() === 'GET') {
                return Http::response(['files' => []]);
            }

            if (str_contains($url, '/drive/v3/files') && $request->method() === 'POST') {
                return Http::response([
                    'id' => 'folder-'.Str::random(8),
                    'name' => 'Folder',
                    'webViewLink' => 'https://drive.google.com/drive/folders/folder-id',
                ]);
            }

            return Http::response(['error' => ['message' => 'Unexpected URL '.$url]], 500);
        });

        $objectPath = 'quiz-media/'.$guru->id.'/'.$quizId.'/question-test.jpg';
        $upload = $this->post('/api/storage/upload', [
            'bucket' => 'quiz-media',
            'path' => $objectPath,
            'file' => UploadedFile::fake()->create('question.jpg', 10, 'image/jpeg'),
        ]);

        $upload->assertOk();
        $upload->assertJsonPath('data.provider', 'google_drive');
        $driveUrl = (string) $upload->json('data.path');
        $this->assertSame('https://drive.google.com/file/d/quiz-image-file/view', $driveUrl);

        $this->assertDatabaseHas('tenant_google_drive_files', [
            'tenant_id' => $tenantId,
            'bucket' => 'quiz-media',
            'drive_file_id' => 'quiz-image-file',
            'source_path' => $objectPath,
            'kelas' => 'X-1',
            'tahun_ajaran' => '2025/2026',
            'semester' => 'Ganjil',
            'angkatan' => '2025',
        ]);

        $image = $this->get('/api/storage/object?bucket=quiz-media&path='.urlencode($driveUrl));
        $image->assertOk();
        $this->assertSame('image/jpeg', $image->headers->get('Content-Type'));
        $this->assertSame('image-bytes', $image->getContent());
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
