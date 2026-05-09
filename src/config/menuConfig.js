// src/config/menuConfig.js
// Centralized navigation menu configuration
// Supports flat items and collapsible groups
// Role-based, easily extensible

const menuConfig = {
  siswa: [
    { to: '/siswa/home', label: 'Home', icon: 'home' },
    { to: '/siswa/absensi', label: 'Absensi', icon: 'calendar' },
    { to: '/siswa/quiz', label: 'Quiz', icon: 'brain' },
    { to: '/siswa/tugas', label: 'Tugas', icon: 'book' },
    { to: '/siswa/profile', label: 'Profil', icon: 'user' },
  ],

  guru: [
    { to: '/guru/jadwal', label: 'Jadwal', icon: 'calendar' },
    {
      group: 'Akademik',
      icon: 'book',
      items: [
        { to: '/guru/absensi', label: 'Absensi', icon: 'check' },
        { to: '/guru/quiz', label: 'Quiz', icon: 'brain' },
        { to: '/guru/tugas', label: 'Tugas', icon: 'pencil' },
      ],
    },
    { to: '/guru/laporan', label: 'Laporan', icon: 'chart' },
    { to: '/guru/profile', label: 'Profil', icon: 'user' },
  ],

  admin: [
    { to: '/admin/home', label: 'Dashboard', icon: 'home' },
    {
      group: 'Akademik',
      icon: 'school',
      items: [
        { to: '/admin/kelas', label: 'Kelas & Jadwal', icon: 'school' },
        { to: '/admin/guru', label: 'Guru', icon: 'teacher' },
        { to: '/admin/siswa', label: 'Siswa', icon: 'users' },
      ],
    },
    {
      group: 'Operasional',
      icon: 'check',
      items: [
        { to: '/admin/scan', label: 'Scan Kehadiran', icon: 'scan' },
        { to: '/admin/whatsapp', label: 'WhatsApp', icon: 'chat' },
        { to: '/admin/sertifikat', label: 'Sertifikat', icon: 'certificate' },
        { to: '/admin/approvals', label: 'Approval', icon: 'shield' },
      ],
    },
    {
      group: 'Sistem',
      icon: 'cog',
      items: [
        { to: '/admin/backup', label: 'Backup', icon: 'backup' },
        { to: '/admin/pengaturan', label: 'Pengaturan', icon: 'cog' },
      ],
    },
  ],
}

// Items injected when user is wali kelas (guru role)
export const waliKelasItem = { to: '/guru/siswa', label: 'Siswa', icon: 'users' }

// Items appended for super admin users
export const superAdminGroup = {
  group: 'Super Admin',
  icon: 'shield',
  items: [
    { to: '/admin/tenants', label: 'Sekolah', icon: 'school' },
    { to: '/admin/super-admins', label: 'Super Admin', icon: 'shield' },
    { to: '/admin/audit-trail', label: 'Audit Trail', icon: 'chart' },
    { to: '/admin/plugins', label: 'Plugins', icon: 'cog' },
  ],
}

/**
 * Get all flat route paths from a menu config (for prefetching).
 * Traverses both flat items and group items.
 */
export function getAllRoutePaths(items) {
  const paths = []
  for (const item of items) {
    if (item.to) paths.push(item.to)
    if (item.items) {
      for (const sub of item.items) {
        if (sub.to) paths.push(sub.to)
      }
    }
  }
  return paths
}

export default menuConfig
