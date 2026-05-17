# Performance Recommendations

Dokumen ini mencatat area performa yang perlu dijaga saat data siswa, guru, absensi, tugas, dan quiz makin besar.

## Sudah Ditangani di Frontend/API

- Admin Siswa memakai endpoint paginated dan tidak perlu memuat konteks kelas/statistik di setiap pindah halaman.
- Dashboard Admin tidak memuat seluruh siswa saat initial load; pilihan siswa untuk eskul dimuat saat dropdown dipakai.
- Realtime fallback polling memakai daftar kolom eksplisit untuk tabel umum, bukan `select('*')`.
- Listener absensi kelas difilter per tanggal agar polling tidak menarik seluruh riwayat satu kelas.
- Tabel Admin Siswa memakai skeleton, disabled pagination saat memuat, dan layout mobile berupa card/list.

## Rekomendasi Index Database

Jalankan di PostgreSQL saat traffic rendah. Jika database production besar, gunakan `CONCURRENTLY` dan jangan dibungkus transaction migration biasa.

```sql
CREATE INDEX IF NOT EXISTS profiles_role_idx
  ON profiles (role);

CREATE INDEX IF NOT EXISTS profiles_kelas_idx
  ON profiles (kelas);

CREATE INDEX IF NOT EXISTS profiles_nis_idx
  ON profiles (nis);

CREATE INDEX IF NOT EXISTS profiles_email_idx
  ON profiles (email);

CREATE INDEX IF NOT EXISTS absensi_kelas_tanggal_mapel_idx
  ON absensi (kelas, tanggal, mapel);

CREATE INDEX IF NOT EXISTS absensi_uid_tanggal_idx
  ON absensi (uid, tanggal);

CREATE INDEX IF NOT EXISTS absensi_ajuan_kelas_tanggal_mapel_idx
  ON absensi_ajuan (kelas, tanggal, mapel);

CREATE INDEX IF NOT EXISTS jadwal_guru_id_idx
  ON jadwal (guru_id);

CREATE INDEX IF NOT EXISTS kelas_struktur_wali_guru_id_idx
  ON kelas_struktur (wali_guru_id);
```

## Index Tambahan yang Disarankan

Untuk instalasi multi-tenant atau dataset besar, pertimbangkan index composite berikut setelah dicek dengan `EXPLAIN ANALYZE`.

```sql
CREATE INDEX IF NOT EXISTS profiles_tenant_role_kelas_idx
  ON profiles (tenant_id, role, kelas);

CREATE INDEX IF NOT EXISTS profiles_tenant_role_nis_idx
  ON profiles (tenant_id, role, nis);

CREATE INDEX IF NOT EXISTS absensi_tenant_kelas_tanggal_mapel_idx
  ON absensi (tenant_id, kelas, tanggal, mapel);

CREATE INDEX IF NOT EXISTS absensi_ajuan_tenant_kelas_tanggal_mapel_idx
  ON absensi_ajuan (tenant_id, kelas, tanggal, mapel);

CREATE INDEX IF NOT EXISTS quiz_submissions_quiz_siswa_idx
  ON quiz_submissions (quiz_id, siswa_id);

CREATE INDEX IF NOT EXISTS tugas_jawaban_tugas_user_idx
  ON tugas_jawaban (tugas_id, user_id);
```

## Catatan Lanjutan

- Search nama siswa yang memakai `ILIKE '%kata%'` akan tetap berat pada data sangat besar. Untuk production besar, gunakan trigram index (`pg_trgm`) atau endpoint search khusus.
- Export Excel/PDF tetap sebaiknya dimuat saat tombol export diklik, bukan saat halaman pertama dibuka.
- Endpoint dashboard sebaiknya terus mengutamakan aggregate count ringan, lalu detail dimuat lazy saat user membuka panel terkait.
