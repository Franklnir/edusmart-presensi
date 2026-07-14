<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V2\CompleteUploadRequest;
use App\Http\Requests\Api\V2\StoreUploadRequest;
use App\Models\Attachment;
use App\Models\Tugas;
use App\Models\UploadSession;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class UploadController extends Controller
{
    public function store(StoreUploadRequest $request): JsonResponse
    {
        if ($disabled = $this->disabledResponse($request)) {
            return $disabled;
        }

        $validated = $request->validated();
        $actor = $request->user()->profile;
        $tenantId = (string) $request->attributes->get('tenant_id');
        $assignment = null;
        if (! empty($validated['assignment_id'])) {
            $assignment = Tugas::where('tenant_id', $tenantId)->findOrFail($validated['assignment_id']);
        }

        if ($validated['purpose'] === 'assignment_attachment') {
            $assignment ? Gate::authorize('update', $assignment) : Gate::authorize('create', Tugas::class);
        } else {
            if ($actor->role !== 'siswa' || ! $assignment) {
                return $this->error($request, 'UPLOAD_SCOPE_FORBIDDEN', 'Upload submission hanya tersedia bagi siswa untuk tugas yang valid.', 403);
            }
            Gate::authorize('view', $assignment);
        }

        $sessionId = (string) Str::uuid();
        $extension = strtolower(pathinfo($validated['filename'], PATHINFO_EXTENSION));
        $baseName = Str::slug(pathinfo($validated['filename'], PATHINFO_FILENAME)) ?: 'file';
        $finalFilename = $baseName.'-'.Str::lower(Str::random(12)).'.'.$extension;
        $assignmentSegment = $assignment?->id ?: 'pending';
        $ownerSegment = $validated['purpose'] === 'submission_attachment'
            ? '/submissions/'.$actor->id
            : '';
        $objectKey = "tenants/{$tenantId}/assignments/{$assignmentSegment}{$ownerSegment}/{$sessionId}/{$finalFilename}";

        $session = UploadSession::create([
            'id' => $sessionId,
            'tenant_id' => $tenantId,
            'actor_id' => $actor->id,
            'purpose' => $validated['purpose'],
            'assignment_id' => $assignment?->id,
            'filename' => $validated['filename'],
            'content_type' => $validated['content_type'],
            'size' => $validated['size'],
            'object_key' => $objectKey,
            'status' => 'pending',
            'expires_at' => now()->addMinutes(15),
        ]);

        $disk = $this->disk();
        $uploadHeaders = ['Content-Type' => $validated['content_type']];
        if ($disk === 's3') {
            $temporary = Storage::disk($disk)->temporaryUploadUrl($objectKey, $session->expires_at, $uploadHeaders);
            $uploadUrl = is_array($temporary) ? $temporary['url'] : $temporary;
            $uploadHeaders = is_array($temporary) ? ($temporary['headers'] ?? $uploadHeaders) : $uploadHeaders;
        } else {
            // Local direct-upload transport is intentionally not enabled in production.
            $uploadUrl = url('/api/v2/storage-mock/upload?session='.$sessionId);
        }

        return response()->json([
            'success' => true,
            'data' => [
                'session_id' => $session->id,
                'upload_url' => $uploadUrl,
                'upload_headers' => $uploadHeaders,
                'expires_at' => $session->expires_at,
            ],
            'request_id' => $this->requestId($request),
        ], 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        if ($disabled = $this->disabledResponse($request)) {
            return $disabled;
        }

        $session = $this->ownedSession($request, $id);

        return response()->json([
            'success' => true,
            'data' => [
                'session_id' => $session->id,
                'purpose' => $session->purpose,
                'assignment_id' => $session->assignment_id,
                'filename' => $session->filename,
                'content_type' => $session->content_type,
                'size' => $session->size,
                'status' => $session->status,
                'expires_at' => $session->expires_at,
            ],
            'request_id' => $this->requestId($request),
        ]);
    }

    public function complete(CompleteUploadRequest $request, string $id): JsonResponse
    {
        if ($disabled = $this->disabledResponse($request)) {
            return $disabled;
        }

        $tenantId = (string) $request->attributes->get('tenant_id');
        $actorId = (string) $request->user()->id;
        $result = DB::transaction(function () use ($id, $tenantId, $actorId, $request) {
            $session = UploadSession::whereKey($id)
                ->where('tenant_id', $tenantId)
                ->where('actor_id', $actorId)
                ->lockForUpdate()
                ->firstOrFail();

            if ($session->status !== 'pending') {
                return $this->error($request, 'UPLOAD_SESSION_NOT_PENDING', 'Upload session tidak lagi pending.', 409);
            }
            if ($session->expires_at->isPast()) {
                $session->update(['status' => 'expired']);

                return $this->error($request, 'UPLOAD_SESSION_EXPIRED', 'Upload session telah kedaluwarsa.', 409);
            }

            $storage = Storage::disk($this->disk());
            if (! $storage->exists($session->object_key)) {
                return $this->error($request, 'UPLOAD_OBJECT_NOT_FOUND', 'Object upload belum tersedia.', 422);
            }
            if ((int) $storage->size($session->object_key) !== (int) $session->size) {
                return $this->error($request, 'UPLOAD_SIZE_MISMATCH', 'Ukuran object tidak sesuai metadata session.', 422);
            }
            $actualMime = $storage->mimeType($session->object_key);
            if ($actualMime && $actualMime !== 'application/octet-stream' && $actualMime !== $session->content_type) {
                return $this->error($request, 'UPLOAD_MIME_MISMATCH', 'MIME object tidak sesuai metadata session.', 422);
            }

            $attachment = Attachment::create([
                'id' => (string) Str::uuid(),
                'tenant_id' => $tenantId,
                'actor_id' => $actorId,
                'upload_session_id' => $session->id,
                'purpose' => $session->purpose,
                'assignment_id' => $session->assignment_id,
                'object_key' => $session->object_key,
                'filename' => $session->filename,
                'content_type' => $session->content_type,
                'size' => $session->size,
            ]);
            $session->update(['status' => 'completed']);

            return $attachment;
        });

        if ($result instanceof JsonResponse) {
            return $result;
        }

        return response()->json([
            'success' => true,
            'message' => 'Upload berhasil diverifikasi.',
            'data' => ['attachment_id' => $result->id],
            'request_id' => $this->requestId($request),
        ]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        if ($disabled = $this->disabledResponse($request)) {
            return $disabled;
        }

        $session = $this->ownedSession($request, $id);
        if ($session->status !== 'pending') {
            return $this->error($request, 'UPLOAD_SESSION_NOT_PENDING', 'Hanya upload session pending yang dapat dibatalkan.', 409);
        }

        $session->update(['status' => 'failed']);
        $storage = Storage::disk($this->disk());
        if ($storage->exists($session->object_key)) {
            $storage->delete($session->object_key);
        }

        return response()->json([
            'success' => true,
            'message' => 'Upload session dibatalkan.',
            'request_id' => $this->requestId($request),
        ]);
    }

    private function ownedSession(Request $request, string $id): UploadSession
    {
        return UploadSession::whereKey($id)
            ->where('tenant_id', $request->attributes->get('tenant_id'))
            ->where('actor_id', $request->user()->id)
            ->firstOrFail();
    }

    private function disk(): string
    {
        return config('filesystems.default') === 's3' ? 's3' : 'local';
    }

    private function disabledResponse(Request $request): ?JsonResponse
    {
        return config('api_v2.uploads_enabled', false)
            ? null
            : $this->error($request, 'UPLOAD_V2_DISABLED', 'Upload Session API V2 belum diaktifkan untuk provider ini.', 503);
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
            'request_id' => $this->requestId($request),
        ], $status);
    }
}
