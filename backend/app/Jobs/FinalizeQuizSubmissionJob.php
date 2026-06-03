<?php

namespace App\Jobs;

use App\Services\Quiz\QuizScoringService;
use App\Services\WhatsApp\WhatsAppNotificationService;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class FinalizeQuizSubmissionJob implements ShouldBeUnique, ShouldQueue
{
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public int $tries = 3;

    public array $backoff = [5, 20, 60];

    public int $timeout = 90;

    public int $uniqueFor = 600;

    public function __construct(
        public readonly string $tenantId,
        public readonly string $submissionId,
        public readonly string $finishedAt,
        public readonly string $status = 'finished'
    ) {
        $this->onQueue((string) config('quiz.scoring_queue', 'quiz-scoring'));
    }

    public function uniqueId(): string
    {
        return $this->tenantId.':'.$this->submissionId;
    }

    public function handle(
        QuizScoringService $scoringService,
        WhatsAppNotificationService $notificationService
    ): void {
        $before = DB::table('quiz_submissions')
            ->where('tenant_id', $this->tenantId)
            ->where('id', $this->submissionId)
            ->first();

        if (! $before) {
            return;
        }

        $result = $scoringService->finalizeSubmission(
            $this->tenantId,
            $this->submissionId,
            Carbon::parse($this->finishedAt),
            $this->status
        );

        if (! $result) {
            return;
        }

        $after = DB::table('quiz_submissions')
            ->where('tenant_id', $this->tenantId)
            ->where('id', $this->submissionId)
            ->first();

        try {
            $notificationService->handleTableMutation(
                $this->tenantId,
                'quiz_submissions',
                'update',
                [(array) $before],
                $after ? [(array) $after] : []
            );
        } catch (\Throwable) {
            // Notification delivery is independent from scoring completion.
        }
    }
}
