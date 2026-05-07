<?php

namespace App\Http\Controllers\Api;

use App\Services\GoogleDrive\GoogleDriveService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class GoogleDriveController extends ApiController
{
    public function __construct(
        private readonly GoogleDriveService $googleDriveService
    ) {}

    public function show(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->resolveOwnedTenantId($request);
        if (! $tenantId) {
            return response()->json(['error' => 'Tenant tidak valid'], 400);
        }

        return $this->ok($this->googleDriveService->statusForTenant((string) $tenantId));
    }

    public function connectUrl(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->resolveOwnedTenantId($request);
        $userId = $request->user()?->id;
        if (! $tenantId || ! $userId) {
            return response()->json(['error' => 'Tenant atau user tidak valid'], 400);
        }

        $returnUrl = (string) $request->input('return_url', '');

        try {
            return $this->ok($this->googleDriveService->authorizationUrl(
                $request,
                (string) $tenantId,
                (string) $userId,
                $returnUrl
            ));
        } catch (\Throwable $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }
    }

    public function callback(Request $request): RedirectResponse
    {
        $returnUrl = rtrim((string) config('app.frontend_url', config('app.url')), '/').'/admin/pengaturan';

        try {
            $result = $this->googleDriveService->consumeOAuthCallback($request);
            $returnUrl = (string) ($result['return_url'] ?? $returnUrl) ?: $returnUrl;

            return redirect()->away($this->appendQuery($returnUrl, [
                'drive' => 'connected',
            ]));
        } catch (\Throwable $e) {
            return redirect()->away($this->appendQuery($returnUrl, [
                'drive' => 'failed',
                'drive_error' => $e->getMessage(),
            ]));
        }
    }

    public function sync(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->resolveOwnedTenantId($request);
        if (! $tenantId) {
            return response()->json(['error' => 'Tenant tidak valid'], 400);
        }

        return $this->ok($this->googleDriveService->statusForTenant((string) $tenantId, true));
    }

    public function disconnect(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->resolveOwnedTenantId($request);
        if (! $tenantId) {
            return response()->json(['error' => 'Tenant tidak valid'], 400);
        }

        return $this->ok($this->googleDriveService->disconnectTenant((string) $tenantId));
    }

    private function appendQuery(string $url, array $params): string
    {
        $separator = str_contains($url, '?') ? '&' : '?';

        return $url.$separator.http_build_query($params, '', '&', PHP_QUERY_RFC3986);
    }
}
