export const SCAN_ATTENDANCE_FEATURE_KEY = 'scan-kehadiran'

export const SCAN_ATTENDANCE_SUB_FEATURES = [
  {
    key: 'scan-kehadiran-pengaturan',
    label: 'Pengaturan Scan',
    icon: 'cog',
    adminPath: '/admin/scan?menu=pengaturan',
    guruPath: '/guru/admin/scan?menu=pengaturan',
    parentKey: SCAN_ATTENDANCE_FEATURE_KEY,
  },
  {
    key: 'scan-kehadiran-live',
    label: 'Live Scan',
    icon: 'signal',
    adminPath: '/admin/scan?menu=live-scan',
    guruPath: '/guru/admin/scan?menu=live-scan',
    parentKey: SCAN_ATTENDANCE_FEATURE_KEY,
  },
  {
    key: 'scan-kehadiran-riwayat',
    label: 'Riwayat',
    icon: 'history',
    adminPath: '/admin/scan?menu=riwayat',
    guruPath: '/guru/admin/scan?menu=riwayat',
    parentKey: SCAN_ATTENDANCE_FEATURE_KEY,
  },
]

export const ADMIN_FEATURES = [
  { key: 'dashboard', label: 'Dashboard', icon: 'home', adminPath: '/admin/home', guruPath: '/guru/admin/home' },
  { key: 'kelas', label: 'Kelas', icon: 'school', adminPath: '/admin/kelas', guruPath: '/guru/admin/kelas' },
  { key: 'jadwal', label: 'Jadwal', icon: 'calendar', adminPath: '/admin/jadwal', guruPath: '/guru/admin/jadwal' },
  { key: 'struktur-sekolah', label: 'Struktur Sekolah', icon: 'school', adminPath: '/admin/struktur-sekolah', guruPath: '/guru/admin/struktur-sekolah' },
  { key: 'organisasi', label: 'Organisasi', icon: 'users', adminPath: '/admin/organisasi', guruPath: '/guru/admin/organisasi' },
  { key: 'guru', label: 'Guru', icon: 'teacher', adminPath: '/admin/guru', guruPath: '/guru/admin/guru' },
  { key: 'sertifikat', label: 'Sertifikat', icon: 'certificate', adminPath: '/admin/sertifikat', guruPath: '/guru/admin/sertifikat' },
  { key: 'siswa', label: 'Siswa', icon: 'users', adminPath: '/admin/siswa', guruPath: '/guru/admin/siswa' },
  {
    key: SCAN_ATTENDANCE_FEATURE_KEY,
    label: 'Scan Kehadiran',
    icon: 'scan',
    adminPath: '/admin/scan',
    guruPath: '/guru/admin/scan',
    legacy: true,
    childKeys: SCAN_ATTENDANCE_SUB_FEATURES.map((item) => item.key),
  },
  ...SCAN_ATTENDANCE_SUB_FEATURES,
]

export const ADMIN_FEATURE_BY_KEY = ADMIN_FEATURES.reduce((acc, item) => {
  acc[item.key] = item
  return acc
}, {})

export const ADMIN_FEATURE_BY_GURU_PATH = ADMIN_FEATURES.reduce((acc, item) => {
  acc[item.guruPath] = item
  return acc
}, {})

export const resolveDelegatedAdminFeatureFromPath = (pathname = '', search = '') => {
  const normalized = String(pathname || '').split('?')[0].split('#')[0]
  if (normalized === '/guru/admin/scan') {
    const params = new URLSearchParams(search || '')
    const menu = params.get('menu') || 'pengaturan'
    if (menu === 'live-scan') return ADMIN_FEATURE_BY_KEY['scan-kehadiran-live']
    if (menu === 'riwayat') return ADMIN_FEATURE_BY_KEY['scan-kehadiran-riwayat']

    return ADMIN_FEATURE_BY_KEY['scan-kehadiran-pengaturan']
  }

  return ADMIN_FEATURES.find((item) => (
    !item.legacy && (
      normalized === item.guruPath || normalized.startsWith(`${item.guruPath}/`)
    )
  )) || null
}
