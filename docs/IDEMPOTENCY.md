# API V2 Idempotency

Mutasi Phase 3 yang ditandai idempotent wajib mengirim:

```http
Idempotency-Key: <opaque-client-generated-value>
```

Body `idempotency_key` hanya fallback kompatibilitas dan header selalu menang.
Key kosong atau lebih dari 255 karakter menghasilkan
`IDEMPOTENCY_KEY_REQUIRED` (422).

Identitas cache adalah SHA-256 dari tenant, actor terautentikasi (atau device),
HTTP method, nama route/path, parameter route yang dinormalisasi, dan key.
Body serta query parameter (selain fallback key) diurutkan secara canonical lalu
di-hash SHA-256. Dengan demikian key yang sama pada tenant, actor, route, atau
resource ID berbeda tidak berbagi response; perubahan query menghasilkan
conflict, bukan replay yang keliru.

Service memakai atomic cache lock dengan owner token acak (default 15 detik).
Operasi dapat mempunyai override durasi per route; upload default 60 detik.
Request bersamaan yang
tidak memperoleh lock menerima `IDEMPOTENCY_PROCESSING` (409). Key dan payload
sama mereplay status/body/header aman dengan header
`Idempotency-Replayed: true`; payload berbeda menerima
`IDEMPOTENCY_CONFLICT` (409).

Hanya JSON response sukses yang disimpan setelah transaction pemanggil commit,
termasuk status 200, 201, 202, dan 204. Response 4xx/5xx tidak disimpan.
Header replay dibatasi pada `Content-Type`, `Location`, dan `Retry-After`;
authorization, cookies, dan header sensitif tidak pernah dicache. TTL default
adalah 86.400 detik dan dapat diatur lewat
`API_V2_IDEMPOTENCY_TTL_SECONDS`; lock lewat
`API_V2_IDEMPOTENCY_LOCK_SECONDS`.

Jika lock/cache tidak dapat dibaca sebelum callback dimulai, request ditolak
dengan `IDEMPOTENCY_UNAVAILABLE` (503) sehingga side effect belum terjadi. Jika
database sudah commit tetapi penulisan replay cache gagal, response sukses asli
tetap dikirim dan kegagalan dicatat tanpa data sensitif. Karena retry berikutnya
mungkin tidak dapat direplay, unique constraint, row lock, duplicate detection,
dan state machine domain wajib menolak side effect ganda.

Cache bukan perlindungan tunggal. Domain tetap memakai transaction, row lock,
state transition, serta pengecekan duplicate record. Deployment multi-node
wajib memakai cache backend bersama yang mendukung atomic lock; cache array/file
lokal tidak cukup untuk koordinasi antarnode.
