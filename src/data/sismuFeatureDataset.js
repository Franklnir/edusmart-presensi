export const sismuFeatureAudiences = [
  {
    key: 'admin-sekolah',
    label: 'Admin Sekolah',
    headline: 'Kontrol operasional sekolah dari satu dashboard',
    valueProposition: 'Admin sekolah bisa mengatur data, jadwal, presensi, laporan, dan akses pengguna tanpa mengandalkan banyak file terpisah.'
  },
  {
    key: 'guru',
    label: 'Guru',
    headline: 'Mengajar, menilai, dan memantau kelas lebih rapi',
    valueProposition: 'Guru punya alat untuk presensi, tugas, quiz, nilai, bobot penilaian, dan laporan kelas sesuai mapel yang diampu.'
  },
  {
    key: 'siswa',
    label: 'Siswa',
    headline: 'Akses belajar dan kehadiran lebih jelas',
    valueProposition: 'Siswa bisa melihat jadwal, tugas, quiz, nilai, riwayat presensi, sertifikat, dan aktivitas sekolah dari akun pribadi.'
  },
  {
    key: 'orang-tua',
    label: 'Orang Tua/Wali',
    headline: 'Informasi penting tidak menunggu rekap manual',
    valueProposition: 'Wali murid dapat menerima informasi kehadiran, tugas, dan perkembangan siswa secara lebih cepat melalui kanal yang disiapkan sekolah.'
  },
  {
    key: 'super-admin',
    label: 'Super Admin SISMU',
    headline: 'Kelola banyak sekolah dengan tenant terpisah',
    valueProposition: 'Tim operator dapat mengelola tenant sekolah, paket, domain, storage, backup, integrasi, dan kesiapan keamanan platform.'
  }
]

export const sismuFeatureDataset = [
  {
    audienceKey: 'admin-sekolah',
    audience: 'Admin Sekolah',
    features: [
      {
        name: 'Dashboard Sekolah',
        category: 'data',
        icon: 'layout-dashboard',
        functionText: 'Menampilkan ringkasan siswa, guru, kelas, presensi, jadwal, dan aktivitas penting sekolah.',
        problemsSolved: [
          'Kepala sekolah dan admin tidak perlu menunggu rekap manual untuk melihat kondisi sekolah.',
          'Masalah kehadiran atau data yang belum lengkap lebih cepat terlihat.'
        ],
        landingMessage: 'Satu layar untuk membaca kondisi sekolah harian.'
      },
      {
        name: 'Manajemen Siswa',
        category: 'data',
        icon: 'users',
        functionText: 'Mengelola data siswa, status aktif, kelas, angkatan, akun, RFID, dan import data awal.',
        problemsSolved: [
          'Data siswa tidak tercecer di banyak spreadsheet.',
          'Risiko salah kelas, data ganda, dan status siswa tidak sinkron berkurang.'
        ],
        landingMessage: 'Data siswa rapi dari masuk sekolah sampai alumni.'
      },
      {
        name: 'Manajemen Guru dan Admin',
        category: 'data',
        icon: 'user-cog',
        functionText: 'Mengatur profil guru, wali kelas, akun admin, dan pembagian hak akses fitur.',
        problemsSolved: [
          'Akun tidak perlu dipakai bersama.',
          'Akses fitur bisa dibatasi sesuai tugas masing-masing pengguna.'
        ],
        landingMessage: 'Guru dan admin bekerja sesuai perannya.'
      },
      {
        name: 'Kelas, Rombel, dan Wali Kelas',
        category: 'data',
        icon: 'school',
        functionText: 'Menyusun kelas, rombel, wali kelas, anggota kelas, dan snapshot per tahun ajaran.',
        problemsSolved: [
          'Perubahan anggota kelas tidak mengacaukan data periode sebelumnya.',
          'Admin lebih mudah melacak struktur kelas setiap tahun ajaran.'
        ],
        landingMessage: 'Struktur kelas tetap tertata walau periode berganti.'
      },
      {
        name: 'Periode Akademik dan Rollover',
        category: 'akademik',
        icon: 'calendar-days',
        functionText: 'Mengaktifkan tahun ajaran baru, menaikkan siswa, menandai alumni, dan mencatat pengecualian siswa yang tidak naik.',
        problemsSolved: [
          'Kenaikan tahun ajaran tidak perlu diatur ulang dari nol.',
          'Data periode lama tetap bisa dibuka tanpa tertimpa data periode baru.'
        ],
        landingMessage: 'Naik periode lebih aman dan terkontrol.'
      },
      {
        name: 'Jadwal Pelajaran Per Periode',
        category: 'akademik',
        icon: 'calendar-days',
        functionText: 'Membuat jadwal tahun ajaran aktif atau memakai jadwal periode sebelumnya sebagai jadwal baru.',
        problemsSolved: [
          'Admin tidak bingung saat tahun ajaran berubah dan jadwal baru belum diset.',
          'Jadwal lama dapat dipakai ulang tanpa menjadikan data periode lama sebagai data aktif.'
        ],
        landingMessage: 'Jadwal baru bisa dibuat kosong atau memakai pola lama.'
      },
      {
        name: 'Presensi QR, RFID, dan Manual',
        category: 'presensi',
        icon: 'qr-code',
        functionText: 'Mencatat kehadiran siswa melalui QR Code, kartu RFID, atau input manual sesuai aturan sekolah.',
        problemsSolved: [
          'Absensi kertas dan rekap manual berkurang.',
          'Waktu antre presensi bisa dipercepat dengan scan.'
        ],
        landingMessage: 'Presensi cepat dengan QR, RFID, atau manual.'
      },
      {
        name: 'Live Scan dan Riwayat Presensi',
        category: 'presensi',
        icon: 'radio',
        functionText: 'Menampilkan status scanner, feed scan terbaru, dan riwayat kehadiran berdasarkan scan paling baru.',
        problemsSolved: [
          'Operator tidak perlu menebak apakah scanner sedang aktif.',
          'Kesalahan scan lebih cepat ditemukan dari feed dan riwayat terbaru.'
        ],
        landingMessage: 'Scan masuk terlihat real time dan mudah ditelusuri.'
      },
      {
        name: 'Absensi Guru dan Jam Kosong',
        category: 'presensi',
        icon: 'user-check-2',
        functionText: 'Memantau kehadiran guru, jadwal mengajar, dan kondisi jam kosong atau pengganti.',
        problemsSolved: [
          'Jam kosong tidak terlambat diketahui.',
          'Sekolah punya data objektif untuk evaluasi kehadiran guru.'
        ],
        landingMessage: 'Kehadiran guru dan jam kosong lebih mudah dipantau.'
      },
      {
        name: 'Pengajuan Absensi',
        category: 'presensi',
        icon: 'file-text',
        functionText: 'Menerima, memeriksa, dan menyetujui pengajuan izin, sakit, atau koreksi absensi.',
        problemsSolved: [
          'Bukti izin tidak tercecer di chat pribadi.',
          'Status pengajuan lebih mudah diaudit.'
        ],
        landingMessage: 'Izin dan koreksi absensi masuk ke alur resmi.'
      },
      {
        name: 'Tugas dan Quiz Online',
        category: 'akademik',
        icon: 'circle-help',
        functionText: 'Guru membuat tugas dan quiz, siswa mengumpulkan jawaban, lalu nilai direkap dalam sistem.',
        problemsSolved: [
          'Pengumpulan tugas tidak bercampur dengan chat.',
          'Nilai quiz dan tugas tidak perlu direkap manual berulang.'
        ],
        landingMessage: 'Tugas, quiz, dan nilai tersimpan di satu tempat.'
      },
      {
        name: 'Nilai, Bobot Penilaian, dan Rapot',
        category: 'akademik',
        icon: 'bar-chart-3',
        functionText: 'Mengatur bobot penilaian per mapel, merekap nilai, dan menyiapkan laporan akademik.',
        problemsSolved: [
          'Rumus penilaian antarperiode tidak tercampur.',
          'Rapot dan laporan lebih cepat disusun dari data yang sudah ada.'
        ],
        landingMessage: 'Penilaian lebih konsisten dan siap dilaporkan.'
      },
      {
        name: 'Ekstrakurikuler dan Organisasi',
        category: 'akademik',
        icon: 'users-2',
        functionText: 'Mengelola pembina, anggota, jadwal, aktivitas, dan absensi ekstrakurikuler atau organisasi siswa.',
        problemsSolved: [
          'Data ekskul tidak terpisah dari data sekolah.',
          'Keaktifan siswa di luar kelas lebih mudah dicatat.'
        ],
        landingMessage: 'Aktivitas non-akademik ikut terdokumentasi.'
      },
      {
        name: 'Sertifikat Digital',
        category: 'akademik',
        icon: 'award',
        functionText: 'Membuat sertifikat kegiatan atau prestasi siswa secara digital.',
        problemsSolved: [
          'Pembuatan sertifikat tidak perlu desain ulang satu per satu.',
          'Arsip prestasi siswa lebih mudah disimpan.'
        ],
        landingMessage: 'Sertifikat sekolah lebih cepat dibuat dan diarsipkan.'
      },
      {
        name: 'Storage, Backup, dan Restore',
        category: 'sistem',
        icon: 'database-backup',
        functionText: 'Mengelola berkas sekolah, memantau storage, mencadangkan data, dan memulihkan data saat dibutuhkan.',
        problemsSolved: [
          'Risiko kehilangan data karena file rusak atau human error berkurang.',
          'Sekolah punya jalur pemulihan saat terjadi masalah.'
        ],
        landingMessage: 'Data penting lebih siap diamankan.'
      },
      {
        name: 'Notifikasi WhatsApp',
        category: 'komunikasi',
        icon: 'send',
        functionText: 'Menyiapkan pengiriman informasi presensi, tugas, dan pengumuman penting ke pihak terkait.',
        problemsSolved: [
          'Wali murid tidak perlu menunggu rekap akhir hari.',
          'Informasi penting lebih cepat sampai.'
        ],
        landingMessage: 'Komunikasi sekolah bisa lebih cepat dan terarah.'
      },
      {
        name: 'Hak Akses, Audit, dan Keamanan',
        category: 'sistem',
        icon: 'shield-check',
        functionText: 'Mengatur izin fitur, memisahkan akses sesuai role, dan menjaga jejak aktivitas penting.',
        problemsSolved: [
          'Akses data sensitif tidak terbuka untuk semua pengguna.',
          'Perubahan penting lebih mudah ditelusuri.'
        ],
        landingMessage: 'Akses pengguna lebih terkontrol dan bisa diaudit.'
      }
    ]
  },
  {
    audienceKey: 'guru',
    audience: 'Guru',
    features: [
      {
        name: 'Dashboard Guru',
        category: 'data',
        icon: 'layout-dashboard',
        functionText: 'Menampilkan jadwal, kelas, tugas, quiz, presensi, dan aktivitas guru yang perlu ditindaklanjuti.',
        problemsSolved: [
          'Guru tidak perlu membuka banyak menu untuk melihat pekerjaan harian.',
          'Tugas yang perlu dinilai lebih cepat terlihat.'
        ],
        landingMessage: 'Agenda mengajar dan penilaian guru lebih mudah dipantau.'
      },
      {
        name: 'Jadwal Mengajar',
        category: 'akademik',
        icon: 'calendar-days',
        functionText: 'Menampilkan jadwal mengajar guru berdasarkan kelas, hari, jam, dan tahun ajaran aktif.',
        problemsSolved: [
          'Guru tidak perlu mengecek jadwal dari file terpisah.',
          'Perubahan jadwal lebih mudah diselaraskan dengan kelas.'
        ],
        landingMessage: 'Jadwal guru tersedia langsung di akun masing-masing.'
      },
      {
        name: 'Presensi Kelas dan Mapel',
        category: 'presensi',
        icon: 'user-check-2',
        functionText: 'Membantu guru mencatat atau memeriksa kehadiran siswa pada kelas dan mapel yang diajar.',
        problemsSolved: [
          'Rekap hadir per mapel tidak perlu dikumpulkan manual.',
          'Kehadiran siswa pada jam pelajaran lebih jelas.'
        ],
        landingMessage: 'Presensi per kelas dan mapel lebih rapi.'
      },
      {
        name: 'Tugas Digital',
        category: 'akademik',
        icon: 'file-text',
        functionText: 'Membuat tugas, mengatur deadline, menerima lampiran, dan memberi penilaian.',
        problemsSolved: [
          'Pengumpulan tugas tidak tertumpuk di chat atau email.',
          'Guru lebih mudah melihat siapa yang sudah dan belum mengumpulkan.'
        ],
        landingMessage: 'Tugas masuk ke sistem, bukan tercecer di chat.'
      },
      {
        name: 'Quiz Online',
        category: 'akademik',
        icon: 'circle-help',
        functionText: 'Membuat quiz online dengan soal pilihan atau esai, lalu merekap hasilnya.',
        problemsSolved: [
          'Koreksi quiz dapat dipercepat.',
          'Hasil quiz tersimpan dan bisa dipakai untuk laporan nilai.'
        ],
        landingMessage: 'Quiz online lebih praktis untuk guru dan siswa.'
      },
      {
        name: 'Bobot Penilaian Per Mapel',
        category: 'akademik',
        icon: 'calculator',
        functionText: 'Mengatur persentase penilaian per mapel dan periode akademik.',
        problemsSolved: [
          'Bobot nilai periode baru tidak otomatis mencampur pengaturan periode lama.',
          'Guru mendapat pengingat saat bobot belum pernah diset.'
        ],
        landingMessage: 'Bobot nilai lebih konsisten setiap periode.'
      },
      {
        name: 'Nilai dan Laporan Kelas',
        category: 'akademik',
        icon: 'bar-chart-3',
        functionText: 'Merekap nilai siswa dari tugas, quiz, dan komponen lain untuk kebutuhan laporan.',
        problemsSolved: [
          'Rekap nilai tidak perlu dipindah manual dari banyak sumber.',
          'Guru lebih siap saat sekolah meminta laporan kelas.'
        ],
        landingMessage: 'Nilai dan laporan kelas tersusun dari data yang sama.'
      },
      {
        name: 'Materi dan Lampiran',
        category: 'akademik',
        icon: 'folder-check',
        functionText: 'Menyimpan dan membagikan file pendukung pembelajaran atau penugasan.',
        problemsSolved: [
          'File materi tidak mudah hilang dari percakapan.',
          'Siswa mendapat akses materi dari tempat yang jelas.'
        ],
        landingMessage: 'Materi pelajaran lebih mudah ditemukan.'
      },
      {
        name: 'Wali Kelas',
        category: 'data',
        icon: 'users',
        functionText: 'Membantu wali kelas memantau anggota kelas, presensi, pengajuan, dan kondisi siswa.',
        problemsSolved: [
          'Wali kelas tidak perlu meminta rekap terpisah ke banyak guru.',
          'Masalah siswa di kelas lebih cepat dipantau.'
        ],
        landingMessage: 'Wali kelas punya ringkasan kelas yang lebih jelas.'
      }
    ]
  },
  {
    audienceKey: 'siswa',
    audience: 'Siswa',
    features: [
      {
        name: 'Dashboard Siswa',
        category: 'data',
        icon: 'layout-dashboard',
        functionText: 'Menampilkan jadwal, presensi, tugas, quiz, nilai, sertifikat, dan aktivitas siswa.',
        problemsSolved: [
          'Siswa tidak perlu bertanya ulang untuk melihat tugas atau jadwal.',
          'Informasi akademik lebih mudah ditemukan.'
        ],
        landingMessage: 'Siswa punya pusat informasi pribadi.'
      },
      {
        name: 'Kartu QR dan RFID',
        category: 'presensi',
        icon: 'qr-code',
        functionText: 'Memberikan identitas digital untuk scan presensi sesuai aturan sekolah.',
        problemsSolved: [
          'Presensi masuk dan pulang lebih cepat.',
          'Riwayat scan siswa bisa ditelusuri.'
        ],
        landingMessage: 'Kehadiran siswa tercatat lewat QR atau RFID.'
      },
      {
        name: 'Jadwal Pelajaran Pribadi',
        category: 'akademik',
        icon: 'calendar-days',
        functionText: 'Menampilkan jadwal pelajaran sesuai kelas dan periode aktif.',
        problemsSolved: [
          'Siswa tidak bergantung pada foto jadwal yang mudah kadaluarsa.',
          'Perubahan jadwal lebih mudah diketahui.'
        ],
        landingMessage: 'Jadwal kelas bisa dilihat langsung dari akun siswa.'
      },
      {
        name: 'Pengumpulan Tugas',
        category: 'akademik',
        icon: 'file-text',
        functionText: 'Mengirim jawaban tugas, lampiran, dan melihat status pengumpulan.',
        problemsSolved: [
          'Siswa punya bukti sudah mengumpulkan.',
          'Tugas tidak hilang di chat kelas.'
        ],
        landingMessage: 'Pengumpulan tugas lebih jelas dan tercatat.'
      },
      {
        name: 'Quiz Online',
        category: 'akademik',
        icon: 'circle-help',
        functionText: 'Mengerjakan quiz online dan melihat hasil sesuai pengaturan guru.',
        problemsSolved: [
          'Quiz dapat dikerjakan tanpa kertas.',
          'Siswa lebih cepat mengetahui status hasil belajar.'
        ],
        landingMessage: 'Quiz online siap dipakai untuk evaluasi harian.'
      },
      {
        name: 'Nilai dan Rapot',
        category: 'akademik',
        icon: 'bar-chart-3',
        functionText: 'Menampilkan nilai dan laporan yang sudah dipublikasikan sekolah.',
        problemsSolved: [
          'Siswa tidak menunggu rekap manual untuk melihat perkembangan.',
          'Data nilai lebih mudah dicocokkan dengan tugas dan quiz.'
        ],
        landingMessage: 'Perkembangan belajar lebih transparan.'
      },
      {
        name: 'Riwayat Presensi dan Pengajuan',
        category: 'presensi',
        icon: 'history',
        functionText: 'Menampilkan riwayat hadir, izin, sakit, alfa, dan status pengajuan absensi.',
        problemsSolved: [
          'Siswa bisa mengecek jika ada presensi yang perlu dikoreksi.',
          'Status izin tidak menggantung tanpa kejelasan.'
        ],
        landingMessage: 'Riwayat kehadiran siswa mudah dicek.'
      },
      {
        name: 'Ekskul dan Sertifikat',
        category: 'akademik',
        icon: 'award',
        functionText: 'Menampilkan aktivitas ekstrakurikuler, organisasi, prestasi, dan sertifikat digital siswa.',
        problemsSolved: [
          'Aktivitas non-akademik ikut terdokumentasi.',
          'Sertifikat dan prestasi lebih mudah ditemukan kembali.'
        ],
        landingMessage: 'Prestasi siswa ikut tersimpan rapi.'
      }
    ]
  },
  {
    audienceKey: 'orang-tua',
    audience: 'Orang Tua/Wali',
    features: [
      {
        name: 'Notifikasi Kehadiran',
        category: 'komunikasi',
        icon: 'message-circle',
        functionText: 'Mengirim informasi presensi siswa kepada wali murid sesuai alur komunikasi sekolah.',
        problemsSolved: [
          'Wali murid tidak menunggu rekap manual untuk tahu anak sudah hadir.',
          'Sekolah lebih cepat memberi sinyal saat ada ketidakhadiran.'
        ],
        landingMessage: 'Informasi hadir siswa bisa lebih cepat sampai ke wali.'
      },
      {
        name: 'Informasi Tugas dan Quiz',
        category: 'komunikasi',
        icon: 'send',
        functionText: 'Membantu sekolah mengarahkan informasi tugas, quiz, dan agenda penting kepada siswa atau wali.',
        problemsSolved: [
          'Informasi akademik tidak hanya bergantung pada grup chat.',
          'Wali murid dapat lebih mudah memantau kewajiban belajar siswa.'
        ],
        landingMessage: 'Wali murid lebih mudah mengikuti aktivitas belajar.'
      },
      {
        name: 'Rekap Perkembangan',
        category: 'akademik',
        icon: 'bar-chart-3',
        functionText: 'Menyediakan dasar data untuk laporan perkembangan, kehadiran, dan nilai.',
        problemsSolved: [
          'Pertemuan wali kelas tidak dimulai dari pencarian data manual.',
          'Diskusi perkembangan siswa lebih berbasis data.'
        ],
        landingMessage: 'Komunikasi sekolah dan wali lebih berbasis data.'
      }
    ]
  },
  {
    audienceKey: 'super-admin',
    audience: 'Super Admin SISMU',
    features: [
      {
        name: 'Manajemen Tenant Sekolah',
        category: 'sistem',
        icon: 'building-2',
        functionText: 'Membuat, mengatur, dan memantau tenant sekolah dengan data yang terpisah.',
        problemsSolved: [
          'Data antar sekolah tidak tercampur.',
          'Onboarding sekolah baru lebih terstruktur.'
        ],
        landingMessage: 'Banyak sekolah bisa dikelola dari satu platform.'
      },
      {
        name: 'Paket, Kuota, dan Storage',
        category: 'sistem',
        icon: 'hard-drive-download',
        functionText: 'Mengelola paket sekolah, kuota admin, batas storage, dan penggunaan layanan.',
        problemsSolved: [
          'Pemakaian storage tidak dibiarkan tanpa batas.',
          'Paket layanan lebih mudah disesuaikan dengan kebutuhan sekolah.'
        ],
        landingMessage: 'Kuota dan paket sekolah lebih mudah dikontrol.'
      },
      {
        name: 'Subdomain dan Custom Domain',
        category: 'sistem',
        icon: 'globe-2',
        functionText: 'Menyiapkan alamat akses sekolah melalui subdomain SISMU atau domain sekolah sendiri.',
        problemsSolved: [
          'Sekolah tidak perlu memakai alamat akses yang sulit diingat.',
          'Brand sekolah terlihat lebih profesional.'
        ],
        landingMessage: 'Sekolah bisa punya alamat akses yang rapi.'
      },
      {
        name: 'Backup, Restore, dan Deploy Readiness',
        category: 'sistem',
        icon: 'database-backup',
        functionText: 'Menjaga data, memulihkan backup, dan memantau kesiapan rilis aplikasi.',
        problemsSolved: [
          'Risiko kehilangan data produksi lebih terkendali.',
          'Rilis sistem bisa dipantau sebelum sekolah mulai memakai.'
        ],
        landingMessage: 'Operasional platform lebih siap untuk produksi.'
      },
      {
        name: 'Integrasi RFID dan WhatsApp',
        category: 'komunikasi',
        icon: 'radio',
        functionText: 'Menyiapkan perangkat scan, gateway, dan kanal notifikasi untuk tenant sekolah.',
        problemsSolved: [
          'Integrasi perangkat tidak ditangani manual tanpa standar.',
          'Notifikasi sekolah lebih mudah dinyalakan per tenant.'
        ],
        landingMessage: 'RFID dan komunikasi sekolah siap diintegrasikan.'
      },
      {
        name: 'Keamanan Aplikasi dan Audit',
        category: 'sistem',
        icon: 'shield',
        functionText: 'Memantau konfigurasi keamanan, audit aktivitas, backup, WAF, dan kebutuhan WAAP jika trafik meningkat.',
        problemsSolved: [
          'Risiko akses tidak sah lebih cepat terdeteksi.',
          'Kebutuhan perlindungan aplikasi bisa dievaluasi sebelum rilis besar.'
        ],
        landingMessage: 'Keamanan platform bisa dipantau dari sisi operasional.'
      }
    ]
  }
]

export const landingFeatureCards = [
  { cat: 'data', icon: 'layout-dashboard', title: 'Dashboard Sekolah', desc: 'Pantau siswa, guru, kelas, presensi, jadwal, dan aktivitas penting sekolah dari satu layar.' },
  { cat: 'data', icon: 'users', title: 'Manajemen Siswa', desc: 'Data siswa, kelas, status aktif, RFID, dan akun tersimpan rapi per tahun ajaran.' },
  { cat: 'data', icon: 'user-cog', title: 'Manajemen Guru & Admin', desc: 'Kelola guru, wali kelas, admin sekolah, dan hak akses sesuai peran.' },
  { cat: 'data', icon: 'school', title: 'Kelas & Rombel', desc: 'Atur kelas, wali kelas, anggota kelas, dan riwayat struktur kelas per periode.' },
  { cat: 'akademik', icon: 'calendar-days', title: 'Periode Akademik', desc: 'Naik tahun ajaran, rollover siswa, alumni, dan pengecualian siswa tidak naik lebih terkontrol.' },
  { cat: 'akademik', icon: 'calendar-days', title: 'Jadwal Pelajaran', desc: 'Buat jadwal periode baru atau pakai pola jadwal lama sebagai data periode baru.' },
  { cat: 'presensi', icon: 'qr-code', title: 'Presensi QR Code', desc: 'Presensi cepat melalui QR sesuai aturan kelas dan periode sekolah.' },
  { cat: 'presensi', icon: 'radio', title: 'Presensi RFID', desc: 'Tap kartu RFID untuk mencatat hadir, pulang, dan riwayat scan lebih cepat.' },
  { cat: 'presensi', icon: 'monitor-play', title: 'Live Scan Feed', desc: 'Pantau status scanner dan scan terbaru agar operator cepat melihat masalah presensi.' },
  { cat: 'presensi', icon: 'history', title: 'Riwayat Presensi', desc: 'Lihat riwayat scan berdasarkan data terbaru untuk koreksi dan audit kehadiran.' },
  { cat: 'presensi', icon: 'user-check-2', title: 'Absensi Guru', desc: 'Pantau kehadiran guru, jadwal mengajar, dan indikasi jam kosong secara digital.' },
  { cat: 'akademik', icon: 'file-text', title: 'Tugas Digital', desc: 'Guru membuat tugas, siswa mengumpulkan jawaban, dan statusnya tercatat.' },
  { cat: 'akademik', icon: 'circle-help', title: 'Quiz Online', desc: 'Buat quiz online, kumpulkan jawaban, dan rekap hasil dalam satu modul.' },
  { cat: 'akademik', icon: 'calculator', title: 'Bobot Penilaian', desc: 'Atur bobot nilai per mapel dan periode agar penilaian tidak tercampur.' },
  { cat: 'akademik', icon: 'bar-chart-3', title: 'Nilai & Rapot', desc: 'Rekap nilai, absensi, dan laporan akademik lebih siap untuk dibagikan.' },
  { cat: 'akademik', icon: 'award', title: 'Sertifikat Digital', desc: 'Buat dan arsipkan sertifikat kegiatan atau prestasi siswa lebih cepat.' },
  { cat: 'akademik', icon: 'users-2', title: 'Ekstrakurikuler', desc: 'Kelola pembina, anggota, jadwal, aktivitas, dan absensi ekskul.' },
  { cat: 'komunikasi', icon: 'send', title: 'Notifikasi WhatsApp', desc: 'Kirim informasi presensi, tugas, dan pengumuman penting lebih terarah.' },
  { cat: 'sistem', icon: 'building', title: 'Multi Sekolah', desc: 'Setiap sekolah memiliki tenant, data, storage, dan akses yang terpisah.' },
  { cat: 'sistem', icon: 'globe', title: 'Subdomain Sekolah', desc: 'Sekolah bisa punya alamat akses khusus yang mudah diingat dan profesional.' },
  { cat: 'sistem', icon: 'database-backup', title: 'Backup & Restore', desc: 'Data sekolah dapat dicadangkan dan dipulihkan saat diperlukan.' },
  { cat: 'sistem', icon: 'shield-check', title: 'Hak Akses & Audit', desc: 'Akses fitur lebih terkontrol dan perubahan penting lebih mudah ditelusuri.' }
]

export const sismuLandingPainPoints = [
  {
    icon: 'file-spreadsheet',
    title: 'Data masih tersebar',
    desc: 'Data siswa, guru, kelas, presensi, nilai, dan laporan sering berada di banyak file sehingga rawan salah versi.'
  },
  {
    icon: 'clock',
    title: 'Rekap presensi lambat',
    desc: 'Absensi manual membuat laporan harian, bulanan, dan rekap kehadiran memakan waktu.'
  },
  {
    icon: 'message-circle-warning',
    title: 'Informasi terlambat',
    desc: 'Wali murid sering menerima informasi kehadiran atau tugas setelah proses rekap selesai.'
  },
  {
    icon: 'database-backup',
    title: 'Data rawan hilang',
    desc: 'Tanpa backup yang rapi, data penting bisa hilang karena file rusak, perangkat bermasalah, atau human error.'
  }
]

export const sismuFeatureRoleSummary = sismuFeatureDataset.map((group) => ({
  audienceKey: group.audienceKey,
  audience: group.audience,
  totalFeatures: group.features.length,
  primaryProblemsSolved: Array.from(new Set(group.features.flatMap((feature) => feature.problemsSolved))).slice(0, 5)
}))
