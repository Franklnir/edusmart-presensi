# Mobile ↔ Backend Integration Map

Dokumen ini menjelaskan mapping endpoint yang digunakan mobile app terhadap backend API.

## Prinsip Utama

1. **Mobile adalah client ringan**, bukan pengganti dashboard web
2. **Login** pakai `AuthController` existing dengan `mobile=true` + header `X-Mobile-App: edusmart-presensi`
3. **Tidak membuat tabel baru** — semua data masuk ke tabel existing (`absensi`, `tugas_jawaban`, `quiz_submissions`, dst.)
4. **NFC scan guru** → `RfidIngressService` (sumber kebenaran RFID tetap backend)
5. **QR absensi** → `AttendanceQrController` (guru tampilkan QR, siswa scan)

---

## Endpoint Map

### Auth

| Mobile Action | Method | Endpoint | Controller |
|---|---|---|---|
| Cari sekolah | GET | `/api/mobile/schools` | `MobileDirectoryController::schools` |
| Login | POST | `/api/auth/login` | `AuthController::login` |
| Logout | POST | `/api/auth/logout` | `AuthController::logout` |
| Revalidate session | GET | `/api/mobile/me` | `MobileController::me` |

### Dashboard

| Mobile Action | Method | Endpoint | Controller |
|---|---|---|---|
| Dashboard guru | GET | `/api/mobile/guru/dashboard` | `MobileController::guruDashboard` |
| Dashboard siswa | GET | `/api/mobile/siswa/dashboard` | `MobileController::siswaDashboard` |
| Dashboard auto-route | GET | `/api/mobile/dashboard` | `MobileController::dashboard` |

### Guru — Absensi

| Mobile Action | Method | Endpoint | Controller |
|---|---|---|---|
| Jadwal hari ini | GET | `/api/mobile/guru/schedules/today` | `MobileController::guruSchedulesToday` |
| Daftar kelas | GET | `/api/mobile/guru/classes` | `MobileController::guruClasses` |
| Detail kelas + siswa | GET | `/api/mobile/guru/classes/{id}` | `MobileController::guruClass` |
| Ringkasan absensi | GET | `/api/mobile/guru/attendance/summary` | `MobileController::guruAttendanceSummary` |
| Scan NFC kartu siswa | POST | `/api/mobile/guru/rfid/scan` | `MobileController::guruRfidScan` |
| Sync NFC offline batch | POST | `/api/mobile/guru/rfid/sync` | `MobileController::guruRfidSync` |
| Tampilkan QR kelas | POST | `/api/attendance-qr/session` | `AttendanceQrController::session` |
| Absensi manual | POST | `/api/mobile/guru/attendance/manual` | `MobileController::guruManualAttendance` |

### Siswa — Absensi

| Mobile Action | Method | Endpoint | Controller |
|---|---|---|---|
| Summary absensi | GET | `/api/mobile/siswa/attendance` | `MobileController::siswaAttendance` |
| Jadwal | GET | `/api/mobile/siswa/schedules` | `MobileController::siswaSchedules` |
| Scan QR absensi guru | POST | `/api/attendance-qr/scan` | `AttendanceQrController::scan` |
| Kartu digital QR | GET | `/api/mobile/siswa/digital-card` | `MobileController::siswaDigitalCard` |

### Siswa — Tugas

| Mobile Action | Method | Endpoint | Controller |
|---|---|---|---|
| Daftar tugas | GET | `/api/mobile/siswa/tasks` | `MobileController::siswaTasks` |
| Submit jawaban | POST | `/api/tugas/jawaban/submit` | `TugasController::submitJawaban` |

### Siswa — Quiz

| Mobile Action | Method | Endpoint | Controller |
|---|---|---|---|
| Daftar quiz | GET | `/api/quiz/dashboard` | `QuizController::dashboard` |
| Detail quiz + soal | GET | `/api/quiz/{quizId}/detail` | `QuizController::detail` |
| Mulai quiz | POST | `/api/quiz/start` | `QuizController::startAttempt` |
| Simpan jawaban | POST | `/api/quiz/answer` | `QuizController::saveAnswer` |
| Simpan batch | POST | `/api/quiz/answers/batch` | `QuizController::saveAnswersBatch` |
| Selesaikan quiz | POST | `/api/quiz/submit` | `QuizController::submit` |

### Siswa — Nilai

| Mobile Action | Method | Endpoint | Controller |
|---|---|---|---|
| Nilai ringkas | GET | `/api/mobile/siswa/grades` | `MobileController::siswaGrades` |

---

## Flow Diagram

### QR Absensi

```
Guru (mobile)                     Backend                    Siswa (mobile)
     │                               │                            │
     │── POST /attendance-qr/session──│                            │
     │◄─── { token, ttl_seconds } ────│                            │
     │                               │                            │
     │  [Tampilkan QR di layar]       │                            │
     │                               │     [Scan QR guru]         │
     │                               │◄── POST /attendance-qr/scan│
     │                               │──── { success, absensi_id }│
     │                               │                            │
     │  [Auto-refresh QR /45 detik]   │                            │
```

### NFC Absensi

```
Guru (mobile)                     Backend
     │                               │
     │  [Tempel kartu NFC siswa]      │
     │  [Parse NDEF → card_uid]       │
     │── POST /mobile/guru/rfid/scan──│
     │◄──── { success, message } ─────│
     │                               │
     │  [Offline? → enqueue]          │
     │  [Online? → POST rfid/sync] ───│
```

### Manual Absensi

```
Guru (mobile)                          Backend
     │                                    │
     │  [Pilih jadwal → kelas → siswa]    │
     │  [Pilih status: Hadir/Izin/dll]    │
     │── POST /mobile/guru/attendance/    │
     │         manual                     │
     │◄──── { success, absensi_id } ──────│
```

### Quiz Flow

```
Siswa (mobile)                    Backend
     │                               │
     │── GET /quiz/dashboard ─────────│
     │◄── { rows: [...] } ───────────│
     │                               │
     │── GET /quiz/{id}/detail ───────│
     │◄── { quiz, questions, ... } ───│
     │                               │
     │── POST /quiz/start ────────────│
     │◄── { submission, questions } ──│
     │                               │
     │── POST /quiz/answer (per soal)─│
     │◄── { answer_id, saved_at } ────│
     │                               │
     │── POST /quiz/submit ───────────│
     │◄── { score, total_points } ────│
```

---

## Session Revalidation

Saat app boot:

1. Load token + profile dari storage
2. Set token sementara ke API client
3. Panggil `GET /api/mobile/me`
4. Jika **200** → update profile/tenant dari response server, lanjut
5. Jika **401/403** → clear session, redirect ke login
6. Jika **network error** → tetap pakai cached session (graceful offline)

---

## NFC Parser

File: `src/features/attendance/nfc/nfcParser.ts`

- Parse NDEF Text Record: baca status byte → skip language code → ambil text
- Parse NDEF URI Record: decode prefix code + URI string
- Detect JSON payload
- Fallback ke `tag.id` (hex UID)
- Normalize: uppercase, trim
- Tidak pernah mengirim string kosong

## Offline Queue NFC

File:

- `src/storage/offlineScanQueue.ts`
- `src/hooks/useOfflineScanSync.ts`

Aturan produksi:

- Maksimal 500 event disimpan lokal.
- Event hanya dihapus jika backend sukses atau mengembalikan duplicate.
- Retry otomatis maksimal 5 kali.
- Error validasi backend seperti 400/401/403/404/409/422 ditandai gagal permanen.
- Guru dapat melihat alasan gagal dan menekan retry manual dari layar Scan.
- Event gagal permanen tetap tersimpan sampai retry manual atau queue dibersihkan secara eksplisit.
