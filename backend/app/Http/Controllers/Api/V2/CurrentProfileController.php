<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V2\UpdateCurrentProfileRequest;
use App\Http\Resources\Api\V2\CurrentProfileResource;
use App\Models\Profile;
use App\Services\IdempotencyService;
use App\Services\Profile\UpdateCurrentProfile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

class CurrentProfileController extends Controller
{
    public function __construct(
        private readonly IdempotencyService $idempotency,
        private readonly UpdateCurrentProfile $updateCurrentProfile
    ) {}

    public function show(Request $request): JsonResponse
    {
        $profile = $this->profile($request);
        Gate::authorize('viewSelf', $profile);

        return $this->response($request, $profile, 'Profil berhasil dimuat.');
    }

    public function provision(Request $request): JsonResponse
    {
        $user = $request->user();
        $tenantId = (string) $request->attributes->get('tenant_id');

        $profile = Profile::query()
            ->where('id', $user->id)
            ->where('tenant_id', $tenantId)
            ->first();

        if ($profile) {
            return $this->response($request, $profile, 'Profil sudah ada.');
        }

        $validated = $request->validate([
            'role' => 'required|in:siswa,guru,admin',
            'nama' => 'required|string|max:120',
            'email' => 'nullable|email|max:255',
            'status' => 'nullable|in:active,nonaktif',
            'created_via' => 'nullable|string|max:50',
            'idempotency_key' => 'nullable|string|max:100',
            'jk' => 'nullable|string',
            'telp' => 'nullable|string',
            'alamat' => 'nullable|string',
            'kelas' => 'nullable|string',
            'usia' => 'nullable|integer',
            'nis' => 'nullable|string',
            'agama' => 'nullable|string',
            'jabatan' => 'nullable|string',
        ]);

        return $this->idempotency->handle(
            $request,
            $validated['idempotency_key'] ?? null,
            function () use ($request, $user, $tenantId, $validated): JsonResponse {
                $profile = Profile::query()->create([
                    'id' => $user->id,
                    'tenant_id' => $tenantId,
                    'role' => $validated['role'],
                    'nama' => $validated['nama'],
                    'email' => $validated['email'] ?? $user->email,
                    'status' => $validated['status'] ?? 'active',
                    'created_via' => $validated['created_via'] ?? 'manual_registration',
                    'jk' => $validated['jk'] ?? null,
                    'telp' => $validated['telp'] ?? null,
                    'alamat' => $validated['alamat'] ?? null,
                    'kelas' => $validated['kelas'] ?? null,
                    'usia' => $validated['usia'] ?? null,
                    'nis' => $validated['nis'] ?? null,
                    'agama' => $validated['agama'] ?? null,
                    'jabatan' => $validated['jabatan'] ?? null,
                ]);

                return $this->response($request, $profile, 'Profil berhasil dibuat.', 201);
            }
        );
    }

    public function update(UpdateCurrentProfileRequest $request): JsonResponse
    {
        $profile = $this->profile($request);
        Gate::authorize('updateSelf', $profile);

        return $this->idempotency->handle(
            $request,
            $request->validated('idempotency_key'),
            function () use ($request, $profile): JsonResponse {
                $updated = $this->updateCurrentProfile->handle(
                    $profile,
                    $request->user(),
                    $request->validated()
                );

                return $this->response($request, $updated, 'Profil berhasil diperbarui.');
            }
        );
    }

    private function profile(Request $request): Profile
    {
        $profile = Profile::query()
            ->where('id', $request->user()->id)
            ->where('tenant_id', (string) $request->attributes->get('tenant_id'))
            ->first();

        abort_unless($profile, 403, 'Profil tenant tidak ditemukan.');

        return $profile;
    }

    private function response(Request $request, Profile $profile, string $message, int $status = 200): JsonResponse
    {
        return response()->json([
            'success' => true,
            'message' => $message,
            'data' => (new CurrentProfileResource($profile))->resolve($request),
            'request_id' => $request->attributes->get('request_id') ?: $request->header('X-Request-ID', (string) Str::uuid()),
        ], $status);
    }
}
