<?php

use App\Services\Quiz\QuizScoringService;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::call(function (QuizScoringService $scoringService) {
    $scoringService->finalizeExpiredSubmissions();
})
    ->name('quiz:auto-finalize-expired')
    ->everyMinute()
    ->withoutOverlapping();
