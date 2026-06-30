<?php

use App\Http\Controllers\Api\AdminBackupController;
use App\Http\Controllers\Api\AdminController;
use App\Http\Controllers\Api\AdminFeaturePermissionController;
use App\Http\Controllers\Api\AttendanceQrController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\ClassHistoryController;
use App\Http\Controllers\Api\DbController;
use App\Http\Controllers\Api\GoogleDriveController;
use App\Http\Controllers\Api\InfrastructureController;
use App\Http\Controllers\Api\JadwalController;
use App\Http\Controllers\Api\MobileController;
use App\Http\Controllers\Api\MobileDirectoryController;
use App\Http\Controllers\Api\PresenceController;
use App\Http\Controllers\Api\ProfileController;
use App\Http\Controllers\Api\PublicSettingsController;
use App\Http\Controllers\Api\QuizController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\RfidController;
use App\Http\Controllers\Api\SettingsController;
use App\Http\Controllers\Api\StorageController;
use App\Http\Controllers\Api\StorageManagementController;
use App\Http\Controllers\Api\SuperAdminController;
use App\Http\Controllers\Api\SuperLogController;
use App\Http\Controllers\Api\TugasController;
use App\Http\Controllers\Api\WhatsAppController;
use App\Http\Controllers\Api\WhatsAppWebhookController;
use App\Http\Middleware\EnsureTenantMatchesProfile;
use App\Http\Middleware\ResolveTenant;
use Illuminate\Support\Facades\Route;

Route::get('/health', function () {
    return ['status' => 'ok'];
});

Route::get('/internal/tls/authorize', [InfrastructureController::class, 'authorizeTlsDomain'])
    ->middleware('throttle:api')
    ->withoutMiddleware([
        ResolveTenant::class,
        EnsureTenantMatchesProfile::class,
    ]);

Route::get('/mobile/schools', [MobileDirectoryController::class, 'schools'])
    ->middleware('throttle:api')
    ->withoutMiddleware([
        ResolveTenant::class,
        EnsureTenantMatchesProfile::class,
    ]);

Route::get('/public/settings', [PublicSettingsController::class, 'show'])
    ->middleware('throttle:api')
    ->withoutMiddleware([EnsureTenantMatchesProfile::class]);

Route::prefix('mobile')->middleware(['auth:sanctum', 'throttle:api'])->group(function () {
    Route::get('/me', [MobileController::class, 'me']);
    Route::get('/dashboard', [MobileController::class, 'dashboard']);
    Route::get('/guru/dashboard', [MobileController::class, 'guruDashboard']);
    Route::get('/guru/schedules/today', [MobileController::class, 'guruSchedulesToday']);
    Route::get('/guru/classes', [MobileController::class, 'guruClasses']);
    Route::get('/guru/classes/{id}', [MobileController::class, 'guruClass']);
    Route::get('/guru/attendance/summary', [MobileController::class, 'guruAttendanceSummary']);
    Route::post('/guru/rfid/scan', [MobileController::class, 'guruRfidScan']);
    Route::post('/guru/rfid/sync', [MobileController::class, 'guruRfidSync']);
    Route::post('/guru/attendance/manual', [MobileController::class, 'guruManualAttendance']);
    Route::get('/siswa/dashboard', [MobileController::class, 'siswaDashboard']);
    Route::get('/siswa/attendance', [MobileController::class, 'siswaAttendance']);
    Route::get('/siswa/schedules', [MobileController::class, 'siswaSchedules']);
    Route::get('/siswa/tasks', [MobileController::class, 'siswaTasks']);
    Route::get('/siswa/grades', [MobileController::class, 'siswaGrades']);
    Route::get('/siswa/digital-card', [MobileController::class, 'siswaDigitalCard']);
});

Route::post('/auth/register', [AuthController::class, 'register'])
    ->middleware(['throttle:auth', 'auth.not_root_domain'])
    ->withoutMiddleware([EnsureTenantMatchesProfile::class]);
Route::post('/auth/login', [AuthController::class, 'login'])
    ->middleware(['throttle:auth', 'auth.not_root_domain'])
    ->withoutMiddleware([EnsureTenantMatchesProfile::class]);
Route::get('/auth/google/redirect', [AuthController::class, 'googleRedirect'])
    ->middleware(['web', 'throttle:auth', 'auth.not_root_domain'])
    ->withoutMiddleware([EnsureTenantMatchesProfile::class]);
Route::get('/auth/google/mobile/redirect', [AuthController::class, 'googleMobileRedirect'])
    ->middleware(['web', 'throttle:auth'])
    ->withoutMiddleware([EnsureTenantMatchesProfile::class]);
Route::get('/auth/google/popup-context', [AuthController::class, 'googlePopupContext'])
    ->middleware('throttle:auth')
    ->withoutMiddleware([
        ResolveTenant::class,
        EnsureTenantMatchesProfile::class,
    ]);
Route::post('/auth/google/code-login', [AuthController::class, 'googleCodeLogin'])
    ->middleware(['throttle:auth', 'auth.not_root_domain'])
    ->withoutMiddleware([EnsureTenantMatchesProfile::class]);
Route::post('/auth/google/credential-login', [AuthController::class, 'googleCredentialLogin'])
    ->middleware(['throttle:auth', 'auth.not_root_domain'])
    ->withoutMiddleware([EnsureTenantMatchesProfile::class]);
Route::post('/auth/google/mobile/exchange', [AuthController::class, 'googleMobileExchange'])
    ->middleware('throttle:auth')
    ->withoutMiddleware([EnsureTenantMatchesProfile::class]);
Route::get('/auth/google/callback', [AuthController::class, 'googleCallback'])
    ->middleware(['web', 'throttle:auth'])
    ->withoutMiddleware([
        ResolveTenant::class,
        EnsureTenantMatchesProfile::class,
    ]);
Route::get('/auth/google/finalize-login', [AuthController::class, 'googleFinalizeLogin'])
    ->middleware(['web', 'throttle:auth'])
    ->withoutMiddleware([EnsureTenantMatchesProfile::class]);
Route::post('/auth/forgot-password', [AuthController::class, 'forgotPassword'])
    ->middleware(['throttle:auth', 'auth.not_root_domain'])
    ->withoutMiddleware([EnsureTenantMatchesProfile::class]);
Route::post('/auth/reset-password', [AuthController::class, 'resetPassword'])
    ->middleware(['throttle:auth', 'auth.not_root_domain'])
    ->withoutMiddleware([EnsureTenantMatchesProfile::class]);
Route::get('/auth/verify-email/{id}/{hash}', [AuthController::class, 'verifyEmail'])
    ->name('verification.verify')
    ->middleware('throttle:6,1');
Route::get('/auth/me', [AuthController::class, 'me'])
    ->middleware(['auth:sanctum', 'throttle:api'])
    ->withoutMiddleware([EnsureTenantMatchesProfile::class]);
Route::middleware(['auth:sanctum', 'throttle:api'])->group(function () {
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/security', [AuthController::class, 'securityOverview']);
    Route::post('/auth/logout-other-devices', [AuthController::class, 'logoutOtherDevices']);
    Route::post('/auth/update-password', [AuthController::class, 'updatePassword']);
    Route::post('/auth/update-account', [AuthController::class, 'updateAccount']);
    Route::get('/profile/me', [ProfileController::class, 'me']);
    Route::patch('/profile/me', [ProfileController::class, 'updateMe']);
    Route::post('/auth/verify-email/resend', [AuthController::class, 'resendVerificationEmail']);
    Route::post('/auth/google/credential-link', [AuthController::class, 'googleCredentialLink']);
    Route::post('/auth/google/unlink', [AuthController::class, 'googleUnlink']);
    Route::post('/presence/ping', [PresenceController::class, 'ping']);
    Route::post('/guru/jam-kosong/{id}/replacement', [JadwalController::class, 'updateJamKosongReplacement']);
    Route::get('/guru/admin-permissions', [AdminFeaturePermissionController::class, 'mine']);
    Route::post('/attendance-qr/session', [AttendanceQrController::class, 'session']);
    Route::post('/attendance-qr/scan', [AttendanceQrController::class, 'scan']);
    Route::patch('/students/{id}/additional-info', [AdminController::class, 'updateStudentAdditionalInfo']);
});

Route::middleware(['auth:sanctum', 'throttle:auth'])->group(function () {
    Route::post('/auth/password-change/send-code', [AuthController::class, 'sendPasswordChangeCode']);
    Route::post('/auth/email-verification/send-code', [AuthController::class, 'sendEmailVerificationCode']);
    Route::post('/auth/email-verification/verify-code', [AuthController::class, 'verifyEmailCode']);
});

Route::middleware(['web', 'auth:sanctum', 'throttle:api'])->get('/auth/google/link', [AuthController::class, 'googleLinkRedirect']);
Route::post('/rfid/scan', [RfidController::class, 'scan'])
    ->middleware('throttle:rfid')
    ->withoutMiddleware([
        ResolveTenant::class,
        EnsureTenantMatchesProfile::class,
    ]);
Route::get('/rfid/mode', [RfidController::class, 'mode'])
    ->middleware('throttle:rfid')
    ->withoutMiddleware([
        ResolveTenant::class,
        EnsureTenantMatchesProfile::class,
    ]);
Route::post('/rfid/sync', [RfidController::class, 'sync'])
    ->middleware('throttle:rfid')
    ->withoutMiddleware([
        ResolveTenant::class,
        EnsureTenantMatchesProfile::class,
    ]);
Route::post('/rfid/heartbeat', [RfidController::class, 'heartbeat'])
    ->middleware('throttle:rfid')
    ->withoutMiddleware([
        ResolveTenant::class,
        EnsureTenantMatchesProfile::class,
    ]);
Route::post('/rfid/set-mode', [RfidController::class, 'setMode'])
    ->middleware(['auth:sanctum', 'throttle:api']);

Route::prefix('quiz')->middleware(['auth:sanctum', 'throttle:api'])->group(function () {
    Route::get('/dashboard', [QuizController::class, 'dashboard']);
    Route::get('/{quizId}/detail', [QuizController::class, 'detail']);
    Route::post('/submit', [QuizController::class, 'submit'])->middleware('throttle:quiz-submit');
    Route::post('/start', [QuizController::class, 'startAttempt']);
    Route::post('/answer', [QuizController::class, 'saveAnswer'])->middleware('throttle:quiz-answers');
    Route::post('/answers/batch', [QuizController::class, 'saveAnswersBatch'])->middleware('throttle:quiz-answers');
    Route::post('/violation', [QuizController::class, 'logViolation']);
    Route::post('/schedule', [QuizController::class, 'schedule']);
    Route::post('/publish', [QuizController::class, 'publish']);
    Route::post('/close', [QuizController::class, 'close']);
    Route::post('/retake', [QuizController::class, 'retake']);
    Route::get('/retake-history', [QuizController::class, 'retakeHistory']);
    Route::post('/restore-retake-score', [QuizController::class, 'restoreRetakeScore']);
    Route::post('/grade-essay', [QuizController::class, 'gradeEssay']);
    Route::post('/complete-essay-review', [QuizController::class, 'completeEssayReview']);
});

Route::middleware(['conceal.db.guests', 'throttle:db'])->group(function () {
    Route::post('/db', [DbController::class, 'handle']);
    Route::post('/db/batch', [DbController::class, 'batch']);
});

Route::prefix('storage')->middleware(['auth:sanctum', 'throttle:storage'])->group(function () {
    Route::post('/upload', [StorageController::class, 'upload']);
    Route::post('/direct-upload', [StorageController::class, 'directUpload']);
    Route::post('/confirm-upload', [StorageController::class, 'confirmUpload']);
    Route::post('/upload-destination', [StorageController::class, 'uploadDestination']);
    Route::post('/remove', [StorageController::class, 'remove']);
});
Route::get('/storage/signed', [StorageController::class, 'signed'])->middleware('throttle:storage');
Route::get('/storage/object', [StorageController::class, 'object'])->middleware('throttle:storage');

Route::prefix('tugas')->middleware(['auth:sanctum', 'throttle:api'])->group(function () {
    Route::post('/jawaban/submit', [TugasController::class, 'submitJawaban']);
});

Route::prefix('reports')->middleware(['auth:sanctum', 'throttle:api'])->group(function () {
    Route::get('/teacher-summary', [ReportController::class, 'teacherSummary']);
    Route::get('/attendance-summary', [ReportController::class, 'attendanceSummary']);
    Route::get('/task-summary', [ReportController::class, 'taskSummary']);
    Route::get('/quiz-summary', [ReportController::class, 'quizSummaryEndpoint']);
    Route::get('/homeroom-summary', [ReportController::class, 'homeroomSummary']);
});

Route::prefix('admin')->middleware(['auth:sanctum', 'throttle:api'])->group(function () {
    Route::delete('/users/{id}', [AdminController::class, 'deleteUser']);
    Route::patch('/users/{id}/status', [AdminController::class, 'updateUserStatus']);
    Route::get('/home-bootstrap', [AdminController::class, 'homeBootstrap']);
    Route::get('/teacher-options', [AdminController::class, 'teacherOptions']);
    Route::get('/organisasi-bootstrap', [AdminController::class, 'organisasiBootstrap']);
    Route::get('/struktur-bootstrap', [AdminController::class, 'strukturBootstrap']);
    Route::get('/dashboard-summary', [AdminController::class, 'dashboardSummary']);
    Route::get('/students', [AdminController::class, 'students']);
    Route::get('/students/{id}', [AdminController::class, 'studentDetail']);
    Route::post('/students/import', [AdminController::class, 'importStudents']);
    Route::get('/academic-summary', [AdminController::class, 'academicSummary']);
    Route::post('/academic-period/apply', [AdminController::class, 'applyAcademicPeriod']);
    Route::post('/academic-period/restore-roster', [AdminController::class, 'restoreAcademicPeriodRoster']);
    Route::post('/academic-period/copy-structure', [AdminController::class, 'copyAcademicStructure']);
    Route::get('/academic-rollover-exceptions', [AdminController::class, 'academicRolloverExceptions']);
    Route::put('/academic-rollover-exceptions', [AdminController::class, 'replaceAcademicRolloverExceptions']);
    Route::get('/student-options', [AdminController::class, 'studentOptions']);
    Route::get('/teachers', [AdminController::class, 'teachers']);
    Route::get('/certificates', [AdminController::class, 'certificates']);
    Route::post('/certificates/{id}/send-email', [AdminController::class, 'sendCertificateEmail']);
    Route::get('/rfid-devices', [AdminController::class, 'rfidDevices']);
    Route::get('/rfid-events/stream', [AdminController::class, 'rfidEventsStream']);
    Route::get('/scan-session-summary', [AdminController::class, 'scanSessionSummary']);
    Route::get('/feature-permissions', [AdminFeaturePermissionController::class, 'index']);
    Route::post('/feature-permissions', [AdminFeaturePermissionController::class, 'store']);
    Route::patch('/feature-permissions/{id}', [AdminFeaturePermissionController::class, 'update']);
    Route::delete('/feature-permissions/{id}', [AdminFeaturePermissionController::class, 'destroy']);
    Route::get('/classes/deleted-history', [ClassHistoryController::class, 'index']);
    Route::delete('/classes/{id}', [ClassHistoryController::class, 'destroyClass']);
    Route::post('/classes/deleted-history/{id}/restore', [ClassHistoryController::class, 'restore']);
    Route::delete('/classes/deleted-history/{id}', [ClassHistoryController::class, 'destroyHistory']);
    Route::post('/users/provision', [AdminController::class, 'provisionUser']);
    Route::patch('/teachers/{id}/name', [AdminController::class, 'updateTeacherName']);
    Route::patch('/teachers/{id}/profile', [AdminController::class, 'updateTeacherProfile']);
    Route::get('/monitoring', [AdminController::class, 'monitoring']);
    Route::get('/scan-settings', [SettingsController::class, 'scanShow']);
    Route::patch('/scan-settings', [SettingsController::class, 'scanUpdate']);
    Route::get('/backup', [AdminBackupController::class, 'backup']);
    Route::get('/backup/monthly-status', [AdminBackupController::class, 'monthlyStatus']);
    Route::post('/backup/google-drive', [AdminBackupController::class, 'saveToGoogleDrive']);
    Route::post('/backup/google-drive/monthly', [AdminBackupController::class, 'saveMonthlyToGoogleDrive']);
    Route::post('/backup/google-drive/monthly/auto', [AdminBackupController::class, 'autoMonthlyToGoogleDrive']);
    Route::get('/backup/google-drive/monthly/jobs/{jobId}', [AdminBackupController::class, 'monthlyJobStatus']);
    Route::post('/backup/restore', [AdminBackupController::class, 'restore']);
    Route::get('/whatsapp', [WhatsAppController::class, 'show']);
    Route::post('/whatsapp/connect', [WhatsAppController::class, 'connect']);
    Route::post('/whatsapp/sync', [WhatsAppController::class, 'sync']);
    Route::post('/whatsapp/logout', [WhatsAppController::class, 'logout']);
    Route::patch('/whatsapp/settings', [WhatsAppController::class, 'updateSettings']);
    Route::post('/whatsapp/test', [WhatsAppController::class, 'sendTest']);
    Route::get('/google-drive', [GoogleDriveController::class, 'show']);
    Route::get('/google-drive/files', [GoogleDriveController::class, 'files']);
    Route::post('/google-drive/connect-url', [GoogleDriveController::class, 'connectUrl']);
    Route::post('/google-drive/sync', [GoogleDriveController::class, 'sync']);
    Route::post('/google-drive/recover', [GoogleDriveController::class, 'recover']);
    Route::post('/google-drive/disconnect', [GoogleDriveController::class, 'disconnect']);
    Route::get('/storage-manager', [StorageManagementController::class, 'adminSummary']);
    Route::post('/storage-manager/object-storage/sync', [StorageManagementController::class, 'adminObjectStorageSync']);
    Route::post('/storage-manager/cleanup/preview', [StorageManagementController::class, 'adminCleanupPreview']);
    Route::post('/storage-manager/cleanup/execute', [StorageManagementController::class, 'adminCleanupExecute']);
    Route::post('/storage-manager/trash/{fileId}/restore', [StorageManagementController::class, 'restoreTrashFile']);
});
Route::get('/admin/google-drive/callback', [GoogleDriveController::class, 'callback'])
    ->middleware(['web', 'throttle:auth'])
    ->withoutMiddleware([
        ResolveTenant::class,
        EnsureTenantMatchesProfile::class,
    ]);
Route::post('/whatsapp/webhook/{secret}/{event?}', [WhatsAppWebhookController::class, 'handle'])
    ->middleware('throttle:webhook')
    ->withoutMiddleware([
        ResolveTenant::class,
        EnsureTenantMatchesProfile::class,
    ]);

Route::middleware(['auth:sanctum', 'throttle:super', 'super.domain', 'super.admin'])->group(function () {
    Route::get('/super/me', [SuperAdminController::class, 'me']);
    Route::get('/super/domains', [SuperAdminController::class, 'platformDomains']);
    Route::post('/super/domains', [SuperAdminController::class, 'storePlatformDomain']);
    Route::post('/super/domains/{domainId}/check', [SuperAdminController::class, 'checkDomain']);
    Route::delete('/super/domains/{domainId}', [SuperAdminController::class, 'deleteDomain']);
    Route::get('/super/tenants', [SuperAdminController::class, 'index']);
    Route::post('/super/tenants', [SuperAdminController::class, 'store']);
    Route::get('/super/tenants/{id}', [SuperAdminController::class, 'showTenant']);
    Route::get('/super/monitoring', [SuperAdminController::class, 'monitoringOverview']);
    Route::get('/super/monitoring/server', [SuperAdminController::class, 'serverMonitoring']);
    Route::get('/super/monitoring/logs', [SuperLogController::class, 'index']);
    Route::get('/super/monitoring/logs/{id}', [SuperLogController::class, 'show']);
    Route::get('/super/storage', [StorageManagementController::class, 'superOverview']);
    Route::post('/super/storage/object-storage/sync', [StorageManagementController::class, 'superObjectStorageSync']);
    Route::post('/super/storage/trash/purge-expired', [StorageManagementController::class, 'superPurgeExpiredTrash']);
    Route::get('/super/tenants/{tenantId}/storage', [StorageManagementController::class, 'superTenantSummary']);
    Route::patch('/super/tenants/{tenantId}/storage/quota', [StorageManagementController::class, 'superUpdateQuota']);
    Route::post('/super/tenants/{tenantId}/storage/object-storage/sync', [StorageManagementController::class, 'superTenantObjectStorageSync']);
    Route::post('/super/tenants/{tenantId}/storage/cleanup/preview', [StorageManagementController::class, 'superCleanupPreview']);
    Route::post('/super/tenants/{tenantId}/storage/cleanup/execute', [StorageManagementController::class, 'superCleanupExecute']);
    Route::post('/super/tenants/{tenantId}/storage/trash/{fileId}/restore', [StorageManagementController::class, 'superRestoreTrashFile']);
    Route::delete('/super/tenants/{tenantId}/storage/trash/{fileId}', [StorageManagementController::class, 'superDeleteTrashFile']);
    Route::post('/super/tenants/{tenantId}/storage/trash/purge-all', [StorageManagementController::class, 'superPurgeAllTenantTrash']);
    Route::get('/super/tenants/{tenantId}/google-drive', [StorageManagementController::class, 'superTenantDriveSummary']);
    Route::get('/super/tenants/{tenantId}/google-drive/files', [StorageManagementController::class, 'superTenantDriveFiles']);
    Route::post('/super/tenants/{tenantId}/google-drive/sync', [StorageManagementController::class, 'superTenantDriveSync']);
    Route::post('/super/tenants/{tenantId}/domains', [SuperAdminController::class, 'storeTenantDomain']);
    Route::patch('/super/tenants/{tenantId}/rfid-mqtt', [SuperAdminController::class, 'updateTenantRfidMqtt']);
    Route::post('/super/tenants/{tenantId}/rfid-mqtt/mosquitto', [SuperAdminController::class, 'provisionTenantRfidMosquitto']);
    Route::get('/super/tenants/{tenantId}/rfid-devices', [SuperAdminController::class, 'tenantRfidDevices']);
    Route::post('/super/tenants/{tenantId}/rfid-devices', [SuperAdminController::class, 'storeTenantRfidDevice']);
    Route::delete('/super/tenants/{tenantId}/rfid-devices/{deviceId}', [SuperAdminController::class, 'deleteTenantRfidDevice']);
    Route::get('/super/tenants/{id}/backup', [SuperAdminController::class, 'backupTenant']);
    Route::get('/super/tenants/{id}/backup/monthly-status', [SuperAdminController::class, 'backupTenantMonthlyStatus']);
    Route::post('/super/tenants/{id}/backup/google-drive', [SuperAdminController::class, 'saveTenantBackupToGoogleDrive']);
    Route::post('/super/tenants/{id}/backup/google-drive/monthly', [SuperAdminController::class, 'saveTenantMonthlyBackupToGoogleDrive']);
    Route::post('/super/tenants/{id}/backup/google-drive/monthly/auto', [SuperAdminController::class, 'autoTenantMonthlyBackupToGoogleDrive']);
    Route::get('/super/tenants/{id}/backup/google-drive/monthly/jobs/{jobId}', [SuperAdminController::class, 'tenantMonthlyBackupJobStatus']);
    Route::post('/super/tenants/{id}/restore', [SuperAdminController::class, 'restoreTenant']);
    Route::patch('/super/tenants/{id}/status', [SuperAdminController::class, 'updateTenantStatus']);
    Route::get('/super/whatsapp', [WhatsAppController::class, 'superOverview']);
    Route::post('/super/whatsapp/connect', [WhatsAppController::class, 'superConnect']);
    Route::post('/super/whatsapp/sync', [WhatsAppController::class, 'superSync']);
    Route::post('/super/whatsapp/logout', [WhatsAppController::class, 'superLogout']);
    Route::post('/super/whatsapp/test', [WhatsAppController::class, 'superSendTest']);
    Route::patch('/super/whatsapp/tenants/{tenantId}/status', [WhatsAppController::class, 'superUpdateTenantSettings']);
    Route::post('/super/whatsapp/daily-alpha/run', [WhatsAppController::class, 'superRunDailyAlpha']);
    Route::post('/super/whatsapp/retry-failed', [WhatsAppController::class, 'superRetryFailed']);
    Route::post('/super/tenants/{tenantId}/admins/{userId}/reset-password', [SuperAdminController::class, 'resetTenantAdminPassword']);
    Route::get('/super/admins', [SuperAdminController::class, 'admins']);
    Route::post('/super/admins', [SuperAdminController::class, 'storeAdmin']);
    Route::delete('/super/admins/{id}', [SuperAdminController::class, 'deleteAdmin']);
    Route::get('/super/audit-trail', [SuperAdminController::class, 'auditTrail']);
});
