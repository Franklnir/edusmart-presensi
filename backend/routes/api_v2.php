<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\V2\ClassController;
use App\Http\Controllers\Api\V2\FrontendLogController;

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

Route::post('/frontend-logs', [FrontendLogController::class, 'store']);

Route::apiResource('classes', ClassController::class);
