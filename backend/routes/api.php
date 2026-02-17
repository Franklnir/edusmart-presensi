<?php

use App\Http\Controllers\Api\AdminController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\DbController;
use App\Http\Controllers\Api\PresenceController;
use App\Http\Controllers\Api\QuizController;
use App\Http\Controllers\Api\StorageController;
use App\Http\Controllers\Api\SuperAdminController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/health', function () {
    return ['status' => 'ok'];
});

Route::post('/auth/register', [AuthController::class, 'register'])->middleware('throttle:auth');
Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:auth');
Route::post('/auth/forgot-password', [AuthController::class, 'forgotPassword'])->middleware('throttle:auth');
Route::post('/auth/reset-password', [AuthController::class, 'resetPassword'])->middleware('throttle:auth');
Route::get('/auth/verify-email/{id}/{hash}', [AuthController::class, 'verifyEmail'])
    ->name('verification.verify')
    ->middleware('throttle:6,1');
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/auth/logout', [AuthController::class, 'logout']);
Route::middleware(['auth:sanctum', 'throttle:api'])->get('/auth/me', [AuthController::class, 'me']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/auth/update-password', [AuthController::class, 'updatePassword']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/auth/update-account', [AuthController::class, 'updateAccount']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/auth/verify-email/resend', [AuthController::class, 'resendVerificationEmail']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/presence/ping', [PresenceController::class, 'ping']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/quiz/submit', [QuizController::class, 'submit']);
Route::middleware(['auth:sanctum', 'throttle:api'])->post('/quiz/retake', [QuizController::class, 'retake']);
Route::middleware(['auth:sanctum', 'throttle:api'])->get('/quiz/retake-history', [QuizController::class, 'retakeHistory']);

Route::post('/db', [DbController::class, 'handle'])->middleware('throttle:db');

Route::post('/storage/upload', [StorageController::class, 'upload'])->middleware('throttle:api');
Route::post('/storage/remove', [StorageController::class, 'remove'])->middleware('throttle:api');
Route::get('/storage/signed', [StorageController::class, 'signed'])->middleware('throttle:api');
Route::get('/storage/object', [StorageController::class, 'object'])->middleware('throttle:api');

Route::middleware(['auth:sanctum', 'throttle:api'])->delete('/admin/users/{id}', [AdminController::class, 'deleteUser']);
Route::middleware(['auth:sanctum', 'throttle:api'])->get('/admin/monitoring', [AdminController::class, 'monitoring']);

Route::middleware(['auth:sanctum', 'throttle:super', 'super.domain'])->group(function () {
    Route::get('/super/me', [SuperAdminController::class, 'me']);
    Route::get('/super/tenants', [SuperAdminController::class, 'index']);
    Route::post('/super/tenants', [SuperAdminController::class, 'store']);
    Route::get('/super/tenants/{id}', [SuperAdminController::class, 'showTenant']);
    Route::get('/super/tenants/{id}/backup', [SuperAdminController::class, 'backupTenant']);
    Route::post('/super/tenants/{tenantId}/admins/{userId}/reset-password', [SuperAdminController::class, 'resetTenantAdminPassword']);
    Route::get('/super/admins', [SuperAdminController::class, 'admins']);
    Route::post('/super/admins', [SuperAdminController::class, 'storeAdmin']);
    Route::delete('/super/admins/{id}', [SuperAdminController::class, 'deleteAdmin']);
});
