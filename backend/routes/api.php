<?php

use App\Http\Controllers\Api\AdminBackupController;
use App\Http\Controllers\Api\AdminController;
use App\Http\Controllers\Api\ApprovalController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\DbController;
use App\Http\Controllers\Api\PresenceController;
use App\Http\Controllers\Api\QuizController;
use App\Http\Controllers\Api\RfidController;
use App\Http\Controllers\Api\StorageController;
use App\Http\Controllers\Api\SuperAdminController;
use Illuminate\Support\Facades\Route;

Route::get('/health', function () {
    return ['status' => 'ok'];
});

Route::post('/auth/register', [AuthController::class, 'register'])->middleware('throttle:auth');
Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:auth');
Route::get('/auth/google/redirect', [AuthController::class, 'googleRedirect'])
    ->middleware(['web', 'throttle:auth'])
    ->withoutMiddleware([\App\Http\Middleware\EnsureTenantMatchesProfile::class]);
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
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/auth/google/unlink', [AuthController::class, 'googleUnlink']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/presence/ping', [PresenceController::class, 'ping']);
Route::post('/rfid/scan', [RfidController::class, 'scan'])
    ->middleware('throttle:api')
    ->withoutMiddleware([
        \App\Http\Middleware\ResolveTenant::class,
        \App\Http\Middleware\EnsureTenantMatchesProfile::class,
    ]);
Route::get('/rfid/mode', [RfidController::class, 'mode'])
    ->middleware('throttle:api')
    ->withoutMiddleware([
        \App\Http\Middleware\ResolveTenant::class,
        \App\Http\Middleware\EnsureTenantMatchesProfile::class,
    ]);
Route::post('/rfid/set-mode', [RfidController::class, 'setMode'])
    ->middleware(['auth:sanctum', 'throttle:api']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/quiz/submit', [QuizController::class, 'submit']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/quiz/retake', [QuizController::class, 'retake']);
Route::middleware(['auth:sanctum', 'throttle:api'])->get('/quiz/retake-history', [QuizController::class, 'retakeHistory']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/quiz/restore-retake-score', [QuizController::class, 'restoreRetakeScore']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/quiz/grade-essay', [QuizController::class, 'gradeEssay']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/quiz/complete-essay-review', [QuizController::class, 'completeEssayReview']);

Route::post('/db', [DbController::class, 'handle'])->middleware('throttle:db');

Route::post('/storage/upload', [StorageController::class, 'upload'])->middleware(['auth:sanctum', 'throttle:storage']);
Route::post('/storage/remove', [StorageController::class, 'remove'])->middleware(['auth:sanctum', 'throttle:storage']);
Route::get('/storage/signed', [StorageController::class, 'signed'])->middleware('throttle:storage');
Route::get('/storage/object', [StorageController::class, 'object'])->middleware('throttle:storage');

Route::middleware(['auth:sanctum', 'throttle:api'])->delete('/admin/users/{id}', [AdminController::class, 'deleteUser']);
Route::middleware(['auth:sanctum', 'throttle:api'])->get('/admin/monitoring', [AdminController::class, 'monitoring']);
Route::middleware(['auth:sanctum', 'throttle:api'])->get('/admin/backup', [AdminBackupController::class, 'backup']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/admin/backup/restore', [AdminBackupController::class, 'restore']);
Route::middleware(['auth:sanctum', 'throttle:api'])->get('/admin/approvals', [ApprovalController::class, 'index']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/admin/approvals/{id}/approve', [ApprovalController::class, 'approve']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/admin/approvals/{id}/reject', [ApprovalController::class, 'reject']);

Route::middleware(['auth:sanctum', 'throttle:super', 'super.domain'])->group(function () {
    Route::get('/super/me', [SuperAdminController::class, 'me']);
    Route::get('/super/tenants', [SuperAdminController::class, 'index']);
    Route::post('/super/tenants', [SuperAdminController::class, 'store']);
    Route::get('/super/tenants/{id}', [SuperAdminController::class, 'showTenant']);
    Route::get('/super/tenants/{id}/backup', [SuperAdminController::class, 'backupTenant']);
    Route::post('/super/tenants/{id}/restore', [SuperAdminController::class, 'restoreTenant']);
    Route::patch('/super/tenants/{id}/status', [SuperAdminController::class, 'updateTenantStatus']);
    Route::post('/super/tenants/{tenantId}/admins/{userId}/reset-password', [SuperAdminController::class, 'resetTenantAdminPassword']);
    Route::patch('/super/tenants/{tenantId}/admins/{userId}/primary', [SuperAdminController::class, 'setTenantPrimaryAdmin']);
    Route::get('/super/admins', [SuperAdminController::class, 'admins']);
    Route::post('/super/admins', [SuperAdminController::class, 'storeAdmin']);
    Route::delete('/super/admins/{id}', [SuperAdminController::class, 'deleteAdmin']);
    Route::get('/super/audit-trail', [SuperAdminController::class, 'auditTrail']);
});
