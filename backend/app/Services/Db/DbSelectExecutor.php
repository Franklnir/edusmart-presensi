<?php

namespace App\Services\Db;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DbSelectExecutor
{
    public function execute(Request $request, $query, array $context, array $callbacks): JsonResponse
    {
        $table = (string) ($context['table'] ?? '');
        $tenantId = $context['tenant_id'] ?? null;
        $user = $context['user'] ?? null;
        $profile = $context['profile'] ?? null;
        $isAdmin = (bool) ($context['is_admin'] ?? false);
        $limit = $context['limit'] ?? null;
        $offset = $context['offset'] ?? null;

        $countRequested = $request->input('count');
        $head = (bool) $request->input('head', false);
        $count = null;

        if ($countRequested) {
            $countQuery = clone $query;
            $count = $countQuery->count();
        }

        if ($limit !== null) {
            $query->limit((int) $limit);
        }
        if ($offset !== null) {
            $query->offset((int) $offset);
        }

        $columns = $request->input('columns', '*');
        $relationSelects = is_string($columns)
            ? $callbacks['parse_relation_selects']($table, $columns)
            : [];
        if ($columns && $columns !== '*') {
            $parsed = $callbacks['parse_columns']($table, $columns);
            foreach ($relationSelects as $relation) {
                $localKey = (string) ($relation['local_key'] ?? '');
                if (
                    $localKey !== ''
                    && $callbacks['is_selectable_column']($table, $localKey)
                    && ! in_array($localKey, $parsed, true)
                ) {
                    $parsed[] = $localKey;
                }
            }
            if (! empty($parsed)) {
                $query->select($parsed);
            }
        }

        $data = $head ? [] : $query->get();

        if (! $head && $table === 'settings' && ! $isAdmin) {
            $data = $callbacks['sanitize_public_settings_rows']($data);
        }

        if (! $head && $table === 'profiles' && ! $isAdmin) {
            $viewerRole = strtolower((string) ($profile?->role ?? ''));
            $waliKelas = [];
            if ($viewerRole === 'guru' && $user?->id) {
                $waliKelas = $callbacks['guru_wali_kelas_ids']((string) $user->id);
            }
            $data = $callbacks['sanitize_profiles_for_non_admin'](
                $data,
                (string) ($user?->id ?? ''),
                $viewerRole,
                $waliKelas
            );
        }

        if (! $head && $table === 'quizzes') {
            $data = $callbacks['sanitize_quiz_rows']($data);
        }

        if (! $head && ! empty($relationSelects)) {
            $data = $callbacks['hydrate_relation_selects']($data, $relationSelects, $tenantId);
        }

        return response()->json(['data' => $data, 'count' => $count]);
    }
}
