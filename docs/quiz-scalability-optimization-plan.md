# Quiz Scalability Optimization Plan
**EduSmart Presensi — Branch: `backup/vps-ready-20260430`**
**Tanggal Audit:** 2026-06-03
**Status:** AUDIT ONLY — tidak ada perubahan logic aplikasi

---

## 1. Target Scalability: 500 Siswa Bersamaan

| Skenario | Jumlah | Estimasi Request/Menit |
|----------|--------|------------------------|
| Buka quiz dashboard | 500 siswa | 500 req/menit (burst saat bel) |
| Start / resume quiz | 500 siswa | 500 req dalam 2–5 menit |
| Autosave jawaban MCQ | 500 siswa × 30 soal | ~2.500–5.000 req/menit (ongoing) |
| Autosave essay (debounce 550ms) | 500 siswa | ~500–1.500 req/menit |
| Violation log (mode strict) | 500 siswa | hingga 3.000 req/menit jika semua berpindah tab |
| Submit quiz | 500 siswa (burst saat deadline) | 500 req dalam <60 detik |
| Scoring + WhatsApp notif | 500 siswa | 500 DB transaction berat bersamaan |

**Kesimpulan:** Sistem harus mampu menangani **>5.000 req/menit** pada puncak UTS.

---

## 2. Kondisi Quiz Saat Ini

### Stack
- **Backend:** Laravel 13 + PHP 8.3 + PostgreSQL
- **Cache/Queue:** Redis di production (`CACHE_STORE=redis`, `QUEUE_CONNECTION=redis`)
- **Cache/Queue di lokal:** `database` (fallback, bukan Redis)
- **Frontend:** React (Vite) + Supabase Realtime
- **Auto-finalize:** Laravel Scheduler `everyMinute()` via `finalizeExpiredSubmissions()`

### File yang Diaudit

| File | Peran |
|------|-------|
| `backend/app/Http/Controllers/Api/QuizController.php` | Semua endpoint quiz (3.226 baris) |
| `backend/app/Services/Quiz/QuizScoringService.php` | Scoring & auto-finalize |
| `src/pages/siswa/Quiz.jsx` | Frontend siswa (3.609 baris) |
| `src/pages/guru/Quiz.jsx` | Frontend guru |
| `backend/routes/console.php` | Scheduler quiz |
| `backend/routes/api.php` | Route quiz API |
| `backend/database/migrations/2026_02_01_000600_create_quiz_tables.php` | Skema tabel awal |
| `backend/database/migrations/2026_04_30_000400_harden_quiz_attempts.php` | Kolom security |
| `backend/database/migrations/2026_05_10_000100_add_multi_tenant_query_optimization_indexes.php` | Composite index |
| `backend/database/migrations/2026_02_17_000100_create_quiz_violation_logs_table.php` | Violation log table |

---

## 3. Bottleneck Utama (Hasil Audit)

### 🔴 Bottleneck #1 — Autosave Per-Soal, Satu per Satu (KRITIS)

**Lokasi:** `QuizController::saveAnswer()` (baris 548–631) + `Quiz.jsx::handleEssayChange()` (baris 1644–1666)

**Masalah:**
- Setiap kali siswa menjawab/mengetik, frontend mengirim **1 HTTP request per soal**.
- Essay trigger autosave setiap 550ms setelah berhenti mengetik (`setTimeout 550ms`).
- Jika 500 siswa mengerjakan quiz 30 soal MCQ, ada **500 × 30 = 15.000 round-trip DB** hanya untuk autosave.
- Di `saveAnswer`, setiap request melakukan **4 query terpisah:**
  1. SELECT quiz dari DB (tidak di-cache)
  2. SELECT submission
  3. SELECT question (validasi)
  4. SELECT quiz_options (validasi option MCQ)
  5. UPSERT quiz_answers
  6. UPDATE quiz_submissions.last_saved_at

**Estimasi beban:** 500 siswa × ~5 req/menit autosave = **2.500 DB query/menit hanya untuk autosave**.

---

### 🔴 Bottleneck #2 — Scoring Sinkron dalam HTTP Request (KRITIS)

**Lokasi:** `QuizController::submit()` (baris 346–477) → `QuizScoringService::finalizeSubmission()` (baris 11–101)

**Masalah:**
- Saat submit, scoring langsung dijalankan **dalam satu DB transaction berat** yang:
  1. `lockForUpdate()` pada submission
  2. SELECT semua `quiz_questions` (N soal)
  3. SELECT quiz metadata
  4. SELECT semua `quiz_answers` (N soal)
  5. SELECT semua `quiz_options` (N × 4 opsi)
  6. Loop UPDATE `quiz_answers` satu per satu (N UPDATE terpisah)
  7. UPDATE `quiz_submissions` (score, status)
- Jika 500 siswa submit bersamaan (burst saat deadline), ada **500 transaction berat bersamaan**.
- Ini bisa menyebabkan PostgreSQL lock contention dan timeout massal.

**Estimasi beban:** 500 × (1 SELECT + N SELECT + N UPDATE) = ribuan query dalam <60 detik.

---

### 🔴 Bottleneck #3 — Violation Log Spam Database (KRITIS)

**Lokasi:** `QuizController::logViolation()` (baris 633–711) + `Quiz.jsx::logViolationEvent()` (baris 925–955)

**Masalah:**
- Mode strict memicu `logViolation` setiap kali siswa berpindah tab, keluar fullscreen, screenshot, dll.
- Frontend punya dedupe 1.200ms (`violationLogRef`), tapi **backend tidak punya rate limit per-siswa per-event**.
- Backend dedupe hanya dengan incident_id: SELECT 30 log terbaru, loop manual untuk cek duplikat (O(N) per request).
- Jika 500 siswa mode strict dan banyak berpindah tab, bisa ada **ribuan INSERT ke `quiz_violation_logs` per menit**.
- Tabel `quiz_violation_logs` tidak punya index `(submission_id, event_type, created_at)` yang optimal untuk dedupe query di baris 676–694.

---

### 🟠 Bottleneck #4 — Quiz & Soal Selalu Dibaca dari DB (TINGGI)

**Lokasi:** `QuizController::startAttempt()` → `studentQuizDetail()` (baris 2699–2743) + `saveAnswer()` setiap call

**Masalah:**
- Setiap call ke `saveAnswer`, `startAttempt`, `submit` melakukan `SELECT * FROM quizzes WHERE id=? AND tenant_id=?`.
- Data quiz (soal + opsi) **tidak di-cache**, padahal kontennya bersifat read-heavy dan jarang berubah saat UTS berlangsung.
- Saat 500 siswa start secara bersamaan: **500 × SELECT quiz + 500 × SELECT questions + 500 × SELECT options** = minimal 1.500 query berat dalam hitungan detik.
- Di `storeSubmissionAnswer()` (baris 2992–3120), setiap jawaban memvalidasi question dan option dari DB — **2 SELECT tambahan per soal per autosave**.

---

### 🟠 Bottleneck #5 — Close Quiz Finalize Sinkron untuk Semua Siswa (TINGGI)

**Lokasi:** `QuizController::close()` (baris 959–1017)

**Masalah:**
- Saat guru menutup quiz, `close()` loop `foreach ($submissionIds as $submissionId)` dan memanggil `finalizeSubmission()` satu per satu **dalam satu HTTP request**.
- Jika ada 500 siswa ongoing, guru harus menunggu **500 transaction berat selesai** dalam satu request.
- Tidak ada pagination, batch, atau queue — ini bisa timeout di nginx/PHP-FPM.

---

### 🟡 Bottleneck Tambahan (MENENGAH)

| # | Masalah | Lokasi |
|---|---------|--------|
| 6 | `finalizeExpiredSubmissions()` loop semua submission ongoing setiap menit — bisa berat jika banyak siswa | `QuizScoringService::finalizeExpiredSubmissions()` baris 103–185 |
| 7 | `Schema::hasColumn()` dipanggil berkali-kali setiap request (tanpa cache) | Seluruh `QuizController` |
| 8 | Supabase Realtime channel per-siswa — 500 siswa = 500 websocket connections untuk `quiz_submissions` dan `quiz_violation_logs` | `Quiz.jsx` baris 1273–1373 |
| 9 | WhatsApp notification dipanggil synchronous dalam submit flow | `finalizeQuizSubmissionWithNotifications()` baris 1813–1828 |
| 10 | `currentAcademicPeriodForTenant()` query settings setiap `resolveStudentQuiz()` tanpa cache | Baris 1925–1941 |

---

## 4. Rencana Optimasi Bertahap

### Fase 1 — Autosave Batch & Debounce (PRIORITAS TERTINGGI)

**Tujuan:** Kurangi request autosave dari N request/soal menjadi 1 batch request setiap 5–10 detik.

**Perubahan Backend (baru, tidak merusak existing):**
```
POST /api/quiz/answers/batch
Body: { quiz_id, submission_id, answers: [{question_id, option_id|essay_answer}] }
```

- Terima array jawaban sekaligus.
- Gunakan PostgreSQL `INSERT ... ON CONFLICT (submission_id, question_id) DO UPDATE` (true upsert).
- Satu DB transaction untuk semua jawaban dalam batch.
- Estimasi pengurangan request: **dari 2.500 req/menit → 500 req/5-detik = 6.000 req/jam → ~100 req/menit**.

**Perubahan Frontend:**
- Ganti per-soal `saveAnswer()` dengan local state accumulation.
- Kirim batch setiap 5 detik via `setInterval`, atau saat pindah soal, atau saat submit.
- Essay debounce tetap 550ms ke local state, tapi HTTP call hanya saat batch flush.

---

### Fase 2 — Redis Cache untuk Quiz & Soal

**Tujuan:** Hilangkan repeated DB read untuk data statis quiz.

**Implementasi:**
```php
// Cache key: quiz:{tenantId}:{quizId} — TTL 5 menit
$quiz = Cache::remember("quiz:{$tenantId}:{$quizId}", 300, function() use ($quizId, $tenantId) {
    return DB::table('quizzes')->where('id', $quizId)->where('tenant_id', $tenantId)->first();
});

// Cache key: quiz_questions:{quizId} — TTL 10 menit
$questions = Cache::remember("quiz_questions:{$quizId}", 600, function() use ($quizId, $tenantId) {
    return DB::table('quiz_questions')->where('quiz_id', $quizId)->orderBy('nomor')->get();
});

// Cache key: quiz_options:{quizId} — TTL 10 menit
$options = Cache::remember("quiz_options:{$quizId}", 600, function() use ($questionIds, $tenantId) {
    return DB::table('quiz_options')->whereIn('question_id', $questionIds)->get();
});
```

- Invalidasi cache saat guru update/publish/close quiz.
- Estimasi pengurangan query: **dari 1.500 query saat burst start → ~3 query (cache miss pertama) + Redis get selanjutnya**.
- Production sudah pakai Redis (`CACHE_STORE=redis`).

---

### Fase 3 — Scoring via Queue (Async)

**Tujuan:** Submit langsung return success, scoring dikerjakan background worker.

**Implementasi:**
```php
// Di submit():
$result = ['submission_id' => $submissionId, 'score' => null, 'status' => 'processing'];
dispatch(new FinalizeQuizSubmissionJob($tenantId, $submissionId, $now));
return response()->json(['data' => $result]);

// Job FinalizeQuizSubmissionJob:
class FinalizeQuizSubmissionJob implements ShouldQueue {
    public function handle(QuizScoringService $service): void {
        $this->service->finalizeSubmission(...);
    }
}
```

- Queue `redis` sudah dikonfigurasi di production.
- Siswa terima response "quiz selesai" langsung, score muncul asinkron.
- Eliminasi lock contention saat 500 submit bersamaan.
- WhatsApp notifikasi otomatis pindah ke dalam Job ini.

---

### Fase 4 — Dedupe Anti-Cheat Logs (Redis Rate Limit)

**Tujuan:** Cegah spam `quiz_violation_logs` dari mode strict.

**Implementasi:**
```php
// Di logViolation():
$rateKey = "violation_rate:{$tenantId}:{$submissionId}:{$eventTypeForStorage}";
$count = Cache::increment($rateKey);
if ($count === 1) {
    Cache::expire($rateKey, 10); // 10 detik window
}
if ($count > 3) {
    return response()->json(['data' => ['skipped' => true, 'rate_limited' => true]]);
}
// Lanjut insert
```

- Maksimal 3 log per event_type per submission per 10 detik.
- Tidak perlu query 30 log terbaru untuk dedupe — O(1) via Redis.
- Estimasi pengurangan: **dari ribuan INSERT/menit → maksimal 150 INSERT/menit** (500 siswa × 3 per 10 detik).

---

### Fase 5 — Exam Recovery (Resume Quiz)

**Tujuan:** Siswa yang mati lampu / browser crash / koneksi putus bisa lanjut tanpa kehilangan jawaban.

**Kondisi saat ini:**
- `answer_order` disimpan di `quiz_submissions.answer_order` (jsonb) ✅
- `last_saved_at` ada di `quiz_submissions` ✅
- `device_session` lock 90 detik (`DEVICE_SESSION_STALE_SECONDS = 90`) ✅
- Frontend punya `resumableQuiz` detection di `Quiz.jsx` baris 702–710 ✅

**Yang masih kurang:**
- Jika siswa crash dan buka ulang dalam 90 detik, device session masih locked → siswa tidak bisa lanjut.
- Perlu tombol "Minta Guru Reset Session" atau self-service release setelah timeout.
- Jawaban di local state browser hilang jika crash sebelum autosave — dengan batch autosave (Fase 1), risiko ini berkurang drastis.

**Rekomendasi:**
1. Turunkan `DEVICE_SESSION_STALE_SECONDS` dari 90 ke 30 detik untuk crash recovery lebih cepat.
2. Tambah endpoint `POST /api/quiz/release-device-session` untuk guru.
3. Frontend: simpan jawaban sementara ke `localStorage` setiap batch flush, restore saat reload.

---

### Fase 6 — Server-Side Auto Finalize via Scheduler

**Kondisi saat ini:**
- `finalizeExpiredSubmissions()` berjalan setiap menit ✅
- `withoutOverlapping()` sudah dipasang ✅
- Tapi fungsi ini **loop semua submission ongoing** tanpa batching — bisa berat jika ratusan submission.

**Rekomendasi:**
```php
// Proses maksimal 100 submission per run, sisanya next tick
$rows = $submissionQuery->limit(100)->get();
```

- Tambah batas `->limit(100)` agar tidak overload saat banyak quiz expired bersamaan.
- Untuk close massal (500 siswa), dispatch Job per submission, bukan loop sinkron.

---

### Fase 7 — Index & Query Tuning

**Index yang sudah ada (dari migrasi):**

| Index | Tabel | Kolom |
|-------|-------|-------|
| `quiz_submissions_tenant_quiz_siswa_idx` | quiz_submissions | tenant_id, quiz_id, siswa_id |
| `quiz_submissions_tenant_siswa_quiz_idx` | quiz_submissions | tenant_id, siswa_id, quiz_id |
| `quiz_answers_tenant_submission_question_idx` | quiz_answers | tenant_id, submission_id, question_id |
| `quiz_questions_quiz_nomor_idx` | quiz_questions | quiz_id, nomor |
| `quiz_options_question_label_idx` | quiz_options | question_id, label |
| `quizzes_tenant_kelas_mapel_created_idx` | quizzes | tenant_id, kelas_id, mapel, created_at |

**Index yang perlu ditambahkan:**

```sql
-- 1. Untuk query ongoing submissions (finalizeExpired + close):
CREATE INDEX IF NOT EXISTS quiz_submissions_tenant_status_idx
    ON quiz_submissions (tenant_id, status)
    WHERE status = 'ongoing';

-- 2. Untuk dedupe violation log (saat ini pakai LIMIT 30 + loop PHP):
CREATE INDEX IF NOT EXISTS quiz_violation_submission_type_created_idx
    ON quiz_violation_logs (submission_id, event_type, created_at DESC);

-- 3. Untuk query saveAnswer yang cek question per quiz:
CREATE INDEX IF NOT EXISTS quiz_questions_tenant_quiz_idx
    ON quiz_questions (tenant_id, quiz_id);

-- 4. Untuk query option validation:
CREATE INDEX IF NOT EXISTS quiz_options_tenant_question_idx
    ON quiz_options (tenant_id, question_id);

-- 5. Untuk auto-finalize expired (join quizzes + submissions):
CREATE INDEX IF NOT EXISTS quizzes_is_active_is_live_idx
    ON quizzes (is_active, is_live)
    WHERE is_active = true;
```

**Query yang perlu dioptimasi:**
- `Schema::hasColumn()` di setiap request → cache result di static array atau boot-time.
- `currentAcademicPeriodForTenant()` dipanggil per request → cache di Redis TTL 60 menit.

---

### Fase 8 — Load Test Bertahap di Staging

**Prerequisite:**
- Environment staging identik dengan production (Redis, PostgreSQL, worker count).
- Tool: k6, Locust, atau Apache JMeter.

**Skenario per tahap:**

| Tahap | Virtual Users | Durasi | Endpoint Target | Pass Criteria |
|-------|--------------|--------|-----------------|---------------|
| 1 | 10 VU | 5 menit | start + autosave + submit | p95 < 500ms, 0 error |
| 2 | 50 VU | 10 menit | full UTS flow | p95 < 800ms, error < 1% |
| 3 | 100 VU | 15 menit | full UTS + violation log | p95 < 1s, error < 1% |
| 4 | 250 VU | 20 menit | full UTS burst submit | p95 < 2s, error < 2% |
| 5 | 500 VU | 30 menit | full UTS realistic | p95 < 3s, error < 2% |

**Script k6 dasar (contoh):**
```javascript
// k6 load test: full quiz flow
import http from 'k6/http';
import { sleep } from 'k6';
export const options = { vus: 500, duration: '30m' };

export default function () {
    // 1. Login
    // 2. GET /api/quiz/dashboard
    // 3. POST /api/quiz/start
    // 4. Loop: POST /api/quiz/answers/batch (every 5s)
    // 5. POST /api/quiz/submit
    sleep(Math.random() * 5); // jitter untuk hindari thundering herd
}
```

**Metrics yang dipantau:**
- PostgreSQL: `pg_stat_activity`, lock waits, query time
- Redis: memory usage, hit rate, queue depth
- PHP-FPM: worker count, queue length
- Laravel: failed jobs, slow queries log

---

## 5. Risiko Perubahan

| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| Batch autosave — siswa crash antara interval | Jawaban hilang (5–10 detik) | localStorage backup + retry saat reconnect |
| Async scoring — siswa lihat score terlambat | UX kurang nyaman | Tampilkan "Sedang dihitung..." + polling |
| Redis down — cache miss semua | DB overload | Fallback ke DB query (existing code) |
| Queue worker crash — job hilang | Score tidak dihitung | Queue dengan `tries=3`, dead letter queue |
| Index baru — migration lock table | Downtime jika table besar | Pakai `CREATE INDEX CONCURRENTLY` di PostgreSQL |
| Cache stale quiz — soal tidak update | Siswa lihat soal lama | Invalidasi cache saat guru edit quiz |

---

## 6. Cara Rollback

### Rollback Autosave Batch
- Endpoint `/api/quiz/answers/batch` adalah endpoint **baru** — tidak menghapus `/api/quiz/answer`.
- Frontend rollback: kembalikan `handleEssayChange` ke per-soal call.
- Tidak ada DB migration yang perlu di-rollback.

### Rollback Async Scoring
- Feature flag: `QUIZ_ASYNC_SCORING=false` di `.env`.
- Jika false, kembali ke scoring sinkron existing.

### Rollback Redis Cache
- `Cache::forget("quiz:{$tenantId}:{$quizId}")` untuk flush cache.
- Atau `php artisan cache:clear` untuk clear semua.

### Rollback Index Baru
```sql
DROP INDEX IF EXISTS quiz_submissions_tenant_status_idx;
DROP INDEX IF EXISTS quiz_violation_submission_type_created_idx;
-- dst.
```

### Rollback Violation Rate Limit
- Comment keluar 5 baris Redis rate limit di `logViolation()`.
- Tidak ada DB schema change.

---

## 7. Checklist Testing

### Pre-Deployment
- [ ] Unit test `QuizScoringService::finalizeSubmission()` dengan mock DB
- [ ] Unit test batch answer upsert — idempotent jika dipanggil 2x
- [ ] Unit test violation dedupe via Redis mock
- [ ] Integration test: full flow start → batch autosave → submit → score muncul
- [ ] Test resume quiz setelah simulasi crash (clear localStorage, reload)

### Post-Deployment Staging
- [ ] Load test 10 VU pass ✓
- [ ] Load test 50 VU pass ✓
- [ ] Load test 100 VU pass ✓
- [ ] Cek Redis memory usage tidak meledak
- [ ] Cek queue worker tidak stuck
- [ ] Cek `quiz_violation_logs` tidak spam saat mode strict
- [ ] Test guru close quiz dengan 100+ siswa ongoing — response < 5 detik
- [ ] Cek `finalizeExpiredSubmissions` tidak timeout saat batch besar

### Post-Deployment Production
- [ ] Monitor Supabase Realtime connection count saat UTS
- [ ] Monitor PostgreSQL slow query log selama UTS berlangsung
- [ ] Monitor Redis hit rate > 80% untuk quiz cache
- [ ] Monitor PHP-FPM worker utilization < 80%
- [ ] Alert jika failed job queue > 10

---

## 8. Rencana Load Test Bertahap

```
TAHAP 1 (10 VU, 5 menit)
  → Baseline: pastikan semua endpoint berfungsi normal
  → Pass if: p95 < 500ms, error_rate = 0%

TAHAP 2 (50 VU, 10 menit)  
  → Simulasi 1 kelas besar (50 siswa)
  → Test autosave concurrent
  → Pass if: p95 < 800ms, error_rate < 1%

TAHAP 3 (100 VU, 15 menit)
  → Simulasi 2 kelas (100 siswa)
  → Aktifkan mode strict + violation log
  → Pass if: p95 < 1s, error_rate < 1%

TAHAP 4 (250 VU, 20 menit)
  → Simulasi UTS setengah sekolah
  → Burst submit di menit terakhir
  → Pass if: p95 < 2s, error_rate < 2%
  → Monitor: DB lock waits, Redis queue depth

TAHAP 5 (500 VU, 30 menit)
  → Simulasi UTS penuh 500 siswa
  → 3 menit pertama: burst start
  → 25 menit: autosave steady state
  → 2 menit terakhir: burst submit
  → Pass if: p95 < 3s, error_rate < 2%
  → Monitor: semua metrics lengkap

JEDA antar tahap minimal 30 menit (biarkan DB/Redis recover).
Jalankan hanya di environment STAGING, bukan production.
```

---

## 9. Lima Prioritas Implementasi Pertama

### 🥇 Prioritas 1 — Bulk Upsert Jawaban (Batch Autosave)
**File:** `QuizController.php` (endpoint baru) + `Quiz.jsx` (batching logic)
**Dampak:** Terbesar — kurangi DB write 80–95%
**Estimasi:** 2–3 hari dev + 1 hari test

### 🥈 Prioritas 2 — Redis Cache untuk Quiz & Soal
**File:** `QuizController.php` — wrap query dengan `Cache::remember()`
**Dampak:** Kurangi DB read saat burst start 90%
**Estimasi:** 1 hari dev + 1 hari test

### 🥉 Prioritas 3 — Dedupe Violation Log via Redis Rate Limit
**File:** `QuizController::logViolation()`
**Dampak:** Cegah spam insert violation log — kurangi write 80%
**Estimasi:** 0.5 hari dev

### 4️⃣ Prioritas 4 — Scoring Async via Queue
**File:** Buat `FinalizeQuizSubmissionJob.php` + modifikasi `submit()` dan `close()`
**Dampak:** Eliminasi lock contention saat burst submit
**Estimasi:** 1–2 hari dev + 1 hari test

### 5️⃣ Prioritas 5 — Tambah Index Kritis & Cache `Schema::hasColumn()`
**File:** Migration baru + static cache helper
**Dampak:** Kurangi query plan cost, eliminasi repeated schema check
**Estimasi:** 0.5 hari dev

---

## Lampiran: Ringkasan Temuan

### Temuan Positif (Sudah Baik)
- ✅ Redis sudah dikonfigurasi di production
- ✅ Queue connection sudah Redis di production
- ✅ Composite index sudah ada untuk query utama
- ✅ `withoutOverlapping()` pada scheduler
- ✅ Device session lock (90 detik) untuk anti multi-tab
- ✅ Idempotent finalize — tidak double score
- ✅ `lockForUpdate()` pada scoring transaction
- ✅ Frontend debounce essay (550ms)
- ✅ Resume quiz detection sudah ada di frontend
- ✅ Violation log dedupe via `incident_id` (walau O(N))

### Temuan Kritis yang Harus Segera Diperbaiki
- ❌ Autosave per-soal satu per satu → harus batch
- ❌ Scoring sinkron dalam HTTP request → harus queue
- ❌ Violation log tidak ada rate limit server-side → harus Redis gate
- ❌ Quiz data tidak di-cache → harus Redis
- ❌ `close()` finalize sinkron 500 siswa → harus dispatch job

---

*Dokumen ini adalah hasil audit statis. Tidak ada perubahan pada logic aplikasi yang dilakukan.*
*Semua rekomendasi perlu diimplementasikan dan diuji di branch terpisah sebelum merge ke production.*
