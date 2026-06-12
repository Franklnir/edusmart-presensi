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

## Build Android APK di GitHub Actions

Workflow `.github/workflows/mobile-android.yml` bernama `Mobile Android Build`.
Workflow ini berjalan saat:

- ada push yang mengubah file di `mobile-app/**`;
- workflow dijalankan manual dari tab GitHub Actions;
- ada tag release seperti `v1.0.0` atau `mobile-1.0.0`.

Build Android selalu membuat APK debug standalone untuk testing dan mengupload artifact:

- `mobile-app-android-debug-apk`

APK debug artifact sudah membawa `index.android.bundle`, jadi bisa dibuka langsung di HP tanpa menjalankan Metro atau `expo start`.

Jika semua GitHub Secrets signing Android tersedia, workflow juga membuat release build dan mengupload:

- `mobile-app-android-release-apk`
- `mobile-app-android-release-aab`

Secrets Android release yang dipakai:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Jangan commit file keystore, `.jks`, `.p12`, `.mobileprovision`, `.env`, token, password, atau secret apapun ke repository.

Cara download APK:

1. Buka repository di GitHub.
2. Masuk ke tab `Actions`.
3. Pilih workflow `Mobile Android Build`.
4. Buka run yang sukses.
5. Di bagian `Artifacts`, download `mobile-app-android-debug-apk`.
6. Jika signing release aktif, download juga `mobile-app-android-release-apk` atau `mobile-app-android-release-aab`.

## Build iOS Opsional

Workflow `.github/workflows/mobile-ios.yml` bernama `Mobile iOS Optional` hanya berjalan manual dari GitHub Actions. Workflow ini tidak menjadi syarat CI utama karena macOS runner lebih berat dan iOS membutuhkan Apple signing.

Untuk membuat `.ipa`, siapkan Apple Developer certificate dan provisioning profile melalui GitHub Secrets:

- `IOS_BUILD_CERTIFICATE_BASE64`
- `IOS_P12_PASSWORD`
- `IOS_BUILD_PROVISION_PROFILE_BASE64`
- `IOS_KEYCHAIN_PASSWORD`

Jika secrets iOS belum lengkap, workflow manual akan melewati build `.ipa` tanpa memblokir CI utama.

## Build Lokal

```bash
cd mobile-app
npm ci
npm run build:android:debug:standalone
```

Script build lokal memakai `npm run bundle:android:standalone` sebelum Gradle agar bundle JS ikut masuk ke APK debug.

APK akan tersedia di:

```text
mobile-app/android/app/build/outputs/apk/debug/
```

## Catatan Production

- NFC Android paling fleksibel.
- iOS harus memakai NDEF token, bukan UID mentah.
- QR siswa harus signed/random token, bukan NIS/nama polos.
- Scan offline disimpan sementara dan dikirim ke `/api/mobile/guru/rfid/sync`.
- Admin dan super admin tetap memakai website.
