<?php

namespace App\Http\Controllers\Api;

use App\Services\WhatsApp\WhatsAppNotificationService;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class TugasController extends ApiController
{
    public function __construct(
        private readonly WhatsAppNotificationService $whatsAppNotificationService
    ) {}

    public function index(Request $request)
    {
        $query = DB::table('tugas');

        if ($this->isAdmin($request)) {
            // full
        } elseif ($this->isGuru($request)) {
            $query->where('created_by', $request->user()->id);
        } else {
            $kelas = $this->currentKelas($request);
            $query->where('kelas', $kelas);
        }

        if ($kelas = $request->query('kelas')) {
            $query->where('kelas', $kelas);
        }
        if ($mapel = $request->query('mapel')) {
            $query->where('mapel', $mapel);
        }
        if ($createdBy = $request->query('created_by')) {
            $query->where('created_by', $createdBy);
        }
        if ($gte = $request->query('deadline_gte')) {
            $query->where('deadline', '>=', $gte);
        }
        if ($lt = $request->query('deadline_lt')) {
            $query->where('deadline', '<', $lt);
        }
        if ($gteCreated = $request->query('created_gte')) {
            $query->where('created_at', '>=', $gteCreated);
        }

        $query->orderBy($request->query('order_by', 'created_at'), $request->query('order', 'desc'));

        $this->applyPagination($query, $request);

        return response()->json(['data' => $query->get()]);
    }

    public function show(Request $request, string $id)
    {
        $tugas = DB::table('tugas')->where('id', $id)->first();
        if (! $tugas) {
            return $this->deny('Tugas tidak ditemukan', 404);
        }

        if ($this->isAdmin($request)) {
            return response()->json(['data' => $tugas]);
        }

        if ($this->isGuru($request) && $tugas->created_by === $request->user()->id) {
            return response()->json(['data' => $tugas]);
        }

        if ($this->isSiswa($request) && $tugas->kelas === $this->currentKelas($request)) {
            return response()->json(['data' => $tugas]);
        }

        return $this->deny();
    }

    public function store(Request $request)
    {
        if (! $this->isGuru($request) && ! $this->isAdmin($request)) {
            return $this->deny();
        }

        $payload = $request->all();
        if (! $this->isAdmin($request)) {
            $payload['created_by'] = $request->user()->id;
        }
        $payload['created_at'] = now();
        $payload['updated_at'] = now();
        DB::table('tugas')->insert($payload);

        return response()->json(['data' => $payload], 201);
    }

    public function update(Request $request, string $id)
    {
        $tugas = DB::table('tugas')->where('id', $id)->first();
        if (! $tugas) {
            return $this->deny('Tugas tidak ditemukan', 404);
        }

        if ($this->isAdmin($request)) {
            // ok
        } elseif ($this->isGuru($request) && $tugas->created_by === $request->user()->id) {
            // ok
        } else {
            return $this->deny();
        }

        $payload = $request->all();
        $payload['updated_at'] = now();
        DB::table('tugas')->where('id', $id)->update($payload);
        $row = DB::table('tugas')->where('id', $id)->first();

        return response()->json(['data' => $row]);
    }

    public function destroy(Request $request, string $id)
    {
        $tugas = DB::table('tugas')->where('id', $id)->first();
        if (! $tugas) {
            return $this->deny('Tugas tidak ditemukan', 404);
        }

        if ($this->isAdmin($request) || ($this->isGuru($request) && $tugas->created_by === $request->user()->id)) {
            DB::table('tugas')->where('id', $id)->delete();

            return response()->json(['data' => 'deleted']);
        }

        return $this->deny();
    }

    public function jawabanIndex(Request $request)
    {
        $query = DB::table('tugas_jawaban');

        if ($this->isAdmin($request)) {
            // full
        } elseif ($this->isGuru($request)) {
            $query->whereIn('tugas_id', function ($q) use ($request) {
                $q->select('id')->from('tugas')->where('created_by', $request->user()->id);
            });
        } else {
            $query->where('user_id', $request->user()->id);
        }

        if ($tugasId = $request->query('tugas_id')) {
            $query->where('tugas_id', $tugasId);
        }
        if ($userId = $request->query('user_id')) {
            $query->where('user_id', $userId);
        }

        $this->applyPagination($query, $request);

        return response()->json(['data' => $query->get()]);
    }

    public function jawabanStore(Request $request)
    {
        $payload = $request->all();
        $userId = $request->user()->id;

        if ($this->isSiswa($request)) {
            $payload['user_id'] = $userId;
        } elseif ($this->isGuru($request)) {
            // ensure guru owns tugas
            $tugas = DB::table('tugas')->where('id', $payload['tugas_id'] ?? null)->first();
            if (! $tugas || $tugas->created_by !== $userId) {
                return $this->deny();
            }
        } elseif (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $payload['waktu_submit'] = $payload['waktu_submit'] ?? now();
        DB::table('tugas_jawaban')->insert($payload);

        return response()->json(['data' => $payload], 201);
    }

    public function jawabanUpdate(Request $request, string $id)
    {
        $jawaban = DB::table('tugas_jawaban')->where('id', $id)->first();
        if (! $jawaban) {
            return $this->deny('Jawaban tidak ditemukan', 404);
        }

        $userId = $request->user()->id;
        if ($this->isAdmin($request)) {
            // ok
        } elseif ($this->isGuru($request)) {
            $tugas = DB::table('tugas')->where('id', $jawaban->tugas_id)->first();
            if (! $tugas || $tugas->created_by !== $userId) {
                return $this->deny();
            }
        } elseif ($this->isSiswa($request)) {
            if ($jawaban->user_id !== $userId) {
                return $this->deny();
            }
        } else {
            return $this->deny();
        }

        $payload = $request->all();
        DB::table('tugas_jawaban')->where('id', $id)->update($payload);
        $row = DB::table('tugas_jawaban')->where('id', $id)->first();

        return response()->json(['data' => $row]);
    }

    public function jawabanDestroy(Request $request, string $id)
    {
        $jawaban = DB::table('tugas_jawaban')->where('id', $id)->first();
        if (! $jawaban) {
            return $this->deny('Jawaban tidak ditemukan', 404);
        }

        $userId = $request->user()->id;
        if ($this->isAdmin($request)) {
            // ok
        } elseif ($this->isGuru($request)) {
            $tugas = DB::table('tugas')->where('id', $jawaban->tugas_id)->first();
            if (! $tugas || $tugas->created_by !== $userId) {
                return $this->deny();
            }
        } elseif ($this->isSiswa($request)) {
            if ($jawaban->user_id !== $userId) {
                return $this->deny();
            }
        } else {
            return $this->deny();
        }

        DB::table('tugas_jawaban')->where('id', $id)->delete();

        return response()->json(['data' => 'deleted']);
    }

    public function submitJawaban(Request $request)
    {
        if (! $this->isSiswa($request)) {
            return $this->deny();
        }

        $userId = (string) $request->user()->id;
        $tenantId = (string) ($this->tenantId($request) ?? $this->profileTenantId($request) ?? '');
        $kelas = (string) ($this->currentKelas($request) ?? '');
        $tugasId = trim((string) $request->input('tugas_id', ''));

        if ($kelas === '' || $tugasId === '') {
            return $this->deny('Tugas tidak diizinkan', 422);
        }

        $lockKey = 'assignment-submit|'.sha1($tenantId.'|'.$tugasId.'|'.$userId);
        $lock = Cache::lock($lockKey, 15);
        if (! $lock->get()) {
            return $this->deny('Jawaban sedang diproses. Tunggu beberapa detik lalu cek kembali.', 429);
        }

        try {
            $result = DB::transaction(function () use ($request, $tenantId, $kelas, $tugasId, $userId) {
                $tugasQuery = DB::table('tugas')->where('id', $tugasId)->where('kelas', $kelas);
                $this->applyTenantColumnFilter($tugasQuery, 'tugas', $tenantId);
                $tugas = $tugasQuery->first();
                if (! $tugas) {
                    return ['error' => 'Tugas tidak diizinkan', 'status' => 422];
                }

                $availabilityError = $this->tugasAvailabilityError($tugas);
                if ($availabilityError !== null) {
                    return ['error' => $availabilityError, 'status' => 422];
                }

                $existingQuery = DB::table('tugas_jawaban')
                    ->where('tugas_id', $tugasId)
                    ->where('user_id', $userId);
                $this->applyTenantColumnFilter($existingQuery, 'tugas_jawaban', $tenantId);
                $existing = $existingQuery->lockForUpdate()->first();

                if ($existing && $this->isJawabanDinilai($existing)) {
                    return ['error' => 'Jawaban yang sudah dinilai tidak boleh diubah', 'status' => 422];
                }

                $payload = $this->buildStudentAnswerPayload($request, $tenantId, $tugasId, $userId);
                $beforeRows = $existing ? [(array) $existing] : [];

                if ($existing) {
                    $update = $payload;
                    unset($update['tugas_id'], $update['user_id'], $update['tenant_id']);

                    $target = DB::table('tugas_jawaban')->where('id', $existing->id);
                    $this->applyTenantColumnFilter($target, 'tugas_jawaban', $tenantId);
                    $target->update($update);

                    $id = $existing->id;
                    $action = 'update';
                } else {
                    $id = DB::table('tugas_jawaban')->insertGetId($payload);
                    $action = 'insert';
                }

                $rowQuery = DB::table('tugas_jawaban')->where('id', $id);
                $this->applyTenantColumnFilter($rowQuery, 'tugas_jawaban', $tenantId);
                $row = $rowQuery->first();

                $this->notifyTugasJawabanMutation($tenantId, $action, $beforeRows, $row ? [(array) $row] : []);

                return ['row' => $row];
            });
        } finally {
            optional($lock)->release();
        }

        if (isset($result['error'])) {
            return $this->deny($result['error'], (int) ($result['status'] ?? 422));
        }

        return response()->json(['data' => $result['row'] ?? null]);
    }

    private function applyTenantColumnFilter($query, string $table, string $tenantId): void
    {
        if ($tenantId !== '' && Schema::hasColumn($table, 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }
    }

    private function buildStudentAnswerPayload(Request $request, string $tenantId, string $tugasId, string $userId): array
    {
        $payload = [
            'tugas_id' => $tugasId,
            'user_id' => $userId,
            'file_url' => $this->nullableTrimmedString($request->input('file_url')),
            'link_url' => $this->nullableUrl($request->input('link_url')),
            'file_name' => $this->nullableTrimmedString($request->input('file_name')),
            'waktu_submit' => now(),
            'status' => 'menunggu',
        ];

        if (Schema::hasColumn('tugas_jawaban', 'tenant_id') && $tenantId !== '') {
            $payload['tenant_id'] = $tenantId;
        }

        if (Schema::hasColumn('tugas_jawaban', 'file_urls')) {
            $fileUrls = $request->input('file_urls');
            $payload['file_urls'] = is_array($fileUrls)
                ? json_encode(array_values(array_filter(array_map(
                    fn ($value) => $this->nullableTrimmedString($value),
                    $fileUrls
                ))))
                : null;
        }

        if (Schema::hasColumn('tugas_jawaban', 'komentar_siswa')) {
            $comment = $this->nullableTrimmedString($request->input('komentar_siswa'));
            $payload['komentar_siswa'] = $comment ? mb_substr($comment, 0, 500) : null;
        }

        foreach (['tahun_ajaran', 'semester', 'angkatan'] as $column) {
            if (Schema::hasColumn('tugas_jawaban', $column) && $request->filled($column)) {
                $payload[$column] = $this->nullableTrimmedString($request->input($column));
            }
        }

        return array_filter(
            $payload,
            fn ($value, $key) => Schema::hasColumn('tugas_jawaban', (string) $key) && $value !== '',
            ARRAY_FILTER_USE_BOTH
        );
    }

    private function tugasAvailabilityError(object $tugas): ?string
    {
        $now = now();
        $mulai = $this->parseDateTime($tugas->mulai ?? $tugas->created_at ?? null);
        $deadline = $this->parseDateTime($tugas->deadline ?? null);

        if ($mulai && $now->lt($mulai)) {
            return 'Tugas belum dibuka';
        }

        if ($deadline && $now->gt($deadline)) {
            return 'Deadline tugas sudah lewat';
        }

        return null;
    }

    private function parseDateTime($value): ?Carbon
    {
        if (! $value) {
            return null;
        }

        try {
            return Carbon::parse($value);
        } catch (\Throwable) {
            return null;
        }
    }

    private function isJawabanDinilai(object $row): bool
    {
        return $row->nilai !== null || strtolower((string) ($row->status ?? '')) === 'dinilai';
    }

    private function nullableTrimmedString($value): ?string
    {
        $text = trim((string) ($value ?? ''));

        return $text === '' ? null : $text;
    }

    private function nullableUrl($value): ?string
    {
        $url = $this->nullableTrimmedString($value);
        if (! $url) {
            return null;
        }

        return filter_var($url, FILTER_VALIDATE_URL) ? $url : null;
    }

    private function notifyTugasJawabanMutation(string $tenantId, string $action, array $beforeRows, array $afterRows): void
    {
        if ($tenantId === '') {
            return;
        }

        try {
            $this->whatsAppNotificationService->handleTableMutation(
                $tenantId,
                'tugas_jawaban',
                $action,
                $beforeRows,
                $afterRows
            );
        } catch (\Throwable) {
            // Notifikasi tidak boleh menghambat submit jawaban siswa.
        }
    }
}
