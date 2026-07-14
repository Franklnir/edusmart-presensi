# API V2 Assignments

| Method | Endpoint | Akses |
|---|---|---|
| GET | `/api/v2/assignments` | Siswa kelas sendiri; guru tugas sendiri; admin tenant |
| POST | `/api/v2/assignments` | Guru kelas/mapel yang diampu; admin |
| GET | `/api/v2/assignments/{id}` | Policy tenant dan ownership |
| PUT/PATCH | `/api/v2/assignments/{id}` | Creator guru atau admin tenant |
| DELETE | `/api/v2/assignments/{id}` | Creator/admin jika belum ada submission |

Status assignment adalah `draft`, `published`, `closed`, atau `archived`.
Siswa hanya melihat `published`/`closed` untuk kelas profilnya; draft tidak
pernah ditampilkan. Guru hanya mengelola tugas yang dibuatnya dan kelas/mapel
yang tercatat pada jadwal atau wali kelas. Tenant/creator tidak diterima dari
payload.

Create/update menerima kelas, judul, mapel, mulai, deadline, keterangan, link,
status, metadata periode, serta `attachment_ids`. Arbitrary `file_url`, object
key, bucket, dan permanent URL tidak menjadi kontrak attachment. Attachment ID
harus berasal dari upload session completed, tenant/actor/purpose yang sama,
dan diklaim dengan transaction + lock.

Create/update memerlukan `Idempotency-Key` dan menulis audit log. Delete tugas
yang telah memiliki submission menghasilkan `ASSIGNMENT_HAS_SUBMISSIONS` (409),
bukan cascade delete. Error scope guru adalah `ASSIGNMENT_SCOPE_FORBIDDEN`.

Frontend service V2 tersedia, tetapi flag assignment tetap harus string
`"true"`. Attachment UI masih bergantung storage legacy; karena upload provider
V2 belum lengkap, cutover assignment ber-attachment belum dinyatakan selesai.
