<?php

use App\Http\Controllers\Api\AdminBackupController;
use App\Http\Controllers\Api\AdminController;
use App\Http\Controllers\Api\AttendanceQrController;
use App\Http\Controllers\Api\ApprovalController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\DbController;
use App\Http\Controllers\Api\GoogleDriveController;
use App\Http\Controllers\Api\InfrastructureController;
use App\Http\Controllers\Api\PresenceController;
use App\Http\Controllers\Api\QuizController;
use App\Http\Controllers\Api\RfidController;
use App\Http\Controllers\Api\StorageController;
use App\Http\Controllers\Api\SuperAdminController;
use App\Http\Controllers\Api\SuperPluginController;
use App\Http\Controllers\Api\WhatsAppController;
use App\Http\Controllers\Api\WhatsAppWebhookController;
use Illuminate\Support\Facades\Route;

Route::get('/health', function () {
    return ['status' => 'ok'];
});

Route::get('/internal/tls/authorize', [InfrastructureController::class, 'authorizeTlsDomain'])
    ->middleware('throttle:api')
    ->withoutMiddleware([
        \App\Http\Middleware\ResolveTenant::class,
        \App\Http\Middleware\EnsureTenantMatchesProfile::class,
    ]);

Route::post('/auth/register', [AuthController::class, 'register'])->middleware('throttle:auth');
Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:auth');
Route::get('/auth/google/redirect', [AuthController::class, 'googleRedirect'])
    ->middleware(['web', 'throttle:auth'])
    ->withoutMiddleware([\App\Http\Middleware\EnsureTenantMatchesProfile::class]);
Route::get('/auth/google/popup-context', [AuthController::class, 'googlePopupContext'])
    ->middleware('throttle:auth')
    ->withoutMiddleware([
        \App\Http\Middleware\ResolveTenant::class,
        \App\Http\Middleware\EnsureTenantMatchesProfile::class,
    ]);
Route::post('/auth/google/code-login', [AuthController::class, 'googleCodeLogin'])->middleware('throttle:auth');
Route::post('/auth/google/credential-login', [AuthController::class, 'googleCredentialLogin'])->middleware('throttle:auth');
Route::get('/auth/google/callback', [AuthController::class, 'googleCallback'])
    ->middleware(['web', 'throttle:auth'])
    ->withoutMiddleware([
        \App\Http\Middleware\ResolveTenant::class,
        \App\Http\Middleware\EnsureTenantMatchesProfile::class,
    ]);
Route::get('/auth/google/finalize-login', [AuthController::class, 'googleFinalizeLogin'])
    ->middleware(['web', 'throttle:auth'])
    ->withoutMiddleware([\App\Http\Middleware\EnsureTenantMatchesProfile::class]);
Route::post('/auth/forgot-password', [AuthController::class, 'forgotPassword'])->middleware('throttle:auth');
Route::post('/auth/reset-password', [AuthController::class, 'resetPassword'])->middleware('throttle:auth');
Route::get('/auth/verify-email/{id}/{hash}', [AuthController::class, 'verifyEmail'])
    ->name('verification.verify')
    ->middleware('throttle:6,1');
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/auth/logout', [AuthController::class, 'logout']);
Route::middleware(['auth:sanctum', 'throttle:api'])->get('/auth/me', [AuthController::class, 'me']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/auth/update-password', [AuthController::class, 'updatePassword']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/auth/update-account', [AuthController::class, 'updateAccount']);
Route::middleware(['auth:sanctum', 'throttle:auth'])->post('/auth/password-change/send-code', [AuthController::class, 'sendPasswordChangeCode']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/auth/verify-email/resend', [AuthController::class, 'resendVerificationEmail']);
Route::middleware(['auth:sanctum', 'throttle:auth'])->post('/auth/email-verification/send-code', [AuthController::class, 'sendEmailVerificationCode']);
Route::middleware(['auth:sanctum', 'throttle:auth'])->post('/auth/email-verification/verify-code', [AuthController::class, 'verifyEmailCode']);
Route::middleware(['web', 'auth:sanctum', 'throttle:api'])->get('/auth/google/link', [AuthController::class, 'googleLinkRedirect']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/auth/google/credential-link', [AuthController::class, 'googleCredentialLink']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/auth/google/unlink', [AuthController::class, 'googleUnlink']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/presence/ping', [PresenceController::class, 'ping']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/attendance-qr/session', [AttendanceQrController::class, 'session']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/attendance-qr/scan', [AttendanceQrController::class, 'scan']);
Route::middleware(['auth:sanctum', 'throttle:api'])->patch('/students/{id}/additional-info', [AdminController::class, 'updateStudentAdditionalInfo']);
Route::post('/rfid/scan', [RfidController::class, 'scan'])
    ->middleware('throttle:rfid')
    ->withoutMiddleware([
        \App\Http\Middleware\ResolveTenant::class,
        \App\Http\Middleware\EnsureTenantMatchesProfile::class,
    ]);
Route::get('/rfid/mode', [RfidController::class, 'mode'])
    ->middleware('throttle:rfid')
    ->withoutMiddleware([
        \App\Http\Middleware\ResolveTenant::class,
        \App\Http\Middleware\EnsureTenantMatchesProfile::class,
    ]);
Route::post('/rfid/sync', [RfidController::class, 'sync'])
    ->middleware('throttle:rfid')
    ->withoutMiddleware([
        \App\Http\Middleware\ResolveTenant::class,
        \App\Http\Middleware\EnsureTenantMatchesProfile::class,
    ]);
Route::post('/rfid/heartbeat', [RfidController::class, 'heartbeat'])
    ->middleware('throttle:rfid')
    ->withoutMiddleware([
        \App\Http\Middleware\ResolveTenant::class,
        \App\Http\Middleware\EnsureTenantMatchesProfile::class,
    ]);
Route::post('/rfid/set-mode', [RfidController::class, 'setMode'])
    ->middleware(['auth:sanctum', 'throttle:api']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/quiz/submit', [QuizController::class, 'submit']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/quiz/start', [QuizController::class, 'startAttempt']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/quiz/answer', [QuizController::class, 'saveAnswer']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/quiz/violation', [QuizController::class, 'logViolation']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/quiz/publish', [QuizController::class, 'publish']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/quiz/close', [QuizController::class, 'close']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/quiz/retake', [QuizController::class, 'retake']);
Route::middleware(['auth:sanctum', 'throttle:api'])->get('/quiz/retake-history', [QuizController::class, 'retakeHistory']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/quiz/restore-retake-score', [QuizController::class, 'restoreRetakeScore']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/quiz/grade-essay', [QuizController::class, 'gradeEssay']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/quiz/complete-essay-review', [QuizController::class, 'completeEssayReview']);

Route::post('/db', [DbController::class, 'handle'])->middleware('throttle:db');
Route::post('/db/batch', [DbController::class, 'handleBatch'])->middleware('throttle:db');

Route::post('/storage/upload', [StorageController::class, 'upload'])->middleware(['auth:sanctum', 'throttle:storage']);
Route::post('/storage/upload-destination', [StorageController::class, 'uploadDestination'])->middleware(['auth:sanctum', 'throttle:storage']);
Route::post('/storage/remove', [StorageController::class, 'remove'])->middleware(['auth:sanctum', 'throttle:storage']);
Route::get('/storage/signed', [StorageController::class, 'signed'])->middleware('throttle:storage');
Route::get('/storage/object', [StorageController::class, 'object'])->middleware('throttle:storage');

Route::middleware(['auth:sanctum', 'throttle:api'])->delete('/admin/users/{id}', [AdminController::class, 'deleteUser']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/admin/users/provision', [AdminController::class, 'provisionUser']);
Route::middleware(['auth:sanctum', 'throttle:api'])->patch('/admin/teachers/{id}/name', [AdminController::class, 'updateTeacherName']);
Route::middleware(['auth:sanctum', 'throttle:api'])->get('/admin/monitoring', [AdminController::class, 'monitoring']);
Route::middleware(['auth:sanctum', 'throttle:api'])->get('/admin/dashboard-stats', [AdminController::class, 'dashboardStats']);
Route::middleware(['auth:sanctum', 'throttle:api'])->get('/admin/backup', [AdminBackupController::class, 'backup']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/admin/backup/restore', [AdminBackupController::class, 'restore']);
Route::middleware(['auth:sanctum', 'throttle:api'])->get('/admin/approvals', [ApprovalController::class, 'index']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/admin/approvals/{id}/approve', [ApprovalController::class, 'approve']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/admin/approvals/{id}/reject', [ApprovalController::class, 'reject']);
Route::middleware(['auth:sanctum', 'throttle:api'])->get('/admin/whatsapp', [WhatsAppController::class, 'show']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/admin/whatsapp/connect', [WhatsAppController::class, 'connect']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/admin/whatsapp/sync', [WhatsAppController::class, 'sync']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/admin/whatsapp/logout', [WhatsAppController::class, 'logout']);
Route::middleware(['auth:sanctum', 'throttle:api'])->patch('/admin/whatsapp/settings', [WhatsAppController::class, 'updateSettings']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/admin/whatsapp/test', [WhatsAppController::class, 'sendTest']);
Route::middleware(['auth:sanctum', 'throttle:api'])->get('/admin/google-drive', [GoogleDriveController::class, 'show']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/admin/google-drive/connect-url', [GoogleDriveController::class, 'connectUrl']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/admin/google-drive/sync', [GoogleDriveController::class, 'sync']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/admin/google-drive/disconnect', [GoogleDriveController::class, 'disconnect']);
Route::get('/admin/google-drive/callback', [GoogleDriveController::class, 'callback'])
    ->middleware(['web', 'throttle:auth'])
    ->withoutMiddleware([
        \App\Http\Middleware\ResolveTenant::class,
        \App\Http\Middleware\EnsureTenantMatchesProfile::class,
    ]);
Route::post('/whatsapp/webhook/{secret}/{event?}', [WhatsAppWebhookController::class, 'handle'])
    ->middleware('throttle:webhook')
    ->withoutMiddleware([
        \App\Http\Middleware\ResolveTenant::class,
        \App\Http\Middleware\EnsureTenantMatchesProfile::class,
    ]);

Route::middleware(['auth:sanctum', 'throttle:super', 'super.domain'])->group(function () {
    Route::get('/super/me', [SuperAdminController::class, 'me']);
    Route::get('/super/domains', [SuperAdminController::class, 'platformDomains']);
    Route::post('/super/domains', [SuperAdminController::class, 'storePlatformDomain']);
    Route::post('/super/domains/{domainId}/check', [SuperAdminController::class, 'checkDomain']);
    Route::delete('/super/domains/{domainId}', [SuperAdminController::class, 'deleteDomain']);
    Route::get('/super/tenants', [SuperAdminController::class, 'index']);
    Route::post('/super/tenants', [SuperAdminController::class, 'store']);
    Route::get('/super/tenants/{id}', [SuperAdminController::class, 'showTenant']);
    Route::post('/super/tenants/{tenantId}/domains', [SuperAdminController::class, 'storeTenantDomain']);
    Route::patch('/super/tenants/{tenantId}/rfid-mqtt', [SuperAdminController::class, 'updateTenantRfidMqtt']);
    Route::post('/super/tenants/{tenantId}/rfid-mqtt/mosquitto', [SuperAdminController::class, 'provisionTenantRfidMosquitto']);
    Route::get('/super/tenants/{id}/backup', [SuperAdminController::class, 'backupTenant']);
    Route::post('/super/tenants/{id}/restore', [SuperAdminController::class, 'restoreTenant']);
    Route::patch('/super/tenants/{id}/status', [SuperAdminController::class, 'updateTenantStatus']);
    Route::post('/super/tenants/{tenantId}/admins/{userId}/reset-password', [SuperAdminController::class, 'resetTenantAdminPassword']);
    Route::patch('/super/tenants/{tenantId}/admins/{userId}/primary', [SuperAdminController::class, 'setTenantPrimaryAdmin']);
    Route::get('/super/admins', [SuperAdminController::class, 'admins']);
    Route::post('/super/admins', [SuperAdminController::class, 'storeAdmin']);
    Route::delete('/super/admins/{id}', [SuperAdminController::class, 'deleteAdmin']);
    Route::get('/super/audit-trail', [SuperAdminController::class, 'auditTrail']);
    Route::get('/super/plugins', [SuperPluginController::class, 'index']);
    Route::post('/super/plugins/inspect', [SuperPluginController::class, 'inspect']);
    Route::post('/super/plugins', [SuperPluginController::class, 'store']);
    Route::patch('/super/plugins/{id}/status', [SuperPluginController::class, 'updateStatus']);
    Route::delete('/super/plugins/{id}', [SuperPluginController::class, 'destroy']);
    Route::get('/super/plugins/{id}/download', [SuperPluginController::class, 'download']);
});
