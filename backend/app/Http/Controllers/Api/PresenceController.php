<?php

namespace App\Http\Controllers\Api;

use App\Models\Profile;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PresenceController extends ApiController
{
    public function ping(Request $request)
    {
        $user = $this->user($request);
        if (! $user) {
            return response()->json(['error' => 'Unauthenticated'], 401);
        }
        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['error' => 'Tenant tidak valid'], 400);
        }

        $deviceId = trim((string) $request->input('device_id', ''));
        if ($deviceId === '') {
            return response()->json(['error' => 'device_id wajib diisi'], 422);
        }

        $activity = filter_var($request->input('activity', false), FILTER_VALIDATE_BOOLEAN);
        $now = now();

        $profile = Profile::query()->where('id', $user->id)->where('tenant_id', $tenantId)->first();
        $userAgent = substr((string) $request->header('User-Agent', ''), 0, 255);
        $presencePayload = [
            'tenant_id' => $tenantId,
            'user_id' => $user->id,
            'device_id' => $deviceId,
            'role' => $profile?->role,
            'user_agent' => $userAgent,
            'last_seen_at' => $now,
            'last_active_at' => null,
            'activity_count' => 0,
            'created_at' => $now,
            'updated_at' => $now,
        ];
        $presenceUpdatePayload = [
            'tenant_id',
            'role',
            'user_agent',
            'last_seen_at',
            'updated_at',
        ];

        try {
            DB::table('user_presence')->upsert(
                [$presencePayload],
                ['user_id', 'device_id'],
                $presenceUpdatePayload
            );
        } catch (QueryException $exception) {
            if (! $this->isDuplicatePresenceException($exception)) {
                throw $exception;
            }

            DB::table('user_presence')
                ->where('user_id', $user->id)
                ->where('device_id', $deviceId)
                ->update([
                    'tenant_id' => $tenantId,
                    'role' => $profile?->role,
                    'user_agent' => $userAgent,
                    'last_seen_at' => $now,
                    'updated_at' => $now,
                ]);
        }

        if ($activity) {
            DB::table('user_presence')
                ->where('user_id', $user->id)
                ->where('device_id', $deviceId)
                ->update([
                    'last_active_at' => $now,
                    'activity_count' => DB::raw('COALESCE(activity_count, 0) + 1'),
                    'updated_at' => $now,
                ]);
        }

        return response()->json(['data' => 'ok']);
    }

    private function isDuplicatePresenceException(QueryException $exception): bool
    {
        $code = (string) $exception->getCode();
        if ($code === '23505') {
            return true;
        }

        $message = strtolower($exception->getMessage());

        return str_contains($message, 'user_presence_user_id_device_id_unique')
            || str_contains($message, 'duplicate key');
    }
}
