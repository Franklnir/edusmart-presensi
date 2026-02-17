<?php

namespace App\Http\Controllers;

use App\Models\Setting;
use Illuminate\Http\Request;

class SettingsController extends Controller
{
    public function show()
    {
        $tenantId = request()->attributes->get('tenant_id');
        $query = Setting::query()->orderBy('id');
        if ($tenantId) {
            $query->where('tenant_id', $tenantId);
        }
        $settings = $query->first();
        return response()->json($settings);
    }

    public function update(Request $request)
    {
        $user = $request->user();
        if (!$user || $user->profile?->role !== 'admin') {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $tenantId = $request->attributes->get('tenant_id');
        $query = Setting::query()->orderBy('id');
        if ($tenantId) {
            $query->where('tenant_id', $tenantId);
        }
        $settings = $query->first();
        if (!$settings) {
            $settings = new Setting();
            if ($tenantId) {
                $settings->tenant_id = $tenantId;
            }
        }

        $settings->fill($request->all());
        $settings->save();

        return response()->json($settings);
    }
}
