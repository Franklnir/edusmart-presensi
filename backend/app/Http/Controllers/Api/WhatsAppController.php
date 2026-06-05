<?php

namespace App\Http\Controllers\Api;

use App\Services\WhatsApp\WhatsAppIntegrationService;
use App\Services\WhatsApp\WhatsAppNotificationService;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

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

    public function superOverview(Request $request)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $date = $this->normalizeDate($request->query('date')) ?: Carbon::now('Asia/Jakarta')->toDateString();
        $central = $this->centralGatewayOverview($request);
        $delivery = $this->whatsAppNotificationService->alphaDeliveryOverview($date);
        $logs = DB::table('whatsapp_message_logs as l')
            ->leftJoin('tenants as t', 't.id', '=', 'l.tenant_id')
            ->select([
                'l.id',
                'l.tenant_id',
                't.name as tenant_name',
                't.slug as tenant_slug',
                'l.category',
                'l.event_key',
                'l.target_name',
                'l.target_phone',
                'l.normalized_phone',
                'l.status',
                'l.attempt_count',
                'l.message_text',
                'l.last_error',
                'l.queued_at',
                'l.sent_at',
                'l.failed_at',
                'l.created_at',
            ])
            ->whereDate('l.created_at', $date)
            ->where('l.category', 'attendance_alpha_daily')
            ->orderByDesc('l.created_at')
            ->limit(200)
            ->get();

        $stats = [
            'total' => $logs->count(),
            'sent' => $logs->where('status', 'sent')->count(),
            'queued' => $logs->where('status', 'queued')->count(),
            'failed' => $logs->where('status', 'failed')->count(),
            'skipped' => $logs->where('status', 'skipped')->count(),
        ];

        $byTenant = $logs
            ->groupBy('tenant_id')
            ->map(function ($items) {
                $first = $items->first();

                return [
                    'tenant_id' => $first->tenant_id,
                    'tenant_name' => $first->tenant_name,
                    'tenant_slug' => $first->tenant_slug,
                    'total' => $items->count(),
                    'sent' => $items->where('status', 'sent')->count(),
                    'queued' => $items->where('status', 'queued')->count(),
                    'failed' => $items->where('status', 'failed')->count(),
                    'skipped' => $items->where('status', 'skipped')->count(),
                ];
            })
            ->values();

        return $this->ok([
            'provider' => [
                'configured' => $this->whatsAppIntegrationService->providerConfigured(),
                'name' => $this->whatsAppIntegrationService->providerName(),
                'type' => $this->whatsAppIntegrationService->providerType(),
                'central' => $this->whatsAppIntegrationService->usesCentralProvider(),
                'public_url' => $central['provider']['public_url'] ?? null,
            ],
            'central' => $central,
            'date' => $date,
            'settings' => [
                'fast_max_send_hour' => (int) config('services.whatsapp.daily_alpha_fast_max_send_hour', 23),
                'batch_max_send_hour' => (int) config('services.whatsapp.daily_alpha_batch_max_send_hour', 21),
                'fast_limit' => (int) config('services.whatsapp.daily_alpha_fast_limit', 20),
                'batch_per_minute' => (int) config('services.whatsapp.daily_alpha_batch_per_minute', 10),
                'fast_interval_seconds' => (int) config('services.whatsapp.daily_alpha_fast_interval_seconds', 15),
                'send_min_interval_seconds' => (int) config('services.whatsapp.send_min_interval_seconds', 10),
            ],
            'stats' => $stats,
            'readiness' => $delivery['readiness'] ?? null,
            'delivery_plan' => $delivery['delivery_plan'] ?? null,
            'tenants' => $delivery['tenants'] ?? $byTenant,
            'logs' => $logs,
        ]);
    }

    public function superConnect(Request $request)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        try {
            return $this->ok($this->whatsAppIntegrationService->requestCentralQr($request->getHost()));
        } catch (\Throwable $e) {
            return $this->deny($this->gatewayErrorMessage($e), 422);
        }
    }

    public function superSync(Request $request)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        try {
            return $this->ok($this->whatsAppIntegrationService->synchronizeCentral($request->getHost()));
        } catch (\Throwable $e) {
            return $this->deny($this->gatewayErrorMessage($e), 422);
        }
    }

    public function superLogout(Request $request)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        try {
            return $this->ok($this->whatsAppIntegrationService->logoutCentral($request->getHost()));
        } catch (\Throwable $e) {
            return $this->deny($this->gatewayErrorMessage($e), 422);
        }
    }

    public function superUpdateTenantSettings(Request $request, $tenantId)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $validated = $request->validate([
            'is_enabled' => ['required', 'boolean'],
        ]);

        $tenant = DB::table('tenants')->where('id', $tenantId)->first();
        if (! $tenant) {
            return $this->deny('Sekolah tidak ditemukan', 404);
        }

        $settings = $this->whatsAppIntegrationService->saveNotificationSettings($tenantId, [
            'is_enabled' => $validated['is_enabled'],
        ]);

        return $this->ok(['settings' => $settings]);
    }

    public function superSendTest(Request $request)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $validated = $request->validate([
            'number' => ['required', 'string', 'max:32'],
            'message' => ['nullable', 'string', 'max:2000'],
        ]);

        try {
            $log = $this->whatsAppNotificationService->queueTestMessage(
                $this->validatedCentralTenantId(),
                (string) $validated['number'],
                (string) ($validated['message'] ?? '')
            );
        } catch (\Throwable $e) {
            return $this->deny($e->getMessage(), 422);
        }

        return $this->ok([
            'queued' => true,
            'log' => $log->fresh(),
        ]);
    }

    public function superRunDailyAlpha(Request $request)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $validated = $request->validate([
            'date' => ['nullable', 'date'],
            'tenant_id' => ['nullable', 'uuid'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:5000'],
        ]);

        $summary = $this->whatsAppNotificationService->queueDailyAlphaWarnings(
            $validated['tenant_id'] ?? null,
            $validated['date'] ?? null,
            $validated['limit'] ?? null
        );

        return $this->ok([
            'summary' => $summary,
        ]);
    }

    public function superRetryFailed(Request $request)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $validated = $request->validate([
            'limit' => ['nullable', 'integer', 'min:1', 'max:500'],
        ]);

        return $this->ok([
            'summary' => $this->whatsAppNotificationService->retryFailedMessages($validated['limit'] ?? null),
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

    private function centralGatewayOverview(Request $request): ?array
    {
        $tenantId = $this->whatsAppIntegrationService->centralTenantId();
        if ($tenantId === '') {
            return [
                'integration' => null,
                'settings' => null,
                'logs' => [],
                'school' => [],
                'provider' => [
                    'configured' => $this->whatsAppIntegrationService->providerConfigured(),
                    'name' => $this->whatsAppIntegrationService->providerName(),
                    'type' => $this->whatsAppIntegrationService->providerType(),
                    'central' => $this->whatsAppIntegrationService->usesCentralProvider(),
                    'public_url' => null,
                ],
                'error' => 'Tenant pusat WhatsApp belum dikonfigurasi.',
            ];
        }

        try {
            return $this->whatsAppIntegrationService->centralOverview($request->getHost());
        } catch (\Throwable $e) {
            return [
                'integration' => null,
                'settings' => null,
                'logs' => [],
                'school' => [],
                'provider' => [
                    'configured' => $this->whatsAppIntegrationService->providerConfigured(),
                    'name' => $this->whatsAppIntegrationService->providerName(),
                    'type' => $this->whatsAppIntegrationService->providerType(),
                    'central' => $this->whatsAppIntegrationService->usesCentralProvider(),
                    'public_url' => null,
                ],
                'error' => $this->gatewayErrorMessage($e),
            ];
        }
    }

    private function validatedCentralTenantId(): string
    {
        $tenantId = $this->whatsAppIntegrationService->centralTenantId();
        if ($tenantId === '') {
            throw new \RuntimeException('Tenant pusat WhatsApp belum dikonfigurasi. Isi WHATSAPP_CENTRAL_TENANT_ID atau WHATSAPP_CENTRAL_TENANT_SLUG.');
        }

        return $tenantId;
    }

    private function normalizeDate($date): ?string
    {
        $date = trim((string) $date);
        if ($date === '') {
            return null;
        }

        try {
            return Carbon::parse($date, 'Asia/Jakarta')->toDateString();
        } catch (\Throwable $e) {
            return null;
        }
    }
}
