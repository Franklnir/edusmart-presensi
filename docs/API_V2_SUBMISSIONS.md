# API V2 Submissions

| Method | Endpoint | Akses |
|---|---|---|
| GET | `/api/v2/submissions` | Siswa miliknya; guru tugas sendiri; admin tenant |
| POST | `/api/v2/submissions` | Siswa untuk tugas kelasnya yang terbuka |
| GET | `/api/v2/submissions/{id}` | Policy ownership |
| PUT/PATCH | `/api/v2/submissions/{id}` | Siswa pemilik |
| DELETE | `/api/v2/submissions/{id}` | Siswa pemilik atau admin tenant |
| PATCH | `/api/v2/submissions/{id}/grade` | Creator tugas atau admin tenant |
| POST | `/api/v2/submissions/grade-by-user` | Creator tugas/admin; submission harus sudah ada |

Server mengambil student ID dari profil auth pada create; `user_id`, teacher ID,
status, nilai, dan tenant tidak dipercaya dari payload siswa. Tugas harus
`published`, sudah dimulai, belum melewati deadline, dan sesuai kelas siswa.
Assignment `closed`, draft, future, atau expired menolak create/update.

Create/update menerima `attachment_ids`, URL referensi `link_url`, nama file,
dan komentar. `file_url`/`file_urls`, bucket, local path, dan object key bukan
kontrak V2. Satu siswa hanya memiliki satu submission per tugas; transaksi
mengunci assignment sebelum pengecekan duplikat. Attachment claim juga memakai
lock dan tidak dapat dipakai oleh record lain.

Nilai dibatasi 0–100. Hanya creator assignment dalam tenant yang dapat grading;
guru lain dalam tenant yang sama ditolak. Grading mengisi actor/time server-side
dan menulis before/after audit. `grade-by-user` tidak membuat submission kosong.

Semua create/update/delete/grade memerlukan `Idempotency-Key`. Error utama:
`SUBMISSION_ALREADY_EXISTS`, `ASSIGNMENT_NOT_OPEN`,
`ASSIGNMENT_NOT_STARTED`, `ASSIGNMENT_DEADLINE_PASSED`,
`SUBMISSION_NOT_FOUND`, attachment errors, policy 403, dan tenant lain 404.
