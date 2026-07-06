// Central navigation config. Keep this data-only so rendering stays lightweight.

export const menuConfig = {
  siswa: [
    { id: 'siswa-dashboard', to: '/siswa/home', label: 'Dashboard', icon: 'home' },
    {
      id: 'siswa-akademik',
      group: 'Akademik',
      icon: 'book',
      items: [
        { id: 'siswa-absensi', to: '/siswa/absensi', label: 'Absensi', icon: 'calendar' },
        { id: 'siswa-quiz', to: '/siswa/quiz', label: 'Quiz', icon: 'brain' },
        { id: 'siswa-tugas', to: '/siswa/tugas', label: 'Tugas', icon: 'pencil' },
      ],
    },
    { id: 'siswa-profile', to: '/siswa/profile', label: 'Profil', icon: 'user' },
  ],

  guru: [
    {
      id: 'guru-akademik',
      group: 'Akademik',
      icon: 'book',
      items: [
        { id: 'guru-jadwal', to: '/guru/jadwal', label: 'Jadwal', icon: 'calendar' },
        { id: 'guru-absensi', to: '/guru/absensi', label: 'Absensi', icon: 'check' },
        { id: 'guru-quiz', to: '/guru/quiz', label: 'Quiz', icon: 'brain' },
        { id: 'guru-tugas', to: '/guru/tugas', label: 'Tugas', icon: 'pencil' },
        { id: 'guru-laporan', to: '/guru/laporan', label: 'Laporan', icon: 'chart' },
      ],
    },
    { id: 'guru-profile', to: '/guru/profile', label: 'Profil', icon: 'user' },
  ],

  admin: [
    { id: 'admin-dashboard', to: '/admin/home', label: 'Dashboard', icon: 'home' },
    {
      id: 'admin-akademik',
      group: 'Akademik',
      icon: 'school',
      items: [
        { id: 'admin-kelas', to: '/admin/kelas', label: 'Kelas', icon: 'school' },
        { id: 'admin-jadwal', to: '/admin/jadwal', label: 'Jadwal', icon: 'calendar' },
        { id: 'admin-pengaturan-akademik', to: '/admin/pengaturan?menu=academic', label: 'Periode Akademik', icon: 'calendar' },
        { id: 'admin-struktur-sekolah', to: '/admin/struktur-sekolah', label: 'Struktur Sekolah', icon: 'school' },
        { id: 'admin-organisasi', to: '/admin/organisasi', label: 'Organisasi', icon: 'users' },
        { id: 'admin-guru', to: '/admin/guru', label: 'Guru', icon: 'teacher' },
        { id: 'admin-siswa', to: '/admin/siswa', label: 'Siswa', icon: 'users' },
        { id: 'admin-sertifikat', to: '/admin/sertifikat', label: 'Sertifikat', icon: 'certificate' },
      ],
    },
    {
      id: 'admin-absensi',
      group: 'Absensi',
      icon: 'check',
      items: [
        {
          id: 'admin-scan',
          group: 'Scan Kehadiran',
          icon: 'scan',
          items: [
            { id: 'admin-scan-pengaturan', to: '/admin/scan?menu=pengaturan', label: 'Pengaturan Scan', icon: 'cog' },
            { id: 'admin-scan-live', to: '/admin/scan?menu=live-scan', label: 'Live Scan', icon: 'signal' },
            { id: 'admin-scan-riwayat', to: '/admin/scan?menu=riwayat', label: 'Riwayat', icon: 'history' },
          ],
        },
      ],
    },
    {
      id: 'admin-sistem',
      group: 'Sistem',
      icon: 'cog',
      items: [
        { id: 'admin-storage', to: '/admin/storage', label: 'Storage', icon: 'storage' },
        { id: 'admin-backup', to: '/admin/backup', label: 'Backup', icon: 'backup' },
        { id: 'admin-permission-admin', to: '/admin/permission-admin', label: 'Permission Admin', icon: 'shield' },
      ],
    },
    {
      id: 'admin-pengaturan',
      group: 'Pengaturan',
      icon: 'cog',
      items: [
        { id: 'admin-pengaturan-identitas', to: '/admin/pengaturan?menu=identity', label: 'Identitas', icon: 'school' },
        { id: 'admin-pengaturan-akun-admin', to: '/admin/pengaturan?menu=admin', label: 'Akun Admin', icon: 'user' },
      ],
    },
  ],
}

export const waliKelasItem = {
  id: 'guru-wali-kelas',
  group: 'Wali Kelas',
  icon: 'users',
  items: [
    {
      id: 'guru-siswa-wali',
      to: '/guru/siswa',
      label: 'Siswa Wali',
      icon: 'users',
    },
    {
      id: 'guru-rapot-siswa',
      to: '/guru/rapot-siswa',
      label: 'Rapot Siswa',
      icon: 'certificate',
    },
  ],
}

export const legacyWaliKelasItem = {
  id: 'guru-siswa-wali',
  to: '/guru/siswa',
  label: 'Siswa Wali',
  icon: 'users',
}

export const superAdminMonitoringGroup = {
  id: 'super-monitoring-group',
  group: 'Monitoring',
  icon: 'monitor',
  items: [
    { id: 'super-monitoring', to: '/admin/monitoring', label: 'Monitoring', icon: 'signal' },
    { id: 'super-background-job', to: '/admin/background-job', label: 'Background Job', icon: 'queue' },
    { id: 'super-monitoring-server', to: '/admin/monitoring-server', label: 'Monitoring Server', icon: 'monitor' },
    { id: 'super-monitoring-web-vitals', to: '/admin/monitoring-web-vitals', label: 'Performa Halaman', icon: 'gauge' },
    { id: 'super-monitoring-log', to: '/admin/monitoring-log', label: 'Monitor Log', icon: 'terminal' },
    { id: 'super-animasi-flow', to: '/admin/animasi-flow', label: 'Animasi Flow', icon: 'workflow' },
  ],
}

export const superAdminGroup = {
  id: 'super-admin',
  group: 'Super Admin',
  icon: 'shield',
  items: [
    { id: 'super-tenants', to: '/admin/tenants', label: 'Sekolah', icon: 'school' },
    { id: 'super-storage', to: '/admin/storage', label: 'Storage VPS & S3', icon: 'storage' },
    { id: 'super-whatsapp', to: '/admin/whatsapp', label: 'WA Pusat', icon: 'chat' },
    { id: 'super-admins', to: '/admin/super-admins', label: 'Super Admin', icon: 'shield' },
    { id: 'super-audit-trail', to: '/admin/audit-trail', label: 'Audit Trail', icon: 'chart' },
  ],
}

export default menuConfig
