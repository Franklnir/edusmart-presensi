<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V2\ShowAdminDashboardRequest;
use App\Http\Resources\Api\V2\AdminDashboardResource;
use App\Models\Profile;
use App\Services\Dashboard\AdminDashboardService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

class AdminDashboardController extends Controller
{
    public function __construct(private readonly AdminDashboardService $dashboard) {}

    public function show(ShowAdminDashboardRequest $request): JsonResponse
    {
        Gate::authorize('viewAdminDashboard', Profile::class);

        $data = $this->dashboard->show(
            (string) $request->attributes->get('tenant_id'),
            $request->validated('tahun_ajaran')
        );

        return response()->json([
            'success' => true,
            'message' => 'Dashboard admin berhasil dimuat.',
            'data' => (new AdminDashboardResource($data))->resolve($request),
            'request_id' => $request->attributes->get('request_id') ?: $request->header('X-Request-ID', (string) Str::uuid()),
        ]);
    }
}
