<?php

namespace App\Services\Plugins;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use ZipArchive;

class PluginPackageService
{
    private const DISK = 'local';

    private const DRAFT_DIR = 'plugins/drafts';

    private const PACKAGE_DIR = 'plugins/packages';

    private const EXTRACT_DIR = 'plugins/extracted';

    private const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

    private const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024;

    private const MAX_FILES = 500;

    private const MAX_README_BYTES = 20 * 1024;

    private const DRAFT_EXPIRY_HOURS = 6;

    private const BLOCKED_EXTENSIONS = [
        'php',
        'phar',
        'phtml',
        'php3',
        'php4',
        'php5',
        'php7',
        'php8',
        'exe',
        'dll',
        'so',
        'bin',
        'bat',
        'cmd',
        'com',
        'msi',
        'sh',
        'bash',
        'zsh',
        'ksh',
        'csh',
        'fish',
        'ps1',
        'vbs',
        'cgi',
        'pl',
        'py',
        'rb',
        'jar',
        'node',
    ];

    public function listPlugins(): array
    {
        $this->purgeExpiredDrafts();

        return DB::table('system_plugins')
            ->orderByDesc('uploaded_at')
            ->orderBy('name')
            ->get()
            ->map(fn ($row) => $this->formatPluginRow($row))
            ->values()
            ->all();
    }

    public function inspectUploadedArchive(UploadedFile $file, array $actor = []): array
    {
        $this->purgeExpiredDrafts();
        $this->assertZipExtension($file->getClientOriginalName());

        $analysis = $this->analyzeArchive($file->getRealPath(), $file->getClientOriginalName());
        $draftId = (string) Str::uuid();
        $draftPath = self::DRAFT_DIR.'/'.$draftId.'.zip';
        $disk = Storage::disk(self::DISK);
        $disk->makeDirectory(self::DRAFT_DIR);

        $contents = file_get_contents($file->getRealPath());
        if ($contents === false) {
            throw new RuntimeException('File plugin tidak bisa dibaca.');
        }

        $disk->put($draftPath, $contents);

        DB::table('plugin_upload_drafts')->insert([
            'id' => $draftId,
            'slug' => $analysis['slug'],
            'name' => $analysis['name'],
            'version' => $analysis['version'],
            'original_filename' => $analysis['original_filename'],
            'temp_path' => $draftPath,
            'checksum_sha256' => $analysis['checksum_sha256'],
            'archive_size_bytes' => $analysis['archive_size_bytes'],
            'extracted_size_bytes' => $analysis['extracted_size_bytes'],
            'file_count' => $analysis['file_count'],
            'manifest_json' => json_encode($analysis['manifest']),
            'inspection_json' => json_encode($analysis),
            'inspected_by_user_id' => $this->actorValue($actor, 'user_id'),
            'inspected_by_name' => $this->actorValue($actor, 'name'),
            'inspected_by_email' => $this->actorValue($actor, 'email'),
            'inspected_at' => now(),
            'expires_at' => now()->addHours(self::DRAFT_EXPIRY_HOURS),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $draft = DB::table('plugin_upload_drafts')->where('id', $draftId)->first();
        $existing = DB::table('system_plugins')->where('slug', $analysis['slug'])->first();

        return $this->formatDraftRow($draft, $existing);
    }

    public function installDraft(string $draftId, bool $replaceExisting = false, array $actor = []): array
    {
        $this->purgeExpiredDrafts();

        $draft = DB::table('plugin_upload_drafts')->where('id', $draftId)->first();
        if (! $draft) {
            throw new RuntimeException('Draft plugin tidak ditemukan atau sudah kedaluwarsa.');
        }

        if ($draft->expires_at && now()->greaterThan($draft->expires_at)) {
            $this->deleteDraftStorage($draft);
            DB::table('plugin_upload_drafts')->where('id', $draftId)->delete();
            throw new RuntimeException('Draft plugin sudah kedaluwarsa. Silakan verifikasi ZIP lagi.');
        }

        $disk = Storage::disk(self::DISK);
        if (! $disk->exists((string) $draft->temp_path)) {
            DB::table('plugin_upload_drafts')->where('id', $draftId)->delete();
            throw new RuntimeException('Berkas draft plugin sudah tidak tersedia. Verifikasi ulang ZIP plugin.');
        }

        $sourcePath = $disk->path((string) $draft->temp_path);
        $analysis = $this->analyzeArchive($sourcePath, (string) $draft->original_filename);
        $existing = DB::table('system_plugins')->where('slug', $analysis['slug'])->first();

        if ($existing && ! $replaceExisting) {
            throw new RuntimeException(
                'Plugin dengan slug yang sama sudah ada. Konfirmasi penggantian versi terlebih dahulu.'
            );
        }

        $pluginId = $existing?->id ? (string) $existing->id : (string) Str::uuid();
        $installKey = (string) Str::uuid();
        $packagePath = self::PACKAGE_DIR.'/'.$analysis['slug'].'/'.$pluginId.'/'.$installKey.'.zip';
        $extractPath = self::EXTRACT_DIR.'/'.$analysis['slug'].'/'.$pluginId.'/'.$installKey;

        $disk->makeDirectory(dirname($packagePath));
        $contents = $disk->get((string) $draft->temp_path);
        if ($contents === null) {
            throw new RuntimeException('Berkas plugin tidak bisa diproses.');
        }

        $disk->put($packagePath, $contents);
        $this->extractArchive($sourcePath, $disk->path($extractPath));

        $before = $existing ? $this->formatPluginRow($existing) : null;
        $uploadedAt = now();

        $payload = [
            'slug' => $analysis['slug'],
            'name' => $analysis['name'],
            'version' => $analysis['version'],
            'description' => $analysis['description'],
            'details' => $analysis['details'],
            'github_url' => $analysis['github_url'],
            'homepage_url' => $analysis['homepage_url'],
            'author_name' => $analysis['author']['name'] ?? null,
            'author_email' => $analysis['author']['email'] ?? null,
            'package_filename' => $analysis['original_filename'],
            'package_path' => $packagePath,
            'extract_path' => $extractPath,
            'checksum_sha256' => $analysis['checksum_sha256'],
            'archive_size_bytes' => $analysis['archive_size_bytes'],
            'extracted_size_bytes' => $analysis['extracted_size_bytes'],
            'file_count' => $analysis['file_count'],
            'is_active' => false,
            'manifest_json' => json_encode($analysis['manifest']),
            'metadata_json' => json_encode($analysis['metadata']),
            'uploaded_by_user_id' => $this->actorValue($actor, 'user_id'),
            'uploaded_by_name' => $this->actorValue($actor, 'name'),
            'uploaded_by_email' => $this->actorValue($actor, 'email'),
            'uploaded_at' => $uploadedAt,
            'verified_at' => $uploadedAt,
            'updated_at' => $uploadedAt,
        ];

        if ($existing) {
            DB::table('system_plugins')->where('id', $pluginId)->update($payload);
        } else {
            DB::table('system_plugins')->insert(array_merge($payload, [
                'id' => $pluginId,
                'created_at' => $uploadedAt,
            ]));
        }

        DB::table('plugin_upload_drafts')->where('id', $draftId)->delete();
        $this->deleteDraftStorage($draft);

        if ($existing) {
            $this->deletePluginFiles($existing);
        }

        $plugin = DB::table('system_plugins')->where('id', $pluginId)->first();

        return [
            'plugin' => $this->formatPluginRow($plugin),
            'before' => $before,
            'replaced' => (bool) $existing,
        ];
    }

    public function setPluginStatus(string $pluginId, bool $isActive): array
    {
        $plugin = DB::table('system_plugins')->where('id', $pluginId)->first();
        if (! $plugin) {
            throw new RuntimeException('Plugin tidak ditemukan.');
        }

        $before = $this->formatPluginRow($plugin);

        DB::table('system_plugins')
            ->where('id', $pluginId)
            ->update([
                'is_active' => $isActive,
                'updated_at' => now(),
            ]);

        $after = DB::table('system_plugins')->where('id', $pluginId)->first();

        return [
            'before' => $before,
            'plugin' => $this->formatPluginRow($after),
        ];
    }

    public function deletePlugin(string $pluginId, bool $confirmed = false): array
    {
        if (! $confirmed) {
            throw new RuntimeException('Penghapusan plugin harus dikonfirmasi terlebih dahulu.');
        }

        $plugin = DB::table('system_plugins')->where('id', $pluginId)->first();
        if (! $plugin) {
            throw new RuntimeException('Plugin tidak ditemukan.');
        }

        $formatted = $this->formatPluginRow($plugin);

        DB::table('system_plugins')->where('id', $pluginId)->delete();
        $this->deletePluginFiles($plugin);

        return [
            'deleted' => true,
            'plugin' => $formatted,
        ];
    }

    public function downloadPayload(string $pluginId): array
    {
        $plugin = DB::table('system_plugins')->where('id', $pluginId)->first();
        if (! $plugin) {
            throw new RuntimeException('Plugin tidak ditemukan.');
        }

        $disk = Storage::disk(self::DISK);
        if (! $disk->exists((string) $plugin->package_path)) {
            throw new RuntimeException('Berkas plugin sudah tidak tersedia di server.');
        }

        return [
            'row' => $plugin,
            'download_name' => $this->downloadNameFromRow($plugin),
        ];
    }

    private function purgeExpiredDrafts(): void
    {
        $expired = DB::table('plugin_upload_drafts')
            ->whereNotNull('expires_at')
            ->where('expires_at', '<', now())
            ->get();

        foreach ($expired as $draft) {
            $this->deleteDraftStorage($draft);
        }

        DB::table('plugin_upload_drafts')
            ->whereNotNull('expires_at')
            ->where('expires_at', '<', now())
            ->delete();
    }

    private function analyzeArchive(string $zipPath, string $originalFilename): array
    {
        if (! class_exists(ZipArchive::class)) {
            throw new RuntimeException('Ekstensi ZIP di server belum aktif.');
        }

        $archiveSize = is_file($zipPath) ? (int) filesize($zipPath) : 0;
        if ($archiveSize <= 0) {
            throw new RuntimeException('Arsip plugin kosong atau tidak valid.');
        }
        if ($archiveSize > self::MAX_ARCHIVE_BYTES) {
            throw new RuntimeException('Ukuran ZIP plugin melebihi batas 50 MB.');
        }

        $zip = new ZipArchive();
        $openResult = $zip->open($zipPath);
        if ($openResult !== true) {
            throw new RuntimeException('ZIP plugin tidak bisa dibuka.');
        }

        $manifestContent = null;
        $readmeContent = null;
        $fileCount = 0;
        $extractedBytes = 0;

        for ($i = 0; $i < $zip->numFiles; $i++) {
            $stat = $zip->statIndex($i);
            if (! is_array($stat)) {
                continue;
            }

            $entryName = (string) ($stat['name'] ?? '');
            $normalizedEntry = $this->normalizeEntryName($entryName);
            if ($normalizedEntry === '') {
                throw new RuntimeException('ZIP plugin mengandung nama file yang tidak valid.');
            }

            $isDirectory = str_ends_with($normalizedEntry, '/');
            if ($isDirectory) {
                continue;
            }

            $fileCount++;
            if ($fileCount > self::MAX_FILES) {
                throw new RuntimeException('ZIP plugin terlalu besar. Maksimal 500 file.');
            }

            $entrySize = max(0, (int) ($stat['size'] ?? 0));
            $extractedBytes += $entrySize;
            if ($extractedBytes > self::MAX_EXTRACTED_BYTES) {
                throw new RuntimeException('Ukuran isi plugin melebihi batas 100 MB setelah diekstrak.');
            }

            $extension = strtolower((string) pathinfo($normalizedEntry, PATHINFO_EXTENSION));
            if ($extension !== '' && in_array($extension, self::BLOCKED_EXTENSIONS, true)) {
                throw new RuntimeException(
                    sprintf('ZIP plugin mengandung file yang tidak diizinkan: %s', $normalizedEntry)
                );
            }

            if (strtolower($normalizedEntry) === 'plugin.json') {
                if ($manifestContent !== null) {
                    throw new RuntimeException('ZIP plugin hanya boleh memiliki satu file plugin.json di root.');
                }
                $manifestContent = $zip->getFromIndex($i);
            }

            if ($readmeContent === null && preg_match('/^readme(?:\.[a-z0-9]+)?$/i', $normalizedEntry)) {
                $readmeContent = $zip->getFromIndex($i);
            }
        }

        $zip->close();

        if ($fileCount === 0) {
            throw new RuntimeException('ZIP plugin tidak berisi file apa pun.');
        }

        if ($manifestContent === null || $manifestContent === false) {
            throw new RuntimeException('ZIP plugin wajib berisi file plugin.json di folder root.');
        }

        try {
            $manifest = json_decode($manifestContent, true, 512, JSON_THROW_ON_ERROR);
        } catch (\Throwable $e) {
            throw new RuntimeException('plugin.json tidak valid: '.$e->getMessage());
        }

        if (! is_array($manifest)) {
            throw new RuntimeException('plugin.json harus berupa objek JSON.');
        }

        $normalizedManifest = $this->normalizeManifest($manifest);
        $readmeExcerpt = $this->normalizeReadme($readmeContent);
        $warnings = $this->buildWarnings($normalizedManifest, $readmeExcerpt);

        return [
            'original_filename' => $originalFilename,
            'name' => $normalizedManifest['name'],
            'slug' => $normalizedManifest['slug'],
            'version' => $normalizedManifest['version'],
            'description' => $normalizedManifest['description'],
            'details' => $normalizedManifest['details'],
            'github_url' => $normalizedManifest['github_url'],
            'homepage_url' => $normalizedManifest['homepage_url'],
            'author' => $normalizedManifest['author'],
            'compatibility' => $normalizedManifest['compatibility'],
            'capabilities' => $normalizedManifest['capabilities'],
            'checksum_sha256' => hash_file('sha256', $zipPath),
            'archive_size_bytes' => $archiveSize,
            'extracted_size_bytes' => $extractedBytes,
            'file_count' => $fileCount,
            'manifest' => $normalizedManifest,
            'metadata' => [
                'readme_excerpt' => $readmeExcerpt,
                'warnings' => $warnings,
                'capabilities' => $normalizedManifest['capabilities'],
                'compatibility' => $normalizedManifest['compatibility'],
            ],
        ];
    }

    private function extractArchive(string $zipPath, string $destinationPath): void
    {
        $zip = new ZipArchive();
        $openResult = $zip->open($zipPath);
        if ($openResult !== true) {
            throw new RuntimeException('ZIP plugin tidak bisa diekstrak.');
        }

        if (is_dir($destinationPath)) {
            $this->deleteDirectory($destinationPath);
        }

        if (! is_dir($destinationPath) && ! mkdir($destinationPath, 0775, true) && ! is_dir($destinationPath)) {
            $zip->close();
            throw new RuntimeException('Folder plugin tidak bisa dibuat di server.');
        }

        for ($i = 0; $i < $zip->numFiles; $i++) {
            $stat = $zip->statIndex($i);
            if (! is_array($stat)) {
                continue;
            }

            $entryName = (string) ($stat['name'] ?? '');
            $normalizedEntry = $this->normalizeEntryName($entryName);
            if ($normalizedEntry === '') {
                continue;
            }

            if (str_ends_with($normalizedEntry, '/')) {
                $dirPath = $destinationPath.'/'.$normalizedEntry;
                if (! is_dir($dirPath)) {
                    mkdir($dirPath, 0775, true);
                }
                continue;
            }

            $targetPath = $destinationPath.'/'.$normalizedEntry;
            $targetDir = dirname($targetPath);
            if (! is_dir($targetDir) && ! mkdir($targetDir, 0775, true) && ! is_dir($targetDir)) {
                $zip->close();
                throw new RuntimeException('Folder plugin tidak bisa dibuat di server.');
            }

            $contents = $zip->getFromIndex($i);
            if ($contents === false) {
                $zip->close();
                throw new RuntimeException(sprintf('File plugin %s gagal diekstrak.', $normalizedEntry));
            }

            if (file_put_contents($targetPath, $contents) === false) {
                $zip->close();
                throw new RuntimeException(sprintf('File plugin %s gagal disimpan.', $normalizedEntry));
            }
        }

        $zip->close();
    }

    private function normalizeManifest(array $manifest): array
    {
        $name = trim((string) ($manifest['name'] ?? ''));
        $slug = strtolower(trim((string) ($manifest['slug'] ?? '')));
        $version = trim((string) ($manifest['version'] ?? ''));
        $description = trim((string) ($manifest['description'] ?? ''));
        $details = trim((string) ($manifest['details'] ?? ''));
        $githubUrl = trim((string) ($manifest['github_url'] ?? ''));
        $homepageUrl = trim((string) ($manifest['homepage_url'] ?? ''));

        $author = is_array($manifest['author'] ?? null) ? $manifest['author'] : [];
        $authorName = trim((string) ($author['name'] ?? ''));
        $authorEmail = trim((string) ($author['email'] ?? ''));

        $compatibility = is_array($manifest['compatibility'] ?? null) ? $manifest['compatibility'] : [];
        $minAppVersion = trim((string) ($compatibility['min_app_version'] ?? ''));
        $maxAppVersion = trim((string) ($compatibility['max_app_version'] ?? ''));

        $capabilities = $manifest['capabilities'] ?? [];
        if (! is_array($capabilities)) {
            throw new RuntimeException('Field capabilities di plugin.json harus berupa array.');
        }
        $capabilities = array_values(array_filter(array_map(
            fn ($value) => trim((string) $value),
            $capabilities
        )));

        if ($name === '') {
            throw new RuntimeException('plugin.json wajib memiliki field name.');
        }
        if (mb_strlen($name) > 120) {
            throw new RuntimeException('Nama plugin maksimal 120 karakter.');
        }
        if (! preg_match('/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/', $slug)) {
            throw new RuntimeException('Slug plugin tidak valid.');
        }
        if (! preg_match('/^[0-9A-Za-z][0-9A-Za-z._+-]{0,39}$/', $version)) {
            throw new RuntimeException('Versi plugin tidak valid.');
        }
        if ($description !== '' && mb_strlen($description) > 2000) {
            throw new RuntimeException('Deskripsi plugin terlalu panjang.');
        }
        if ($details !== '' && mb_strlen($details) > 5000) {
            throw new RuntimeException('Detail plugin terlalu panjang.');
        }
        if ($githubUrl !== '' && ! filter_var($githubUrl, FILTER_VALIDATE_URL)) {
            throw new RuntimeException('github_url di plugin.json tidak valid.');
        }
        if ($homepageUrl !== '' && ! filter_var($homepageUrl, FILTER_VALIDATE_URL)) {
            throw new RuntimeException('homepage_url di plugin.json tidak valid.');
        }
        if ($authorEmail !== '' && ! filter_var($authorEmail, FILTER_VALIDATE_EMAIL)) {
            throw new RuntimeException('Email author di plugin.json tidak valid.');
        }
        if ($authorName !== '' && mb_strlen($authorName) > 120) {
            throw new RuntimeException('Nama author plugin terlalu panjang.');
        }
        if ($authorEmail !== '' && mb_strlen($authorEmail) > 255) {
            throw new RuntimeException('Email author plugin terlalu panjang.');
        }
        if ($minAppVersion !== '' && mb_strlen($minAppVersion) > 40) {
            throw new RuntimeException('compatibility.min_app_version terlalu panjang.');
        }
        if ($maxAppVersion !== '' && mb_strlen($maxAppVersion) > 40) {
            throw new RuntimeException('compatibility.max_app_version terlalu panjang.');
        }
        if (count($capabilities) > 30) {
            throw new RuntimeException('Daftar capabilities maksimal 30 item.');
        }

        return [
            'schema_version' => (int) ($manifest['schema_version'] ?? 1),
            'name' => $name,
            'slug' => $slug,
            'version' => $version,
            'description' => $description !== '' ? $description : null,
            'details' => $details !== '' ? $details : null,
            'github_url' => $githubUrl !== '' ? $githubUrl : null,
            'homepage_url' => $homepageUrl !== '' ? $homepageUrl : null,
            'author' => [
                'name' => $authorName !== '' ? $authorName : null,
                'email' => $authorEmail !== '' ? $authorEmail : null,
            ],
            'compatibility' => [
                'min_app_version' => $minAppVersion !== '' ? $minAppVersion : null,
                'max_app_version' => $maxAppVersion !== '' ? $maxAppVersion : null,
            ],
            'capabilities' => $capabilities,
        ];
    }

    private function normalizeReadme(mixed $readmeContent): ?string
    {
        if (! is_string($readmeContent) || trim($readmeContent) === '') {
            return null;
        }

        $excerpt = trim($readmeContent);
        if (strlen($excerpt) > self::MAX_README_BYTES) {
            $excerpt = substr($excerpt, 0, self::MAX_README_BYTES).'...';
        }

        return $excerpt !== '' ? $excerpt : null;
    }

    private function buildWarnings(array $manifest, ?string $readmeExcerpt): array
    {
        $warnings = [];

        if (empty($manifest['github_url'])) {
            $warnings[] = 'URL GitHub belum diisi.';
        }
        if (empty($manifest['author']['name'])) {
            $warnings[] = 'Nama author plugin belum diisi.';
        }
        if (empty($manifest['capabilities'])) {
            $warnings[] = 'Capabilities plugin belum dijelaskan di manifest.';
        }
        if (! $readmeExcerpt) {
            $warnings[] = 'README tidak ditemukan di root ZIP.';
        }

        return $warnings;
    }

    private function normalizeEntryName(string $entryName): string
    {
        $normalized = str_replace('\\', '/', trim($entryName));
        $normalized = ltrim($normalized, '/');

        if ($normalized === '') {
            return '';
        }

        if (preg_match('/^[a-zA-Z]:/', $normalized)) {
            throw new RuntimeException('ZIP plugin mengandung path absolut yang tidak diizinkan.');
        }

        $segments = array_filter(explode('/', $normalized), fn ($segment) => $segment !== '');
        foreach ($segments as $segment) {
            if ($segment === '.' || $segment === '..') {
                throw new RuntimeException('ZIP plugin mengandung path traversal yang tidak diizinkan.');
            }
        }

        return implode('/', $segments).(str_ends_with($entryName, '/') ? '/' : '');
    }

    private function formatPluginRow(object $row): array
    {
        $manifest = $this->decodeJsonField($row->manifest_json ?? null);
        $metadata = $this->decodeJsonField($row->metadata_json ?? null);

        return [
            'id' => (string) $row->id,
            'slug' => (string) $row->slug,
            'name' => (string) $row->name,
            'version' => (string) $row->version,
            'description' => $row->description ? (string) $row->description : null,
            'details' => $row->details ? (string) $row->details : null,
            'github_url' => $row->github_url ? (string) $row->github_url : null,
            'homepage_url' => $row->homepage_url ? (string) $row->homepage_url : null,
            'author' => [
                'name' => $row->author_name ? (string) $row->author_name : null,
                'email' => $row->author_email ? (string) $row->author_email : null,
            ],
            'is_active' => (bool) ($row->is_active ?? false),
            'status_label' => (bool) ($row->is_active ?? false) ? 'Aktif' : 'Nonaktif',
            'package_filename' => (string) $row->package_filename,
            'archive_size_bytes' => (int) ($row->archive_size_bytes ?? 0),
            'archive_size_label' => $this->formatBytes((int) ($row->archive_size_bytes ?? 0)),
            'extracted_size_bytes' => (int) ($row->extracted_size_bytes ?? 0),
            'extracted_size_label' => $this->formatBytes((int) ($row->extracted_size_bytes ?? 0)),
            'file_count' => (int) ($row->file_count ?? 0),
            'checksum_sha256' => (string) ($row->checksum_sha256 ?? ''),
            'uploaded_at' => $row->uploaded_at,
            'verified_at' => $row->verified_at,
            'uploaded_by' => [
                'user_id' => $row->uploaded_by_user_id ? (string) $row->uploaded_by_user_id : null,
                'name' => $row->uploaded_by_name ? (string) $row->uploaded_by_name : null,
                'email' => $row->uploaded_by_email ? (string) $row->uploaded_by_email : null,
            ],
            'manifest' => $manifest,
            'metadata' => $metadata,
            'download_name' => $this->downloadNameFromRow($row),
        ];
    }

    private function formatDraftRow(object $draft, ?object $existingPlugin = null): array
    {
        $manifest = $this->decodeJsonField($draft->manifest_json ?? null);
        $inspection = $this->decodeJsonField($draft->inspection_json ?? null);

        return [
            'id' => (string) $draft->id,
            'slug' => (string) $draft->slug,
            'name' => (string) $draft->name,
            'version' => (string) $draft->version,
            'original_filename' => (string) $draft->original_filename,
            'archive_size_bytes' => (int) ($draft->archive_size_bytes ?? 0),
            'archive_size_label' => $this->formatBytes((int) ($draft->archive_size_bytes ?? 0)),
            'extracted_size_bytes' => (int) ($draft->extracted_size_bytes ?? 0),
            'extracted_size_label' => $this->formatBytes((int) ($draft->extracted_size_bytes ?? 0)),
            'file_count' => (int) ($draft->file_count ?? 0),
            'checksum_sha256' => (string) ($draft->checksum_sha256 ?? ''),
            'inspected_at' => $draft->inspected_at,
            'expires_at' => $draft->expires_at,
            'manifest' => $manifest,
            'metadata' => $inspection['metadata'] ?? [],
            'existing_plugin' => $existingPlugin ? $this->formatPluginRow($existingPlugin) : null,
        ];
    }

    private function deletePluginFiles(object $plugin): void
    {
        $disk = Storage::disk(self::DISK);

        if (! empty($plugin->package_path)) {
            $disk->delete((string) $plugin->package_path);
        }

        if (! empty($plugin->extract_path)) {
            $disk->deleteDirectory((string) $plugin->extract_path);
        }
    }

    private function deleteDraftStorage(object $draft): void
    {
        if (! empty($draft->temp_path)) {
            Storage::disk(self::DISK)->delete((string) $draft->temp_path);
        }
    }

    private function deleteDirectory(string $path): void
    {
        if (! is_dir($path)) {
            return;
        }

        $items = scandir($path);
        if (! is_array($items)) {
            return;
        }

        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }

            $target = $path.DIRECTORY_SEPARATOR.$item;
            if (is_dir($target)) {
                $this->deleteDirectory($target);
                continue;
            }

            @unlink($target);
        }

        @rmdir($path);
    }

    private function actorValue(array $actor, string $key): ?string
    {
        $value = trim((string) ($actor[$key] ?? ''));

        return $value !== '' ? $value : null;
    }

    private function decodeJsonField(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }

        if (! is_string($value) || trim($value) === '') {
            return [];
        }

        try {
            $decoded = json_decode($value, true, 512, JSON_THROW_ON_ERROR);

            return is_array($decoded) ? $decoded : [];
        } catch (\Throwable $e) {
            return [];
        }
    }

    private function assertZipExtension(string $filename): void
    {
        $extension = strtolower((string) pathinfo($filename, PATHINFO_EXTENSION));
        if ($extension !== 'zip') {
            throw new RuntimeException('File plugin harus berformat ZIP.');
        }
    }

    private function downloadNameFromRow(object $row): string
    {
        $slug = trim((string) ($row->slug ?? 'plugin'));
        $version = trim((string) ($row->version ?? 'latest'));

        return sprintf('%s-%s.zip', $slug !== '' ? $slug : 'plugin', $version !== '' ? $version : 'latest');
    }

    private function formatBytes(int $bytes): string
    {
        if ($bytes <= 0) {
            return '0 B';
        }

        $units = ['B', 'KB', 'MB', 'GB'];
        $power = min((int) floor(log($bytes, 1024)), count($units) - 1);
        $value = $bytes / (1024 ** $power);

        return ($power === 0 ? (string) round($value) : (string) round($value, 2)).' '.$units[$power];
    }
}
