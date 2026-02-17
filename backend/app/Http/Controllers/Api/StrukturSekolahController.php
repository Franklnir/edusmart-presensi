<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class StrukturSekolahController extends ApiController
{
    public function index()
    {
        $rows = DB::table('struktur_sekolah')->orderBy('jabatan')->get();
        return response()->json(['data' => $rows]);
    }

    public function store(Request $request)
    {
        if (!$this->isAdmin($request)) return $this->deny();
        $payload = $request->all();
        $payload['created_at'] = now();
        $payload['updated_at'] = now();
        DB::table('struktur_sekolah')->insert($payload);
        return response()->json(['data' => $payload], 201);
    }

    public function update(Request $request, string $id)
    {
        if (!$this->isAdmin($request)) return $this->deny();
        $payload = $request->all();
        $payload['updated_at'] = now();
        DB::table('struktur_sekolah')->where('id', $id)->update($payload);
        $row = DB::table('struktur_sekolah')->where('id', $id)->first();
        return response()->json(['data' => $row]);
    }

    public function destroy(Request $request, string $id)
    {
        if (!$this->isAdmin($request)) return $this->deny();
        DB::table('struktur_sekolah')->where('id', $id)->delete();
        return response()->json(['data' => 'deleted']);
    }
}
