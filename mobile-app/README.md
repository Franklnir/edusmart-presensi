# SISMU Mobile

Aplikasi mobile operasional SISMU untuk role `guru` dan `siswa`.

Stack yang dipakai:

- React Native + TypeScript.
- Expo prebuild/dev client, bukan Expo Go standar.
- `react-native-nfc-manager` untuk NFC production.
- `expo-camera` untuk QR fallback.
- `expo-secure-store` untuk token.
- `@tanstack/react-query` untuk cache API.
- AsyncStorage untuk tenant context dan offline queue ringan.

## Alur Utama

1. User memilih sekolah dari `/api/mobile/schools`.
2. App menyimpan tenant context.
3. Login memakai endpoint auth Laravel yang sama dengan web, dengan flag `mobile=true`.
4. Backend hanya memberi token untuk role `guru` dan `siswa`.
5. Guru memakai tab Beranda, Scan, Kelas, Aktivitas, Profil.
6. Siswa memakai tab Beranda, Absensi, Tugas, Nilai, Profil.

## Build Android APK di GitHub

Workflow `.github/workflows/mobile-android.yml` akan:

1. Install dependency di `mobile-app`.
2. Menjalankan Expo prebuild Android.
3. Build APK release.
4. Upload artifact `sismu-mobile-apk`.

Artifact bisa diunduh dari halaman GitHub Actions setelah workflow sukses.

## Build Lokal

```bash
cd mobile-app
npm install
npm run build:android:release
```

APK akan tersedia di:

```text
mobile-app/android/app/build/outputs/apk/release/
```

## Catatan Production

- NFC Android paling fleksibel.
- iOS harus memakai NDEF token, bukan UID mentah.
- QR siswa harus signed/random token, bukan NIS/nama polos.
- Scan offline disimpan sementara dan dikirim ke `/api/rfid/sync`.
- Admin dan super admin tetap memakai website.
