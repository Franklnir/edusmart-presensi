param(
  [switch]$SkipMigrate
)

$ErrorActionPreference = 'Stop'

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$Backend = Join-Path $Root 'backend'
$PostgresBin = Join-Path $Root '.local\postgresql-17.9\pgsql\bin'
$PgData = Join-Path $Root '.local\pgdata'
$LogDir = Join-Path $Root '.local\logs'

New-Item -ItemType Directory -Force $LogDir | Out-Null

function Test-Port {
  param([int]$Port)

  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(500, $false)) {
      return $false
    }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Require-File {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    throw "Required file not found: $Path"
  }
}

$InitDb = Join-Path $PostgresBin 'initdb.exe'
$PgCtl = Join-Path $PostgresBin 'pg_ctl.exe'
$PgIsReady = Join-Path $PostgresBin 'pg_isready.exe'
$Psql = Join-Path $PostgresBin 'psql.exe'
$Createdb = Join-Path $PostgresBin 'createdb.exe'

Require-File $InitDb
Require-File $PgCtl
Require-File $PgIsReady
Require-File $Psql
Require-File $Createdb

if (-not (Test-Path $PgData)) {
  & $InitDb -D $PgData -U postgres -A trust -E UTF8 --locale=C
}

if (-not (Test-Port 5432)) {
  $PgLog = Join-Path $PgData 'postgres.log'
  & $PgCtl -D $PgData -l $PgLog -o "-h 127.0.0.1 -p 5432" start | Out-Null
}

& $PgIsReady -h 127.0.0.1 -p 5432 -U postgres | Out-Null

$dbExists = & $Psql -h 127.0.0.1 -p 5432 -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'edusmart'"
if (($dbExists -join '').Trim() -ne '1') {
  & $Createdb -h 127.0.0.1 -p 5432 -U postgres edusmart
}

if (-not $SkipMigrate) {
  Push-Location $Backend
  try {
    php artisan migrate --force --no-ansi

    $seedCode = @'
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

$now = now();
$tenant = DB::table('tenants')->where('slug', config('tenancy.default_slug', 'default'))->first();
if (! $tenant) {
    $tenantId = (string) Str::uuid();
    DB::table('tenants')->insert(['id' => $tenantId, 'name' => 'Default School', 'slug' => 'default', 'status' => 'active', 'created_at' => $now, 'updated_at' => $now]);
} else {
    $tenantId = (string) $tenant->id;
}

if (Schema::hasTable('settings') && ! DB::table('settings')->where('tenant_id', $tenantId)->exists()) {
    DB::table('settings')->insert([
        'tenant_id' => $tenantId,
        'nama_sekolah' => 'EduSmart Local',
        'tahun_ajaran' => '2025/2026',
        'semester_aktif' => 'Genap',
        'email' => 'admin@local.test',
        'telepon' => '080000000000',
        'alamat' => 'Local development',
        'created_at' => $now,
        'updated_at' => $now,
    ]);
}

$email = 'admin@local.test';
$password = 'Admin123!Local';
$userId = DB::table('users')->whereRaw('lower(email) = ?', [$email])->value('id');
if (! $userId) {
    $userId = (string) Str::uuid();
}

DB::table('users')->updateOrInsert(
    ['id' => $userId],
    [
        'name' => 'Admin Local',
        'email' => $email,
        'email_verified_at' => $now,
        'password' => Hash::make($password),
        'created_at' => $now,
        'updated_at' => $now,
    ]
);

DB::table('profiles')->updateOrInsert(
    ['id' => $userId],
    [
        'tenant_id' => $tenantId,
        'email' => $email,
        'nama' => 'Admin Local',
        'role' => 'admin',
        'status' => 'active',
        'jabatan' => 'Administrator',
        'must_change_password' => false,
        'created_at' => $now,
        'updated_at' => $now,
    ]
);

if (Schema::hasTable('admin_users')) {
    DB::table('admin_users')->updateOrInsert(
        ['id' => $userId],
        ['tenant_id' => $tenantId, 'created_at' => $now]
    );
}

$superEmail = 'superadmin@local.test';
$superPassword = 'SuperAdmin123!Local';
$superUserId = DB::table('users')->whereRaw('lower(email) = ?', [$superEmail])->value('id');
if (! $superUserId) {
    $superUserId = (string) Str::uuid();
}

DB::table('users')->updateOrInsert(
    ['id' => $superUserId],
    [
        'name' => 'Super Admin Local',
        'email' => $superEmail,
        'email_verified_at' => $now,
        'password' => Hash::make($superPassword),
        'created_at' => $now,
        'updated_at' => $now,
    ]
);

DB::table('profiles')->updateOrInsert(
    ['id' => $superUserId],
    [
        'tenant_id' => $tenantId,
        'email' => $superEmail,
        'nama' => 'Super Admin Local',
        'role' => 'admin',
        'status' => 'active',
        'jabatan' => 'Super Administrator',
        'must_change_password' => false,
        'created_at' => $now,
        'updated_at' => $now,
    ]
);

if (Schema::hasTable('admin_users')) {
    DB::table('admin_users')->updateOrInsert(
        ['id' => $superUserId],
        ['tenant_id' => $tenantId, 'created_at' => $now]
    );
}

if (Schema::hasTable('super_admins')) {
    DB::table('super_admins')->updateOrInsert(
        ['user_id' => $superUserId],
        [
            'id' => DB::table('super_admins')->where('user_id', $superUserId)->value('id') ?: (string) Str::uuid(),
            'email' => $superEmail,
            'name' => 'Super Admin Local',
            'created_at' => $now,
        ]
    );
}

if (Schema::hasTable('kelas') && ! DB::table('kelas')->where('tenant_id', $tenantId)->exists()) {
    foreach ([['7A', 'Kelas 7A', '7', 'A'], ['8A', 'Kelas 8A', '8', 'A'], ['9A', 'Kelas 9A', '9', 'A']] as $kelas) {
        DB::table('kelas')->updateOrInsert(
            ['id' => $kelas[0], 'tenant_id' => $tenantId],
            ['nama' => $kelas[1], 'grade' => $kelas[2], 'suffix' => $kelas[3], 'created_at' => $now, 'updated_at' => $now]
        );
    }
}

if (Schema::hasTable('mata_pelajaran') && ! DB::table('mata_pelajaran')->where('tenant_id', $tenantId)->exists()) {
    foreach ([['matematika', 'Matematika'], ['bahasa-indonesia', 'Bahasa Indonesia'], ['ipa', 'IPA']] as $mapel) {
        DB::table('mata_pelajaran')->updateOrInsert(
            ['id' => $mapel[0], 'tenant_id' => $tenantId],
            ['nama' => $mapel[1], 'created_at' => $now, 'updated_at' => $now]
        );
    }
}
'@
    php artisan tinker --execute="$seedCode" | Out-Null
  } finally {
    Pop-Location
  }
}

if (-not (Test-Port 8000)) {
  Start-Process `
    -FilePath 'php' `
    -ArgumentList @('artisan', 'serve', '--host=127.0.0.1', '--port=8000') `
    -WorkingDirectory $Backend `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $LogDir 'laravel.out.log') `
    -RedirectStandardError (Join-Path $LogDir 'laravel.err.log')
}

if (-not (Test-Port 5173)) {
  Start-Process `
    -FilePath 'npm.cmd' `
    -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173') `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $LogDir 'vite.out.log') `
    -RedirectStandardError (Join-Path $LogDir 'vite.err.log')
}

Write-Output 'Local services ready:'
Write-Output 'Frontend: http://127.0.0.1:5173/'
Write-Output 'Backend:  http://127.0.0.1:8000/api/health'
Write-Output 'Login:    admin@local.test / Admin123!Local'
Write-Output 'Super:    superadmin@local.test / SuperAdmin123!Local'
