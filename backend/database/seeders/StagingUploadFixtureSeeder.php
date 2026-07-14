<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use RuntimeException;

class StagingUploadFixtureSeeder extends Seeder
{
    private const TENANT_A = '10000000-0000-4000-8000-000000000001';

    private const TENANT_B = '20000000-0000-4000-8000-000000000001';

    public function run(): void
    {
        if (! app()->environment('staging')) {
            throw new RuntimeException('Synthetic upload fixtures may only be seeded in staging.');
        }

        $password = (string) config('staging.test_password');
        if (strlen($password) < 16) {
            throw new RuntimeException('STAGING_TEST_PASSWORD must contain at least 16 characters.');
        }

        DB::transaction(function () use ($password): void {
            $this->upsertTenant(self::TENANT_A, 'Synthetic Tenant A', 'tenant-a');
            $this->upsertTenant(self::TENANT_B, 'Synthetic Tenant B', 'tenant-b');

            $this->upsertAccount('11000000-0000-4000-8000-000000000001', self::TENANT_A, 'Admin A', 'admin-a@staging.invalid', 'admin', null, $password);
            $this->upsertAccount('11000000-0000-4000-8000-000000000002', self::TENANT_A, 'Guru A1', 'guru-a1@staging.invalid', 'guru', null, $password);
            $this->upsertAccount('11000000-0000-4000-8000-000000000003', self::TENANT_A, 'Guru A2', 'guru-a2@staging.invalid', 'guru', null, $password);
            $this->upsertAccount('11000000-0000-4000-8000-000000000004', self::TENANT_A, 'Siswa A1', 'siswa-a1@staging.invalid', 'siswa', 'Kelas A1', $password);
            $this->upsertAccount('11000000-0000-4000-8000-000000000005', self::TENANT_A, 'Siswa A2', 'siswa-a2@staging.invalid', 'siswa', 'Kelas A2', $password);

            $this->upsertAccount('22000000-0000-4000-8000-000000000001', self::TENANT_B, 'Admin B', 'admin-b@staging.invalid', 'admin', null, $password);
            $this->upsertAccount('22000000-0000-4000-8000-000000000002', self::TENANT_B, 'Guru B1', 'guru-b1@staging.invalid', 'guru', null, $password);
            $this->upsertAccount('22000000-0000-4000-8000-000000000003', self::TENANT_B, 'Siswa B1', 'siswa-b1@staging.invalid', 'siswa', 'Kelas B1', $password);

            $this->upsertClass('staging-a-1', self::TENANT_A, 'Kelas A1');
            $this->upsertClass('staging-a-2', self::TENANT_A, 'Kelas A2');
            $this->upsertClass('staging-b-1', self::TENANT_B, 'Kelas B1');

            $this->upsertAssignment(91001, self::TENANT_A, 'Kelas A1', 'Synthetic Assignment A1', '11000000-0000-4000-8000-000000000002');
            $this->upsertAssignment(92001, self::TENANT_B, 'Kelas B1', 'Synthetic Assignment B1', '22000000-0000-4000-8000-000000000002');
        });

        $this->command?->info('Synthetic multi-tenant upload fixtures are ready.');
    }

    private function upsertTenant(string $id, string $name, string $slug): void
    {
        DB::table('tenants')->updateOrInsert(['id' => $id], [
            'name' => $name,
            'slug' => $slug,
            'status' => 'active',
            'updated_at' => now(),
            'created_at' => now(),
        ]);
    }

    private function upsertAccount(
        string $id,
        string $tenantId,
        string $name,
        string $email,
        string $role,
        ?string $class,
        string $password
    ): void {
        DB::table('users')->updateOrInsert(['id' => $id], [
            'name' => $name,
            'email' => $email,
            'email_verified_at' => now(),
            'password' => Hash::make($password),
            'updated_at' => now(),
            'created_at' => now(),
        ]);

        DB::table('profiles')->updateOrInsert(['id' => $id], [
            'tenant_id' => $tenantId,
            'email' => $email,
            'nama' => $name,
            'role' => $role,
            'kelas' => $class,
            'status' => 'active',
            'must_change_password' => false,
            'updated_at' => now(),
            'created_at' => now(),
        ]);
    }

    private function upsertClass(string $id, string $tenantId, string $name): void
    {
        DB::table('kelas')->updateOrInsert(['id' => $id], [
            'tenant_id' => $tenantId,
            'nama' => $name,
            'grade' => '10',
            'suffix' => substr($name, -2),
            'tahun_ajaran' => '2026/2027',
            'semester' => 'Ganjil',
            'angkatan' => '2026',
            'is_active' => true,
            'updated_at' => now(),
            'created_at' => now(),
        ]);
    }

    private function upsertAssignment(int $id, string $tenantId, string $class, string $title, string $teacherId): void
    {
        DB::table('tugas')->updateOrInsert(['id' => $id], [
            'tenant_id' => $tenantId,
            'kelas' => $class,
            'judul' => $title,
            'mapel' => 'QA Upload V2',
            'mulai' => now()->subHour(),
            'deadline' => now()->addDays(7),
            'keterangan' => 'Synthetic staging fixture; no production data.',
            'created_by' => $teacherId,
            'status' => 'published',
            'tahun_ajaran' => '2026/2027',
            'semester' => 'Ganjil',
            'updated_at' => now(),
            'created_at' => now(),
        ]);
    }
}
