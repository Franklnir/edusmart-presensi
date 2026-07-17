<?php

use App\Http\Controllers\Api\V2\AcademicContextController;
use App\Http\Controllers\Api\V2\AdminDashboardController;
use App\Http\Controllers\Api\V2\AnnouncementController;
use App\Http\Controllers\Api\V2\AssignmentController;
use App\Http\Controllers\Api\V2\AttachmentController;
use App\Http\Controllers\Api\V2\AttendanceController;
use App\Http\Controllers\Api\V2\AttendanceRequestController;
use App\Http\Controllers\Api\V2\AttendanceScannerController;
use App\Http\Controllers\Api\V2\CertificateController;
use App\Http\Controllers\Api\V2\CertificateTemplateController;
use App\Http\Controllers\Api\V2\ClassController;
use App\Http\Controllers\Api\V2\CurrentProfileController;
use App\Http\Controllers\Api\V2\ExtracurricularController;
use App\Http\Controllers\Api\V2\FrontendLogController;
use App\Http\Controllers\Api\V2\GradeController;
use App\Http\Controllers\Api\V2\JamKosongController;
use App\Http\Controllers\Api\V2\OrganizationContextController;
use App\Http\Controllers\Api\V2\QuizAttemptController;
use App\Http\Controllers\Api\V2\QuizController;
use App\Http\Controllers\Api\V2\QuizPresenceController;
use App\Http\Controllers\Api\V2\QuizQuestionController;
use App\Http\Controllers\Api\V2\QuizSubmissionController;
use App\Http\Controllers\Api\V2\ReportCardController;
use App\Http\Controllers\Api\V2\ScheduleController;
use App\Http\Controllers\Api\V2\StudentController;
use App\Http\Controllers\Api\V2\SubjectController;
use App\Http\Controllers\Api\V2\SubmissionController;
use App\Http\Controllers\Api\V2\TeacherController;
use App\Http\Controllers\Api\V2\TeacherDashboardController;
use App\Http\Controllers\Api\V2\TeacherReportController;
use App\Http\Controllers\Api\V2\UploadController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API V2 Routes
|--------------------------------------------------------------------------
|
| Here is where you can register API V2 routes for your application.
| These routes are loaded by the RouteServiceProvider and all of them will
| be assigned to the "api", "auth:sanctum", and "tenant" middleware groups.
|
*/

Route::post('/frontend-logs', [FrontendLogController::class, 'store'])
    ->middleware('throttle:frontend-logs')
    ->withoutMiddleware(['auth:sanctum']);

Route::middleware('throttle:api')->group(function () {
    Route::get('/frontend-logs', [FrontendLogController::class, 'index']);
    Route::get('/academic-context', [AcademicContextController::class, 'show'])->name('academic-context.show');
    Route::get('/organization-context', [OrganizationContextController::class, 'show'])->name('organization-context.show');
    Route::get('/profile', [CurrentProfileController::class, 'show'])->name('profile.show');
    Route::post('/profile/provision', [CurrentProfileController::class, 'provision'])->name('profile.provision');
    Route::patch('/profile', [CurrentProfileController::class, 'update'])->name('profile.update');
    Route::get('/dashboard/admin', [AdminDashboardController::class, 'show'])->name('dashboard.admin.show');
    Route::get('/grades/weights', [GradeController::class, 'weights'])->name('grades.weights.index');
    Route::put('/grades/weights', [GradeController::class, 'upsertWeights'])->name('grades.weights.upsert');
    Route::get('/grades/manual-scores', [GradeController::class, 'manualScores'])->name('grades.manual-scores.index');
    Route::put('/grades/manual-scores', [GradeController::class, 'upsertManualScore'])->name('grades.manual-scores.upsert');

    Route::get('academic-periods', [AcademicPeriodController::class, 'index'])->name('academic-periods.index');
    Route::post('academic-periods/preview', [AcademicPeriodController::class, 'preview'])->name('academic-periods.preview');
    Route::post('academic-periods/apply', [AcademicPeriodController::class, 'apply'])->name('academic-periods.apply');
    Route::post('academic-periods/restore-roster', [AcademicPeriodController::class, 'restoreRoster'])->name('academic-periods.restore-roster');
    Route::post('academic-periods/copy-structure', [AcademicPeriodController::class, 'copyStructure'])->name('academic-periods.copy-structure');
    Route::get('academic-periods/schedule-decision', [AcademicPeriodController::class, 'scheduleDecisionStatus'])->name('academic-periods.schedule-decision.status');
    Route::post('academic-periods/schedule-decision', [AcademicPeriodController::class, 'resolveScheduleDecision'])->name('academic-periods.schedule-decision.resolve');
    Route::get('academic-rollover-exceptions', [AcademicPeriodController::class, 'rolloverExceptions'])->name('academic-rollover-exceptions.index');
    Route::put('academic-rollover-exceptions', [AcademicPeriodController::class, 'replaceRolloverExceptions'])->name('academic-rollover-exceptions.replace');
    Route::post('academic-periods/correction-sessions', [AcademicPeriodController::class, 'createCorrectionSession'])->name('academic-periods.correction-sessions.store');
    Route::delete('academic-periods/correction-sessions/{session}', [AcademicPeriodController::class, 'closeCorrectionSession'])->name('academic-periods.correction-sessions.destroy');
    Route::apiResource('announcements', AnnouncementController::class)->except(['show', 'create', 'edit']);

    Route::get('classes/organisasi-bootstrap', [ClassController::class, 'organisasiBootstrap'])->name('classes.organisasi-bootstrap');
    Route::get('classes/struktur-bootstrap', [ClassController::class, 'strukturBootstrap'])->name('classes.struktur-bootstrap');
    Route::apiResource('classes', ClassController::class);
    Route::get('classes/{class}/structure', [ClassController::class, 'getStructure'])->name('classes.structure.show');
    Route::put('classes/{class}/structure', [ClassController::class, 'updateStructure'])->name('classes.structure.update');
    Route::get('students/options', [StudentController::class, 'options'])->name('students.options');
    Route::apiResource('students', StudentController::class)->except(['destroy']);
    Route::patch('students/{student}/deactivate', [StudentController::class, 'deactivate'])->name('students.deactivate');
    Route::patch('students/{student}/activate', [StudentController::class, 'activate'])->name('students.activate');
    Route::apiResource('teachers', TeacherController::class);
    Route::get('teachers/options', [TeacherController::class, 'options'])->name('teachers.options');
    Route::apiResource('schedules', ScheduleController::class);
    Route::post('attendance/scanner/bulk', [AttendanceScannerController::class, 'bulkStore'])->name('attendance.scanner.bulk');
    Route::post('attendance/scanner/temp', [AttendanceScannerController::class, 'storeTemp'])->name('attendance.scanner.temp');
    Route::apiResource('attendance', AttendanceController::class)->except(['destroy']);
    Route::get('attendance-requests', [AttendanceRequestController::class, 'index'])->name('attendance-requests.index');
    Route::post('attendance-requests', [AttendanceRequestController::class, 'store'])->name('attendance-requests.store');
    Route::patch('attendance-requests/{attendance_request}', [AttendanceRequestController::class, 'update'])->name('attendance-requests.update');
    Route::delete('attendance-requests/{attendance_request}', [AttendanceRequestController::class, 'destroy'])->name('attendance-requests.destroy');
    Route::apiResource('assignments', AssignmentController::class);
    Route::apiResource('submissions', SubmissionController::class);
    Route::patch('submissions/{submission}/grade', [SubmissionController::class, 'grade'])->name('submissions.grade');
    Route::post('submissions/grade-by-user', [SubmissionController::class, 'gradeByUser'])->name('submissions.grade-by-user');

    Route::post('uploads', [UploadController::class, 'store'])->name('uploads.store');
    Route::get('uploads/{session}', [UploadController::class, 'show'])->name('uploads.show');
    Route::post('uploads/{session}/complete', [UploadController::class, 'complete'])->name('uploads.complete');
    Route::delete('uploads/{session}', [UploadController::class, 'destroy'])->name('uploads.destroy');
    Route::get('attachments/{attachment}', [AttachmentController::class, 'show'])->name('attachments.show');
    Route::post('storage/signed-url', [AttachmentController::class, 'signedUrl'])->name('storage.signed-url');
    Route::get('attachments/{attachment}/download', [AttachmentController::class, 'download'])->name('attachments.download');
    Route::delete('attachments/{attachment}', [AttachmentController::class, 'destroy'])->name('attachments.destroy');

    Route::get('report-cards', [ReportCardController::class, 'index'])->name('report-cards.index');
    Route::get('report-cards/{student}', [ReportCardController::class, 'show'])->name('report-cards.show');
    Route::get('report-cards/{student}/preview', [ReportCardController::class, 'preview'])->name('report-cards.preview');
    Route::put('report-cards/{student}/metadata', [ReportCardController::class, 'updateMetadata'])->name('report-cards.metadata.update');
    Route::put('report-cards/{student}/items', [ReportCardController::class, 'upsertItem'])->name('report-cards.items.upsert');
    Route::post('report-cards/{student}/finalize', [ReportCardController::class, 'finalize'])->name('report-cards.finalize');
    Route::post('report-cards/{student}/publish', [ReportCardController::class, 'publish'])->name('report-cards.publish');
    Route::post('report-cards/{student}/reopen', [ReportCardController::class, 'reopen'])->name('report-cards.reopen');
    Route::get('report-cards/{student}/print', [ReportCardController::class, 'print'])->name('report-cards.print');

    // Extracurriculars
    Route::get('extracurriculars', [ExtracurricularController::class, 'index'])->name('extracurriculars.index');
    Route::post('extracurriculars', [ExtracurricularController::class, 'store'])->name('extracurriculars.store');
    Route::get('extracurriculars/{extracurricular}', [ExtracurricularController::class, 'show'])->name('extracurriculars.show');
    Route::put('extracurriculars/{extracurricular}', [ExtracurricularController::class, 'update'])->name('extracurriculars.update');
    Route::delete('extracurriculars/{extracurricular}', [ExtracurricularController::class, 'destroy'])->name('extracurriculars.destroy');
    Route::get('extracurriculars/{extracurricular}/members', [ExtracurricularController::class, 'members'])->name('extracurriculars.members');
    Route::post('extracurriculars/{extracurricular}/join', [ExtracurricularController::class, 'join'])->name('extracurriculars.join');
    Route::delete('extracurriculars/{extracurricular}/leave', [ExtracurricularController::class, 'leave'])->name('extracurriculars.leave');

    // Certificates
    Route::get('certificates', [CertificateController::class, 'index'])->name('certificates.index');
    Route::post('certificates', [CertificateController::class, 'store'])->name('certificates.store');
    Route::get('certificates/{certificate}', [CertificateController::class, 'show'])->name('certificates.show');
    Route::put('certificates/{certificate}', [CertificateController::class, 'update'])->name('certificates.update');
    Route::delete('certificates/{certificate}', [CertificateController::class, 'destroy'])->name('certificates.destroy');

    // Certificate Templates
    Route::get('certificate-templates', [CertificateTemplateController::class, 'index'])->name('certificate-templates.index');
    Route::post('certificate-templates', [CertificateTemplateController::class, 'store'])->name('certificate-templates.store');
    Route::get('certificate-templates/{template}', [CertificateTemplateController::class, 'show'])->name('certificate-templates.show');
    Route::put('certificate-templates/{template}', [CertificateTemplateController::class, 'update'])->name('certificate-templates.update');
    Route::delete('certificate-templates/{template}', [CertificateTemplateController::class, 'destroy'])->name('certificate-templates.destroy');

    // Subjects & Jam Kosong
    Route::apiResource('subjects', SubjectController::class)->except(['create', 'edit']);
    Route::apiResource('jam-kosong', JamKosongController::class)->except(['create', 'edit', 'update', 'show']);

    Route::get('quizzes', [QuizController::class, 'index'])->name('quizzes.index');
    Route::post('quizzes', [QuizController::class, 'store'])->name('quizzes.store');
    Route::post('quizzes/clone', [QuizController::class, 'cloneQuiz'])->name('quizzes.clone');
    Route::post('quizzes/grade-by-user', [QuizSubmissionController::class, 'gradeByUser'])->name('quizzes.grade-by-user');
    Route::get('quizzes/{quiz}', [QuizController::class, 'show'])->name('quizzes.show');
    Route::patch('quizzes/{quiz}', [QuizController::class, 'update'])->name('quizzes.update');
    Route::delete('quizzes/{quiz}', [QuizController::class, 'destroy'])->name('quizzes.destroy');
    Route::post('quizzes/{quiz}/publish', [QuizController::class, 'publishQuiz'])->name('quizzes.publish');
    Route::post('quizzes/{quiz}/schedule', [QuizController::class, 'scheduleQuiz'])->name('quizzes.schedule');
    Route::post('quizzes/{quiz}/close', [QuizController::class, 'closeQuiz'])->name('quizzes.close');
    Route::post('quizzes/{quiz}/archive', [QuizController::class, 'archiveQuiz'])->name('quizzes.archive');
    Route::get('quizzes/{quiz}/participants', [QuizController::class, 'participants'])->name('quizzes.participants');
    Route::get('quizzes/{quiz}/retake-history', [QuizController::class, 'retakeHistoryV2'])->name('quizzes.retake-history');
    Route::get('quizzes/{quiz}/attempts/{attempt}', [QuizController::class, 'attemptAnswers'])->name('quizzes.attempts.show');

    Route::get('quizzes/{quiz}/questions', [QuizQuestionController::class, 'index'])->name('quizzes.questions.index');
    Route::post('quiz-questions', [QuizQuestionController::class, 'store'])->name('quiz-questions.store');
    Route::patch('quiz-questions/{question}', [QuizQuestionController::class, 'update'])->name('quiz-questions.update');
    Route::delete('quiz-questions/{question}', [QuizQuestionController::class, 'destroy'])->name('quiz-questions.destroy');

    Route::post('quizzes/{quiz}/attempts/start', [QuizAttemptController::class, 'start'])->name('quizzes.attempts.start');
    Route::post('quizzes/{quiz}/attempts/{attempt}/answer', [QuizAttemptController::class, 'answer'])->name('quizzes.attempts.answer');
    Route::post('quizzes/{quiz}/attempts/{attempt}/answers/batch', [QuizAttemptController::class, 'batch'])->name('quizzes.attempts.answers.batch');
    Route::post('quizzes/{quiz}/attempts/{attempt}/submit', [QuizAttemptController::class, 'submit'])->name('quizzes.attempts.submit');
    Route::post('quizzes/{quiz}/attempts/{attempt}/violations', [QuizAttemptController::class, 'violation'])->name('quizzes.attempts.violations');
    Route::post('quizzes/{quiz}/attempts/{attempt}/essay/grade', [QuizAttemptController::class, 'gradeEssay'])->name('quizzes.attempts.essay.grade');
    Route::post('quizzes/{quiz}/attempts/{attempt}/essay/complete', [QuizAttemptController::class, 'completeEssayReview'])->name('quizzes.attempts.essay.complete');
    Route::post('quizzes/{quiz}/retakes', [QuizAttemptController::class, 'retake'])->name('quizzes.retakes.store');
    Route::post('quizzes/{quiz}/retakes/restore', [QuizAttemptController::class, 'restoreRetakeScore'])->name('quizzes.retakes.restore');
    Route::post('quiz-presence/ping', [QuizPresenceController::class, 'ping'])->name('quiz-presence.ping');

    Route::get('reports/homeroom-options', [TeacherReportController::class, 'homeroomOptions'])->name('reports.homeroom-options');
    Route::get('reports/teacher-summary', [TeacherReportController::class, 'teacherSummary'])->name('reports.teacher-summary');
    Route::get('reports/attendance-summary', [TeacherReportController::class, 'attendanceSummary'])->name('reports.attendance-summary');
    Route::get('reports/task-summary', [TeacherReportController::class, 'taskSummary'])->name('reports.task-summary');
    Route::get('reports/quiz-summary', [TeacherReportController::class, 'quizSummaryEndpoint'])->name('reports.quiz-summary');
    Route::get('reports/homeroom-summary', [TeacherReportController::class, 'homeroomSummary'])->name('reports.homeroom-summary');
    Route::get('reports/dashboard-aggregate', [TeacherDashboardController::class, 'dashboardAggregate'])->name('reports.dashboard-aggregate');
});
