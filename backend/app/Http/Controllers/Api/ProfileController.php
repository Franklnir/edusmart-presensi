<?php

namespace App\Http\Controllers\Api;

use App\Models\Profile;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
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
        if (!$profile) return $this->deny('User tidak ditemukan', 404);
        $tenantId = $this->tenantId($request);

        $payload = $request->all();
        $allowed = [
            'nama', 'jk', 'nis', 'usia', 'kelas', 'no_hp_siswa', 'no_hp_wali',
            'alamat', 'telp', 'agama', 'jabatan', 'photo_url', 'photo_path',
            'tanggal_lahir', 'rfid_uid'
        ];
        $data = array_intersect_key($payload, array_flip($allowed));

        if ($this->isSiswa($request)) {
            // siswa tidak boleh ganti kelas dan role
            unset($data['kelas']);
        }

        $data['updated_at'] = now();
        $query = DB::table('profiles')->where('id', $profile->id);
        if ($tenantId) {
            $query->where('tenant_id', $tenantId);
        }
        $query->update($data);

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
        if (!$this->isAdmin($request)) return $this->deny();
        $tenantId = $this->tenantId($request);
        if (!$tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $payload = $request->all();
        $validator = Validator::make($payload, [
            'id' => 'required|uuid',
            'email' => 'required|email',
            'role' => 'required|in:siswa,guru,admin',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $payload['created_at'] = now();
        $payload['updated_at'] = now();

        $payload['tenant_id'] = $tenantId;
        DB::table('profiles')->insert($payload);
        return response()->json(['data' => $payload], 201);
    }

    public function update(Request $request, string $id)
    {
        if (!$this->isAdmin($request)) return $this->deny();
        $tenantId = $this->tenantId($request);
        if (!$tenantId) {
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
        if (!$this->isAdmin($request)) return $this->deny();
        $tenantId = $this->tenantId($request);
        if (!$tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }
        DB::table('profiles')->where('id', $id)->where('tenant_id', $tenantId)->delete();
        return response()->json(['data' => 'deleted']);
    }
}
