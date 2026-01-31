// src/components/Navbar.jsx
import React, { useState, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/useAuthStore'
import { supabase, PROFILE_BUCKET, getSignedUrlForValue } from '../lib/supabase'

const isHttpUrl = (value = '') => /^https?:\/\//i.test(String(value || ''))

const addCacheBuster = (url) => {
  if (!url) return ''
  const joiner = url.includes('?') ? '&' : '?'
  return `${url}${joiner}t=${Date.now()}`
}

const Navbar = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, profile, logout } = useAuthStore()

  const [settings, setSettings] = useState({})
  const [settingsId, setSettingsId] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState('')

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

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const toggleSidebar = () => {
    setIsCollapsed(prev => !prev)
  }

  const role = profile?.role
  const schoolName = settings?.nama_sekolah || 'Storage'
  const userName = profile?.nama || user?.email?.split('@')[0] || 'User'
  const userInitial = (profile?.nama?.[0] || user?.email?.[0] || 'U').toUpperCase()

  // Navigation links configuration
  const navigationConfig = {
    siswa: [
      { to: '/siswa/home', label: 'Home', icon: '🏠' },
      { to: '/siswa/absensi', label: 'Absensi', icon: '📅' },
      { to: '/siswa/tugas', label: 'Tugas', icon: '📚' },
      { to: '/siswa/profile', label: 'Profil', icon: '👤' }
    ],
    guru: [
      { to: '/guru/jadwal', label: 'Jadwal', icon: '📅' },
      { to: '/guru/absensi', label: 'Absensi', icon: '✅' },
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

  const navLinks = navigationConfig[role] || []

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

  // Desktop Sidebar Component
  const DesktopSidebar = () => (
    <aside
      className={`hidden md:flex flex-col h-screen sticky top-0 bg-white border-r border-slate-200 shadow-sm transition-all duration-300 ${
        isCollapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Header */}
      <div className="px-4 pt-6 pb-4 border-b border-slate-100">
        <div className="flex items-center justify-between gap-2">
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

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-2 overflow-y-auto">
        {navLinks.map((link) => {
          const isActive = location.pathname === link.to
          return (
            <Link
              key={link.to}
              to={link.to}
              className={`flex items-center rounded-full px-4 py-2.5 text-sm font-semibold transition-all ${
                isActive
                  ? 'bg-indigo-500 text-white shadow-[0_10px_25px_rgba(79,70,229,0.4)]'
                  : 'text-slate-500 hover:text-indigo-600 hover:bg-indigo-50'
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
      <div className="px-4 py-4 border-t border-slate-100 bg-white/80">
        <UserAvatar showInfo={!isCollapsed} />
      </div>
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

          {/* User Avatar */}
          <UserAvatar size="small" showInfo={false} />
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
    </>
  )
}

export default Navbar
