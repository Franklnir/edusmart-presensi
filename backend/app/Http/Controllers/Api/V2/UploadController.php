<?php

namespace App\Http\Controllers\Api\V2;

use App\Contracts\UploadStorageProvider;
use App\Exceptions\UploadException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V2\CancelUploadRequest;
use App\Http\Requests\Api\V2\CompleteUploadRequest;
use App\Http\Requests\Api\V2\StoreUploadRequest;
use App\Http\Resources\Api\V2\AttachmentResource;
use App\Http\Resources\Api\V2\UploadSessionResource;
use App\Models\Tugas;
use App\Models\UploadSession;
use App\Services\Actions\Upload\CancelUploadSession;
use App\Services\Actions\Upload\CompleteUploadSession;
use App\Services\Actions\Upload\CreateUploadSession;
use App\Services\IdempotencyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

class UploadController extends Controller
{
    public function __construct(
        private readonly UploadStorageProvider $provider,
        private readonly CreateUploadSession $createUpload,
        private readonly CompleteUploadSession $completeUpload,
        private readonly CancelUploadSession $cancelUpload,
        private readonly IdempotencyService $idempotency
    ) {}

    public function store(StoreUploadRequest $request): JsonResponse
    {
        if ($response = $this->unavailable($request)) {
            return $response;
        }

        $validated = $request->validated();
        $actor = $request->user()->profile;
        $tenantId = (string) $request->attributes->get('tenant_id');
        $assignment = isset($validated['assignment_id'])
            ? Tugas::where('tenant_id', $tenantId)->findOrFail($validated['assignment_id'])
            : null;

        if ($validated['purpose'] === 'assignment_attachment') {
            $assignment ? Gate::authorize('update', $assignment) : Gate::authorize('create', Tugas::class);
        } elseif ($actor->role !== 'siswa' || ! $assignment) {
            return $this->error($request, 'UPLOAD_SCOPE_FORBIDDEN', 'Upload submission hanya tersedia bagi siswa untuk tugas yang valid.', 403);
        } else {
            Gate::authorize('view', $assignment);
        }

        return $this->idempotency->handle($request, $validated['idempotency_key'] ?? null, function () use ($request, $validated, $actor, $tenantId, $assignment) {
            try {
                $result = $this->createUpload->execute($validated, $actor, $tenantId, $assignment);
            } catch (UploadException $exception) {
                return $this->error($request, $exception->stableCode, $exception->getMessage(), $exception->httpStatus);
            }

            return response()->json([
                'success' => true,
                'message' => 'Upload session berhasil dibuat.',
                'data' => [
                    'upload' => UploadSessionResource::make($result['session'])->resolve($request),
                    'instruction' => $result['instruction'],
                ],
                'request_id' => $this->requestId($request),
            ], 201);
        });
    }

    public function show(Request $request, string $id): JsonResponse
    {
        if ($response = $this->unavailable($request)) {
            return $response;
        }

        $session = $this->ownedSession($request, $id);

        return response()->json([
            'success' => true,
            'message' => 'Upload session berhasil dimuat.',
            'data' => UploadSessionResource::make($session)->resolve($request),
            'request_id' => $this->requestId($request),
        ]);
    }

    public function complete(CompleteUploadRequest $request, string $id): JsonResponse
    {
        if ($response = $this->unavailable($request)) {
            return $response;
        }

        $validated = $request->validated();
        $tenantId = (string) $request->attributes->get('tenant_id');
        $actorId = (string) $request->user()->id;

        return $this->idempotency->handle($request, $validated['idempotency_key'] ?? null, function () use ($request, $id, $tenantId, $actorId) {
            try {
                $attachment = $this->completeUpload->execute($id, $tenantId, $actorId);
            } catch (UploadException $exception) {
                return $this->error($request, $exception->stableCode, $exception->getMessage(), $exception->httpStatus);
            }

            return response()->json([
                'success' => true,
                'message' => 'Upload berhasil diverifikasi.',
                'data' => ['attachment' => AttachmentResource::make($attachment)->resolve($request)],
                'request_id' => $this->requestId($request),
            ]);
        });
    }

    public function destroy(CancelUploadRequest $request, string $id): JsonResponse
    {
        if ($response = $this->unavailable($request)) {
            return $response;
        }

        $validated = $request->validated();
        $tenantId = (string) $request->attributes->get('tenant_id');
        $actorId = (string) $request->user()->id;

        return $this->idempotency->handle($request, $validated['idempotency_key'] ?? null, function () use ($request, $id, $tenantId, $actorId) {
            try {
                $session = $this->cancelUpload->execute($id, $tenantId, $actorId);
            } catch (UploadException $exception) {
                return $this->error($request, $exception->stableCode, $exception->getMessage(), $exception->httpStatus);
            }

            return response()->json([
                'success' => true,
                'message' => 'Upload session dibatalkan.',
                'data' => UploadSessionResource::make($session)->resolve($request),
                'request_id' => $this->requestId($request),
            ]);
        });
    }

    private function ownedSession(Request $request, string $id): UploadSession
    {
        return UploadSession::whereKey($id)
            ->where('tenant_id', $request->attributes->get('tenant_id'))
            ->where('actor_id', $request->user()->id)
            ->firstOrFail();
    }

    private function unavailable(Request $request): ?JsonResponse
    {
        if (! config('api_v2.uploads_enabled', false)) {
            return $this->error($request, 'UPLOAD_V2_DISABLED', 'Upload Session API V2 belum diaktifkan.', 503);
        }

        return $this->provider->ready()
            ? null
            : $this->error($request, 'UPLOAD_PROVIDER_UNAVAILABLE', 'Provider Upload API V2 belum siap.', 503);
    }

    private function requestId(Request $request): string
    {
        return $request->header('X-Request-ID', (string) Str::uuid());
    }

    private function error(Request $request, string $code, string $message, int $status): JsonResponse
    {
        return response()->json([
            'success' => false,
            'code' => $code,
            'message' => $message,
            'error' => $message,
            'errors' => (object) [],
            'request_id' => $this->requestId($request),
        ], $status);
    }
}
