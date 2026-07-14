<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use App\Models\Profile;

class JamKosongController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        if (!in_array($request->user()->profile->role, ['admin', 'guru'])) { abort(403, 'Unauthorized'); } 
        $tenantId = $request->attributes->get('tenant_id');

        $query = DB::table('jam_kosong as jk')
            ->join('profiles as p', 'jk.created_by', '=', 'p.id')
            ->where('p.tenant_id', $tenantId)
            ->select('jk.*');
        
        $limit = min((int) $request->query('per_page', 50), 200);
        
        $data = $query->orderBy('jk.tanggal', 'desc')->orderBy('jk.jam_mulai')->paginate($limit)->appends($request->query());

        return response()->json([
            'success' => true,
            'data' => $data->items(),
            'meta' => [
                'current_page' => $data->currentPage(),
                'last_page' => $data->lastPage(),
                'per_page' => $data->perPage(),
                'total' => $data->total(),
            ]
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        if (!in_array($request->user()->profile->role, ['admin', 'guru'])) { abort(403, 'Unauthorized'); }
        $tenantId = $request->attributes->get('tenant_id');
        $userId = $request->user()?->id;

        $request->validate([
            'tanggal' => 'required|date',
            'kelas' => 'required|string',
            'mapel' => 'required|string',
            'jam_mulai' => 'required|string',
            'jam_selesai' => 'required|string',
            'alasan' => 'required|string',
            'guru_pengganti' => 'nullable|string',
        ]);

        $id = DB::table('jam_kosong')->insertGetId([
            'tanggal' => $request->input('tanggal'),
            'kelas' => $request->input('kelas'),
            'mapel' => $request->input('mapel'),
            'jam_mulai' => $request->input('jam_mulai'),
            'jam_selesai' => $request->input('jam_selesai'),
            'alasan' => $request->input('alasan'),
            'guru_pengganti' => $request->input('guru_pengganti'),
            'created_by' => $userId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $entry = DB::table('jam_kosong')->where('id', $id)->first();

        return response()->json([
            'success' => true,
            'message' => 'Jam Kosong berhasil ditambahkan.',
            'data' => $entry,
        ], 201);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        if (!in_array($request->user()->profile->role, ['admin', 'guru'])) { abort(403, 'Unauthorized'); }
        $tenantId = $request->attributes->get('tenant_id');

        // Check if the jam_kosong belongs to this tenant
        $exists = DB::table('jam_kosong as jk')
            ->join('profiles as p', 'jk.created_by', '=', 'p.id')
            ->where('jk.id', $id)
            ->where('p.tenant_id', $tenantId)
            ->exists();

        if (!$exists) {
            return response()->json(['success' => false, 'message' => 'Not found'], 404);
        }

        DB::table('jam_kosong')->where('id', $id)->delete();

        return response()->json([
            'success' => true,
            'message' => 'Jam Kosong berhasil dihapus.',
        ]);
    }
}
