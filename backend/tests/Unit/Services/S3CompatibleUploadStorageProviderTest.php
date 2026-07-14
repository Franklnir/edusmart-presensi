<?php

namespace Tests\Unit\Services;

use App\Services\Storage\S3CompatibleUploadStorageProvider;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class S3CompatibleUploadStorageProviderTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config([
            'api_v2.uploads.logical_bucket' => 'assignments',
            'services.object_storage.enabled' => true,
            'services.object_storage.browser_direct_enabled' => true,
            'services.object_storage.verify_uploads' => true,
            'services.object_storage.verify_attempts' => 1,
            'services.object_storage.key' => 'test-access-key',
            'services.object_storage.secret' => 'test-secret-key',
            'services.object_storage.region' => 'us-east-1',
            'services.object_storage.endpoint' => 'https://objects.test',
            'services.object_storage.use_path_style_endpoint' => true,
            'services.object_storage.bucket' => 'default-bucket',
            'services.object_storage.bucket_map' => ['assignments' => 'assignment-bucket'],
            'services.object_storage.direct_upload_buckets' => ['assignments'],
        ]);
    }

    public function test_actual_provider_initiates_verifies_downloads_and_deletes_fixed_bucket_object(): void
    {
        Http::fake([
            'https://objects.test/assignment-bucket/*' => Http::response('', 200, [
                'Content-Length' => '4',
                'Content-Type' => 'application/pdf',
                'x-amz-checksum-sha256' => 'checksum-value',
            ]),
        ]);

        $provider = app(S3CompatibleUploadStorageProvider::class);
        $this->assertTrue($provider->ready());
        $this->assertSame('assignment-bucket', $provider->bucket());

        $instruction = $provider->initiate('tenant/file.pdf', 'application/pdf', 4, now()->addMinutes(10));
        $this->assertSame('PUT', $instruction['method']);
        $this->assertStringContainsString('/assignment-bucket/tenant/file.pdf?', $instruction['url']);
        $this->assertSame('application/pdf', $instruction['headers']['Content-Type']);

        $verification = $provider->verify('tenant/file.pdf', 4, 'application/pdf');
        $this->assertTrue($verification['exists']);
        $this->assertSame(4, $verification['actual_size']);
        $this->assertSame('application/pdf', $verification['content_type']);
        $this->assertSame('checksum-value', $verification['checksum_sha256']);

        $download = $provider->temporaryDownloadUrl('tenant/file.pdf', 600);
        $this->assertSame('GET', $download['method']);
        $this->assertTrue($provider->delete('tenant/file.pdf'));
    }
}
