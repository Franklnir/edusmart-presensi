<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Resources\Api\V2\AcademicContextResource;
use App\Models\Setting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

class AcademicContextController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', Setting::class);

        $context = Setting::query()
            ->where('tenant_id', (string) $request->attributes->get('tenant_id'))
            ->orderBy('id')
            ->first();

        return response()->json([
            'success' => true,
            'data' => $context ? (new AcademicContextResource($context))->resolve($request) : null,
            'meta' => ['configured' => $context !== null],
            'request_id' => $request->attributes->get('request_id') ?: $request->header('X-Request-ID', (string) Str::uuid()),
        ]);
    }
}
