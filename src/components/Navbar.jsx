// src/components/Navbar.jsx
import React, { useState, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/useAuthStore'
import { supabase, PROFILE_BUCKET, getSignedUrlForValue } from '../lib/supabase'
import { formatDateTime } from '../lib/time'

const isHttpUrl = (value = '') => /^https?:\/\//i.test(String(value || ''))

const addCacheBuster = (url) => {
  if (!url) return ''
  const joiner = url.includes('?') ? '&' : '?'
  return `${url}${joiner}t=${Date.now()}`
}

const Navbar = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, profile, logout, isSuperAdmin } = useAuthStore()

  const [settings, setSettings] = useState({})
  const [settingsId, setSettingsId] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState('')
  const [isWaliKelas, setIsWaliKelas] = useState(false)
  const [monitorOpen, setMonitorOpen] = useState(false)
  const [monitorLoading, setMonitorLoading] = useState(false)
  const [monitorData, setMonitorData] = useState({ students: [], teachers: [], generated_at: null })
  const [monitorError, setMonitorError] = useState('')

  // ========== LOAD SETTINGS SEKALI DI AWAL ==========
  useEffect(() => {
    let isCancelled = false

    const loadSettings = async () => {
      try {
        let { data, error } = await supabase
          .from('settings')
          .select('*')
          .order('id', { ascending: true })
          .limit(1)
          .single()

        // PGRST116 = tidak ada row
        if (error && error.code === 'PGRST116') {
          data = null
        } else if (error) {
          throw error
        }

        if (!isCancelled && data) {
          setSettings(data || {})
          setSettingsId(data.id)
        }
      } catch (error) {
        if (!isCancelled) {
          console.error('Error loading settings:', error)
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    loadSettings()

    return () => {
      isCancelled = true
    }
  }, [])

  // ========== REALTIME UPDATE SETTINGS ==========
  useEffect(() => {
    if (!settingsId) return

    const channel = supabase
      .channel('navbar_settings_realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'settings',
          filter: `id=eq.${settingsId}`
        },
        (payload) => {
          const row = payload.new
          if (!row) return

          setSettings(prev => ({
            ...prev,
            ...row
          }))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [settingsId])

  // ========== RESOLVE AVATAR (PATH -> SIGNED URL) ==========
  useEffect(() => {
    let cancelled = false
    const raw = profile?.photo_path || profile?.photo_url || ''

    const resolveAvatar = async () => {
      if (!raw) {
        if (!cancelled) setAvatarUrl('')
        return
      }

      try {
        const signed = await getSignedUrlForValue(PROFILE_BUCKET, raw, 60 * 60)
        if (!cancelled) setAvatarUrl(addCacheBuster(signed))
      } catch (error) {
        if (!cancelled) setAvatarUrl(isHttpUrl(raw) ? addCacheBuster(raw) : '')
      }
    }

    resolveAvatar()
    return () => {
      cancelled = true
    }
  }, [profile?.photo_path, profile?.photo_url, profile?.updated_at])

  // ========== CEK WALI KELAS (UNTUK MENU GURU) ==========
  useEffect(() => {
    let cancelled = false

    const loadWaliKelas = async () => {
      if (profile?.role !== 'guru' || !user?.id) {
        if (!cancelled) setIsWaliKelas(false)
        return
      }

      try {
        const { data, error } = await supabase
          .from('kelas_struktur')
          .select('kelas_id')
          .eq('wali_guru_id', user.id)
          .limit(1)

        if (error) throw error
        if (!cancelled) setIsWaliKelas((data || []).length > 0)
      } catch (error) {
        if (!cancelled) setIsWaliKelas(false)
      }
    }

    loadWaliKelas()
    return () => { cancelled = true }
  }, [profile?.role, user?.id])

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const toggleSidebar = () => {
    setIsCollapsed(prev => !prev)
  }

  const role = profile?.role
  const effectiveRole = isSuperAdmin ? 'admin' : role
  const schoolName = settings?.nama_sekolah || 'Storage'
  const userName = profile?.nama || user?.email?.split('@')[0] || 'User'
  const userInitial = (profile?.nama?.[0] || user?.email?.[0] || 'U').toUpperCase()
  const students = monitorData?.students || []
  const teachers = monitorData?.teachers || []
  const onlineCount =
    students.filter((u) => u.online).length + teachers.filter((u) => u.online).length

  const loadMonitoring = async () => {
    if (effectiveRole !== 'admin') return
    setMonitorLoading(true)
    setMonitorError('')
    try {
      const { data, error } = await supabase.admin.monitoring()
      if (error) throw error
      setMonitorData(data || { students: [], teachers: [], generated_at: null })
    } catch (err) {
      setMonitorError(err?.message || 'Gagal memuat monitoring')
    } finally {
      setMonitorLoading(false)
    }
  }

  useEffect(() => {
    if (!monitorOpen || effectiveRole !== 'admin') return
    loadMonitoring()
    const interval = setInterval(loadMonitoring, 15000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monitorOpen, role])

  useEffect(() => {
    if (effectiveRole !== 'admin') setMonitorOpen(false)
  }, [effectiveRole])

  // Navigation links configuration
  const navigationConfig = {
    siswa: [
      { to: '/siswa/home', label: 'Home', icon: '🏠' },
      { to: '/siswa/absensi', label: 'Absensi', icon: '📅' },
      { to: '/siswa/quiz', label: 'Quiz', icon: '🧠' },
      { to: '/siswa/tugas', label: 'Tugas', icon: '📚' },
      { to: '/siswa/profile', label: 'Profil', icon: '👤' }
    ],
    guru: [
      { to: '/guru/jadwal', label: 'Jadwal', icon: '📅' },
      { to: '/guru/absensi', label: 'Absensi', icon: '✅' },
      { to: '/guru/quiz', label: 'Quiz', icon: '🧠' },
      { to: '/guru/tugas', label: 'Tugas', icon: '📝' },
      { to: '/guru/laporan', label: 'Laporan', icon: '📊' },
      { to: '/guru/profile', label: 'Profil', icon: '👤' }
    ],
    admin: [
      { to: '/admin/home', label: 'Home', icon: '🏠' },
      { to: '/admin/kelas', label: 'Kelas', icon: '🏫' },
      { to: '/admin/scan', label: 'Scan', icon: '📱' },
      { to: '/admin/guru', label: 'Guru', icon: '👨‍🏫' },
      { to: '/admin/siswa', label: 'Siswa', icon: '👨‍🎓' },
      { to: '/admin/sertifikat', label: 'Sertifikat', icon: '📜' },
      { to: '/admin/pengaturan', label: 'Pengaturan', icon: '⚙️' }
    ]
  }

  let navLinks = navigationConfig[effectiveRole] || []
  if (role === 'guru' && isWaliKelas) {
    const siswaLink = { to: '/guru/siswa', label: 'Siswa', icon: '👨‍🎓' }
    const profileIndex = navLinks.findIndex((link) => link.to === '/guru/profile')
    navLinks =
      profileIndex >= 0
        ? [...navLinks.slice(0, profileIndex), siswaLink, ...navLinks.slice(profileIndex)]
        : [...navLinks, siswaLink]
  }
  if (isSuperAdmin) {
    navLinks = [
      ...navLinks,
      { to: '/admin/tenants', label: 'Sekolah', icon: '🏫' },
      { to: '/admin/super-admins', label: 'Super Admin', icon: '🛡️' }
    ]
  }

  // Abstract Logo Component
  const AbstractLogo = ({ size = 'medium' }) => {
    const sizeClasses = {
      small: 'h-8 w-8',
      medium: 'h-9 w-9',
      large: 'h-10 w-10'
    }

    return (
      <div className={`relative ${sizeClasses[size]}`}>
        <div className="absolute inset-0 rounded-full bg-indigo-500" />
        <div className="absolute -top-1 -left-1 h-3 w-3 rounded-full bg-indigo-300" />
        <div className="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full bg-indigo-400" />
      </div>
    )
  }

  // User Avatar Component
  const UserAvatar = ({ size = 'medium', showInfo = true }) => {
    const sizeClasses = {
      small: 'h-8 w-8',
      medium: 'h-9 w-9',
      large: 'h-10 w-10'
    }

    return (
      <div className="flex items-center gap-3">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt="Profile"
            className={`${sizeClasses[size]} rounded-full object-cover border border-slate-200`}
            onError={() => setAvatarUrl('')}
          />
        ) : (
          <div className={`${sizeClasses[size]} rounded-full bg-slate-100 flex items-center justify-center border border-slate-200`}>
            <span className={`${size === 'small' ? 'text-xs' : 'text-sm'} font-semibold text-slate-600`}>
              {userInitial}
            </span>
          </div>
        )}
        {showInfo && !isCollapsed && (
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-slate-900 truncate">
              {userName}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 truncate">
                {user?.email}
              </span>

              {/* Tombol logout kecil (ADMIN ONLY) */}
              {role === 'admin' && (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="text-[10px] px-2 py-0.5 rounded-full border border-red-200 text-red-500 hover:bg-red-50 hover:border-red-300 flex-shrink-0"
                >
                  Logout
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  const showTopProfileCard = role === 'guru' || role === 'siswa'

  const SidebarProfileCard = ({ placement = 'top' }) => (
    <div
      className={`px-3 ${
        placement === 'bottom'
          ? isCollapsed
            ? 'pt-2 pb-3'
            : 'pt-2 pb-4'
          : isCollapsed
            ? 'pt-3 pb-2'
            : 'pt-3 pb-4'
      }`}
    >
      <div
        className={`relative rounded-[24px] border border-slate-100 bg-white shadow-[0_16px_30px_rgba(15,23,42,0.08)] ${
          isCollapsed ? 'p-2.5 flex justify-center' : 'px-3 pb-3 pt-8'
        }`}
      >
        {isCollapsed ? (
          <UserAvatar size="small" showInfo={false} />
        ) : (
          <>
            <div className="absolute left-1/2 -top-8 -translate-x-1/2">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Profile"
                  className="h-16 w-16 rounded-full object-cover border-4 border-white shadow-md"
                  onError={() => setAvatarUrl('')}
                />
              ) : (
                <div className="h-16 w-16 rounded-full bg-slate-200 border-4 border-white shadow-md flex items-center justify-center">
                  <span className="text-base font-semibold text-slate-600">{userInitial}</span>
                </div>
              )}
            </div>

            <button
              type="button"
              className="w-full mt-2 h-10 rounded-2xl border border-slate-200 bg-slate-50/80 px-3 flex items-center justify-between text-slate-700"
              title={userName}
            >
              <span className="text-sm font-semibold truncate">{userName}</span>
              <span className="text-xs text-slate-500">⌄</span>
            </button>
          </>
        )}
      </div>
    </div>
  )

  const MonitoringModal = () => {
    if (!monitorOpen) return null

    const renderRow = (u, showKelas = false) => {
      const multiDevice = (u.active_devices || 0) >= 2
      const lastSeen = u.last_seen_at ? formatDateTime(u.last_seen_at) : 'Belum pernah online'
      return (
        <div
          key={u.id}
          className={`flex items-center justify-between gap-3 p-3 rounded-lg border ${
            multiDevice ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'
          }`}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-900 truncate">{u.nama || u.email || 'Tanpa Nama'}</span>
              {showKelas && u.kelas && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  {u.kelas}
                </span>
              )}
              {multiDevice && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-600 text-white">
                  Multi Device
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {u.online ? 'Online sekarang' : `Offline • Terakhir online: ${lastSeen}`}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div
              className={`text-[10px] px-2 py-1 rounded-full font-semibold ${
                u.online ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {u.online ? 'ONLINE' : 'OFFLINE'}
            </div>
            <div className="text-xs text-slate-600">
              Aktivitas: <span className="font-semibold">{u.activity_count || 0}</span>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
        <div className="bg-white w-full max-w-3xl rounded-2xl shadow-xl border border-slate-200">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Log Monitoring User</h3>
              <p className="text-xs text-slate-500">
                Online: {onlineCount} • Update: {monitorData?.generated_at ? formatDateTime(monitorData.generated_at) : '—'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={loadMonitoring}
                className="text-xs px-3 py-1.5 rounded-full border border-slate-200 hover:bg-slate-50"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={() => setMonitorOpen(false)}
                className="text-sm px-3 py-1.5 rounded-full bg-slate-900 text-white hover:bg-slate-800"
              >
                Tutup
              </button>
            </div>
          </div>

          <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
            {monitorLoading && (
              <div className="text-sm text-slate-500">Memuat data monitoring...</div>
            )}
            {monitorError && (
              <div className="text-sm text-red-600">{monitorError}</div>
            )}

            <div>
              <h4 className="text-sm font-bold text-slate-700 mb-2">Siswa</h4>
              <div className="space-y-2">
                {students.length ? students.map((u) => renderRow(u, true)) : (
                  <div className="text-xs text-slate-500">Tidak ada data siswa.</div>
                )}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-bold text-slate-700 mb-2">Guru</h4>
              <div className="space-y-2">
                {teachers.length ? teachers.map((u) => renderRow(u, false)) : (
                  <div className="text-xs text-slate-500">Tidak ada data guru.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Desktop Sidebar Component
  const DesktopSidebar = () => (
    <aside
      className={`hidden md:flex flex-col h-screen sticky top-0 bg-white border-r border-slate-200 shadow-sm transition-all duration-300 ${
        isCollapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Header */}
      <div className="px-3 pt-5 pb-3 border-b border-slate-100">
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 px-3 py-2.5 shadow-sm">
          <div className="flex items-center gap-3">
            <AbstractLogo />
            {!isCollapsed && (
              <div className="flex flex-col">
                <span className="text-xs font-semibold tracking-wide text-indigo-400 uppercase">
                  {role ? `${role} panel` : 'Panel'}
                </span>
                <span className="text-lg font-semibold text-slate-900 leading-snug truncate">
                  {schoolName}
                </span>
              </div>
            )}
          </div>

          <button
            onClick={toggleSidebar}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            title={isCollapsed ? 'Perlebar sidebar' : 'Perkecil sidebar'}
          >
            {isCollapsed ? '➡️' : '⬅️'}
          </button>
        </div>
      </div>

      {role === 'admin' && (
        <div className={`mt-3 px-4 ${isCollapsed ? 'flex justify-center' : ''}`}>
          <button
            type="button"
            onClick={() => setMonitorOpen(true)}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
              isCollapsed
                ? 'bg-slate-100 text-slate-600'
                : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
            }`}
            title="Monitoring User"
          >
            <span>📡</span>
            {!isCollapsed && <span>Monitoring</span>}
            {!isCollapsed && (
              <span className="ml-1 text-[10px] px-2 py-0.5 rounded-full bg-indigo-600 text-white">
                {onlineCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-2 overflow-y-auto">
        {navLinks.map((link) => {
          const isActive = location.pathname === link.to
          return (
            <Link
              key={link.to}
              to={link.to}
              className={`flex w-full min-h-[48px] items-center rounded-2xl px-4 py-2.5 text-sm font-semibold transition-all ${
                isActive
                  ? 'bg-indigo-500 text-white shadow-[0_10px_25px_rgba(79,70,229,0.35)]'
                  : 'text-slate-600 bg-white border border-slate-200 hover:text-indigo-600 hover:bg-indigo-50 hover:border-indigo-100'
              }`}
              title={isCollapsed ? link.label : ''}
            >
              <span className={`text-lg flex-shrink-0 ${isActive ? 'opacity-100' : 'opacity-80'}`}>
                {link.icon}
              </span>
              {!isCollapsed && <span className="ml-3 truncate">{link.label}</span>}
            </Link>
          )
        })}
      </nav>

      {/* User Info */}
      {showTopProfileCard ? (
        <div className="border-t border-slate-100 bg-white/80">
          <SidebarProfileCard placement="bottom" />
        </div>
      ) : (
        <div className="px-4 py-4 border-t border-slate-100 bg-white/80">
          <UserAvatar showInfo={!isCollapsed} />
        </div>
      )}
    </aside>
  )

  // Mobile Navigation Component
  const MobileNavbar = () => (
    <nav className="md:hidden bg-white border-b border-slate-200 shadow-sm">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo and School Name */}
          <div className="flex items-center gap-3">
            <AbstractLogo size="small" />
            <div className="flex flex-col">
              <span className="text-base font-semibold text-slate-900 leading-tight">
                {schoolName}
              </span>
              {role && (
                <span className="text-xs text-indigo-500 capitalize">
                  {role} panel
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {role === 'admin' && (
              <button
                type="button"
                onClick={() => setMonitorOpen(true)}
                className="flex items-center gap-1 px-2 py-1 rounded-full bg-indigo-50 text-indigo-600 text-xs font-semibold"
                title="Monitoring User"
              >
                📡
                <span>{onlineCount}</span>
              </button>
            )}
            <UserAvatar size="small" showInfo={false} />
          </div>
        </div>

        {/* Navigation Links */}
        <div className="border-t border-slate-200 pt-3 pb-3">
          <div className="flex overflow-x-auto gap-2 pb-1">
            {navLinks.map((link) => {
              const isActive = location.pathname === link.to
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`flex items-center rounded-full px-4 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-indigo-500 text-white shadow-sm'
                      : 'bg-slate-50 text-slate-600 hover:bg-indigo-50 hover:text-indigo-600'
                  }`}
                >
                  <span className="mr-2 text-sm">{link.icon}</span>
                  {link.label}
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </nav>
  )

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-pulse text-slate-400">Memuat...</div>
      </div>
    )
  }

  return (
    <>
      <DesktopSidebar />
      <MobileNavbar />
      <MonitoringModal />
    </>
  )
}

export default Navbar
