# Performance Recommendations

Dokumen ini mencatat area performa yang perlu dijaga saat data siswa, guru, absensi, tugas, dan quiz makin besar.

## Sudah Ditangani di Frontend/API

- Admin Siswa memakai endpoint paginated dan tidak perlu memuat konteks kelas/statistik di setiap pindah halaman.
- Dashboard Admin tidak memuat seluruh siswa saat initial load; pilihan siswa untuk eskul dimuat saat dropdown dipakai.
- Realtime fallback polling memakai daftar kolom eksplisit untuk tabel umum, bukan `select('*')`.
- Listener absensi kelas difilter per tanggal agar polling tidak menarik seluruh riwayat satu kelas.
- Tabel Admin Siswa memakai skeleton, disabled pagination saat memuat, dan layout mobile berupa card/list.
- Upload tugas siswa/guru menampilkan progress nyata, mendeteksi target Google Drive/VPS sebelum upload, dan upload banyak foto siswa dikirim berurutan agar tidak membebani storage saat ramai.
- Submit jawaban tugas siswa memakai endpoint idempotent ber-lock per siswa+tugas, sehingga double click atau tab ganda tidak membuat duplikasi jawaban.
- Bucket `assignments` sudah mendukung signed direct upload ke object storage S3-compatible/R2/MinIO. Jika env object storage belum aktif, flow lama Google Drive/VPS tetap menjadi fallback.

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

## Upload Tugas Saat Ramai

- Pertahankan upload file lewat storage, lalu simpan metadata jawaban secara terpisah. Request submit jawaban harus kecil dan cepat.
- Jalankan queue worker untuk WhatsApp/Google Drive/sinkronisasi lain. Jangan kirim notifikasi atau proses file berat di request upload utama.
- Jika 600-1000 siswa upload pada jam yang sama, batasi upload paralel di frontend dan backend. Frontend siswa saat ini mengirim foto satu per satu agar koneksi perangkat dan storage lebih stabil.
- Untuk skala lebih besar, aktifkan signed direct upload untuk bucket besar (`assignments`, `quiz-media`, sertifikat/template) ke object storage seperti Nevaobjects S3/S3-compatible agar bandwidth file tidak lewat PHP app server.
- Pantau `storage` rate limit, disk usage, queue backlog, dan error 413/429. Naikkan limit hanya setelah bandwidth/storage siap.

### Env Signed Direct Upload Object Storage

Aktifkan setelah bucket object storage siap. Untuk Nevaobjects S3 gunakan endpoint path-style. Jalur ini membuat browser upload langsung ke Nevaobjects/S3, sementara backend tetap memvalidasi izin, path, ukuran, tipe file, dan kuota sekolah sebelum membuat signed URL.

```dotenv
APP_OBJECT_STORAGE_ENABLED=true
APP_DIRECT_UPLOAD_ENABLED=true
APP_DIRECT_UPLOAD_BROWSER_ENABLED=true
APP_DIRECT_UPLOAD_BUCKETS=assignments,quiz-media,certificates,sertifikat-files,certificate-templates,sertifikat-templates
APP_OBJECT_STORAGE_LABEL="Nevaobjects S3"
APP_OBJECT_STORAGE_ACCESS_KEY_ID=...
APP_OBJECT_STORAGE_SECRET_ACCESS_KEY=...
APP_OBJECT_STORAGE_REGION=us-east-1
APP_OBJECT_STORAGE_ENDPOINT=https://s3.nevaobjects.id
APP_OBJECT_STORAGE_USE_PATH_STYLE_ENDPOINT=true
APP_OBJECT_STORAGE_CAPACITY_GB=100
APP_DIRECT_UPLOAD_EXPIRES_SECONDS=900
APP_DIRECT_UPLOAD_VERIFY_OBJECTS=true
APP_OBJECT_STORAGE_BUCKET_ASSIGNMENTS=assignments
APP_OBJECT_STORAGE_BUCKET_QUIZ_MEDIA=quiz-media
APP_OBJECT_STORAGE_BUCKET_CERTIFICATES=certificates
APP_OBJECT_STORAGE_BUCKET_SERTIFIKAT_FILES=sertifikat-files
APP_OBJECT_STORAGE_BUCKET_CERTIFICATE_TEMPLATES=certificate-templates
APP_OBJECT_STORAGE_BUCKET_SERTIFIKAT_TEMPLATES=sertifikat-templates
```

Env lama `ASSIGNMENT_DIRECT_UPLOAD_*` masih didukung untuk deploy existing, tetapi konfigurasi baru sebaiknya memakai `APP_DIRECT_UPLOAD_*`. Bucket CORS minimal perlu mengizinkan origin domain sekolah untuk method `PUT`, `GET`, dan `HEAD`, header `Content-Type` atau `*`, expose header `ETag` dan `Content-Length`, serta origin root/admin/tenant eksplisit seperti `https://sismu.biz.id`, `https://admin26.sismu.biz.id`, dan `https://sman3bogor.sismu.biz.id`. Simpan object tetap private; aplikasi hanya memberi signed URL sementara setelah permission pengguna dicek.

Jika CORS bucket belum benar, browser akan menolak upload langsung sebelum file terkirim. Frontend sekarang menahan percobaan direct upload sementara setelah error CORS/network, dan backend dapat meneruskan file ke object storage sebagai fallback aman. Ini menjaga fitur tetap jalan, tetapi signed direct upload dengan CORS yang benar tetap jalur paling cepat untuk upload massal.

Jika panel provider tidak punya menu CORS, jalankan mode relay backend:

```dotenv
APP_OBJECT_STORAGE_ENABLED=true
APP_DIRECT_UPLOAD_ENABLED=false
APP_DIRECT_UPLOAD_BROWSER_ENABLED=false
```

Dengan mode ini file tetap disimpan ke Nevaobjects, tetapi browser tidak melakukan `PUT` langsung ke bucket sehingga error CORS merah tidak muncul.

## Catatan Lanjutan

- Search nama siswa yang memakai `ILIKE '%kata%'` akan tetap berat pada data sangat besar. Untuk production besar, gunakan trigram index (`pg_trgm`) atau endpoint search khusus.
- Export Excel/PDF tetap sebaiknya dimuat saat tombol export diklik, bukan saat halaman pertama dibuka.
- Endpoint dashboard sebaiknya terus mengutamakan aggregate count ringan, lalu detail dimuat lazy saat user membuka panel terkait.
