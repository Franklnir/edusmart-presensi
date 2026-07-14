<?php

namespace App\Services;

use App\Models\Profile;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class AcademicAccessService
{
    /** @return Collection<int, string> */
    public function teacherClassIds(Profile $teacher, ?string $subject = null): Collection
    {
        if ($teacher->role !== 'guru' || ! $teacher->tenant_id) {
            return collect();
        }

        $schedule = DB::table('jadwal')
            ->where('tenant_id', $teacher->tenant_id)
            ->where('guru_id', $teacher->id);
        if ($subject !== null && $subject !== '') {
            $schedule->where('mapel', $subject);
        }

        $scheduledClassIds = $schedule->pluck('kelas_id');
        $homeroomClassIds = DB::table('kelas_struktur')
            ->where('tenant_id', $teacher->tenant_id)
            ->where('wali_guru_id', $teacher->id)
            ->pluck('kelas_id');

        return $scheduledClassIds
            ->merge($homeroomClassIds)
            ->filter(fn ($id) => $id !== null && $id !== '')
            ->map(fn ($id) => (string) $id)
            ->unique()
            ->values();
    }

    public function canManageClass(Profile $actor, string $classId, ?string $subject = null): bool
    {
        if ($actor->role === 'admin') {
            return true;
        }

        if ($actor->role !== 'guru' || $classId === '') {
            return false;
        }

        return $this->teacherClassIds($actor, $subject)->contains($classId);
    }
}
