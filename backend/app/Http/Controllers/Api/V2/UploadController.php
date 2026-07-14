<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V2\StoreUploadRequest;
use App\Http\Requests\Api\V2\CompleteUploadRequest;
use App\Models\UploadSession;
use App\Models\Attachment;
use App\Models\Tugas;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Gate;

class UploadController extends Controller
{
    private function getRequestId(Request $request): string
    {
        return $request->header('X-Request-ID', (string) Str::uuid());
    }

    public function store(StoreUploadRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $user = $request->user();
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        // Authorization checks
        if ($validated['purpose'] === 'assignment_attachment') {
            Gate::authorize('create', Tugas::class);
        } elseif ($validated['purpose'] === 'submission_attachment') {
            // Can be authorized more granularly later, but simple check for now:
            if (!$user->profile || $user->profile->role !== 'siswa') {
                return response()->json(['success' => false, 'message' => 'Only siswa can upload submissions.'], 403);
            }
        }

        $sessionId = (string) Str::uuid();
        
        // Generate Object Key
        $ext = pathinfo($validated['filename'], PATHINFO_EXTENSION);
        $safeName = Str::slug(pathinfo($validated['filename'], PATHINFO_FILENAME));
        $random = Str::random(8);
        $finalFilename = "{$safeName}-{$random}.{$ext}";

        if ($validated['purpose'] === 'assignment_attachment') {
            $assignmentId = $validated['assignment_id'] ?? 'temp';
            $objectKey = "tenants/{$tenantId}/assignments/{$assignmentId}/attachments/{$sessionId}/{$finalFilename}";
        } else {
            $assignmentId = $validated['assignment_id'] ?? 'unknown';
            $studentId = $user->profile->id ?? 'unknown';
            $objectKey = "tenants/{$tenantId}/assignments/{$assignmentId}/submissions/{$studentId}/{$sessionId}/{$finalFilename}";
        }

        $session = UploadSession::create([
            'id' => $sessionId,
            'tenant_id' => $tenantId,
            'actor_id' => $user->id,
            'purpose' => $validated['purpose'],
            'assignment_id' => $validated['assignment_id'] ?? null,
            'filename' => $validated['filename'],
            'content_type' => $validated['content_type'],
            'size' => $validated['size'],
            'object_key' => $objectKey,
            'status' => 'pending',
            'expires_at' => now()->addMinutes(30),
        ]);

        // Generate Signed URL
        $disk = config('filesystems.default') === 's3' ? 's3' : 'local';
        
        if ($disk === 's3') {
            $uploadUrl = Storage::disk('s3')->temporaryUploadUrl(
                $objectKey,
                now()->addMinutes(30),
                ['ContentType' => $validated['content_type']]
            );
        } else {
            // Local mockup for signed url
            $uploadUrl = url("/api/v2/storage-mock/upload?key=" . urlencode($objectKey) . "&session=" . $sessionId);
        }

        return response()->json([
            'success' => true,
            'data' => [
                'session_id' => $session->id,
                'upload_url' => $uploadUrl,
                'object_key' => $objectKey,
                'expires_at' => $session->expires_at,
            ],
            'request_id' => $reqId,
        ], 201);
    }

    public function complete(CompleteUploadRequest $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $user = $request->user();
        $reqId = $this->getRequestId($request);

        $session = UploadSession::where('id', $id)
            ->where('tenant_id', $tenantId)
            ->where('actor_id', $user->id)
            ->firstOrFail();

        if ($session->status !== 'pending') {
            return response()->json(['success' => false, 'message' => 'Upload session is not pending.'], 400);
        }

        if ($session->expires_at < now()) {
            $session->update(['status' => 'expired']);
            return response()->json(['success' => false, 'message' => 'Upload session expired.'], 400);
        }

        $disk = config('filesystems.default') === 's3' ? 's3' : 'local';

        // For local mock, we assume success if they hit this endpoint
        // For s3, we could check if file exists
        if ($disk === 's3' && !Storage::disk('s3')->exists($session->object_key)) {
            return response()->json(['success' => false, 'message' => 'File not found in storage.'], 400);
        }

        $attachmentId = (string) Str::uuid();

        $attachment = Attachment::create([
            'id' => $attachmentId,
            'tenant_id' => $tenantId,
            'upload_session_id' => $session->id,
            'object_key' => $session->object_key,
            'filename' => $session->filename,
            'content_type' => $session->content_type,
            'size' => $session->size,
        ]);

        $session->update(['status' => 'completed']);

        return response()->json([
            'success' => true,
            'message' => 'Upload completed.',
            'data' => [
                'attachment_id' => $attachment->id,
            ],
            'request_id' => $reqId,
        ]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $user = $request->user();
        $reqId = $this->getRequestId($request);

        $session = UploadSession::where('id', $id)
            ->where('tenant_id', $tenantId)
            ->where('actor_id', $user->id)
            ->firstOrFail();

        if ($session->status === 'pending') {
            $session->update(['status' => 'failed']);
            
            $disk = config('filesystems.default') === 's3' ? 's3' : 'local';
            if ($disk === 's3' && Storage::disk('s3')->exists($session->object_key)) {
                Storage::disk('s3')->delete($session->object_key);
            }
        }

        return response()->json([
            'success' => true,
            'message' => 'Upload session cancelled.',
            'request_id' => $reqId,
        ]);
    }
}
