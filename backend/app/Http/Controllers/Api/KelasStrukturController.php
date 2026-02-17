<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class KelasStrukturController extends ApiController
{
    public function show(Request $request, string $kelasId)
    {
        $row = DB::table('kelas_struktur')->where('kelas_id', $kelasId)->first();
        return response()->json(['data' => $row]);
    }

    public function upsert(Request $request, string $kelasId)
    {
        if (!$this->isAdmin($request)) return $this->deny();
        $payload = $request->all();
        $payload['kelas_id'] = $kelasId;
        $payload['updated_at'] = now();

        $exists = DB::table('kelas_struktur')->where('kelas_id', $kelasId)->exists();
        if ($exists) {
            DB::table('kelas_struktur')->where('kelas_id', $kelasId)->update($payload);
        } else {
            $payload['created_at'] = now();
            DB::table('kelas_struktur')->insert($payload);
        }

        $row = DB::table('kelas_struktur')->where('kelas_id', $kelasId)->first();
        return response()->json(['data' => $row]);
    }
}
