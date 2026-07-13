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
        $response->assertJsonPath('message', 'Ekstensi file tidak diizinkan');
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
        $this->assertStringContainsString('maksimal 3 MB', (string) $response->json('message'));
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
        $this->assertStringContainsString('maksimal 5 MB', (string) $response->json('message'));
    }

    public function test_assignment_direct_upload_returns_presigned_object_storage_url_when_enabled(): void
    {
        config([
            'services.object_storage.enabled' => true,
            'services.object_storage.browser_direct_enabled' => true,
            'services.object_storage.label' => 'Cloudflare R2',
            'services.object_storage.key' => 'test-access-key',
            'services.object_storage.secret' => 'test-secret-key',
            'services.object_storage.region' => 'auto',
            'services.object_storage.bucket' => 'edusmart-assignments',
            'services.object_storage.bucket_map' => [],
            'services.object_storage.endpoint' => 'https://account-id.r2.cloudflarestorage.com',
            'services.object_storage.use_path_style_endpoint' => true,
            'services.object_storage.expires_seconds' => 900,
            'services.object_storage.direct_upload_buckets' => ['assignments', 'quiz-media'],
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

    public function test_quiz_media_direct_upload_returns_presigned_object_storage_url_when_enabled(): void
    {
        config([
            'services.object_storage.enabled' => true,
            'services.object_storage.browser_direct_enabled' => true,
            'services.object_storage.label' => 'Nevaobjects S3',
            'services.object_storage.key' => 'test-access-key',
            'services.object_storage.secret' => 'test-secret-key',
            'services.object_storage.region' => 'us-east-1',
            'services.object_storage.bucket' => '',
            'services.object_storage.bucket_map' => [
                'assignments' => 'assignments',
                'quiz-media' => 'quiz-media',
            ],
            'services.object_storage.endpoint' => 'https://s3.nevaobjects.id',
            'services.object_storage.use_path_style_endpoint' => true,
            'services.object_storage.expires_seconds' => 900,
            'services.object_storage.direct_upload_buckets' => ['assignments', 'quiz-media'],
        ]);

        $tenantId = $this->defaultTenantId();
        [$guru] = $this->createUserWithProfile($tenantId, 'guru', 'X-1');
        Sanctum::actingAs($guru);

        $response = $this->postJson('/api/storage/direct-upload', [
            'bucket' => 'quiz-media',
            'path' => 'quiz-media/'.$guru->id.'/quiz-1/question.jpg',
            'filename' => 'question.jpg',
            'mime_type' => 'image/jpeg',
            'size_bytes' => 40 * 1024,
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.available', true);
        $response->assertJsonPath('data.provider', 'object_storage');
        $response->assertJsonPath('data.providerLabel', 'Nevaobjects S3');
        $response->assertJsonPath('data.upload.method', 'PUT');
        $response->assertJsonPath('data.upload.headers.Content-Type', 'image/jpeg');

        $uploadUrl = (string) $response->json('data.upload.url');
        $this->assertStringContainsString('X-Amz-Signature=', $uploadUrl);
        $this->assertStringContainsString('/quiz-media/private/quiz-media/quiz-media/'.$guru->id.'/', $uploadUrl);
    }

    public function test_quiz_media_object_storage_read_is_proxied_to_app_origin(): void
    {
        Storage::fake('local');
        config([
            'services.object_storage.enabled' => true,
            'services.object_storage.label' => 'Nevaobjects S3',
            'services.object_storage.key' => 'test-access-key',
            'services.object_storage.secret' => 'test-secret-key',
            'services.object_storage.region' => 'us-east-1',
            'services.object_storage.bucket' => '',
            'services.object_storage.bucket_map' => [
                'quiz-media' => 'quiz-media',
            ],
            'services.object_storage.endpoint' => 'https://s3.nevaobjects.id',
            'services.object_storage.use_path_style_endpoint' => true,
            'services.object_storage.direct_upload_buckets' => ['quiz-media'],
        ]);

        $tenantId = $this->defaultTenantId();
        [$guru] = $this->createUserWithProfile($tenantId, 'guru', 'X-1');
        Sanctum::actingAs($guru);

        $objectPath = 'quiz-media/'.$guru->id.'/quiz-1/question.jpg';
        $storageGetSeen = false;
        Http::fake(function ($request) use (&$storageGetSeen, $guru) {
            if ($request->method() === 'GET') {
                $storageGetSeen = true;
                $this->assertStringContainsString(
                    '/quiz-media/private/quiz-media/quiz-media/'.$guru->id.'/quiz-1/question.jpg',
                    $request->url()
                );

                return Http::response('image-bytes', 200, [
                    'Content-Type' => 'image/jpeg',
                    'Content-Length' => '11',
                    'ETag' => '"quiz-media-etag"',
                ]);
            }

            return Http::response('Unexpected storage request', 500);
        });

        $response = $this->get('/api/storage/object?bucket=quiz-media&path='.urlencode($objectPath));

        $response->assertOk();
        $this->assertSame('image/jpeg', $response->headers->get('Content-Type'));
        $this->assertSame('image-bytes', $response->getContent());
        $this->assertTrue($storageGetSeen, 'Object storage GET tidak terpanggil.');
    }

    public function test_api_upload_relays_to_object_storage_when_direct_upload_needs_backend_fallback(): void
    {
        Storage::fake('local');
        config([
            'services.object_storage.enabled' => true,
            'services.object_storage.label' => 'Nevaobjects S3',
            'services.object_storage.key' => 'test-access-key',
            'services.object_storage.secret' => 'test-secret-key',
            'services.object_storage.region' => 'us-east-1',
            'services.object_storage.bucket' => '',
            'services.object_storage.bucket_map' => [
                'assignments' => 'assignments',
            ],
            'services.object_storage.endpoint' => 'https://s3.nevaobjects.id',
            'services.object_storage.use_path_style_endpoint' => true,
            'services.object_storage.verify_uploads' => true,
            'services.object_storage.verify_attempts' => 2,
            'services.object_storage.verify_retry_delay_ms' => 0,
            'services.object_storage.direct_upload_buckets' => ['assignments'],
        ]);

        $tenantId = $this->defaultTenantId();
        [$user] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');
        Sanctum::actingAs($user);

        $expectedBytes = 512 * 1024;
        $putSeen = false;
        $headSeen = false;
        Http::fake(function ($request) use (&$putSeen, &$headSeen, $expectedBytes, $user) {
            if ($request->method() === 'PUT') {
                $putSeen = true;
                $this->assertStringContainsString(
                    '/assignments/private/assignments/X-1/'.$user->id.'-jawaban.pdf',
                    $request->url()
                );

                return Http::response('', 200, ['ETag' => '"object-etag"']);
            }

            if ($request->method() === 'HEAD') {
                $headSeen = true;

                return Http::response('', 200, ['Content-Length' => (string) $expectedBytes]);
            }

            return Http::response('Unexpected storage request', 500);
        });

        $path = 'X-1/'.$user->id.'-jawaban.pdf';
        $response = $this->post('/api/storage/upload', [
            'bucket' => 'assignments',
            'path' => $path,
            'fast_local' => 'true',
            'file' => UploadedFile::fake()->create('jawaban.pdf', 512, 'application/pdf'),
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.provider', 'object_storage');
        $response->assertJsonPath('data.providerLabel', 'Nevaobjects S3');
        $response->assertJsonPath('data.serverRelay', true);
        $this->assertTrue($putSeen, 'Server-side object storage PUT tidak terpanggil.');
        $this->assertTrue($headSeen, 'Verifikasi HEAD object storage tidak terpanggil.');
        Storage::disk('local')->assertMissing('private/assignments/'.$path);
        $this->assertDatabaseHas('storage_files', [
            'tenant_id' => $tenantId,
            'bucket' => 'assignments',
            'path' => $path,
            'provider' => 'object_storage',
            'size_bytes' => $expectedBytes,
        ]);
    }

    public function test_server_relay_keeps_object_storage_when_head_is_not_ready_after_put(): void
    {
        Storage::fake('local');
        config([
            'services.object_storage.enabled' => true,
            'services.object_storage.label' => 'Nevaobjects S3',
            'services.object_storage.key' => 'test-access-key',
            'services.object_storage.secret' => 'test-secret-key',
            'services.object_storage.region' => 'us-east-1',
            'services.object_storage.bucket' => '',
            'services.object_storage.bucket_map' => [
                'assignments' => 'assignments',
            ],
            'services.object_storage.endpoint' => 'https://s3.nevaobjects.id',
            'services.object_storage.use_path_style_endpoint' => true,
            'services.object_storage.verify_uploads' => true,
            'services.object_storage.verify_attempts' => 1,
            'services.object_storage.verify_retry_delay_ms' => 0,
            'services.object_storage.direct_upload_buckets' => ['assignments'],
        ]);

        Http::fake(function ($request) {
            if ($request->method() === 'PUT') {
                return Http::response('', 200, ['ETag' => '"object-etag"']);
            }

            if ($request->method() === 'HEAD') {
                return Http::response('', 404);
            }

            return Http::response('Unexpected storage request', 500);
        });

        $tenantId = $this->defaultTenantId();
        [$user] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');
        Sanctum::actingAs($user);

        $path = 'X-1/'.$user->id.'-jawaban.pdf';
        $response = $this->post('/api/storage/upload', [
            'bucket' => 'assignments',
            'path' => $path,
            'fast_local' => 'true',
            'file' => UploadedFile::fake()->create('jawaban.pdf', 512, 'application/pdf'),
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.provider', 'object_storage');
        $response->assertJsonPath('data.physicalBucket', 'assignments');
        $response->assertJsonPath('data.serverRelay', true);
        $response->assertJsonPath('data.verificationWarning', 'object_not_ready_after_server_put');
        Storage::disk('local')->assertMissing('private/assignments/'.$path);
        $this->assertDatabaseHas('storage_files', [
            'tenant_id' => $tenantId,
            'bucket' => 'assignments',
            'path' => $path,
            'provider' => 'object_storage',
        ]);
    }

    public function test_direct_upload_can_be_disabled_while_object_storage_relay_stays_enabled(): void
    {
        config([
            'services.object_storage.enabled' => true,
            'services.object_storage.browser_direct_enabled' => false,
            'services.object_storage.label' => 'Nevaobjects S3',
            'services.object_storage.key' => 'test-access-key',
            'services.object_storage.secret' => 'test-secret-key',
            'services.object_storage.region' => 'us-east-1',
            'services.object_storage.bucket' => '',
            'services.object_storage.bucket_map' => [
                'assignments' => 'assignments',
            ],
            'services.object_storage.endpoint' => 'https://s3.nevaobjects.id',
            'services.object_storage.use_path_style_endpoint' => true,
            'services.object_storage.direct_upload_buckets' => ['assignments'],
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
        $response->assertJsonPath('data.available', false);
        $response->assertJsonPath('data.provider', 'api');
    }

    public function test_confirm_direct_upload_rejects_missing_object_storage_file(): void
    {
        config([
            'services.object_storage.enabled' => true,
            'services.object_storage.browser_direct_enabled' => true,
            'services.object_storage.key' => 'test-access-key',
            'services.object_storage.secret' => 'test-secret-key',
            'services.object_storage.region' => 'auto',
            'services.object_storage.bucket' => 'edusmart-storage',
            'services.object_storage.bucket_map' => [],
            'services.object_storage.endpoint' => 'https://account-id.r2.cloudflarestorage.com',
            'services.object_storage.use_path_style_endpoint' => true,
            'services.object_storage.verify_uploads' => true,
            'services.object_storage.verify_attempts' => 2,
            'services.object_storage.verify_retry_delay_ms' => 0,
            'services.object_storage.direct_upload_buckets' => ['assignments'],
        ]);

        Http::fake([
            '*' => Http::response('', 404),
        ]);

        $tenantId = $this->defaultTenantId();
        [$user] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');
        Sanctum::actingAs($user);

        $response = $this->postJson('/api/storage/confirm-upload', [
            'bucket' => 'assignments',
            'path' => 'X-1/'.$user->id.'-jawaban.pdf',
            'provider' => 'object_storage',
            'filename' => 'jawaban.pdf',
            'mime_type' => 'application/pdf',
            'size_bytes' => 512 * 1024,
            'object_key' => 'private/assignments/X-1/'.$user->id.'-jawaban.pdf',
        ]);

        $response->assertStatus(422);
        $response->assertJsonPath('code', 'OBJECT_STORAGE_NOT_READY');
        $response->assertJsonPath('retryable', true);
        $this->assertStringContainsString('belum ditemukan', (string) $response->json('message'));
    }

    public function test_confirm_direct_upload_waits_for_eventually_available_object_storage_file(): void
    {
        config([
            'services.object_storage.enabled' => true,
            'services.object_storage.browser_direct_enabled' => true,
            'services.object_storage.key' => 'test-access-key',
            'services.object_storage.secret' => 'test-secret-key',
            'services.object_storage.region' => 'auto',
            'services.object_storage.bucket' => 'edusmart-storage',
            'services.object_storage.bucket_map' => [],
            'services.object_storage.endpoint' => 'https://account-id.r2.cloudflarestorage.com',
            'services.object_storage.use_path_style_endpoint' => true,
            'services.object_storage.verify_uploads' => true,
            'services.object_storage.verify_attempts' => 3,
            'services.object_storage.verify_retry_delay_ms' => 0,
            'services.object_storage.direct_upload_buckets' => ['assignments'],
        ]);

        $expectedBytes = 512 * 1024;
        $headAttempts = 0;
        Http::fake(function ($request) use (&$headAttempts, $expectedBytes) {
            if ($request->method() === 'HEAD') {
                $headAttempts++;

                return $headAttempts < 2
                    ? Http::response('', 404)
                    : Http::response('', 200, ['Content-Length' => (string) $expectedBytes]);
            }

            return Http::response('Unexpected storage request', 500);
        });

        $tenantId = $this->defaultTenantId();
        [$user] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');
        Sanctum::actingAs($user);

        $path = 'X-1/'.$user->id.'-jawaban.pdf';
        $response = $this->postJson('/api/storage/confirm-upload', [
            'bucket' => 'assignments',
            'path' => $path,
            'provider' => 'object_storage',
            'filename' => 'jawaban.pdf',
            'mime_type' => 'application/pdf',
            'size_bytes' => $expectedBytes,
            'object_key' => 'private/assignments/'.$path,
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.provider', 'object_storage');
        $response->assertJsonPath('data.objectKey', 'private/assignments/'.$path);
        $this->assertSame(2, $headAttempts);
        $this->assertDatabaseHas('storage_files', [
            'tenant_id' => $tenantId,
            'bucket' => 'assignments',
            'path' => $path,
            'provider' => 'object_storage',
            'size_bytes' => $expectedBytes,
        ]);
    }

    public function test_assignment_direct_upload_rejects_oversized_image_metadata(): void
    {
        config([
            'services.object_storage.enabled' => true,
            'services.object_storage.browser_direct_enabled' => true,
            'services.object_storage.key' => 'test-access-key',
            'services.object_storage.secret' => 'test-secret-key',
            'services.object_storage.region' => 'auto',
            'services.object_storage.bucket' => 'edusmart-assignments',
            'services.object_storage.bucket_map' => [],
            'services.object_storage.endpoint' => 'https://account-id.r2.cloudflarestorage.com',
            'services.object_storage.use_path_style_endpoint' => true,
            'services.object_storage.direct_upload_buckets' => ['assignments'],
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
        $this->assertStringContainsString('gambar tugas maksimal', (string) $response->json('message'));
    }

    public function test_quiz_media_upload_requires_object_storage_even_when_google_drive_is_connected(): void
    {
        config([
            'services.google.drive.enabled' => true,
            'services.google.drive.client_id' => 'client-id',
            'services.google.drive.client_secret' => 'client-secret',
            'services.object_storage.enabled' => false,
            'services.object_storage.direct_upload_buckets' => [],
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

        $upload->assertStatus(422);
        $upload->assertJsonPath('code', 'OBJECT_STORAGE_REQUIRED');
        $this->assertDatabaseMissing('tenant_google_drive_files', [
            'tenant_id' => $tenantId,
            'bucket' => 'quiz-media',
            'source_path' => $objectPath,
        ]);
    }

    public function test_admin_storage_summary_is_scoped_to_its_own_school_even_when_filtered(): void
    {
        $tenantA = $this->defaultTenantId();
        $tenantB = $this->createTenant('Sekolah Lain', 'sekolah-lain');
        [$admin] = $this->createUserWithProfile($tenantA, 'admin', 'X-1');
        Sanctum::actingAs($admin);

        DB::table('tenant_storage_quotas')->insert([
            [
                'id' => (string) Str::uuid(),
                'tenant_id' => $tenantA,
                'quota_bytes' => 5 * 1024 * 1024,
                'vps_quota_bytes' => 5 * 1024 * 1024,
                'neva_s3_quota_bytes' => 3 * 1024 * 1024,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => (string) Str::uuid(),
                'tenant_id' => $tenantB,
                'quota_bytes' => 50 * 1024 * 1024,
                'vps_quota_bytes' => 50 * 1024 * 1024,
                'neva_s3_quota_bytes' => 40 * 1024 * 1024,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $tenantAFilteredBytes = 240 * 1024;
        $tenantAOtherBytes = 80 * 1024;
        $tenantBBytes = 9 * 1024 * 1024;

        $this->insertStorageFile($tenantA, [
            'bucket' => 'assignments',
            'path' => 'private/assignments/tenant-a/tugas.pdf',
            'provider' => 'object_storage',
            'category' => 'tugas',
            'file_name' => 'tugas.pdf',
            'size_bytes' => $tenantAFilteredBytes,
            'tahun_ajaran' => '2025/2026',
            'semester' => 'Genap',
        ]);
        $this->insertStorageFile($tenantA, [
            'bucket' => 'quiz-media',
            'path' => 'private/quiz-media/tenant-a/gambar.jpg',
            'provider' => 'object_storage',
            'category' => 'kuis',
            'file_name' => 'gambar.jpg',
            'size_bytes' => $tenantAOtherBytes,
            'tahun_ajaran' => '2025/2026',
            'semester' => 'Ganjil',
        ]);
        $this->insertStorageFile($tenantB, [
            'bucket' => 'assignments',
            'path' => 'private/assignments/tenant-b/besar.pdf',
            'provider' => 'object_storage',
            'category' => 'tugas',
            'file_name' => 'besar.pdf',
            'size_bytes' => $tenantBBytes,
            'tahun_ajaran' => '2025/2026',
            'semester' => 'Genap',
        ]);

        $response = $this->getJson('/api/admin/storage-manager?tahun_ajaran=2025%2F2026&semester=Genap&category=tugas');

        $response->assertOk();
        $response->assertJsonPath('data.usage.total_bytes', $tenantAFilteredBytes);
        $response->assertJsonPath('data.provider_summaries.neva_s3.usage.total_bytes', $tenantAFilteredBytes);
        $response->assertJsonPath('data.quota.providers.neva_s3.used_bytes', $tenantAFilteredBytes + $tenantAOtherBytes);
        $response->assertJsonPath('data.quota.providers.neva_s3.remaining_bytes', (3 * 1024 * 1024) - ($tenantAFilteredBytes + $tenantAOtherBytes));

        $periodOptions = collect($response->json('data.period_options'));
        $schoolYearOption = $periodOptions->firstWhere('tahun_ajaran', '2025/2026');
        $this->assertNotNull($schoolYearOption);
        $this->assertSame('', $schoolYearOption['semester'] ?? '');
        $this->assertSame($tenantAFilteredBytes + $tenantAOtherBytes, $schoolYearOption['bytes'] ?? null);

        $categoryOptions = collect($response->json('data.category_options'));
        $this->assertTrue($categoryOptions->contains(fn ($category) => ($category['value'] ?? null) === 'tugas'
            && in_array('assignments', $category['buckets'] ?? [], true)));
        $this->assertFalse($categoryOptions->contains(fn ($category) => ($category['bytes'] ?? null) === $tenantBBytes));

        $largestFiles = collect($response->json('data.largest_files'));
        $this->assertTrue($largestFiles->contains(fn ($file) => ($file['file_name'] ?? null) === 'tugas.pdf'));
        $this->assertFalse($largestFiles->contains(fn ($file) => ($file['file_name'] ?? null) === 'besar.pdf'));
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

    private function createTenant(string $name, string $slug): string
    {
        $tenantId = (string) Str::uuid();
        DB::table('tenants')->insert([
            'id' => $tenantId,
            'name' => $name,
            'slug' => $slug,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $tenantId;
    }

    private function insertStorageFile(string $tenantId, array $overrides = []): void
    {
        $path = (string) ($overrides['path'] ?? Str::uuid().'.pdf');
        DB::table('storage_files')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'bucket' => (string) ($overrides['bucket'] ?? 'assignments'),
            'path' => $path,
            'path_hash' => hash('sha256', $tenantId.'|'.$path),
            'provider' => (string) ($overrides['provider'] ?? 'local'),
            'category' => (string) ($overrides['category'] ?? 'dokumen'),
            'file_name' => $overrides['file_name'] ?? basename($path),
            'mime_type' => $overrides['mime_type'] ?? 'application/pdf',
            'extension' => $overrides['extension'] ?? 'pdf',
            'size_bytes' => (int) ($overrides['size_bytes'] ?? 1024),
            'uploaded_by_user_id' => $overrides['uploaded_by_user_id'] ?? null,
            'uploaded_by_role' => $overrides['uploaded_by_role'] ?? null,
            'source_table' => $overrides['source_table'] ?? null,
            'source_id' => $overrides['source_id'] ?? null,
            'tahun_ajaran' => $overrides['tahun_ajaran'] ?? null,
            'semester' => $overrides['semester'] ?? null,
            'periode_key' => $overrides['periode_key'] ?? null,
            'kelas' => $overrides['kelas'] ?? null,
            'status' => $overrides['status'] ?? 'active',
            'uploaded_at' => $overrides['uploaded_at'] ?? now(),
            'metadata' => json_encode($overrides['metadata'] ?? []),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
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
