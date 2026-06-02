export const ADMIN_FEATURES = [
  { key: 'dashboard', label: 'Dashboard', icon: 'home', adminPath: '/admin/home', guruPath: '/guru/admin/home' },
  { key: 'kelas', label: 'Kelas', icon: 'school', adminPath: '/admin/kelas', guruPath: '/guru/admin/kelas' },
  { key: 'jadwal', label: 'Jadwal', icon: 'calendar', adminPath: '/admin/jadwal', guruPath: '/guru/admin/jadwal' },
  { key: 'struktur-sekolah', label: 'Struktur Sekolah', icon: 'school', adminPath: '/admin/struktur-sekolah', guruPath: '/guru/admin/struktur-sekolah' },
  { key: 'organisasi', label: 'Organisasi', icon: 'users', adminPath: '/admin/organisasi', guruPath: '/guru/admin/organisasi' },
  { key: 'guru', label: 'Guru', icon: 'teacher', adminPath: '/admin/guru', guruPath: '/guru/admin/guru' },
  { key: 'sertifikat', label: 'Sertifikat', icon: 'certificate', adminPath: '/admin/sertifikat', guruPath: '/guru/admin/sertifikat' },
  { key: 'siswa', label: 'Siswa', icon: 'users', adminPath: '/admin/siswa', guruPath: '/guru/admin/siswa' },
  { key: 'scan-kehadiran', label: 'Scan Kehadiran', icon: 'scan', adminPath: '/admin/scan', guruPath: '/guru/admin/scan' },
]

export const ADMIN_FEATURE_BY_KEY = ADMIN_FEATURES.reduce((acc, item) => {
  acc[item.key] = item
  return acc
}, {})

export const ADMIN_FEATURE_BY_GURU_PATH = ADMIN_FEATURES.reduce((acc, item) => {
  acc[item.guruPath] = item
  return acc
}, {})

export const resolveDelegatedAdminFeatureFromPath = (pathname = '') => {
  const normalized = String(pathname || '').split('?')[0].split('#')[0]
  return ADMIN_FEATURES.find((item) => (
    normalized === item.guruPath || normalized.startsWith(`${item.guruPath}/`)
  )) || null
}
