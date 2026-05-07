# Blueprint Alur Quiz Profesional (EduSmart)

Dokumen ini adalah spesifikasi implementasi quiz end-to-end untuk arsitektur EduSmart saat ini (Frontend React + API Laravel + DB tenant-aware).

## 1. Tujuan dan Hasil yang Diinginkan

Tujuan utama:
- Alur quiz jelas dari pembuatan sampai nilai final.
- Keamanan kuat terhadap IDOR/BOLA, manipulasi timer, dan submit ilegal.
- Penilaian konsisten, audit-able, dan minim sengketa.
- Siap dipakai untuk skala produksi lintas tenant.

Hasil bisnis:
- Guru lebih cepat membuat dan menjalankan quiz.
- Siswa mendapat pengalaman ujian yang stabil dan adil.
- Sekolah mendapat pelaporan yang bisa dipertanggungjawabkan.

## 2. Kondisi Saat Ini (As-Is) dan Gap

Kondisi saat ini di codebase:
- CRUD quiz/soal/opsi/jawaban masih banyak lewat endpoint generic `/api/db`.
- Final submit sudah lewat endpoint khusus `/api/quiz/submit`.
- Lifecycle quiz masih implicit (`is_live`, `is_active`) belum state eksplisit.
- Monitoring anti-cheat lebih banyak di frontend (fullscreen/blur/visibility).

Gap utama:
- Status quiz belum eksplisit (`draft/published/live/closed`).
- Belum ada audit event terstruktur per aksi penting.
- Guardrail server untuk autosave jawaban perlu diperketat (validasi relasi `submission -> question -> option`).
- Belum ada idempotency formal untuk submit (anti double-submit race) dan lock finalisasi.

## 3. Prinsip Desain

- Server authoritative untuk waktu, skor, dan status final.
- Frontend hanya orchestrator UI, bukan penentu aturan.
- Semua query harus scoped ke `tenant_id + role + ownership + kelas`.
- Aksi kritikal harus tercatat di audit log.
- Perubahan structure quiz setelah ada attempt harus dikunci.

## 4. Aktor dan Hak Akses

### 4.1 Aktor
- `Admin`: pengawasan tenant/sekolah, force close, audit.
- `Guru`: buat quiz, publish, jalankan live, monitoring, grading manual (jika diizinkan).
- `Siswa`: lihat quiz kelasnya, kerjakan, submit, lihat hasil sesuai kebijakan.
- `System`: auto-close timer, auto-submit timeout, background consistency checks.

### 4.2 Matriks Akses (Ringkas)

| Aksi | Admin | Guru pemilik quiz | Guru non-pemilik | Siswa kelas quiz | Siswa kelas lain |
|---|---|---|---|---|---|
| Lihat quiz metadata | Ya | Ya | Opsional (wali) | Ya | Tidak |
| Lihat kunci jawaban | Ya | Ya | Tidak | Tidak | Tidak |
| Buat/Edit quiz | Ya | Ya | Tidak | Tidak | Tidak |
| Publish/Start/Close | Ya | Ya | Tidak | Tidak | Tidak |
| Mulai submission | Tidak | Tidak | Tidak | Ya | Tidak |
| Autosave jawaban | Tidak | Tidak | Tidak | Ya (own submission) | Tidak |
| Submit final | Tidak | Tidak | Tidak | Ya (own submission) | Tidak |
| Force close / void | Ya | Terbatas | Tidak | Tidak | Tidak |

## 5. State Machine (Wajib)

### 5.1 State Quiz
- `draft`: baru dibuat, belum terlihat siswa.
- `published`: siap dikerjakan (reguler) atau siap dimulai (live).
- `live`: sesi ulangan sedang berjalan.
- `closed`: ditutup manual/otomatis, tidak bisa mulai attempt baru.
- `archived`: arsip periode lama, read-only.

### 5.2 State Submission
- `not_started`: belum ada submission.
- `ongoing`: sudah start, jawaban masih bisa berubah.
- `submitted`: siswa sudah final submit.
- `graded`: nilai final tersedia (otomatis/manual final).
- `expired`: sistem auto-submit karena timeout/deadline.
- `void`: attempt dibatalkan admin (kasus khusus).

### 5.3 Aturan Transisi

Quiz:
- `draft -> published` hanya jika preflight valid.
- `published -> live` hanya mode live dan start oleh guru/admin.
- `published/live -> closed` manual atau otomatis (deadline/durasi habis).
- `closed -> archived` by scheduler/periode akademik.

Submission:
- `not_started -> ongoing` saat siswa klik mulai.
- `ongoing -> submitted` saat submit manual.
- `ongoing -> expired` saat auto-timeout.
- `submitted/expired -> graded` setelah skor final dihitung/diapprove.
- `* -> void` hanya admin dengan alasan wajib.

## 6. Alur End-to-End Guru

### 6.1 Create Draft
Input minimal:
- `kelas_id`, `mapel`, `nama_quiz`, `mode`, `deadline`, `duration_minutes` (jika live).

Validasi server:
- Guru berhak pada kelas/mapel tersebut.
- Deadline tidak di masa lalu.
- Durasi live minimal 10 menit, maksimal sesuai kebijakan.

Output:
- Quiz state `draft`.

### 6.2 Susun Soal
Aturan:
- Minimal 1 soal sebelum publish.
- Tiap soal memiliki minimal 2 opsi aktif.
- Tepat 1 jawaban benar per soal.
- `poin > 0`.

Output:
- Struktur soal tersimpan dengan urutan `nomor` konsisten.

### 6.3 Publish
Preflight wajib:
- Tidak ada soal/opsi invalid.
- Tidak ada duplikasi `nomor`.
- Total poin > 0.

Output:
- State `published`, simpan `published_at`, `published_by`.

### 6.4 Start Live (khusus mode ulangan)
Aturan:
- Hanya dari state `published`.
- Simpan `live_started_at` dari server.

Output:
- State `live`.

### 6.5 Close
Aturan:
- Bisa manual (guru/admin) atau otomatis (scheduler).
- Setelah closed, submission ongoing diproses auto-submit.

Output:
- State `closed`, simpan `closed_at`, `closed_reason`.

### 6.6 Review dan Finalisasi Nilai
- Nilai auto dihitung server.
- Jika ada manual override, simpan `manual_score`, `manual_note`, `graded_by`.
- Setelah final, set state submission `graded`.

## 7. Alur End-to-End Siswa

### 7.1 Discovery
Siswa melihat quiz berdasarkan `tenant + kelas`.

Status badge UI:
- `Belum tersedia`, `Tersedia`, `Sedang dikerjakan`, `Selesai`, `Deadline lewat`.

### 7.2 Start Attempt
Validasi server:
- Quiz milik tenant dan kelas siswa.
- Quiz tidak `closed`.
- Belum melewati deadline.
- Belum melewati batas percobaan.

Output:
- Buat/ambil submission state `ongoing`.

### 7.3 Autosave Jawaban
- Save per soal dengan debounce.
- Server validasi `question_id` milik `quiz_id` dan `option_id` milik `question_id`.
- Jawaban hanya boleh ke submission milik siswa sendiri.

### 7.4 Final Submit
Validasi server:
- Submission masih `ongoing`.
- Quiz masih boleh disubmit (deadline/live window).
- Lakukan skor di transaksi atomik.

Output:
- Submission state `submitted` lalu `graded`.
- Response membawa `score`, `correct_count`, `total_points`.

### 7.5 Post-Submit
- Jika kebijakan nilai instan aktif: nilai tampil langsung.
- Jika tidak: tampil status “menunggu review guru”.

## 8. Aturan Bisnis Inti

- Maksimal 1 submission aktif per siswa per quiz (default).
- Jawaban hanya valid untuk kombinasi relasi yang benar:
  - `submission.quiz_id == question.quiz_id`
  - `option.question_id == question.id`
- Scoring final hanya dihitung server.
- Score dibatasi `0..100`.
- Setelah ada submission pertama, perubahan struktur soal harus:
  - ditolak, atau
  - versioning (v2) dengan migrasi attempt terpisah.

## 9. Hardening Keamanan (Anti IDOR/BOLA + Anti-Cheat)

### 9.1 Guardrail Wajib API
- Scope query selalu `tenant_id`.
- Enforce ownership untuk submission/jawaban (`siswa_id == auth.user.id`).
- Jangan percaya ID dari client tanpa cross-check relasi tabel.
- Field sensitif (`score`, `is_correct`, `finished_at`, `status graded`) tidak boleh diisi dari frontend siswa.

### 9.2 Submit Safety
- Endpoint submit harus idempotent:
  - jika status sudah `submitted/graded`, return hasil terakhir, bukan error 500.
- Gunakan transaksi + row lock saat finalisasi submit.
- Pastikan race condition double-click tidak menghasilkan state inkonsisten.

### 9.3 Anti-Cheat Realistis
- Fullscreen/blur hanya sinyal, bukan bukti final.
- Simpan `violation_events` (tab blur, visibility hidden, fullscreen exit, reconnect abnormal).
- Terapkan rule kebijakan bertingkat:
  - warning,
  - flagged review,
  - auto-submit (jika threshold tertentu dan diset sekolah).

### 9.4 Audit Trail
Simpan event berikut:
- `quiz_created`, `quiz_published`, `quiz_started`, `quiz_closed`.
- `submission_started`, `answer_saved`, `submission_submitted`, `submission_graded`.
- `manual_override`, `submission_voided`, `policy_violation`.

## 10. Rekomendasi Struktur Data

### 10.1 Perubahan Minimal (Compat dengan schema saat ini)

Tabel `quizzes`:
- tambah `status` (`draft/published/live/closed/archived`) default `draft`.
- tambah `published_at`, `published_by`.
- tambah `closed_at`, `closed_by`, `closed_reason`.
- tambah `max_attempts` default `1`.
- tambah `randomize_questions`, `randomize_options` (bool).

Tabel `quiz_submissions`:
- tambah `attempt_no`.
- tambah `submitted_at`, `submitted_via` (`manual/timeout/system`).
- tambah `graded_at`, `graded_by`.
- tambah `finalized_at` (opsional, untuk lock final).

Tabel baru `quiz_submission_events`:
- `id`, `tenant_id`, `quiz_id`, `submission_id`, `siswa_id`, `event_type`, `payload_json`, `created_at`.

Tabel baru opsional `quiz_policy_violations`:
- `id`, `submission_id`, `type`, `severity`, `metadata_json`, `created_at`.

### 10.2 Constraint dan Index Penting
- Unique: `(quiz_id, siswa_id, attempt_no)`.
- Unique: `(submission_id, question_id)` pada jawaban.
- Index: `quizzes(tenant_id, kelas_id, status)`.
- Index: `quiz_submissions(tenant_id, quiz_id, status)`.
- Index: `quiz_answers(tenant_id, submission_id)`.

## 11. Kontrak API (Domain-Specific) yang Direkomendasikan

Gunakan endpoint khusus agar policy mudah ditegakkan.

### 11.1 Guru/Admin
- `POST /api/quiz` buat draft.
- `PATCH /api/quiz/{quizId}` edit metadata draft.
- `POST /api/quiz/{quizId}/publish` publish.
- `POST /api/quiz/{quizId}/start` start live.
- `POST /api/quiz/{quizId}/close` close.
- `GET /api/quiz/{quizId}/report` ringkasan hasil.

### 11.2 Siswa
- `POST /api/quiz/{quizId}/submission/start` start attempt.
- `PATCH /api/quiz/{quizId}/submission/{submissionId}/answer` autosave 1 jawaban.
- `POST /api/quiz/{quizId}/submission/{submissionId}/submit` final submit.
- `GET /api/quiz/{quizId}/submission/me` progress pribadi.

### 11.3 Contoh Payload Inti

Autosave jawaban:
```json
{
  "question_id": "q-uuid",
  "option_id": "opt-uuid",
  "client_saved_at": "2026-02-09T10:11:12Z"
}
```

Submit final:
```json
{
  "submission_id": "sub-uuid",
  "idempotency_key": "quiz-submit-sub-uuid-20260209101112"
}
```

## 12. UX/Produk yang Disarankan

Sebelum mulai:
- Checklist koneksi, baterai, aturan ujian.
- Konfirmasi perangkat dan waktu tersisa.

Saat mengerjakan:
- Indikator autosave jelas: `Tersimpan` / `Menyimpan...` / `Gagal simpan`.
- Timer authoritative dan sinkron dari server.
- Navigasi soal cepat + penanda belum dijawab.

Setelah submit:
- Tampilkan nomor referensi submission.
- Status nilai: `published` atau `waiting_review`.

## 13. Observability dan KPI

Metric minimum:
- `quiz_start_rate`
- `quiz_submit_success_rate`
- `autosave_error_rate`
- `timeout_auto_submit_count`
- `avg_completion_time`
- `graded_latency_seconds`
- `policy_violation_rate`

Log minimum per request penting:
- `tenant_id`, `quiz_id`, `submission_id`, `user_id`, `action`, `result`, `latency_ms`, `error_code`.

## 14. QA Test Matrix Minimum

Functional:
- Siswa bisa start dan submit pada quiz kelasnya.
- Quiz closed tidak bisa start attempt baru.
- Quiz live auto-close sesuai durasi.

Security:
- Siswa kelas A tidak bisa akses quiz kelas B.
- Siswa tidak bisa submit/mengubah submission siswa lain.
- `question_id` lintas quiz ditolak saat autosave.
- `option_id` yang bukan milik `question_id` ditolak.

Reliability:
- Double click submit tetap menghasilkan satu final state.
- Reconnect setelah offline tidak menghilangkan jawaban terakhir yang valid.
- Retry autosave tidak membuat duplikasi data.

Audit:
- Event kritikal tercatat lengkap dengan timestamp dan actor.

## 15. Roadmap Implementasi Bertahap

### Phase 1: Stabilkan Fondasi (1-2 sprint)
- Tambah state eksplisit `quizzes.status`.
- Lock edit struktur soal setelah submission pertama.
- Tambah validasi relasi ketat pada submit/autosave.
- Tambah audit event minimum.

### Phase 2: Domain API dan Hardening (1 sprint)
- Migrasi operasi quiz dari generic `/api/db` ke endpoint khusus quiz.
- Terapkan idempotency submit + transaction lock.
- Tambah auto-close job dan auto-submit timeout.

### Phase 3: Advanced Product (opsional)
- Randomization soal/opsi.
- Dashboard analitik guru/admin.
- Bank soal + import/export.

## 16. Definition of Done (DoD)

Alur quiz dianggap siap produksi jika:
- State machine berjalan konsisten untuk semua transisi utama.
- Semua validasi server-side untuk relasi ID lulus.
- Test matrix functional + security + reliability lulus.
- Event audit tersedia dan dapat ditelusuri.
- Tidak ada akses lintas tenant/kelas/ownership.
- KPI utama bisa dipantau di production.

## 17. Saran Implementasi Cepat Berdasarkan Kode Saat Ini

Prioritas cepat yang paling berdampak:
- Pertahankan endpoint `POST /api/quiz/submit` sebagai pintu final submit authoritative.
- Tambahkan validasi ketat pada submit untuk memastikan:
  - `question_id` memang milik `quiz_id` submission.
  - `option_id` memang milik `question_id`.
- Tambahkan status eksplisit quiz (tanpa mematikan field lama), lalu lakukan migrasi bertahap UI.
- Kurangi operasi sensitif via endpoint generic `/api/db` untuk domain quiz.

Dengan langkah ini, alur tetap kompatibel dengan implementasi sekarang, tetapi level keamanan dan kejelasan operasional naik signifikan.
