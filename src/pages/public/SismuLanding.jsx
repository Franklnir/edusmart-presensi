import React, { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowRight,
  Award,
  BarChart3,
  BookOpen,
  Building2,
  Calculator,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Cloud,
  Clock,
  Crown,
  DatabaseBackup,
  FileSpreadsheet,
  FileText,
  FolderCheck,
  Globe2,
  HardDrive,
  History,
  LayoutDashboard,
  Link as LinkIcon,
  LockKeyhole,
  Menu,
  MessageCircle,
  MessageCircleWarning,
  MonitorCheck,
  MonitorPlay,
  QrCode,
  Radio,
  Rocket,
  School,
  Send,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Tags,
  UserCheck2,
  UserCog,
  Users,
  Users2,
  X,
  XCircle,
  Zap
} from 'lucide-react'
import { getAdminSubdomain, getRootDomain } from '../../utils/marketingHost'
import { landingFeatureCards, sismuLandingPainPoints } from '../../data/sismuLandingDataset'

const whatsappUrl =
  'https://wa.me/6289531832365?text=Halo%20SISMU%2C%20saya%20ingin%20konsultasi%20paket%20untuk%20sekolah'
const demoWhatsappUrl =
  'https://wa.me/6289531832365?text=Halo%20SISMU%2C%20saya%20ingin%20minta%20demo%20landing%20dan%20fitur%20SISMU%20untuk%20sekolah'
const adminLoginUrl = `https://${getAdminSubdomain()}.${getRootDomain()}/login`

const iconMap = {
  activity: Activity,
  award: Award,
  'bar-chart-3': BarChart3,
  'book-open': BookOpen,
  building: Building2,
  'building-2': Building2,
  calculator: Calculator,
  'calendar-days': CalendarDays,
  'check-circle-2': CheckCircle2,
  'circle-help': CircleHelp,
  cloud: Cloud,
  clock: Clock,
  crown: Crown,
  'database-backup': DatabaseBackup,
  'file-spreadsheet': FileSpreadsheet,
  'file-text': FileText,
  'folder-check': FolderCheck,
  globe: Globe2,
  'globe-2': Globe2,
  'hard-drive-download': HardDrive,
  history: History,
  'layout-dashboard': LayoutDashboard,
  link: LinkIcon,
  'lock-keyhole': LockKeyhole,
  'message-circle': MessageCircle,
  'message-circle-warning': MessageCircleWarning,
  'monitor-check': MonitorCheck,
  'monitor-play': MonitorPlay,
  'qr-code': QrCode,
  radio: Radio,
  rocket: Rocket,
  school: School,
  send: Send,
  settings: Settings,
  shield: Shield,
  'shield-check': ShieldCheck,
  sparkles: Sparkles,
  tags: Tags,
  'user-check-2': UserCheck2,
  'user-cog': UserCog,
  users: Users,
  'users-2': Users2,
  'x-circle': XCircle,
  zap: Zap
}

const problems = sismuLandingPainPoints
const features = landingFeatureCards

const solutionCards = [
  {
    icon: 'folder-check',
    title: 'Lebih tertata',
    desc: 'Data sekolah tersimpan per role, kelas, dan periode sehingga admin tidak bergantung pada banyak file terpisah.'
  },
  {
    icon: 'zap',
    title: 'Lebih cepat',
    desc: 'Presensi, tugas, quiz, nilai, dan laporan tidak perlu banyak proses manual yang memakan waktu.'
  },
  {
    icon: 'sparkles',
    title: 'Lebih profesional',
    desc: 'Sekolah tampil siap digital dengan sistem cloud modern yang nyaman dipakai admin sekolah, guru, dan siswa.'
  }
]

const roleFeatureSections = [
  {
    role: 'Admin Sekolah',
    icon: 'user-cog',
    desc: 'Mengontrol data sekolah, jadwal, presensi, laporan, dan akses pengguna dari satu sistem.',
    outcome: 'Admin tidak perlu mengelola banyak file terpisah. Jadwal lebih terkontrol, presensi mudah dipantau, dan laporan lebih siap.',
    features: [
      'Dashboard sekolah',
      'Manajemen siswa',
      'Manajemen guru',
      'Manajemen kelas dan rombel',
      'Jadwal pelajaran',
      'Periode akademik dan kenaikan tahun ajaran',
      'Presensi QR/RFID/manual',
      'Live scan dan riwayat presensi',
      'Absensi guru',
      'Pengajuan absensi',
      'Nilai, rapot, dan laporan',
      'Hak akses admin'
    ]
  },
  {
    role: 'Guru',
    icon: 'book-open',
    desc: 'Membantu guru mengajar, mencatat presensi, membuat tugas, menjalankan quiz, dan merekap nilai lebih rapi.',
    outcome: 'Guru tidak perlu mengumpulkan tugas lewat chat, merekap nilai manual berkali-kali, atau mencari jadwal dari file terpisah.',
    features: [
      'Dashboard guru',
      'Jadwal mengajar',
      'Presensi kelas dan mapel',
      'Tugas digital',
      'Quiz online',
      'Bobot penilaian per mapel',
      'Rekap nilai',
      'Laporan kelas',
      'Materi dan lampiran'
    ]
  },
  {
    role: 'Siswa',
    icon: 'users',
    desc: 'Memberi siswa akses ke jadwal, presensi, tugas, quiz, nilai, sertifikat, dan aktivitas sekolah dari akun pribadi.',
    outcome: 'Siswa lebih mudah melihat kewajiban belajar, status kehadiran, dan perkembangan nilai tanpa menunggu informasi tercecer.',
    features: [
      'Dashboard siswa',
      'Jadwal pelajaran pribadi',
      'QR/RFID untuk presensi',
      'Riwayat presensi',
      'Pengumpulan tugas',
      'Quiz online',
      'Nilai dan rapot',
      'Sertifikat digital',
      'Ekskul dan aktivitas siswa'
    ]
  }
]

const benefits = [
  { icon: 'folder-check', title: 'Data sekolah lebih terstruktur', desc: 'Data siswa, guru, kelas, jadwal, presensi, dan laporan berada dalam alur yang sama.' },
  { icon: 'shield-check', title: 'Akses sesuai role', desc: 'Admin sekolah, guru, dan siswa memakai fitur sesuai kebutuhan masing-masing.' },
  { icon: 'database-backup', title: 'Storage sampai 200GB', desc: 'Paket SISMU menyediakan ruang penyimpanan besar untuk mendukung data dan lampiran sekolah.' },
  { icon: 'monitor-check', title: 'Siap digunakan lewat browser', desc: 'Sekolah tidak perlu menyediakan server sendiri untuk mulai memakai sistem.' },
  { icon: 'sparkles', title: 'Citra sekolah modern', desc: 'Layanan digital membuat sekolah terlihat lebih siap dan profesional.' },
  { icon: 'qr-code', title: 'QR siap, RFID opsional', desc: 'Sekolah bisa mulai dari QR Code dan menambahkan RFID jika ingin presensi lebih cepat.' }
]

const pricingPlans = [
  {
    name: 'Standard',
    badge: 'Paket Lengkap Sekolah',
    price: 'Rp4.000',
    period: '/siswa/bulan',
    desc: 'Untuk sekolah dengan minimal 280 siswa yang ingin merapikan administrasi, presensi, akademik, dan laporan dalam satu platform.',
    icon: 'rocket',
    highlighted: false,
    features: [
      'Semua fitur utama SISMU',
      'Akun admin sekolah, guru, dan siswa',
      'Manajemen siswa, guru, dan kelas',
      'Jadwal pelajaran',
      'Presensi QR Code dan RFID ready',
      'Live scan dan riwayat presensi',
      'Tugas digital dan quiz online',
      'Nilai, rapot, dan laporan',
      'Absensi guru dan pengajuan absensi',
      'Sertifikat digital',
      'Backup dan restore',
      'Hak akses pengguna',
      'Storage sampai 200GB'
    ],
    note: 'Belum termasuk kartu RFID dan reader RFID.'
  },
  {
    name: 'Professional',
    badge: 'Branding & Notifikasi',
    price: 'Rp5.000',
    period: '/siswa/bulan',
    desc: 'Untuk sekolah yang ingin semua fitur Standard ditambah custom domain dan notifikasi WhatsApp untuk kondisi penting.',
    icon: 'crown',
    highlighted: true,
    features: [
      'Semua fitur Paket Standard',
      'Custom domain sekolah',
      'Notifikasi WhatsApp untuk alpha',
      'Notifikasi WhatsApp untuk pelanggaran tertentu',
      'Cocok untuk komunikasi sekolah yang lebih cepat',
      'Branding sekolah lebih profesional',
      'Storage sampai 200GB'
    ],
    note: 'Wajib untuk sekolah dengan jumlah siswa di bawah 280 siswa.'
  }
]

const rfidAddOns = [
  {
    icon: 'tags',
    title: 'Kartu RFID siap pakai',
    price: 'Rp10.000',
    unit: '/kartu',
    desc: 'Biaya awal untuk sekolah yang ingin memakai kartu RFID.'
  },
  {
    icon: 'radio',
    title: 'RFID reader',
    price: 'Rp70.000',
    unit: '/unit',
    desc: 'Biaya awal per reader untuk titik scan yang dibutuhkan sekolah.'
  }
]

const comparisonRows = [
  ['Manajemen siswa, guru, kelas', true, true],
  ['Jadwal pelajaran', true, true],
  ['Presensi QR Code', true, true],
  ['Presensi RFID ready', true, true],
  ['Live scan dan riwayat presensi', true, true],
  ['Tugas dan quiz online', true, true],
  ['Nilai dan rapot', true, true],
  ['Sertifikat digital', true, true],
  ['Storage', 'Sampai 200GB', 'Sampai 200GB'],
  ['Custom domain', false, true],
  ['Notifikasi WhatsApp alpha', false, true],
  ['Notifikasi WhatsApp pelanggaran tertentu', false, true],
  ['Aturan jumlah siswa', 'Minimal 280 siswa', 'Wajib jika di bawah 280 siswa'],
  ['Kartu dan reader RFID', 'Add-on awal', 'Add-on awal']
]

const faqs = [
  {
    q: 'Apakah sekolah perlu mengelola server sendiri?',
    a: 'Tidak. SISMU berbasis cloud dan siap digunakan melalui browser. Pengelolaan teknis dapat ditangani oleh tim SISMU.'
  },
  {
    q: 'Apakah setiap sekolah mendapatkan subdomain?',
    a: 'Bisa. Sekolah dapat memakai subdomain SISMU, dan Paket Professional mendukung custom domain sekolah.'
  },
  {
    q: 'Apakah mendukung presensi QR dan RFID?',
    a: 'Ya. SISMU mendukung presensi QR Code dan sudah RFID ready. Sekolah bisa mulai dari QR Code, lalu menambahkan kartu dan reader RFID jika dibutuhkan.'
  },
  {
    q: 'Apa perbedaan Paket Standard dan Professional?',
    a: 'Paket Standard Rp4.000/siswa/bulan berisi fitur utama SISMU dengan storage sampai 200GB. Paket Professional Rp5.000/siswa/bulan berisi semua fitur Standard ditambah custom domain dan notifikasi WhatsApp untuk alpha serta pelanggaran tertentu.'
  },
  {
    q: 'Apakah wajib membeli kartu RFID dan reader?',
    a: 'Tidak wajib. SISMU tetap bisa digunakan dengan QR Code. Kartu RFID Rp10.000/kartu dan RFID reader Rp70.000/unit hanya dibayar di awal jika sekolah ingin memakai RFID.'
  },
  {
    q: 'Apakah bisa migrasi data dari Excel?',
    a: 'Bisa. Data awal seperti siswa, guru, kelas, dan jadwal dapat dibantu impor agar sekolah tidak mulai dari nol.'
  },
  {
    q: 'Mengapa sekolah dengan siswa di bawah 280 wajib mengambil Paket Professional?',
    a: 'Karena jumlah siswa yang lebih kecil membutuhkan paket dengan nilai layanan minimum agar operasional, dukungan, storage, dan fitur premium tetap layak dijalankan.'
  },
  {
    q: 'Apakah guru dan siswa punya akun masing-masing?',
    a: 'Ya. Admin sekolah, guru, dan siswa memakai akun sesuai role sehingga fitur dan data yang ditampilkan lebih tepat.'
  },
  {
    q: 'Apakah sekolah bisa memakai custom domain?',
    a: 'Bisa. Custom domain tersedia di Paket Professional agar akses sekolah terlihat lebih resmi dan mudah diingat.'
  },
  {
    q: 'Apakah sekolah bisa minta demo dulu?',
    a: 'Bisa. Sekolah dapat konsultasi dan meminta demo sebelum menentukan paket yang paling sesuai.'
  }
]

const Icon = ({ name, className = 'h-5 w-5' }) => {
  const Component = iconMap[name] || Sparkles
  return <Component className={className} aria-hidden="true" />
}

const scrollToId = (id) => {
  const target = document.getElementById(id)
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const MarketingButton = ({ children, variant = 'primary', href, onClick, className = '', ...props }) => {
  const base =
    'sismu-button inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-black transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2'
  const styles =
    variant === 'primary'
      ? 'bg-blue-600 text-white shadow-[0_18px_40px_-22px_rgba(37,99,235,0.95)] hover:bg-blue-700'
      : variant === 'dark'
        ? 'bg-slate-950 text-white hover:bg-slate-800'
        : 'border border-slate-200 bg-white text-slate-800 shadow-sm hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'

  if (href) {
    const safeRel = props.target === '_blank' && !props.rel ? 'noopener noreferrer' : props.rel
    return (
      <a href={href} onClick={onClick} className={`${base} ${styles} ${className}`} {...props} rel={safeRel}>
        {children}
      </a>
    )
  }

  return (
    <button type="button" onClick={onClick} className={`${base} ${styles} ${className}`}>
      {children}
    </button>
  )
}

const SectionHeading = ({ eyebrow, title, desc, dark = false }) => (
  <div className="mx-auto max-w-3xl text-center">
    <span
      className={`inline-flex rounded-full px-4 py-2 text-sm font-black ${
        dark ? 'bg-white/10 text-blue-100' : 'bg-blue-50 text-blue-700'
      }`}
    >
      {eyebrow}
    </span>
    <h2 className={`mt-4 text-3xl font-black tracking-tight md:text-5xl ${dark ? 'text-white' : 'text-slate-950'}`}>
      {title}
    </h2>
    {desc ? (
      <p className={`mt-4 text-base leading-relaxed md:text-lg ${dark ? 'text-slate-300' : 'text-slate-600'}`}>
        {desc}
      </p>
    ) : null}
  </div>
)

const DashboardPreview = () => {
  const bars = [66, 78, 90, 84, 96, 73, 88]
  const activity = [
    'RFID scan tercatat pukul 07:12',
    'Guru menginput nilai quiz',
    'Backup sekolah berhasil dibuat'
  ]

  return (
    <div className="sismu-dashboard-preview relative">
      <div className="absolute -inset-5 rounded-[2rem] bg-blue-200/50 blur-3xl" />
      <div className="sismu-dashboard-card sismu-shine relative overflow-hidden rounded-[1.6rem] border border-white/80 bg-white p-4 shadow-[0_28px_70px_-38px_rgba(15,23,42,0.65)]">
        <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-red-400" />
            <span className="h-3 w-3 rounded-full bg-amber-400" />
            <span className="h-3 w-3 rounded-full bg-emerald-400" />
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-black text-emerald-700">
            LIVE DASHBOARD
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="sismu-stat-card rounded-2xl bg-blue-50 p-4">
            <Users className="mb-3 h-5 w-5 text-blue-600" />
            <p className="text-2xl font-black text-slate-950">1.234</p>
            <p className="text-xs font-semibold text-slate-500">Siswa Aktif</p>
          </div>
          <div className="sismu-stat-card rounded-2xl bg-emerald-50 p-4">
            <UserCog className="mb-3 h-5 w-5 text-emerald-700" />
            <p className="text-2xl font-black text-slate-950">89</p>
            <p className="text-xs font-semibold text-slate-500">Guru</p>
          </div>
          <div className="sismu-stat-card rounded-2xl bg-amber-50 p-4">
            <Activity className="mb-3 h-5 w-5 text-amber-600" />
            <p className="text-2xl font-black text-slate-950">94%</p>
            <p className="text-xs font-semibold text-slate-500">Hadir</p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-slate-50 p-4">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-black text-slate-800">Presensi Mingguan</p>
            <p className="text-xs font-bold text-emerald-600">+12% lebih tertata</p>
          </div>
          <div className="flex h-28 items-end gap-2">
            {bars.map((height, index) => (
              <div
                key={index}
                className="sismu-chart-bar flex-1 rounded-t-xl bg-gradient-to-t from-blue-700 to-blue-400"
                style={{ height: `${height}%`, '--sismu-bar-delay': `${index * 80 + 240}ms` }}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[10px] font-semibold text-slate-400">
            <span>Sen</span><span>Sel</span><span>Rab</span><span>Kam</span><span>Jum</span><span>Sab</span><span>Min</span>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sismu-stat-card rounded-2xl bg-slate-950 p-4 text-white">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-bold text-slate-300">RFID Scan</p>
              <Radio className="h-4 w-4 text-blue-300" />
            </div>
            <p className="text-sm font-black">Ahmad Rizky</p>
            <p className="text-xs text-slate-400">XII IPA 3, 07:15 WIB</p>
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-1 text-[11px] font-bold text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Hadir tercatat
            </p>
          </div>
          <div className="sismu-stat-card rounded-2xl bg-emerald-50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-bold text-emerald-700">Backup Data</p>
              <DatabaseBackup className="h-4 w-4 text-emerald-700" />
            </div>
            <p className="text-sm font-black text-slate-900">Aman & Terbackup</p>
            <p className="text-xs text-slate-500">Hari ini, 08:30 WIB</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-emerald-100">
              <div className="sismu-progress-line h-full w-4/5 rounded-full bg-emerald-500" />
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-100 bg-white p-4">
          <p className="mb-3 text-xs font-black uppercase tracking-widest text-slate-500">Aktivitas terbaru</p>
          <div className="space-y-2">
            {activity.map((item, index) => (
              <div
                key={item}
                className="sismu-activity-row flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600"
                style={{ '--sismu-bar-delay': `${index * 120 + 680}ms` }}
              >
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const SismuLanding = () => {
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeFilter, setActiveFilter] = useState('all')
  const [openFaq, setOpenFaq] = useState(0)
  const [scrolled, setScrolled] = useState(false)

  const filteredFeatures = useMemo(() => (
    activeFilter === 'all' ? features : features.filter((feature) => feature.cat === activeFilter)
  ), [activeFilter])

  useEffect(() => {
    const previousTitle = document.title
    const description = document.querySelector('meta[name="description"]')
    const previousDescription = description?.getAttribute('content') || ''

    document.title = 'SISMU - Sistem Informasi Sekolah Mutu Unggul'
    if (description) {
      description.setAttribute(
        'content',
        'SISMU adalah platform manajemen sekolah modern untuk presensi QR/RFID, data siswa, guru, jadwal, tugas, quiz, nilai, rapot, laporan, backup, dan storage sampai 200GB.'
      )
    }

    const onScroll = () => setScrolled(window.scrollY > 20)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      document.title = previousTitle
      if (description) description.setAttribute('content', previousDescription)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  useEffect(() => {
    const root = document.querySelector('.sismu-marketing-page')
    if (!root) return undefined

    const candidates = Array.from(
      root.querySelectorAll([
        '.sismu-reveal-target',
        'section > div',
        'article',
        '.sismu-price-card',
        '.sismu-faq-item',
        '.sismu-table-wrap'
      ].join(','))
    )
      .filter((node) => !node.closest('header'))
      .filter((node, index, list) => list.indexOf(node) === index)

    candidates.forEach((node, index) => {
      node.classList.add('sismu-reveal')
      if (!node.style.getPropertyValue('--sismu-reveal-delay')) {
        node.style.setProperty('--sismu-reveal-delay', `${Math.min((index % 8) * 45, 260)}ms`)
      }
    })

    if (typeof IntersectionObserver === 'undefined') {
      candidates.forEach((node) => node.classList.add('is-visible'))
      return undefined
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        entry.target.classList.add('is-visible')
        observer.unobserve(entry.target)
      })
    }, {
      rootMargin: '0px 0px -8% 0px',
      threshold: 0.08
    })

    candidates
      .filter((node) => !node.classList.contains('is-visible'))
      .forEach((node) => observer.observe(node))

    return () => observer.disconnect()
  }, [activeFilter, openFaq])

  const navItems = [
    ['solusi', 'Solusi'],
    ['pengguna', 'Pengguna'],
    ['fitur', 'Fitur'],
    ['harga', 'Harga'],
    ['faq', 'FAQ']
  ]

  return (
    <div className="sismu-marketing-page min-h-screen bg-white text-slate-950">
      <header
        className={`sismu-nav fixed inset-x-0 top-0 z-50 transition ${
          scrolled ? 'border-b border-slate-200 bg-white/85 shadow-sm backdrop-blur-xl' : 'bg-transparent'
        }`}
      >
        <nav className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="#home" className="flex items-center gap-3" aria-label="SISMU Home">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-blue-700 to-blue-500 text-lg font-black text-white shadow-[0_18px_35px_-18px_rgba(37,99,235,0.95)]">
              S
            </span>
            <span className="leading-tight">
              <span className="block text-lg font-black tracking-tight text-slate-950">SISMU</span>
              <span className="hidden text-[11px] font-semibold text-slate-500 sm:block">
                Sistem Informasi Sekolah Mutu Unggul
              </span>
            </span>
          </a>

          <div className="hidden items-center gap-1 lg:flex">
            {navItems.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => scrollToId(id)}
                className="rounded-xl px-3 py-2 text-sm font-bold text-slate-600 transition hover:bg-blue-50 hover:text-blue-700"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="hidden items-center gap-3 lg:flex">
            <MarketingButton variant="secondary" href={adminLoginUrl}>
              Masuk Aplikasi
            </MarketingButton>
            <MarketingButton href={whatsappUrl} className="px-4" target="_blank">
              <MessageCircle className="h-4 w-4" /> Konsultasi
            </MarketingButton>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            className="rounded-xl p-2 text-slate-700 hover:bg-slate-100 lg:hidden"
            aria-label={menuOpen ? 'Tutup menu' : 'Buka menu'}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </nav>

        {menuOpen ? (
          <div className="mx-auto max-w-7xl px-4 pb-4 lg:hidden">
            <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-[0_22px_50px_-32px_rgba(15,23,42,0.45)]">
              {navItems.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    scrollToId(id)
                  }}
                  className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-black text-slate-700 hover:bg-blue-50 hover:text-blue-700"
                >
                  {label}
                  <ArrowRight className="h-4 w-4 opacity-50" />
                </button>
              ))}
              <div className="my-2 h-px bg-slate-100" />
              <MarketingButton variant="secondary" href={adminLoginUrl} className="w-full">
                Masuk Aplikasi
              </MarketingButton>
              <MarketingButton href={whatsappUrl} className="mt-2 w-full">
                <MessageCircle className="h-4 w-4" /> Konsultasi
              </MarketingButton>
            </div>
          </div>
        ) : null}
      </header>

      <main>
        <section id="home" className="relative min-h-screen overflow-hidden bg-gradient-to-b from-blue-50 via-white to-white pt-28">
          <div className="sismu-grid-drift absolute inset-0 bg-[linear-gradient(rgba(37,99,235,.07)_1px,transparent_1px),linear-gradient(90deg,rgba(37,99,235,.07)_1px,transparent_1px)] bg-[size:42px_42px]" />
          <div className="sismu-soft-orb absolute -left-40 top-28 h-96 w-96 rounded-full bg-blue-200/40 blur-3xl" />
          <div className="sismu-soft-orb sismu-soft-orb--slow absolute -right-40 bottom-20 h-[30rem] w-[30rem] rounded-full bg-emerald-200/30 blur-3xl" />

          <div className="relative mx-auto grid min-h-[calc(100vh-7rem)] max-w-7xl items-center gap-12 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:px-8">
            <div className="sismu-hero-copy text-center lg:text-left">
              <div className="sismu-hero-kicker inline-flex items-center gap-2 rounded-full border border-blue-100 bg-white/80 px-4 py-2 text-sm font-black text-blue-700 shadow-sm backdrop-blur">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
                Platform sekolah modern berbasis cloud
              </div>

              <h1 className="sismu-hero-title mt-6 text-4xl font-black leading-tight tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
                SISMU membuat administrasi sekolah lebih tertata, cepat, dan profesional.
              </h1>

              <p className="sismu-hero-subtitle mx-auto mt-6 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg lg:mx-0">
                Kelola data siswa, guru, kelas, presensi QR/RFID, jadwal pelajaran, tugas, quiz, nilai, rapot,
                dan laporan sekolah dalam satu platform cloud yang siap digunakan.
              </p>

              <div className="sismu-hero-actions mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
                <MarketingButton href={whatsappUrl} className="px-7 py-4 text-base">
                  <MessageCircle className="h-5 w-5" /> Konsultasi Sekarang <ArrowRight className="h-4 w-4" />
                </MarketingButton>
                <MarketingButton variant="secondary" onClick={() => scrollToId('harga')} className="px-7 py-4 text-base">
                  <Tags className="h-5 w-5" /> Lihat Paket
                </MarketingButton>
              </div>

              <div className="sismu-hero-tags mt-8 flex flex-wrap justify-center gap-2 lg:justify-start">
                {[
                  ['cloud', 'Cloud based'],
                  ['radio', 'QR & RFID ready'],
                  ['database-backup', 'Storage sampai 200GB'],
                  ['calendar-days', 'Jadwal dan presensi'],
                  ['bar-chart-3', 'Nilai dan rapot'],
                  ['tags', 'Mulai Rp4.000/siswa/bulan']
                ].map(([icon, label]) => (
                  <span key={label} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600">
                    <Icon name={icon} className="h-3.5 w-3.5 text-blue-600" />
                    {label}
                  </span>
                ))}
              </div>
            </div>

            <DashboardPreview />
          </div>
        </section>

        <section className="border-y border-slate-100 bg-white py-6">
          <div className="mx-auto grid max-w-7xl gap-4 px-4 text-center sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
            {[
              ['Cloud', 'Tidak perlu server sekolah'],
              ['Terstruktur', 'Data sekolah lebih rapi'],
              ['RFID/QR', 'Presensi cepat dan rapi'],
              ['Backup', 'Data siap dicadangkan']
            ].map(([title, desc]) => (
              <div key={title}>
                <p className="text-2xl font-black text-slate-950">{title}</p>
                <p className="text-sm font-semibold text-slate-500">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="solusi" className="bg-slate-50/70 py-20 md:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionHeading
              eyebrow="Masalah yang Sering Terjadi"
              title="Sekolah sering sibuk bukan karena kurang kerja, tapi karena datanya belum saling terhubung."
              desc="SISMU membantu mengurangi pekerjaan berulang, merapikan administrasi, dan membuat data lebih mudah dipantau."
            />
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {problems.map((problem) => (
                <article key={problem.title} className="sismu-card rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-blue-200 hover:shadow-lg">
                  <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-red-50">
                    <Icon name={problem.icon} className="h-6 w-6 text-red-500" />
                  </div>
                  <h3 className="mb-2 text-base font-black text-slate-950">{problem.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-600">{problem.desc}</p>
                </article>
              ))}
            </div>

            <div className="mt-16 rounded-[2rem] border border-blue-100 bg-white p-6 shadow-[0_24px_70px_-48px_rgba(37,99,235,0.75)] md:p-8">
              <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
                <div>
                  <span className="inline-flex rounded-full bg-blue-50 px-4 py-2 text-sm font-black text-blue-700">
                    Solusi SISMU
                  </span>
                  <h3 className="mt-4 text-2xl font-black tracking-tight text-slate-950 md:text-4xl">
                    SISMU menyatukan operasional sekolah dalam satu sistem.
                  </h3>
                  <p className="mt-4 text-sm leading-relaxed text-slate-600 md:text-base">
                    Dari admin sekolah, guru, sampai siswa, setiap aktivitas penting dibuat lebih rapi agar sekolah
                    lebih mudah bergerak cepat tanpa kehilangan kontrol data.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  {solutionCards.map((item) => (
                    <article key={item.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                      <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-white text-blue-600 shadow-sm">
                        <Icon name={item.icon} className="h-5 w-5" />
                      </div>
                      <h4 className="text-base font-black text-slate-950">{item.title}</h4>
                      <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.desc}</p>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="pengguna" className="bg-white py-20 md:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionHeading
              eyebrow="Untuk Pengguna Sekolah"
              title="Fitur SISMU dibuat sesuai kebutuhan admin sekolah, guru, dan siswa."
              desc="Setiap role mendapat alur kerja yang jelas, sehingga sekolah tidak perlu memaksa semua pengguna memakai menu yang sama."
            />

            <div className="mt-12 grid gap-5 lg:grid-cols-3">
              {roleFeatureSections.map((section) => (
                <article key={section.role} className="sismu-card flex h-full flex-col rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-blue-200 hover:shadow-lg">
                  <div className="mb-5 flex items-start gap-4">
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-600">
                      <Icon name={section.icon} className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-slate-950">{section.role}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-slate-600">{section.desc}</p>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    {section.features.map((feature) => (
                      <div key={feature} className="flex items-start gap-2 text-sm font-semibold text-slate-700">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-auto pt-6">
                    <p className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm font-semibold leading-relaxed text-blue-900">
                      {section.outcome}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="fitur" className="bg-white py-20 md:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionHeading
              eyebrow="Fitur Utama SISMU"
              title="Semua modul penting sekolah dalam satu platform."
              desc="Dari operasional harian sampai laporan, semua dibuat terstruktur agar mudah digunakan admin, guru, dan siswa."
            />

            <div className="mt-10 flex flex-wrap justify-center gap-2">
              {[
                ['all', 'Semua'],
                ['data', 'Data'],
                ['presensi', 'Presensi'],
                ['akademik', 'Akademik'],
                ['sistem', 'Sistem'],
                ['komunikasi', 'Komunikasi']
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveFilter(key)}
                  className={`rounded-full border px-4 py-2 text-sm font-black transition ${
                    activeFilter === key
                      ? 'border-blue-600 bg-blue-600 text-white shadow-[0_16px_36px_-20px_rgba(37,99,235,0.95)]'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredFeatures.map((feature) => (
                <article key={feature.title} className="sismu-card rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-blue-200 hover:shadow-lg">
                  <div className="mb-4 grid h-11 w-11 place-items-center rounded-2xl bg-blue-50">
                    <Icon name={feature.icon} className="h-5 w-5 text-blue-600" />
                  </div>
                  <h3 className="mb-2 text-base font-black text-slate-950">{feature.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-600">{feature.desc}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="sistem" className="relative overflow-hidden bg-slate-950 py-20 text-white md:py-28">
          <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(96,165,250,.18)_1px,transparent_1px)] bg-[size:24px_24px] opacity-50" />
          <div className="absolute -left-32 top-16 h-96 w-96 rounded-full bg-blue-500/15 blur-3xl" />
          <div className="absolute -right-32 bottom-16 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />

          <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
            <div>
              <SectionHeading
                dark
                eyebrow="Sistem Siap Pakai"
                title="Satu platform, data sekolah tetap terpisah dan terkontrol."
                desc="Sekolah cukup menggunakan sistem melalui browser. Admin sekolah mengelola data sesuai hak akses, guru fokus ke kelas, dan siswa mengakses informasi belajar dari akun masing-masing."
              />
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-black text-white">Akses Sekolah</p>
                  <p className="text-xs text-slate-400">Subdomain dan custom domain siap dipakai</p>
                </div>
                <Globe2 className="h-6 w-6 text-blue-300" />
              </div>

              <div className="space-y-3">
                {[
                  ['sman3bogor.sismu.biz.id', 'AKTIF'],
                  ['sekolahanda.sismu.biz.id', 'SIAP'],
                  ['portal.sekolah.sch.id', 'CUSTOM']
                ].map(([domain, status]) => (
                  <div key={domain} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-500/15">
                      <School className="h-4 w-4 text-blue-300" />
                    </div>
                    <span className="font-mono text-sm font-bold text-slate-100">{domain}</span>
                    <span className="ml-auto rounded-full bg-emerald-400/15 px-2 py-1 text-[10px] font-black text-emerald-200">
                      {status}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  ['shield-check', 'Hak akses sesuai role'],
                  ['hard-drive-download', 'Monitoring storage'],
                  ['history', 'Audit aktivitas'],
                  ['settings', 'Pengaturan sekolah']
                ].map(([icon, text]) => (
                  <div key={text} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm font-semibold text-slate-200">
                    <Icon name={icon} className="h-5 w-5 text-blue-300" />
                    {text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white py-20 md:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionHeading
              eyebrow="Manfaat untuk Sekolah"
              title="Yang terasa setelah sekolah memakai SISMU."
            />
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {benefits.map((benefit) => (
                <article key={benefit.title} className="sismu-card rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-emerald-200 hover:shadow-lg">
                  <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50">
                    <Icon name={benefit.icon} className="h-6 w-6 text-emerald-700" />
                  </div>
                  <h3 className="mb-2 text-lg font-black text-slate-950">{benefit.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-600">{benefit.desc}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="harga" className="bg-gradient-to-b from-blue-50/70 to-white py-20 md:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionHeading
              eyebrow="Paket Harga"
              title="Paket SISMU dibuat fleksibel sesuai kebutuhan sekolah."
              desc="Harga berlangganan mulai Rp4.000/siswa/bulan dengan storage sampai 200GB. Perangkat RFID hanya dibayar di awal jika sekolah ingin memakai RFID."
            />

            <div className="mt-12 grid gap-6 lg:grid-cols-2">
              {pricingPlans.map((plan) => (
                <article
                  key={plan.name}
                  className={`sismu-price-card relative rounded-[2rem] border p-7 ${
                    plan.highlighted
                      ? 'border-blue-400 bg-slate-950 text-white shadow-[0_28px_70px_-36px_rgba(37,99,235,0.85)]'
                      : 'border-slate-200 bg-white text-slate-950 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.55)]'
                  }`}
                >
                  {plan.highlighted ? (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-blue-500 px-4 py-2 text-xs font-black text-white shadow-lg">
                      PALING POPULER
                    </div>
                  ) : null}
                  <div className="mb-5 flex items-start justify-between gap-4">
                    <div>
                      <p className={`text-sm font-black uppercase tracking-wider ${plan.highlighted ? 'text-blue-200' : 'text-blue-700'}`}>
                        {plan.badge}
                      </p>
                      <h3 className="mt-2 text-3xl font-black">{plan.name}</h3>
                    </div>
                    <Icon name={plan.icon} className={`h-7 w-7 ${plan.highlighted ? 'text-amber-300' : 'text-blue-600'}`} />
                  </div>

                  <p className={`min-h-[72px] text-sm leading-relaxed ${plan.highlighted ? 'text-slate-300' : 'text-slate-600'}`}>
                    {plan.desc}
                  </p>

                  <div className="mt-6">
                    <p className={`mb-1 text-xs font-black uppercase tracking-wider ${plan.highlighted ? 'text-blue-200' : 'text-blue-700'}`}>
                      Harga mulai dari
                    </p>
                    <div className="flex items-end gap-1">
                      <span className="text-4xl font-black">{plan.price}</span>
                      <span className={`pb-1 text-sm font-bold ${plan.highlighted ? 'text-slate-300' : 'text-slate-500'}`}>
                        {plan.period}
                      </span>
                    </div>
                  </div>

                  <MarketingButton
                    href={whatsappUrl}
                    variant={plan.highlighted ? 'secondary' : 'primary'}
                    className="mt-6 w-full"
                  >
                    Minta Penawaran <ArrowRight className="h-4 w-4" />
                  </MarketingButton>

                  <div className="mt-6 space-y-3">
                    {plan.features.map((feature) => (
                      <div key={feature} className={`flex items-start gap-3 text-sm font-semibold ${plan.highlighted ? 'text-slate-200' : 'text-slate-700'}`}>
                        <CheckCircle2 className={`mt-0.5 h-5 w-5 shrink-0 ${plan.highlighted ? 'text-emerald-300' : 'text-emerald-700'}`} />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>

                  {plan.note ? (
                    <p className={`mt-6 rounded-2xl border px-4 py-3 text-sm font-bold leading-relaxed ${
                      plan.highlighted
                        ? 'border-white/10 bg-white/5 text-blue-100'
                        : 'border-amber-200 bg-amber-50 text-amber-800'
                    }`}>
                      {plan.note}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>

            <div className="mt-8 rounded-[2rem] border border-orange-200 bg-orange-50 p-6 shadow-[0_24px_60px_-44px_rgba(234,88,12,0.55)]">
              <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
                <div>
                  <span className="inline-flex rounded-full bg-white px-4 py-2 text-sm font-black text-orange-700">
                    Add-on RFID
                  </span>
                  <h3 className="mt-4 text-2xl font-black tracking-tight text-slate-950">
                    Biaya perangkat RFID hanya dibayar di awal jika sekolah ingin memakai RFID.
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-slate-700">
                    SISMU tetap bisa dipakai dengan QR Code tanpa membeli perangkat RFID. Kartu dan reader hanya
                    dibutuhkan jika sekolah ingin proses scan memakai kartu.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {rfidAddOns.map((item) => (
                    <article key={item.title} className="rounded-2xl border border-orange-200 bg-white p-5 shadow-sm">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div className="grid h-11 w-11 place-items-center rounded-xl bg-orange-100 text-orange-700">
                          <Icon name={item.icon} className="h-5 w-5" />
                        </div>
                        <span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-black text-white">
                          Sekali bayar
                        </span>
                      </div>
                      <h4 className="text-base font-black text-slate-950">{item.title}</h4>
                      <div className="mt-3 flex items-end gap-1">
                        <span className="text-3xl font-black text-orange-700">{item.price}</span>
                        <span className="pb-1 text-sm font-bold text-slate-500">{item.unit}</span>
                      </div>
                      <p className="mt-3 text-sm leading-relaxed text-slate-600">{item.desc}</p>
                    </article>
                  ))}
                </div>
              </div>
            </div>

            <div className="sismu-table-wrap mt-8 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.55)]">
              <div className="mb-5">
                <p className="text-xl font-black text-slate-950">Perbandingan Singkat</p>
                <p className="text-sm font-semibold text-slate-500">
                  Ringkasan sederhana agar sekolah mudah memilih paket awal.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] overflow-hidden rounded-2xl text-left text-sm">
                  <thead>
                    <tr className="bg-slate-950 text-white">
                      <th className="px-4 py-4 font-black">Fitur</th>
                      <th className="px-4 py-4 text-center font-black">Standard</th>
                      <th className="px-4 py-4 text-center font-black">Professional</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonRows.map(([feature, starter, professional], index) => (
                      <tr key={feature} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                        <td className="border-b border-slate-100 px-4 py-4 font-bold text-slate-700">{feature}</td>
                        <td className="border-b border-slate-100 px-4 py-4 text-center">{renderComparisonValue(starter)}</td>
                        <td className="border-b border-slate-100 px-4 py-4 text-center">{renderComparisonValue(professional)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="bg-white py-20 md:py-28">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <SectionHeading eyebrow="FAQ" title="Pertanyaan yang sering diajukan." />
            <div className="mt-10 space-y-3">
              {faqs.map((item, index) => {
                const isOpen = openFaq === index
                return (
                  <div key={item.q} className="sismu-faq-item overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <button
                      type="button"
                      onClick={() => setOpenFaq(isOpen ? -1 : index)}
                      className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left"
                      aria-expanded={isOpen}
                    >
                      <span className="font-black text-slate-950">{item.q}</span>
                      <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOpen ? (
                      <div className="px-5 pb-5 text-sm leading-relaxed text-slate-600">{item.a}</div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        <section id="kontak" className="relative overflow-hidden bg-gradient-to-br from-blue-700 via-blue-700 to-slate-950 py-20 text-white md:py-28">
          <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(255,255,255,.18)_1px,transparent_1px)] bg-[size:24px_24px] opacity-30" />
          <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
            <span className="inline-flex rounded-full bg-white/15 px-4 py-2 text-sm font-black text-blue-100">
              Mulai Digitalisasi Sekolah
            </span>
            <h2 className="mt-4 text-3xl font-black tracking-tight md:text-5xl">
              Sekolah yang datanya rapi akan lebih mudah bergerak cepat.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-blue-100 md:text-lg">
              Mulai rapikan presensi, jadwal, tugas, nilai, dan laporan sekolah bersama SISMU.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <MarketingButton href={whatsappUrl} variant="secondary" className="px-7 py-4 text-base">
                <MessageCircle className="h-5 w-5" /> Konsultasi Sekarang
              </MarketingButton>
              <MarketingButton href={demoWhatsappUrl} variant="dark" className="border border-white/20 px-7 py-4 text-base">
                <Calculator className="h-5 w-5" /> Minta Demo SISMU
              </MarketingButton>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-slate-950 py-12 text-slate-400">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="mb-4 flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-white">
                  <span className="font-black">S</span>
                </div>
                <div>
                  <p className="font-black text-white">SISMU</p>
                  <p className="text-xs font-semibold text-slate-500">Sistem Informasi Sekolah Mutu Unggul</p>
                </div>
              </div>
              <p className="text-sm leading-relaxed">
                Platform manajemen sekolah berbasis cloud untuk presensi, akademik, laporan, storage, dan backup.
              </p>
            </div>
            <div>
              <h4 className="mb-4 font-black text-white">Menu</h4>
              <ul className="space-y-2 text-sm font-semibold">
                {navItems.map(([id, label]) => (
                  <li key={id}>
                    <a href={`#${id}`} className="hover:text-white">{label}</a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="mb-4 font-black text-white">Fitur Populer</h4>
              <ul className="space-y-2 text-sm font-semibold">
                <li>Presensi QR Code</li>
                <li>Presensi RFID</li>
                <li>Tugas dan Quiz</li>
                <li>Backup dan Restore</li>
              </ul>
            </div>
            <div>
              <h4 className="mb-4 font-black text-white">Kontak</h4>
              <ul className="space-y-2 text-sm font-semibold">
                <li><a href="https://wa.me/6289531832365" className="hover:text-white">WhatsApp: 089531832365</a></li>
                <li><a href="mailto:sismuedu@gmail.com" className="hover:text-white">sismuedu@gmail.com</a></li>
                <li>Indonesia</li>
              </ul>
            </div>
          </div>
          <div className="mt-10 border-t border-slate-800 pt-6 text-center text-xs font-semibold text-slate-500">
            © 2026 SISMU - Sistem Informasi Sekolah Mutu Unggul. Seluruh hak cipta dilindungi.
          </div>
        </div>
      </footer>
    </div>
  )
}

function renderComparisonValue(value) {
  if (value === true) {
    return (
      <span className="mx-auto inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
        <Check className="h-4 w-4" />
      </span>
    )
  }

  if (value === false) return <span className="text-slate-400">-</span>

  return <span className="font-bold text-slate-700">{value}</span>
}

export default SismuLanding
