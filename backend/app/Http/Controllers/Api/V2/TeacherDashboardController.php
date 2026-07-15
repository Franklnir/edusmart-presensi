<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Models\Profile;
use App\Support\AcademicPeriod;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class TeacherDashboardController extends Controller
{
    public function dashboardAggregate(Request $request): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $reqId = $request->attributes->get('request_id') ?: Str::uuid()->toString();

        $kelas = $request->query('kelas');
        $bulanList = $request->query('bulan') ? explode(',', $request->query('bulan')) : [];
        $tahun = $request->query('tahun', date('Y'));
        $tahunAjaran = AcademicPeriod::normalizeAcademicYear($request->query('tahun_ajaran'));
        $semester = $request->query('semester');

        if (! $kelas) {
            return response()->json(['success' => false, 'message' => 'Kelas required'], 400);
        }

        $profile = Profile::query()
            ->where('id', (string) $request->user()->id)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'role']);
        $role = strtolower(trim((string) ($profile?->role ?? '')));
        if (! in_array($role, ['admin', 'guru', 'teacher'], true)) {
            return response()->json([
                'success' => false,
                'code' => 'REPORT_ACCESS_DENIED',
                'message' => 'Laporan ini hanya dapat diakses admin atau guru.',
            ], 403);
        }

        $activeTahunAjaran = AcademicPeriod::normalizeAcademicYear(
            DB::table('settings')
                ->where('tenant_id', $tenantId)
                ->orderBy('id')
                ->value('tahun_ajaran')
        );
        $tahunAjaran = $tahunAjaran ?: $activeTahunAjaran;
        if ($tahunAjaran === '') {
            $tahunAjaran = AcademicPeriod::current()['tahun_ajaran'];
        }

        if ($role !== 'admin') {
            $userId = (string) $request->user()->id;
            $hasTeachingAssignment = DB::table('jadwal')
                ->where('tenant_id', $tenantId)
                ->where('kelas_id', $kelas)
                ->where('guru_id', $userId)
                ->where('tahun_ajaran', $tahunAjaran)
                ->exists();
            $isHomeroomTeacher = DB::table('kelas_struktur')
                ->where('tenant_id', $tenantId)
                ->where('kelas_id', $kelas)
                ->where('wali_guru_id', $userId)
                ->where('tahun_ajaran', $tahunAjaran)
                ->exists();

            if (! $hasTeachingAssignment && ! $isHomeroomTeacher) {
                return response()->json([
                    'success' => false,
                    'code' => 'REPORT_CLASS_ACCESS_DENIED',
                    'message' => 'Guru tidak memiliki penugasan atau wali kelas pada periode ini.',
                ], 403);
            }
        }

        // 1. Get Class info
        $kelasRow = DB::table('kelas')->where('tenant_id', $tenantId)->where('id', $kelas)->first();
        if (! $kelasRow) {
            return response()->json(['success' => false, 'message' => 'Kelas tidak ditemukan'], 404);
        }

        $kelasAlias = [$kelas, $kelasRow->nama, str_replace(' ', '-', trim($kelasRow->nama))];

        // 2. Get Students in this class
        if ($tahunAjaran && $activeTahunAjaran && $tahunAjaran !== $activeTahunAjaran) {
            $historyIds = DB::table('student_class_histories')
                ->where('tenant_id', $tenantId)
                ->where('kelas_id', $kelas)
                ->where('tahun_ajaran', $tahunAjaran)
                ->pluck('siswa_id')
                ->toArray();

            if (! empty($historyIds)) {
                $students = DB::table('profiles')
                    ->where('tenant_id', $tenantId)
                    ->where('role', 'siswa')
                    ->whereIn('id', $historyIds)
                    ->orderBy('nama')
                    ->get(['id', 'nama', 'nis', 'kelas', 'angkatan']);
            } else {
                $students = collect();
            }
        } else {
            $students = DB::table('profiles')
                ->where('tenant_id', $tenantId)
                ->where('role', 'siswa')
                ->whereIn('kelas', $kelasAlias)
                ->orderBy('nama')
                ->get(['id', 'nama', 'nis', 'kelas', 'angkatan']);
        }

        $studentIds = $students->pluck('id')->toArray();

        // 3. Get Jadwal
        $jadwal = DB::table('jadwal')
            ->where('tenant_id', $tenantId)
            ->where('kelas_id', $kelas)
            ->where('tahun_ajaran', $tahunAjaran)
            ->get(['mapel', 'guru_id', 'periode_berlaku']);

        $guruIdsPengampu = $jadwal->pluck('guru_id')->filter()->unique()->toArray();

        // 4. Get Assignments & Submissions
        $tugas = DB::table('tugas')
            ->where('tenant_id', $tenantId)
            ->where('kelas', $kelas)
            ->where('tahun_ajaran', $tahunAjaran)
            ->get();

        $tugasIds = $tugas->pluck('id')->toArray();
        $jawaban = empty($tugasIds) ? [] : DB::table('tugas_jawaban')
            ->where('tenant_id', $tenantId)
            ->whereIn('tugas_id', $tugasIds)
            ->where('tahun_ajaran', $tahunAjaran)
            ->get();

        // 5. Get Quizzes & Submissions
        $quizzes = DB::table('quizzes')
            ->where('tenant_id', $tenantId)
            ->where('kelas_id', $kelas)
            ->where('tahun_ajaran', $tahunAjaran)
            ->get();

        $quizIds = $quizzes->pluck('id')->toArray();
        $submissions = empty($quizIds) ? [] : DB::table('quiz_submissions')
            ->where('tenant_id', $tenantId)
            ->whereIn('quiz_id', $quizIds)
            ->where('tahun_ajaran', $tahunAjaran)
            ->get();

        // 6. Get Attendance
        $absensiQuery = DB::table('absensi')
            ->where('tenant_id', $tenantId)
            ->where('kelas', $kelas)
            ->where('tahun_ajaran', $tahunAjaran);

        if (! empty($bulanList)) {
            $absensiQuery->where(function ($q) use ($bulanList, $tahun) {
                foreach ($bulanList as $bulan) {
                    $q->orWhere('tanggal', 'like', $tahun.'-'.str_pad($bulan, 2, '0', STR_PAD_LEFT).'-%');
                }
            });
        }
        $absensi = $absensiQuery->get();

        // 7. Get Mapel Weights
        $guruMapelBobot = empty($guruIdsPengampu) ? [] : DB::table('guru_mapel_bobot')
            ->where('tenant_id', $tenantId)
            ->whereIn('guru_id', $guruIdsPengampu)
            ->where('tahun_ajaran', $tahunAjaran)
            ->where('semester', $semester)
            ->get();

        // 8. Get Manual Grades
        $manualGrades = empty($guruIdsPengampu) || empty($studentIds) ? [] : DB::table('guru_mapel_manual_nilai')
            ->where('tenant_id', $tenantId)
            ->whereIn('guru_id', $guruIdsPengampu)
            ->whereIn('siswa_id', $studentIds)
            ->where('kelas_id', $kelas)
            ->where('tahun_ajaran', $tahunAjaran)
            ->where('semester', $semester)
            ->get();

        // 9. Get Extracurriculars
        $ekskulAnggota = empty($studentIds) ? collect() : DB::table('ekskul_anggota')
            ->where('tenant_id', $tenantId)
            ->whereIn('user_id', $studentIds)
            ->get();

        $ekskulIds = $ekskulAnggota->pluck('ekskul_id')->unique()->toArray();
        $ekskuls = empty($ekskulIds) ? [] : DB::table('ekskul')
            ->where('tenant_id', $tenantId)
            ->whereIn('id', $ekskulIds)
            ->get(['id', 'nama']);

        $absensiEskul = (empty($studentIds) || empty($ekskulIds)) ? [] : DB::table('absensi_eskul')
            ->where('tenant_id', $tenantId)
            ->whereIn('user_id', $studentIds)
            ->whereIn('ekskul_id', $ekskulIds)
            ->get(['user_id', 'ekskul_id', 'status', 'tanggal']);

        // 10. Get Rapot
        $rapotRows = empty($studentIds) ? collect() : DB::table('rapot_siswa')
            ->where('tenant_id', $tenantId)
            ->whereIn('kelas_id', $kelasAlias)
            ->whereIn('siswa_id', $studentIds)
            ->where('tahun_pelajaran', $tahunAjaran)
            ->where('semester', $semester)
            ->get();

        $rapotIds = $rapotRows->pluck('id')->toArray();
        $rapotItems = empty($rapotIds) ? [] : DB::table('rapot_siswa_items')
            ->where('tenant_id', $tenantId)
            ->whereIn('rapot_id', $rapotIds)
            ->get();

        return response()->json([
            'success' => true,
            'request_id' => $reqId,
            'data' => [
                'siswaData' => $students,
                'jadwalKelasList' => $jadwal,
                'tugasList' => $tugas,
                'jawabanList' => $jawaban,
                'quizList' => $quizzes,
                'submissionList' => $submissions,
                'absensiList' => $absensi,
                'guruMapelWeightRows' => $guruMapelBobot,
                'guruMapelManualRows' => $manualGrades,
                'ekskulList' => $ekskuls,
                'ekskulAnggotaList' => $ekskulAnggota,
                'absensiEskulList' => $absensiEskul,
                'rapotRows' => $rapotRows,
                'rapotItems' => $rapotItems,
            ],
        ]);
    }
}
