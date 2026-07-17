<?php

namespace App\Http\Controllers\Api\V2;

use App\Contracts\UploadStorageProvider;
use App\Exceptions\UploadException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V2\DeleteAttachmentRequest;
use App\Http\Resources\Api\V2\AttachmentResource;
use App\Models\Attachment;
use App\Services\Actions\Upload\DeleteAttachment;
use App\Services\IdempotencyService;
use App\Services\UploadTelemetry;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

class AttachmentController extends Controller
{
    public function __construct(
        private readonly UploadStorageProvider $provider,
        private readonly DeleteAttachment $deleteAttachment,
        private readonly IdempotencyService $idempotency,
        private readonly UploadTelemetry $telemetry
    ) {}

    public function show(Request $request, string $id): JsonResponse
    {
        if ($response = $this->unavailable($request)) {
            return $response;
        }

        $attachment = $this->tenantAttachment($request, $id);
        Gate::authorize('view', $attachment);

        return response()->json([
            'success' => true,
            'message' => 'Attachment berhasil dimuat.',
            'data' => AttachmentResource::make($attachment)->resolve($request),
            'request_id' => $this->requestId($request),
        ]);
    }

    public function download(Request $request, string $id)
    {
        $startedAt = hrtime(true);
        if ($response = $this->unavailable($request)) {
            return $response;
        }

        $attachment = $this->tenantAttachment($request, $id);
        Gate::authorize('view', $attachment);
        if ($attachment->provider !== $this->provider->name() || $attachment->bucket !== $this->provider->bucket()) {
            return $this->error($request, 'ATTACHMENT_PROVIDER_MISMATCH', 'Provider attachment tidak tersedia.', 409);
        }

        $instruction = $this->provider->temporaryDownloadUrl(
            $attachment->object_key,
            (int) config('api_v2.uploads.download_ttl_seconds', 600)
        );

        if ($request->boolean('redirect') && empty($instruction['headers']) && ! empty($instruction['url'])) {
            return redirect()->away($instruction['url']);
        }

        $this->telemetry->record($request, 'download_sign', 'succeeded', $startedAt, [
            'upload_session_id' => $attachment->upload_session_id,
            'attachment_id' => $attachment->id,
            'purpose' => $attachment->purpose,
            'provider' => $attachment->provider,
            'size' => $attachment->actual_size ?? $attachment->size,
            'status_transition' => 'active->signed',
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Instruksi download sementara berhasil dibuat.',
            'data' => ['instruction' => $instruction],
            'request_id' => $this->requestId($request),
        ]);
    }

    public function destroy(DeleteAttachmentRequest $request, string $id): JsonResponse
    {
        if ($response = $this->unavailable($request)) {
            return $response;
        }

        $attachment = $this->tenantAttachment($request, $id);
        Gate::authorize('delete', $attachment);
        $validated = $request->validated();

        return $this->idempotency->handle($request, $validated['idempotency_key'] ?? null, function () use ($request, $attachment) {
            $startedAt = hrtime(true);
            try {
                $result = $this->deleteAttachment->execute($attachment);
            } catch (UploadException $exception) {
                $this->telemetry->record($request, 'delete', 'failed', $startedAt, [
                    'upload_session_id' => $attachment->upload_session_id,
                    'attachment_id' => $attachment->id,
                    'purpose' => $attachment->purpose,
                    'provider' => $attachment->provider,
                    'size' => $attachment->actual_size ?? $attachment->size,
                    'status_transition' => 'active->failed',
                    'failure_code' => $exception->stableCode,
                ]);

                return $this->error($request, $exception->stableCode, $exception->getMessage(), $exception->httpStatus);
            }

            $this->telemetry->record($request, 'delete', 'succeeded', $startedAt, [
                'upload_session_id' => $attachment->upload_session_id,
                'attachment_id' => $attachment->id,
                'purpose' => $attachment->purpose,
                'provider' => $attachment->provider,
                'size' => $attachment->actual_size ?? $attachment->size,
                'status_transition' => $result['deleted'] ? 'active->deleted' : 'active->delete_pending',
                'failure_code' => $result['deleted'] ? null : 'UPLOAD_DELETE_PENDING',
            ]);

            return response()->json([
                'success' => true,
                'message' => $result['deleted']
                    ? 'Attachment berhasil dihapus.'
                    : 'Attachment dilepas dan menunggu cleanup object.',
                'data' => ['cleanup_pending' => ! $result['deleted']],
                'request_id' => $this->requestId($request),
            ], $result['deleted'] ? 200 : 202);
        });
    }

    private function tenantAttachment(Request $request, string $id): Attachment
    {
        return Attachment::whereKey($id)
            ->where('tenant_id', $request->attributes->get('tenant_id'))
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
        return (string) ($request->attributes->get('request_id')
            ?: $request->header('X-Request-ID', (string) Str::uuid()));
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

    public function signedUrl(Request $request): JsonResponse
    {
        if ($response = $this->unavailable($request)) {
            return $response;
        }

        $validated = $request->validate([
            'bucket' => 'required|string|max:100',
            'object_path' => 'required|string|max:500',
            'expires_in' => 'integer|min:60|max:86400',
        ]);

        $objectKey = $validated['object_path'];
        $expiresIn = (int) ($validated['expires_in'] ?? 900);
        $bucket = $validated['bucket'];

        try {
            $url = $this->provider->signedUrl($objectKey, $expiresIn, $bucket);

            return response()->json([
                'success' => true,
                'data' => ['signed_url' => $url, 'expires_in' => $expiresIn],
                'request_id' => $this->requestId($request),
            ]);
        } catch (\Exception $e) {
            return $this->error($request, 'SIGNED_URL_FAILED', $e->getMessage(), 500);
        }
    }
}
