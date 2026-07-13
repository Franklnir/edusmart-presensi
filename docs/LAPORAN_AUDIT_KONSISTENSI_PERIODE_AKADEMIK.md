# Laporan Audit Konsistensi Periode Akademik SISMU

**Tanggal audit:** 13 Juli 2026
**Versi dokumen:** 2.3
**Branch yang diaudit:** `backup/vps-ready-20260430`
**Ruang lingkup role:** Admin Sekolah, Guru, dan Siswa
**Ruang lingkup sistem:** frontend React, API Laravel, skema/migrasi PostgreSQL, otorisasi tenant, arsip, laporan, dan rollover periode akademik
**Metode:** source-code review, penelusuran alur data lintas role, dan pengujian feature/unit terarah
**Status perbaikan:** diterapkan dan teruji lokal; migrasi, smoke test staging, dan deploy produksi belum dijalankan

---

## 1. Ringkasan Eksekutif

SISMU sudah memiliki fondasi periode akademik yang cukup kuat: data utama membawa `tenant_id`, banyak tabel transaksi sudah memiliki `tahun_ajaran` dan `semester`, riwayat kelas siswa sudah tersedia, katalog ekstrakurikuler dapat disalin tanpa membawa anggota, serta beberapa jalur laporan telah menggunakan roster historis.

Namun, audit menemukan bahwa kontrak periode belum diterapkan konsisten di seluruh lapisan. Frontend menganggap beberapa data berlaku satu tahun, sedangkan backend masih membatasinya ke semester aktif. Sebaliknya, beberapa halaman menerapkan filter semester terhadap data yang oleh backend dinyatakan berlaku satu tahun. Ada juga operasi mutasi dan rollover yang dapat mengubah penugasan periode lama karena pembaruan dilakukan tanpa filter tahun ajaran.

Temuan tersebut tidak menunjukkan kebocoran lintas tenant pada jalur yang diperiksa, tetapi menimbulkan risiko integritas arsip, hilangnya data historis, dan data kosong ketika pengguna membuka periode lama atau berpindah dari semester Ganjil ke Genap.

### Rekap temuan

| Tingkat | Jumlah | Status |
|---|---:|---|
| Kritis | 0 | Tidak ditemukan |
| Tinggi | 3 | Resolved di kode lokal |
| Sedang | 3 | Resolved di kode lokal |
| Observasi arsitektur | 1 | Resolved di kode lokal |

### Daftar singkat

| ID | Tingkat | Temuan | Dampak utama |
|---|---|---|---|
| AKD-HIGH-01 | Tinggi | Jadwal tahunan masih dibatasi semester oleh backend | Jadwal dan hak akses guru dapat hilang saat Ganjil ke Genap |
| AKD-HIGH-02 | Tinggi | Akses arsip siswa tetap dipaksa memakai kelas profil saat ini | Tugas, jadwal, dan quiz periode lama dapat kosong/403 setelah kenaikan kelas |
| AKD-HIGH-03 | Tinggi | Mutasi dan rollover dapat mengubah penugasan periode lama | Arsip wali kelas, ketua kelas, jadwal, organisasi, dan ekskul dapat rusak |
| AKD-MED-01 | Sedang | Struktur dan organisasi tahunan difilter sebagai data semester | Dashboard Guru/Siswa dapat kosong pada semester berikutnya |
| AKD-MED-02 | Sedang | Daftar kelas laporan wali belum mengikuti periode yang dipilih | Laporan/rapor periode lama dapat tidak tersedia walaupun datanya ada |
| AKD-MED-03 | Sedang | Snapshot kelas mengizinkan fallback lintas semester | Pemulihan periode dapat mengambil snapshot semester lain |
| AKD-OBS-01 | Observasi | Helper periode memiliki nama dan perilaku yang tidak selaras | Kesalahan filter mudah berulang pada fitur baru |

### Keputusan kesiapan

**Status: kode layak masuk staging; produksi tetap bersyarat pada migrasi, audit referensi nol-drift, smoke test tiga role, dan pemantauan pascadeploy.**

Sebelum Admin Sekolah memakai mutasi massal, kenaikan periode, atau pemulihan periode pada data produksi, tiga temuan tingkat tinggi harus diperbaiki dan dilindungi dengan regression test. Risiko terbesar bukan tampilan kosong semata, melainkan perubahan permanen terhadap data historis.

---

## 2. Tujuan Audit

Audit ini menjawab pertanyaan berikut:

1. Apakah data Guru, Siswa, dan Admin Sekolah selalu mengikuti periode akademik yang dipilih?
2. Apakah perpindahan ke periode baru membuat data baru tanpa merusak periode lama?
3. Apakah kembali ke periode lama menampilkan keadaan pada saat itu, bukan keadaan profil saat ini?
4. Apakah data tahunan dan data semester diperlakukan sesuai masa berlakunya?
5. Apakah data arsip bersifat hanya-baca pada jalur operasional periode aktif?
6. Apakah otorisasi Guru dan Siswa menggunakan kelas/penugasan pada periode yang diminta?
7. Apakah seluruh query tetap terikat tenant sekolah?

---

## 3. Batasan Audit

Audit dilakukan pada kode lokal dan test suite. Audit ini tidak melakukan perubahan data produksi, tidak menjalankan rollover produksi, dan tidak membandingkan seluruh isi database VPS per tenant.

Karena itu, laporan membedakan dua jenis kesimpulan:

- **Terkonfirmasi dari kode:** alur query atau mutation secara langsung menunjukkan ketidakkonsistenan.
- **Perlu validasi data produksi:** jumlah baris terdampak dan apakah kerusakan historis sudah pernah terjadi hanya dapat diketahui melalui query read-only ke database produksi.

Folder `docs/security-scans/` tidak menjadi bagian audit periode akademik dan tidak diubah.

---

## 4. Kontrak Periode Akademik yang Direkomendasikan

Satu kontrak formal perlu dipakai oleh frontend, backend, laporan, dan proses rollover.

### 4.1 Aturan umum

1. Semua data sekolah wajib memiliki dan mematuhi `tenant_id`.
2. Periode aktif berasal dari `settings` milik tenant, bukan tanggal lokal frontend saja.
3. Data periode lama adalah arsip dan hanya boleh dibaca oleh role yang berhak.
4. Operasi create/update/delete normal hanya boleh menargetkan periode aktif.
5. Perubahan periode tidak boleh mengubah baris periode lama.
6. Saat pengguna memilih tahun lama, otorisasi harus memakai penugasan dan kelas historis pada tahun tersebut.
7. Filter tanggal tidak boleh diam-diam menggantikan filter tahun/semester jika keduanya memiliki arti berbeda.
8. Data tahunan tidak boleh hilang hanya karena semester aktif berubah.
9. Data semester harus menggunakan pasangan `tahun_ajaran + semester`, bukan salah satunya saja.
10. Setiap fallback ke data periode lain harus eksplisit, tercatat, dan tidak boleh dipakai untuk mutation.

### 4.2 Klasifikasi data

Klasifikasi berikut mengikuti perilaku produk dan sebagian besar intent yang sudah terlihat pada kode.

| Scope | Data | Kunci periode yang seharusnya |
|---|---|---|
| Global/current projection | `profiles`, master mapel, perangkat RFID, login history, sertifikat, konfigurasi umum | `tenant_id`; tidak disalin tiap periode |
| Tahunan | `jadwal`, `kelas_struktur`, `struktur_sekolah`, `organisasi`, `organisasi_anggota` | `tenant_id + tahun_ajaran` |
| Semester | `tugas`, `quizzes`, `absensi`, `absensi_ajuan`, `absensi_settings`, `jam_kosong`, `ekskul`, `ekskul_anggota`, `absensi_eskul`, `guru_mapel_bobot` | `tenant_id + tahun_ajaran + semester` |
| Nilai manual mapel | `guru_mapel_manual_nilai` | `tenant_id + guru_id + siswa_id + kelas_id + mapel + tahun_ajaran + semester` |
| Rapor/penilaian akhir | `rapot_siswa` | `tenant_id + siswa_id + kelas_id + tahun_pelajaran + semester + jenis` |
| Snapshot roster | `student_class_histories` | minimal `tenant_id + student_id + tahun_ajaran`; semester wajib jika kelas dapat berubah di tengah tahun |
| Child snapshot | `tugas_jawaban`, `quiz_submissions` | periode diwarisi dari parent dan tidak dihitung ulang dari periode aktif |

Catatan: `semester` masih tersedia pada beberapa tabel tahunan karena sejarah migrasi. Untuk data tahunan, kolom tersebut tidak boleh menjadi filter otorisasi atau visibilitas. Jika tidak dihapus, nilainya hanya metadata asal pembuatan.

### 4.3 Slot penilaian resmi per semester

Penyimpanan memakai slot kanonis yang stabil agar query, unique constraint, laporan, dan integrasi lama tidak berubah mengikuti istilah tampilan sekolah.

| Semester | Slot tengah semester | Slot akhir semester |
|---|---|---|
| Ganjil | `uts` ditampilkan sebagai **UTS / PTS** | `uas` ditampilkan sebagai **UAS / PAS** |
| Genap | `uts` ditampilkan sebagai **UTS / PTS** | `uas` ditampilkan sebagai **UKK / PAT** |

`UKK/PAT` bukan bucket nilai ketiga. Nilai tersebut adalah presentasi slot akhir semester Genap. Quiz reguler tetap memakai slot `regular` dan tidak dicampur dengan nilai tengah atau akhir semester. Label UI, rekap Guru, Rapor Wali, laporan, dan ekspor wajib diturunkan dari pasangan `semester + slot`, bukan dari teks bebas.

Kontrak ini mencegah empat konflik:

1. UTS Ganjil tidak menimpa UTS Genap pada tahun ajaran yang sama.
2. UAS/PAS Ganjil tidak menimpa UKK/PAT Genap.
3. Perubahan istilah UTS menjadi PTS atau UKK menjadi PAT tidak memerlukan migrasi data.
4. Rapor dan laporan selalu membaca jenis ujian dengan konteks semester yang sama.

### 4.4 Perilaku saat periode berubah

| Aksi | Perilaku yang benar |
|---|---|
| Maju ke semester berikutnya dalam tahun sama | Jadwal/struktur/organisasi tahunan tetap terlihat; tugas, quiz, absensi, dan anggota ekskul memakai semester baru |
| Maju ke tahun ajaran baru | Periode lama tetap utuh; data target dibuat/reset/disalin sesuai keputusan fitur |
| Kembali ke periode lama | Seluruh tampilan memakai roster, wali, jadwal, dan transaksi pada periode lama |
| Mutasi/alumni | Profil aktif dinonaktifkan; hanya penugasan periode aktif yang dilepas; arsip tidak disentuh |
| Edit nama profil | Kebijakan snapshot harus eksplisit: nama historis dipertahankan atau diperbarui, tetapi penugasan historis tidak boleh dilepas |

---

## 5. Dampak per Role

| Area | Admin Sekolah | Guru | Siswa |
|---|---|---|---|
| Jadwal tahunan | Jadwal terlihat sudah dibuat, tetapi backend dapat menganggapnya tidak aktif pada semester lain | Kelas ajar dan hak akses dapat hilang | Absen mandiri dapat ditolak karena sesi jadwal tidak ditemukan |
| Arsip kelas | Data profil saat ini tampak benar, tetapi arsip siswa tidak selalu dapat dibuka | Laporan siswa lama dapat tidak lengkap | Tugas/jadwal/quiz lama dapat kosong atau 403 |
| Mutasi dan rollover | Dapat merusak arsip ketika menonaktifkan akun atau menaikkan kelas | Riwayat wali/pembina/jadwal dapat terhapus | Riwayat ketua kelas/keanggotaan dapat berubah |
| Struktur/organisasi | Halaman admin cenderung memakai tahun dan terlihat benar | Dashboard dapat kosong setelah semester berganti | Dashboard dapat kosong setelah semester berganti |
| Laporan wali | Pemilihan periode admin tidak langsung terdampak | Daftar kelas wali lama dapat tidak muncul | Hasil historis dapat tidak dapat dijangkau dari UI guru |

---

## 6. Temuan Detail

### AKD-HIGH-01: Jadwal Tahunan Masih Dikunci ke Semester Backend

**Tingkat:** Tinggi
**Status:** RESOLVED LOCAL
**Jenis risiko:** ketersediaan data, otorisasi, dan konsistensi lintas semester
**Role terdampak:** Admin Sekolah, Guru, Siswa

#### Perilaku yang diharapkan

Jadwal dengan `periode_berlaku = tahunan` harus berlaku selama satu `tahun_ajaran`. Perubahan dari Ganjil ke Genap tidak boleh menghilangkan jadwal, kelas ajar guru, atau validasi sesi absensi.

#### Bukti kode

1. Frontend menetapkan seluruh jadwal sebagai tahunan:
   - `src/utils/schedulePeriodScope.js:13` selalu mengembalikan `tahunan`.
   - `src/utils/schedulePeriodScope.js:17` mengubah scope jadwal menjadi semester kosong.
   - `src/utils/schedulePeriodScope.js:26-28` menganggap jadwal berlaku pada semua semester.
2. Backend memasukkan `jadwal` ke `ACADEMIC_DEFAULT_SCOPE_TABLES` pada `backend/app/Http/Controllers/Api/DbController.php:84`.
3. `jadwal` tidak termasuk `ACADEMIC_YEAR_SCOPE_TABLES` pada `DbController.php:111-116`.
4. `applyDefaultAcademicSelectScope()` pada `DbController.php:4403-4428` kemudian menambah filter `tahun_ajaran` dan `semester` untuk jadwal tanpa filter eksplisit.
5. `attachAcademicPeriodRows()` pada `DbController.php:4470-4510` mengisi semester aktif ketika payload jadwal mengirim semester kosong.
6. Otorisasi kelas guru pada `DbController.php:4838-4867` memakai `applyCurrentAcademicPeriodToQuery()` terhadap `jadwal`, sehingga meminta semester persis aktif.
7. Validasi absen mandiri siswa pada `DbController.php:2805-2818` juga meminta jadwal pada semester persis aktif.
8. Migrasi `backend/database/migrations/2026_05_23_000500_add_period_scope_to_jadwal.php` secara eksplisit membuat `periode_berlaku` dan mengisi nilai default `tahunan`.

#### Skenario kegagalan

1. Admin membuat jadwal tahun `2026/2027` saat semester aktif `Ganjil`.
2. Frontend menampilkan jadwal tersebut sebagai jadwal tahunan.
3. Backend menyimpan `semester = Ganjil` melalui auto-attachment periode.
4. Sekolah mengganti semester aktif menjadi `Genap` pada tahun yang sama.
5. Query backend default, `guruKelasIds()`, dan pemeriksaan absen mandiri mencari `semester = Genap`.
6. Jadwal Ganjil tidak ditemukan walaupun `periode_berlaku = tahunan`.

#### Dampak

- Guru dapat kehilangan daftar kelas yang diajar dan akses yang diturunkan dari jadwal.
- Siswa dapat menerima pesan sesi absensi tidak aktif walaupun jadwal tahunan tersedia.
- Live scan/RFID berpotensi tidak menemukan jadwal aktif.
- Admin melihat perilaku berbeda antara halaman yang memfilter tahun secara eksplisit dan endpoint yang memakai default backend.

#### Rekomendasi perbaikan

1. Jadikan `jadwal` sebagai scope tahunan pada satu registry backend resmi.
2. Untuk produk saat ini, query jadwal harus memakai `tenant_id + tahun_ajaran`; jangan gunakan `semester` sebagai syarat otorisasi.
3. Jika dukungan jadwal per semester dikembalikan kelak, evaluasi `periode_berlaku` (`tahunan`, `ganjil`, `genap`) secara eksplisit.
4. Ubah `guruKelasIds()` dan validasi absen mandiri agar memakai tahun aktif dan scope jadwal.
5. Pastikan query Live Scan/Admin Scan selalu mengirim `tahun_ajaran` aktif.
6. Normalisasi data lama agar `periode_berlaku` tidak kosong.
7. Jangan memakai kolom `semester` jadwal sebagai sumber kebenaran selama jadwal diputuskan tahunan.

#### Kriteria penerimaan

- Jadwal yang dibuat pada Ganjil masih terlihat dan sah pada Genap di tahun yang sama.
- Guru tetap memiliki akses kelas berdasarkan jadwal tahunan.
- Absen mandiri dan Live Scan menemukan jadwal pada kedua semester.
- Jadwal tahun lama tidak muncul pada tahun aktif.
- Tenant lain tidak dapat membaca jadwal tersebut.

#### Regression test wajib

- `annual_schedule_created_in_odd_semester_is_available_in_even_semester`
- `teacher_class_authorization_uses_schedule_academic_year`
- `student_self_attendance_accepts_annual_schedule_in_even_semester`
- `annual_schedule_scope_remains_tenant_isolated`

---

### AKD-HIGH-02: Arsip Siswa Masih Dipaksa Menggunakan Kelas Profil Saat Ini

**Tingkat:** Tinggi
**Status:** RESOLVED LOCAL
**Jenis risiko:** arsip tidak dapat dibaca dan otorisasi periode salah
**Role terdampak:** terutama Siswa; Guru/Admin terdampak saat memeriksa hasil historis

#### Perilaku yang diharapkan

Saat siswa yang sekarang berada di kelas XI membuka tahun ketika ia masih berada di kelas X, backend harus mengotorisasi pembacaan berdasarkan `student_class_histories` tahun yang dipilih. Operasi membuat jawaban, memulai quiz, atau mengubah data tetap hanya boleh dilakukan pada periode aktif dan kelas saat ini.

#### Bukti kode

1. Frontend sudah mencoba mengambil kelas historis:
   - `src/hooks/useStudentPeriodClass.js:10-36` membaca `student_class_histories` berdasarkan `student_id + tahun_ajaran`.
   - `src/pages/siswa/Tugas.jsx:572` memakai hook tersebut.
   - `Tugas.jsx:651`, `658`, dan `700` menggunakan kelas hasil resolusi untuk tugas/jadwal.
2. Backend tetap menambahkan kelas profil saat ini:
   - Select `jadwal` siswa pada `backend/app/Http/Controllers/Api/DbController.php:1085-1087` menambah `kelas_id = profiles.kelas`.
   - Select `tugas` siswa pada `DbController.php:2076-2078` menambah `kelas = profiles.kelas`.
3. Dashboard quiz siswa pada `backend/app/Http/Controllers/Api/QuizController.php:59-66` memakai `studentClassId()`.
4. Detail quiz pada `QuizController.php:268-270` membandingkan kelas quiz dengan kelas profil saat ini.
5. `studentClassId()` pada `QuizController.php:2313-2315` hanya membaca `profiles.kelas`.
6. Jalur `resolveStudentQuiz()` pada `QuizController.php:2285-2297` dengan benar membatasi aksi quiz ke periode aktif, tetapi belum dipisahkan dari kebutuhan baca arsip.

#### Skenario kegagalan

1. Siswa berada di kelas X pada `2025/2026` dan memiliki tugas/quiz.
2. Pada `2026/2027`, profil siswa dipindahkan ke kelas XI.
3. Siswa memilih arsip `2025/2026`; frontend mengirim kelas X.
4. Kebijakan backend menambahkan syarat kelas XI dari `profiles.kelas`.
5. Query menjadi kelas X dan kelas XI sekaligus, sehingga hasil kosong; detail quiz dapat memberikan 403.

#### Dampak

- Arsip tugas, jadwal, dan quiz tidak konsisten setelah kenaikan kelas.
- Riwayat terlihat hilang padahal data masih ada.
- Pengguna cenderung menganggap backup/rollover gagal.
- Jalur frontend dan backend memiliki sumber kebenaran kelas yang berbeda.

#### Rekomendasi perbaikan

1. Tambahkan resolver backend `studentClassForAcademicYear(tenantId, studentId, academicYear)`.
2. Ambil tahun yang diminta hanya dari filter/query yang sudah divalidasi, bukan input mentah bebas.
3. Untuk read-only arsip `jadwal`, `tugas`, daftar quiz, hasil quiz, absensi, dan laporan siswa, gunakan kelas historis tahun tersebut.
4. Untuk periode aktif, tetap gunakan profil saat ini sebagai proyeksi cepat dan validasi terhadap snapshot bila diperlukan.
5. Pisahkan policy `read archive` dari policy `start/submit/update/delete`.
6. Aksi quiz, pengumpulan tugas, dan absensi periode lama harus selalu ditolak walaupun arsip dapat dibaca.
7. Resolver harus selalu menyertakan `tenant_id` dan status snapshot yang diizinkan.

#### Kriteria penerimaan

- Siswa yang naik kelas dapat membuka tugas, jadwal, hasil quiz, dan absensi tahun sebelumnya.
- Siswa tidak dapat membuka data kelas yang tidak pernah diikutinya.
- Siswa tidak dapat memulai quiz atau mengirim tugas pada periode arsip.
- Guru/Admin dapat melihat hasil lama dengan roster periode lama.
- Seluruh pemeriksaan tetap tenant-scoped.

#### Regression test wajib

- `promoted_student_can_read_previous_year_schedule`
- `promoted_student_can_read_previous_year_tasks`
- `promoted_student_can_read_previous_year_quiz_results`
- `promoted_student_cannot_start_or_submit_archived_work`
- `student_cannot_claim_unrelated_historical_class`

---

### AKD-HIGH-03: Mutasi dan Rollover Dapat Mengubah Penugasan Periode Lama

**Tingkat:** Tinggi
**Status:** RESOLVED LOCAL
**Jenis risiko:** kerusakan permanen arsip dan kehilangan integritas historis
**Role terdampak:** Admin Sekolah, Guru, Siswa

#### Perilaku yang diharapkan

Ketika Guru/Siswa menjadi mutasi atau alumni, sistem hanya melepaskan penugasan pada periode aktif. Baris tahun sebelumnya harus tetap mencatat siapa wali kelas, ketua kelas, guru jadwal, pembina organisasi, dan pembina ekstrakurikuler pada saat itu.

#### Bukti kode

1. Perubahan status ke `mutasi`/`alumni` memanggil helper pembersihan pada `backend/app/Http/Controllers/Api/AdminController.php:2866-2869`.
2. `clearStudentActiveAssignments()` pada `AdminController.php:3384-3397` memperbarui `kelas_struktur` berdasarkan siswa tanpa menerima parameter periode.
3. `clearTeacherActiveAssignments()` pada `AdminController.php:3400-3451` membersihkan referensi guru di `jadwal`, `kelas_struktur`, `struktur_sekolah`, `organisasi`, dan `ekskul` tanpa menerima parameter periode.
4. Helper `updateTenantSnapshotTable()` pada `backend/app/Http/Controllers/Api/ApiController.php:294-328` hanya menerapkan tenant dan kolom pencocokan; tidak menerapkan tahun/semester.
5. Saat rollover, `AdminController.php:4011-4023` mengosongkan ketua kelas berdasarkan seluruh `kelas_id` terdampak dengan filter tenant, tetapi tanpa filter tahun ajaran target.

#### Skenario kegagalan

1. Guru A adalah wali kelas pada `2025/2026` dan masih memiliki baris arsip `kelas_struktur`.
2. Pada `2026/2027`, Guru A dimutasi.
3. `clearTeacherActiveAssignments()` mencari seluruh baris dengan `wali_guru_id = Guru A` pada tenant tersebut.
4. Penugasan tahun `2025/2026` ikut dikosongkan.
5. Ketika sekolah membuka arsip, nama wali lama telah hilang.

Skenario serupa berlaku untuk guru jadwal, pembina, dan ketua siswa saat rollover.

#### Dampak

- Arsip dapat berubah setelah periode ditutup.
- Laporan lama kehilangan konteks penanggung jawab.
- Audit trail sekolah tidak lagi merepresentasikan keadaan pada periode tersebut.
- Kerusakan mungkin tidak mudah dipulihkan tanpa backup database.

#### Rekomendasi perbaikan

1. Jangan gunakan helper mutation generik tanpa periode untuk melepas penugasan aktif.
2. Buat operasi khusus per tabel yang menerima `tenantId`, `tahunAjaran`, dan scope tabel.
3. Untuk tabel tahunan, tambahkan `where tahun_ajaran = tahun aktif`.
4. Untuk tabel semester, tambahkan `where tahun_ajaran = tahun aktif AND semester = semester aktif`.
5. Pada rollover, buat atau pilih baris `kelas_struktur` tahun target lalu kosongkan ketua hanya pada baris target.
6. Pertahankan nama snapshot periode lama meskipun akun profil dinonaktifkan.
7. Tambahkan audit log yang mencatat periode dan jumlah baris per tabel yang diubah.
8. Sebelum patch data produksi, ambil backup database dan jalankan query read-only untuk mendeteksi arsip yang sudah telanjur kosong.

#### Kriteria penerimaan

- Mutasi Guru pada tahun aktif tidak mengubah satu pun baris tahun sebelumnya.
- Alumni/Mutasi Siswa tidak menghapus ketua kelas periode lama.
- Rollover hanya mengubah/membuat struktur kelas tahun target.
- Audit log mencantumkan tenant, periode, aktor, dan jumlah baris.
- Seluruh operasi selesai atomik dalam transaksi.

#### Regression test wajib

- `teacher_mutation_preserves_historical_schedule_and_structure`
- `student_mutation_preserves_historical_class_leader`
- `rollover_clears_only_target_year_class_leader`
- `assignment_cleanup_is_tenant_and_period_scoped`

---

### AKD-MED-01: Data Tahunan Struktur dan Organisasi Difilter sebagai Data Semester

**Tingkat:** Sedang
**Status:** RESOLVED LOCAL
**Jenis risiko:** data kosong atau berbeda antarhalaman
**Role terdampak:** Guru dan Siswa

#### Perilaku yang diharapkan

`struktur_sekolah`, `kelas_struktur`, `organisasi`, dan `organisasi_anggota` berlaku satu tahun ajaran. Data harus tetap tampil saat semester berubah dalam tahun yang sama.

#### Bukti kode

1. Backend secara eksplisit memasukkan empat tabel tersebut ke `ACADEMIC_YEAR_SCOPE_TABLES` pada `backend/app/Http/Controllers/Api/DbController.php:111-116`.
2. Indeks dan unique constraint migrasi juga memakai tahun, bukan semester, misalnya `kelas_struktur (tenant_id, kelas_id, tahun_ajaran)` pada `backend/database/migrations/2026_06_30_000100_add_period_scope_to_structure_and_organization_tables.php:189-197`.
3. Halaman Siswa memiliki helper yang menambah tahun dan semester pada `src/pages/siswa/Home.jsx:92-97`.
4. Helper tersebut dipakai untuk `struktur_sekolah` pada `Home.jsx:780-784`, `organisasi` pada `Home.jsx:1109`, dan `organisasi_anggota` pada `Home.jsx:1132`.
5. Dashboard Guru memakai `applyAcademicPeriodFilters()` dengan default `semester = true` pada `src/pages/guru/JadwalGuru.jsx:73-78`.
6. Filter tersebut diterapkan ke `struktur_sekolah`, `kelas_struktur`, dan `organisasi` pada `JadwalGuru.jsx:1566-1597`, serta anggota organisasi pada `JadwalGuru.jsx:1717-1725`.

#### Dampak

- Struktur yang dibuat pada Ganjil dapat tidak terlihat pada Genap.
- Admin melihat data karena halaman admin memakai tahun, tetapi Guru/Siswa melihat kosong.
- Jumlah anggota organisasi dapat berbeda antarrole.

#### Rekomendasi perbaikan

1. Gunakan helper tahun saja untuk empat tabel tahunan.
2. Tetap gunakan helper tahun+semester untuk ekstrakurikuler dan transaksi semester.
3. Hapus fallback legacy yang dapat menampilkan data lintas semua periode tanpa filter tenant/periode yang tepat.
4. Jadikan registry scope backend sebagai referensi yang juga diuji di frontend.

#### Kriteria penerimaan

- Struktur dan organisasi sama pada Ganjil/Genap dalam tahun yang sama.
- Tahun lama dan tahun aktif tetap terpisah.
- Admin, Guru, dan Siswa melihat data periode yang sama.

#### Regression test wajib

- `annual_structure_is_visible_in_both_semesters`
- `annual_organization_members_are_visible_in_both_semesters`
- `annual_structure_does_not_leak_across_academic_years_or_tenants`

---

### AKD-MED-02: Daftar Laporan Wali Belum Mengikuti Periode yang Dipilih

**Tingkat:** Sedang
**Status:** RESOLVED LOCAL
**Jenis risiko:** arsip tidak dapat dijangkau dari UI
**Role terdampak:** Guru/Wali Kelas; Siswa terdampak pada hasil laporan

#### Perilaku yang diharapkan

Ketika Guru memilih tahun lama, daftar kelas wali harus berasal dari `kelas_struktur` tahun tersebut. Keberadaan kelas arsip tidak boleh bergantung pada apakah rapor untuk kelas itu sudah pernah dibuat.

#### Bukti kode

1. `src/pages/guru/Laporan.jsx:497-530` mengambil `kelas_struktur` hanya berdasarkan `wali_guru_id`, tanpa filter tahun yang dipilih.
2. Effect pemuatan daftar wali hanya bergantung pada `user.id`, sehingga perubahan filter periode tidak memuat ulang daftar kelas wali.
3. Backend default akan membatasi select tersebut ke periode aktif, sehingga daftar wali lama tidak tersedia dari query itu.
4. `src/pages/guru/RapotSiswa.jsx:193-207` menggabungkan struktur aktif dengan kelas yang ditemukan dari baris `rapot_siswa`.
5. Kelas wali historis yang belum memiliki baris rapor dapat tidak masuk opsi arsip.
6. Backend laporan sudah memiliki pemeriksaan wali berdasarkan tahun, sehingga kekurangan utama berada pada pembentukan opsi frontend, bukan kebutuhan membuka akses baru.

#### Dampak

- Guru tidak dapat memilih kelas yang pernah diwalikan pada tahun lama.
- Arsip tampak hilang bila rapor belum pernah disimpan.
- Pengguna harus bergantung pada data transaksi sebagai daftar master, yang tidak stabil.

#### Rekomendasi perbaikan

1. Filter `kelas_struktur` menggunakan `reportPeriod.tahunAjaran`.
2. Tambahkan tahun terpilih ke dependency effect/query key.
3. Bangun opsi rapor historis dari `kelas_struktur` tahun tersebut, kemudian gabungkan data rapor sebagai status, bukan sebagai sumber keberadaan kelas.
4. Untuk roster siswa, tetap gunakan `student_class_histories` tahun yang dipilih.
5. Tandai arsip sebagai read-only bila periode bukan periode aktif.

#### Kriteria penerimaan

- Guru dapat memilih seluruh kelas yang pernah diwalikan pada tahun yang dipilih.
- Kelas lama tetap muncul walaupun belum ada rapor tersimpan.
- Guru yang bukan wali pada tahun tersebut tidak mendapat akses.
- Perubahan tahun langsung memperbarui daftar kelas dan roster.

#### Regression test wajib

- `homeroom_report_options_follow_selected_academic_year`
- `historical_homeroom_class_is_listed_without_existing_report_rows`
- `teacher_cannot_open_class_not_assigned_in_requested_year`

---

### AKD-MED-03: Snapshot Kelas Mengizinkan Fallback Lintas Semester

**Tingkat:** Sedang
**Status:** RESOLVED LOCAL
**Jenis risiko:** pemulihan periode menggunakan snapshot yang tidak persis
**Role terdampak:** Admin Sekolah dan Siswa

#### Perilaku yang diharapkan

Jika kelas siswa dapat berubah di tengah tahun, pemulihan `Ganjil` harus memakai snapshot Ganjil dan pemulihan `Genap` harus memakai snapshot Genap. Jika kelas secara bisnis selalu tahunan, sistem harus menyatakan snapshot sebagai tahunan dan tidak memberi kesan bahwa semester digunakan sebagai kunci.

#### Bukti kode

1. `hasStudentClassSnapshotsForPeriod()` pada `backend/app/Http/Controllers/Api/AdminController.php:5236-5258` hanya memeriksa `tahun_ajaran`.
2. `latestStudentSnapshotRowsForPeriod()` pada `AdminController.php:5383-5417` menghitung semester yang diminta, tetapi query awal hanya memfilter tahun.
3. Pemilihan pada `AdminController.php:5418-5445` memprioritaskan semester yang sama, tetapi tetap menerima snapshot semester lain sebagai fallback jika snapshot persis tidak ada.
4. `src/hooks/useStudentPeriodClass.js:18-35` juga memilih kelas hanya berdasarkan tahun dan mengambil baris terbaru.

#### Dampak

- Sistem dapat menyatakan snapshot periode tersedia walaupun hanya semester lain yang tersedia.
- Pemulihan Ganjil dapat memakai kelas/status dari Genap pada kondisi data tidak lengkap.
- Perilaku frontend dan backend sulit diprediksi ketika ada lebih dari satu snapshot dalam tahun sama.

#### Rekomendasi perbaikan

Pilih dan dokumentasikan salah satu kontrak berikut:

**Kontrak yang direkomendasikan untuk fleksibilitas:** snapshot semester.

1. `hasStudentClassSnapshotsForPeriod()` memeriksa tahun dan semester.
2. Resolver memilih semester persis dan tidak fallback otomatis untuk mutation/restore.
3. Fallback tahun hanya boleh untuk read-only legacy, disertai flag `legacy_fallback = true`.
4. Tambahkan constraint/index sesuai identitas snapshot yang disepakati.

**Alternatif jika kelas selalu tahunan:** snapshot tahun.

1. Hapus semester dari kontrak roster.
2. Pastikan hanya ada satu snapshot otoritatif per siswa per tahun/status relevan.
3. Semua UI dan backend memakai resolver tahunan yang sama.

#### Kriteria penerimaan

- Preview dan eksekusi restore memakai snapshot yang sama.
- Restore tidak diam-diam memakai semester lain.
- Data legacy yang tidak lengkap dilaporkan sebagai exception, bukan langsung diterapkan.
- Resolver frontend dan backend menghasilkan kelas yang sama.

#### Regression test wajib

- `semester_restore_requires_exact_snapshot`
- `restore_preview_matches_restore_execution`
- `legacy_snapshot_fallback_is_read_only_and_explicit`

---

### AKD-OBS-01: Helper Periode Memiliki Nama dan Perilaku yang Tidak Selaras

**Tingkat:** Observasi arsitektur
**Status:** RESOLVED LOCAL
**Dihitung sebagai:** akar penyebab, tidak ditambahkan ke jumlah enam temuan utama

#### Bukti kode

Pada `src/hooks/useActiveAcademicPeriod.js`:

- `toPeriodFilter()` pada baris `12-15` selalu mengosongkan semester.
- `setSemester()` pada baris `217` merupakan no-op.
- `applyPeriodFilters()` pada baris `223-230` hanya memfilter tahun.
- `applySemesterPeriodFilters()` pada baris `232-239` juga hanya memfilter tahun.
- `activeSemesterPeriod` pada baris `241-250` justru menunjuk periode scope tahunan.

Nama `applySemesterPeriodFilters` dan `activeSemesterPeriod` memberi sinyal bahwa semester diterapkan, padahal perilakunya tahunan. Di file lain terdapat helper lokal dengan nama serupa yang benar-benar menambahkan semester. Perbedaan ini membuat pengembang mudah memakai scope yang salah.

#### Rekomendasi arsitektur

1. Ganti helper ambigu dengan dua API eksplisit:
   - `applyAcademicYearFilter(query, period)`
   - `applyAcademicSemesterFilter(query, period)`
2. Buat registry scope tabel di backend, misalnya `GLOBAL`, `ACADEMIC_YEAR`, `ACADEMIC_SEMESTER`, dan `PARENT_SNAPSHOT`.
3. Tambahkan unit test yang memetakan setiap tabel periodik ke tepat satu scope.
4. Hindari helper lokal dengan nama sama tetapi perilaku berbeda.
5. Sertakan scope pada query key cache agar data tahun/semester tidak tertukar.

---

## 7. Bagian yang Sudah Konsisten

Audit juga menemukan komponen yang sudah menuju desain yang benar dan sebaiknya dipertahankan.

### 7.1 Isolasi tenant

- Query utama pada controller yang diperiksa menggunakan tenant aktif.
- Helper mutation generik tetap menerapkan `tenant_id`; masalahnya adalah belum menerapkan periode, bukan lintas tenant.
- Pengujian otorisasi database dan delegated admin lulus.

### 7.2 Struktur kelas tahunan

- Backend mengklasifikasikan `kelas_struktur` sebagai data tahunan.
- Migrasi membuat unique constraint `tenant_id + kelas_id + tahun_ajaran`.
- Hak wali kelas untuk data sensitif sudah diuji agar mengikuti tahun aktif, bukan semester.

### 7.3 Ekstrakurikuler

- Katalog dan anggota membawa tahun+semester.
- Rollover dapat menyalin katalog ke periode target.
- Secara default anggota tidak disalin, sesuai kebutuhan reset periode baru.
- Bila opsi carry member digunakan, ID katalog lama dipetakan ke katalog target.
- Jalur membership aktif sudah memiliki pemeriksaan tenant dan periode.

### 7.4 Snapshot child transaksi

- `tugas_jawaban` dan `quiz_submissions` memiliki snapshot periode yang diwarisi dari parent.
- Desain ini mencegah jawaban lama berubah periode ketika periode aktif sekolah berganti.

### 7.5 Laporan dan roster historis tertentu

- `src/pages/guru/Laporan.jsx` sudah mencoba menggunakan `student_class_histories` untuk roster periode arsip.
- `src/pages/guru/RapotSiswa.jsx` juga memiliki fallback roster historis.
- Backend laporan sudah memeriksa wali/guru berdasarkan tahun pada beberapa jalur.

### 7.6 Bobot penilaian dan rapor

- Bobot mapel memakai scope semester karena sumber UTS/PAS dapat berbeda antara Ganjil dan Genap.
- Sumber tengah dan akhir semester dapat dipilih `digital` atau `manual`; pilihan manual berarti nilai ujian kertas dimasukkan Guru dan hasil Quiz digital pada slot tersebut tidak dihitung ganda.
- Sisa bobot sampai 100% mempunyai tujuan eksplisit: Absensi manual, Nilai Tambah Guru, atau komponen lain dengan label yang ditetapkan Guru.
- Nilai manual mapel memakai pasangan tahun ajaran dan semester sehingga nilai Ganjil tidak ditimpa saat Guru mengisi Genap.
- Rapor memakai `tahun_pelajaran + semester + jenis`, sehingga UTS/PTS, UAS/PAS, dan UKK/PAT terisolasi tanpa bergantung pada profil kelas terkini.
- Backend menolak periode yang dimanipulasi dari browser dan menetapkan referensi periode aktif pada mutation normal.
- Halaman rapor arsip bersifat baca/ekspor; penyimpanan normal ke semester nonaktif ditolak dengan `409 academic_period_locked`.

### 7.7 Data yang memang global

Data berikut tidak perlu direset ketika periode berganti: akun/profil saat ini, master mapel, perangkat RFID, sertifikat, login history, konfigurasi tenant, dan referensi file storage. Data transaksi atau snapshot yang mengacu pada entitas tersebut tetap harus membawa periode sendiri.

---

## 8. Hasil Pengujian

Baseline audit awal:

```bash
cd backend
php artisan test --compact \
  tests/Feature/AcademicPeriodProfileRestoreTest.php \
  tests/Feature/DbSecurityTest.php \
  tests/Feature/DelegatedAdminAuthorizationTest.php
```

Hasil baseline 11 Juli 2026:

```text
Tests: 48 passed (335 assertions)
Duration: 10.47s
```

Validasi implementasi 12 Juli 2026:

```bash
cd backend
php artisan test \
  tests/Feature/AcademicPeriodConsistencyTest.php \
  tests/Feature/AcademicPeriodProfileRestoreTest.php \
  tests/Unit/AcademicScopeRegistryTest.php

cd ..
npm run check
```

```text
Backend terarah: 29 passed (245 assertions)
Frontend: Vite production build berhasil, 3061 modul ditransformasi
PWA: 120 entri precache berhasil dibuat
PHP lint: 25 file perubahan lulus
```

Suite backend penuh sempat menemukan dua kontrak dokumentasi/test lama: route baru belum tercatat dan ekspektasi archive lock masih `422`. Keduanya diperbarui. Validasi terbaru 13 Juli 2026 menghasilkan `237 passed (1456 assertions)` dalam 15,66 detik. Build frontend mentransformasi 3062 modul dan membuat 121 entri PWA precache.

### Makna hasil

Tes yang ada berhasil memvalidasi antara lain:

- restore roster dari snapshot otoritatif;
- penolakan restore mundur tanpa snapshot;
- rollover siswa SMP/SMA;
- penyalinan katalog ekstrakurikuler dan reset anggota;
- keputusan salin jadwal dari halaman jadwal;
- pembuatan kelas tujuan rollover;
- pembatasan database gateway;
- otorisasi wali kelas aktif;
- default scope ekstrakurikuler;
- delegated scan access.

### Cakupan regression test baru

Regression test sekarang mencakup jadwal tahunan lintas semester, kelas historis siswa, preservasi arsip saat mutasi, rollover idempoten, tenant isolation, correction session, exact-semester snapshot restore, opsi wali historis tanpa baris rapor, endpoint tugas, server-owned period stamping, dan gate konsistensi referensi ID.

---

## 9. Rencana Perbaikan Berurutan

Urutan berikut mengutamakan pencegahan kerusakan data.

### Fase 0: Pengamanan sebelum perubahan

1. Ambil backup database PostgreSQL yang dapat direstore.
2. Catat jumlah baris per tenant/periode untuk tabel periodik.
3. Nonaktifkan sementara mutasi massal dan rollover produksi bila patch belum tersedia.
4. Tambahkan regression test yang gagal untuk tiga temuan tingkat tinggi.

### Fase 1: Lindungi arsip dari mutation

1. Perbaiki `clearStudentActiveAssignments()` dan `clearTeacherActiveAssignments()`.
2. Scope semua pembersihan ke periode aktif sesuai jenis tabel.
3. Perbaiki pengosongan ketua kelas rollover agar hanya mengenai tahun target.
4. Tambahkan audit log periode dan jumlah baris.
5. Jalankan tes preservasi arsip dan tenant isolation.

### Fase 2: Satukan scope jadwal

1. Deklarasikan jadwal sebagai tahunan pada backend.
2. Ubah default select, otorisasi guru, absen mandiri, dan Live Scan.
3. Audit/normalisasi `periode_berlaku` data lama.
4. Jalankan tes Ganjil ke Genap.

### Fase 3: Perbaiki akses arsip siswa

1. Tambahkan resolver kelas historis di backend.
2. Terapkan hanya pada read-only arsip.
3. Pertahankan pembatasan mutation ke periode aktif.
4. Integrasikan pada jadwal, tugas, quiz, absensi, dan hasil.

### Fase 4: Konsistensi frontend lintas role

1. Pisahkan helper filter tahun dan semester.
2. Perbaiki Struktur/Organisasi pada Guru dan Siswa.
3. Perbaiki daftar kelas laporan wali dan rapor.
4. Pastikan cache/query key menyertakan scope periode.

### Fase 5: Kontrak snapshot dan data cleanup

1. Putuskan snapshot roster tahunan atau semester.
2. Terapkan aturan yang sama pada preview, restore, frontend, dan backend.
3. Jalankan audit data produksi read-only.
4. Buat migration/data repair terpisah setelah hasil audit ditinjau.

---

## 10. Query Audit Data Produksi yang Direkomendasikan

Query berikut bersifat read-only. Nama kolom perlu disesuaikan bila skema produksi berbeda. Jangan menjalankan `UPDATE` sebelum backup diverifikasi.

### 10.1 Distribusi jadwal tahunan per semester penyimpanan

```sql
SELECT tenant_id, tahun_ajaran, semester, periode_berlaku, COUNT(*) AS jumlah
FROM jadwal
GROUP BY tenant_id, tahun_ajaran, semester, periode_berlaku
ORDER BY tenant_id, tahun_ajaran, semester, periode_berlaku;
```

Tujuan: menemukan jadwal tahunan yang tersimpan hanya dengan label semester asal.

### 10.2 Struktur kelas kosong per tahun

```sql
SELECT tenant_id, tahun_ajaran,
       COUNT(*) AS jumlah_kelas,
       COUNT(*) FILTER (WHERE wali_guru_id IS NULL) AS tanpa_wali,
       COUNT(*) FILTER (WHERE ketua_siswa_id IS NULL) AS tanpa_ketua
FROM kelas_struktur
GROUP BY tenant_id, tahun_ajaran
ORDER BY tenant_id, tahun_ajaran;
```

Tujuan: melihat apakah tahun lama memiliki lonjakan penugasan kosong setelah mutasi/rollover.

### 10.3 Snapshot siswa ganda dalam tahun dan semester

```sql
SELECT tenant_id, student_id, tahun_ajaran, semester, source, COUNT(*) AS jumlah
FROM student_class_histories
GROUP BY tenant_id, student_id, tahun_ajaran, semester, source
HAVING COUNT(*) > 1
ORDER BY jumlah DESC;
```

Tujuan: mengenali snapshot ganda yang dapat membuat resolver memilih baris berbeda.

### 10.4 Siswa aktif tanpa snapshot periode aktif

```sql
SELECT p.tenant_id, p.id, p.nama, p.kelas
FROM profiles p
JOIN settings s ON s.tenant_id = p.tenant_id
LEFT JOIN student_class_histories h
  ON h.tenant_id = p.tenant_id
 AND h.student_id = p.id
 AND h.tahun_ajaran = s.tahun_ajaran
 AND h.semester = s.semester_aktif
WHERE p.role = 'siswa'
  AND COALESCE(p.status, 'active') = 'active'
  AND h.id IS NULL;
```

Tujuan: menemukan profil aktif yang belum memiliki snapshot persis untuk periode aktif.

### 10.5 Unique struktur kelas per tahun

```sql
SELECT tenant_id, kelas_id, tahun_ajaran, COUNT(*) AS jumlah
FROM kelas_struktur
GROUP BY tenant_id, kelas_id, tahun_ajaran
HAVING COUNT(*) > 1;
```

Tujuan: memastikan satu kelas memiliki satu struktur resmi per tahun dan tenant.

### 10.6 Validitas semester rapor dan nilai manual

```sql
SELECT tenant_id, tahun_pelajaran, semester, jenis, COUNT(*) AS jumlah
FROM rapot_siswa
GROUP BY tenant_id, tahun_pelajaran, semester, jenis
ORDER BY tenant_id, tahun_pelajaran, semester, jenis;

SELECT tenant_id, tahun_ajaran, semester, COUNT(*) AS jumlah
FROM guru_mapel_manual_nilai
GROUP BY tenant_id, tahun_ajaran, semester
ORDER BY tenant_id, tahun_ajaran, semester;

SELECT tenant_id, guru_id, mapel, tahun_ajaran, semester, COUNT(*) AS jumlah
FROM guru_mapel_bobot
GROUP BY tenant_id, guru_id, mapel, tahun_ajaran, semester
ORDER BY tenant_id, guru_id, mapel, tahun_ajaran, semester;
```

Tujuan: menginventarisasi distribusi bobot dan nilai Ganjil/Genap sebelum constraint diperketat. Baris dengan `semester IS NULL` atau string kosong adalah data legacy yang harus dipetakan melalui bukti periode asal; jangan menebaknya dari semester aktif saat migrasi dijalankan.

### 10.7 Potensi benturan rapor lintas semester

```sql
SELECT tenant_id, siswa_id, kelas_id, tahun_pelajaran, semester, jenis, COUNT(*) AS jumlah
FROM rapot_siswa
GROUP BY tenant_id, siswa_id, kelas_id, tahun_pelajaran, semester, jenis
HAVING COUNT(*) > 1;

SELECT tenant_id, guru_id, siswa_id, kelas_id, mapel, tahun_ajaran, semester,
       COUNT(*) AS jumlah
FROM guru_mapel_manual_nilai
GROUP BY tenant_id, guru_id, siswa_id, kelas_id, mapel, tahun_ajaran, semester
HAVING COUNT(*) > 1;
```

Tujuan: memastikan unique key baru dapat diterapkan tanpa menggabungkan nilai dari semester berbeda.

---

## 11. Checklist Verifikasi Setelah Perbaikan

### Admin Sekolah

- [ ] Membuat jadwal pada Ganjil lalu beralih ke Genap tidak menghilangkan jadwal.
- [ ] Beralih ke tahun baru menampilkan keputusan jadwal tepat satu kali.
- [ ] Kembali ke tahun lama tidak mengubah data aktif.
- [ ] Mutasi guru/siswa tidak mengubah arsip tahun lama.
- [ ] Rollover hanya membuat/mengubah data tahun target.
- [ ] Ekskul periode baru memiliki katalog sesuai keputusan dan anggota reset secara default.
- [ ] Struktur, wali kelas, organisasi, dan bobot mengikuti tahun yang dipilih.

### Guru

- [ ] Jadwal tahunan tetap tersedia pada Ganjil dan Genap.
- [ ] Daftar kelas ajar mengikuti tahun yang dipilih.
- [ ] Daftar kelas wali mengikuti tahun yang dipilih.
- [ ] Laporan lama memakai roster siswa pada tahun itu.
- [ ] Guru tidak dapat mengubah tugas/quiz/rapor periode arsip tanpa alur khusus.
- [ ] Struktur dan organisasi tidak hilang saat semester berubah.

### Siswa

- [ ] Jadwal aktif sesuai tahun dan kelas siswa.
- [ ] Tugas/quiz aktif hanya berasal dari periode aktif.
- [ ] Hasil tugas/quiz/absensi lama tetap dapat dibaca setelah naik kelas.
- [ ] Siswa tidak dapat mengirim jawaban ke periode lama.
- [ ] Struktur, organisasi, dan ekstrakurikuler sesuai periode yang ditampilkan.
- [ ] Data siswa dari tenant/kelas lain tidak pernah terlihat.

### Operasional dan keamanan

- [ ] Semua query periodik tetap memakai `tenant_id`.
- [ ] Preview rollover dan hasil eksekusi memakai dataset yang sama.
- [ ] Seluruh mutation periodik berjalan dalam transaksi.
- [ ] Audit log menyimpan aktor, tenant, periode, aksi, dan jumlah baris.
- [ ] Backup restore telah diuji sebelum data repair produksi.
- [ ] Test suite backend dan frontend lulus.

---

## 12. Definition of Done

Audit dianggap selesai diperbaiki hanya jika seluruh kondisi berikut terpenuhi:

1. Semua temuan `AKD-HIGH-*` dan `AKD-MED-*` berstatus `RESOLVED` dengan commit referensi.
2. Setiap temuan memiliki regression test yang gagal sebelum patch dan lulus sesudah patch.
3. Data periode lama terbukti tidak berubah pada uji mutasi dan rollover.
4. Admin, Guru, dan Siswa melihat data yang sama untuk kombinasi tenant dan periode yang sama.
5. Arsip siswa tetap dapat dibaca setelah kenaikan kelas, tetapi tidak dapat dimutasi.
6. Jadwal tahunan berlaku pada dua semester tanpa duplikasi.
7. Struktur/organisasi tahunan dan ekstrakurikuler semester menggunakan scope yang benar.
8. Query audit produksi telah ditinjau dan data anomali, bila ada, diperbaiki melalui migration/command terkontrol.
9. Seluruh test suite yang relevan lulus pada CI.
10. Patch telah melalui staging, smoke test tiga role, backup verification, deploy, dan pemantauan log/error.

---

## 13. Status Pengerjaan

| ID | Status | Commit | Test | Deploy |
|---|---|---|---|---|
| AKD-HIGH-01 | RESOLVED LOCAL | Belum commit | Lulus | Belum |
| AKD-HIGH-02 | RESOLVED LOCAL | Belum commit | Lulus | Belum |
| AKD-HIGH-03 | RESOLVED LOCAL | Belum commit | Lulus | Belum |
| AKD-MED-01 | RESOLVED LOCAL | Belum commit | Build lulus | Belum |
| AKD-MED-02 | RESOLVED LOCAL | Belum commit | Lulus | Belum |
| AKD-MED-03 | RESOLVED LOCAL | Belum commit | Lulus | Belum |
| AKD-OBS-01 | RESOLVED LOCAL | Belum commit | Lulus | Belum |

Dokumen ini harus diperbarui pada setiap fase perbaikan dengan commit, hasil test, status deploy, dan catatan migrasi data. Menandai temuan `RESOLVED` hanya diperbolehkan setelah implementasi dan regression test selesai, bukan hanya setelah perubahan kode ditulis.

---

## 14. Implementasi Arsitektur Periode

### 14.1 Pengamanan data

- Backup PostgreSQL pra-perubahan tersedia di `/opt/edusmart-presensi/backups/pre-academic-period-20260711-151057.dump`.
- SHA-256: `8a4a0fcfd0a1064f75999269ae2b778555f8dba81550006b5b6600fdc06e5c1c`.
- Restore backup telah diuji ke database sementara dan menghasilkan 280 tabel publik sebelum database uji dihapus.
- Folder `docs/security-scans/` tidak disentuh oleh pekerjaan periode akademik.

### 14.2 Komponen backend terpusat

- `TenantContext` menetapkan tenant dari middleware dan tidak mempercayai `tenant_id` browser.
- `AcademicContextResolver` memisahkan konteks read aktif/arsip dari konteks mutation.
- `AcademicScopeRegistry` menetapkan satu scope resmi per tabel.
- `PeriodMutationGuard` menolak mutation arsip dengan `409 academic_period_locked`.
- `HistoricalEnrollmentResolver` menyelesaikan kelas siswa berdasarkan tahun dan semester persis untuk arsip.
- `AcademicPeriodLifecycleService` menerapkan lifecycle, lock tenant, validasi tanggal, dan satu periode aktif.
- `AcademicRolloverService` menjalankan rollover dalam transaksi dengan idempotency key.
- `CorrectionSessionService` membatasi koreksi arsip berdasarkan tenant, aktor, tabel, alasan, dan waktu kedaluwarsa.

### 14.3 Normalisasi database bertahap

Migrasi `2026_07_11_000200_create_normalized_academic_periods.php` menambahkan:

- `academic_years` dan `academic_terms`;
- `academic_correction_sessions` dan `academic_rollover_runs`;
- nullable `academic_year_id`/`academic_term_id` pada tabel periodik;
- backfill dan dual-write trigger;
- composite foreign key dengan `tenant_id`;
- status/date check, partial unique active index, overlap guard, dan RLS.

Kolom lama tetap dipertahankan. `NOT NULL` dan cutover read-by-ID belum diterapkan sampai audit produksi lulus:

```bash
cd backend
php artisan academic:verify-period-refs --tenant=<slug-tenant> --strict
php artisan academic:verify-period-refs --strict
```

Exit code nol dan `ready_for_id_reads=true` wajib untuk seluruh tenant sebelum tahap cutover.

### 14.4 Endpoint domain dan frontend

- Lifecycle, preview dampak, dan correction session memakai endpoint admin khusus.
- CRUD tugas utama dan submit jawaban memakai endpoint `/api/tugas`, bukan mutation generik dari browser.
- Tenant, pembuat, tahun, semester, kelas, dan referensi ID tugas/jawaban ditetapkan atau diverifikasi server.
- Opsi wali historis berasal dari `/api/reports/homeroom-options`, bukan keberadaan rapor.
- `AcademicContextProvider` menyimpan periode aktif sekali per tenant dan menyaring realtime event tenant lain.
- Filter tahun dan semester dipisahkan; query/cache key memuat tenant, tahun, semester, dan mode.
- Mode arsip mengunci tombol mutation. Sesi koreksi tersimpan per tenant dan kedaluwarsa otomatis.

### 14.5 Gate sebelum produksi

1. Deploy migrasi ke staging dan jalankan `academic:verify-period-refs --strict`.
2. Smoke test Admin Sekolah, Guru, dan Siswa pada Ganjil, Genap, dan satu periode arsip.
3. Verifikasi preview rollover sama dengan jumlah eksekusi dan rollover kedua ditolak.
4. Jalankan seluruh backend test, frontend build, dan API documentation coverage di CI.
5. Setelah staging stabil, deploy backend/migrasi lebih dahulu, lalu frontend.
6. Pantau error `409`, `422`, query latency, queue, dan audit log setidaknya satu siklus operasional.
7. Jangan menjatuhkan kolom legacy pada rilis yang sama.

### 14.6 Audit lanjutan frontend dan konsistensi tampilan

Audit frontend lanjutan pada 12 Juli 2026 menemukan dan memperbaiki tiga sumber drift tambahan:

1. `AcademicContextProvider` sebelumnya dapat menimpa `semester_aktif` sekolah dengan semester kalender browser. Periode aktif sekarang selalu berasal dari settings tenant; kalender hanya boleh membantu nilai awal pada halaman pengaturan.
2. Absensi Guru dan hook absensi umum sebelumnya memiliki resolver, realtime listener, serta local-storage filter masing-masing. Seluruhnya sekarang memakai `useActiveAcademicPeriod()` dan context pusat.
3. Rapor wali kelas sebelumnya membaca semester dari objek periode tahunan sehingga rapor baru dapat jatuh ke default `Genap`. Default sekarang berasal dari `termPeriod.semester` tenant.

Kontrak tampilan frontend setelah perbaikan:

| Halaman/fitur | Scope UI | Pilihan yang ditampilkan | Mode arsip |
|---|---|---|---|
| Jadwal Admin/Guru/Siswa | Tahunan | Tahun ajaran | Terkunci jika tahun bukan periode aktif |
| Struktur sekolah, wali, organisasi | Tahunan | Tahun ajaran | Terkunci jika tahun bukan periode aktif |
| Absensi Guru/Siswa | Semester | Tahun ajaran + semester | Mutation terkunci jika salah satunya bukan periode aktif |
| Tugas Guru/Siswa | Semester | Tahun ajaran + semester | Arsip dapat dibaca; create/submit/edit terkunci |
| Quiz Guru/Siswa | Semester | Tahun ajaran + semester | Arsip dapat dibaca; start/submit/edit terkunci |
| Ekstrakurikuler dan anggota | Semester | Tahun ajaran + semester | Anggota periode lama tetap terbaca dan tidak ikut periode baru |
| Laporan Guru | Semester | Tahun ajaran + semester | Roster dan transaksi mengikuti konteks yang sama |
| Rapor wali kelas | Tahunan + semester pada dokumen | Kelas/tahun historis dan semester rapor | Riwayat memakai wali/roster tahun tersebut |
| Backup | Sesuai pilihan ekspor | Semua data, tahun, semester, bulan, atau rentang | Default berasal dari periode aktif tenant |

Pengamanan frontend yang turut diterapkan:

- filter periode di local storage diberi namespace `tenant_id`;
- cache dashboard Guru diberi namespace tenant, pengguna, tahun ajaran, dan semester sesuai scope datanya;
- cache/query key fitur periodik membedakan tahun, semester, tenant, dan mode arsip;
- memilih arsip hanya mengubah tampilan halaman dan tidak mengaktifkan periode operasional tenant;
- halaman yang sedang mengikuti periode aktif berpindah otomatis ketika Admin mengaktifkan periode baru, sedangkan pilihan arsip eksplisit tetap dipertahankan;
- halaman tahunan tidak lagi menampilkan pilihan semester atau berubah menjadi arsip hanya karena semester aktif berganti.

Validasi frontend terbaru:

```text
npm run check: LULUS
Vite production build: 3062 modul
PWA precache: 121 entri
git diff --check: LULUS
```

**Status tampilan frontend:** lengkap pada level implementasi lokal untuk scope utama Admin Sekolah, Guru, dan Siswa. Status produksi tetap bersyarat karena smoke test browser dengan akun dummy tiga role, pengujian periode Ganjil/Genap/arsip, dan verifikasi hasil migrasi staging belum dijalankan pada perubahan lokal ini.

### 14.7 Penilaian tengah/akhir semester

Implementasi 13 Juli 2026 menyelaraskan Quiz, Laporan Guru, Rapor Wali, ekspor, dan penyimpanan backend:

- `academicAssessment.js` menjadi sumber label penilaian berbasis semester;
- Ganjil menampilkan UTS/PTS dan UAS/PAS;
- Genap menampilkan UTS/PTS dan UKK/PAT;
- nilai tetap disimpan pada slot stabil `uts` dan `uas`, sehingga pergantian istilah tidak memecah kompatibilitas data;
- query serta upsert rapor selalu menyertakan `semester`;
- nilai manual mapel selalu menyertakan `semester` dan periode mutation diverifikasi server;
- halaman rapor arsip mengunci input dan hanya menyediakan baca/ekspor;
- migrasi `2026_07_12_000100_scope_rapot_siswa_by_academic_term.php` mengganti unique key rapor menjadi semester-aware;
- migrasi `2026_07_12_000200_scope_manual_mapel_scores_by_academic_term.php` menambahkan semester dan unique key term-aware untuk nilai manual;
- constraint PostgreSQL dibuat `NOT VALID` agar data legacy tidak ditebak secara diam-diam, tetapi baris baru tetap wajib memakai nilai semester yang sah.
- migrasi `2026_07_13_000100_configure_manual_assessment_sources.php` menambahkan sumber UTS/akhir semester, tujuan komponen manual, serta nilai ujian kertas terpisah;
- konfigurasi lama otomatis memakai sumber `digital`, sehingga deploy tidak mengubah hasil nilai sekolah yang sudah ada;
- UTS/PTS dan UAS/PAS/UKK/PAT kertas memakai input `0-100` terpisah dan menampilkan kontribusi poin berdasarkan bobot;
- opsi Nilai Tambah tetap dibatasi `0-100` dan hanya menyumbang poin sesuai sisa bobot, sehingga tidak dapat melewati formula penilaian;
- rekap wali dan detail siswa menggunakan sumber komponen yang sama dengan Laporan Mapel.

Regression test membuktikan rapor Ganjil dan Genap dapat hidup berdampingan, mutation rapor arsip ditolak, spoof semester pada nilai manual ditolak, dan server menempatkan nilai manual normal ke periode aktif tenant.
