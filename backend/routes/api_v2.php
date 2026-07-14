<?php

use App\Http\Controllers\Api\V2\AttendanceController;
use App\Http\Controllers\Api\V2\AssignmentController;
use App\Http\Controllers\Api\V2\SubmissionController;
use App\Http\Controllers\Api\V2\ClassController;
use App\Http\Controllers\Api\V2\FrontendLogController;
use App\Http\Controllers\Api\V2\StudentController;
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

Route::get('/frontend-logs', [FrontendLogController::class, 'index']);

Route::apiResource('classes', ClassController::class);
Route::apiResource('students', StudentController::class);
Route::apiResource('teachers', TeacherController::class);
Route::apiResource('attendance', AttendanceController::class)->parameters([
    'attendance' => 'attendance'
]);
Route::apiResource('assignments', AssignmentController::class);
Route::apiResource('submissions', SubmissionController::class);
Route::patch('submissions/{submission}/grade', [SubmissionController::class, 'grade']);
Route::post('submissions/grade-by-user', [SubmissionController::class, 'gradeByUser']);

Route::post('uploads', [UploadController::class, 'store']);
Route::post('uploads/{session}/complete', [UploadController::class, 'complete']);
Route::delete('uploads/{session}', [UploadController::class, 'destroy']);
