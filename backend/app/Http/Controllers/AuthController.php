<?php

namespace App\Http\Controllers;

use App\Models\Profile;
use App\Models\Setting;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password as PasswordRule;

class AuthController extends Controller
{
    public function register(Request $request)
    {
        $data = $request->validate([
            'nama' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', PasswordRule::defaults()],
            'role' => ['required', Rule::in(['siswa', 'guru'])],
        ]);

        $settings = Setting::query()->orderBy('id')->first();
        if ($data['role'] === 'siswa' && $settings && ! $settings->registrasi_siswa_aktif) {
            return response()->json(['message' => 'Registrasi siswa sedang ditutup.'], 403);
        }
        if ($data['role'] === 'guru' && $settings && ! $settings->registrasi_guru_aktif) {
            return response()->json(['message' => 'Registrasi guru sedang ditutup.'], 403);
        }

        $userId = (string) Str::uuid();

        $user = User::create([
            'id' => $userId,
            'name' => $data['nama'],
            'email' => strtolower($data['email']),
            'password' => Hash::make($data['password']),
        ]);

        $profile = Profile::create([
            'id' => $userId,
            'email' => strtolower($data['email']),
            'nama' => $data['nama'],
            'role' => $data['role'],
            'status' => 'active',
        ]);

        $token = $user->createToken('api')->plainTextToken;

        return response()->json([
            'token' => $token,
            'user' => $user,
            'profile' => $profile,
        ], 201);
    }

    public function login(Request $request)
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        $user = User::query()->where('email', strtolower($data['email']))->first();
        if (! $user || ! Hash::check($data['password'], $user->password)) {
            return response()->json(['message' => 'Email atau password salah.'], 401);
        }

        $profile = $user->profile;
        if ($profile && $profile->status === 'nonaktif') {
            return response()->json(['message' => 'Akun dinonaktifkan.'], 403);
        }

        $token = $user->createToken('api')->plainTextToken;

        return response()->json([
            'token' => $token,
            'user' => $user,
            'profile' => $profile,
        ]);
    }

    public function logout(Request $request)
    {
        $request->user()?->currentAccessToken()?->delete();

        return response()->json(['message' => 'Logout berhasil.']);
    }

    public function me(Request $request)
    {
        $user = $request->user();

        return response()->json([
            'user' => $user,
            'profile' => $user?->profile,
        ]);
    }
}
