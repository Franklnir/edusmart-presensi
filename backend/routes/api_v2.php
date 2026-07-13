<?php

use App\Http\Controllers\Api\V2\ClassController;
use App\Http\Controllers\Api\V2\FrontendLogController;
use App\Http\Controllers\Api\V2\StudentController;
use App\Http\Controllers\Api\V2\TeacherController;
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
