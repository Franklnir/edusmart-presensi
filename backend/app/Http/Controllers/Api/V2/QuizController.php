<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

class QuizController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant_id');
        $role = $request->user()?->profile?->role;

        $query = DB::table('quizzes')->where('tenant_id', $tenantId);

        if ($role === 'guru') {
            $query->where('guru_id', $request->user()->id);
        } elseif ($role === 'siswa') {
            $query->where('is_active', true)
                  ->where('kelas_id', $request->user()->profile->kelas);
        }

        $limit = min((int) $request->query('per_page', 50), 200);
        
        $quizzes = $query->orderBy('created_at', 'desc')->paginate($limit)->appends($request->query());

        return response()->json([
            'success' => true,
            'data' => $quizzes->items(),
            'meta' => [
                'current_page' => $quizzes->currentPage(),
                'last_page' => $quizzes->lastPage(),
                'per_page' => $quizzes->perPage(),
                'total' => $quizzes->total(),
            ]
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $role = $request->user()?->profile?->role;
        if (!in_array($role, ['admin', 'guru'])) {
            abort(403, 'Unauthorized');
        }

        $tenantId = $request->attributes->get('tenant_id');
        $userId = $request->user()?->id;

        $request->validate([
            'nama' => 'required|string|max:255',
            'kelas_id' => 'required|string',
            'mapel' => 'required|string',
            'duration_minutes' => 'nullable|integer|min:1',
            'starts_at' => 'nullable|date',
            'deadline_at' => 'nullable|date',
            'is_active' => 'boolean',
        ]);

        $id = $request->input('id') ?: (string) Str::uuid();

        DB::table('quizzes')->insert([
            'id' => $id,
            'tenant_id' => $tenantId,
            'nama' => $request->input('nama'),
            'kelas_id' => $request->input('kelas_id'),
            'mapel' => $request->input('mapel'),
            'duration_minutes' => $request->input('duration_minutes'),
            'starts_at' => $request->input('starts_at'),
            'deadline_at' => $request->input('deadline_at'),
            'is_active' => $request->input('is_active', false),
            'guru_id' => $userId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $quiz = DB::table('quizzes')->where('id', $id)->first();

        return response()->json([
            'success' => true,
            'message' => 'Quiz berhasil dibuat.',
            'data' => $quiz,
        ], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $role = $request->user()?->profile?->role;
        if (!in_array($role, ['admin', 'guru'])) {
            abort(403, 'Unauthorized');
        }

        $tenantId = $request->attributes->get('tenant_id');

        $quiz = DB::table('quizzes')->where('tenant_id', $tenantId)->where('id', $id)->first();
        if (!$quiz) {
            return response()->json(['success' => false, 'message' => 'Not found'], 404);
        }

        if ($role === 'guru' && $quiz->guru_id !== $request->user()->id) {
            abort(403, 'Unauthorized');
        }

        $request->validate([
            'nama' => 'sometimes|string|max:255',
            'kelas_id' => 'sometimes|string',
            'mapel' => 'sometimes|string',
            'duration_minutes' => 'sometimes|nullable|integer|min:1',
            'starts_at' => 'nullable|date',
            'deadline_at' => 'nullable|date',
            'is_active' => 'sometimes|boolean',
            'is_live' => 'sometimes|boolean',
            'result_visible_to_students' => 'sometimes|boolean',
            'mode' => 'sometimes|string'
        ]);

        $updateData = [];
        foreach (['nama', 'kelas_id', 'mapel', 'duration_minutes', 'starts_at', 'deadline_at', 'is_active', 'is_live', 'result_visible_to_students', 'mode'] as $field) {
            if ($request->has($field)) {
                $updateData[$field] = $request->input($field);
            }
        }
        
        if ($request->has('is_live') && $request->input('is_live')) {
            $updateData['live_started_at'] = now();
        }

        if (!empty($updateData)) {
            $updateData['updated_at'] = now();
            DB::table('quizzes')->where('id', $id)->update($updateData);
        }

        $quiz = DB::table('quizzes')->where('id', $id)->first();

        return response()->json([
            'success' => true,
            'message' => 'Quiz berhasil diperbarui.',
            'data' => $quiz,
        ]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $role = $request->user()?->profile?->role;
        if (!in_array($role, ['admin', 'guru'])) {
            abort(403, 'Unauthorized');
        }

        $tenantId = $request->attributes->get('tenant_id');

        $quiz = DB::table('quizzes')->where('tenant_id', $tenantId)->where('id', $id)->first();
        if (!$quiz) {
            return response()->json(['success' => false, 'message' => 'Not found'], 404);
        }

        if ($role === 'guru' && $quiz->guru_id !== $request->user()->id) {
            abort(403, 'Unauthorized');
        }

        DB::table('quizzes')->where('id', $id)->delete();

        return response()->json([
            'success' => true,
            'message' => 'Quiz berhasil dihapus.',
        ]);
    }
}
