<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class TugasController extends ApiController
{
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

        if ($kelas = $request->query('kelas')) $query->where('kelas', $kelas);
        if ($mapel = $request->query('mapel')) $query->where('mapel', $mapel);
        if ($createdBy = $request->query('created_by')) $query->where('created_by', $createdBy);
        if ($gte = $request->query('deadline_gte')) $query->where('deadline', '>=', $gte);
        if ($lt = $request->query('deadline_lt')) $query->where('deadline', '<', $lt);
        if ($gteCreated = $request->query('created_gte')) $query->where('created_at', '>=', $gteCreated);

        $query->orderBy($request->query('order_by', 'created_at'), $request->query('order', 'desc'));

        $this->applyPagination($query, $request);
        return response()->json(['data' => $query->get()]);
    }

    public function show(Request $request, string $id)
    {
        $tugas = DB::table('tugas')->where('id', $id)->first();
        if (!$tugas) return $this->deny('Tugas tidak ditemukan', 404);

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
        if (!$this->isGuru($request) && !$this->isAdmin($request)) return $this->deny();

        $payload = $request->all();
        if (!$this->isAdmin($request)) {
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
        if (!$tugas) return $this->deny('Tugas tidak ditemukan', 404);

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
        if (!$tugas) return $this->deny('Tugas tidak ditemukan', 404);

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

        if ($tugasId = $request->query('tugas_id')) $query->where('tugas_id', $tugasId);
        if ($userId = $request->query('user_id')) $query->where('user_id', $userId);

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
            if (!$tugas || $tugas->created_by !== $userId) return $this->deny();
        } else if (!$this->isAdmin($request)) {
            return $this->deny();
        }

        $payload['waktu_submit'] = $payload['waktu_submit'] ?? now();
        DB::table('tugas_jawaban')->insert($payload);
        return response()->json(['data' => $payload], 201);
    }

    public function jawabanUpdate(Request $request, string $id)
    {
        $jawaban = DB::table('tugas_jawaban')->where('id', $id)->first();
        if (!$jawaban) return $this->deny('Jawaban tidak ditemukan', 404);

        $userId = $request->user()->id;
        if ($this->isAdmin($request)) {
            // ok
        } elseif ($this->isGuru($request)) {
            $tugas = DB::table('tugas')->where('id', $jawaban->tugas_id)->first();
            if (!$tugas || $tugas->created_by !== $userId) return $this->deny();
        } elseif ($this->isSiswa($request)) {
            if ($jawaban->user_id !== $userId) return $this->deny();
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
        if (!$jawaban) return $this->deny('Jawaban tidak ditemukan', 404);

        $userId = $request->user()->id;
        if ($this->isAdmin($request)) {
            // ok
        } elseif ($this->isGuru($request)) {
            $tugas = DB::table('tugas')->where('id', $jawaban->tugas_id)->first();
            if (!$tugas || $tugas->created_by !== $userId) return $this->deny();
        } elseif ($this->isSiswa($request)) {
            if ($jawaban->user_id !== $userId) return $this->deny();
        } else {
            return $this->deny();
        }

        DB::table('tugas_jawaban')->where('id', $id)->delete();
        return response()->json(['data' => 'deleted']);
    }
}
