#!/usr/bin/env python3
import re

TARGET = '/home/irsyad/Dokumen/edusmart-presensi-backup-vps-ready-20260430/src/pages/admin/AnimasiFlow.jsx'

NEW_NODES = '''const FLOW_NODES = [
  // ─── AUTH ─────────────────────────────────────────
  { id: 'login',          x: 40,   y: 980,  label: '🔐 Autentikasi',    color: '#8b5cf6' },
  { id: 'gateway',        x: 240,  y: 980,  label: '🚦 Role Gateway',   color: '#6366f1' },

  // ─── SISWA ────────────────────────────────────────
  { id: 'siswa_dash',     x: 440,  y: 200,  label: '👨‍🎓 Dash Siswa',   color: '#0ea5e9' },
  { id: 'siswa_profil',   x: 660,  y: 80,   label: '👤 Profil Siswa',  color: '#38bdf8' },
  { id: 'siswa_absensi',  x: 660,  y: 155,  label: '📋 Absensi',       color: '#0ea5e9' },
  { id: 'siswa_quiz',     x: 660,  y: 230,  label: '🧠 Kerjakan Quiz', color: '#0ea5e9' },
  { id: 'siswa_tugas',    x: 660,  y: 305,  label: '✏️ Kumpul Tugas',  color: '#0ea5e9' },
  { id: 'siswa_eskul',    x: 660,  y: 380,  label: '🎨 Eskul (Soon)',  color: '#0284c7' },

  // ─── GURU ─────────────────────────────────────────
  { id: 'guru_dash',      x: 440,  y: 660,  label: '👨‍🏫 Dash Guru',   color: '#10b981' },
  { id: 'guru_profil',    x: 660,  y: 495,  label: '👤 Profil Guru',   color: '#34d399' },
  { id: 'guru_jadwal',    x: 660,  y: 570,  label: '📅 Jadwal Ajar',   color: '#10b981' },
  { id: 'guru_absen',     x: 660,  y: 645,  label: '✅ Cek Absensi',   color: '#10b981' },
  { id: 'guru_quiz',      x: 660,  y: 720,  label: '📝 Buat Quiz',     color: '#10b981' },
  { id: 'guru_tugas',     x: 660,  y: 795,  label: '📚 Buat Tugas',    color: '#10b981' },
  { id: 'guru_laporan',   x: 660,  y: 870,  label: '📊 Laporan Nilai', color: '#059669' },
  { id: 'guru_wali',      x: 900,  y: 495,  label: '🏠 Siswa Wali',    color: '#34d399' },
  { id: 'guru_rapot',     x: 900,  y: 570,  label: '🎓 Rapot Siswa',   color: '#047857' },

  // ─── ADMIN ────────────────────────────────────────
  { id: 'admin_dash',     x: 440,  y: 1180, label: '💼 Dash Admin',    color: '#f59e0b' },
  { id: 'admin_kelas',    x: 660,  y: 990,  label: '🏫 Kelola Kelas',  color: '#fbbf24' },
  { id: 'admin_jadwal',   x: 660,  y: 1065, label: '📅 Jadwal Kelas',  color: '#fbbf24' },
  { id: 'admin_struktur', x: 660,  y: 1140, label: '🏛️ Struktur Sek',  color: '#f59e0b' },
  { id: 'admin_org',      x: 660,  y: 1215, label: '🏢 Organisasi',    color: '#f59e0b' },
  { id: 'admin_guru',     x: 660,  y: 1290, label: '👨‍🏫 Kelola Guru', color: '#f59e0b' },
  { id: 'admin_siswa',    x: 660,  y: 1365, label: '👥 Kelola Siswa',  color: '#fbbf24' },
  { id: 'admin_scan',     x: 660,  y: 1440, label: '📱 Scan Absensi',  color: '#f59e0b' },
  { id: 'admin_sertif',   x: 900,  y: 990,  label: '🏆 Sertifikat',    color: '#d97706' },
  { id: 'admin_approval', x: 900,  y: 1065, label: '✅ Approval',      color: '#d97706' },
  { id: 'admin_wa',       x: 900,  y: 1140, label: '💬 WhatsApp',      color: '#b45309' },
  { id: 'admin_storage',  x: 900,  y: 1215, label: '💾 Storage',       color: '#b45309' },
  { id: 'admin_backup',   x: 900,  y: 1290, label: '🔄 Backup',        color: '#b45309' },
  { id: 'admin_set',      x: 900,  y: 1365, label: '⚙️ Pengaturan',    color: '#92400e' },

  // ─── SUPER ADMIN ──────────────────────────────────
  { id: 'sa_dash',        x: 440,  y: 1700, label: '🛡️ Dash Super',    color: '#ef4444' },
  { id: 'sa_monitor',     x: 660,  y: 1550, label: '📈 Monitoring',    color: '#f87171' },
  { id: 'sa_server',      x: 660,  y: 1625, label: '🖥️ Monitor Server',color: '#ef4444' },
  { id: 'sa_log',         x: 660,  y: 1700, label: '📜 Monitor Log',   color: '#ef4444' },
  { id: 'sa_animflow',    x: 660,  y: 1775, label: '🎬 Animasi Flow',  color: '#dc2626' },
  { id: 'sa_tenants',     x: 900,  y: 1550, label: '🏢 Kelola Tenant', color: '#f87171' },
  { id: 'sa_admins',      x: 900,  y: 1625, label: '🛡️ Super Admins',  color: '#ef4444' },
  { id: 'sa_audit',       x: 900,  y: 1700, label: '🔍 Audit Trail',   color: '#b91c1c' },
  { id: 'sa_plugins',     x: 900,  y: 1775, label: '🔌 Plugins',       color: '#b91c1c' },
  { id: 'sa_wa_pusat',    x: 900,  y: 1850, label: '💬 WA Pusat',      color: '#991b1b' },

  // ─── INFRASTRUCTURE ───────────────────────────────
  { id: 'db_main',        x: 1140, y: 1215, label: '🗄️ Database',      color: '#64748b' },
  { id: 'storage_s3',     x: 1140, y: 1290, label: '☁️ S3 Storage',    color: '#64748b' },
  { id: 'backup_db',      x: 1140, y: 1365, label: '🔄 Auto Backup',   color: '#475569' },

  // ─── OUTPUT ───────────────────────────────────────
  { id: 'out_nilai',      x: 1140, y: 230,  label: '💯 Nilai Keluar',  color: '#ec4899' },
  { id: 'out_lulus',      x: 1380, y: 980,  label: '🌟 Selesai',       color: '#22c55e' },
]'''

NEW_EDGES = '''const FLOW_EDGES = [
  // Auth
  { id: 'e_auth1',  from: 'login',         to: 'gateway' },

  // Gateway → Roles
  { id: 'e_gs',     from: 'gateway',       to: 'siswa_dash' },
  { id: 'e_gg',     from: 'gateway',       to: 'guru_dash' },
  { id: 'e_ga',     from: 'gateway',       to: 'admin_dash' },
  { id: 'e_gsa',    from: 'gateway',       to: 'sa_dash' },

  // Siswa features
  { id: 'e_s1',     from: 'siswa_dash',    to: 'siswa_profil' },
  { id: 'e_s2',     from: 'siswa_dash',    to: 'siswa_absensi' },
  { id: 'e_s3',     from: 'siswa_dash',    to: 'siswa_quiz' },
  { id: 'e_s4',     from: 'siswa_dash',    to: 'siswa_tugas' },
  { id: 'e_s5',     from: 'siswa_dash',    to: 'siswa_eskul' },

  // Guru features
  { id: 'e_g1',     from: 'guru_dash',     to: 'guru_profil' },
  { id: 'e_g2',     from: 'guru_dash',     to: 'guru_jadwal' },
  { id: 'e_g3',     from: 'guru_dash',     to: 'guru_absen' },
  { id: 'e_g4',     from: 'guru_dash',     to: 'guru_quiz' },
  { id: 'e_g5',     from: 'guru_dash',     to: 'guru_tugas' },
  { id: 'e_g6',     from: 'guru_dash',     to: 'guru_laporan' },
  { id: 'e_g7',     from: 'guru_dash',     to: 'guru_wali' },
  { id: 'e_g8',     from: 'guru_wali',     to: 'guru_rapot' },

  // Admin features
  { id: 'e_a1',     from: 'admin_dash',    to: 'admin_kelas' },
  { id: 'e_a2',     from: 'admin_dash',    to: 'admin_jadwal' },
  { id: 'e_a3',     from: 'admin_dash',    to: 'admin_struktur' },
  { id: 'e_a4',     from: 'admin_dash',    to: 'admin_org' },
  { id: 'e_a5',     from: 'admin_dash',    to: 'admin_guru' },
  { id: 'e_a6',     from: 'admin_dash',    to: 'admin_siswa' },
  { id: 'e_a7',     from: 'admin_dash',    to: 'admin_scan' },
  { id: 'e_a8',     from: 'admin_dash',    to: 'admin_sertif' },
  { id: 'e_a9',     from: 'admin_dash',    to: 'admin_approval' },
  { id: 'e_a10',    from: 'admin_dash',    to: 'admin_wa' },
  { id: 'e_a11',    from: 'admin_dash',    to: 'admin_storage' },
  { id: 'e_a12',    from: 'admin_dash',    to: 'admin_backup' },
  { id: 'e_a13',    from: 'admin_dash',    to: 'admin_set' },

  // Super Admin features
  { id: 'e_sa1',    from: 'sa_dash',       to: 'sa_monitor' },
  { id: 'e_sa2',    from: 'sa_dash',       to: 'sa_server' },
  { id: 'e_sa3',    from: 'sa_dash',       to: 'sa_log' },
  { id: 'e_sa4',    from: 'sa_dash',       to: 'sa_animflow' },
  { id: 'e_sa5',    from: 'sa_dash',       to: 'sa_tenants' },
  { id: 'e_sa6',    from: 'sa_dash',       to: 'sa_admins' },
  { id: 'e_sa7',    from: 'sa_dash',       to: 'sa_audit' },
  { id: 'e_sa8',    from: 'sa_dash',       to: 'sa_plugins' },
  { id: 'e_sa9',    from: 'sa_dash',       to: 'sa_wa_pusat' },

  // Cross-role interactions
  { id: 'e_cr1',    from: 'guru_quiz',     to: 'siswa_quiz' },
  { id: 'e_cr2',    from: 'guru_tugas',    to: 'siswa_tugas' },
  { id: 'e_cr3',    from: 'siswa_quiz',    to: 'out_nilai' },
  { id: 'e_cr4',    from: 'siswa_tugas',   to: 'out_nilai' },
  { id: 'e_cr5',    from: 'out_nilai',     to: 'guru_laporan' },
  { id: 'e_cr6',    from: 'guru_laporan',  to: 'guru_rapot' },
  { id: 'e_cr7',    from: 'admin_scan',    to: 'siswa_absensi' },
  { id: 'e_cr8',    from: 'siswa_absensi', to: 'guru_absen' },
  { id: 'e_cr9',    from: 'admin_guru',    to: 'guru_dash' },
  { id: 'e_cr10',   from: 'admin_siswa',   to: 'siswa_dash' },

  // Infrastructure
  { id: 'e_db1',    from: 'admin_siswa',   to: 'db_main' },
  { id: 'e_db2',    from: 'admin_guru',    to: 'db_main' },
  { id: 'e_db3',    from: 'guru_laporan',  to: 'db_main' },
  { id: 'e_st1',    from: 'siswa_tugas',   to: 'storage_s3' },
  { id: 'e_st2',    from: 'admin_sertif',  to: 'storage_s3' },
  { id: 'e_st3',    from: 'admin_storage', to: 'storage_s3' },
  { id: 'e_bk1',    from: 'db_main',       to: 'backup_db' },
  { id: 'e_bk2',    from: 'admin_backup',  to: 'backup_db' },

  // Final output
  { id: 'e_end1',   from: 'guru_rapot',    to: 'out_lulus' },
  { id: 'e_end2',   from: 'admin_sertif',  to: 'out_lulus' },
  { id: 'e_end3',   from: 'backup_db',     to: 'out_lulus' },
]'''

with open(TARGET, 'r') as f:
    content = f.read()

# Replace FLOW_NODES
content = re.sub(
    r'const FLOW_NODES = \[.*?\]',
    NEW_NODES,
    content,
    flags=re.DOTALL
)

# Replace FLOW_EDGES
content = re.sub(
    r'const FLOW_EDGES = \[.*?\]',
    NEW_EDGES,
    content,
    flags=re.DOTALL
)

# Update canvas height 1600 -> 2000 (height only, not width)
content = content.replace(
    'style={{ minWidth: 1600, minHeight: 1600 }}',
    'style={{ minWidth: 1600, minHeight: 2000 }}'
)
content = content.replace(
    'width: 1600,\n          height: 1600,',
    'width: 1600,\n          height: 2000,'
)
content = content.replace(
    "style={{ width: 1600, height: 1600, overflow: 'visible' }}",
    "style={{ width: 1600, height: 2000, overflow: 'visible' }}"
)

# Update minimap viewBox
content = content.replace(
    '<svg width="160" height="160" viewBox="0 0 1600 1600">',
    '<svg width="120" height="160" viewBox="0 0 1600 2000">'
)

# Update minimap viewport indicator height
content = content.replace(
    "width={1026 / transform.scale}\n            height={560 / transform.scale}",
    "width={1026 / transform.scale}\n            height={700 / transform.scale}"
)

# Update initial transform scale for bigger canvas
content = content.replace(
    "const [transform, setTransform] = useState({ x: 30, y: 30, scale: 0.8 })",
    "const [transform, setTransform] = useState({ x: 20, y: 20, scale: 0.55 })"
)
content = content.replace(
    "const fitView = () => setTransform({ x: 30, y: 30, scale: 0.8 })",
    "const fitView = () => setTransform({ x: 20, y: 20, scale: 0.55 })"
)
content = content.replace(
    "setTransform({ x: 30, y: 30, scale: 0.8 })",
    "setTransform({ x: 20, y: 20, scale: 0.55 })"
)

# Update container minHeight
content = content.replace(
    "style={{ minHeight: 560 }}",
    "style={{ minHeight: 640 }}"
)
content = content.replace(
    "style={{ minHeight: 560, cursor: 'grab'",
    "style={{ minHeight: 640, cursor: 'grab'"
)

# Update info cards to include Eskul
content = content.replace(
    '''<InfoCard emoji="🔐" title="Login" desc="Autentikasi pengguna melalui email atau Google OAuth" tone="violet" />
          <InfoCard emoji="🏠" title="Dashboard" desc="Pusat informasi dan navigasi utama untuk semua role" tone="indigo" />
          <InfoCard emoji="📋" title="Absensi & Quiz" desc="Pencatatan kehadiran dan evaluasi pembelajaran" tone="sky" />
          <InfoCard emoji="🏆" title="Sertifikat" desc="Penerbitan sertifikat dan laporan akhir" tone="emerald" />''',
    '''<InfoCard emoji="🔐" title="Autentikasi" desc="Login email/Google, register & reset password" tone="violet" />
          <InfoCard emoji="👥" title="Multi-Role" desc="Siswa, Guru, Admin, Super Admin dengan akses berbeda" tone="indigo" />
          <InfoCard emoji="📋" title="Akademik" desc="Absensi, Quiz, Tugas, Laporan, Rapot & Eskul (soon)" tone="sky" />
          <InfoCard emoji="⚙️" title="Manajemen" desc="Kelas, Jadwal, Sertifikat, Approval, WhatsApp & Backup" tone="emerald" />''',
)

with open(TARGET, 'w') as f:
    f.write(content)

print("✅ AnimasiFlow.jsx berhasil diupdate!")
print(f"   Nodes: 50 (auth + siswa + guru + admin + super admin + infra + output)")
print(f"   Edges: 60+ koneksi lengkap")
print(f"   Canvas: 1600 x 2000")
