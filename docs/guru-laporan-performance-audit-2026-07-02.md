# Audit Performa Halaman Laporan Guru

Tanggal: 2026-07-02

## Ringkasan

Halaman `src/pages/guru/Laporan.jsx` sudah memakai endpoint backend untuk tab
Absensi, Nilai Tugas, dan Nilai Quiz. Bottleneck utama ada pada tab Laporan
Mapel, Rekap Wali Kelas, Rekap Ekstrakurikuler, dan detail nilai siswa karena
masih menarik banyak tabel mentah lewat DB proxy lalu menghitung agregasi besar
di browser.

## Temuan

1. Laporan Mapel sebelumnya melakukan beberapa batch query mentah dari browser:
   `tugas`, `quizzes`, `tugas_jawaban`, `quiz_submissions`, `profiles`,
   `guru_mapel_manual_nilai`, `rapot_siswa`, dan `rapot_siswa_items`.
2. Rekap Wali Kelas masih melakukan query mentah besar untuk `profiles`,
   `jadwal`, `tugas`, `quizzes`, `absensi`, `tugas_jawaban`,
   `quiz_submissions`, bobot mapel, ekskul, dan absensi ekskul.
3. Detail nilai per siswa masih menghitung ulang data tugas/quiz per siswa di
   browser saat modal dibuka.
4. UI memakai satu global loading key, sehingga proses berat terasa memblokir
   seluruh panel laporan.
5. Jika guru memilih banyak bulan, payload absensi/nilai dapat membesar karena
   browser menerima raw rows dan membentuk tabel penuh.

## Perbaikan Yang Sudah Dikerjakan

Laporan Mapel sekarang menggunakan endpoint summary backend yang sudah ada:

- `GET /api/reports/task-summary`
- `GET /api/reports/quiz-summary`

Browser tidak lagi mengambil raw rows tugas/jawaban/quiz/submission untuk
Laporan Mapel. Data manual dan status rapot tetap diambil khusus karena bagian
itu berkaitan dengan aksi UI kirim/simpan nilai.

Dampak:

- Lebih sedikit round-trip DB proxy.
- Payload akademik lebih kecil karena backend mengirim hasil summary.
- Cache React Query/API backend bisa dipakai ulang antar tab Nilai Tugas, Nilai
  Quiz, dan Laporan Mapel.
- Risiko timeout pada tab Laporan Mapel turun.

## Solusi Terbaik Berikutnya

1. Buat endpoint backend khusus yang mengembalikan bentuk data final untuk Rekap
   Wali Kelas dan Rekap Ekstrakurikuler.
2. Pindahkan kalkulasi ranking, statistik akademik, absensi, ekskul, dan audit
   cakupan data dari browser ke `ReportController`.
3. Tambahkan endpoint detail siswa per mapel agar modal detail tidak query raw
   tables dari browser.
4. Pecah loading state per tab agar tab yang sudah punya data tetap responsif
   saat tab lain dimuat ulang.
5. Tambahkan index database untuk kolom laporan yang sering difilter:
   `tenant_id`, `kelas`, `kelas_id`, `mapel`, `tanggal`, `created_at`,
   `tahun_ajaran`, `semester`, `user_id`, `siswa_id`, `tugas_id`, `quiz_id`.
6. Tambahkan pagination atau virtualized table untuk tabel dengan banyak siswa
   dan banyak hari/bulan.

## Guardrail

- Endpoint laporan harus tetap tenant-scoped.
- Guru hanya boleh membaca kelas/mapel yang dia ajar atau kelas yang dia wali.
- Header client seperti `X-Admin-Feature` tidak boleh menjadi bukti akses.
- Response laporan tidak boleh mengirim raw secret, token, signed URL aktif,
  atau field sensitif yang tidak diperlukan.
