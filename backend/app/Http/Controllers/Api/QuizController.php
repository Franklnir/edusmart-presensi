<?php

namespace App\Http\Controllers\Api;

use App\Jobs\FinalizeQuizSubmissionJob;
use App\Services\Academic\AcademicContextResolver;
use App\Services\Academic\AcademicPeriodLifecycleService;
use App\Services\Academic\HistoricalEnrollmentResolver;
use App\Services\Quiz\QuizContentCache;
use App\Services\Quiz\QuizScoringService;
use App\Services\WhatsApp\WhatsAppNotificationService;
use App\Support\AcademicPeriod;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class QuizController extends ApiController
{
    private const DEFAULT_QUIZ_TIMEZONE = 'Asia/Jakarta';

    private const DEVICE_SESSION_STALE_SECONDS = 90;

    public function __construct(
        private readonly QuizScoringService $scoringService,
        private readonly QuizContentCache $contentCache,
        private readonly AcademicContextResolver $academicContextResolver,
        private readonly AcademicPeriodLifecycleService $academicPeriodLifecycle,
        private readonly HistoricalEnrollmentResolver $studentAcademicClassResolver,
        private readonly WhatsAppNotificationService $whatsAppNotificationService
    ) {}

    public function dashboard(Request $request)
    {
        if (! $this->isGuru($request) && ! $this->isSiswa($request) && ! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['message' => 'Tenant tidak valid'], 400);
        }

        $page = max(1, (int) $request->query('page', 1));
        $perPage = $this->dashboardPerPage($request);
        $kelas = trim((string) $request->query('kelas', ''));
        $mapel = trim((string) $request->query('mapel', ''));
        $search = trim((string) $request->query('q', ''));
        $isStudentDashboard = $this->isSiswa($request) && ! $this->isGuru($request) && ! $this->isAdmin($request);

        $query = $this->quizTenantQuery($tenantId)
            ->select($this->selectExistingQuizColumns('quizzes', [
                'id', 'guru_id', 'kelas_id', 'mapel', 'nama', 'starts_at', 'deadline_at', 'penilaian',
                'mode', 'is_live', 'is_active', 'live_started_at', 'duration_minutes',
                'result_visible_to_students', 'shuffle_questions', 'shuffle_options',
                'max_attempts', 'security_mode', 'access_device', 'timezone', 'published_at', 'closed_at',
                'access_code_hash', 'tahun_ajaran', 'semester', 'copied_from_quiz_id', 'clone_code',
                'created_at', 'updated_at',
            ]));

        if ($this->isGuru($request) && ! $this->isAdmin($request)) {
            $query->where('guru_id', $request->user()?->id);
        } elseif ($this->isSiswa($request)) {
            $studentClassId = $this->studentClassIdForPeriod(
                $request,
                $request->query('tahun_ajaran'),
                $request->query('semester')
            );
            if ($studentClassId === '') {
                $query->whereRaw('1 = 0');
            } else {
                $query->where('kelas_id', $studentClassId);
            }
        }

        if ($kelas !== '') {
            $query->where('kelas_id', $kelas);
        }
        if ($mapel !== '') {
            $query->where('mapel', $mapel);
        }
        if ($search !== '') {
            $like = '%'.strtolower($search).'%';
            $query->where(function ($builder) use ($like) {
                $builder->whereRaw('lower(nama) like ?', [$like])
                    ->orWhereRaw('lower(mapel) like ?', [$like])
                    ->orWhereRaw('lower(kelas_id) like ?', [$like]);
            });
        }
        $this->applyQuizAcademicQueryFilters($query, 'quizzes', $request);

        $total = (clone $query)->count('id');
        $rows = $query
            ->orderByDesc('created_at')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get();

        $quizIds = $rows->pluck('id')->filter()->values()->all();
        $questionRows = empty($quizIds) ? collect() : DB::table('quiz_questions')
            ->select($this->selectExistingQuizColumns('quiz_questions', ['id', 'quiz_id', 'question_type']))
            ->whereIn('quiz_id', $quizIds)
            ->get();
        $questionCounts = $questionRows->groupBy('quiz_id')->map(fn ($items) => $items->count());
        $essayQuestionRows = $questionRows->filter(fn ($row) => $this->normalizeQuestionType($row->question_type ?? null) === 'essay');
        $essayQuestionToQuiz = $essayQuestionRows->mapWithKeys(fn ($row) => [(string) $row->id => (string) $row->quiz_id]);

        $submissionRows = collect();
        if (! $isStudentDashboard && ! empty($quizIds)) {
            $submissionRows = $this->quizTenantTable('quiz_submissions', $tenantId)
                ->select($this->selectExistingQuizColumns('quiz_submissions', ['id', 'quiz_id', 'siswa_id', 'status', 'essay_review_completed_at']))
                ->whereIn('quiz_id', $quizIds)
                ->get();
        }
        $submissionsByQuiz = $submissionRows->groupBy('quiz_id');
        $submissionById = $submissionRows->keyBy('id');

        $classIds = $rows->pluck('kelas_id')->filter()->unique()->values()->all();
        $studentCountsByClass = collect();
        if (! $isStudentDashboard && ! empty($classIds)) {
            $requestedYear = AcademicPeriod::normalizeAcademicYear($request->query('tahun_ajaran'));

            // When a specific academic year is requested, count students from
            // student_class_histories so the "not started" stat reflects the
            // roster that was actually in each class that year — not today's.
            if (
                $requestedYear
                && Schema::hasTable('student_class_histories')
                && Schema::hasColumn('student_class_histories', 'tahun_ajaran')
                && Schema::hasColumn('student_class_histories', 'class_id')
            ) {
                $studentCountsByClass = DB::table('student_class_histories')
                    ->select('class_id', DB::raw('count(distinct student_id) as aggregate'))
                    ->where('tenant_id', $tenantId)
                    ->whereIn('class_id', $classIds)
                    ->where('tahun_ajaran', $requestedYear)
                    ->whereIn('status', ['active', 'nonaktif', 'mutasi'])
                    ->groupBy('class_id')
                    ->pluck('aggregate', 'class_id');
            } else {
                // Current period: count from live profiles.kelas
                $studentCountsByClass = DB::table('profiles')
                    ->select('kelas', DB::raw('count(*) as aggregate'))
                    ->where('tenant_id', $tenantId)
                    ->where('role', 'siswa')
                    ->whereIn('kelas', $classIds)
                    ->where('status', 'active')
                    ->groupBy('kelas')
                    ->pluck('aggregate', 'kelas');
            }
        }

        $essayAnswerStatsByQuiz = [];
        $essayQuestionIds = $essayQuestionToQuiz->keys()->all();
        if (! $isStudentDashboard && ! empty($essayQuestionIds)) {
            $this->quizTenantTable('quiz_answers', $tenantId)
                ->select($this->selectExistingQuizColumns('quiz_answers', ['submission_id', 'question_id', 'essay_answer', 'essay_score']))
                ->whereIn('question_id', $essayQuestionIds)
                ->orderBy('submission_id')
                ->get()
                ->each(function ($answer) use (&$essayAnswerStatsByQuiz, $essayQuestionToQuiz, $submissionById) {
                    $submission = $submissionById->get($answer->submission_id);
                    if (! $submission || (string) ($submission->status ?? '') !== 'finished') {
                        return;
                    }

                    $quizId = $essayQuestionToQuiz[(string) $answer->question_id] ?? null;
                    if (! $quizId) {
                        return;
                    }

                    $essayText = trim((string) ($answer->essay_answer ?? ''));
                    if ($essayText === '') {
                        return;
                    }

                    $essayAnswerStatsByQuiz[$quizId] ??= [
                        'essay_answered_count' => 0,
                        'essay_graded_count' => 0,
                        'essay_pending_count' => 0,
                    ];
                    $essayAnswerStatsByQuiz[$quizId]['essay_answered_count']++;
                    if (($answer->essay_score ?? null) === null) {
                        $essayAnswerStatsByQuiz[$quizId]['essay_pending_count']++;
                    } else {
                        $essayAnswerStatsByQuiz[$quizId]['essay_graded_count']++;
                    }
                });
        }

        $studentSubmissions = collect();
        if ($this->isSiswa($request) && ! empty($quizIds)) {
            $studentSubmissions = $this->quizTenantTable('quiz_submissions', $tenantId)
                ->select($this->selectExistingQuizColumns('quiz_submissions', ['id', 'quiz_id', 'siswa_id', 'started_at', 'finished_at', 'score', 'total_points', 'status', 'created_at', 'updated_at']))
                ->whereIn('quiz_id', $quizIds)
                ->where('siswa_id', $request->user()?->id)
                ->get()
                ->keyBy('quiz_id');
        }

        $dataRows = $rows->map(function ($quiz) use (
            $questionCounts,
            $submissionsByQuiz,
            $studentCountsByClass,
            $essayQuestionRows,
            $essayAnswerStatsByQuiz,
            $studentSubmissions
        ) {
            $quizSubmissions = $submissionsByQuiz->get($quiz->id, collect());
            $startedCount = $quizSubmissions->pluck('siswa_id')->filter()->unique()->count();
            $finishedCount = $quizSubmissions->filter(fn ($row) => (string) ($row->status ?? '') === 'finished')->count();
            $ongoingCount = max(0, $quizSubmissions->count() - $finishedCount);
            $totalStudents = (int) ($studentCountsByClass[$quiz->kelas_id] ?? 0);
            $essayQuestionCount = $essayQuestionRows->where('quiz_id', $quiz->id)->count();
            $essayAnswerStats = $essayAnswerStatsByQuiz[(string) $quiz->id] ?? [];
            $finishedEssaySubmissions = $essayQuestionCount > 0
                ? $quizSubmissions->filter(fn ($row) => (string) ($row->status ?? '') === 'finished')
                : collect();
            $essayStudentGraded = $finishedEssaySubmissions
                ->filter(fn ($row) => ! empty($row->essay_review_completed_at))
                ->count();
            $essayStudentPending = max(0, $finishedEssaySubmissions->count() - $essayStudentGraded);
            $row = $this->quizPayload($quiz);
            $row['question_count'] = (int) ($questionCounts[$quiz->id] ?? 0);
            $row['submission_summary'] = [
                'total' => $quizSubmissions->count(),
                'finished' => $finishedCount,
                'ongoing' => $ongoingCount,
            ];
            $row['stats'] = [
                'total_students' => $totalStudents,
                'started_count' => $startedCount,
                'ongoing_count' => $ongoingCount,
                'finished_count' => $finishedCount,
                'not_started_count' => max(0, $totalStudents - $startedCount),
                'essay_question_count' => $essayQuestionCount,
                'essay_answered_count' => (int) ($essayAnswerStats['essay_answered_count'] ?? 0),
                'essay_graded_count' => (int) ($essayAnswerStats['essay_graded_count'] ?? 0),
                'essay_pending_count' => (int) ($essayAnswerStats['essay_pending_count'] ?? 0),
                'essay_student_graded_count' => $essayStudentGraded,
                'essay_student_pending_count' => $essayStudentPending,
            ];
            if ($studentSubmissions->has($quiz->id)) {
                $row['submission'] = (array) $studentSubmissions->get($quiz->id);
            }

            return $row;
        })->values();

        return response()->json([
            'data' => [
                'rows' => $dataRows,
                'meta' => $this->dashboardPagination($page, $perPage, $total),
            ],
        ]);
    }

    public function detail(Request $request, string $quizId)
    {
        if (! $this->isGuru($request) && ! $this->isSiswa($request) && ! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['message' => 'Tenant tidak valid'], 400);
        }

        $quiz = $this->quizTenantQuery($tenantId)
            ->where('id', $quizId)
            ->first();
        if (! $quiz) {
            return response()->json(['message' => 'Quiz tidak ditemukan'], 404);
        }

        if ($this->isGuru($request) && ! $this->isAdmin($request) && (string) $quiz->guru_id !== (string) $request->user()?->id) {
            return $this->deny('Anda tidak memiliki akses quiz ini.', 403);
        }
        if ($this->isSiswa($request)) {
            $studentClassId = $this->studentClassIdForPeriod(
                $request,
                $quiz->tahun_ajaran ?? null,
                $quiz->semester ?? null
            );
            if (! $this->sameClassId($studentClassId, $quiz->kelas_id ?? '')) {
                return $this->deny('Quiz tidak tersedia untuk kelas Anda.', 403);
            }
            $deviceResponse = $this->denyIfQuizDeviceNotAllowed($quiz, $this->requestClientDevice($request));
            if ($deviceResponse !== null) {
                return $deviceResponse;
            }
        }

        $questions = $this->contentCache->questions($tenantId, $quizId);
        $questions = $this->normalizeQuestionNumbersForPayload($questions);
        $questionIds = $questions->pluck('id')->filter()->values()->all();
        $optionsByQuestion = empty($questionIds)
            ? collect()
            : $this->contentCache->options($tenantId, $quizId)->groupBy('question_id');

        if ($this->isSiswa($request)) {
            $submission = $this->quizTenantTable('quiz_submissions', $tenantId)
                ->where('quiz_id', $quizId)
                ->where('siswa_id', $request->user()?->id)
                ->first();
            $answers = $submission
                ? DB::table('quiz_answers')
                    ->select($this->selectExistingQuizColumns('quiz_answers', ['id', 'submission_id', 'question_id', 'option_id', 'essay_answer', 'essay_score', 'is_correct', 'poin', 'created_at', 'updated_at']))
                    ->where('submission_id', $submission->id)
                    ->get()
                : collect();
            if ($submission && (string) ($submission->status ?? '') === 'ongoing') {
                $sessionResponse = $this->ensureSubmissionDeviceSession($request, $tenantId, $submission, $request->query(), $this->quizNow($quiz));
                if ($sessionResponse !== null) {
                    return $sessionResponse;
                }
            }
            $canSeeAnswers = $submission
                && (string) ($submission->status ?? '') === 'finished'
                && $this->boolValue($quiz->result_visible_to_students ?? false);
            $studentOptionsByQuestion = $optionsByQuestion->map(function ($items) use ($canSeeAnswers) {
                return collect($items)->map(function ($option) use ($canSeeAnswers) {
                    $payload = (array) $option;
                    unset($payload['tenant_id']);
                    if (! $canSeeAnswers) {
                        unset($payload['is_correct']);
                    }

                    return $payload;
                })->values();
            });
            $studentAnswers = $answers->map(function ($answer) use ($canSeeAnswers) {
                $payload = (array) $answer;
                unset($payload['tenant_id']);
                if (! $canSeeAnswers) {
                    unset($payload['is_correct'], $payload['poin'], $payload['essay_score']);
                }

                return $payload;
            })->values();

            return response()->json([
                'data' => [
                    'quiz' => $this->quizPayload($quiz),
                    'questions' => $questions,
                    'options_by_question' => $studentOptionsByQuestion,
                    'submission' => $submission ? (array) $submission : null,
                    'answers' => $studentAnswers,
                    'timing' => $this->quizTimingPayload($quiz, $this->quizNow($quiz)),
                ],
            ]);
        }

        $submissions = $this->quizTenantTable('quiz_submissions', $tenantId)
            ->leftJoin('profiles as p', 'quiz_submissions.siswa_id', '=', 'p.id')
            ->where('quiz_submissions.quiz_id', $quizId)
            ->select([
                'quiz_submissions.*',
                'p.nama as siswa_nama',
                'p.nis as siswa_nis',
                'p.kelas as siswa_kelas',
            ])
            ->orderBy('p.nama')
            ->get();
        $submissionIds = $submissions->pluck('id')->filter()->values()->all();
        $answersBySubmission = empty($submissionIds) ? collect() : DB::table('quiz_answers')
            ->select($this->selectExistingQuizColumns('quiz_answers', ['id', 'submission_id', 'question_id', 'option_id', 'essay_answer', 'is_correct', 'poin', 'created_at', 'updated_at']))
            ->whereIn('submission_id', $submissionIds)
            ->get()
            ->groupBy('submission_id');

        return response()->json([
            'data' => [
                'quiz' => $this->quizPayload($quiz),
                'questions' => $questions,
                'options_by_question' => $optionsByQuestion,
                'submissions' => $submissions,
                'answers_by_submission' => $answersBySubmission,
            ],
        ]);
    }

    public function clone(Request $request)
    {
        if (! $this->isGuru($request) && ! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['message' => 'Tenant tidak valid'], 400);
        }

        $sourceQuizId = trim((string) $request->input('source_quiz_id', ''));
        $targetKelasId = trim((string) $request->input('target_kelas_id', ''));
        $targetMapel = trim((string) $request->input('target_mapel', ''));
        $targetName = trim((string) $request->input('nama', ''));
        $copySecurity = $request->has('copy_security') ? $request->boolean('copy_security') : true;
        $copySchedule = $request->has('copy_schedule') ? $request->boolean('copy_schedule') : false;
        $tenantPeriod = $this->currentAcademicPeriodForTenant($tenantId);
        $targetAcademicYear = AcademicPeriod::normalizeAcademicYear($request->input('tahun_ajaran'))
            ?: ($tenantPeriod['tahun_ajaran'] ?? null);
        $targetSemester = AcademicPeriod::normalizeSemester($request->input('semester'))
            ?: ($tenantPeriod['semester'] ?? null);

        if (
            $targetAcademicYear !== ($tenantPeriod['tahun_ajaran'] ?? null)
            || $targetSemester !== ($tenantPeriod['semester'] ?? null)
        ) {
            return $this->deny('Quiz hanya dapat diduplikasi ke periode akademik aktif.', 409);
        }

        if ($sourceQuizId === '' || $targetKelasId === '' || $targetMapel === '') {
            return response()->json([
                'message' => 'source_quiz_id, target_kelas_id, dan target_mapel wajib diisi',
            ], 422);
        }

        $sourceQuiz = $this->resolveQuizForTeacherAction($request, $tenantId, $sourceQuizId);
        if (! $sourceQuiz) {
            return $this->deny('Quiz sumber tidak ditemukan atau tidak diizinkan', 404);
        }

        if ($targetName === '') {
            $targetName = 'Salinan - '.trim((string) ($sourceQuiz->nama ?? 'Quiz'));
        }
        if (Str::length($targetName) > 180) {
            $targetName = Str::substr($targetName, 0, 180);
        }

        if (! $this->quizTargetClassExists($tenantId, $targetKelasId)) {
            return response()->json(['message' => 'Kelas tujuan tidak ditemukan'], 422);
        }

        if ($this->isGuru($request) && ! $this->isAdmin($request)) {
            if (! $this->teacherCanCloneQuizToTarget($request, $tenantId, $targetKelasId, $targetMapel, $targetAcademicYear, $targetSemester)) {
                return $this->deny('Kelas dan mapel tujuan harus sesuai yang diampu guru', 422);
            }
        }

        if ($copySchedule) {
            $startsAt = $this->parseQuizDate($sourceQuiz->starts_at ?? null, $sourceQuiz);
            $endsAt = $this->parseQuizDate($sourceQuiz->deadline_at ?? null, $sourceQuiz);
            if (! $startsAt || ! $endsAt) {
                return response()->json(['message' => 'Jadwal sumber belum lengkap, tidak bisa disalin'], 422);
            }
            $periodError = $this->validateQuizTimelineWithinActivePeriod($tenantId, $startsAt, $endsAt, $sourceQuiz);
            if ($periodError !== null) {
                return response()->json(['message' => $periodError], 422);
            }
        }

        $now = now();
        $newQuizId = (string) Str::uuid();
        $cloneCode = $this->generateQuizCloneCode();

        $created = DB::transaction(function () use (
            $tenantId,
            $sourceQuiz,
            $targetKelasId,
            $targetMapel,
            $targetName,
            $targetAcademicYear,
            $targetSemester,
            $copySecurity,
            $copySchedule,
            $now,
            $newQuizId,
            $cloneCode
        ) {
            $sourceMode = $this->quizMode($sourceQuiz);
            $quizRow = [
                'id' => $newQuizId,
                'tenant_id' => $tenantId,
                'guru_id' => (string) ($sourceQuiz->guru_id ?? ''),
                'kelas_id' => $targetKelasId,
                'mapel' => $targetMapel,
                'nama' => $targetName,
                'penilaian' => $sourceQuiz->penilaian ?? 'poin',
                'mode' => $sourceMode,
                'is_live' => $sourceMode !== 'regular',
                'is_active' => false,
                'starts_at' => $copySchedule ? ($sourceQuiz->starts_at ?? null) : null,
                'deadline_at' => $copySchedule ? ($sourceQuiz->deadline_at ?? null) : null,
                'live_started_at' => null,
                'duration_minutes' => $sourceMode !== 'regular' ? (int) ($sourceQuiz->duration_minutes ?? 60) : null,
                'result_visible_to_students' => false,
                'shuffle_questions' => $copySecurity ? (bool) ($sourceQuiz->shuffle_questions ?? false) : false,
                'shuffle_options' => $copySecurity ? (bool) ($sourceQuiz->shuffle_options ?? false) : false,
                'max_attempts' => $copySecurity ? ($sourceQuiz->max_attempts ?? null) : null,
                'security_mode' => $copySecurity ? ($sourceQuiz->security_mode ?? 'standard') : 'standard',
                'access_device' => 'web',
                'timezone' => $sourceQuiz->timezone ?? self::DEFAULT_QUIZ_TIMEZONE,
                'published_at' => null,
                'closed_at' => null,
                'tahun_ajaran' => $targetAcademicYear ?: ($sourceQuiz->tahun_ajaran ?? null),
                'semester' => $targetSemester ?: ($sourceQuiz->semester ?? null),
                'angkatan' => $sourceQuiz->angkatan ?? null,
                'copied_from_quiz_id' => (string) $sourceQuiz->id,
                'clone_code' => $cloneCode,
                'created_at' => $now,
                'updated_at' => $now,
            ];

            DB::table('quizzes')->insert($this->filterTablePayload('quizzes', $quizRow));

            $questions = DB::table('quiz_questions')
                ->where('quiz_id', (string) $sourceQuiz->id)
                ->when(Schema::hasColumn('quiz_questions', 'tenant_id'), fn ($query) => $query->where('tenant_id', $tenantId))
                ->orderBy('nomor')
                ->get();

            $questionIdMap = [];
            foreach ($questions as $question) {
                $newQuestionId = (string) Str::uuid();
                $questionIdMap[(string) $question->id] = $newQuestionId;

                $questionRow = [
                    'id' => $newQuestionId,
                    'tenant_id' => $tenantId,
                    'quiz_id' => $newQuizId,
                    'nomor' => (int) ($question->nomor ?? 1),
                    'soal' => $question->soal ?? '',
                    'image_path' => $question->image_path ?? null,
                    'poin' => (int) ($question->poin ?? 1),
                    'question_type' => $this->normalizeQuestionType($question->question_type ?? null),
                    'created_at' => $now,
                    'updated_at' => $now,
                ];

                DB::table('quiz_questions')->insert($this->filterTablePayload('quiz_questions', $questionRow));
            }

            if (! empty($questionIdMap)) {
                $options = DB::table('quiz_options')
                    ->whereIn('question_id', array_keys($questionIdMap))
                    ->when(Schema::hasColumn('quiz_options', 'tenant_id'), fn ($query) => $query->where('tenant_id', $tenantId))
                    ->orderBy('question_id')
                    ->orderBy('label')
                    ->get();

                foreach ($options as $option) {
                    $newQuestionId = $questionIdMap[(string) $option->question_id] ?? null;
                    if (! $newQuestionId) {
                        continue;
                    }

                    $optionRow = [
                        'id' => (string) Str::uuid(),
                        'tenant_id' => $tenantId,
                        'question_id' => $newQuestionId,
                        'label' => $option->label ?? '',
                        'text' => $option->text ?? '',
                        'image_path' => $option->image_path ?? null,
                        'is_correct' => (bool) ($option->is_correct ?? false),
                        'created_at' => $now,
                        'updated_at' => $now,
                    ];

                    DB::table('quiz_options')->insert($this->filterTablePayload('quiz_options', $optionRow));
                }
            }

            return [
                'question_count' => count($questionIdMap),
            ];
        }, 3);

        $fresh = DB::table('quizzes')
            ->where('id', $newQuizId)
            ->when(Schema::hasColumn('quizzes', 'tenant_id'), fn ($query) => $query->where('tenant_id', $tenantId))
            ->first();

        try {
            $this->contentCache->forget($tenantId, $newQuizId);
        } catch (\Throwable) {
            // Cache invalidation should not fail a completed clone.
        }

        return response()->json([
            'data' => [
                'quiz' => $this->quizPayload($fresh),
                'question_count' => (int) ($created['question_count'] ?? 0),
                'copied_from_quiz_id' => $sourceQuizId,
                'submissions_copied' => 0,
                'answers_copied' => 0,
            ],
        ], 201);
    }

    public function submit(Request $request)
    {
        if (! $this->isSiswa($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['message' => 'Tenant tidak valid'], 400);
        }

        $payload = $request->only(['quiz_id', 'submission_id', 'answers']);
        $quizId = trim((string) ($payload['quiz_id'] ?? ''));
        $submissionId = trim((string) ($payload['submission_id'] ?? ''));
        $answers = $payload['answers'] ?? [];

        if ($quizId === '') {
            return response()->json(['message' => 'quiz_id wajib diisi'], 422);
        }

        $user = $request->user();
        $resolved = $this->resolveStudentQuiz($request, $tenantId, $quizId, $request->input('client_meta'));
        if ($resolved['response'] !== null) {
            return $resolved['response'];
        }
        $quiz = $resolved['quiz'];
        $now = $this->quizNow($quiz);

        $submission = null;
        if ($submissionId !== '') {
            $submission = DB::table('quiz_submissions')
                ->where('id', $submissionId)
                ->where('quiz_id', $quizId)
                ->where('siswa_id', $user->id)
                ->where('tenant_id', $tenantId)
                ->first();
        }
        if (! $submission) {
            $submission = DB::table('quiz_submissions')
                ->where('quiz_id', $quizId)
                ->where('siswa_id', $user->id)
                ->where('tenant_id', $tenantId)
                ->first();
        }

        if ($submission && $submission->status === 'finished') {
            $result = $this->finalizeQuizSubmissionWithNotifications($tenantId, $submission, $now, 'finished');

            return response()->json([
                'data' => [
                    'submission_id' => $result['submission_id'] ?? (string) $submission->id,
                    'score' => $result['score'] ?? ($submission->score !== null ? (int) $submission->score : null),
                    'total_points' => $result['total_points'] ?? ($submission->total_points !== null ? (int) $submission->total_points : null),
                ],
            ]);
        }
        if ($submission) {
            $sessionResponse = $this->ensureSubmissionDeviceSession($request, $tenantId, $submission, $request->input('client_meta'), $now);
            if ($sessionResponse !== null) {
                return $sessionResponse;
            }
        }

        $answersStored = false;
        if ($answers !== null && ! is_array($answers)) {
            return response()->json(['message' => 'Format jawaban tidak valid'], 422);
        }

        if ($submission && is_array($answers) && count($answers)) {
            $storeResponse = $this->storeSubmittedAnswers($tenantId, $quizId, (string) $submission->id, $answers, $now);
            if ($storeResponse !== null) {
                return $storeResponse;
            }
            $answersStored = true;
        }

        $availability = $this->quizAvailabilityForStudent($quiz, $now);
        if (! $availability['ok']) {
            if ($submission && in_array((string) ($availability['reason'] ?? ''), ['closed', 'ended'], true)) {
                $result = $this->finalizeQuizSubmissionWithNotifications($tenantId, $submission, $now, 'finished');

                return response()->json([
                    'data' => [
                        'submission_id' => $result['submission_id'] ?? (string) $submission->id,
                        'score' => $result['score'] ?? ($submission->score !== null ? (int) $submission->score : null),
                        'total_points' => $result['total_points'] ?? ($submission->total_points !== null ? (int) $submission->total_points : null),
                        'closed_by_server' => true,
                    ],
                ]);
            }

            return response()->json(['message' => $availability['message']], $availability['code']);
        }

        if (! $submission) {
            $accessResponse = $this->denyIfQuizAccessCodeInvalid($quiz, $request->input('access_code'));
            if ($accessResponse !== null) {
                return $accessResponse;
            }

            $created = $this->createQuizSubmission($tenantId, $quiz, (string) $user->id, $now, $request->input('client_meta'));
            if ($created['response'] !== null) {
                return $created['response'];
            }
            $submission = $created['submission'];
        }
        $sessionResponse = $this->ensureSubmissionDeviceSession($request, $tenantId, $submission, $request->input('client_meta'), $now);
        if ($sessionResponse !== null) {
            return $sessionResponse;
        }
        $submissionId = (string) $submission->id;

        if (! $answersStored && is_array($answers) && count($answers)) {
            $storeResponse = $this->storeSubmittedAnswers($tenantId, $quizId, $submissionId, $answers, $now);
            if ($storeResponse !== null) {
                return $storeResponse;
            }
        }

        $result = $this->finalizeQuizSubmissionSafely($tenantId, $submission, $now, 'finished');
        if (! $result) {
            return response()->json(['message' => 'Gagal menyelesaikan quiz'], 500);
        }

        return response()->json([
            'data' => [
                'submission_id' => $result['submission_id'],
                'score' => $result['score'],
                'total_points' => $result['total_points'],
                'scoring_pending' => (bool) ($result['scoring_pending'] ?? false),
            ],
        ]);
    }

    public function startAttempt(Request $request)
    {
        if (! $this->isSiswa($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['message' => 'Tenant tidak valid'], 400);
        }

        $quizId = trim((string) $request->input('quiz_id', ''));
        if ($quizId === '') {
            return response()->json(['message' => 'quiz_id wajib diisi'], 422);
        }

        $resolved = $this->resolveStudentQuiz($request, $tenantId, $quizId, $request->input('client_meta'));
        if ($resolved['response'] !== null) {
            return $resolved['response'];
        }

        $quiz = $resolved['quiz'];
        $now = $this->quizNow($quiz);
        $availability = $this->quizAvailabilityForStudent($quiz, $now);
        if (! $availability['ok']) {
            return response()->json(['message' => $availability['message']], $availability['code']);
        }
        $strictSecurityResponse = $this->denyIfStrictFullscreenMissing($quiz, $request->input('client_meta'));
        if ($strictSecurityResponse !== null) {
            return $strictSecurityResponse;
        }

        $user = $request->user();
        $submission = DB::table('quiz_submissions')
            ->where('quiz_id', $quizId)
            ->where('siswa_id', $user->id)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $submission) {
            $accessResponse = $this->denyIfQuizAccessCodeInvalid($quiz, $request->input('access_code'));
            if ($accessResponse !== null) {
                return $accessResponse;
            }

            $created = $this->createQuizSubmission($tenantId, $quiz, (string) $user->id, $now, $request->input('client_meta'));
            if ($created['response'] !== null) {
                return $created['response'];
            }
            $submission = $created['submission'];
        }
        $sessionResponse = $this->ensureSubmissionDeviceSession($request, $tenantId, $submission, $request->input('client_meta'), $now);
        if ($sessionResponse !== null) {
            return $sessionResponse;
        }

        $detail = $this->studentQuizDetail($tenantId, $quiz, $submission, $now);

        return response()->json([
            'data' => [
                'submission' => $this->submissionPayload($submission),
                'questions' => $detail['questions'],
                'options_by_question' => $detail['options_by_question'],
                'order' => $detail['order'],
                'timing' => $this->quizTimingPayload($quiz, $now),
            ],
        ]);
    }

    public function saveAnswer(Request $request)
    {
        if (! $this->isSiswa($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['message' => 'Tenant tidak valid'], 400);
        }

        $quizId = trim((string) $request->input('quiz_id', ''));
        $submissionId = trim((string) $request->input('submission_id', ''));
        $questionId = trim((string) $request->input('question_id', ''));
        if ($quizId === '' || $submissionId === '' || $questionId === '') {
            return response()->json(['message' => 'quiz_id, submission_id, dan question_id wajib diisi'], 422);
        }

        $resolved = $this->resolveStudentQuiz($request, $tenantId, $quizId, $request->input('client_meta'));
        if ($resolved['response'] !== null) {
            return $resolved['response'];
        }
        $quiz = $resolved['quiz'];
        $now = $this->quizNow($quiz);

        $submission = DB::table('quiz_submissions')
            ->where('id', $submissionId)
            ->where('quiz_id', $quizId)
            ->where('siswa_id', $request->user()?->id)
            ->where('tenant_id', $tenantId)
            ->first();
        if (! $submission) {
            return response()->json(['message' => 'Attempt quiz tidak ditemukan'], 404);
        }
        if ((string) ($submission->status ?? '') === 'finished') {
            return response()->json(['message' => 'Quiz sudah selesai, jawaban tidak bisa diubah'], 422);
        }
        $sessionResponse = $this->ensureSubmissionDeviceSession($request, $tenantId, $submission, $request->input('client_meta'), $now);
        if ($sessionResponse !== null) {
            return $sessionResponse;
        }

        $availability = $this->quizAvailabilityForStudent($quiz, $now);
        if (! $availability['ok']) {
            if (in_array((string) ($availability['reason'] ?? ''), ['closed', 'ended'], true)) {
                $this->scoringService->finalizeSubmission($tenantId, $submissionId, $now, 'finished');
            }

            return response()->json(['message' => $availability['message']], $availability['code']);
        }

        $saved = $this->storeSubmissionAnswer(
            $tenantId,
            $quizId,
            $submissionId,
            $questionId,
            $request->input('option_id'),
            $request->input('essay_answer'),
            $now,
            $request->input('id')
        );
        if (! $saved['ok']) {
            return response()->json(['message' => $saved['message']], $saved['code']);
        }

        if (Schema::hasColumn('quiz_submissions', 'last_saved_at')) {
            DB::table('quiz_submissions')
                ->where('id', $submissionId)
                ->where('tenant_id', $tenantId)
                ->update([
                    'last_saved_at' => $now,
                    'updated_at' => $now,
                ]);
        }

        return response()->json([
            'data' => [
                'answer_id' => $saved['answer_id'],
                'submission_id' => $submissionId,
                'question_id' => $questionId,
                'saved_at' => $now->toISOString(),
                'deadline_at' => (string) ($quiz->deadline_at ?? ''),
            ],
        ]);
    }

    public function saveAnswersBatch(Request $request)
    {
        if (! $this->isSiswa($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['message' => 'Tenant tidak valid'], 400);
        }

        $quizId = trim((string) $request->input('quiz_id', ''));
        $submissionId = trim((string) $request->input('submission_id', ''));
        $answers = $request->input('answers', []);
        if ($quizId === '' || $submissionId === '') {
            return response()->json(['message' => 'quiz_id dan submission_id wajib diisi'], 422);
        }
        if (! is_array($answers) || count($answers) === 0) {
            return response()->json(['message' => 'Jawaban batch wajib berupa array yang tidak kosong'], 422);
        }
        if (count($answers) > 100) {
            return response()->json(['message' => 'Maksimal 100 jawaban dalam satu batch'], 422);
        }

        $resolved = $this->resolveStudentQuiz($request, $tenantId, $quizId, $request->input('client_meta'));
        if ($resolved['response'] !== null) {
            return $resolved['response'];
        }
        $quiz = $resolved['quiz'];
        $now = $this->quizNow($quiz);

        $submission = DB::table('quiz_submissions')
            ->where('id', $submissionId)
            ->where('quiz_id', $quizId)
            ->where('siswa_id', $request->user()?->id)
            ->where('tenant_id', $tenantId)
            ->first();
        if (! $submission) {
            return response()->json(['message' => 'Attempt quiz tidak ditemukan'], 404);
        }
        if ((string) ($submission->status ?? '') === 'finished') {
            return response()->json(['message' => 'Quiz sudah selesai, jawaban tidak bisa diubah'], 422);
        }

        $sessionResponse = $this->ensureSubmissionDeviceSession($request, $tenantId, $submission, $request->input('client_meta'), $now);
        if ($sessionResponse !== null) {
            return $sessionResponse;
        }

        $availability = $this->quizAvailabilityForStudent($quiz, $now);
        if (! $availability['ok']) {
            if (in_array((string) ($availability['reason'] ?? ''), ['closed', 'ended'], true)) {
                $this->scoringService->finalizeSubmission($tenantId, $submissionId, $now, 'finished');
            }

            return response()->json(['message' => $availability['message']], $availability['code']);
        }

        $stored = $this->storeSubmissionAnswersBatch($tenantId, $quizId, $submissionId, $answers, $now);
        if (! $stored['ok']) {
            return response()->json(['message' => $stored['message']], $stored['code']);
        }

        return response()->json([
            'data' => [
                'submission_id' => $submissionId,
                'answers' => $stored['answers'],
                'saved_count' => count($stored['answers']),
                'saved_at' => $now->toISOString(),
                'deadline_at' => (string) ($quiz->deadline_at ?? ''),
            ],
        ]);
    }

    public function logViolation(Request $request)
    {
        if (! $this->isSiswa($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['message' => 'Tenant tidak valid'], 400);
        }
        if (! Schema::hasTable('quiz_violation_logs')) {
            return response()->json(['data' => ['skipped' => true]]);
        }

        $quizId = trim((string) $request->input('quiz_id', ''));
        $submissionId = trim((string) $request->input('submission_id', ''));
        if ($quizId === '' || $submissionId === '') {
            return response()->json(['message' => 'quiz_id dan submission_id wajib diisi'], 422);
        }

        $submission = DB::table('quiz_submissions')
            ->where('id', $submissionId)
            ->where('quiz_id', $quizId)
            ->where('siswa_id', $request->user()?->id)
            ->where('tenant_id', $tenantId)
            ->first();
        if (! $submission) {
            return response()->json(['message' => 'Attempt quiz tidak ditemukan'], 404);
        }
        $sessionResponse = $this->ensureSubmissionDeviceSession($request, $tenantId, $submission, $request->input('client_meta'), $this->quizNow());
        if ($sessionResponse !== null) {
            return $sessionResponse;
        }

        $eventType = trim((string) $request->input('event_type', 'warning'));
        if ($eventType === '') {
            $eventType = 'warning';
        }

        $meta = $request->input('event_meta', $request->input('meta'));
        $eventTypeForStorage = Str::limit($eventType, 80, '');
        $incidentId = $this->metaStringValue($meta, 'incident_id');
        if ($incidentId !== '') {
            $incidentCacheKey = "quiz-violation-incident:{$tenantId}:{$submissionId}:".sha1($eventTypeForStorage.'|'.$incidentId);
            if (! Cache::add($incidentCacheKey, true, now()->addMinutes(30))) {
                return response()->json(['data' => [
                    'skipped' => true,
                    'duplicate_incident' => true,
                ]]);
            }

            $recentLogs = DB::table('quiz_violation_logs')
                ->where('tenant_id', $tenantId)
                ->where('quiz_id', $quizId)
                ->where('submission_id', $submissionId)
                ->where('siswa_id', $request->user()?->id)
                ->where('event_type', $eventTypeForStorage)
                ->orderByDesc('created_at')
                ->limit(30)
                ->get(['id', 'event_meta']);

            foreach ($recentLogs as $recentLog) {
                if ($this->metaStringValue($recentLog->event_meta ?? null, 'incident_id') === $incidentId) {
                    return response()->json(['data' => [
                        'id' => $recentLog->id,
                        'skipped' => true,
                        'duplicate_incident' => true,
                    ]]);
                }
            }
        }

        $rateKey = "quiz-violation-rate:{$tenantId}:{$submissionId}:".sha1($eventTypeForStorage);
        if (RateLimiter::tooManyAttempts($rateKey, 3)) {
            return response()->json(['data' => [
                'skipped' => true,
                'rate_limited' => true,
            ]]);
        }
        RateLimiter::hit($rateKey, 10);

        $logId = (string) Str::uuid();
        DB::table('quiz_violation_logs')->insert([
            'id' => $logId,
            'tenant_id' => $tenantId,
            'quiz_id' => $quizId,
            'submission_id' => $submissionId,
            'siswa_id' => $request->user()?->id,
            'event_type' => $eventTypeForStorage,
            'event_message' => $request->input('event_message'),
            'event_meta' => $this->encodeJsonOrNull($meta),
            'created_at' => $this->quizNow()->toISOString(),
        ]);

        if ((string) ($submission->status ?? '') !== 'finished') {
            $quiz = DB::table('quizzes')
                ->where('id', $quizId)
                ->where('tenant_id', $tenantId)
                ->first(['security_mode', 'max_attempts']);
            if ($quiz && (string) ($quiz->security_mode ?? '') === 'strict' && $quiz->max_attempts > 0) {
                $violationCount = (int) DB::table('quiz_violation_logs')
                    ->where('tenant_id', $tenantId)
                    ->where('quiz_id', $quizId)
                    ->where('submission_id', $submissionId)
                    ->where('siswa_id', $request->user()?->id)
                    ->count();
                if ($violationCount >= (int) $quiz->max_attempts) {
                    $now = $this->quizNow();
                    $finalizeResult = $this->finalizeQuizSubmissionSafely($tenantId, $submission, $now, 'finished');

                    return response()->json(['data' => [
                        'id' => $logId,
                        'auto_submitted' => true,
                        'reason' => 'max_attempts_exceeded',
                        'result' => $finalizeResult,
                    ]]);
                }
            }
        }

        return response()->json(['data' => ['id' => $logId]]);
    }

    public function publish(Request $request)
    {
        if (! $this->isGuru($request) && ! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['message' => 'Tenant tidak valid'], 400);
        }

        $quizId = trim((string) $request->input('quiz_id', ''));
        if ($quizId === '') {
            return response()->json(['message' => 'quiz_id wajib diisi'], 422);
        }

        $quiz = $this->resolveQuizForTeacherAction($request, $tenantId, $quizId);
        if (! $quiz) {
            return $this->deny('Quiz tidak diizinkan');
        }

        $now = $this->quizNow($quiz);
        $activate = $request->has('activate') ? $request->boolean('activate') : true;
        $hasOngoingSubmission = $this->quizHasOngoingSubmissions($tenantId, $quizId);
        if ($hasOngoingSubmission) {
            $restrictedKeys = [
                'shuffle_questions',
                'shuffle_options',
                'max_attempts',
                'security_mode',
                'access_device',
                'timezone',
                'access_code',
            ];
            foreach ($restrictedKeys as $key) {
                if ($request->has($key)) {
                    return response()->json([
                        'message' => 'Quiz sedang dikerjakan siswa. Keamanan dan pengaturan non-waktu tidak bisa diubah.',
                    ], 409);
                }
            }
            if ($request->has('activate') && ! $activate) {
                return response()->json([
                    'message' => 'Quiz sedang dikerjakan siswa. Gunakan Tutup Quiz jika ingin mengakhiri attempt.',
                ], 409);
            }
        }
        if ($activate && ! $this->boolValue($quiz->is_active ?? false)) {
            $activationError = $this->validateQuizCanBeActivated($tenantId, $quiz, $now);
            if ($activationError !== null) {
                return response()->json(['message' => $activationError], 422);
            }
        }
        $updates = [
            'is_active' => $activate,
            'updated_at' => $now,
        ];
        if ($activate && Schema::hasColumn('quizzes', 'published_at')) {
            $updates['published_at'] = $now;
        }
        if ($activate && Schema::hasColumn('quizzes', 'closed_at')) {
            $updates['closed_at'] = null;
        }
        if (Schema::hasColumn('quizzes', 'shuffle_questions') && $request->has('shuffle_questions')) {
            $updates['shuffle_questions'] = $request->boolean('shuffle_questions');
        }
        if (Schema::hasColumn('quizzes', 'shuffle_options') && $request->has('shuffle_options')) {
            $updates['shuffle_options'] = $request->boolean('shuffle_options');
        }
        if (Schema::hasColumn('quizzes', 'max_attempts') && $request->has('max_attempts')) {
            $maxAttempts = $request->input('max_attempts');
            if ($maxAttempts === null || $maxAttempts === '') {
                $updates['max_attempts'] = null;
            } elseif (is_numeric($maxAttempts) && (int) $maxAttempts >= 1 && (int) $maxAttempts <= 20) {
                $updates['max_attempts'] = (int) $maxAttempts;
            } else {
                return response()->json(['message' => 'Batas percobaan harus 1 sampai 20'], 422);
            }
        }
        if (Schema::hasColumn('quizzes', 'security_mode') && $request->has('security_mode')) {
            $mode = strtolower(trim((string) $request->input('security_mode', 'standard')));
            if (! in_array($mode, ['standard', 'strict'], true)) {
                return response()->json(['message' => 'Mode keamanan quiz tidak valid'], 422);
            }
            $updates['security_mode'] = $mode;
        }
        if (Schema::hasColumn('quizzes', 'access_device') && $request->has('access_device')) {
            $accessDevice = $this->normalizeQuizAccessDevice($request->input('access_device'));
            if ($accessDevice === null) {
                return response()->json(['message' => 'Akses perangkat quiz tidak valid'], 422);
            }
            $updates['access_device'] = $accessDevice;
        }
        if (Schema::hasColumn('quizzes', 'timezone') && $request->has('timezone')) {
            $timezone = trim((string) $request->input('timezone', self::DEFAULT_QUIZ_TIMEZONE));
            if (! $this->isValidTimezone($timezone)) {
                return response()->json(['message' => 'Timezone quiz tidak valid'], 422);
            }
            $updates['timezone'] = $timezone;
        }
        if (Schema::hasColumn('quizzes', 'access_code_hash') && $request->has('access_code')) {
            $accessCode = trim((string) $request->input('access_code', ''));
            $updates['access_code_hash'] = $accessCode === '' ? null : Hash::make($accessCode);
        }

        DB::table('quizzes')
            ->where('id', $quizId)
            ->where('tenant_id', $tenantId)
            ->update($updates);

        if ($activate) {
            try {
                $this->contentCache->questions($tenantId, $quizId);
            } catch (\Throwable) {
                // Cache warming tidak boleh mengganggu publish.
            }
        }

        $fresh = DB::table('quizzes')
            ->where('id', $quizId)
            ->where('tenant_id', $tenantId)
            ->first();

        return response()->json(['data' => ['quiz' => $this->quizPayload($fresh)]]);
    }

    public function schedule(Request $request)
    {
        if (! $this->isGuru($request) && ! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['message' => 'Tenant tidak valid'], 400);
        }

        $quizId = trim((string) $request->input('quiz_id', ''));
        if ($quizId === '') {
            return response()->json(['message' => 'quiz_id wajib diisi'], 422);
        }

        $quiz = $this->resolveQuizForTeacherAction($request, $tenantId, $quizId);
        if (! $quiz) {
            return $this->deny('Quiz tidak diizinkan');
        }

        $questionCount = DB::table('quiz_questions')
            ->where('quiz_id', $quizId)
            ->when(Schema::hasColumn('quiz_questions', 'tenant_id'), fn ($query) => $query->where('tenant_id', $tenantId))
            ->count();
        if ($questionCount < 1) {
            return response()->json(['message' => 'Tambahkan minimal 1 soal sebelum mengatur jadwal'], 422);
        }

        $settingsError = $this->validateQuizRequiredSettingsForSchedule($quiz);
        if ($settingsError !== null) {
            return response()->json(['message' => $settingsError], 422);
        }

        $timezone = trim((string) $request->input('timezone', $this->quizTimezone($quiz)));
        if (! $this->isValidTimezone($timezone)) {
            return response()->json(['message' => 'Timezone quiz tidak valid'], 422);
        }
        $quizForDates = clone $quiz;
        $quizForDates->timezone = $timezone;
        $now = $this->quizNow($quizForDates);
        $nowMinute = $now->copy()->startOfMinute();

        $startsAt = $this->parseQuizDate($request->input('starts_at'), $quizForDates);
        if (! $startsAt) {
            return response()->json(['message' => 'Tanggal mulai wajib diisi'], 422);
        }

        $existingStart = $this->parseQuizDate($quiz->starts_at ?? null, $quizForDates);
        $hasStartChanged = ! $existingStart || $existingStart->getTimestamp() !== $startsAt->getTimestamp();
        if ($this->quizHasOngoingSubmissions($tenantId, $quizId)) {
            if ($hasStartChanged) {
                return response()->json([
                    'message' => 'Tidak boleh mengubah jadwal saat ada siswa sedang mengerjakan quiz. Tunggu hingga semua selesai.',
                ], 409);
            }
            $existingDeadline = $this->parseQuizDate($quiz->deadline_at ?? null, $quizForDates);
            $hasDeadlineChanged = ! $existingDeadline || $existingDeadline->getTimestamp() !== $deadlineAt->getTimestamp();
            if ($hasDeadlineChanged) {
                return response()->json([
                    'message' => 'Tidak boleh mengubah jadwal saat ada siswa sedang mengerjakan quiz. Tunggu hingga semua selesai.',
                ], 409);
            }
        }
        if ((! $this->boolValue($quiz->is_active ?? false) || $hasStartChanged) && $startsAt->lt($nowMinute)) {
            return response()->json(['message' => 'Tanggal mulai quiz tidak boleh di masa lalu'], 422);
        }

        $deadlineAt = $this->parseQuizDate($request->input('deadline_at'), $quizForDates);
        if (! $deadlineAt) {
            return response()->json(['message' => 'Tanggal selesai wajib diisi'], 422);
        }
        if (! $deadlineAt->gt($startsAt)) {
            return response()->json(['message' => 'Tanggal selesai harus setelah tanggal mulai'], 422);
        }
        if ($deadlineAt->lt($nowMinute)) {
            return response()->json(['message' => 'Tanggal selesai quiz tidak boleh di masa lalu'], 422);
        }

        $periodError = $this->validateQuizTimelineWithinActivePeriod($tenantId, $startsAt, $deadlineAt, $quiz);
        if ($periodError !== null) {
            return response()->json(['message' => $periodError], 422);
        }

        $mode = $this->quizMode($quiz);
        $durationMinutes = (int) ceil(($deadlineAt->getTimestamp() - $startsAt->getTimestamp()) / 60);
        if ($mode !== 'regular' && $durationMinutes < 10) {
            return response()->json(['message' => 'Durasi quiz ujian minimal 10 menit'], 422);
        }

        $updates = [
            'starts_at' => $startsAt->toISOString(),
            'deadline_at' => $deadlineAt->toISOString(),
            'is_active' => true,
            'updated_at' => $now,
        ];
        if (Schema::hasColumn('quizzes', 'timezone')) {
            $updates['timezone'] = $timezone;
        }
        if (Schema::hasColumn('quizzes', 'closed_at')) {
            $updates['closed_at'] = null;
        }
        if (Schema::hasColumn('quizzes', 'published_at')) {
            $updates['published_at'] = $now;
        }
        if ($mode === 'regular') {
            $updates['is_live'] = false;
            $updates['live_started_at'] = null;
            $updates['duration_minutes'] = null;
        } else {
            $updates['is_live'] = true;
            $updates['live_started_at'] = $startsAt->toISOString();
            $updates['duration_minutes'] = $durationMinutes;
        }

        $updates = array_filter(
            $updates,
            fn ($value, $column) => Schema::hasColumn('quizzes', $column),
            ARRAY_FILTER_USE_BOTH
        );

        DB::table('quizzes')
            ->where('id', $quizId)
            ->where('tenant_id', $tenantId)
            ->update($updates);

        $fresh = DB::table('quizzes')
            ->where('id', $quizId)
            ->where('tenant_id', $tenantId)
            ->first();

        return response()->json(['data' => [
            'quiz' => $this->quizPayload($fresh),
            'duration_minutes' => $durationMinutes,
        ]]);
    }

    public function close(Request $request)
    {
        if (! $this->isGuru($request) && ! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['message' => 'Tenant tidak valid'], 400);
        }

        $quizId = trim((string) $request->input('quiz_id', ''));
        if ($quizId === '') {
            return response()->json(['message' => 'quiz_id wajib diisi'], 422);
        }

        $quiz = $this->resolveQuizForTeacherAction($request, $tenantId, $quizId);
        if (! $quiz) {
            return $this->deny('Quiz tidak diizinkan');
        }

        $now = $this->quizNow($quiz);
        $updates = [
            'is_active' => false,
            'updated_at' => $now,
        ];
        if (Schema::hasColumn('quizzes', 'closed_at')) {
            $updates['closed_at'] = $now;
        }

        DB::table('quizzes')
            ->where('id', $quizId)
            ->where('tenant_id', $tenantId)
            ->update($updates);

        $submissionIds = DB::table('quiz_submissions')
            ->where('tenant_id', $tenantId)
            ->where('quiz_id', $quizId)
            ->where('status', 'ongoing')
            ->pluck('id')
            ->map(fn ($id) => (string) $id)
            ->all();

        $finalized = 0;
        foreach ($submissionIds as $submissionId) {
            $submission = DB::table('quiz_submissions')
                ->where('tenant_id', $tenantId)
                ->where('id', $submissionId)
                ->first();
            $result = $submission
                ? $this->finalizeQuizSubmissionSafely($tenantId, $submission, $now, 'finished')
                : null;
            if ($result) {
                $finalized++;
            }
        }

        return response()->json([
            'data' => [
                'quiz_id' => $quizId,
                'closed_at' => $now->toISOString(),
                'finalized_submissions' => $finalized,
            ],
        ]);
    }

    public function gradeEssay(Request $request)
    {
        if (! $this->isGuru($request) && ! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['message' => 'Tenant tidak valid'], 400);
        }

        $freezeResponse = $this->denyIfNilaiFrozen($request, 'Perubahan nilai quiz');
        if ($freezeResponse !== null) {
            return $freezeResponse;
        }

        $quizId = trim((string) $request->input('quiz_id', ''));
        $submissionId = trim((string) $request->input('submission_id', ''));
        $siswaId = trim((string) $request->input('siswa_id', ''));
        $questionId = trim((string) $request->input('question_id', ''));
        $essayScoreRaw = $request->input('essay_score');

        if ($quizId === '' || $questionId === '' || $essayScoreRaw === null || $essayScoreRaw === '') {
            return response()->json(['message' => 'quiz_id, question_id, dan essay_score wajib diisi'], 422);
        }

        if ($submissionId === '' && $siswaId === '') {
            return response()->json(['message' => 'submission_id atau siswa_id wajib diisi'], 422);
        }

        if (! is_numeric($essayScoreRaw)) {
            return response()->json(['message' => 'Nilai esai harus berupa angka'], 422);
        }
        $essayScoreNumber = (float) $essayScoreRaw;
        if (! is_finite($essayScoreNumber) || floor($essayScoreNumber) !== $essayScoreNumber) {
            return response()->json(['message' => 'Nilai esai harus bilangan bulat'], 422);
        }
        $essayScore = (int) $essayScoreNumber;

        $quiz = $this->resolveQuizForRetake($request, $tenantId, $quizId);
        if (! $quiz) {
            return $this->deny('Quiz tidak diizinkan');
        }

        $submissionQuery = DB::table('quiz_submissions')
            ->where('tenant_id', $tenantId)
            ->where('quiz_id', $quizId);
        if ($submissionId !== '') {
            $submissionQuery->where('id', $submissionId);
        }
        if ($siswaId !== '') {
            $submissionQuery->where('siswa_id', $siswaId);
        }
        $submission = $submissionQuery->first();

        if (! $submission) {
            return response()->json(['message' => 'Submission siswa tidak ditemukan'], 404);
        }
        if ((string) ($submission->status ?? '') !== 'finished') {
            return response()->json(['message' => 'Esai hanya bisa dikoreksi setelah siswa menyelesaikan quiz'], 422);
        }

        $question = DB::table('quiz_questions')
            ->where('id', $questionId)
            ->where('quiz_id', $quizId)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'poin', 'question_type']);
        if (! $question) {
            return response()->json(['message' => 'Soal quiz tidak ditemukan'], 404);
        }

        $questionType = $this->normalizeQuestionType($question->question_type ?? null);
        if ($questionType !== 'essay') {
            return response()->json(['message' => 'Soal ini bukan tipe esai'], 422);
        }

        $maxPoint = max(0, (int) ($question->poin ?? 0));
        if ($essayScore < 0 || $essayScore > $maxPoint) {
            return response()->json(['message' => "Nilai esai harus 0 sampai {$maxPoint}"], 422);
        }

        $answer = DB::table('quiz_answers')
            ->where('submission_id', $submission->id)
            ->where('question_id', $questionId)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'essay_answer', 'essay_score', 'poin']);

        if (! $answer) {
            return response()->json(['message' => 'Jawaban esai siswa belum tersedia'], 422);
        }

        $hasEssayAnswer = trim((string) ($answer->essay_answer ?? '')) !== '';
        if (! $hasEssayAnswer && $essayScore > 0) {
            return response()->json(['message' => 'Jawaban esai kosong, nilai harus 0'], 422);
        }
        $now = now();
        $oldAnswerData = [
            'essay_score' => $answer->essay_score !== null ? (int) $answer->essay_score : null,
            'poin' => $answer->poin !== null ? (int) $answer->poin : null,
        ];
        $oldSubmissionData = [
            'id' => (string) $submission->id,
            'quiz_id' => (string) $submission->quiz_id,
            'siswa_id' => (string) $submission->siswa_id,
            'score' => $submission->score !== null ? (int) $submission->score : null,
            'total_points' => $submission->total_points !== null ? (int) $submission->total_points : null,
            'status' => $submission->status ?? null,
            'essay_review_completed_at' => $submission->essay_review_completed_at ?? null,
            'essay_review_completed_by' => $submission->essay_review_completed_by ?? null,
        ];

        DB::table('quiz_answers')
            ->where('id', $answer->id)
            ->where('tenant_id', $tenantId)
            ->update([
                'essay_score' => $essayScore,
                'poin' => $essayScore,
                'updated_at' => $now,
            ]);

        if (Schema::hasColumn('quiz_submissions', 'essay_review_completed_at')) {
            $resetPayload = [
                'essay_review_completed_at' => null,
                'updated_at' => $now,
            ];
            if (Schema::hasColumn('quiz_submissions', 'essay_review_completed_by')) {
                $resetPayload['essay_review_completed_by'] = null;
            }

            DB::table('quiz_submissions')
                ->where('id', $submission->id)
                ->where('tenant_id', $tenantId)
                ->update($resetPayload);
        }

        $result = $this->scoringService->finalizeSubmission(
            $tenantId,
            (string) $submission->id,
            $now,
            'finished',
            true
        );

        $submissionFresh = DB::table('quiz_submissions')
            ->where('id', $submission->id)
            ->where('tenant_id', $tenantId)
            ->first([
                'id',
                'quiz_id',
                'siswa_id',
                'score',
                'total_points',
                'status',
                'essay_review_completed_at',
                'essay_review_completed_by',
            ]);

        $this->logAudit(
            $request,
            'quiz_answers',
            (string) $answer->id,
            'UPDATE',
            $oldAnswerData,
            [
                'essay_score' => $essayScore,
                'poin' => $essayScore,
            ],
            $tenantId
        );

        $this->logAudit(
            $request,
            'quiz_submissions',
            (string) $submission->id,
            'UPDATE',
            $oldSubmissionData,
            [
                'score' => $submissionFresh?->score !== null ? (int) $submissionFresh->score : null,
                'total_points' => $submissionFresh?->total_points !== null ? (int) $submissionFresh->total_points : null,
                'essay_review_completed_at' => $submissionFresh?->essay_review_completed_at ?? null,
                'essay_review_completed_by' => $submissionFresh?->essay_review_completed_by ?? null,
            ],
            $tenantId
        );

        $this->notifyQuizSubmissionMutation(
            $tenantId,
            'update',
            [$oldSubmissionData],
            $submissionFresh ? [(array) $submissionFresh] : []
        );

        return response()->json([
            'data' => [
                'quiz_id' => $quizId,
                'submission_id' => (string) $submission->id,
                'siswa_id' => (string) $submission->siswa_id,
                'question_id' => $questionId,
                'essay_score' => $essayScore,
                'max_poin' => $maxPoint,
                'essay_review_completed_at' => null,
                'essay_review_completed_by' => null,
                'score' => $result['score'] ?? null,
                'total_points' => $result['total_points'] ?? null,
            ],
        ]);
    }

    public function completeEssayReview(Request $request)
    {
        if (! $this->isGuru($request) && ! $this->isAdmin($request)) {
            return $this->deny();
        }

        if (! Schema::hasColumn('quiz_submissions', 'essay_review_completed_at')) {
            return response()->json(['message' => 'Fitur selesai koreksi belum tersedia. Jalankan migrasi terbaru.'], 422);
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['message' => 'Tenant tidak valid'], 400);
        }

        $freezeResponse = $this->denyIfNilaiFrozen($request, 'Finalisasi koreksi nilai quiz');
        if ($freezeResponse !== null) {
            return $freezeResponse;
        }

        $quizId = trim((string) $request->input('quiz_id', ''));
        $submissionId = trim((string) $request->input('submission_id', ''));
        $siswaId = trim((string) $request->input('siswa_id', ''));

        if ($quizId === '') {
            return response()->json(['message' => 'quiz_id wajib diisi'], 422);
        }
        if ($submissionId === '' && $siswaId === '') {
            return response()->json(['message' => 'submission_id atau siswa_id wajib diisi'], 422);
        }

        $quiz = $this->resolveQuizForRetake($request, $tenantId, $quizId);
        if (! $quiz) {
            return $this->deny('Quiz tidak diizinkan');
        }

        $submissionQuery = DB::table('quiz_submissions')
            ->where('tenant_id', $tenantId)
            ->where('quiz_id', $quizId);
        if ($submissionId !== '') {
            $submissionQuery->where('id', $submissionId);
        }
        if ($siswaId !== '') {
            $submissionQuery->where('siswa_id', $siswaId);
        }
        $submission = $submissionQuery->first();

        if (! $submission) {
            return response()->json(['message' => 'Submission siswa tidak ditemukan'], 404);
        }
        if ((string) ($submission->status ?? '') !== 'finished') {
            return response()->json(['message' => 'Koreksi esai hanya untuk submission yang sudah selesai'], 422);
        }

        $essayQuestionIds = DB::table('quiz_questions')
            ->where('tenant_id', $tenantId)
            ->where('quiz_id', $quizId)
            ->where('question_type', 'essay')
            ->pluck('id')
            ->map(fn ($id) => (string) $id)
            ->all();

        if (empty($essayQuestionIds)) {
            return response()->json(['message' => 'Quiz ini tidak memiliki soal esai'], 422);
        }

        $answerRows = DB::table('quiz_answers')
            ->where('tenant_id', $tenantId)
            ->where('submission_id', $submission->id)
            ->whereIn('question_id', $essayQuestionIds)
            ->get(['essay_answer', 'essay_score']);

        $pendingCount = 0;
        foreach ($answerRows as $row) {
            $answerText = trim((string) ($row->essay_answer ?? ''));
            if ($answerText === '') {
                continue;
            }
            if ($row->essay_score === null) {
                $pendingCount++;
            }
        }
        if ($pendingCount > 0) {
            return response()->json(['message' => "Masih ada {$pendingCount} jawaban esai yang belum dinilai"], 422);
        }

        $oldSubmissionData = [
            'id' => (string) $submission->id,
            'quiz_id' => (string) $submission->quiz_id,
            'siswa_id' => (string) $submission->siswa_id,
            'score' => $submission->score !== null ? (int) $submission->score : null,
            'total_points' => $submission->total_points !== null ? (int) $submission->total_points : null,
            'status' => $submission->status ?? null,
            'essay_review_completed_at' => $submission->essay_review_completed_at ?? null,
            'essay_review_completed_by' => $submission->essay_review_completed_by ?? null,
        ];

        $now = now();
        $payload = [
            'essay_review_completed_at' => $now,
            'updated_at' => $now,
        ];
        if (Schema::hasColumn('quiz_submissions', 'essay_review_completed_by')) {
            $payload['essay_review_completed_by'] = $request->user()?->id;
        }

        DB::table('quiz_submissions')
            ->where('id', $submission->id)
            ->where('tenant_id', $tenantId)
            ->update($payload);

        $submissionFresh = DB::table('quiz_submissions')
            ->where('id', $submission->id)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'quiz_id', 'siswa_id', 'essay_review_completed_at', 'essay_review_completed_by', 'score', 'total_points', 'status']);

        $this->logAudit(
            $request,
            'quiz_submissions',
            (string) $submissionFresh->id,
            'UPDATE',
            $oldSubmissionData,
            [
                'essay_review_completed_at' => $submissionFresh->essay_review_completed_at,
                'essay_review_completed_by' => $submissionFresh->essay_review_completed_by,
                'score' => $submissionFresh->score !== null ? (int) $submissionFresh->score : null,
                'total_points' => $submissionFresh->total_points !== null ? (int) $submissionFresh->total_points : null,
            ],
            $tenantId
        );

        $this->notifyQuizSubmissionMutation(
            $tenantId,
            'update',
            [$oldSubmissionData],
            $submissionFresh ? [(array) $submissionFresh] : []
        );

        return response()->json([
            'data' => [
                'submission_id' => (string) $submissionFresh->id,
                'quiz_id' => (string) $submissionFresh->quiz_id,
                'siswa_id' => (string) $submissionFresh->siswa_id,
                'essay_review_completed_at' => $submissionFresh->essay_review_completed_at,
                'essay_review_completed_by' => $submissionFresh->essay_review_completed_by,
                'score' => $submissionFresh->score !== null ? (int) $submissionFresh->score : null,
                'total_points' => $submissionFresh->total_points !== null ? (int) $submissionFresh->total_points : null,
            ],
        ]);
    }

    public function retake(Request $request)
    {
        if (! $this->isGuru($request) && ! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['message' => 'Tenant tidak valid'], 400);
        }

        $freezeResponse = $this->denyIfNilaiFrozen($request, 'Reset/retake nilai quiz');
        if ($freezeResponse !== null) {
            return $freezeResponse;
        }

        $quizId = trim((string) $request->input('quiz_id', ''));
        $siswaId = trim((string) $request->input('siswa_id', ''));
        $confirmed = (bool) $request->boolean('confirmed', false);

        if ($quizId === '' || $siswaId === '') {
            return response()->json(['message' => 'quiz_id dan siswa_id wajib diisi'], 422);
        }
        if (! $confirmed) {
            return response()->json(['message' => 'Konfirmasi ulang quiz wajib disetujui'], 422);
        }

        $quiz = $this->resolveQuizForRetake($request, $tenantId, $quizId);
        if (! $quiz) {
            return $this->deny('Quiz tidak diizinkan');
        }

        $submission = DB::table('quiz_submissions')
            ->where('quiz_id', $quizId)
            ->where('siswa_id', $siswaId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $submission) {
            return response()->json(['message' => 'Siswa belum memiliki attempt quiz'], 404);
        }

        $siswa = DB::table('profiles')
            ->where('id', $siswaId)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'nama', 'role']);

        if (! $siswa || strtolower((string) ($siswa->role ?? '')) !== 'siswa') {
            return response()->json(['message' => 'Data siswa tidak valid'], 422);
        }

        $answerRows = DB::table('quiz_answers')
            ->where('submission_id', $submission->id)
            ->where('tenant_id', $tenantId)
            ->get([
                'id',
                'question_id',
                'option_id',
                'essay_answer',
                'essay_score',
                'is_correct',
                'poin',
            ])
            ->map(fn ($row) => (array) $row)
            ->values()
            ->all();

        $now = now();
        $user = $request->user();
        $logId = (string) Str::uuid();

        DB::transaction(function () use ($tenantId, $quizId, $siswaId, $submission, $user, $now, $logId) {
            DB::table('quiz_retake_logs')->insert([
                'id' => $logId,
                'tenant_id' => $tenantId,
                'quiz_id' => $quizId,
                'siswa_id' => $siswaId,
                'guru_id' => $user?->id,
                'submission_id' => $submission->id,
                'previous_score' => $submission->score,
                'previous_total_points' => $submission->total_points,
                'previous_status' => $submission->status,
                'previous_started_at' => $submission->started_at,
                'previous_finished_at' => $submission->finished_at,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            DB::table('quiz_answers')
                ->where('submission_id', $submission->id)
                ->where('tenant_id', $tenantId)
                ->delete();

            DB::table('quiz_submissions')
                ->where('id', $submission->id)
                ->where('tenant_id', $tenantId)
                ->delete();
        }, 3);

        $this->logAudit(
            $request,
            'quiz_retake_logs',
            $logId,
            'INSERT',
            null,
            [
                'quiz_id' => $quizId,
                'siswa_id' => $siswaId,
                'submission_id' => (string) $submission->id,
                'previous_score' => $submission->score !== null ? (int) $submission->score : null,
                'previous_total_points' => $submission->total_points !== null ? (int) $submission->total_points : null,
            ],
            $tenantId
        );

        $this->logAudit(
            $request,
            'quiz_answers',
            (string) $submission->id,
            'DELETE',
            [
                'count' => count($answerRows),
                'rows' => $answerRows,
            ],
            null,
            $tenantId
        );

        $this->logAudit(
            $request,
            'quiz_submissions',
            (string) $submission->id,
            'DELETE',
            (array) $submission,
            null,
            $tenantId
        );

        return response()->json([
            'data' => [
                'retake_log_id' => $logId,
                'quiz_id' => $quizId,
                'siswa_id' => $siswaId,
                'siswa_nama' => $siswa->nama,
                'previous_score' => $submission->score !== null ? (int) $submission->score : null,
                'previous_total_points' => $submission->total_points !== null ? (int) $submission->total_points : null,
                'previous_status' => $submission->status,
            ],
        ]);
    }

    public function retakeHistory(Request $request)
    {
        if (! $this->isGuru($request) && ! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['message' => 'Tenant tidak valid'], 400);
        }

        $quizId = trim((string) $request->query('quiz_id', ''));
        if ($quizId === '') {
            return response()->json(['message' => 'quiz_id wajib diisi'], 422);
        }

        $quiz = $this->resolveQuizForRetake($request, $tenantId, $quizId);
        if (! $quiz) {
            return $this->deny('Quiz tidak diizinkan');
        }

        $rows = DB::table('quiz_retake_logs as l')
            ->leftJoin('profiles as s', function ($join) {
                $join->on('s.id', '=', 'l.siswa_id')
                    ->on('s.tenant_id', '=', 'l.tenant_id');
            })
            ->leftJoin('profiles as g', function ($join) {
                $join->on('g.id', '=', 'l.guru_id')
                    ->on('g.tenant_id', '=', 'l.tenant_id');
            })
            ->where('l.tenant_id', $tenantId)
            ->where('l.quiz_id', $quizId)
            ->orderByDesc('l.created_at')
            ->get([
                'l.id',
                'l.quiz_id',
                'l.siswa_id',
                'l.guru_id',
                'l.submission_id',
                'l.previous_score',
                'l.previous_total_points',
                'l.previous_status',
                'l.previous_started_at',
                'l.previous_finished_at',
                'l.created_at',
                's.nama as siswa_nama',
                'g.nama as guru_nama',
            ]);

        return response()->json(['data' => $rows]);
    }

    public function restoreRetakeScore(Request $request)
    {
        if (! $this->isGuru($request) && ! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['message' => 'Tenant tidak valid'], 400);
        }

        $freezeResponse = $this->denyIfNilaiFrozen($request, 'Pemulihan nilai quiz');
        if ($freezeResponse !== null) {
            return $freezeResponse;
        }

        $quizId = trim((string) $request->input('quiz_id', ''));
        $siswaId = trim((string) $request->input('siswa_id', ''));

        if ($quizId === '' || $siswaId === '') {
            return response()->json(['message' => 'quiz_id dan siswa_id wajib diisi'], 422);
        }

        $quiz = $this->resolveQuizForRetake($request, $tenantId, $quizId);
        if (! $quiz) {
            return $this->deny('Quiz tidak diizinkan');
        }

        $siswa = DB::table('profiles')
            ->where('id', $siswaId)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'nama', 'role']);

        if (! $siswa || strtolower((string) ($siswa->role ?? '')) !== 'siswa') {
            return response()->json(['message' => 'Data siswa tidak valid'], 422);
        }

        $latestLog = DB::table('quiz_retake_logs')
            ->where('tenant_id', $tenantId)
            ->where('quiz_id', $quizId)
            ->where('siswa_id', $siswaId)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->first([
                'id',
                'previous_score',
                'previous_total_points',
                'previous_started_at',
                'previous_finished_at',
                'created_at',
            ]);

        if (! $latestLog) {
            return response()->json(['message' => 'Riwayat nilai sebelum ulang tidak ditemukan'], 404);
        }
        if ($latestLog->previous_score === null) {
            return response()->json(['message' => 'Nilai sebelum ulang belum tersedia untuk dipulihkan'], 422);
        }

        $existingSubmission = DB::table('quiz_submissions')
            ->where('tenant_id', $tenantId)
            ->where('quiz_id', $quizId)
            ->where('siswa_id', $siswaId)
            ->first([
                'id',
                'status',
                'score',
                'total_points',
                'started_at',
                'finished_at',
                'essay_review_completed_at',
                'essay_review_completed_by',
            ]);

        if ($existingSubmission && strtolower(trim((string) ($existingSubmission->status ?? ''))) === 'ongoing') {
            return response()->json(['message' => 'Siswa sedang mengerjakan quiz. Selesaikan atau reset dulu sebelum memulihkan nilai lama'], 422);
        }

        $now = now();
        $score = (int) $latestLog->previous_score;
        $totalPoints = $latestLog->previous_total_points !== null
            ? (int) $latestLog->previous_total_points
            : (int) DB::table('quiz_questions')
                ->where('tenant_id', $tenantId)
                ->where('quiz_id', $quizId)
                ->sum('poin');

        $hasReviewCompletedAt = Schema::hasColumn('quiz_submissions', 'essay_review_completed_at');
        $hasReviewCompletedBy = Schema::hasColumn('quiz_submissions', 'essay_review_completed_by');

        $submissionId = DB::transaction(function () use (
            $tenantId,
            $quizId,
            $siswaId,
            $existingSubmission,
            $latestLog,
            $score,
            $totalPoints,
            $now,
            $hasReviewCompletedAt,
            $hasReviewCompletedBy,
            $request,
            $quiz
        ) {
            $payload = [
                'score' => $score,
                'total_points' => $totalPoints,
                'status' => 'finished',
                'finished_at' => $latestLog->previous_finished_at ?: $now,
                'updated_at' => $now,
            ];
            $payload = array_merge($payload, $this->quizSubmissionAcademicSnapshot($tenantId, $quiz, $siswaId));

            if ($hasReviewCompletedAt) {
                $payload['essay_review_completed_at'] = $now;
                if ($hasReviewCompletedBy) {
                    $payload['essay_review_completed_by'] = $request->user()?->id;
                }
            }

            if ($existingSubmission) {
                DB::table('quiz_submissions')
                    ->where('id', $existingSubmission->id)
                    ->where('tenant_id', $tenantId)
                    ->update($payload);

                return (string) $existingSubmission->id;
            }

            $newSubmissionId = (string) Str::uuid();
            DB::table('quiz_submissions')->insert(array_merge($payload, [
                'id' => $newSubmissionId,
                'tenant_id' => $tenantId,
                'quiz_id' => $quizId,
                'siswa_id' => $siswaId,
                'started_at' => $latestLog->previous_started_at ?: ($latestLog->previous_finished_at ?: $now),
                'created_at' => $now,
            ]));

            return $newSubmissionId;
        }, 3);

        $selectColumns = [
            'id',
            'quiz_id',
            'siswa_id',
            'status',
            'score',
            'total_points',
            'started_at',
            'finished_at',
        ];
        if ($hasReviewCompletedAt) {
            $selectColumns[] = 'essay_review_completed_at';
        }
        if ($hasReviewCompletedBy) {
            $selectColumns[] = 'essay_review_completed_by';
        }

        $submissionFresh = DB::table('quiz_submissions')
            ->where('id', $submissionId)
            ->where('tenant_id', $tenantId)
            ->first($selectColumns);

        $auditAction = $existingSubmission ? 'UPDATE' : 'INSERT';
        $this->logAudit(
            $request,
            'quiz_submissions',
            (string) $submissionFresh->id,
            $auditAction,
            $existingSubmission ? (array) $existingSubmission : null,
            (array) $submissionFresh,
            $tenantId
        );

        return response()->json([
            'data' => [
                'submission_id' => (string) $submissionFresh->id,
                'quiz_id' => (string) $submissionFresh->quiz_id,
                'siswa_id' => (string) $submissionFresh->siswa_id,
                'siswa_nama' => (string) ($siswa->nama ?? ''),
                'score' => $submissionFresh->score !== null ? (int) $submissionFresh->score : null,
                'total_points' => $submissionFresh->total_points !== null ? (int) $submissionFresh->total_points : null,
                'status' => (string) ($submissionFresh->status ?? ''),
                'essay_review_completed_at' => $hasReviewCompletedAt ? ($submissionFresh->essay_review_completed_at ?? null) : null,
                'essay_review_completed_by' => $hasReviewCompletedBy ? ($submissionFresh->essay_review_completed_by ?? null) : null,
                'restored_from_retake_log_id' => (string) $latestLog->id,
                'restored_from_retake_at' => $latestLog->created_at,
            ],
        ]);
    }

    private function dashboardPerPage(Request $request): int
    {
        return max(1, min(100, (int) $request->query('per_page', 25)));
    }

    private function dashboardPagination(int $page, int $perPage, int $total): array
    {
        $pageCount = max(1, (int) ceil($total / max(1, $perPage)));
        $safePage = min(max(1, $page), $pageCount);

        return [
            'page' => $safePage,
            'per_page' => $perPage,
            'total' => $total,
            'page_count' => $pageCount,
            'from' => $total === 0 ? 0 : (($safePage - 1) * $perPage) + 1,
            'to' => $total === 0 ? 0 : min($total, (($safePage - 1) * $perPage) + $perPage),
        ];
    }

    private function quizTenantQuery(string $tenantId)
    {
        $query = DB::table('quizzes');
        if (Schema::hasColumn('quizzes', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        return $query;
    }

    private function quizTenantTable(string $table, string $tenantId)
    {
        $query = DB::table($table);
        if (Schema::hasColumn($table, 'tenant_id')) {
            $query->where("{$table}.tenant_id", $tenantId);
        }

        return $query;
    }

    private function finalizeQuizSubmissionWithNotifications(string $tenantId, object $submission, Carbon $now, string $status): ?array
    {
        $beforeRows = [(array) $submission];
        $result = $this->scoringService->finalizeSubmission($tenantId, (string) $submission->id, $now, $status);
        if (! $result) {
            return null;
        }

        $fresh = $this->quizTenantTable('quiz_submissions', $tenantId)
            ->where('id', (string) ($result['submission_id'] ?? $submission->id))
            ->first();

        $this->notifyQuizSubmissionMutation($tenantId, 'update', $beforeRows, $fresh ? [(array) $fresh] : []);

        return $result;
    }

    private function finalizeQuizSubmissionSafely(string $tenantId, object $submission, Carbon $now, string $status): ?array
    {
        if (! config('quiz.async_scoring_enabled', false)) {
            return $this->finalizeQuizSubmissionWithNotifications($tenantId, $submission, $now, $status);
        }

        try {
            DB::table('quiz_submissions')
                ->where('tenant_id', $tenantId)
                ->where('id', (string) $submission->id)
                ->update([
                    'status' => $status,
                    'finished_at' => $now,
                    'updated_at' => $now,
                ]);

            FinalizeQuizSubmissionJob::dispatch(
                $tenantId,
                (string) $submission->id,
                $now->toISOString(),
                $status
            );

            return [
                'submission_id' => (string) $submission->id,
                'score' => null,
                'total_points' => null,
                'scoring_pending' => true,
            ];
        } catch (\Throwable) {
            return $this->finalizeQuizSubmissionWithNotifications($tenantId, $submission, $now, $status);
        }
    }

    private function notifyQuizSubmissionMutation(string $tenantId, string $action, array $beforeRows, array $afterRows): void
    {
        if ($tenantId === '') {
            return;
        }

        try {
            $this->whatsAppNotificationService->handleTableMutation(
                $tenantId,
                'quiz_submissions',
                $action,
                $beforeRows,
                $afterRows
            );
        } catch (\Throwable) {
            // Notifikasi WhatsApp tidak boleh mengganggu proses submit atau penilaian quiz.
        }
    }

    private function selectExistingQuizColumns(string $table, array $columns): array
    {
        if (! Schema::hasTable($table)) {
            return $columns;
        }

        $available = array_values(array_filter($columns, fn ($column) => Schema::hasColumn($table, $column)));

        return ! empty($available) ? $available : ['*'];
    }

    private function applyQuizAcademicQueryFilters($query, string $table, Request $request): void
    {
        $tenantId = (string) ($this->tenantId($request) ?? '');
        $context = $tenantId !== '' ? $this->academicContextResolver->forRead($request, $tenantId) : [];
        $academicYear = $context['tahun_ajaran'] ?? null;
        $semester = $context['semester'] ?? null;

        if ($academicYear && Schema::hasColumn($table, 'tahun_ajaran')) {
            $query->where('tahun_ajaran', $academicYear);
        }
        if ($semester && Schema::hasColumn($table, 'semester')) {
            $query->where('semester', $semester);
        }
    }

    private function resolveStudentQuiz(Request $request, string $tenantId, string $quizId, $clientMeta = null): array
    {
        $quiz = DB::table('quizzes')
            ->where('id', $quizId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $quiz) {
            return [
                'quiz' => null,
                'response' => response()->json(['message' => 'Quiz tidak ditemukan'], 404),
            ];
        }

        if (! $this->quizMatchesActiveAcademicPeriod($quiz, $tenantId)) {
            return [
                'quiz' => null,
                'response' => $this->deny('Quiz bukan periode akademik aktif'),
            ];
        }

        if (! $this->sameClassId($quiz->kelas_id ?? '', $this->studentClassId($request))) {
            return [
                'quiz' => null,
                'response' => $this->deny('Quiz bukan untuk kelas ini'),
            ];
        }

        $deviceResponse = $this->denyIfQuizDeviceNotAllowed($quiz, $this->requestClientDevice($request, $clientMeta));
        if ($deviceResponse !== null) {
            return [
                'quiz' => null,
                'response' => $deviceResponse,
            ];
        }

        return [
            'quiz' => $quiz,
            'response' => null,
        ];
    }

    private function studentClassId(Request $request): string
    {
        return trim((string) ($this->profile($request)?->kelas ?? ''));
    }

    private function studentClassIdForPeriod(Request $request, mixed $year, mixed $semester): string
    {
        $tenantId = (string) ($this->tenantId($request) ?? '');
        $studentId = (string) ($request->user()?->id ?? '');
        if ($tenantId === '' || $studentId === '') {
            return '';
        }

        $active = $this->currentAcademicPeriodForTenant($tenantId);
        $resolved = $this->studentAcademicClassResolver->resolve(
            $tenantId,
            $studentId,
            is_scalar($year) ? (string) $year : null,
            is_scalar($semester) ? (string) $semester : null,
            $this->studentClassId($request),
            $active['tahun_ajaran'] ?? null
        );

        return trim((string) $resolved);
    }

    private function quizTargetClassExists(string $tenantId, string $kelasId): bool
    {
        if ($kelasId === '' || ! Schema::hasTable('kelas')) {
            return false;
        }

        $query = DB::table('kelas')->where('id', $kelasId);
        if (Schema::hasColumn('kelas', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        return $query->exists();
    }

    private function teacherCanCloneQuizToTarget(
        Request $request,
        string $tenantId,
        string $kelasId,
        string $mapel,
        ?string $academicYear,
        ?string $semester
    ): bool {
        $userId = (string) ($request->user()?->id ?? '');
        if ($userId === '' || $kelasId === '' || $mapel === '' || ! Schema::hasTable('jadwal')) {
            return false;
        }

        $query = DB::table('jadwal')
            ->where('guru_id', $userId)
            ->where('kelas_id', $kelasId)
            ->whereRaw('lower(trim(mapel)) = ?', [strtolower(trim($mapel))]);

        if (Schema::hasColumn('jadwal', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }
        if ($academicYear && Schema::hasColumn('jadwal', 'tahun_ajaran')) {
            $query->where('tahun_ajaran', $academicYear);
        }
        // Jadwal adalah data tahunan. Nilai semester pada baris lama hanya
        // metadata kompatibilitas dan tidak boleh membatasi penugasan guru.

        return $query->exists();
    }

    private function sameClassId($left, $right): bool
    {
        return trim((string) $left) === trim((string) $right);
    }

    private function currentAcademicPeriodForTenant(string $tenantId): array
    {
        if ($this->academicPeriodLifecycle->ready()) {
            $context = $this->academicPeriodLifecycle->currentContext($tenantId);
            if (($context['tahun_ajaran'] ?? null) && ($context['semester'] ?? null)) {
                return $context;
            }
        }

        $settings = null;
        if (Schema::hasTable('settings')) {
            $settingsQuery = DB::table('settings')->orderBy('id');
            if (Schema::hasColumn('settings', 'tenant_id')) {
                $settingsQuery->where('tenant_id', $tenantId);
            }
            $columns = array_values(array_filter(
                ['tahun_ajaran', 'semester_aktif', 'periode_mulai', 'periode_selesai'],
                fn ($column) => Schema::hasColumn('settings', $column)
            ));
            $settings = $settingsQuery->first($columns ?: ['tahun_ajaran', 'semester_aktif']);
        }

        return AcademicPeriod::fromSettings($settings);
    }

    private function quizMatchesActiveAcademicPeriod(object $quiz, string $tenantId): bool
    {
        if (! Schema::hasColumn('quizzes', 'tahun_ajaran') || ! Schema::hasColumn('quizzes', 'semester')) {
            return true;
        }

        $quizYear = AcademicPeriod::normalizeAcademicYear($quiz->tahun_ajaran ?? null);
        $quizSemester = AcademicPeriod::normalizeSemester($quiz->semester ?? null);
        if (! $quizYear || ! $quizSemester) {
            return true;
        }

        $period = $this->currentAcademicPeriodForTenant($tenantId);

        return $quizYear === $period['tahun_ajaran'] && $quizSemester === $period['semester'];
    }

    private function quizSubmissionAcademicSnapshot(string $tenantId, object $quiz, string $siswaId): array
    {
        $snapshot = [];

        if (Schema::hasColumn('quiz_submissions', 'tahun_ajaran')) {
            $year = AcademicPeriod::normalizeAcademicYear($quiz->tahun_ajaran ?? null)
                ?: $this->currentAcademicPeriodForTenant($tenantId)['tahun_ajaran'];
            $snapshot['tahun_ajaran'] = $year;
        }

        if (Schema::hasColumn('quiz_submissions', 'semester')) {
            $semester = AcademicPeriod::normalizeSemester($quiz->semester ?? null)
                ?: $this->currentAcademicPeriodForTenant($tenantId)['semester'];
            $snapshot['semester'] = $semester;
        }

        if (Schema::hasColumn('quiz_submissions', 'angkatan')) {
            $cohort = $this->studentCohortForTenant($tenantId, $siswaId);
            if (! $cohort && Schema::hasColumn('quizzes', 'angkatan')) {
                $cohort = trim((string) ($quiz->angkatan ?? '')) ?: null;
            }
            if ($cohort) {
                $snapshot['angkatan'] = $cohort;
            }
        }

        return $snapshot;
    }

    private function studentCohortForTenant(string $tenantId, string $siswaId): ?string
    {
        if (! Schema::hasColumn('profiles', 'angkatan')) {
            return null;
        }

        $query = DB::table('profiles')->where('id', $siswaId);
        if (Schema::hasColumn('profiles', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        $row = $query->first(['angkatan']);

        return trim((string) ($row->angkatan ?? '')) ?: null;
    }

    private function quizHasOngoingSubmissions(string $tenantId, string $quizId): bool
    {
        return DB::table('quiz_submissions')
            ->where('tenant_id', $tenantId)
            ->where('quiz_id', $quizId)
            ->where('status', 'ongoing')
            ->exists();
    }

    private function validateQuizCanBeActivated(string $tenantId, object $quiz, Carbon $now): ?string
    {
        $startsAt = $this->parseQuizDate($quiz->starts_at ?? null, $quiz);
        if (! $startsAt) {
            return 'Tanggal mulai quiz wajib diisi sebelum quiz dimulai';
        }
        if ($startsAt->lt($now->copy()->startOfMinute())) {
            return 'Tanggal mulai quiz tidak boleh di masa lalu';
        }

        if ($this->quizMode($quiz) !== 'regular') {
            $duration = (int) ($quiz->duration_minutes ?? 0);
            if ($duration < 10) {
                return 'Durasi quiz ujian minimal 10 menit';
            }
            $endsAt = $startsAt->copy()->addMinutes($duration);
        } else {
            $endsAt = $this->parseQuizDate($quiz->deadline_at ?? null, $quiz);
            if (! $endsAt) {
                return 'Tanggal selesai quiz wajib diisi sebelum quiz dimulai';
            }
            if (! $endsAt->gt($startsAt)) {
                return 'Tanggal selesai quiz harus setelah tanggal mulai';
            }
        }

        if ($endsAt->lt($now->copy()->startOfMinute())) {
            return 'Waktu selesai quiz tidak boleh di masa lalu';
        }

        $periodError = $this->validateQuizTimelineWithinActivePeriod($tenantId, $startsAt, $endsAt, $quiz);
        if ($periodError !== null) {
            return $periodError;
        }

        $academicYear = AcademicPeriod::normalizeAcademicYear($quiz->tahun_ajaran ?? null)
            ?: $this->currentAcademicPeriodForTenant($tenantId)['tahun_ajaran'];

        return $this->validateQuizTimelineWithinAcademicYear($startsAt, $endsAt, $academicYear);
    }

    private function academicYearBounds(?string $academicYear): ?array
    {
        $year = AcademicPeriod::normalizeAcademicYear($academicYear);
        if (! $year) {
            return null;
        }

        $startYear = (int) substr($year, 0, 4);
        if ($startYear <= 0) {
            return null;
        }

        return [
            Carbon::create($startYear, 7, 1, 0, 0, 0, 'Asia/Jakarta')->startOfDay(),
            Carbon::create($startYear + 1, 6, 30, 23, 59, 59, 'Asia/Jakarta')->endOfDay(),
        ];
    }

    private function validateQuizTimelineWithinAcademicYear(?Carbon $startsAt, ?Carbon $endsAt, ?string $academicYear): ?string
    {
        $year = AcademicPeriod::normalizeAcademicYear($academicYear);
        $bounds = $this->academicYearBounds($year);
        if (! $year || ! $bounds) {
            return null;
        }

        [$periodStart, $periodEnd] = $bounds;
        foreach ([
            'Tanggal mulai' => $startsAt,
            'Waktu selesai' => $endsAt,
        ] as $label => $date) {
            if (! $date instanceof Carbon) {
                continue;
            }
            $localDate = $date->copy()->setTimezone('Asia/Jakarta');
            if ($localDate->lt($periodStart) || $localDate->gt($periodEnd)) {
                return "{$label} quiz harus berada dalam tahun periode {$year} ({$periodStart->toDateString()} sampai {$periodEnd->toDateString()})";
            }
        }

        return null;
    }

    private function validateQuizTimelineWithinActivePeriod(string $tenantId, ?Carbon $startsAt, ?Carbon $endsAt, ?object $quiz = null): ?string
    {
        $period = $this->currentAcademicPeriodForTenant($tenantId);
        $startDate = $period['starts_at'] ?? $period['periode_mulai'] ?? null;
        $endDate = $period['ends_at'] ?? $period['periode_selesai'] ?? null;
        if (! $startDate || ! $endDate) {
            return null;
        }

        $timezone = $this->quizTimezone($quiz);
        $periodStart = Carbon::parse($startDate, $timezone)->startOfDay();
        $periodEnd = Carbon::parse($endDate, $timezone)->endOfDay();
        $periodLabel = ($period['tahun_ajaran'] ?? '').' - Semester '.($period['semester'] ?? '');

        foreach ([
            'Tanggal mulai' => $startsAt,
            'Waktu selesai' => $endsAt,
        ] as $label => $date) {
            if (! $date instanceof Carbon) {
                continue;
            }
            $localDate = $date->copy()->setTimezone($timezone);
            if ($localDate->lt($periodStart) || $localDate->gt($periodEnd)) {
                return "{$label} quiz harus berada dalam periode aktif {$periodLabel} ({$periodStart->toDateString()} sampai {$periodEnd->toDateString()})";
            }
        }

        return null;
    }

    private function quizMode(object $quiz): string
    {
        $mode = strtolower(trim((string) ($quiz->mode ?? '')));
        if (in_array($mode, ['regular', 'uts', 'uas'], true)) {
            return $mode;
        }

        return $this->boolValue($quiz->is_live ?? false) ? 'uts' : 'regular';
    }

    private function validateQuizRequiredSettingsForSchedule(object $quiz): ?string
    {
        if (Schema::hasColumn('quizzes', 'security_mode')) {
            $securityMode = strtolower(trim((string) ($quiz->security_mode ?? '')));
            if (! in_array($securityMode, ['standard', 'strict'], true)) {
                return 'Atur dan simpan mode keamanan quiz terlebih dahulu';
            }
        }

        if (Schema::hasColumn('quizzes', 'access_device')) {
            if ($this->normalizeQuizAccessDevice($quiz->access_device ?? null) === null) {
                return 'Pilih dan simpan akses perangkat quiz terlebih dahulu';
            }
        }

        return null;
    }

    private function normalizeQuizAccessDevice($value): ?string
    {
        return 'web';
    }

    private function quizAccessDevice(object $quiz): string
    {
        return 'web';
    }

    private function clientMetaArray($clientMeta): array
    {
        if (is_string($clientMeta)) {
            $decoded = json_decode($clientMeta, true);

            return is_array($decoded) ? $decoded : [];
        }
        if (is_array($clientMeta)) {
            return $clientMeta;
        }
        if (is_object($clientMeta)) {
            return (array) $clientMeta;
        }

        return [];
    }

    private function clientDeviceFromMeta($clientMeta): ?string
    {
        return 'web';
    }

    private function normalizeClientDeviceId($value): string
    {
        $raw = trim((string) ($value ?? ''));
        if ($raw === '') {
            return '';
        }

        $clean = preg_replace('/[^A-Za-z0-9._:-]/', '', $raw) ?: '';

        return Str::limit($clean, 191, '');
    }

    private function clientDeviceIdFromMeta($clientMeta): string
    {
        $meta = $this->clientMetaArray($clientMeta);
        foreach (['device_id', 'deviceId', 'client_device_id', 'browser_device_id', 'session_device_id'] as $key) {
            $deviceId = $this->normalizeClientDeviceId($meta[$key] ?? '');
            if ($deviceId !== '') {
                return $deviceId;
            }
        }

        return '';
    }

    private function requestQuizDeviceId(Request $request, $clientMeta = null): string
    {
        $deviceId = $this->clientDeviceIdFromMeta($clientMeta);
        if ($deviceId !== '') {
            return $deviceId;
        }

        foreach ([
            $request->input('client_device_id'),
            $request->query('client_device_id'),
            $request->header('X-EduSmart-Device-Id'),
            $request->header('X-Device-Id'),
        ] as $value) {
            $deviceId = $this->normalizeClientDeviceId($value);
            if ($deviceId !== '') {
                return $deviceId;
            }
        }

        $fingerprintSource = implode('|', [
            (string) ($request->user()?->id ?? ''),
            $this->requestClientDevice($request, $clientMeta),
            (string) $request->ip(),
            Str::limit((string) $request->userAgent(), 180, ''),
        ]);

        return 'fp-'.sha1($fingerprintSource);
    }

    private function ensureSubmissionDeviceSession(Request $request, string $tenantId, object $submission, $clientMeta, Carbon $now)
    {
        if ((string) ($submission->status ?? '') === 'finished') {
            return null;
        }

        $currentDeviceId = $this->requestQuizDeviceId($request, $clientMeta);
        $storedMeta = $this->clientMetaArray($submission->client_meta ?? null);
        $lockedDeviceId = $this->clientDeviceIdFromMeta($storedMeta);

        if ($lockedDeviceId !== '' && ! hash_equals($lockedDeviceId, $currentDeviceId)) {
            $lockedLastSeenAt = null;
            try {
                $lastSeenRaw = $storedMeta['last_seen_at'] ?? $storedMeta['locked_at'] ?? null;
                $lockedLastSeenAt = $lastSeenRaw ? Carbon::parse((string) $lastSeenRaw) : null;
            } catch (\Throwable) {
                $lockedLastSeenAt = null;
            }

            $lockedStillActive = $lockedLastSeenAt !== null
                && $lockedLastSeenAt->diffInSeconds($now, false) <= self::DEVICE_SESSION_STALE_SECONDS;

            if ($lockedStillActive) {
                return response()->json([
                    'message' => 'Quiz ini sedang aktif di perangkat lain. Lanjutkan dari perangkat pertama atau minta guru mereset attempt.',
                    'code' => 'quiz_device_session_locked',
                    'locked_last_seen_at' => $lockedLastSeenAt?->toISOString(),
                    'retry_after_seconds' => max(1, self::DEVICE_SESSION_STALE_SECONDS - $lockedLastSeenAt->diffInSeconds($now, false)),
                ], 409);
            }
        }

        if (! Schema::hasColumn('quiz_submissions', 'client_meta')) {
            return null;
        }

        $incomingMeta = $this->clientMetaArray($clientMeta);
        $clientDevice = $this->requestClientDevice($request, $clientMeta);
        $mergedMeta = array_merge($storedMeta, $incomingMeta, [
            'device_id' => $currentDeviceId,
            'session_device_id' => $currentDeviceId,
            'client_device' => $clientDevice,
            'session_locked' => true,
            'last_seen_at' => $now->toISOString(),
        ]);
        if ($lockedDeviceId !== '' && ! hash_equals($lockedDeviceId, $currentDeviceId)) {
            $mergedMeta['previous_device_id'] = $lockedDeviceId;
            $mergedMeta['takeover_at'] = $now->toISOString();
        }
        if (empty($mergedMeta['locked_at'])) {
            $mergedMeta['locked_at'] = $now->toISOString();
        }

        $update = [
            'client_meta' => $this->encodeJsonOrNull($mergedMeta),
            'updated_at' => $now,
        ];
        if (Schema::hasColumn('quiz_submissions', 'client_device')) {
            $update['client_device'] = $clientDevice;
        }

        DB::table('quiz_submissions')
            ->where('id', $submission->id)
            ->where('tenant_id', $tenantId)
            ->update($update);

        return null;
    }

    private function requestClientDevice(Request $request, $clientMeta = null): string
    {
        return 'web';
    }

    private function denyIfQuizDeviceNotAllowed(object $quiz, string $clientDevice)
    {
        return null;
    }

    private function quizNow(?object $quiz = null): Carbon
    {
        return Carbon::now($this->quizTimezone($quiz));
    }

    private function quizTimezone(?object $quiz = null): string
    {
        $timezone = trim((string) ($quiz->timezone ?? ''));
        if ($timezone === '') {
            $timezone = self::DEFAULT_QUIZ_TIMEZONE;
        }

        return $this->isValidTimezone($timezone) ? $timezone : self::DEFAULT_QUIZ_TIMEZONE;
    }

    private function isValidTimezone(string $timezone): bool
    {
        return in_array($timezone, timezone_identifiers_list(), true);
    }

    private function parseQuizDate($value, ?object $quiz = null): ?Carbon
    {
        if (! $value) {
            return null;
        }

        try {
            return Carbon::parse((string) $value)->setTimezone($this->quizTimezone($quiz));
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function quizAvailabilityForStudent(object $quiz, Carbon $now): array
    {
        $closedAt = $this->parseQuizDate($quiz->closed_at ?? null, $quiz);
        if ($closedAt) {
            return [
                'ok' => false,
                'reason' => 'closed',
                'message' => 'Quiz sudah ditutup oleh guru',
                'code' => 403,
                'starts_at' => $this->parseQuizDate($quiz->starts_at ?? null, $quiz),
                'ends_at' => $closedAt,
            ];
        }

        $startsAt = $this->parseQuizDate($quiz->starts_at ?? null, $quiz);
        if (! $startsAt) {
            return [
                'ok' => false,
                'reason' => 'unscheduled',
                'message' => 'Quiz belum dijadwalkan oleh guru',
                'code' => 403,
                'starts_at' => null,
                'ends_at' => null,
            ];
        }
        if ($now->lt($startsAt)) {
            return [
                'ok' => false,
                'reason' => 'scheduled',
                'message' => 'Quiz belum dimulai',
                'code' => 403,
                'starts_at' => $startsAt,
                'ends_at' => null,
            ];
        }

        if ($this->boolValue($quiz->is_live ?? false)) {
            if (! $quiz->duration_minutes) {
                return [
                    'ok' => false,
                    'reason' => 'duration_missing',
                    'message' => 'Durasi quiz belum diatur guru',
                    'code' => 403,
                    'starts_at' => $startsAt,
                    'ends_at' => null,
                ];
            }

            $liveStart = $this->parseQuizDate($quiz->live_started_at ?: ($quiz->starts_at ?? null), $quiz);
            if (! $liveStart || $now->lt($liveStart)) {
                return [
                    'ok' => false,
                    'reason' => 'scheduled',
                    'message' => 'Quiz ulangan belum dimulai',
                    'code' => 403,
                    'starts_at' => $liveStart ?: $startsAt,
                    'ends_at' => null,
                ];
            }

            $endAt = $liveStart->copy()->addMinutes((int) $quiz->duration_minutes);
            if ($now->gt($endAt)) {
                return [
                    'ok' => false,
                    'reason' => 'ended',
                    'message' => 'Quiz ulangan sudah berakhir',
                    'code' => 403,
                    'starts_at' => $liveStart,
                    'ends_at' => $endAt,
                ];
            }

            return [
                'ok' => true,
                'reason' => 'open',
                'message' => null,
                'code' => 200,
                'starts_at' => $liveStart,
                'ends_at' => $endAt,
            ];
        }

        $deadlineAt = $this->parseQuizDate($quiz->deadline_at ?? null, $quiz);
        if (! $deadlineAt) {
            return [
                'ok' => false,
                'reason' => 'deadline_missing',
                'message' => 'Deadline quiz belum diatur guru',
                'code' => 403,
                'starts_at' => $startsAt,
                'ends_at' => null,
            ];
        }
        if ($now->gt($deadlineAt)) {
            return [
                'ok' => false,
                'reason' => 'ended',
                'message' => 'Quiz sudah melewati batas waktu',
                'code' => 403,
                'starts_at' => $startsAt,
                'ends_at' => $deadlineAt,
            ];
        }

        return [
            'ok' => true,
            'reason' => 'open',
            'message' => null,
            'code' => 200,
            'starts_at' => $startsAt,
            'ends_at' => $deadlineAt,
        ];
    }

    private function quizTimingPayload(object $quiz, Carbon $now): array
    {
        $availability = $this->quizAvailabilityForStudent($quiz, $now);

        return [
            'server_time' => $now->toISOString(),
            'timezone' => $this->quizTimezone($quiz),
            'status' => $availability['reason'] ?? 'open',
            'starts_at' => ($availability['starts_at'] ?? null) instanceof Carbon
                ? $availability['starts_at']->toISOString()
                : null,
            'ends_at' => ($availability['ends_at'] ?? null) instanceof Carbon
                ? $availability['ends_at']->toISOString()
                : null,
        ];
    }

    private function denyIfQuizAccessCodeInvalid(object $quiz, $accessCode)
    {
        $hash = trim((string) ($quiz->access_code_hash ?? ''));
        if ($hash === '') {
            return null;
        }

        $code = trim((string) ($accessCode ?? ''));
        if ($code === '' || ! Hash::check($code, $hash)) {
            return response()->json(['message' => 'Kode akses quiz tidak valid'], 403);
        }

        return null;
    }

    private function denyIfStrictFullscreenMissing(object $quiz, $clientMeta)
    {
        $securityMode = strtolower(trim((string) ($quiz->security_mode ?? 'standard')));
        if ($securityMode !== 'strict') {
            return null;
        }

        $fullscreen = false;
        if (is_array($clientMeta)) {
            $fullscreen = $this->boolValue($clientMeta['fullscreen'] ?? false);
        } elseif (is_object($clientMeta)) {
            $fullscreen = $this->boolValue($clientMeta->fullscreen ?? false);
        }

        if (! $fullscreen) {
            return response()->json([
                'message' => 'Mode strict wajib fullscreen sebelum quiz dimulai.',
            ], 403);
        }

        return null;
    }

    private function createQuizSubmission(string $tenantId, object $quiz, string $siswaId, Carbon $now, $clientMeta = null): array
    {
        $attemptNo = $this->nextAttemptNumber($tenantId, (string) $quiz->id, $siswaId);
        $maxAttempts = $this->normalizePositiveInt($quiz->max_attempts ?? null);
        if ($maxAttempts !== null && $attemptNo > $maxAttempts) {
            return [
                'submission' => null,
                'response' => response()->json(['message' => 'Batas percobaan quiz sudah habis'], 403),
            ];
        }
        $strictSecurityResponse = $this->denyIfStrictFullscreenMissing($quiz, $clientMeta);
        if ($strictSecurityResponse !== null) {
            return [
                'submission' => null,
                'response' => $strictSecurityResponse,
            ];
        }

        $submissionId = (string) Str::uuid();
        $payload = [
            'id' => $submissionId,
            'quiz_id' => (string) $quiz->id,
            'siswa_id' => $siswaId,
            'tenant_id' => $tenantId,
            'started_at' => $now,
            'status' => 'ongoing',
            'created_at' => $now,
            'updated_at' => $now,
        ];
        $payload = array_merge($payload, $this->quizSubmissionAcademicSnapshot($tenantId, $quiz, $siswaId));
        if (Schema::hasColumn('quiz_submissions', 'attempt_no')) {
            $payload['attempt_no'] = $attemptNo;
        }
        if (Schema::hasColumn('quiz_submissions', 'access_granted_at')) {
            $payload['access_granted_at'] = $now;
        }
        if (Schema::hasColumn('quiz_submissions', 'client_meta')) {
            $payload['client_meta'] = $this->encodeJsonOrNull($clientMeta);
        }
        if (Schema::hasColumn('quiz_submissions', 'client_device')) {
            $payload['client_device'] = $this->clientDeviceFromMeta($clientMeta) ?: 'web';
        }

        try {
            DB::table('quiz_submissions')->insert($payload);
        } catch (\Throwable $e) {
            $existing = DB::table('quiz_submissions')
                ->where('tenant_id', $tenantId)
                ->where('quiz_id', $quiz->id)
                ->where('siswa_id', $siswaId)
                ->first();
            if ($existing) {
                return [
                    'submission' => $existing,
                    'response' => null,
                ];
            }

            throw $e;
        }

        return [
            'submission' => DB::table('quiz_submissions')
                ->where('id', $submissionId)
                ->where('tenant_id', $tenantId)
                ->first(),
            'response' => null,
        ];
    }

    private function nextAttemptNumber(string $tenantId, string $quizId, string $siswaId): int
    {
        if (! Schema::hasTable('quiz_retake_logs')) {
            return 1;
        }

        return ((int) DB::table('quiz_retake_logs')
            ->where('tenant_id', $tenantId)
            ->where('quiz_id', $quizId)
            ->where('siswa_id', $siswaId)
            ->count()) + 1;
    }

    private function normalizePositiveInt($value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (! is_numeric($value)) {
            return null;
        }

        $intValue = (int) $value;

        return $intValue > 0 ? $intValue : null;
    }

    private function studentQuizDetail(string $tenantId, object $quiz, object $submission, Carbon $now): array
    {
        $questions = $this->contentCache->questions($tenantId, (string) $quiz->id);
        $questions = $this->normalizeQuestionNumbersForPayload($questions);

        $questionIds = $questions->pluck('id')->map(fn ($id) => (string) $id)->all();
        $optionsByQuestion = [];
        if (! empty($questionIds)) {
            $options = $this->contentCache->options($tenantId, (string) $quiz->id);

            foreach ($options as $option) {
                $qid = (string) $option->question_id;
                $optionsByQuestion[$qid] = $optionsByQuestion[$qid] ?? [];
                $optionsByQuestion[$qid][] = $option;
            }
        }

        $order = $this->decodeAnswerOrder($submission->answer_order ?? null);
        if (! $order) {
            $order = $this->buildAnswerOrder($quiz, (string) $submission->id, $questions, $optionsByQuestion);
            if (Schema::hasColumn('quiz_submissions', 'answer_order')) {
                DB::table('quiz_submissions')
                    ->where('id', $submission->id)
                    ->where('tenant_id', $tenantId)
                    ->update([
                        'answer_order' => $this->encodeJsonOrNull($order),
                        'updated_at' => $now,
                    ]);
                $submission->answer_order = $this->encodeJsonOrNull($order);
            }
        }

        return $this->studentQuizPayload($questions, $optionsByQuestion, $order);
    }

    private function decodeAnswerOrder($value): ?array
    {
        if (! $value) {
            return null;
        }
        if (is_string($value)) {
            $decoded = json_decode($value, true);
            if (! is_array($decoded)) {
                return null;
            }
            $value = $decoded;
        } elseif ($value instanceof \stdClass) {
            $value = json_decode(json_encode($value), true);
        }
        if (! is_array($value)) {
            return null;
        }

        $questions = array_values(array_filter(array_map('strval', $value['questions'] ?? [])));
        $options = [];
        foreach (($value['options'] ?? []) as $questionId => $optionIds) {
            if (! is_array($optionIds)) {
                continue;
            }
            $options[(string) $questionId] = array_values(array_filter(array_map('strval', $optionIds)));
        }

        return [
            'questions' => $questions,
            'options' => $options,
        ];
    }

    private function buildAnswerOrder(object $quiz, string $submissionId, $questions, array $optionsByQuestion): array
    {
        $mcqQuestionIds = [];
        $essayQuestionIds = [];
        foreach ($questions as $question) {
            $id = (string) $question->id;
            if ($this->normalizeQuestionType($question->question_type ?? null) === 'essay') {
                $essayQuestionIds[] = $id;
            } else {
                $mcqQuestionIds[] = $id;
            }
        }

        if ($this->boolValue($quiz->shuffle_questions ?? false)) {
            usort($mcqQuestionIds, fn ($a, $b) => strcmp(
                $this->stableOrderKey($submissionId, 'question', $a),
                $this->stableOrderKey($submissionId, 'question', $b)
            ));
        }

        $options = [];
        foreach ($optionsByQuestion as $questionId => $rows) {
            $optionIds = array_map(fn ($row) => (string) $row->id, $rows);
            if ($this->boolValue($quiz->shuffle_options ?? false)) {
                usort($optionIds, fn ($a, $b) => strcmp(
                    $this->stableOrderKey($submissionId, 'option', $a),
                    $this->stableOrderKey($submissionId, 'option', $b)
                ));
            }
            $options[(string) $questionId] = $optionIds;
        }

        return [
            'questions' => array_values(array_merge($mcqQuestionIds, $essayQuestionIds)),
            'options' => $options,
        ];
    }

    private function stableOrderKey(string $submissionId, string $scope, string $value): string
    {
        return hash_hmac(
            'sha256',
            $scope.'|'.$submissionId.'|'.$value,
            (string) config('app.key', 'edusmart-quiz')
        );
    }

    private function studentQuizPayload($questions, array $optionsByQuestion, array $order): array
    {
        $questionMap = [];
        foreach ($questions as $question) {
            $questionMap[(string) $question->id] = $question;
        }

        $orderedQuestionIds = array_values(array_filter(array_map('strval', $order['questions'] ?? [])));
        $orderedMcqIds = [];
        $seenQuestions = [];
        foreach ($orderedQuestionIds as $questionId) {
            if (! isset($questionMap[$questionId])) {
                continue;
            }
            if ($this->normalizeQuestionType($questionMap[$questionId]->question_type ?? null) === 'essay') {
                continue;
            }
            $seenQuestions[$questionId] = true;
            $orderedMcqIds[] = $questionId;
        }
        foreach ($questions as $question) {
            $questionId = (string) $question->id;
            if (isset($seenQuestions[$questionId])) {
                continue;
            }
            if ($this->normalizeQuestionType($question->question_type ?? null) !== 'essay') {
                $seenQuestions[$questionId] = true;
                $orderedMcqIds[] = $questionId;
            }
        }
        $essayIds = [];
        foreach ($questions as $question) {
            $questionId = (string) $question->id;
            if ($this->normalizeQuestionType($question->question_type ?? null) === 'essay') {
                $seenQuestions[$questionId] = true;
                $essayIds[] = $questionId;
            }
        }

        $orderedQuestions = [];
        foreach (array_merge($orderedMcqIds, $essayIds) as $questionId) {
            if (! isset($questionMap[$questionId])) {
                continue;
            }
            $orderedQuestions[] = $this->questionPayload($questionMap[$questionId]);
        }
        foreach ($questions as $question) {
            $questionId = (string) $question->id;
            if (isset($seenQuestions[$questionId])) {
                continue;
            }
            $orderedQuestions[] = $this->questionPayload($question);
        }

        $optionPayload = [];
        foreach ($optionsByQuestion as $questionId => $rows) {
            $optionMap = [];
            foreach ($rows as $row) {
                $optionMap[(string) $row->id] = $row;
            }

            $seenOptions = [];
            $orderedOptions = [];
            foreach (($order['options'][$questionId] ?? []) as $optionId) {
                if (! isset($optionMap[$optionId])) {
                    continue;
                }
                $seenOptions[$optionId] = true;
                $orderedOptions[] = $optionMap[$optionId];
            }
            foreach ($rows as $row) {
                $optionId = (string) $row->id;
                if (isset($seenOptions[$optionId])) {
                    continue;
                }
                $orderedOptions[] = $row;
            }

            $optionPayload[$questionId] = [];
            foreach ($orderedOptions as $index => $option) {
                $payload = (array) $option;
                unset($payload['is_correct'], $payload['tenant_id']);
                $payload['label'] = $this->displayOptionLabel($index);
                $optionPayload[$questionId][] = $payload;
            }
        }

        return [
            'questions' => $orderedQuestions,
            'options_by_question' => $optionPayload,
            'order' => $order,
        ];
    }

    private function questionPayload(object $question): array
    {
        $payload = (array) $question;
        unset($payload['tenant_id']);

        return $payload;
    }

    private function displayOptionLabel(int $index): string
    {
        if ($index >= 0 && $index < 26) {
            return chr(65 + $index);
        }

        return (string) ($index + 1);
    }

    private function submissionPayload(object $submission): array
    {
        $payload = (array) $submission;
        if (isset($payload['answer_order'])) {
            $decoded = $this->decodeAnswerOrder($payload['answer_order']);
            $payload['answer_order'] = $decoded ?: null;
        }
        if (isset($payload['client_meta']) && is_string($payload['client_meta'])) {
            $decoded = json_decode($payload['client_meta'], true);
            $payload['client_meta'] = is_array($decoded) ? $decoded : null;
        }

        return $payload;
    }

    private function storeSubmittedAnswers(string $tenantId, string $quizId, string $submissionId, array $answers, Carbon $now)
    {
        $stored = $this->storeSubmissionAnswersBatch($tenantId, $quizId, $submissionId, $answers, $now);
        if (! $stored['ok']) {
            return response()->json(['message' => $stored['message']], $stored['code']);
        }

        return null;
    }

    private function storeSubmissionAnswersBatch(
        string $tenantId,
        string $quizId,
        string $submissionId,
        array $answers,
        Carbon $now
    ): array {
        $normalizedRows = [];
        foreach ($answers as $row) {
            if (! is_array($row)) {
                return [
                    'ok' => false,
                    'message' => 'Format salah satu jawaban tidak valid',
                    'code' => 422,
                ];
            }

            $questionId = trim((string) ($row['question_id'] ?? ''));
            if ($questionId === '') {
                return [
                    'ok' => false,
                    'message' => 'question_id wajib diisi pada setiap jawaban',
                    'code' => 422,
                ];
            }

            // Jawaban terbaru untuk soal yang sama menang agar retry batch tetap idempotent.
            $normalizedRows[$questionId] = [
                'question_id' => $questionId,
                'option_id' => $row['option_id'] ?? null,
                'essay_answer' => $row['essay_answer'] ?? null,
            ];
        }

        if (empty($normalizedRows)) {
            return [
                'ok' => false,
                'message' => 'Tidak ada jawaban valid untuk disimpan',
                'code' => 422,
            ];
        }

        $questionIds = array_keys($normalizedRows);
        $questions = $this->contentCache
            ->questions($tenantId, $quizId)
            ->whereIn('id', $questionIds)
            ->keyBy(fn ($question) => (string) $question->id);

        if ($questions->count() !== count($questionIds)) {
            return [
                'ok' => false,
                'message' => 'Salah satu soal tidak valid untuk quiz ini',
                'code' => 422,
            ];
        }

        $candidateOptionIds = [];
        foreach ($normalizedRows as $row) {
            $question = $questions->get($row['question_id']);
            if ($this->normalizeQuestionType($question->question_type ?? null) !== 'mcq') {
                continue;
            }
            if (is_array($row['option_id']) || is_object($row['option_id'])) {
                return [
                    'ok' => false,
                    'message' => 'Pilihan jawaban tidak valid',
                    'code' => 422,
                ];
            }
            $candidate = trim((string) ($row['option_id'] ?? ''));
            if ($candidate !== '') {
                $candidateOptionIds[] = $candidate;
            }
        }

        $validOptions = empty($candidateOptionIds)
            ? collect()
            : $this->contentCache
                ->options($tenantId, $quizId)
                ->whereIn('id', array_values(array_unique($candidateOptionIds)))
                ->whereIn('question_id', $questionIds)
                ->keyBy(fn ($option) => (string) $option->id);

        $existingIds = DB::table('quiz_answers')
            ->where('tenant_id', $tenantId)
            ->where('submission_id', $submissionId)
            ->whereIn('question_id', $questionIds)
            ->pluck('id', 'question_id')
            ->mapWithKeys(fn ($id, $questionId) => [(string) $questionId => (string) $id])
            ->all();

        $hasEssayAnswer = Schema::hasColumn('quiz_answers', 'essay_answer');
        $hasSavedAt = Schema::hasColumn('quiz_answers', 'saved_at');
        $upsertRows = [];
        foreach ($normalizedRows as $questionId => $row) {
            $question = $questions->get($questionId);
            $questionType = $this->normalizeQuestionType($question->question_type ?? null);
            $optionId = null;
            $essayAnswer = null;

            if ($questionType === 'essay') {
                if (is_array($row['option_id']) || is_object($row['option_id']) || trim((string) ($row['option_id'] ?? '')) !== '') {
                    return [
                        'ok' => false,
                        'message' => 'Jawaban esai tidak boleh memakai opsi pilihan',
                        'code' => 422,
                    ];
                }
                if (is_array($row['essay_answer']) || is_object($row['essay_answer'])) {
                    return [
                        'ok' => false,
                        'message' => 'Jawaban esai tidak valid',
                        'code' => 422,
                    ];
                }
                $essayText = trim((string) ($row['essay_answer'] ?? ''));
                $essayAnswer = $essayText === '' ? null : $essayText;
            } else {
                if (is_array($row['essay_answer']) || is_object($row['essay_answer']) || trim((string) ($row['essay_answer'] ?? '')) !== '') {
                    return [
                        'ok' => false,
                        'message' => 'Jawaban pilihan ganda tidak menerima jawaban esai',
                        'code' => 422,
                    ];
                }
                $candidateOptionId = trim((string) ($row['option_id'] ?? ''));
                if ($candidateOptionId !== '') {
                    $option = $validOptions->get($candidateOptionId);
                    if (! $option || (string) $option->question_id !== $questionId) {
                        return [
                            'ok' => false,
                            'message' => 'Pilihan jawaban tidak valid',
                            'code' => 422,
                        ];
                    }
                    $optionId = $candidateOptionId;
                }
            }

            $answerId = $existingIds[$questionId] ?? (string) Str::uuid();
            $payload = [
                'id' => $answerId,
                'tenant_id' => $tenantId,
                'submission_id' => $submissionId,
                'question_id' => $questionId,
                'option_id' => $optionId,
                'created_at' => $now,
                'updated_at' => $now,
            ];
            if ($hasEssayAnswer) {
                $payload['essay_answer'] = $essayAnswer;
            }
            if ($hasSavedAt) {
                $payload['saved_at'] = $now;
            }
            $upsertRows[] = $payload;
        }

        $updateColumns = ['option_id', 'updated_at'];
        if ($hasEssayAnswer) {
            $updateColumns[] = 'essay_answer';
        }
        if ($hasSavedAt) {
            $updateColumns[] = 'saved_at';
        }

        DB::transaction(function () use ($upsertRows, $updateColumns, $submissionId, $tenantId, $now) {
            DB::table('quiz_answers')->upsert(
                $upsertRows,
                ['submission_id', 'question_id'],
                $updateColumns
            );

            $submissionUpdates = ['updated_at' => $now];
            if (Schema::hasColumn('quiz_submissions', 'last_saved_at')) {
                $submissionUpdates['last_saved_at'] = $now;
            }
            DB::table('quiz_submissions')
                ->where('id', $submissionId)
                ->where('tenant_id', $tenantId)
                ->update($submissionUpdates);
        });

        $storedAnswers = DB::table('quiz_answers')
            ->where('tenant_id', $tenantId)
            ->where('submission_id', $submissionId)
            ->whereIn('question_id', $questionIds)
            ->get(['id', 'question_id'])
            ->map(fn ($answer) => [
                'answer_id' => (string) $answer->id,
                'question_id' => (string) $answer->question_id,
            ])
            ->values()
            ->all();

        return [
            'ok' => true,
            'answers' => $storedAnswers,
        ];
    }

    private function storeSubmissionAnswer(
        string $tenantId,
        string $quizId,
        string $submissionId,
        string $questionId,
        $optionIdRaw,
        $essayAnswerRaw,
        Carbon $now,
        $providedAnswerId = null
    ): array {
        $question = DB::table('quiz_questions')
            ->where('id', $questionId)
            ->where('quiz_id', $quizId)
            ->where('tenant_id', $tenantId)
            ->first();
        if (! $question) {
            return [
                'ok' => false,
                'message' => 'Soal tidak valid untuk quiz ini',
                'code' => 422,
            ];
        }

        $optionId = null;
        $essayAnswer = null;
        $questionType = $this->normalizeQuestionType($question->question_type ?? null);

        if ($questionType === 'essay') {
            if (is_array($optionIdRaw) || is_object($optionIdRaw)) {
                return [
                    'ok' => false,
                    'message' => 'Jawaban esai tidak boleh memakai opsi pilihan',
                    'code' => 422,
                ];
            }
            if ($optionIdRaw !== null && trim((string) $optionIdRaw) !== '') {
                return [
                    'ok' => false,
                    'message' => 'Jawaban esai tidak boleh memakai opsi pilihan',
                    'code' => 422,
                ];
            }
            if (is_array($essayAnswerRaw) || is_object($essayAnswerRaw)) {
                return [
                    'ok' => false,
                    'message' => 'Jawaban esai tidak valid',
                    'code' => 422,
                ];
            }
            $essayText = trim((string) ($essayAnswerRaw ?? ''));
            $essayAnswer = $essayText === '' ? null : $essayText;
        } else {
            if (is_array($essayAnswerRaw) || is_object($essayAnswerRaw)) {
                return [
                    'ok' => false,
                    'message' => 'Jawaban pilihan ganda tidak menerima jawaban esai',
                    'code' => 422,
                ];
            }
            if ($essayAnswerRaw !== null && trim((string) $essayAnswerRaw) !== '') {
                return [
                    'ok' => false,
                    'message' => 'Jawaban pilihan ganda tidak menerima jawaban esai',
                    'code' => 422,
                ];
            }
            if (is_array($optionIdRaw) || is_object($optionIdRaw)) {
                return [
                    'ok' => false,
                    'message' => 'Pilihan jawaban tidak valid',
                    'code' => 422,
                ];
            }

            $candidateOptionId = trim((string) ($optionIdRaw ?? ''));
            if ($candidateOptionId !== '') {
                $optionExists = DB::table('quiz_options')
                    ->where('id', $candidateOptionId)
                    ->where('question_id', $questionId)
                    ->where('tenant_id', $tenantId)
                    ->exists();
                if (! $optionExists) {
                    return [
                        'ok' => false,
                        'message' => 'Pilihan jawaban tidak valid',
                        'code' => 422,
                    ];
                }
                $optionId = $candidateOptionId;
            }
        }

        $existing = DB::table('quiz_answers')
            ->where('tenant_id', $tenantId)
            ->where('submission_id', $submissionId)
            ->where('question_id', $questionId)
            ->first(['id']);

        $payload = [
            'option_id' => $optionId,
            'tenant_id' => $tenantId,
            'updated_at' => $now,
        ];
        if (Schema::hasColumn('quiz_answers', 'essay_answer')) {
            $payload['essay_answer'] = $essayAnswer;
        }
        if (Schema::hasColumn('quiz_answers', 'saved_at')) {
            $payload['saved_at'] = $now;
        }

        if ($existing) {
            DB::table('quiz_answers')
                ->where('id', $existing->id)
                ->where('tenant_id', $tenantId)
                ->update($payload);

            return [
                'ok' => true,
                'answer_id' => (string) $existing->id,
            ];
        }

        $answerId = trim((string) ($providedAnswerId ?? ''));
        if ($answerId === '' || DB::table('quiz_answers')->where('id', $answerId)->where('tenant_id', $tenantId)->exists()) {
            $answerId = (string) Str::uuid();
        }

        DB::table('quiz_answers')->insert(array_merge($payload, [
            'id' => $answerId,
            'submission_id' => $submissionId,
            'question_id' => $questionId,
            'created_at' => $now,
        ]));

        return [
            'ok' => true,
            'answer_id' => $answerId,
        ];
    }

    private function boolValue($value): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if (is_int($value)) {
            return $value === 1;
        }

        return filter_var($value, FILTER_VALIDATE_BOOLEAN);
    }

    private function encodeJsonOrNull($value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        $json = json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        return $json === false ? null : $json;
    }

    private function metaStringValue($meta, string $key): string
    {
        if (is_string($meta)) {
            $decoded = json_decode($meta, true);
            $meta = is_array($decoded) ? $decoded : null;
        }

        if (is_array($meta)) {
            return trim((string) ($meta[$key] ?? ''));
        }

        if (is_object($meta)) {
            return trim((string) ($meta->{$key} ?? ''));
        }

        return '';
    }

    private function quizPayload(?object $quiz): ?array
    {
        if (! $quiz) {
            return null;
        }

        $payload = (array) $quiz;
        if (array_key_exists('access_device', $payload)) {
            $payload['access_device'] = 'web';
        } else {
            $payload['access_device'] = 'web';
        }
        $payload['has_access_code'] = trim((string) ($payload['access_code_hash'] ?? '')) !== '';
        unset($payload['access_code_hash']);

        return $payload;
    }

    private function filterTablePayload(string $table, array $payload): array
    {
        if (! Schema::hasTable($table)) {
            return $payload;
        }

        return collect($payload)
            ->filter(fn ($value, $column) => Schema::hasColumn($table, $column))
            ->all();
    }

    private function generateQuizCloneCode(): ?string
    {
        if (! Schema::hasColumn('quizzes', 'clone_code')) {
            return null;
        }

        for ($i = 0; $i < 20; $i++) {
            $code = 'QZ-'.strtoupper(Str::random(6));
            if (! DB::table('quizzes')->where('clone_code', $code)->exists()) {
                return $code;
            }
        }

        return 'QZ-'.strtoupper(Str::random(10));
    }

    private function resolveQuizForTeacherAction(Request $request, string $tenantId, string $quizId): ?object
    {
        $query = DB::table('quizzes')
            ->where('id', $quizId)
            ->where('tenant_id', $tenantId);

        if ($this->isGuru($request) && ! $this->isAdmin($request)) {
            $query->where('guru_id', $request->user()?->id);
        }

        return $query->first();
    }

    private function resolveQuizForRetake(Request $request, string $tenantId, string $quizId): ?object
    {
        $query = DB::table('quizzes')
            ->where('id', $quizId)
            ->where('tenant_id', $tenantId);

        if ($this->isGuru($request) && ! $this->isAdmin($request)) {
            $query->where('guru_id', $request->user()?->id);
        }

        return $query->first(['id', 'guru_id', 'kelas_id', 'nama']);
    }

    private function normalizeQuestionNumbersForPayload($questions)
    {
        return $questions->values()->map(function ($question, int $index) {
            $question->nomor = $index + 1;

            return $question;
        });
    }

    private function normalizeQuestionType($value): string
    {
        $type = strtolower(trim((string) ($value ?? 'mcq')));
        if (! in_array($type, ['mcq', 'essay'], true)) {
            return 'mcq';
        }

        return $type;
    }
}
