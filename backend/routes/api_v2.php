<?php

use App\Http\Controllers\Api\V2\AssignmentController;
use App\Http\Controllers\Api\V2\AttachmentController;
use App\Http\Controllers\Api\V2\AttendanceController;
use App\Http\Controllers\Api\V2\AttendanceRequestController;
use App\Http\Controllers\Api\V2\ClassController;
use App\Http\Controllers\Api\V2\FrontendLogController;
use App\Http\Controllers\Api\V2\StudentController;
use App\Http\Controllers\Api\V2\SubmissionController;
use App\Http\Controllers\Api\V2\TeacherController;
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

    Route::apiResource('classes', ClassController::class);
    Route::apiResource('students', StudentController::class)->except(['destroy']);
    Route::patch('students/{student}/deactivate', [StudentController::class, 'deactivate'])->name('students.deactivate');
    Route::patch('students/{student}/activate', [StudentController::class, 'activate'])->name('students.activate');
    Route::apiResource('teachers', TeacherController::class);
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
    Route::get('attachments/{attachment}/download', [AttachmentController::class, 'download'])->name('attachments.download');
    Route::delete('attachments/{attachment}', [AttachmentController::class, 'destroy'])->name('attachments.destroy');
});
