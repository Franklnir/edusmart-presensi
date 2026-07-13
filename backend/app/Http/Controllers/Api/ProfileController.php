<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Validator;

class ProfileController extends ApiController
{
    public function me(Request $request)
    {
        $profile = $this->profile($request);

        return response()->json(['data' => $profile]);
    }

    public function updateMe(Request $request)
    {
        $profile = $this->profile($request);
        if (! $profile) {
            return $this->deny('User tidak ditemukan', 404);
        }
        $tenantId = $this->tenantId($request);

        $role = strtolower((string) ($profile->role ?? ''));
        $allowedByRole = [
            'guru' => ['nama', 'nis', 'jk', 'agama', 'telp', 'alamat', 'tanggal_lahir', 'photo_url', 'photo_path'],
            'teacher' => ['nama', 'nis', 'jk', 'agama', 'telp', 'alamat', 'tanggal_lahir', 'photo_url', 'photo_path'],
            'admin' => ['nama', 'jk', 'agama', 'telp', 'alamat', 'tanggal_lahir', 'photo_url', 'photo_path'],
            'siswa' => ['jk', 'agama', 'telp', 'alamat', 'tanggal_lahir', 'no_hp_siswa', 'no_hp_wali', 'photo_url', 'photo_path'],
        ];
        $allowed = $allowedByRole[$role] ?? ['nama', 'jk', 'agama', 'telp', 'alamat', 'tanggal_lahir', 'photo_url', 'photo_path'];

        $payload = array_intersect_key($request->all(), array_flip($allowed));
        $validator = Validator::make($payload, [
            'nama' => ['sometimes', 'required', 'string', 'max:120'],
            'nis' => ['nullable', 'string', 'max:64'],
            'jk' => ['nullable', 'string', 'max:20'],
            'agama' => ['nullable', 'string', 'max:50'],
            'telp' => ['nullable', 'string', 'max:32'],
            'alamat' => ['nullable', 'string', 'max:1000'],
            'tanggal_lahir' => ['nullable', 'date'],
            'no_hp_siswa' => ['nullable', 'string', 'max:32'],
            'no_hp_wali' => ['nullable', 'string', 'max:32'],
            'photo_url' => ['nullable', 'string', 'max:2048'],
            'photo_path' => ['nullable', 'string', 'max:2048'],
        ]);
        if ($validator->fails()) {
            return response()->json(['message' => $validator->errors()->first()], 422);
        }

        $data = [];
        foreach ($validator->validated() as $key => $value) {
            if (! Schema::hasColumn('profiles', $key)) {
                continue;
            }
            if (is_string($value)) {
                $value = preg_replace('/\s+/', ' ', trim($value)) ?? '';
            }
            $data[$key] = $value === '' ? null : $value;
        }

        if (array_key_exists('nama', $data) && $data['nama'] !== null) {
            $data['nama'] = preg_replace('/\s+/', ' ', trim((string) $data['nama'])) ?? '';
            if ($data['nama'] === '') {
                return $this->deny('Nama wajib diisi.', 422);
            }
        }
        if (array_key_exists('jk', $data) && $data['jk'] !== null) {
            $gender = strtoupper((string) $data['jk']);
            $data['jk'] = in_array($gender, ['L', 'P'], true) ? $gender : $data['jk'];
        }
        if (($role === 'guru' || $role === 'teacher') && array_key_exists('nis', $data) && $data['nis'] !== null) {
            $duplicateQuery = DB::table('profiles')
                ->where('id', '!=', $profile->id)
                ->whereRaw('LOWER(nis) = ?', [strtolower((string) $data['nis'])]);
            if ($tenantId) {
                $duplicateQuery->where('tenant_id', $tenantId);
            }
            if ($duplicateQuery->exists()) {
                return $this->deny('NIP/NUPTK sudah dipakai oleh pengguna lain.', 422);
            }
        }

        $data['updated_at'] = now();
        $query = DB::table('profiles')->where('id', $profile->id);
        if ($tenantId) {
            $query->where('tenant_id', $tenantId);
        }
        if (count($data) > 1) {
            $query->update($data);
        }

        if (($role === 'guru' || $role === 'teacher') && array_key_exists('nama', $data) && $data['nama'] !== null) {
            DB::table('users')
                ->where('id', $profile->id)
                ->update([
                    'name' => $data['nama'],
                    'updated_at' => now(),
                ]);
            if ($tenantId) {
                $this->syncTeacherDisplayNameSnapshots($tenantId, (string) $profile->id, (string) $data['nama'], now());
            }
        }

        $freshQuery = DB::table('profiles')->where('id', $profile->id);
        if ($tenantId) {
            $freshQuery->where('tenant_id', $tenantId);
        }
        $fresh = $freshQuery->first();

        return response()->json(['data' => $fresh]);
    }

    public function index(Request $request)
    {
        $query = DB::table('profiles');
        $tenantId = $this->tenantId($request);
        if ($tenantId) {
            $query->where('tenant_id', $tenantId);
        }

        if ($this->isAdmin($request)) {
            // admin full
        } elseif ($this->isGuru($request)) {
            // guru hanya bisa lihat siswa di kelas yang dia ampu + sesama guru
            $kelasQuery = DB::table('jadwal')->where('guru_id', $request->user()->id);
            if ($tenantId) {
                $kelasQuery->where('tenant_id', $tenantId);
            }
            $kelasIds = $kelasQuery->pluck('kelas_id')->unique();
            $query->where(function ($q) use ($kelasIds) {
                $q->where('role', 'guru');
                if ($kelasIds->count()) {
                    $q->orWhere(function ($sq) use ($kelasIds) {
                        $sq->where('role', 'siswa')->whereIn('kelas', $kelasIds);
                    });
                }
            });
        } else {
            // siswa hanya bisa lihat diri sendiri dan guru + teman sekelas
            $kelas = $this->currentKelas($request);
            $uid = $request->user()->id;
            $query->where(function ($q) use ($kelas, $uid) {
                $q->where('id', $uid)
                    ->orWhere('role', 'guru')
                    ->orWhere(function ($sq) use ($kelas) {
                        $sq->where('role', 'siswa')->where('kelas', $kelas);
                    });
            });
        }

        if ($role = $request->query('role')) {
            $query->where('role', $role);
        }
        if ($kelas = $request->query('kelas')) {
            $query->where('kelas', $kelas);
        }
        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }

        $this->applyPagination($query, $request);

        return response()->json(['data' => $query->orderBy('nama')->get()]);
    }

    public function store(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }
        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $payload = $request->all();
        $validator = Validator::make($payload, [
            'id' => 'required|uuid',
            'email' => 'required|email',
            'role' => 'required|in:siswa,guru,admin',
        ]);
        if ($validator->fails()) {
            return response()->json(['message' => $validator->errors()->first()], 422);
        }

        $payload['created_at'] = now();
        $payload['updated_at'] = now();
        if (Schema::hasColumn('profiles', 'created_via') && empty($payload['created_via'])) {
            $payload['created_via'] = 'admin_created';
        }
        if (Schema::hasColumn('profiles', 'created_by') && empty($payload['created_by'])) {
            $actorId = (string) ($request->user()?->id ?? '');
            if ($actorId !== '') {
                $payload['created_by'] = $actorId;
            }
        }

        $payload['tenant_id'] = $tenantId;
        DB::table('profiles')->insert($payload);

        return response()->json(['data' => $payload], 201);
    }

    public function update(Request $request, string $id)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }
        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $payload = $request->all();
        $payload['updated_at'] = now();
        DB::table('profiles')->where('id', $id)->where('tenant_id', $tenantId)->update($payload);
        $row = DB::table('profiles')->where('id', $id)->where('tenant_id', $tenantId)->first();

        return response()->json(['data' => $row]);
    }

    public function destroy(Request $request, string $id)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }
        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }
        DB::table('profiles')->where('id', $id)->where('tenant_id', $tenantId)->delete();

        return response()->json(['data' => 'deleted']);
    }
}
