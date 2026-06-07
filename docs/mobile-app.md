# Integrasi Mobile SISMU

Folder `mobile-app` berisi aplikasi React Native TypeScript untuk role guru dan siswa.

## Endpoint Baru

Public:

- `GET /api/mobile/schools?search=...`

Protected dengan Sanctum bearer token:

- `GET /api/mobile/me`
- `GET /api/mobile/dashboard`
- `GET /api/mobile/guru/dashboard`
- `GET /api/mobile/guru/schedules/today`
- `GET /api/mobile/guru/classes`
- `GET /api/mobile/guru/classes/{id}`
- `GET /api/mobile/guru/attendance/summary`
- `GET /api/mobile/siswa/dashboard`
- `GET /api/mobile/siswa/attendance`
- `GET /api/mobile/siswa/schedules`
- `GET /api/mobile/siswa/tasks`
- `GET /api/mobile/siswa/grades`
- `GET /api/mobile/siswa/digital-card`

Login mobile tetap memakai endpoint auth existing:

- `POST /api/auth/login`

Tambahkan payload:

```json
{
  "email": "nis-atau-email",
  "password": "password",
  "mobile": true
}
```

atau header:

```text
X-Mobile-App: edusmart-presensi
```

Response mobile menyertakan:

```json
{
  "data": {
    "access_token": "...",
    "token_type": "Bearer",
    "profile": {},
    "user": {}
  }
}
```

Admin dan super admin ditolak dari mobile supaya panel admin tetap lewat website.

## Build APK

Jalankan workflow `Mobile Android APK` dari GitHub Actions. APK akan muncul sebagai artifact `sismu-mobile-apk`.
