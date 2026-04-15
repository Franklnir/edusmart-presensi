<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;
use ZipArchive;

class SuperPluginManagementTest extends TestCase
{
    use RefreshDatabase;

    public function test_super_admin_can_inspect_install_toggle_download_and_delete_plugin(): void
    {
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);

        Storage::fake('local');
        $superAdmin = $this->createSuperAdmin();
        $upload = $this->makePluginUpload([
            'name' => 'Plugin Akademik Pro',
            'slug' => 'plugin-akademik-pro',
            'version' => '1.0.0',
            'description' => 'Plugin akademik tambahan.',
            'details' => 'Menyediakan paket fitur akademik tambahan.',
            'github_url' => 'https://github.com/edusmart/plugin-akademik-pro',
            'author' => [
                'name' => 'Tim EduSmart',
                'email' => 'plugin@edusmart.id',
            ],
            'compatibility' => [
                'min_app_version' => '1.0.0',
                'max_app_version' => '2.0.0',
            ],
            'capabilities' => [
                'laporan-akademik',
                'rekap-khusus',
            ],
        ], [
            'README.md' => "# Plugin Akademik Pro\n\nPlugin tambahan untuk sekolah.\n",
            'assets/info.txt' => 'metadata-info',
        ]);

        $inspect = $this
            ->actingAs($superAdmin)
            ->post('http://admin.edusmart.test/api/super/plugins/inspect', [
                'plugin_zip' => $upload,
            ]);

        $inspect
            ->assertCreated()
            ->assertJsonPath('data.slug', 'plugin-akademik-pro')
            ->assertJsonPath('data.version', '1.0.0')
            ->assertJsonPath('data.manifest.github_url', 'https://github.com/edusmart/plugin-akademik-pro');

        $draftId = (string) $inspect->json('data.id');
        $this->assertNotSame('', $draftId);

        $install = $this
            ->actingAs($superAdmin)
            ->postJson('http://admin.edusmart.test/api/super/plugins', [
                'draft_id' => $draftId,
            ]);

        $install
            ->assertCreated()
            ->assertJsonPath('data.slug', 'plugin-akademik-pro')
            ->assertJsonPath('data.is_active', false)
            ->assertJsonPath('data.uploaded_by.email', 'super-admin@example.com');

        $pluginId = (string) $install->json('data.id');
        $this->assertDatabaseHas('system_plugins', [
            'id' => $pluginId,
            'slug' => 'plugin-akademik-pro',
            'version' => '1.0.0',
            'is_active' => 0,
        ]);

        $pluginRow = DB::table('system_plugins')->where('id', $pluginId)->first();
        $this->assertNotNull($pluginRow);
        Storage::disk('local')->assertExists((string) $pluginRow->package_path);
        Storage::disk('local')->assertExists((string) $pluginRow->extract_path.'/README.md');

        $this
            ->actingAs($superAdmin)
            ->patchJson("http://admin.edusmart.test/api/super/plugins/{$pluginId}/status", [
                'is_active' => true,
            ])
            ->assertOk()
            ->assertJsonPath('data.is_active', true);

        $this
            ->actingAs($superAdmin)
            ->get("http://admin.edusmart.test/api/super/plugins/{$pluginId}/download")
            ->assertOk()
            ->assertHeader('content-disposition', 'attachment; filename=plugin-akademik-pro-1.0.0.zip');

        $this
            ->actingAs($superAdmin)
            ->deleteJson("http://admin.edusmart.test/api/super/plugins/{$pluginId}", [])
            ->assertStatus(422)
            ->assertJsonPath('error', 'Penghapusan plugin harus dikonfirmasi terlebih dahulu.');

        $this
            ->actingAs($superAdmin)
            ->deleteJson("http://admin.edusmart.test/api/super/plugins/{$pluginId}", [
                'confirm' => true,
            ])
            ->assertOk()
            ->assertJsonPath('data.deleted', true)
            ->assertJsonPath('data.plugin.slug', 'plugin-akademik-pro');

        $this->assertDatabaseMissing('system_plugins', [
            'id' => $pluginId,
        ]);
        Storage::disk('local')->assertMissing((string) $pluginRow->package_path);
        Storage::disk('local')->assertMissing((string) $pluginRow->extract_path.'/README.md');
    }

    public function test_plugin_inspection_rejects_archives_with_blocked_server_files(): void
    {
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);

        Storage::fake('local');
        $superAdmin = $this->createSuperAdmin();
        $upload = $this->makePluginUpload([
            'name' => 'Plugin Berbahaya',
            'slug' => 'plugin-berbahaya',
            'version' => '0.0.1',
        ], [
            'README.md' => 'README aman',
            'evil.php' => '<?php echo "hack";',
        ]);

        $this
            ->actingAs($superAdmin)
            ->post('http://admin.edusmart.test/api/super/plugins/inspect', [
                'plugin_zip' => $upload,
            ])
            ->assertStatus(422)
            ->assertJsonPath('error', 'ZIP plugin mengandung file yang tidak diizinkan: evil.php');
    }

    private function createSuperAdmin(): User
    {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => 'Super Admin',
            'email' => 'super-admin@example.com',
            'password' => Hash::make('password123'),
        ]);

        DB::table('super_admins')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $user->id,
            'email' => $user->email,
            'name' => $user->name,
            'created_at' => now(),
        ]);

        return $user;
    }

    private function makePluginUpload(array $manifest, array $extraFiles = []): UploadedFile
    {
        $tempBase = tempnam(sys_get_temp_dir(), 'plugin-zip-');
        if ($tempBase === false) {
            throw new \RuntimeException('Gagal membuat file sementara untuk test plugin.');
        }

        @unlink($tempBase);
        $zipPath = $tempBase.'.zip';

        $zip = new ZipArchive();
        $result = $zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE);
        if ($result !== true) {
            throw new \RuntimeException('Gagal membuat file ZIP untuk test plugin.');
        }

        $zip->addFromString(
            'plugin.json',
            json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
        );

        foreach ($extraFiles as $path => $contents) {
            $zip->addFromString((string) $path, (string) $contents);
        }

        $zip->close();

        $contents = file_get_contents($zipPath);
        if ($contents === false) {
            @unlink($zipPath);
            throw new \RuntimeException('Gagal membaca ZIP test plugin.');
        }

        @unlink($zipPath);

        return UploadedFile::fake()->createWithContent('plugin-package.zip', $contents);
    }
}
