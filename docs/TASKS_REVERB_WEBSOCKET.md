# Task List: Ganti Realtime Polling → Laravel Reverb (WebSocket)

## Konteks

Saat ini 23 channel realtime menggunakan polling ke `/api/db` setiap 4 detik.
Migrasi ke WebSocket akan:
- Mengurangi beban server (gak polling tiap 4 detik)
- Memberikan real-time sejati (push, bukan pull)
- Menghilangkan ketergantungan ke `/api/db` sepenuhnya

## Arsitektur Target

```
Frontend (Laravel Echo + Reverb client)
    ↕ WebSocket (wss://)
Backend (Laravel Reverb Server)
    ↕ Redis Pub/Sub
Laravel App (broadcast events)
```

## Task 1: Install & Konfigurasi Reverb

### 1a. Install package
```bash
cd backend
composer require laravel/reverb
php artisan reverb:install
```

### 1b. Konfigurasi `.env`
```env
BROADCAST_CONNECTION=reverb
REVERB_APP_ID=edusmart
REVERB_APP_KEY=edusmart-reverb-key
REVERB_APP_SECRET=edusmart-reverb-secret
REVERB_HOST="reverb.${APP_URL}"
REVERB_PORT=8080
REVERB_SCHEME=https
```

### 1c. Buat config/broadcasting.php
```php
'connections' => [
    'reverb' => [
        'driver' => 'reverb',
        'key' => env('REVERB_APP_KEY'),
        'secret' => env('REVERB_APP_SECRET'),
        'app_id' => env('REVERB_APP_ID'),
        'options' => [
            'host' => env('REVERB_HOST', 'localhost'),
            'port' => env('REVERB_PORT', 8080),
            'scheme' => env('REVERB_SCHEME', 'http'),
        ],
    ],
],
```

## Task 2: Buat Broadcast Events

### Events yang dibutuhkan (1 per tabel):

| Event | Tabel | Consumer |
|---|---|---|
| `AbsensiUpdated` | absensi | AbsensiGuru, useStudentAttendanceRealtime, RingkasanKelasTable |
| `AbsensiAjuanUpdated` | absensi_ajuan | AbsensiGuru, useStudentAttendanceRealtime |
| `AbsensiSettingsUpdated` | absensi_settings | AbsensiGuru |
| `JadwalUpdated` | jadwal | AbsensiGuru, JadwalGuru |
| `JamKosongUpdated` | jam_kosong | AbsensiGuru, JadwalGuru |
| `TugasUpdated` | tugas | siswa/Home, siswa/Tugas, TugasGuru |
| `TugasJawabanUpdated` | tugas_jawaban | siswa/Home, siswa/Tugas, TugasGuru |
| `RfidScanCreated` | rfid_scans | useStudentRfidAttendanceListener, useStudentRfidActions, Scan |
| `SettingsUpdated` | settings | Login, Register, admin/Home, pengaturan |
| `ProfileUpdated` | profiles | guru/profile |

### Template Event:
```php
// app/Events/AbsensiUpdated.php
class AbsensiUpdated implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $kelas,
        public string $tanggal,
        public string $mapel,
        public array $data
    ) {}

    public function broadcastOn(): Channel
    {
        return new Channel("absensi.{$this->kelas}.{$this->tanggal}.{$this->mapel}");
    }
}
```

### Trigger event di controller setelah mutasi:
```php
// Di AttendanceController@store
broadcast(new AbsensiUpdated($kelas, $tanggal, $mapel, $data))->toOthers();
```

## Task 3: Frontend — Install Laravel Echo + Reverb

### 3a. Install
```bash
npm install laravel-echo pusher-js
```

### 3b. Buat `src/lib/echo.js`
```js
import Echo from 'laravel-echo'
import Pusher from 'pusher-js'

window.Pusher = Pusher

export const echo = new Echo({
  broadcaster: 'reverb',
  key: import.meta.env.VITE_REVERB_APP_KEY,
  wsHost: import.meta.env.VITE_REVERB_HOST,
  wsPort: import.meta.env.VITE_REVERB_PORT,
  wssPort: import.meta.env.VITE_REVERB_PORT,
  forceTLS: import.meta.env.VITE_REVERB_SCHEME === 'https',
  enabledTransports: ['ws', 'wss'],
})
```

### 3c. Ganti di consumer

**Sebelum (polling):**
```js
const channel = supabase
  .channel(`absensi-realtime-siswa-${userId}`)
  .on('postgres_changes', {
    event: '*', schema: 'public', table: 'absensi',
    filter: `uid=eq.${userId}`
  }, callback)
  .subscribe()

// cleanup:
return () => supabase.removeChannel(channel)
```

**Sesudah (WebSocket):**
```js
import { echo } from '../../../lib/echo'

const channel = echo.channel(`absensi.${kelas}.${tgl}.${mapel}`)
  .listen('AbsensiUpdated', (e) => callback(e))

// cleanup:
return () => echo.leaveChannel(`absensi.${kelas}.${tgl}.${mapel}`)
```

## Task 4: Hapus Polling Legacy

Setelah semua 23 channel pindah ke Reverb:
1. Hapus `RealtimePollingManager` class dari `src/lib/supabase.js`
2. Hapus `/api/db` route sepenuhnya
3. Hapus `config/api_db.php`

## Checklist

- [ ] Install Laravel Reverb
- [ ] Konfigurasi `.env` + `config/broadcasting.php`
- [ ] Buat 10 broadcast events
- [ ] Trigger event di controller yang relevan
- [ ] Install laravel-echo + pusher-js di frontend
- [ ] Buat `src/lib/echo.js`
- [ ] Migrasi 15 file consumer (23 channel)
- [ ] Verifikasi: WebSocket terhubung, event diterima
- [ ] Hapus RealtimePollingManager
- [ ] Hapus `/api/db` route
- [ ] `php artisan test --no-ansi`
- [ ] `npm run build`
