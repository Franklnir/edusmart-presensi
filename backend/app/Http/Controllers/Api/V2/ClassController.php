<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V2\StoreClassRequest;
use App\Http\Requests\Api\V2\UpdateClassRequest;
use App\Http\Resources\Api\V2\ClassResource;
use App\Models\Kelas;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Str;

class ClassController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $tenantId = $request->attributes->get('tenant_id');
        
        $classes = Kelas::where('tenant_id', $tenantId)
            ->orderBy('grade')
            ->orderBy('nama')
            ->get();

        return ClassResource::collection($classes);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(StoreClassRequest $request): ClassResource
    {
        $tenantId = $request->attributes->get('tenant_id');
        
        $validated = $request->validated();
        $validated['tenant_id'] = $tenantId;
        $validated['id'] = (string) Str::uuid();

        $kelas = Kelas::create($validated);

        return new ClassResource($kelas);
    }

    /**
     * Display the specified resource.
     */
    public function show(Request $request, string $id): ClassResource|JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        
        $kelas = Kelas::where('tenant_id', $tenantId)->find($id);

        if (!$kelas) {
            return response()->json(['message' => 'Class not found'], 404);
        }

        return new ClassResource($kelas);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(UpdateClassRequest $request, string $id): ClassResource|JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        
        $kelas = Kelas::where('tenant_id', $tenantId)->find($id);

        if (!$kelas) {
            return response()->json(['message' => 'Class not found'], 404);
        }

        $kelas->update($request->validated());

        return new ClassResource($kelas);
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        
        $kelas = Kelas::where('tenant_id', $tenantId)->find($id);

        if (!$kelas) {
            return response()->json(['message' => 'Class not found'], 404);
        }

        $kelas->delete();

        return response()->json([
            'success' => true,
            'message' => 'Class deleted successfully'
        ]);
    }
}
