<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V2\UpdateReportCardMetadataRequest;
use App\Http\Requests\Api\V2\UpsertReportCardItemRequest;
use App\Models\Profile;
use App\Services\Academic\AcademicContextResolver;
use App\Services\Academic\AcademicMutationGuard;
use App\Services\Academic\HistoricalEnrollmentResolver;
use App\Services\IdempotencyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class ReportCardController extends Controller
{
    private AcademicContextResolver $contextResolver;

    private HistoricalEnrollmentResolver $historicalEnrollment;

    private IdempotencyService $idempotency;

    private AcademicMutationGuard $academicMutationGuard;

    public function __construct(
        AcademicContextResolver $contextResolver,
        HistoricalEnrollmentResolver $historicalEnrollment,
        IdempotencyService $idempotency,
        AcademicMutationGuard $academicMutationGuard
    ) {
        $this->contextResolver = $contextResolver;
        $this->historicalEnrollment = $historicalEnrollment;
        $this->idempotency = $idempotency;
        $this->academicMutationGuard = $academicMutationGuard;
    }

    private function checkAccess(Request $request, string $tenantId, string $kelasId, array $context, ?string $studentId = null): ?JsonResponse
    {
        $role = $this->role($request);

        if ($role === 'superadmin') {
            return null;
        }

        if ($role === 'siswa') {
            if (! $studentId) {
                return $this->error($request, 'ACCESS_DENIED', 'Siswa tidak diizinkan mengakses daftar rapor kelas.', 403);
            }
            if ($this->profileId($request) !== $studentId) {
                return $this->error($request, 'ACCESS_DENIED', 'Anda hanya dapat mengakses rapor milik sendiri.', 403);
            }

            return null;
        }

        if (in_array($role, ['guru', 'teacher'], true)) {
            $guruId = $this->profileId($request);
            $hasAccess = DB::table('jadwal')
                ->where('tenant_id', $tenantId)
                ->where('guru_id', $guruId)
                ->where('kelas_id', $kelasId)
                ->where('tahun_ajaran', $context['tahun_ajaran'])
                ->exists();

            $isHomeroom = DB::table('kelas_struktur')
                ->where('tenant_id', $tenantId)
                ->where('wali_guru_id', $guruId)
                ->where('kelas_id', $kelasId)
                ->where('tahun_ajaran', $context['tahun_ajaran'])
                ->exists();

            if (! $hasAccess && ! $isHomeroom) {
                return $this->error($request, 'CLASS_ACCESS_DENIED', 'Anda tidak memiliki akses ke kelas ini.', 403);
            }

            return null;
        }

        return $this->error($request, 'ROLE_ACCESS_DENIED', 'Peran Anda tidak diizinkan.', 403);
    }

    public function index(Request $request): JsonResponse
    {
        $tenantId = $this->tenantId($request);
        $context = $this->contextResolver->forRead($request, $tenantId);

        $kelasId = $request->query('kelas_id');
        if (! $kelasId) {
            return $this->error($request, 'CLASS_ID_REQUIRED', 'Filter kelas_id diwajibkan.', 400);
        }

        if ($errorResponse = $this->checkAccess($request, $tenantId, $kelasId, $context)) {
            return $errorResponse;
        }

        $reports = DB::table('rapot_siswa')
            ->where('tenant_id', $tenantId)
            ->where('kelas_id', $kelasId)
            ->where('tahun_pelajaran', $context['tahun_ajaran'])
            ->where('semester', $context['semester'])
            ->get();

        $reportIds = $reports->pluck('id')->filter()->values()->all();
        $itemsByReport = empty($reportIds)
            ? collect()
            : DB::table('rapot_siswa_items')
                ->where('tenant_id', $tenantId)
                ->whereIn('rapot_id', $reportIds)
                ->orderBy('nomor')
                ->get()
                ->groupBy('rapot_id');
        $reports->each(function ($report) use ($itemsByReport): void {
            $report->items = $itemsByReport->get($report->id, collect())->values();
        });

        return $this->success($request, $reports, [
            'academic_context' => $context,
        ]);
    }

    public function show(Request $request, string $student): JsonResponse
    {
        $tenantId = $this->tenantId($request);
        $context = $this->contextResolver->forRead($request, $tenantId);
        $kelasId = $request->query('kelas_id');

        if ($errorResponse = $this->checkAccess($request, $tenantId, $kelasId, $context, $student)) {
            return $errorResponse;
        }

        $report = DB::table('rapot_siswa')
            ->where('tenant_id', $tenantId)
            ->where('siswa_id', $student)
            ->where('kelas_id', $kelasId)
            ->where('tahun_pelajaran', $context['tahun_ajaran'])
            ->where('semester', $context['semester'])
            ->first();

        if (! $report) {
            return $this->error($request, 'REPORT_CARD_NOT_FOUND', 'Rapor tidak ditemukan.', 404);
        }

        $items = DB::table('rapot_siswa_items')
            ->where('tenant_id', $tenantId)
            ->where('rapot_id', $report->id)
            ->orderBy('nomor')
            ->get();

        $report->items = $items;

        return $this->success($request, $report, [
            'academic_context' => $context,
        ]);
    }

    public function upsertItem(UpsertReportCardItemRequest $request, string $student): JsonResponse
    {
        $tenantId = $this->tenantId($request);
        $validated = $request->validated();
        $context = $this->contextResolver->forRead($request, $tenantId);
        $kelasId = trim((string) $validated['kelas_id']);
        $mapel = trim((string) $validated['mapel']);

        if ($errorResponse = $this->checkAccess($request, $tenantId, $kelasId, $context, $student)) {
            return $errorResponse;
        }

        $studentProfile = DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('id', $student)
            ->whereIn('role', ['siswa', 'student'])
            ->first();
        if (! $studentProfile) {
            return $this->error($request, 'STUDENT_NOT_FOUND', 'Siswa tidak ditemukan pada tenant ini.', 404);
        }

        $studentClass = $this->historicalEnrollment->resolve(
            $tenantId,
            $student,
            $context['tahun_ajaran'] ?? null,
            $context['semester'] ?? null,
            $studentProfile->kelas ?? null,
            $context['tahun_ajaran'] ?? null
        );
        if ($studentClass !== $kelasId) {
            return $this->error($request, 'REPORT_STUDENT_CLASS_MISMATCH', 'Siswa tidak terdaftar pada kelas periode ini.', 403);
        }

        if (in_array($this->role($request), ['guru', 'teacher'], true)) {
            $teachesSubject = DB::table('jadwal')
                ->where('tenant_id', $tenantId)
                ->where('guru_id', $this->profileId($request))
                ->where('kelas_id', $kelasId)
                ->where('mapel', $mapel)
                ->where('tahun_ajaran', $context['tahun_ajaran'])
                ->exists();
            if (! $teachesSubject) {
                return $this->error($request, 'REPORT_SUBJECT_ACCESS_DENIED', 'Guru tidak memiliki penugasan mapel pada kelas dan periode ini.', 403);
            }
        }

        $guard = $this->academicMutationGuard->authorize(
            $request,
            'rapot_siswa',
            'upsert',
            [
                'tahun_pelajaran' => $context['tahun_ajaran'],
                'semester' => $context['semester'],
            ],
            [
                'eq' => [
                    'tahun_pelajaran' => $context['tahun_ajaran'],
                    'semester' => $context['semester'],
                ],
            ],
            $tenantId
        );
        if (! ($guard['allowed'] ?? false)) {
            return $this->error(
                $request,
                (string) ($guard['code'] ?? 'ACADEMIC_PERIOD_LOCKED'),
                (string) ($guard['message'] ?? 'Periode akademik terkunci.'),
                (int) ($guard['status'] ?? 409)
            );
        }

        return $this->idempotency->handle(
            $request,
            $request->header('Idempotency-Key'),
            function () use ($request, $tenantId, $student, $kelasId, $mapel, $validated, $context): JsonResponse {
                return DB::transaction(function () use ($request, $tenantId, $student, $kelasId, $mapel, $validated, $context): JsonResponse {
                    $report = DB::table('rapot_siswa')
                        ->where('tenant_id', $tenantId)
                        ->where('siswa_id', $student)
                        ->where('kelas_id', $kelasId)
                        ->where('tahun_pelajaran', $context['tahun_ajaran'])
                        ->where('semester', $context['semester'])
                        ->where('jenis', $validated['jenis'])
                        ->lockForUpdate()
                        ->first();

                    if ($report?->locked_at) {
                        return $this->error($request, 'REPORT_CARD_LOCKED', 'Rapot sudah dikunci dan tidak dapat diubah.', 409);
                    }

                    $now = now();
                    if (! $report) {
                        $reportId = (string) Str::uuid();
                        DB::table('rapot_siswa')->insert([
                            'id' => $reportId,
                            'tenant_id' => $tenantId,
                            'siswa_id' => $student,
                            'kelas_id' => $kelasId,
                            'jenis' => $validated['jenis'],
                            'tahun_pelajaran' => $context['tahun_ajaran'],
                            'semester' => $context['semester'],
                            'status' => 'draft',
                            'created_by' => $request->user()->id,
                            'created_at' => $now,
                            'updated_at' => $now,
                        ]);
                    } else {
                        $reportId = (string) $report->id;
                        DB::table('rapot_siswa')->where('id', $reportId)->update([
                            'updated_by' => $request->user()->id,
                            'updated_at' => $now,
                        ]);
                    }

                    $itemQuery = DB::table('rapot_siswa_items')
                        ->where('tenant_id', $tenantId)
                        ->where('rapot_id', $reportId)
                        ->where('mapel', $mapel)
                        ->lockForUpdate();
                    $existing = $itemQuery->first();
                    $itemData = [
                        'tenant_id' => $tenantId,
                        'rapot_id' => $reportId,
                        'nomor' => $existing?->nomor ?: ((int) DB::table('rapot_siswa_items')->where('tenant_id', $tenantId)->where('rapot_id', $reportId)->max('nomor')) + 1,
                        'mapel' => $mapel,
                        'kkm' => $validated['kkm'] ?? 75,
                        'nilai' => $validated['nilai'] ?? null,
                        'predikat' => $validated['predikat'] ?? $this->calculatePredikat($validated['nilai'] ?? null),
                        'keterangan' => $validated['keterangan'] ?? null,
                        'source' => 'laporan_mapel',
                        'sent_by' => $request->user()->id,
                        'sent_at' => $now,
                        'updated_at' => $now,
                    ];

                    if ($existing) {
                        DB::table('rapot_siswa_items')->where('id', $existing->id)->update($itemData);
                        $itemId = (string) $existing->id;
                    } else {
                        $itemId = (string) Str::uuid();
                        DB::table('rapot_siswa_items')->insert([
                            'id' => $itemId,
                            ...$itemData,
                            'created_at' => $now,
                        ]);
                    }

                    return $this->success($request, [
                        'report_id' => $reportId,
                        'item_id' => $itemId,
                        'siswa_id' => $student,
                        'mapel' => $mapel,
                        'jenis' => $validated['jenis'],
                    ], [
                        'academic_context' => $context,
                    ]);
                });
            }
        );
    }

    public function preview(Request $request, string $student): JsonResponse
    {
        $tenantId = $this->tenantId($request);
        $context = $this->contextResolver->forRead($request, $tenantId);
        $kelasId = $request->query('kelas_id');

        if (! $kelasId) {
            return $this->error($request, 'CLASS_ID_REQUIRED', 'Parameter kelas_id wajib.', 400);
        }

        if ($errorResponse = $this->checkAccess($request, $tenantId, $kelasId, $context, $student)) {
            return $errorResponse;
        }

        // Validate student is in class
        $studentProfile = Profile::where('tenant_id', $tenantId)->where('id', $student)->first();
        if (! $studentProfile) {
            return $this->error($request, 'STUDENT_NOT_FOUND', 'Siswa tidak ditemukan.', 404);
        }

        $studentClass = $this->historicalEnrollment->resolve(
            $tenantId,
            $student,
            $context['tahun_ajaran'] ?? null,
            $context['semester'] ?? null,
            $studentProfile->kelas ?? null,
            $context['tahun_ajaran'] ?? null
        );

        if ($studentClass !== $kelasId) {
            return $this->error($request, 'REPORT_STUDENT_CLASS_MISMATCH', 'Siswa tidak terdaftar pada kelas periode ini.', 403);
        }

        // Calculate dynamic values based on weights and manual scores
        $jadwal = DB::table('jadwal')
            ->where('tenant_id', $tenantId)
            ->where('kelas_id', $kelasId)
            ->where('tahun_ajaran', $context['tahun_ajaran'])
            ->get();

        $items = [];
        $nomor = 1;

        foreach ($jadwal as $j) {
            $mapel = $j->mapel;

            // Get weights
            $weight = DB::table('guru_mapel_bobot')
                ->where('tenant_id', $tenantId)
                ->where('guru_id', $j->guru_id)
                ->where('mapel', $mapel)
                ->where('tahun_ajaran', $context['tahun_ajaran'])
                ->where('semester', $context['semester'])
                ->first();

            // Get manual score (if available)
            $manualScore = DB::table('guru_mapel_manual_nilai')
                ->where('tenant_id', $tenantId)
                ->where('guru_id', $j->guru_id)
                ->where('siswa_id', $student)
                ->where('mapel', $mapel)
                ->where('tahun_ajaran', $context['tahun_ajaran'])
                ->where('semester', $context['semester'])
                ->first();

            $nilaiAkhir = null;
            if ($manualScore && $manualScore->nilai_manual !== null) {
                $nilaiAkhir = $manualScore->nilai_manual;
            }

            $items[] = [
                'nomor' => $nomor++,
                'mapel' => $mapel,
                'kkm' => 75.0, // Default for now
                'nilai' => $nilaiAkhir,
                'predikat' => $this->calculatePredikat($nilaiAkhir),
                'keterangan' => $manualScore->catatan ?? null,
            ];
        }

        $report = [
            'id' => (string) Str::uuid(),
            'siswa_id' => $student,
            'kelas_id' => $kelasId,
            'tahun_pelajaran' => $context['tahun_ajaran'],
            'semester' => $context['semester'],
            'status' => 'draft',
            'items' => $items,
        ];

        return $this->success($request, $report, [
            'academic_context' => $context,
        ]);
    }

    public function updateMetadata(UpdateReportCardMetadataRequest $request, string $student): JsonResponse
    {
        $tenantId = $this->tenantId($request);
        $context = $this->contextResolver->forRead($request, $tenantId);

        $validated = $request->validated();
        $kelasId = $validated['kelas_id'];

        if ($errorResponse = $this->checkAccess($request, $tenantId, $kelasId, $context, $student)) {
            return $errorResponse;
        }

        if ($this->role($request) === 'siswa') {
            return $this->error($request, 'ACCESS_DENIED', 'Siswa tidak diizinkan merubah metadata rapor.', 403);
        }

        // Must be homeroom teacher or superadmin
        if (in_array($this->role($request), ['guru', 'teacher'], true)) {
            $guruId = $this->profileId($request);
            $isHomeroom = DB::table('kelas_struktur')
                ->where('tenant_id', $tenantId)
                ->where('wali_guru_id', $guruId)
                ->where('kelas_id', $kelasId)
                ->where('tahun_ajaran', $context['tahun_ajaran'])
                ->exists();

            if (! $isHomeroom) {
                return $this->error($request, 'NOT_HOMEROOM_TEACHER', 'Hanya wali kelas yang dapat mengubah metadata rapor.', 403);
            }
        }

        // Validate student is in class
        $studentProfile = Profile::where('tenant_id', $tenantId)->where('id', $student)->first();
        if (! $studentProfile) {
            return $this->error($request, 'STUDENT_NOT_FOUND', 'Siswa tidak ditemukan.', 404);
        }

        $studentClass = $this->historicalEnrollment->resolve(
            $tenantId,
            $student,
            $context['tahun_ajaran'] ?? null,
            $context['semester'] ?? null,
            $studentProfile->kelas ?? null,
            $context['tahun_ajaran'] ?? null
        );

        if ($studentClass !== $kelasId) {
            return $this->error($request, 'REPORT_STUDENT_CLASS_MISMATCH', 'Siswa tidak terdaftar pada kelas periode ini.', 403);
        }

        return $this->idempotency->handle(
            $request,
            $request->header('Idempotency-Key'),
            function () use ($request, $tenantId, $student, $kelasId, $validated, $context): JsonResponse {
                return DB::transaction(function () use ($request, $tenantId, $student, $kelasId, $validated, $context): JsonResponse {
                    $report = DB::table('rapot_siswa')
                        ->where('tenant_id', $tenantId)
                        ->where('siswa_id', $student)
                        ->where('kelas_id', $kelasId)
                        ->where('tahun_pelajaran', $context['tahun_ajaran'])
                        ->where('semester', $context['semester'])
                        ->first();

                    $data = [
                        'sakit' => $validated['sakit'] ?? 0,
                        'izin' => $validated['izin'] ?? 0,
                        'alpa' => $validated['alpa'] ?? 0,
                        'catatan_wali_kelas' => $validated['catatan_wali_kelas'] ?? null,
                        'keputusan' => $validated['keputusan'] ?? null,
                        'updated_by' => $request->user()->id,
                        'updated_at' => now(),
                    ];

                    if ($report) {
                        DB::table('rapot_siswa')
                            ->where('id', $report->id)
                            ->update($data);

                        $reportId = $report->id;
                    } else {
                        $reportId = (string) Str::uuid();
                        $data['id'] = $reportId;
                        $data['tenant_id'] = $tenantId;
                        $data['siswa_id'] = $student;
                        $data['kelas_id'] = $kelasId;
                        $data['jenis'] = 'akademik';
                        $data['tahun_pelajaran'] = $context['tahun_ajaran'];
                        $data['semester'] = $context['semester'];
                        $data['status'] = 'draft';
                        $data['created_by'] = $request->user()->id;
                        $data['created_at'] = now();

                        DB::table('rapot_siswa')->insert($data);
                    }

                    return $this->success($request, ['id' => $reportId]);
                });
            }
        );
    }

    public function finalize(Request $request, string $student): JsonResponse
    {
        $tenantId = $this->tenantId($request);
        $context = $this->contextResolver->forRead($request, $tenantId);

        // Finalize requires kelas_id
        $kelasId = $request->query('kelas_id');
        if (! $kelasId) {
            return $this->error($request, 'CLASS_ID_REQUIRED', 'Filter kelas_id diwajibkan.', 400);
        }

        if ($errorResponse = $this->checkAccess($request, $tenantId, $kelasId, $context, $student)) {
            return $errorResponse;
        }

        if ($this->role($request) === 'siswa') {
            return $this->error($request, 'ACCESS_DENIED', 'Siswa tidak diizinkan memfinalisasi rapor.', 403);
        }

        // Must be homeroom teacher
        if (in_array($this->role($request), ['guru', 'teacher'], true)) {
            $guruId = $this->profileId($request);
            $isHomeroom = DB::table('kelas_struktur')
                ->where('tenant_id', $tenantId)
                ->where('wali_guru_id', $guruId)
                ->where('kelas_id', $kelasId)
                ->where('tahun_ajaran', $context['tahun_ajaran'])
                ->exists();

            if (! $isHomeroom) {
                return $this->error($request, 'NOT_HOMEROOM_TEACHER', 'Hanya wali kelas yang dapat finalisasi rapor.', 403);
            }
        }

        return $this->idempotency->handle(
            $request,
            $request->header('Idempotency-Key'),
            function () use ($request, $tenantId, $student, $kelasId, $context): JsonResponse {
                return DB::transaction(function () use ($request, $tenantId, $student, $kelasId, $context): JsonResponse {
                    $report = DB::table('rapot_siswa')
                        ->where('tenant_id', $tenantId)
                        ->where('siswa_id', $student)
                        ->where('kelas_id', $kelasId)
                        ->where('tahun_pelajaran', $context['tahun_ajaran'])
                        ->where('semester', $context['semester'])
                        ->first();

                    if (! $report) {
                        return $this->error($request, 'REPORT_CARD_NOT_FOUND', 'Rapor tidak ditemukan (draft belum dibuat).', 404);
                    }

                    if ($report->status === 'published') {
                        return $this->error($request, 'REPORT_ALREADY_PUBLISHED', 'Rapor sudah diterbitkan.', 409);
                    }

                    // Generate items snapshot
                    $jadwal = DB::table('jadwal')
                        ->where('tenant_id', $tenantId)
                        ->where('kelas_id', $kelasId)
                        ->where('tahun_ajaran', $context['tahun_ajaran'])
                        ->get();

                    $items = [];
                    $nomor = 1;

                    // Delete old items
                    DB::table('rapot_siswa_items')
                        ->where('tenant_id', $tenantId)
                        ->where('rapot_id', $report->id)
                        ->delete();

                    $totalNilai = 0;
                    $itemCount = 0;

                    foreach ($jadwal as $j) {
                        $mapel = $j->mapel;
                        $manualScore = DB::table('guru_mapel_manual_nilai')
                            ->where('tenant_id', $tenantId)
                            ->where('guru_id', $j->guru_id)
                            ->where('siswa_id', $student)
                            ->where('mapel', $mapel)
                            ->where('tahun_ajaran', $context['tahun_ajaran'])
                            ->where('semester', $context['semester'])
                            ->first();

                        $nilaiAkhir = $manualScore ? $manualScore->nilai_manual : null;

                        $itemData = [
                            'id' => (string) Str::uuid(),
                            'tenant_id' => $tenantId,
                            'rapot_id' => $report->id,
                            'nomor' => $nomor++,
                            'mapel' => $mapel,
                            'kkm' => 75.0,
                            'nilai' => $nilaiAkhir,
                            'predikat' => $this->calculatePredikat($nilaiAkhir),
                            'keterangan' => $manualScore->catatan ?? null,
                            'created_at' => now(),
                            'updated_at' => now(),
                        ];

                        DB::table('rapot_siswa_items')->insert($itemData);
                        $items[] = $itemData;

                        if ($nilaiAkhir !== null) {
                            $totalNilai += $nilaiAkhir;
                            $itemCount++;
                        }
                    }

                    $rataRata = $itemCount > 0 ? $totalNilai / $itemCount : null;

                    $snapshotData = [
                        'metadata' => [
                            'sakit' => $report->sakit,
                            'izin' => $report->izin,
                            'alpa' => $report->alpa,
                            'catatan_wali_kelas' => $report->catatan_wali_kelas,
                            'keputusan' => $report->keputusan,
                        ],
                        'items' => $items,
                    ];

                    DB::table('rapot_siswa')
                        ->where('id', $report->id)
                        ->update([
                            'status' => 'finalized',
                            'jumlah' => $totalNilai,
                            'rata_rata' => $rataRata,
                            'snapshot_data' => json_encode($snapshotData),
                            'updated_by' => $request->user()->id,
                            'updated_at' => now(),
                        ]);

                    return $this->success($request, ['status' => 'finalized']);
                });
            }
        );
    }

    public function publish(Request $request, string $student): JsonResponse
    {
        $tenantId = $this->tenantId($request);
        $context = $this->contextResolver->forRead($request, $tenantId);

        $kelasId = $request->query('kelas_id');
        if (! $kelasId) {
            return $this->error($request, 'CLASS_ID_REQUIRED', 'Filter kelas_id diwajibkan.', 400);
        }

        if ($errorResponse = $this->checkAccess($request, $tenantId, $kelasId, $context, $student)) {
            return $errorResponse;
        }

        if ($this->role($request) === 'siswa') {
            return $this->error($request, 'ACCESS_DENIED', 'Siswa tidak diizinkan mempublikasi rapor.', 403);
        }

        if (in_array($this->role($request), ['guru', 'teacher'], true)) {
            $guruId = $this->profileId($request);
            $isHomeroom = DB::table('kelas_struktur')
                ->where('tenant_id', $tenantId)
                ->where('wali_guru_id', $guruId)
                ->where('kelas_id', $kelasId)
                ->where('tahun_ajaran', $context['tahun_ajaran'])
                ->exists();

            if (! $isHomeroom) {
                return $this->error($request, 'NOT_HOMEROOM_TEACHER', 'Hanya wali kelas yang dapat publish rapor.', 403);
            }
        }

        return $this->idempotency->handle(
            $request,
            $request->header('Idempotency-Key'),
            function () use ($request, $tenantId, $student, $kelasId, $context): JsonResponse {
                $report = DB::table('rapot_siswa')
                    ->where('tenant_id', $tenantId)
                    ->where('siswa_id', $student)
                    ->where('kelas_id', $kelasId)
                    ->where('tahun_pelajaran', $context['tahun_ajaran'])
                    ->where('semester', $context['semester'])
                    ->first();

                if (! $report || $report->status !== 'finalized') {
                    return $this->error($request, 'REPORT_NOT_FINALIZED', 'Rapor harus difinalisasi sebelum di-publish.', 409);
                }

                DB::table('rapot_siswa')
                    ->where('id', $report->id)
                    ->update([
                        'status' => 'published',
                        'updated_by' => $request->user()->id,
                        'updated_at' => now(),
                    ]);

                return $this->success($request, ['status' => 'published']);
            }
        );
    }

    public function reopen(Request $request, string $student): JsonResponse
    {
        $tenantId = $this->tenantId($request);
        $context = $this->contextResolver->forRead($request, $tenantId);

        $kelasId = $request->query('kelas_id');
        if (! $kelasId) {
            return $this->error($request, 'CLASS_ID_REQUIRED', 'Filter kelas_id diwajibkan.', 400);
        }

        if ($errorResponse = $this->checkAccess($request, $tenantId, $kelasId, $context, $student)) {
            return $errorResponse;
        }

        if ($this->role($request) === 'siswa') {
            return $this->error($request, 'ACCESS_DENIED', 'Siswa tidak diizinkan membuka kembali rapor.', 403);
        }

        if (in_array($this->role($request), ['guru', 'teacher'], true)) {
            $guruId = $this->profileId($request);
            $isHomeroom = DB::table('kelas_struktur')
                ->where('tenant_id', $tenantId)
                ->where('wali_guru_id', $guruId)
                ->where('kelas_id', $kelasId)
                ->where('tahun_ajaran', $context['tahun_ajaran'])
                ->exists();

            if (! $isHomeroom) {
                return $this->error($request, 'NOT_HOMEROOM_TEACHER', 'Hanya wali kelas yang dapat reopen rapor.', 403);
            }
        }

        return $this->idempotency->handle(
            $request,
            $request->header('Idempotency-Key'),
            function () use ($request, $tenantId, $student, $kelasId, $context): JsonResponse {
                $report = DB::table('rapot_siswa')
                    ->where('tenant_id', $tenantId)
                    ->where('siswa_id', $student)
                    ->where('kelas_id', $kelasId)
                    ->where('tahun_pelajaran', $context['tahun_ajaran'])
                    ->where('semester', $context['semester'])
                    ->first();

                if (! $report) {
                    return $this->error($request, 'REPORT_CARD_NOT_FOUND', 'Rapor tidak ditemukan.', 404);
                }

                if ($report->snapshot_data) {
                    DB::table('rapot_siswa_snapshots_history')->insert([
                        'id' => (string) Str::uuid(),
                        'rapot_siswa_id' => $report->id,
                        'tenant_id' => $tenantId,
                        'snapshot_data' => $report->snapshot_data,
                        'reason' => 'reopen_to_draft',
                        'created_by' => $request->user()->id,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);
                }

                DB::table('rapot_siswa')
                    ->where('id', $report->id)
                    ->update([
                        'status' => 'draft',
                        'snapshot_data' => null,
                        'updated_by' => $request->user()->id,
                        'updated_at' => now(),
                    ]);

                return $this->success($request, ['status' => 'draft']);
            }
        );
    }

    public function print(Request $request, string $student): JsonResponse
    {
        $tenantId = $this->tenantId($request);
        $context = $this->contextResolver->forRead($request, $tenantId);

        $kelasId = $request->query('kelas_id');
        if (! $kelasId) {
            return $this->error($request, 'CLASS_ID_REQUIRED', 'Filter kelas_id diwajibkan.', 400);
        }

        if ($errorResponse = $this->checkAccess($request, $tenantId, $kelasId, $context, $student)) {
            return $errorResponse;
        }

        $report = DB::table('rapot_siswa')
            ->where('tenant_id', $tenantId)
            ->where('siswa_id', $student)
            ->where('kelas_id', $kelasId)
            ->where('tahun_pelajaran', $context['tahun_ajaran'])
            ->where('semester', $context['semester'])
            ->first();

        if (! $report) {
            return $this->error($request, 'REPORT_CARD_NOT_FOUND', 'Rapor tidak ditemukan.', 404);
        }

        if ($report->status === 'draft') {
            return $this->error($request, 'REPORT_DRAFT', 'Rapor masih dalam status draft dan tidak bisa dicetak resmi.', 403);
        }

        if ($report->status === 'finalized') {
            $isAuthorized = false;
            if ($this->role($request) === 'superadmin') {
                $isAuthorized = true;
            } elseif (in_array($this->role($request), ['guru', 'teacher'], true)) {
                $guruId = $this->profileId($request);
                $isHomeroom = DB::table('kelas_struktur')
                    ->where('tenant_id', $tenantId)
                    ->where('wali_guru_id', $guruId)
                    ->where('kelas_id', $kelasId)
                    ->where('tahun_ajaran', $context['tahun_ajaran'])
                    ->exists();
                $isAuthorized = $isHomeroom;
            }

            if (! $isAuthorized) {
                return $this->error($request, 'REPORT_NOT_PUBLISHED', 'Rapor belum di-publish dan Anda tidak memiliki akses preview.', 403);
            }
        }

        $snapshot = null;
        if ($report->snapshot_data) {
            $snapshot = json_decode($report->snapshot_data, true);
        }

        return $this->success($request, [
            'id' => $report->id,
            'siswa_id' => $report->siswa_id,
            'kelas_id' => $report->kelas_id,
            'tahun_pelajaran' => $report->tahun_pelajaran,
            'semester' => $report->semester,
            'status' => $report->status,
            'snapshot' => $snapshot,
        ]);
    }

    private function calculatePredikat($nilai): ?string
    {
        if ($nilai === null) {
            return null;
        }
        if ($nilai >= 90) {
            return 'A';
        }
        if ($nilai >= 80) {
            return 'B';
        }
        if ($nilai >= 75) {
            return 'C';
        }

        return 'D';
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

    private function profileId(Request $request): string
    {
        return (string) ($request->user()?->id ?? '');
    }

    private function requestId(Request $request): string
    {
        return (string) ($request->attributes->get('request_id') ?: $request->header('X-Request-ID', (string) Str::uuid()));
    }

    private function success(Request $request, $data, array $meta = []): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data' => $data,
            'meta' => array_merge(['request_id' => $this->requestId($request)], $meta),
        ]);
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
