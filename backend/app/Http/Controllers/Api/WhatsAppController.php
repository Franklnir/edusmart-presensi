<?php

namespace App\Http\Controllers\Api;

use App\Services\WhatsApp\WhatsAppIntegrationService;
use App\Services\WhatsApp\WhatsAppNotificationService;
use Illuminate\Http\Request;

class WhatsAppController extends ApiController
{
    public function __construct(
        private readonly WhatsAppIntegrationService $whatsAppIntegrationService,
        private readonly WhatsAppNotificationService $whatsAppNotificationService
    ) {}

    public function show(Request $request)
    {
        $tenantId = $this->validatedTenantAdmin($request);
        if (! $tenantId) {
            return $this->deny();
        }

        return response()->json([
            'data' => $this->whatsAppIntegrationService->overview($tenantId),
        ]);
    }

    public function connect(Request $request)
    {
        $tenantId = $this->validatedTenantAdmin($request);
        if (! $tenantId) {
            return $this->deny();
        }

        try {
            $data = $this->whatsAppIntegrationService->requestQr($tenantId);
        } catch (\Throwable $e) {
            return $this->deny($e->getMessage(), 422);
        }

        return response()->json(['data' => $data]);
    }

    public function sync(Request $request)
    {
        $tenantId = $this->validatedTenantAdmin($request);
        if (! $tenantId) {
            return $this->deny();
        }

        try {
            $data = $this->whatsAppIntegrationService->synchronize($tenantId);
        } catch (\Throwable $e) {
            return $this->deny($e->getMessage(), 422);
        }

        return response()->json(['data' => $data]);
    }

    public function logout(Request $request)
    {
        $tenantId = $this->validatedTenantAdmin($request);
        if (! $tenantId) {
            return $this->deny();
        }

        $data = $this->whatsAppIntegrationService->logout($tenantId);

        return response()->json(['data' => $data]);
    }

    public function updateSettings(Request $request)
    {
        $tenantId = $this->validatedTenantAdmin($request);
        if (! $tenantId) {
            return $this->deny();
        }

        $validated = $request->validate([
            'is_enabled' => ['sometimes', 'boolean'],
            'send_attendance' => ['sometimes', 'boolean'],
            'send_profile_updates' => ['sometimes', 'boolean'],
            'send_assignment_updates' => ['sometimes', 'boolean'],
            'send_extracurricular_updates' => ['sometimes', 'boolean'],
            'send_grade_updates' => ['sometimes', 'boolean'],
            'recipient_mode' => ['sometimes', 'string', 'in:wali,siswa,wali_and_student'],
        ]);

        $settings = $this->whatsAppIntegrationService->saveNotificationSettings($tenantId, $validated);

        return response()->json([
            'data' => [
                'settings' => $settings,
            ],
        ]);
    }

    public function sendTest(Request $request)
    {
        $tenantId = $this->validatedTenantAdmin($request);
        if (! $tenantId) {
            return $this->deny();
        }

        $validated = $request->validate([
            'number' => ['required', 'string', 'max:32'],
            'message' => ['nullable', 'string', 'max:2000'],
        ]);

        try {
            $log = $this->whatsAppNotificationService->queueTestMessage(
                $tenantId,
                (string) $validated['number'],
                (string) ($validated['message'] ?? '')
            );
        } catch (\Throwable $e) {
            return $this->deny($e->getMessage(), 422);
        }

        return response()->json([
            'data' => [
                'queued' => true,
                'log' => $log->fresh(),
            ],
        ]);
    }

    private function validatedTenantAdmin(Request $request): ?string
    {
        if (! $this->isAdmin($request)) {
            return null;
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return null;
        }

        return $tenantId;
    }
}
