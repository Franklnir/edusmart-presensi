# API V2 Idempotency

Mutasi Phase 3 yang ditandai idempotent wajib mengirim:

```http
Idempotency-Key: <opaque-client-generated-value>
```

Body `idempotency_key` hanya fallback kompatibilitas dan header selalu menang.
Key kosong atau lebih dari 255 karakter menghasilkan
`IDEMPOTENCY_KEY_REQUIRED` (422).

Identitas cache adalah SHA-256 dari tenant, actor terautentikasi (atau device),
HTTP method, nama route/path, dan key. Payload diurutkan secara canonical lalu
di-hash SHA-256. Dengan demikian key yang sama pada tenant, actor, atau route
berbeda tidak berbagi response.

Service memakai atomic cache lock (default 15 detik). Request bersamaan yang
tidak memperoleh lock menerima `IDEMPOTENCY_PROCESSING` (409). Key dan payload
sama mereplay status/body/header aman dengan header
`Idempotency-Replayed: true`; payload berbeda menerima
`IDEMPOTENCY_CONFLICT` (409).

Hanya JSON response sukses yang disimpan. Response 4xx/5xx tidak disimpan.
Header replay dibatasi pada `Content-Type`, `Location`, dan `Retry-After`;
authorization, cookies, dan header sensitif tidak pernah dicache. TTL default
adalah 86.400 detik dan dapat diatur lewat
`API_V2_IDEMPOTENCY_TTL_SECONDS`; lock lewat
`API_V2_IDEMPOTENCY_LOCK_SECONDS`.

Cache bukan perlindungan tunggal. Domain tetap memakai transaction, row lock,
state transition, serta pengecekan duplicate record. Deployment multi-node
wajib memakai cache backend bersama yang mendukung atomic lock; cache array/file
lokal tidak cukup untuk koordinasi antarnode.
