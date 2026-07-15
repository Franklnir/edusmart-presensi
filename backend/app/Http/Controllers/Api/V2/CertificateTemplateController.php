<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Models\CertificateTemplate;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class CertificateTemplateController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index(Request $request): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $query = CertificateTemplate::query()
            ->where('tenant_id', $tenantId);

        if ($request->has('is_active')) {
            $query->where('is_active', filter_var($request->query('is_active'), FILTER_VALIDATE_BOOLEAN));
        }

        $templates = $query->orderBy('created_at', 'desc')->get();

        return response()->json([
            'success' => true,
            'data' => $templates,
        ]);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $user = $request->user();

        Gate::authorize('manage-sertifikat', [$tenantId]);

        $validated = $request->validate([
            'nama' => 'required|string|max:255',
            'deskripsi' => 'nullable|string',
            'background_url' => 'required|string',
            'text_color' => 'nullable|string',
            'font_family' => 'nullable|string',
            'font_size' => 'nullable|integer',
            'nama_x' => 'nullable|integer',
            'nama_y' => 'nullable|integer',
            'event_x' => 'nullable|integer',
            'event_y' => 'nullable|integer',
            'tanggal_x' => 'nullable|integer',
            'tanggal_y' => 'nullable|integer',
            'is_active' => 'nullable|boolean',
            'fields' => 'nullable|array',
        ]);

        $template = CertificateTemplate::query()->create([
            ...$validated,
            'tenant_id' => $tenantId,
            'created_by' => $user->id,
        ]);

        return response()->json([
            'success' => true,
            'data' => $template,
            'message' => 'Template sertifikat berhasil ditambahkan',
        ], 201);
    }

    /**
     * Display the specified resource.
     */
    public function show(Request $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $template = CertificateTemplate::query()
            ->where('tenant_id', $tenantId)
            ->findOrFail($id);

        return response()->json([
            'success' => true,
            'data' => $template,
        ]);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');

        Gate::authorize('manage-sertifikat', [$tenantId]);

        $template = CertificateTemplate::query()
            ->where('tenant_id', $tenantId)
            ->findOrFail($id);

        $validated = $request->validate([
            'nama' => 'sometimes|required|string|max:255',
            'deskripsi' => 'nullable|string',
            'background_url' => 'sometimes|required|string',
            'text_color' => 'nullable|string',
            'font_family' => 'nullable|string',
            'font_size' => 'nullable|integer',
            'nama_x' => 'nullable|integer',
            'nama_y' => 'nullable|integer',
            'event_x' => 'nullable|integer',
            'event_y' => 'nullable|integer',
            'tanggal_x' => 'nullable|integer',
            'tanggal_y' => 'nullable|integer',
            'is_active' => 'nullable|boolean',
            'fields' => 'nullable|array',
        ]);

        $template->update($validated);

        return response()->json([
            'success' => true,
            'data' => $template->fresh(),
            'message' => 'Template sertifikat berhasil diperbarui',
        ]);
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');

        Gate::authorize('manage-sertifikat', [$tenantId]);

        $template = CertificateTemplate::query()
            ->where('tenant_id', $tenantId)
            ->findOrFail($id);

        $template->delete();

        return response()->json([
            'success' => true,
            'message' => 'Template sertifikat berhasil dihapus',
        ]);
    }
}
