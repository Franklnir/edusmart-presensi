<?php

namespace App\Services\Rfid;

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class RfidScanService
{
    private function normalizeMode(?string $mode): string
    {
        $m = Str::lower(trim((string) $mode));
        if (in_array($m, ['enroll', 'register'])) {
            return 'enroll';
        }

        return 'auto';
    }

    public function processScanByTenantSlug(string $tenantSlug, string $cardUid, ?string $deviceId = null, ?string $mode = null): array
    {
        $tenantSlug = trim($tenantSlug);
        if ($tenantSlug === '') {
            return $this->result(422, [
                'success' => false,
                'reason' => 'tenant_required',
                'message' => 'tenant_slug wajib diisi',
            ]);
        }

        $tenant = $this->resolveTenantBySlug($tenantSlug);
        if (!$tenant) {
            return $this->result(404, [
                'success' => false,
                'reason' => 'tenant_not_found',
                'message' => 'tenant_slug tidak ditemukan',
            ]);
        }

        if ($this->isTenantBlocked((string) ($tenant->status ?? 'active'))) {
            return $this->result(423, [
                'success' => false,
                'reason' => 'tenant_blocked',
                'message' => 'Tenant tidak aktif',
                'tenant_slug' => $tenant->slug,
            ]);
        }

        $cardUid = $this->normalizeCardUid($cardUid);
        if ($cardUid === '' || !preg_match('/^[0-9A-F]{8,32}$/', $cardUid)) {
            return $this->result(422, [
                'success' => false,
                'reason' => 'invalid_card_uid',
                'message' => 'Format card_uid tidak valid (8-32 karakter heksadesimal)',
            ]);
        }

        $mode = $this->normalizeMode($mode);

        // Jika mode enroll, kita hanya simpan datanya ke rfid_scans agar ditangkap oleh dashboard
        if ($mode === 'enroll') {
            try {
                $scanId = DB::table('rfid_scans')->insertGetId([
                    'tenant_id' => $tenant->id,
                    'device_id' => trim((string) $deviceId) ?: 'RFID_DEVICE',
                    'card_uid' => $cardUid,
                    'status' => 'raw',
                    'created_at' => now(),
                ]);

                return $this->result(200, [
                    'success' => true,
                    'reason' => 'enroll_success',
                    'message' => 'UID terdeteksi (Mode Enroll)',
                    'card_uid' => $cardUid,
                    'scan_id' => $scanId,
                    'tenant_slug' => $tenant->slug,
                ]);
            } catch (\Throwable $e) {
                return $this->result(500, [
                    'success' => false,
                    'reason' => 'enroll_failed',
                    'message' => 'Gagal menyimpan data enroll',
                ]);
            }
        }

        $deviceId = trim((string) $deviceId);
        $deviceId = $deviceId !== '' ? $deviceId : 'RFID_DEVICE';

        try {
            $row = DB::selectOne(
                'select public.absensi_rfid_auto(?, ?, ?) as result',
                [$cardUid, $deviceId, (string) $tenant->id]
            );
        } catch (QueryException $e) {
            if ($this->isMissingFunctionException($e->getMessage())) {
                return $this->result(503, [
                    'success' => false,
                    'reason' => 'rfid_function_not_ready',
                    'message' => 'Fungsi absensi_rfid_auto belum tersedia. Jalankan migrate terbaru.',
                ]);
            }

            return $this->result(500, [
                'success' => false,
                'reason' => 'db_error',
                'message' => 'Gagal memproses scan RFID',
            ]);
        } catch (\Throwable $e) {
            return $this->result(500, [
                'success' => false,
                'reason' => 'server_error',
                'message' => 'Terjadi kesalahan internal saat memproses scan RFID',
            ]);
        }

        $data = $this->decodeFunctionResult($row->result ?? null);
        if (!is_array($data)) {
            return $this->result(500, [
                'success' => false,
                'reason' => 'invalid_result',
                'message' => 'Response fungsi RFID tidak valid',
            ]);
        }

        $data['tenant_id'] = (string) $tenant->id;
        $data['tenant_slug'] = (string) $tenant->slug;

        return $this->result(200, $data);
    }

    public function modeByTenantSlug(string $tenantSlug): array
    {
        $tenantSlug = trim($tenantSlug);
        if ($tenantSlug === '') {
            return $this->result(422, [
                'success' => false,
                'reason' => 'tenant_required',
                'message' => 'tenant_slug wajib diisi',
            ]);
        }

        $tenant = $this->resolveTenantBySlug($tenantSlug);
        if (!$tenant) {
            return $this->result(404, [
                'success' => false,
                'reason' => 'tenant_not_found',
                'message' => 'tenant_slug tidak ditemukan',
            ]);
        }

        if ($this->isTenantBlocked((string) ($tenant->status ?? 'active'))) {
            return $this->result(423, [
                'success' => false,
                'reason' => 'tenant_blocked',
                'message' => 'Tenant tidak aktif',
                'tenant_slug' => $tenant->slug,
            ]);
        }

        $settings = DB::table('settings')
            ->where('tenant_id', $tenant->id)
            ->orderBy('id')
            ->first([
                'scan_manual_enabled',
                'manual_jam_masuk_mulai',
                'manual_jam_masuk_selesai',
                'manual_jam_pulang_mulai',
                'manual_jam_pulang_selesai',
                'rfid_mode',
            ]);

        $rfidSettings = DB::table('absensi_rfid_settings')
            ->where('tenant_id', $tenant->id)
            ->orderBy('created_at')
            ->orderBy('id')
            ->first([
                'rfid_aktif',
                'rfid_mulai',
                'rfid_selesai',
            ]);

        $manualEnabled = (bool) ($settings->scan_manual_enabled ?? false);
        $dbMode = trim((string) ($settings->rfid_mode ?? ''));

        // Mode logic: 
        // 1. If 'enroll', it stays 'enroll' regardless of toggle.
        // 2. Otherwise, follow the 'scan_manual_enabled' toggle.
        if ($dbMode === 'enroll') {
            $mode = 'enroll';
        } else {
            $mode = $manualEnabled ? 'manual' : 'auto';
        }

        return $this->result(200, [
            'success' => true,
            'tenant_id' => (string) $tenant->id,
            'tenant_slug' => (string) $tenant->slug,
            'mode' => $mode,
            'scan_manual_enabled' => $manualEnabled,
            'manual_jam_masuk_mulai' => $settings->manual_jam_masuk_mulai ?? null,
            'manual_jam_masuk_selesai' => $settings->manual_jam_masuk_selesai ?? null,
            'manual_jam_pulang_mulai' => $settings->manual_jam_pulang_mulai ?? null,
            'manual_jam_pulang_selesai' => $settings->manual_jam_pulang_selesai ?? null,
            'rfid_aktif' => (bool) ($rfidSettings->rfid_aktif ?? false),
            'rfid_mulai' => $rfidSettings->rfid_mulai ?? null,
            'rfid_selesai' => $rfidSettings->rfid_selesai ?? null,
        ]);
    }

    public function setModeByTenantSlug(string $tenantSlug, string $mode): array
    {
        $tenantSlug = trim($tenantSlug);
        $mode = $this->normalizeMode($mode);

        $tenant = $this->resolveTenantBySlug($tenantSlug);
        if (!$tenant) {
            return $this->result(404, ['success' => false, 'message' => 'Tenant tidak ditemukan']);
        }

        try {
            DB::table('settings')
                ->where('tenant_id', $tenant->id)
                ->update(['rfid_mode' => $mode]);

            return $this->result(200, [
                'success' => true,
                'message' => "Mode RFID berhasil diupdate ke $mode",
                'mode' => $mode,
                'tenant_slug' => $tenant->slug,
            ]);
        } catch (\Throwable $e) {
            return $this->result(500, ['success' => false, 'message' => 'Gagal update mode di database']);
        }
    }

    public function resolveTenantBySlug(string $tenantSlug): ?object
    {
        $tenantSlug = trim($tenantSlug);
        if ($tenantSlug === '') {
            return null;
        }

        return DB::table('tenants')
            ->whereRaw('lower(slug) = ?', [Str::lower($tenantSlug)])
            ->first();
    }

    private function normalizeCardUid(string $raw): string
    {
        return strtoupper(preg_replace('/\s+/', '', trim($raw)) ?? '');
    }

    private function decodeFunctionResult($raw): ?array
    {
        if (is_array($raw)) {
            return $raw;
        }

        if (is_object($raw)) {
            return json_decode(json_encode($raw), true);
        }

        if (!is_string($raw) || trim($raw) === '') {
            return null;
        }

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            return null;
        }

        return $decoded;
    }

    private function isMissingFunctionException(string $message): bool
    {
        $needle = Str::lower($message);

        return Str::contains($needle, [
            'absensi_rfid_auto',
            'undefined function',
            'does not exist',
        ]);
    }

    private function isTenantBlocked(string $status): bool
    {
        $normalized = Str::lower(trim($status));

        return in_array($normalized, ['suspended', 'archived', 'inactive', 'disabled'], true);
    }

    private function result(int $status, array $data): array
    {
        return [
            'status' => $status,
            'data' => $data,
        ];
    }
}

