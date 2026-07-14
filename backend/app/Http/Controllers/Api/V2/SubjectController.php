<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

class SubjectController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        if ($request->user()->profile->role !== 'admin') { abort(403, 'Unauthorized'); } 
        
        $query = DB::table('mata_pelajaran');
        
        $limit = min((int) $request->query('per_page', 50), 200);
        
        $subjects = $query->orderBy('nama')->paginate($limit)->appends($request->query());

        return response()->json([
            'success' => true,
            'data' => $subjects->items(),
            'meta' => [
                'current_page' => $subjects->currentPage(),
                'last_page' => $subjects->lastPage(),
                'per_page' => $subjects->perPage(),
                'total' => $subjects->total(),
            ]
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        if ($request->user()->profile->role !== 'admin') { abort(403, 'Unauthorized'); }

        $request->validate([
            'nama' => 'required|string|max:255',
        ]);

        // Karena legacy tidak mendukung duplikat nama, kita bisa handle atau biarkan insert unique error (tapi tidak ada unique constraint di migrasi).
        // Cek kalau ada:
        $existing = DB::table('mata_pelajaran')->where('nama', $request->input('nama'))->first();
        if ($existing) {
             return response()->json([
                'success' => true,
                'message' => 'Mata pelajaran sudah ada.',
                'data' => $existing,
            ], 200);
        }

        $id = $request->input('nama'); // ID biasanya sama dengan nama di legacy
        DB::table('mata_pelajaran')->insert([
            'id' => $id,
            'nama' => $request->input('nama'),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $subject = DB::table('mata_pelajaran')->where('id', $id)->first();

        return response()->json([
            'success' => true,
            'message' => 'Mata pelajaran berhasil ditambahkan.',
            'data' => $subject,
        ], 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        if ($request->user()->profile->role !== 'admin') { abort(403, 'Unauthorized'); }

        $subject = DB::table('mata_pelajaran')->where('id', $id)->first();
        if (!$subject) {
            return response()->json(['success' => false, 'message' => 'Not found'], 404);
        }

        return response()->json([
            'success' => true,
            'data' => $subject,
        ]);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        if ($request->user()->profile->role !== 'admin') { abort(403, 'Unauthorized'); }

        $request->validate([
            'nama' => 'required|string|max:255',
        ]);

        $affected = DB::table('mata_pelajaran')
            ->where('id', $id)
            ->update([
                'nama' => $request->input('nama'),
                'updated_at' => now(),
            ]);

        if ($affected === 0 && !DB::table('mata_pelajaran')->where('id', $id)->exists()) {
             return response()->json(['success' => false, 'message' => 'Not found'], 404);
        }

        $subject = DB::table('mata_pelajaran')->where('id', $id)->first();

        return response()->json([
            'success' => true,
            'message' => 'Mata pelajaran berhasil diperbarui.',
            'data' => $subject,
        ]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        if ($request->user()->profile->role !== 'admin') { abort(403, 'Unauthorized'); }

        $affected = DB::table('mata_pelajaran')
            ->where('id', $id)
            ->delete();

        if ($affected === 0) {
            return response()->json(['success' => false, 'message' => 'Not found'], 404);
        }

        return response()->json([
            'success' => true,
            'message' => 'Mata pelajaran berhasil dihapus.',
        ]);
    }
}
