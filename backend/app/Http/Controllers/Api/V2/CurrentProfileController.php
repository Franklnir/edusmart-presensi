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

    private function response(Request $request, Profile $profile, string $message): JsonResponse
    {
        return response()->json([
            'success' => true,
            'message' => $message,
            'data' => (new CurrentProfileResource($profile))->resolve($request),
            'request_id' => $request->attributes->get('request_id') ?: $request->header('X-Request-ID', (string) Str::uuid()),
        ]);
    }
}
