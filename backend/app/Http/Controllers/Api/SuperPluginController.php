<?php

namespace App\Http\Controllers\Api;

use App\Services\Plugins\PluginPackageService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class SuperPluginController extends ApiController
{
    public function __construct(
        private readonly PluginPackageService $pluginService
    ) {
    }

    public function index(Request $request)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        return $this->ok($this->pluginService->listPlugins());
    }

    public function inspect(Request $request)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        if (! $request->hasFile('plugin_zip')) {
            return response()->json(['error' => 'File ZIP plugin wajib diunggah.'], 422);
        }

        try {
            $draft = $this->pluginService->inspectUploadedArchive(
                $request->file('plugin_zip'),
                $this->actorPayload($request)
            );
        } catch (\RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        $this->logAudit(
            $request,
            'plugin_upload_drafts',
            (string) ($draft['id'] ?? ''),
            'INSERT',
            null,
            $draft,
            null
        );

        return response()->json(['data' => $draft], 201);
    }

    public function store(Request $request)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $draftId = trim((string) $request->input('draft_id', ''));
        if ($draftId === '') {
            return response()->json(['error' => 'draft_id wajib diisi.'], 422);
        }

        try {
            $result = $this->pluginService->installDraft(
                $draftId,
                filter_var($request->input('replace_existing', false), FILTER_VALIDATE_BOOLEAN),
                $this->actorPayload($request)
            );
        } catch (\RuntimeException $e) {
            $status = str_contains(strtolower($e->getMessage()), 'sudah ada') ? 409 : 422;

            return response()->json(['error' => $e->getMessage()], $status);
        }

        $plugin = $result['plugin'] ?? null;
        $before = $result['before'] ?? null;
        $action = ! empty($result['replaced']) ? 'UPDATE' : 'INSERT';

        if ($plugin) {
            $this->logAudit(
                $request,
                'system_plugins',
                (string) ($plugin['id'] ?? ''),
                $action,
                $before,
                $plugin,
                null
            );
        }

        return response()->json(['data' => $plugin], ! empty($result['replaced']) ? 200 : 201);
    }

    public function updateStatus(Request $request, string $id)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        if (! $request->has('is_active')) {
            return response()->json(['error' => 'Field is_active wajib diisi.'], 422);
        }

        try {
            $result = $this->pluginService->setPluginStatus(
                $id,
                filter_var($request->input('is_active'), FILTER_VALIDATE_BOOLEAN)
            );
        } catch (\RuntimeException $e) {
            $status = str_contains(strtolower($e->getMessage()), 'tidak ditemukan') ? 404 : 422;

            return response()->json(['error' => $e->getMessage()], $status);
        }

        $this->logAudit(
            $request,
            'system_plugins',
            $id,
            'UPDATE',
            $result['before'] ?? null,
            $result['plugin'] ?? null,
            null
        );

        return $this->ok($result['plugin'] ?? null);
    }

    public function destroy(Request $request, string $id)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        try {
            $result = $this->pluginService->deletePlugin(
                $id,
                filter_var($request->input('confirm', false), FILTER_VALIDATE_BOOLEAN)
            );
        } catch (\RuntimeException $e) {
            $message = strtolower($e->getMessage());
            $status = str_contains($message, 'tidak ditemukan')
                ? 404
                : (str_contains($message, 'konfirmasi') ? 422 : 409);

            return response()->json(['error' => $e->getMessage()], $status);
        }

        $this->logAudit(
            $request,
            'system_plugins',
            $id,
            'DELETE',
            $result['plugin'] ?? null,
            null,
            null
        );

        return $this->ok($result);
    }

    public function download(Request $request, string $id)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        try {
            $payload = $this->pluginService->downloadPayload($id);
        } catch (\RuntimeException $e) {
            $status = str_contains(strtolower($e->getMessage()), 'tidak ditemukan') ? 404 : 410;

            return response()->json(['error' => $e->getMessage()], $status);
        }

        return Storage::disk('local')->download(
            (string) $payload['row']->package_path,
            (string) $payload['download_name'],
            ['Content-Type' => 'application/zip']
        );
    }

    private function actorPayload(Request $request): array
    {
        $user = $request->user();
        $profile = $this->profile($request);

        return [
            'user_id' => $user?->id ? (string) $user->id : null,
            'name' => trim((string) ($profile?->nama ?? $user?->name ?? '')) ?: null,
            'email' => trim((string) ($user?->email ?? $profile?->email ?? '')) ?: null,
        ];
    }
}
