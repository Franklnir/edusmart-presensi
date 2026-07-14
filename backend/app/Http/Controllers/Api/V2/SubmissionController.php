<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V2\GradeSubmissionRequest;
use App\Http\Requests\Api\V2\StoreSubmissionRequest;
use App\Http\Requests\Api\V2\UpdateSubmissionRequest;
use App\Models\TugasJawaban;
use App\Models\Tugas;
use App\Services\IdempotencyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

class SubmissionController extends Controller
{
    private IdempotencyService $idempotencyService;

    public function __construct(IdempotencyService $idempotencyService)
    {
        $this->idempotencyService = $idempotencyService;
    }

    private function getRequestId(Request $request): string
    {
        return $request->header('X-Request-ID', (string) Str::uuid());
    }

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', TugasJawaban::class);
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $query = TugasJawaban::with('student:id,nama,photo_url')
            ->whereHas('tugas', function($q) use ($tenantId) {
                if (\Illuminate\Support\Facades\Schema::hasColumn('tugas', 'tenant_id')) {
                    $q->where('tenant_id', $tenantId);
                }
            });

        if ($request->filled('tugas_id')) {
            $tugasId = $request->query('tugas_id');
            if (is_array($tugasId)) {
                $query->whereIn('tugas_id', $tugasId);
            } else {
                $query->where('tugas_id', $tugasId);
            }
        }
        if ($request->filled('user_id')) {
            $query->where('user_id', $request->query('user_id'));
        }

        $user = $request->user();
        if ($user && $user->profile) {
            if ($user->profile->role === 'siswa') {
                $query->where('user_id', $user->profile->id);
            }
        }

        $query->orderBy('waktu_submit', 'desc');
        
        $perPage = $request->query('per_page', 50);
        if ($perPage === 'all') {
            $submissions = $query->get();
            return response()->json([
                'success' => true,
                'message' => 'Data jawaban tugas berhasil diambil.',
                'data' => $submissions,
                'request_id' => $reqId,
            ]);
        }
        
        $submissions = $query->paginate((int) $perPage);

        return response()->json([
            'success' => true,
            'message' => 'Data jawaban tugas berhasil diambil.',
            'data' => $submissions->items(),
            'meta' => [
                'current_page' => $submissions->currentPage(),
                'last_page' => $submissions->lastPage(),
                'per_page' => $submissions->perPage(),
                'total' => $submissions->total(),
            ],
            'request_id' => $reqId,
        ]);
    }

    public function store(StoreSubmissionRequest $request): JsonResponse
    {
        Gate::authorize('create', TugasJawaban::class);
        $validated = $request->validated();
        
        $profile = $request->user()->profile;
        $reqId = $this->getRequestId($request);
        
        $idempotencyKey = $validated['idempotency_key'] ?? (string) Str::uuid();

        return $this->idempotencyService->handle($request, $idempotencyKey, function () use ($validated, $profile, $reqId) {
            $jawaban = new TugasJawaban();
            $jawaban->tugas_id = $validated['tugas_id'];
            $jawaban->user_id = $profile->id;
            if (isset($validated['attachment_ids'])) {
                $jawaban->attachment_ids = $validated['attachment_ids'];
            }
            $jawaban->link_url = $validated['link_url'] ?? null;
            $jawaban->file_name = $validated['file_name'] ?? null;
            $jawaban->komentar_siswa = $validated['komentar_siswa'] ?? null;
            $jawaban->status = 'menunggu';
            $jawaban->waktu_submit = now();
            
            $jawaban->save();

            return response()->json([
                'success' => true,
                'message' => 'Jawaban berhasil dikumpulkan.',
                'data' => $jawaban,
                'request_id' => $reqId,
            ], 201);
        });
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);
        
        $jawaban = TugasJawaban::with('student:id,nama,photo_url')
            ->whereHas('tugas', function($q) use ($tenantId) {
                if (\Illuminate\Support\Facades\Schema::hasColumn('tugas', 'tenant_id')) {
                    $q->where('tenant_id', $tenantId);
                }
            })->findOrFail($id);
            
        Gate::authorize('view', $jawaban);

        return response()->json([
            'success' => true,
            'data' => $jawaban,
            'request_id' => $reqId,
        ]);
    }

    public function update(UpdateSubmissionRequest $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);
        
        $jawaban = TugasJawaban::whereHas('tugas', function($q) use ($tenantId) {
                if (\Illuminate\Support\Facades\Schema::hasColumn('tugas', 'tenant_id')) {
                    $q->where('tenant_id', $tenantId);
                }
            })->findOrFail($id);
            
        Gate::authorize('update', $jawaban);

        $validated = $request->validated();
        
        if (isset($validated['attachment_ids'])) $jawaban->attachment_ids = $validated['attachment_ids'];
        if (isset($validated['link_url'])) $jawaban->link_url = $validated['link_url'];
        if (isset($validated['file_name'])) $jawaban->file_name = $validated['file_name'];
        if (isset($validated['komentar_siswa'])) $jawaban->komentar_siswa = $validated['komentar_siswa'];
        
        $jawaban->waktu_submit = now(); // Update submit time
        $jawaban->save();

        return response()->json([
            'success' => true,
            'message' => 'Jawaban berhasil diperbarui.',
            'data' => $jawaban,
            'request_id' => $reqId,
        ]);
    }

    public function grade(GradeSubmissionRequest $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);
        
        $jawaban = TugasJawaban::whereHas('tugas', function($q) use ($tenantId) {
                if (\Illuminate\Support\Facades\Schema::hasColumn('tugas', 'tenant_id')) {
                    $q->where('tenant_id', $tenantId);
                }
            })->findOrFail($id);
            
        Gate::authorize('grade', $jawaban);

        $validated = $request->validated();
        $profile = $request->user()->profile;
        
        $jawaban->nilai = $validated['nilai'];
        $jawaban->status = $validated['status'] ?? 'dinilai';
        $jawaban->dinilai_oleh = $profile->id;
        $jawaban->dinilai_at = now();
        
        $jawaban->save();

        return response()->json([
            'success' => true,
            'message' => 'Jawaban berhasil dinilai.',
            'data' => $jawaban,
            'request_id' => $reqId,
        ]);
    }

    public function gradeByUser(Request $request): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);
        
        $validated = $request->validate([
            'tugas_id' => 'required|integer',
            'user_id' => 'required|uuid',
            'nilai' => 'required|integer|min:0|max:100',
        ]);

        $query = Tugas::query();
        if (\Illuminate\Support\Facades\Schema::hasColumn('tugas', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }
        
        $tugas = $query->findOrFail($validated['tugas_id']);
        Gate::authorize('view', $tugas); // Ensure guru has access to this tugas

        $jawaban = TugasJawaban::firstOrNew([
            'tugas_id' => $validated['tugas_id'],
            'user_id' => $validated['user_id'],
        ]);

        Gate::authorize('grade', $jawaban);

        $profile = $request->user()->profile;
        $jawaban->nilai = $validated['nilai'];
        $jawaban->status = 'dinilai';
        $jawaban->dinilai_oleh = $profile->id;
        $jawaban->dinilai_at = now();
        
        if (!$jawaban->exists) {
            $jawaban->waktu_submit = now();
        }
        
        $jawaban->save();

        return response()->json([
            'success' => true,
            'message' => 'Jawaban berhasil dinilai.',
            'data' => $jawaban,
            'request_id' => $reqId,
        ]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);
        
        $jawaban = TugasJawaban::whereHas('tugas', function($q) use ($tenantId) {
                if (\Illuminate\Support\Facades\Schema::hasColumn('tugas', 'tenant_id')) {
                    $q->where('tenant_id', $tenantId);
                }
            })->findOrFail($id);
            
        Gate::authorize('delete', $jawaban);

        $jawaban->delete();

        return response()->json([
            'success' => true,
            'message' => 'Jawaban berhasil dihapus.',
            'request_id' => $reqId,
        ]);
    }
}
