<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class JadwalController extends ApiController
{
    public function index(Request $request)
    {
        $query = DB::table('jadwal');

        if ($this->isAdmin($request)) {
            // full
        } elseif ($this->isGuru($request)) {
            $query->where('guru_id', $request->user()->id);
        } else {
            $kelas = $this->currentKelas($request);
            if ($kelas) {
                $query->where('kelas_id', $kelas);
            } else {
                return response()->json(['data' => []]);
            }
        }

        if ($kelasId = $request->query('kelas_id')) {
            $query->where('kelas_id', $kelasId);
        }
        if ($guruId = $request->query('guru_id')) {
            $query->where('guru_id', $guruId);
        }
        if ($hari = $request->query('hari')) {
            $query->where('hari', $hari);
        }

        $query->orderBy('hari')->orderBy('jam_mulai');

        return response()->json(['data' => $query->get()]);
    }

    public function store(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }
        $payload = $request->all();
        $payload['created_at'] = now();
        $payload['updated_at'] = now();
        DB::table('jadwal')->insert($payload);

        return response()->json(['data' => $payload], 201);
    }

    public function update(Request $request, string $id)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }
        $payload = $request->all();
        $payload['updated_at'] = now();
        DB::table('jadwal')->where('id', $id)->update($payload);
        $row = DB::table('jadwal')->where('id', $id)->first();

        return response()->json(['data' => $row]);
    }

    public function destroy(Request $request, string $id)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }
        DB::table('jadwal')->where('id', $id)->delete();

        return response()->json(['data' => 'deleted']);
    }
}
