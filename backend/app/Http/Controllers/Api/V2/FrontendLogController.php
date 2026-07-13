<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Http\JsonResponse;

class FrontendLogController extends Controller
{
    /**
     * Store a frontend log entry in the backend logs.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'level' => 'required|string|in:info,warning,error,critical',
            'message' => 'required|string',
            'context' => 'nullable|array',
            'url' => 'nullable|string',
        ]);

        $context = array_merge($validated['context'] ?? [], [
            'source' => 'frontend',
            'url' => $validated['url'] ?? null,
            'user_id' => $request->user()?->id,
        ]);

        $level = $validated['level'];
        
        Log::$level($validated['message'], $context);

        return response()->json([
            'success' => true,
            'message' => 'Log recorded successfully',
        ]);
    }
}
