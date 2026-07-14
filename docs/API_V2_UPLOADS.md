# API V2 Upload Sessions

Status: **PARTIAL — disabled by default**. Setelan
`API_V2_UPLOADS_ENABLED=false` wajib dipertahankan sampai provider direct-upload
dan authorized download production selesai serta diuji end-to-end.

| Method | Endpoint | Fungsi |
|---|---|---|
| POST | `/api/v2/uploads` | Membuat session dan signed/direct upload instruction |
| GET | `/api/v2/uploads/{session}` | Metadata session milik actor |
| POST | `/api/v2/uploads/{session}/complete` | Verifikasi object dan membuat attachment |
| DELETE | `/api/v2/uploads/{session}` | Membatalkan session pending milik actor |

Create menerima hanya `purpose` (`assignment_attachment` atau
`submission_attachment`), `assignment_id` sesuai purpose, basename file,
allowlisted MIME, dan ukuran 1 byte–10 MiB. Backend membuat object key di
namespace tenant/assignment/actor. Response dan GET tidak mengekspos object key,
bucket, local path, atau permanent public URL.

Session berlaku 15 menit. Complete memakai transaction dan row lock, lalu
memastikan session masih pending, belum expired, object ada, ukuran sama, dan
MIME cocok. Attachment baru dibuat setelah verifikasi. Session completed,
expired, atau cancelled tidak dapat diselesaikan ulang.

Assignment/submission hanya menerima attachment completed dengan tenant, actor,
purpose, dan assignment yang benar. Claim memakai lock; claim sama boleh replay,
tetapi attachment tidak boleh dipakai record lain.

Blocker: transport local saat ini hanya placeholder dan belum memiliki route
upload aman; download attachment/signed URL berotorisasi belum diimplementasikan
di API V2. S3 signed-upload juga belum dibuktikan lewat integration test provider
riil. Oleh sebab itu modul ini tidak dinyatakan storage-secure/complete dan
frontend attachment tetap memakai legacy saat flag V2 mati.
