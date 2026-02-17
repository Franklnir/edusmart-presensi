<?php

namespace App\Http\Controllers\Api;

use App\Models\Profile;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PresenceController extends ApiController
{
    public function ping(Request $request)
    {
        $user = $this->user($request);
        if (!$user) {
            return response()->json(['error' => 'Unauthenticated'], 401);
        }
        $tenantId = $this->tenantId($request);
        if (!$tenantId) {
            return response()->json(['error' => 'Tenant tidak valid'], 400);
        }

        $deviceId = trim((string) $request->input('device_id', ''));
        if ($deviceId === '') {
            return response()->json(['error' => 'device_id wajib diisi'], 422);
        }

        $activity = filter_var($request->input('activity', false), FILTER_VALIDATE_BOOLEAN);
        $now = now();

        $profile = Profile::query()->where('id', $user->id)->where('tenant_id', $tenantId)->first();

        $query = DB::table('user_presence')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $user->id)
            ->where('device_id', $deviceId);

        $existing = $query->first();

        if ($existing) {
            $payload = [
                'last_seen_at' => $now,
                'updated_at' => $now,
            ];

            if ($activity) {
                $payload['last_active_at'] = $now;
                $payload['activity_count'] = DB::raw('activity_count + 1');
            }

            $query->update($payload);
        } else {
            DB::table('user_presence')->insert([
                'tenant_id' => $tenantId,
                'user_id' => $user->id,
                'device_id' => $deviceId,
                'role' => $profile?->role,
                'user_agent' => substr((string) $request->header('User-Agent', ''), 0, 255),
                'last_seen_at' => $now,
                'last_active_at' => $activity ? $now : null,
                'activity_count' => $activity ? 1 : 0,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        return response()->json(['data' => 'ok']);
    }
}
