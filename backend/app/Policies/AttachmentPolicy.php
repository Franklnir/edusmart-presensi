<?php

namespace App\Policies;

use App\Models\Attachment;
use App\Models\Tugas;
use App\Models\TugasJawaban;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class AttachmentPolicy
{
    public function view(User $user, Attachment $attachment): bool
    {
        $actor = $user->profile;
        if (! $actor || $actor->tenant_id !== $attachment->tenant_id || $attachment->status !== 'active') {
            return false;
        }

        if ($attachment->claimed_at === null) {
            return $actor->role === 'admin' || $attachment->actor_id === $actor->id;
        }

        return match ($attachment->claimed_by_type) {
            'assignment' => $this->canViewAssignment($user, $attachment),
            'submission' => $this->canViewSubmission($user, $attachment),
            'quiz' => $this->canViewQuiz($user, $attachment),
            default => false,
        };
    }

    public function delete(User $user, Attachment $attachment): bool
    {
        $actor = $user->profile;
        if (! $actor || $actor->tenant_id !== $attachment->tenant_id || $attachment->status !== 'active') {
            return false;
        }

        if ($attachment->claimed_at === null) {
            return $actor->role === 'admin' || $attachment->actor_id === $actor->id;
        }

        return match ($attachment->claimed_by_type) {
            'assignment' => $this->canUpdateAssignment($user, $attachment),
            'submission' => $this->canUpdateSubmission($user, $attachment),
            'quiz' => $this->canUpdateQuiz($user, $attachment),
            default => false,
        };
    }

    private function canViewAssignment(User $user, Attachment $attachment): bool
    {
        $assignment = Tugas::where('tenant_id', $attachment->tenant_id)
            ->find($attachment->claimed_by_id);

        return $assignment !== null && $user->can('view', $assignment);
    }

    private function canViewSubmission(User $user, Attachment $attachment): bool
    {
        $submission = TugasJawaban::with('tugas')
            ->where('tenant_id', $attachment->tenant_id)
            ->find($attachment->claimed_by_id);

        return $submission !== null && $user->can('view', $submission);
    }

    private function canUpdateAssignment(User $user, Attachment $attachment): bool
    {
        $assignment = Tugas::where('tenant_id', $attachment->tenant_id)
            ->find($attachment->claimed_by_id);

        return $assignment !== null && $user->can('update', $assignment);
    }

    private function canUpdateSubmission(User $user, Attachment $attachment): bool
    {
        $submission = TugasJawaban::with('tugas')
            ->where('tenant_id', $attachment->tenant_id)
            ->find($attachment->claimed_by_id);

        return $submission !== null
            && ($user->profile?->role === 'admin' || $user->can('update', $submission));
    }

    private function canViewQuiz(User $user, Attachment $attachment): bool
    {
        $quiz = DB::table('quizzes')
            ->where('tenant_id', $attachment->tenant_id)
            ->where('id', $attachment->claimed_by_id)
            ->first();
        if (! $quiz) {
            return false;
        }
        if ($user->profile?->role === 'admin' || (string) $quiz->guru_id === (string) $user->id) {
            return true;
        }

        if ($user->profile?->role !== 'siswa') {
            return false;
        }

        if ((string) ($user->profile?->kelas ?? '') === (string) $quiz->kelas_id) {
            return true;
        }

        return DB::table('quiz_submissions')
            ->where('tenant_id', $attachment->tenant_id)
            ->where('quiz_id', $quiz->id)
            ->where('siswa_id', $user->id)
            ->exists();
    }

    private function canUpdateQuiz(User $user, Attachment $attachment): bool
    {
        $quiz = DB::table('quizzes')
            ->where('tenant_id', $attachment->tenant_id)
            ->where('id', $attachment->claimed_by_id)
            ->first();

        return $quiz !== null
            && ($user->profile?->role === 'admin' || (string) $quiz->guru_id === (string) $user->id);
    }
}
