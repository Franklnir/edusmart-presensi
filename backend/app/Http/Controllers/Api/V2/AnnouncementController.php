<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V2\StoreAnnouncementRequest;
use App\Http\Requests\Api\V2\UpdateAnnouncementRequest;
use App\Http\Resources\Api\V2\AnnouncementResource;
use App\Services\IdempotencyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class AnnouncementController extends Controller
{
    public function __construct(
        private readonly IdempotencyService $idempotency
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $tenantId = $this->tenantId($request);
        $role = $this->role($request);
        $targets = ['semua', 'all', ''];

        if ($role === 'guru' || $role === 'teacher') {
            $targets[] = 'guru';
            $targets[] = 'teacher';
        }
        if ($role === 'siswa' || $role === 'student') {
            $targets[] = 'siswa';
            $targets[] = 'student';
        }

        $query = DB::table('pengumuman')
            ->where('tenant_id', $tenantId)
            ->when($role !== 'admin', function ($builder) use ($targets) {
                $builder->where(function ($targetQuery) use ($targets) {
                    $targetQuery
                        ->whereNull('target')
                        ->orWhereIn(DB::raw('lower(target)'), $targets);
                });
            })
            ->orderByDesc('created_at')
            ->orderByDesc('id');

        $perPage = min(max((int) $request->query('per_page', 20), 1), 100);

        return AnnouncementResource::collection($query->paginate($perPage)->appends($request->query()))
            ->additional([
                'success' => true,
                'message' => 'Pengumuman berhasil dimuat.',
                'request_id' => $this->requestId($request),
            ]);
    }

    public function store(StoreAnnouncementRequest $request): JsonResponse
    {
        $this->authorizeAdmin($request);
        $tenantId = $this->tenantId($request);

        return $this->idempotency->handle(
            $request,
            $request->validated('idempotency_key'),
            function () use ($request, $tenantId): JsonResponse {
                $now = now();
                $announcement = [
                    'id' => (string) Str::uuid(),
                    'tenant_id' => $tenantId,
                    'judul' => trim((string) $request->validated('judul')),
                    'keterangan' => trim((string) $request->validated('keterangan')),
                    'target' => $this->normalizeTarget($request->validated('target')),
                    'created_at' => $now,
                    'updated_at' => $now,
                ];

                DB::table('pengumuman')->insert($announcement);

                return (new AnnouncementResource((object) $announcement))->additional([
                    'success' => true,
                    'message' => 'Pengumuman berhasil dibuat.',
                    'request_id' => $this->requestId($request),
                ])->response()->setStatusCode(201);
            }
        );
    }

    public function update(UpdateAnnouncementRequest $request, string $id): JsonResponse
    {
        $this->authorizeAdmin($request);
        $tenantId = $this->tenantId($request);
        $existing = $this->find($tenantId, $id);

        if (! $existing) {
            return $this->notFound($request);
        }

        return $this->idempotency->handle(
            $request,
            $request->validated('idempotency_key'),
            function () use ($request, $tenantId, $id): JsonResponse {
                $payload = [];
                if ($request->has('judul')) {
                    $payload['judul'] = trim((string) $request->validated('judul'));
                }
                if ($request->has('keterangan')) {
                    $payload['keterangan'] = trim((string) $request->validated('keterangan'));
                }
                if ($request->has('target')) {
                    $payload['target'] = $this->normalizeTarget($request->validated('target'));
                }
                $payload['updated_at'] = now();

                DB::table('pengumuman')
                    ->where('tenant_id', $tenantId)
                    ->where('id', $id)
                    ->update($payload);

                return (new AnnouncementResource($this->find($tenantId, $id)))->additional([
                    'success' => true,
                    'message' => 'Pengumuman berhasil diperbarui.',
                    'request_id' => $this->requestId($request),
                ])->response();
            }
        );
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $this->authorizeAdmin($request);
        $tenantId = $this->tenantId($request);

        if (! $this->find($tenantId, $id)) {
            return $this->notFound($request);
        }

        return $this->idempotency->handle(
            $request,
            $request->input('idempotency_key'),
            function () use ($request, $tenantId, $id): JsonResponse {
                DB::table('pengumuman')
                    ->where('tenant_id', $tenantId)
                    ->where('id', $id)
                    ->delete();

                return response()->json([
                    'success' => true,
                    'message' => 'Pengumuman berhasil dihapus.',
                    'request_id' => $this->requestId($request),
                ]);
            }
        );
    }

    private function find(string $tenantId, string $id): ?object
    {
        return DB::table('pengumuman')
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->first();
    }

    private function authorizeAdmin(Request $request): void
    {
        abort_unless($this->role($request) === 'admin', 403, 'Akses admin diperlukan.');
    }

    private function tenantId(Request $request): string
    {
        $tenantId = trim((string) $request->attributes->get('tenant_id', ''));
        abort_if($tenantId === '', 403, 'Konteks tenant tidak tersedia.');

        return $tenantId;
    }

    private function role(Request $request): string
    {
        return strtolower(trim((string) ($request->user()?->profile?->role ?? '')));
    }

    private function normalizeTarget(?string $target): string
    {
        $target = strtolower(trim((string) $target));

        return in_array($target, ['guru', 'teacher'], true)
            ? 'guru'
            : (in_array($target, ['siswa', 'student'], true) ? 'siswa' : 'semua');
    }

    private function requestId(Request $request): string
    {
        return (string) ($request->attributes->get('request_id')
            ?: $request->header('X-Request-ID', (string) Str::uuid()));
    }

    private function notFound(Request $request): JsonResponse
    {
        return response()->json([
            'success' => false,
            'code' => 'ANNOUNCEMENT_NOT_FOUND',
            'message' => 'Pengumuman tidak ditemukan.',
            'request_id' => $this->requestId($request),
        ], 404);
    }
}
