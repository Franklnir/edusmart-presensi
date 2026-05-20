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

        try {
            $data = $this->whatsAppIntegrationService->overview($tenantId, $request->getHost());
        } catch (\Throwable $e) {
            return $this->deny($this->gatewayErrorMessage($e), 422);
        }

        return response()->json(['data' => $data]);
    }

    public function connect(Request $request)
    {
        $tenantId = $this->validatedTenantAdmin($request);
        if (! $tenantId) {
            return $this->deny();
        }

        try {
            $data = $this->whatsAppIntegrationService->requestQr($tenantId, $request->getHost());
        } catch (\Throwable $e) {
            return $this->deny($this->gatewayErrorMessage($e), 422);
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
            $data = $this->whatsAppIntegrationService->synchronize($tenantId, $request->getHost());
        } catch (\Throwable $e) {
            return $this->deny($this->gatewayErrorMessage($e), 422);
        }

        return response()->json(['data' => $data]);
    }

    public function logout(Request $request)
    {
        $tenantId = $this->validatedTenantAdmin($request);
        if (! $tenantId) {
            return $this->deny();
        }

        try {
            $data = $this->whatsAppIntegrationService->logout($tenantId, $request->getHost());
        } catch (\Throwable $e) {
            return $this->deny($this->gatewayErrorMessage($e), 422);
        }

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

    public function runAssignmentWarnings(Request $request)
    {
        $tenantId = $this->validatedTenantAdmin($request);
        if (! $tenantId) {
            return $this->deny();
        }

        try {
            $summary = $this->whatsAppNotificationService->queueClosedAssignmentWarnings($tenantId);
            $overview = $this->whatsAppIntegrationService->overview($tenantId, $request->getHost());
        } catch (\Throwable $e) {
            return $this->deny($this->gatewayErrorMessage($e), 422);
        }

        return response()->json([
            'data' => [
                'summary' => $summary,
                'overview' => $overview,
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

    private function gatewayErrorMessage(\Throwable $e): string
    {
        $message = trim($e->getMessage());

        return $message !== ''
            ? $message
            : 'Gateway WhatsApp belum siap. Cek service Evolution API, Redis, dan koneksi tenant.';
    }
}
