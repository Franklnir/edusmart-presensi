<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Models\Certificate;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class CertificateController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index(Request $request): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $query = Certificate::query()
            ->where('tenant_id', $tenantId);

        if ($request->has('user_id')) {
            $query->where('user_id', $request->query('user_id'));
        }

        $certificates = $query->orderBy('issued_at', 'desc')->get();

        return response()->json([
            'success' => true,
            'data' => $certificates,
        ]);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');

        Gate::authorize('manage-sertifikat', [$tenantId]);

        $validated = $request->validate([
            'user_id' => 'nullable|uuid',
            'nama_penerima' => 'required|string|max:255',
            'email' => 'nullable|email',
            'kelas' => 'nullable|string',
            'event' => 'required|string',
            'event_date' => 'nullable|date',
            'file_url' => 'required|string',
            'sent' => 'nullable|boolean',
            'sent_at' => 'nullable|date',
        ]);

        $certificate = Certificate::query()->create([
            ...$validated,
            'tenant_id' => $tenantId,
        ]);

        return response()->json([
            'success' => true,
            'data' => $certificate,
            'message' => 'Sertifikat berhasil diterbitkan',
        ], 201);
    }

    /**
     * Display the specified resource.
     */
    public function show(Request $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');

        $certificate = Certificate::query()
            ->where('tenant_id', $tenantId)
            ->findOrFail($id);

        return response()->json([
            'success' => true,
            'data' => $certificate,
        ]);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');

        Gate::authorize('manage-sertifikat', [$tenantId]);

        $certificate = Certificate::query()
            ->where('tenant_id', $tenantId)
            ->findOrFail($id);

        $validated = $request->validate([
            'user_id' => 'nullable|uuid',
            'nama_penerima' => 'sometimes|required|string|max:255',
            'email' => 'nullable|email',
            'kelas' => 'nullable|string',
            'event' => 'sometimes|required|string',
            'event_date' => 'nullable|date',
            'file_url' => 'sometimes|required|string',
            'sent' => 'nullable|boolean',
            'sent_at' => 'nullable|date',
        ]);

        $certificate->update($validated);

        return response()->json([
            'success' => true,
            'data' => $certificate->fresh(),
            'message' => 'Sertifikat berhasil diperbarui',
        ]);
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');

        Gate::authorize('manage-sertifikat', [$tenantId]);

        $certificate = Certificate::query()
            ->where('tenant_id', $tenantId)
            ->findOrFail($id);

        $certificate->delete();

        return response()->json([
            'success' => true,
            'message' => 'Sertifikat berhasil dihapus',
        ]);
    }
}
