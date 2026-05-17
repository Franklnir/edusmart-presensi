# Storage Management

Fitur Storage Manager mengelola kuota dan analitik file per sekolah tanpa menghapus file aktif secara langsung.

## Peran

- Super Admin melihat kapasitas VPS, total kuota yang sudah dibagikan, sisa storage setelah alokasi kuota, ranking sekolah paling besar, dan dapat mengatur kuota per sekolah.
- Admin Sekolah melihat pemakaian sekolah sendiri, kategori terbesar, periode terbesar, file terbesar, uploader terbesar, rekomendasi cleanup, dan Trash.

## Alur Upload

- Upload lokal VPS dan direct object upload dicatat ke tabel `storage_files`.
- Upload dicek terhadap `tenant_storage_quotas.quota_bytes`.
- Batas upload per file dicek dari `tenant_storage_quotas.max_upload_bytes`.
- File Google Drive tetap dihitung dari metadata `tenant_google_drive_files`.

## Cleanup Aman

- Cleanup aktif hanya untuk file yang tercatat di `storage_files`.
- Cleanup menolak semester aktif.
- Query cleanup tetap mengecualikan semester aktif sebagai guard tambahan.
- File lokal dipindah ke `storage/app/private/.trash/{tenant_id}/{file_id}/`.
- Metadata file berubah menjadi `status = trash`.
- Trash otomatis kedaluwarsa setelah 30 hari.
- Backup ZIP dibuat sebelum cleanup jika ekstensi PHP `ZipArchive` tersedia. Backup berisi `manifest.json` dan file lokal yang dapat dicadangkan.

## Scheduler

Pastikan scheduler Laravel aktif di VPS:

```bash
* * * * * cd /path/to/backend && php artisan schedule:run >> /dev/null 2>&1
```

Job harian:

```bash
php artisan storage:purge-expired-trash
```

Job ini menghapus permanen file Trash yang `trash_expires_at`-nya sudah lewat.

## Catatan Operasional

- File lama yang belum pernah melewati API upload baru belum otomatis lengkap di `storage_files`.
- Untuk data lama, buat backfill metadata sebelum menjalankan cleanup besar.
- Object storage direct upload dicatat metadata-nya setelah client melakukan confirm upload. Jika confirm gagal setelah file berhasil ter-upload, file dapat menjadi orphan di provider object storage dan perlu lifecycle rule provider.
- Untuk skala besar, aktifkan lifecycle policy di S3/R2/MinIO untuk membersihkan object orphan atau prefix temporary.
