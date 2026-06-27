# Panduan Implementasi SWR Caching (Stale-While-Revalidate)

## Pengantar
Aplikasi Edusmart menggunakan arsitektur *Local Caching* ringan yang diinspirasi dari SWR (Stale-While-Revalidate). Tujuan utamanya adalah memberikan pengalaman **Loading Instan (0 detik)** saat pengguna berpindah halaman atau menekan tombol Refresh, dengan cara memprioritaskan data dari memori penyimpanan lokal (`localStorage`) selagi aplikasi secara diam-diam meminta pembaruan data dari server.

## Kapan Harus Menggunakan Ini?
Gunakan pendekatan ini pada:
1. **Halaman Beranda (Dashboard)** yang memiliki beban kueri berat.
2. **Halaman Laporan** yang menampilkan statistik dalam jumlah besar.
3. Fitur-fitur yang tidak memerlukan data yang harus 100% akurat dalam hitungan milidetik (misalnya: Daftar Ekstrakurikuler, Daftar Pengumuman).

## Cara Penggunaan

Kita telah membuat Custom React Hook `useLocalCache` di `src/hooks/useLocalCache.js` yang bekerja persis seperti `useState` biasa, namun memiliki fungsi bawaan untuk menyimpan dan membaca dari `localStorage`.

### 1. Import Hook
```javascript
import { useLocalCache } from '../../hooks/useLocalCache'
```

### 2. Ganti `useState` dengan `useLocalCache`
Pola pemanggilan:
```javascript
const [state, setState, hasCache] = useLocalCache('unique_key_name', initialValue)
```

**Sebelum (Standar React):**
```javascript
const [stats, setStats] = useState({ siswa: 0, guru: 0 })
const [isLoading, setIsLoading] = useState(true) // Layar pasti akan loading dulu
```

**Sesudah (Dengan SWR Cache):**
```javascript
const [stats, setStats, hasStatsCache] = useLocalCache('dashboard_stats', { siswa: 0, guru: 0 })

// Jika hasStatsCache bernilai true (ada data lama), matikan layar loading sejak awal
const [isLoading, setIsLoading] = useState(!hasStatsCache)
```

### 3. Fetch Data Seperti Biasa
Di dalam `useEffect` atau fungsi pemuat data, Anda tetap melakukan *fetch* (pengambilan) dari `supabase` atau `API`. Begitu fungsi `setStats(newData)` dipanggil, data tidak hanya masuk ke state React, melainkan juga tersimpan otomatis ke `localStorage` untuk kunjungan berikutnya.

```javascript
const loadData = async () => {
    // isLoading jangan diset true lagi di sini jika cache sudah ada!
    // setIsLoading(true) <-- HINDARI JIKA MUNGKIN
    
    const { data } = await supabase.from('...').select('...')
    
    // UI akan diam-diam berganti dari data lama (cache) ke data baru secara mulus
    setStats(data) 
}
```

## Best Practices
1. **Gunakan Kunci Unik**: Selalu gunakan kata kunci (*key*) yang deskriptif untuk parameter pertama `useLocalCache` (misal: `admin_dashboard_guruList` alih-alih hanya `guruList`) untuk mencegah bentrok data.
2. **Batas Ukuran**: `localStorage` memiliki batas maksimal ~5MB. Jangan *cache* daftar yang berisi puluhan ribu baris data. Gunakan ini untuk *summary* (ringkasan), pengaturan, atau daftar pendek (seperti *dropdown* list guru/kelas).
