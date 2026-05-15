<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class PresenceControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_super_admin_without_profile_ping_does_not_write_presence(): void
    {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => 'Super Admin',
            'email' => 'super-presence@example.com',
            'password' => Hash::make('password123'),
        ]);

        DB::table('super_admins')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $user->id,
            'email' => $user->email,
            'name' => $user->name,
            'created_at' => now(),
        ]);

        $response = $this->actingAs($user)->postJson('/api/presence/ping', [
            'device_id' => 'test-device',
            'activity' => true,
        ]);

        $response->assertOk();
        $response->assertJsonPath('data', 'ok');
        $this->assertDatabaseMissing('user_presence', [
            'user_id' => $user->id,
            'device_id' => 'test-device',
        ]);
    }

    public function test_profile_user_ping_writes_presence(): void
    {
        $tenantId = (string) DB::table('tenants')->where('slug', 'default')->value('id');
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => 'Student Presence',
            'email' => 'student-presence@example.com',
            'password' => Hash::make('password123'),
        ]);

        DB::table('profiles')->insert([
            'id' => $user->id,
            'tenant_id' => $tenantId,
            'email' => $user->email,
            'nama' => $user->name,
            'role' => 'siswa',
            'kelas' => 'x-a',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->actingAs($user)->postJson('/api/presence/ping', [
            'device_id' => 'student-device',
            'activity' => true,
        ]);

        $response->assertOk();
        $this->assertDatabaseHas('user_presence', [
            'tenant_id' => $tenantId,
            'user_id' => $user->id,
            'device_id' => 'student-device',
            'role' => 'siswa',
        ]);
    }
}
