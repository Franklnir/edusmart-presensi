<?php

$pdo = new PDO('sqlite:' . __DIR__ . '/../database/database.sqlite');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('PRAGMA foreign_keys = ON');

$email = isset($argv[1]) ? strtolower(trim($argv[1])) : '';
$password = $argv[2] ?? '';
$name = $argv[3] ?? 'Super Admin';
$tenantSlug = $argv[4] ?? 'default';

if ($email === '') {
  echo "Usage: php scripts/create_super_admin.php <email> <password> [name] [tenant_slug]\n";
  exit(1);
}

if ($password === '') {
  $password = 'Admin@12345';
}

$tenantId = $pdo->prepare('select id from tenants where slug = ?');
$tenantId->execute([$tenantSlug]);
$tenantId = $tenantId->fetchColumn();

if (!$tenantId) {
  echo "Tenant dengan slug '$tenantSlug' tidak ditemukan.\n";
  exit(1);
}

function uuidv4() {
  $data = random_bytes(16);
  $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
  $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
  return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

$now = (new DateTime('now', new DateTimeZone('UTC')))->format('Y-m-d H:i:s');
$passwordHash = password_hash($password, PASSWORD_BCRYPT);

$pdo->beginTransaction();
try {
  $stmtUser = $pdo->prepare('select id from users where email = ?');
  $stmtUser->execute([$email]);
  $userId = $stmtUser->fetchColumn();

  if (!$userId) {
    $userId = uuidv4();
    $insertUser = $pdo->prepare('insert into users (id, name, email, password, created_at, updated_at) values (?,?,?,?,?,?)');
    $insertUser->execute([$userId, $name, $email, $passwordHash, $now, $now]);
  } else {
    $updateUser = $pdo->prepare('update users set name = ?, password = ?, updated_at = ? where id = ?');
    $updateUser->execute([$name, $passwordHash, $now, $userId]);
  }

  $stmtProfile = $pdo->prepare('select role, tenant_id from profiles where id = ?');
  $stmtProfile->execute([$userId]);
  $profile = $stmtProfile->fetch(PDO::FETCH_ASSOC);

  if ($profile) {
    if (($profile['role'] ?? '') !== 'admin') {
      throw new RuntimeException('User ini sudah terdaftar sebagai non-admin.');
    }
    if (!empty($profile['tenant_id']) && $profile['tenant_id'] !== $tenantId) {
      throw new RuntimeException('User ini terdaftar di tenant lain.');
    }
  } else {
    $insertProfile = $pdo->prepare(
      'insert into profiles (id, tenant_id, email, nama, role, status, must_change_password, created_at, updated_at) values (?,?,?,?,?,?,?,?,?)'
    );
    $insertProfile->execute([$userId, $tenantId, $email, $name, 'admin', 'active', 0, $now, $now]);
  }

  $stmtAdmin = $pdo->prepare('select id from admin_users where id = ?');
  $stmtAdmin->execute([$userId]);
  if (!$stmtAdmin->fetchColumn()) {
    $insertAdmin = $pdo->prepare('insert into admin_users (id, tenant_id, created_at) values (?,?,?)');
    $insertAdmin->execute([$userId, $tenantId, $now]);
  }

  $stmtSuper = $pdo->prepare('select id from super_admins where user_id = ?');
  $stmtSuper->execute([$userId]);
  if (!$stmtSuper->fetchColumn()) {
    $insertSuper = $pdo->prepare('insert into super_admins (id, user_id, email, name, created_at) values (?,?,?,?,?)');
    $insertSuper->execute([uuidv4(), $userId, $email, $name, $now]);
  }

  $pdo->commit();
  echo "Super admin berhasil dibuat.\n";
  echo "Email: {$email}\n";
  echo "Password: {$password}\n";
} catch (Throwable $e) {
  $pdo->rollBack();
  echo "Gagal membuat super admin: " . $e->getMessage() . "\n";
  exit(1);
}
