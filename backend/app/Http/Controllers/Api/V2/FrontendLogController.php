<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Models\FrontendErrorLog;
use App\Models\Profile;
use App\Support\Observability\RequestId;
use App\Support\Observability\Sanitizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class FrontendLogController extends Controller
{
    /**
     * Retrieve frontend error logs for the current tenant.
     */
    public function index(Request $request): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $user = $request->user();

        $profile = Profile::where('id', $user->id)->first();
        if (! $profile || $profile->role !== 'admin') {
            abort(403, 'Akses ditolak');
        }

        $logs = FrontendErrorLog::query()
            ->where('tenant_id', $tenantId)
            ->when($request->filled('request_id') && RequestId::valid((string) $request->query('request_id')), fn ($query) => $query->where('request_id', strtolower((string) $request->query('request_id'))))
            ->when($request->filled('domain'), fn ($query) => $query->where('domain', 'like', '%'.mb_substr(trim((string) $request->query('domain')), 0, 120).'%'))
            ->when($request->filled('route'), fn ($query) => $query->where('route_name', 'like', '%'.mb_substr(trim((string) $request->query('route')), 0, 180).'%'))
            ->when($request->filled('status') && is_numeric($request->query('status')), fn ($query) => $query->where('response_status', (int) $request->query('status')))
            ->when($request->filled('error_code'), fn ($query) => $query->where('error_code', 'like', '%'.mb_substr(trim((string) $request->query('error_code')), 0, 120).'%'))
            ->orderBy('created_at', 'desc')
            ->paginate(50);

        return response()->json($logs);
    }

    /**
     * Store a frontend log entry in the backend logs.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'level' => 'required|string|in:info,warning,error,critical',
            'message' => 'required|string|max:1000',
            'context' => 'nullable|array',
            'url' => 'nullable|string|max:2048',
            'request_id' => ['nullable', 'uuid'],
            'correlation_id' => ['nullable', 'uuid'],
            'error_code' => 'nullable|string|max:120',
            'route' => 'nullable|string|max:180',
            'status' => 'nullable|integer|between:0,599',
            'duration_ms' => 'nullable|integer|min:0|max:86400000',
        ]);

        $route = trim((string) ($validated['route'] ?? $request->header('X-Frontend-Route', '')));
        $requestId = RequestId::get($request);
        $correlationId = RequestId::correlationId($request);

        FrontendErrorLog::create([
            'level' => $validated['level'],
            'message' => $validated['message'],
            'context' => Sanitizer::value($validated['context'] ?? []),
            'url' => $validated['url'] ?? null,
            'user_agent' => $request->userAgent(),
            'ip_address' => $request->ip(),
            'user_id' => $request->user()?->id,
            'tenant_id' => $request->attributes->get('tenant_id'),
            // The server-owned HTTP request ID is authoritative; the body is
            // retained only for compatibility with older reporters.
            'request_id' => $requestId,
            'correlation_id' => $correlationId,
            'error_code' => $validated['error_code'] ?? null,
            'domain' => $this->domain($route),
            'route_name' => $route !== '' ? mb_substr($route, 0, 180) : null,
            'response_status' => $validated['status'] ?? null,
            'duration_ms' => $validated['duration_ms'] ?? null,
            'release_sha' => config('app.release_sha', 'unknown'),
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Log recorded successfully',
            'request_id' => $requestId,
        ], 201)->header(RequestId::HEADER, $requestId);
    }

    private function domain(string $route): ?string
    {
        $path = trim((string) parse_url($route, PHP_URL_PATH));
        if ($path === '') {
            return null;
        }
        $parts = explode('/', trim($path, '/'));

        return $parts[0] ?? null;
    }
}
