<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V2\StoreAssignmentRequest;
use App\Http\Requests\Api\V2\UpdateAssignmentRequest;
use App\Models\Tugas;
use App\Models\TugasJawaban;
use App\Services\IdempotencyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

class AssignmentController extends Controller
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
        Gate::authorize('viewAny', Tugas::class);
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $query = Tugas::query();

        if (\Illuminate\Support\Facades\Schema::hasColumn('tugas', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        if ($request->filled('kelas')) {
            $query->where('kelas', $request->query('kelas'));
        }
        if ($request->filled('created_by')) {
            $query->where('created_by', $request->query('created_by'));
        }
        if ($request->filled('mapel')) {
            $query->where('mapel', $request->query('mapel'));
        }
        if ($request->filled('tahun_ajaran')) {
            $query->where('tahun_ajaran', $request->query('tahun_ajaran'));
        }
        if ($request->filled('semester')) {
            $query->where('semester', $request->query('semester'));
        }

        $user = $request->user();
        if ($user && $user->profile) {
            if ($user->profile->role === 'siswa') {
                $query->where('kelas', $user->profile->kelas);
            } elseif ($user->profile->role === 'guru') {
                $query->where('created_by', $user->profile->id);
            }
        }

        if ($request->filled('status')) {
            $status = $request->query('status');
            if ($status === 'active') {
                $query->where('deadline', '>=', now());
            } elseif ($status === 'expired') {
                $query->where('deadline', '<', now());
            }
        }
        
        if ($request->filled('created_after')) {
            $query->where('created_at', '>=', $request->query('created_after'));
        }
        if ($request->filled('created_before')) {
            $query->where('created_at', '<', $request->query('created_before'));
        }
        
        if ($request->filled('search')) {
            $search = $request->query('search');
            $query->where(function($q) use ($search) {
                $q->where('judul', 'like', "%{$search}%")
                  ->orWhere('keterangan', 'like', "%{$search}%");
            });
        }

        $query->orderBy('created_at', 'desc');

        $perPage = $request->query('per_page', 25);
        if ($perPage === 'all') {
            $assignments = $query->get();
            return response()->json([
                'success' => true,
                'message' => 'Data tugas berhasil diambil.',
                'data' => $assignments,
                'request_id' => $reqId,
            ]);
        }
        
        $assignments = $query->paginate((int) $perPage);

        return response()->json([
            'success' => true,
            'message' => 'Data tugas berhasil diambil.',
            'data' => $assignments->items(),
            'meta' => [
                'current_page' => $assignments->currentPage(),
                'last_page' => $assignments->lastPage(),
                'per_page' => $assignments->perPage(),
                'total' => $assignments->total(),
            ],
            'request_id' => $reqId,
        ]);
    }

    public function store(StoreAssignmentRequest $request): JsonResponse
    {
        Gate::authorize('create', Tugas::class);
        $validated = $request->validated();
        
        $profile = $request->user()->profile;
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);

        $idempotencyKey = $validated['idempotency_key'] ?? (string) Str::uuid();

        return $this->idempotencyService->handle($request, $idempotencyKey, function () use ($validated, $profile, $tenantId, $reqId) {
            $tugas = new Tugas();
            $tugas->kelas = $validated['kelas'];
            $tugas->judul = $validated['judul'];
            $tugas->mapel = $validated['mapel'];
            $tugas->mulai = $validated['mulai'] ?? now();
            $tugas->deadline = $validated['deadline'];
            $tugas->keterangan = $validated['keterangan'] ?? null;
            if (isset($validated['attachment_ids'])) {
                $tugas->attachment_ids = $validated['attachment_ids'];
            }
            $tugas->link = $validated['link'] ?? null;
            $tugas->tahun_ajaran = $validated['tahun_ajaran'] ?? null;
            $tugas->semester = $validated['semester'] ?? null;
            $tugas->angkatan = $validated['angkatan'] ?? null;
            $tugas->created_by = $profile->id;
            
            if (\Illuminate\Support\Facades\Schema::hasColumn('tugas', 'tenant_id')) {
                $tugas->tenant_id = $tenantId;
            }

            $tugas->save();

            return response()->json([
                'success' => true,
                'message' => 'Tugas berhasil dibuat.',
                'data' => $tugas,
                'request_id' => $reqId,
            ], 201);
        });
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);
        
        $query = Tugas::query();
        if (\Illuminate\Support\Facades\Schema::hasColumn('tugas', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }
        
        $tugas = $query->findOrFail($id);
        Gate::authorize('view', $tugas);

        return response()->json([
            'success' => true,
            'data' => $tugas,
            'request_id' => $reqId,
        ]);
    }

    public function update(UpdateAssignmentRequest $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);
        
        $query = Tugas::query();
        if (\Illuminate\Support\Facades\Schema::hasColumn('tugas', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }
        
        $tugas = $query->findOrFail($id);
        Gate::authorize('update', $tugas);

        $validated = $request->validated();
        
        $tugas->fill($validated);
        $tugas->save();

        return response()->json([
            'success' => true,
            'message' => 'Tugas berhasil diperbarui.',
            'data' => $tugas,
            'request_id' => $reqId,
        ]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $this->getRequestId($request);
        
        $query = Tugas::query();
        if (\Illuminate\Support\Facades\Schema::hasColumn('tugas', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }
        
        $tugas = $query->findOrFail($id);
        Gate::authorize('delete', $tugas);

        $submissionsCount = TugasJawaban::where('tugas_id', $tugas->id)->count();

        if ($submissionsCount > 0) {
            return response()->json([
                'success' => false,
                'code' => 'ASSIGNMENT_HAS_SUBMISSIONS',
                'message' => 'Tugas sudah memiliki jawaban siswa dan tidak dapat dihapus.',
                'error' => 'Tugas sudah memiliki jawaban siswa dan tidak dapat dihapus.',
                'request_id' => $reqId,
            ], 409);
        }

        $tugas->delete();

        return response()->json([
            'success' => true,
            'message' => 'Tugas berhasil dihapus.',
            'request_id' => $reqId,
        ]);
    }
}
