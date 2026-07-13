# Panduan Scope dan Reset Data Akademik SISMU

**Status:** Kontrak operasional yang berlaku  
**Terakhir diperbarui:** 13 Juli 2026  
**Cakupan:** Admin Sekolah, Guru, Siswa, backend, frontend, laporan, dan proses rollover

## 1. Tujuan

Dokumen ini menjelaskan kapan data SISMU:

- tetap digunakan pada semester berikutnya;
- disiapkan sebagai data semester baru;
- disiapkan sebagai data tahun ajaran baru;
- dapat disalin dari periode sebelumnya;
- tetap disimpan sebagai arsip;
- tidak boleh diubah ketika periode sudah ditutup.

Dokumen ini juga menjadi rujukan bagi pengembang dan AI/agent agar perubahan fitur tidak mencampur data antarsemester, antartahun ajaran, atau antartenant.

## 2. Istilah Resmi

| Istilah | Arti |
|---|---|
| Tahun ajaran | Periode tahunan, misalnya `2026/2027` |
| Semester | Bagian dari tahun ajaran: `Ganjil` atau `Genap` |
| Periode aktif | Tahun ajaran dan semester yang sedang dipakai untuk operasional tenant |
| Mode arsip | Tampilan data periode lama tanpa mengubah periode aktif tenant |
| Sesi koreksi | Akses edit terbatas, beralasan, tercatat, dan memiliki waktu kedaluwarsa untuk data arsip |
| Rollover | Aktivasi tahun ajaran berikutnya yang memproses kenaikan kelas dan snapshot historis |
| Reset | Membuka scope data baru; bukan menghapus data periode sebelumnya |
| Snapshot | Salinan keadaan historis pada periode tertentu yang tidak mengikuti perubahan data aktif berikutnya |

## 3. Prinsip Utama

1. Reset tidak boleh menghapus data lama.
2. Pergantian semester tidak boleh menaikkan kelas siswa.
3. Kenaikan kelas hanya terjadi ketika tahun ajaran berikutnya diaktifkan melalui rollover.
4. Memilih periode pada filter hanya mengubah tampilan dan tidak mengaktifkan periode tenant.
5. Jika periode target sudah pernah diisi, data yang pernah disimpan harus ditampilkan kembali dan tidak direset ulang.
6. Data periode lama menjadi arsip hanya-baca pada operasi normal.
7. Mutation hanya boleh dilakukan pada periode aktif atau melalui sesi koreksi arsip yang sah.
8. Seluruh query dan mutation wajib dibatasi oleh `tenant_id` yang ditentukan server.
9. Data Tenant A tidak boleh dibaca, disalin, atau diubah oleh Tenant B.

## 4. Klasifikasi Data

| Scope | Data utama | Saat semester berubah | Saat tahun ajaran berubah |
|---|---|---|---|
| Global/current | Akun, profil aktif, master mapel, perangkat RFID, sertifikat, login history, pengaturan umum | Tetap | Tetap |
| Tahunan | Jadwal, wali/struktur kelas, struktur sekolah, organisasi dan anggota organisasi | Tetap | Menggunakan data tahun target |
| Semester | Tugas, quiz, absensi, pengajuan absensi, jam kosong, ekskul, anggota ekskul, absensi ekskul, rapor, bobot, nilai manual | Menggunakan dataset semester target | Menggunakan dataset semester pada tahun target |
| Snapshot | Jawaban tugas, submission quiz, riwayat kelas siswa | Mengikuti parent/periode asal | Tetap sebagai bukti historis |

Registry backend yang menjadi sumber klasifikasi teknis berada di:

`backend/app/Support/AcademicScopeRegistry.php`

## 5. Perilaku per Data

### 5.1 Jadwal pelajaran

Jadwal memiliki scope tahun ajaran.

- Pergantian Ganjil ke Genap tidak mereset jadwal tahunan.
- Jadwal dengan `periode_berlaku = tahunan` digunakan pada kedua semester.
- Jadwal khusus semester hanya ditampilkan pada semester yang sesuai.
- Saat tahun ajaran baru pertama kali dibuka dan belum memiliki jadwal, Admin wajib memilih salah satu keputusan:
  - **Ya, buat baru:** tahun target tetap kosong dan Admin menyusun jadwal baru.
  - **Tidak, pakai jadwal lama:** jadwal tahun sebelumnya disalin sebagai baris baru milik tahun target.
- Penyalinan jadwal tidak mengubah atau memindahkan baris tahun sebelumnya.
- Penyalinan bersifat idempotent: jadwal yang sudah ada pada tahun target tidak digandakan.
- Jika tahun target sudah pernah memiliki jadwal, jadwal tersebut langsung ditampilkan tanpa meminta keputusan ulang.

### 5.2 Ekstrakurikuler

Ekstrakurikuler memiliki dua bagian yang diperlakukan berbeda:

| Bagian | Pergantian semester | Kenaikan tahun ajaran |
|---|---|---|
| Katalog ekskul | Disalin sebagai snapshot katalog semester target jika belum tersedia | Disalin sebagai snapshot katalog tahun/semester target |
| Anggota ekskul | Tidak disalin; semester baru dimulai tanpa anggota | Default tidak disalin; Admin dapat memilih membawa anggota lama |
| Absensi ekskul | Dimulai sebagai transaksi semester target | Dimulai sebagai transaksi semester target |
| Riwayat lama | Tetap utuh dan dapat dibaca pada mode arsip | Tetap utuh dan dapat dibaca pada mode arsip |

Aturan tambahan:

- Katalog yang disalin mendapatkan ID baru dan periode target baru.
- Anggota dan absensi tidak boleh menunjuk katalog milik periode lama.
- Jika katalog atau anggota periode target sudah pernah dibuat, mengaktifkan atau melihat kembali periode tersebut tidak boleh mengosongkannya.
- Batas maksimal ekskul per siswa adalah pengaturan tenant dan tidak ikut direset setiap semester.
- Opsi membawa anggota hanya tersedia pada rollover maju satu tahun. Pergantian semester normal tetap memulai keanggotaan baru.

Service backend yang menangani snapshot katalog berada di:

`backend/app/Services/Academic/ExtracurricularPeriodService.php`

### 5.3 Kelas siswa dan kenaikan kelas

- Ganti semester tidak mengubah `profiles.kelas`.
- Naik kelas hanya dijalankan ketika Admin mengaktifkan tahun ajaran berikutnya.
- Rollover normal hanya boleh maju tepat satu tahun ajaran.
- Siswa dengan pengecualian tidak naik kelas tetap berada pada kelas asal.
- Siswa tingkat akhir dapat diubah menjadi alumni sesuai hasil preview rollover.
- Sebelum perubahan tahun, sistem menyimpan snapshot kelas periode lama.
- Membaca arsip harus menggunakan riwayat kelas siswa, bukan kelas profil siswa saat ini.
- Kembali ke tahun lama untuk melihat data tidak boleh menjalankan rollover balik.

### 5.4 Wali kelas, struktur, dan organisasi

- Data ini memiliki scope tahun ajaran.
- Pergantian Ganjil ke Genap tidak mereset wali kelas atau struktur.
- Tahun ajaran baru memiliki struktur tahun target sendiri.
- Membuka tahun lama menampilkan wali, ketua, struktur, dan organisasi yang tersimpan pada tahun tersebut.
- Perubahan struktur tahun aktif tidak boleh mengubah struktur tahun lama.

### 5.5 Tugas, quiz, dan absensi

- Data ini memiliki scope semester.
- Ganjil dan Genap mempunyai dataset terpisah pada tahun ajaran yang sama.
- Semester baru tidak menyalin submission atau absensi semester sebelumnya.
- Jawaban tugas dan submission quiz mengikuti parent asal dan tidak dihitung ulang berdasarkan periode aktif saat ini.
- Guru dan siswa tidak boleh membuat, memulai, mengumpulkan, atau mengubah transaksi pada mode arsip.

### 5.6 Bobot, nilai manual, ujian, dan rapor

- Bobot dan nilai manual disimpan berdasarkan tenant, tahun ajaran, semester, guru, kelas, dan mapel.
- Ganjil dan Genap tidak boleh saling menimpa.
- UTS/PTS memakai slot kanonis `uts` pada kedua semester.
- Slot akhir Ganjil memakai `uas` dan ditampilkan sebagai UAS/PAS.
- Slot akhir Genap memakai `uas` dan ditampilkan sebagai UKK/PAT.
- Quiz digital mengisi hasil dari submission digital.
- Ujian tulis/kertas diinput melalui nilai manual `0-100` pada komponen yang sesuai.
- Nilai tambah diinput melalui komponen manual dan hanya memberi kontribusi sesuai bobot yang dikonfigurasi.
- Rapor lama tetap terikat pada semester dan kelas historisnya.

## 6. Skenario Perubahan Periode

### 6.1 Ganjil ke Genap dalam tahun yang sama

Sistem harus:

1. mempertahankan jadwal tahunan;
2. mempertahankan wali kelas, struktur, dan organisasi tahunan;
3. menyiapkan snapshot katalog ekskul Genap jika belum ada;
4. tidak menyalin anggota dan absensi ekskul;
5. membuka dataset Genap untuk tugas, quiz, absensi, nilai, bobot, dan rapor;
6. tidak mengubah kelas siswa;
7. mengarsipkan transaksi Ganjil tanpa menghapusnya.

### 6.2 Genap ke tahun ajaran berikutnya

Sistem harus:

1. menampilkan preview dampak rollover;
2. meminta konfirmasi Admin;
3. memproses siswa naik kelas, pengecualian, dan alumni dalam transaction;
4. menyimpan snapshot kelas tahun sebelumnya;
5. menyiapkan katalog ekskul periode target;
6. menyalin anggota ekskul hanya jika Admin memilih opsi tersebut;
7. tidak menyalin jadwal secara otomatis dari halaman pengaturan periode;
8. meminta keputusan jadwal saat halaman Jadwal dibuka;
9. mempertahankan seluruh data tahun lama sebagai arsip.

### 6.3 Membuka periode lama

Memilih tahun atau semester lama harus:

- hanya mengubah data yang ditampilkan;
- tidak mengubah settings periode aktif;
- tidak mengubah kelas profil siswa;
- tidak menjalankan rollover;
- tidak mengosongkan periode target;
- mengunci tombol create, update, delete, submit, start, dan absensi;
- memakai roster, wali kelas, jadwal, nilai, dan laporan historis yang sesuai.

### 6.4 Kembali ke periode target yang pernah diisi

Jika Admin sebelumnya sudah mengisi data pada periode target, sistem harus memuat data tersebut apa adanya. Katalog, anggota, jadwal, nilai, atau transaksi tidak boleh dibuat ulang maupun dikosongkan hanya karena pengguna berpindah filter atau membuka periode itu kembali.

## 7. Perbedaan Filter dan Aktivasi

| Aksi | Dampak |
|---|---|
| Memilih tahun/semester pada filter halaman | Hanya mengubah tampilan pengguna tersebut |
| Membuka Mode Arsip | Membaca data lama dalam kondisi terkunci |
| Membuka sesi koreksi | Memberikan mutation terbatas dan tercatat pada arsip tertentu |
| Mengaktifkan semester | Mengubah semester operasional seluruh tenant tanpa menaikkan kelas |
| Mengaktifkan tahun ajaran baru | Menjalankan lifecycle dan rollover seluruh tenant |

## 8. Aturan Keamanan dan Integritas

1. `tenant_id` tidak boleh dipercaya dari frontend sebagai sumber otorisasi.
2. Tahun ajaran dan semester mutation ditetapkan atau diverifikasi server.
3. Mutation periode arsip normal ditolak dengan `409 Period Locked`.
4. Rollover memakai transaction, tenant lock, dan idempotency key.
5. Penyalinan jadwal, katalog, atau anggota harus dibatasi tenant dan periode sumber/target.
6. Semua penyalinan harus menghasilkan ID baru pada target.
7. Child snapshot tidak boleh dipindahkan ke parent periode baru.
8. Audit log mencatat aktor, tenant, periode, alasan, serta nilai sebelum dan sesudah.
9. Cache frontend harus menyertakan tenant, tahun, semester, dan mode sesuai scope data.
10. Perubahan periode aktif harus melalui konfirmasi dan impact preview.

## 9. Checklist QA

### Pergantian semester

- [ ] Jadwal tahunan tetap terlihat pada Ganjil dan Genap.
- [ ] Wali kelas dan struktur tidak berubah.
- [ ] Katalog ekskul tersedia pada semester target.
- [ ] Anggota dan absensi ekskul semester target mulai kosong jika belum pernah diisi.
- [ ] Tugas, quiz, absensi, bobot, nilai manual, dan rapor tidak tercampur dengan semester sebelumnya.
- [ ] Kelas siswa tidak berubah.

### Rollover tahun ajaran

- [ ] Preview dan hasil eksekusi rollover memiliki jumlah yang sama.
- [ ] Siswa naik kelas, pengecualian, dan alumni diproses benar.
- [ ] Snapshot kelas tahun lama dapat dibaca.
- [ ] Admin mendapatkan keputusan buat/salin jadwal jika target kosong.
- [ ] Penyalinan jadwal kedua tidak membuat duplikat.
- [ ] Opsi anggota ekskul bekerja hanya ketika dipilih.
- [ ] Data tahun lama tidak berubah.

### Arsip

- [ ] Admin, Guru, dan Siswa melihat periode yang sama.
- [ ] Mutation arsip ditolak.
- [ ] Periode target yang pernah diisi tampil kembali tanpa reset.
- [ ] Roster, wali, jadwal, laporan, dan rapor menggunakan data historis.
- [ ] Tenant lain tidak dapat membaca data arsip tenant yang diuji.

## 10. Rujukan Implementasi

- `backend/app/Support/AcademicScopeRegistry.php`
- `backend/app/Services/Academic/ExtracurricularPeriodService.php`
- `backend/app/Services/Academic/AcademicRolloverService.php`
- `backend/app/Http/Controllers/Api/AdminController.php`
- `src/context/AcademicContext.jsx`
- `src/components/AcademicPeriodArchiveFilter.jsx`
- `src/pages/admin/pengaturan.jsx`
- `src/pages/admin/Kelas.jsx`
- `docs/LAPORAN_AUDIT_KONSISTENSI_PERIODE_AKADEMIK.md`

Jika implementasi dan dokumen berbeda, perubahan kode belum boleh dianggap selesai sampai registry, backend guard, frontend context, pengujian, dan dokumen ini diselaraskan.
