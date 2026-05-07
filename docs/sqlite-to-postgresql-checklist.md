# Checklist Migrasi SQLite ke PostgreSQL

## 1. Backup dulu

```bash
cp backend/database/database.sqlite backend/database/database.sqlite.bak.$(date +%F_%H%M%S)
```

## 2. Siapkan PostgreSQL kosong

- Buat database baru (contoh: `edusmart`)
- Buat user khusus aplikasi
- Aktifkan koneksi lokal/private network VPS

## 3. Ubah env ke PostgreSQL

Gunakan `backend/.env.production.example` sebagai acuan.
Pastikan:

- `DB_CONNECTION=pgsql`
- `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` valid

## 4. Jalankan migration schema

```bash
cd backend
php artisan migrate --force
```

## 5. Migrasi data lama

Ada 2 opsi:

1. `pgloader` (lebih cepat untuk full tabel)
```bash
pgloader backend/database/database.sqlite postgresql://USER:PASSWORD@HOST:5432/edusmart
```

2. Migrasi bertahap (manual/script) untuk tabel kritikal:
- `users`
- `profiles`
- `settings`
- `jadwal`
- `absensi`
- `tugas`
- `tugas_jawaban`
- `tenants`
- `super_admins`

## 6. Verifikasi data penting

Cek jumlah data utama sebelum/after:

```sql
select count(*) from users;
select count(*) from profiles;
select count(*) from absensi;
select count(*) from tugas;
```

## 7. Tes fitur inti

- login semua role (`super admin`, `admin`, `guru`, `siswa`)
- CRUD user guru/siswa
- absensi + RFID
- tugas + upload file
- tenant/subdomain login

## 8. Cutover

- stop akses write sementara
- jalankan final sync (jika perlu)
- ganti env production ke PostgreSQL
- restart service backend/worker/scheduler

## 9. Rollback plan

Jika terjadi issue:

- restore `.env` lama (SQLite)
- restart service
- restore backup sqlite (`database.sqlite.bak.*`)
