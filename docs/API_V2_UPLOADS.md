# API V2 Upload Sessions

Status: **IMPLEMENTED, READY FOR STAGING PROVIDER VERIFICATION — disabled by
default**. Setelan `API_V2_UPLOADS_ENABLED=false` dan
`VITE_USE_ASSIGNMENT_UPLOADS_API_V2=false` wajib dipertahankan sampai credential,
CORS, HEAD verification, download, cleanup, dan rollback lulus di staging.

| Method | Endpoint | Fungsi |
|---|---|---|
| POST | `/api/v2/uploads` | Membuat session dan signed/direct upload instruction |
| GET | `/api/v2/uploads/{session}` | Metadata session milik actor |
| POST | `/api/v2/uploads/{session}/complete` | Verifikasi object dan membuat attachment |
| DELETE | `/api/v2/uploads/{session}` | Membatalkan session pending milik actor |
| GET | `/api/v2/attachments/{attachment}` | Metadata attachment sesuai parent policy |
| GET | `/api/v2/attachments/{attachment}/download` | Instruksi signed download sementara |
| DELETE | `/api/v2/attachments/{attachment}` | Detach, hapus object, dan soft-delete metadata |

Mutasi wajib membawa `Idempotency-Key`. Create menerima hanya `purpose` (`assignment_attachment` atau
`submission_attachment`), `assignment_id` sesuai purpose, basename file,
allowlisted MIME/extension, optional SHA-256 checksum, dan ukuran 1 byte–10 MiB. Backend membuat object key di
namespace tenant/assignment/actor. Response dan GET tidak mengekspos object key,
bucket, local path, atau permanent public URL.

Provider production adalah adapter `s3-compatible` atas konfigurasi object
storage repository. Logical bucket selalu `assignments`; physical bucket,
provider, dan object key disimpan dari server, bukan payload client. Provider
`local-fake` hanya ready di environment testing.

Session berlaku 15 menit dan menjalani state `pending → uploading → verifying →
uploaded → completed`. State terminal lain adalah `cancelled`, `expired`,
`failed`, dan `quarantined`. Complete memakai transaction dan `lockForUpdate()`,
melakukan HEAD provider di luar transaction panjang, lalu memeriksa exact
provider/bucket/key, keberadaan, actual size, declared size, MIME/extension, dan
checksum bila tersedia. Retry sesudah complete mengembalikan attachment yang
sama; unique `upload_session_id` mencegah attachment ganda.

Assignment/submission hanya menerima attachment completed dengan tenant, actor,
purpose, dan assignment yang benar. Claim memakai lock; claim sama boleh replay,
tetapi attachment tidak boleh dipakai record lain.

Download selalu melewati `AttachmentPolicy`, kemudian policy parent assignment
atau submission, dan hanya menghasilkan signed instruction 5–15 menit. Delete
melepas ID dari parent dalam transaction, menghapus object, lalu soft-delete
metadata; kegagalan object delete menghasilkan `delete_pending` untuk retry.

Scheduler `uploads:cleanup` berjalan tiap 15 menit dengan `onOneServer()` dan
`withoutOverlapping()`. Ia meng-expire session, menghapus object cancelled,
failed, expired, atau quarantined, serta membersihkan attachment yang tidak
pernah di-claim setelah 24 jam.

Frontend `uploadService` mengikuti `method`, `headers`, dan `fields` instruction,
menyediakan progress/AbortSignal, menyelesaikan session menjadi attachment ID,
serta memakai authorized download/delete. Saat flag V2 aktif tidak ada fallback
ke `/api/storage`.

Test lokal meliputi provider adapter dengan HTTP fake, local fake, state dan
idempotency, parent authorization, same/cross-tenant denial, delete, serta
cleanup. Ini belum menggantikan integration test terhadap credential dan bucket
staging nyata; karena itu flag tetap default-off dan status belum production.
