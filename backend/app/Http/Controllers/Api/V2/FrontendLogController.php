<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Models\FrontendErrorLog;
use App\Models\Profile;
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
        ]);

        FrontendErrorLog::create([
            'level' => $validated['level'],
            'message' => $validated['message'],
            'context' => $validated['context'] ?? null,
            'url' => $validated['url'] ?? null,
            'user_agent' => $request->userAgent(),
            'ip_address' => $request->ip(),
            'user_id' => $request->user()?->id,
            'tenant_id' => $request->attributes->get('tenant_id'),
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Log recorded successfully',
        ], 201);
    }
}
