// src/components/Navbar.jsx
import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/useAuthStore'
import { supabase, PROFILE_BUCKET, getSignedUrlForValue } from '../lib/supabase'
import { prefetchRoute, scheduleRoutePrefetch } from '../lib/routePrefetch'
import { formatDateTime } from '../lib/time'

const isHttpUrl = (value = '') => /^https?:\/\//i.test(String(value || ''))
const addCacheBuster = (url) => {
  if (!url) return ''
  const joiner = url.includes('?') ? '&' : '?'
  return `${url}${joiner}t=${Date.now()}`
}

/* ===== SVG Icons ===== */
const Icon = ({ name, className = 'w-5 h-5' }) => {
  const icons = {
    home: <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />,
    calendar: <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />,
    check: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
    brain: <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z" />,
    book: <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />,
    chart: <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />,
    user: <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />,
    school: <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.62 48.62 0 0112 20.904a48.62 48.62 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.636 50.636 0 00-2.658-.813A59.906 59.906 0 0112 3.493a59.903 59.903 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />,
    scan: <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />,
    certificate: <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />,
    backup: <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 2.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125m16.5 5.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />,
    cog: <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />,
    logout: <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />,
    chevronLeft: <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />,
    chevronRight: <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />,
    monitor: <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3" />,
    shield: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />,
    signal: <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />,
    pencil: <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />,
    users: <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />,
    teacher: <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.62 48.62 0 0112 20.904a48.62 48.62 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.636 50.636 0 00-2.658-.813A59.906 59.906 0 0112 3.493a59.903 59.903 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />,
    chat: <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75h6.75m-6.75 3h4.5m7.875-.75c0 4.971-4.533 9-10.125 9a10.98 10.98 0 01-4.664-1.012L3 21l1.15-3.067A8.76 8.76 0 013 12c0-4.971 4.533-9 10.125-9S23.25 7.029 23.25 12z" />,
  }
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
      strokeWidth={1.8} stroke="currentColor" className={className}>
      {icons[name] || null}
    </svg>
  )
}

const NavigationIcon = ({ name, className = 'w-5 h-5' }) => {
  const map = {
    '🏠': 'home', '📅': 'calendar', '✅': 'check', '🧠': 'brain',
    '📚': 'book', '📝': 'pencil', '📊': 'chart', '👤': 'user',
    '🏫': 'school', '📱': 'scan', '👨‍🏫': 'teacher', '👨‍🎓': 'users',
    '📜': 'certificate', '🗄️': 'backup', '⚙️': 'cog', '🛡️': 'shield', '💬': 'chat', '🧩': 'cog',
  }
  return <Icon name={map[name] || 'home'} className={className} />
}

const Navbar = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, profile, settings: authSettings, logout, isSuperAdmin } = useAuthStore()

  const [settings, setSettings] = useState(authSettings || {})
  const [settingsId, setSettingsId] = useState(authSettings?.id || null)
  const [isLoading, setIsLoading] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState('')
  const [isWaliKelas, setIsWaliKelas] = useState(false)
  const [monitorOpen, setMonitorOpen] = useState(false)
  const [monitorLoading, setMonitorLoading] = useState(false)
  const [monitorData, setMonitorData] = useState({ students: [], teachers: [], generated_at: null })
  const [monitorError, setMonitorError] = useState('')

  useEffect(() => {
    let isCancelled = false
    const loadSettings = async () => {
      if (authSettings?.id) {
        setSettings(authSettings || {})
        setSettingsId(authSettings.id)
        setIsLoading(false)
        return
      }

      try {
        let { data, error } = await supabase
          .from('settings')
          .select('id,nama_sekolah,updated_at')
          .order('id', { ascending: true })
          .limit(1)
          .single()
        if (error && error.code === 'PGRST116') { data = null }
        else if (error) { throw error }
        if (!isCancelled && data) { setSettings(data || {}); setSettingsId(data.id) }
      } catch (error) {
        if (!isCancelled) console.error('Error loading settings:', error)
      } finally {
        if (!isCancelled) setIsLoading(false)
      }
    }
    loadSettings()
    return () => { isCancelled = true }
  }, [authSettings])

  useEffect(() => {
    if (!settingsId) return
    const channel = supabase.channel('navbar_settings_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: `id=eq.${settingsId}` },
        (payload) => { const row = payload.new; if (!row) return; setSettings(prev => ({ ...prev, ...row })) })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [settingsId])

  useEffect(() => {
    let cancelled = false
    const raw = profile?.photo_path || profile?.photo_url || ''
    const resolveAvatar = async () => {
      if (!raw) { if (!cancelled) setAvatarUrl(''); return }
      try {
        const signed = await getSignedUrlForValue(PROFILE_BUCKET, raw, 60 * 60)
        if (!cancelled) setAvatarUrl(addCacheBuster(signed))
      } catch { if (!cancelled) setAvatarUrl(isHttpUrl(raw) ? addCacheBuster(raw) : '') }
    }
    resolveAvatar()
    return () => { cancelled = true }
  }, [profile?.photo_path, profile?.photo_url, profile?.updated_at])

  useEffect(() => {
    let cancelled = false
    const loadWaliKelas = async () => {
      if (profile?.role !== 'guru' || !user?.id) { if (!cancelled) setIsWaliKelas(false); return }
      try {
        const { data, error } = await supabase.from('kelas_struktur').select('kelas_id').eq('wali_guru_id', user.id).limit(1)
        if (error) throw error
        if (!cancelled) setIsWaliKelas((data || []).length > 0)
      } catch { if (!cancelled) setIsWaliKelas(false) }
    }
    loadWaliKelas()
    return () => { cancelled = true }
  }, [profile?.role, user?.id])

  const handleLogout = async () => { await logout(); navigate('/login') }
  const toggleSidebar = () => setIsCollapsed(prev => !prev)

  const role = profile?.role
  const effectiveRole = isSuperAdmin ? 'admin' : role
  const schoolName = settings?.nama_sekolah || 'EduSmart'
  const userName = profile?.nama || user?.email?.split('@')[0] || 'User'
  const userInitial = (profile?.nama?.[0] || user?.email?.[0] || 'U').toUpperCase()
  const students = monitorData?.students || []
  const teachers = monitorData?.teachers || []
  const onlineCount = students.filter(u => u.online).length + teachers.filter(u => u.online).length

  const loadMonitoring = async () => {
    if (effectiveRole !== 'admin') return
    setMonitorLoading(true); setMonitorError('')
    try {
      const { data, error } = await supabase.admin.monitoring()
      if (error) throw error
      setMonitorData(data || { students: [], teachers: [], generated_at: null })
    } catch (err) { setMonitorError(err?.message || 'Gagal memuat monitoring') }
    finally { setMonitorLoading(false) }
  }

  useEffect(() => {
    if (!monitorOpen || effectiveRole !== 'admin') return
    loadMonitoring()
    const interval = setInterval(loadMonitoring, 15000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monitorOpen, role])

  useEffect(() => { if (effectiveRole !== 'admin') setMonitorOpen(false) }, [effectiveRole])

  const navigationConfig = useMemo(
    () => ({
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
        { to: '/admin/home', label: 'Dashboard', icon: '🏠' },
        { to: '/admin/kelas', label: 'Kelas', icon: '🏫' },
        { to: '/admin/scan', label: 'Scan', icon: '📱' },
        { to: '/admin/guru', label: 'Guru', icon: '👨‍🏫' },
        { to: '/admin/siswa', label: 'Siswa', icon: '👨‍🎓' },
        { to: '/admin/whatsapp', label: 'WhatsApp', icon: '💬' },
        { to: '/admin/sertifikat', label: 'Sertifikat', icon: '📜' },
        { to: '/admin/backup', label: 'Backup', icon: '🗄️' },
        { to: '/admin/approvals', label: 'Approval', icon: '🛡️' },
        { to: '/admin/pengaturan', label: 'Pengaturan', icon: '⚙️' }
      ]
    }),
    []
  )

  const navLinks = useMemo(() => {
    let links = navigationConfig[effectiveRole] || []

    if (role === 'guru' && isWaliKelas) {
      const siswaLink = { to: '/guru/siswa', label: 'Siswa', icon: '👨‍🎓' }
      const profileIndex = links.findIndex((link) => link.to === '/guru/profile')
      links = profileIndex >= 0
        ? [...links.slice(0, profileIndex), siswaLink, ...links.slice(profileIndex)]
        : [...links, siswaLink]
    }

    if (isSuperAdmin) {
      links = [
        ...links,
        { to: '/admin/tenants', label: 'Sekolah', icon: '🏫' },
        { to: '/admin/super-admins', label: 'Super Admin', icon: '🛡️' },
        { to: '/admin/audit-trail', label: 'Audit Trail', icon: '📊' },
        { to: '/admin/plugins', label: 'Plugins', icon: '🧩' }
      ]
    }

    return links
  }, [effectiveRole, isSuperAdmin, isWaliKelas, navigationConfig, role])

  useEffect(() => {
    const nextRoutes = navLinks
      .map((link) => link.to)
      .filter((to) => !(location.pathname === to || location.pathname.startsWith(`${to}/`)))

    return scheduleRoutePrefetch(nextRoutes, {
      max: 1,
      delay: 1800,
      timeout: 3000
    })
  }, [effectiveRole, location.pathname, navLinks])

  /* ---- Role badge color ---- */
  const roleBadge = {
    admin: { bg: 'bg-violet-100', text: 'text-violet-700', label: 'Admin' },
    guru: { bg: 'bg-sky-100', text: 'text-sky-700', label: 'Guru' },
    siswa: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Siswa' },
  }
  const rb = roleBadge[role] || { bg: 'bg-slate-100', text: 'text-slate-600', label: role || 'User' }

  /* ---- Avatar ---- */
  const AvatarImg = ({ size = 40, className = '' }) => (
    avatarUrl
      ? <img src={avatarUrl} alt="Avatar" onError={() => setAvatarUrl('')}
        className={`rounded-full object-cover ${className}`}
        style={{ width: size, height: size }} />
      : <div className={`rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center font-bold text-white ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.38 }}>
        {userInitial}
      </div>
  )

  /* ---- NavLink item ---- */
  const NavItem = ({ link, collapsed }) => {
    const isActive = location.pathname === link.to || location.pathname.startsWith(link.to + '/')
    const handlePrefetch = () => {
      void prefetchRoute(link.to)
    }

    return (
      <Link
        to={link.to}
        title={collapsed ? link.label : undefined}
        onMouseEnter={handlePrefetch}
        onFocus={handlePrefetch}
        onTouchStart={handlePrefetch}
        className={`
          group relative flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-[15px] font-semibold
          transition-all duration-200 select-none
          ${isActive
            ? 'bg-brand-600 text-white shadow-brand-sm'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }
          ${collapsed ? 'justify-center' : ''}
        `}
      >
        <span className={`flex-shrink-0 transition-transform duration-200 group-hover:scale-110 ${isActive ? 'text-white' : 'text-slate-500 group-hover:text-brand-600'}`}>
          <NavigationIcon name={link.icon} className="w-4.5 h-4.5" />
        </span>
        {!collapsed && <span className="truncate">{link.label}</span>}
        {isActive && !collapsed && (
          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0" />
        )}
        {collapsed && (
          <div className="absolute left-full ml-2 px-2.5 py-1.5 bg-slate-900 text-white text-xs rounded-lg whitespace-nowrap
            opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-150 z-50 shadow-lg">
            {link.label}
          </div>
        )}
      </Link>
    )
  }

  /* ===== Monitoring Modal ===== */
  const MonitoringModal = () => {
    if (!monitorOpen) return null
    const renderRow = (u, showKelas = false) => {
      const multiDevice = (u.active_devices || 0) >= 2
      const lastSeen = u.last_seen_at ? formatDateTime(u.last_seen_at) : 'Belum pernah online'
      return (
        <div key={u.id} className={`flex items-center justify-between gap-3 p-3 rounded-xl border text-sm ${multiDevice ? 'border-red-200 bg-red-50' : 'border-slate-100 bg-white'}`}>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-800 truncate">{u.nama || u.email || 'Tanpa Nama'}</span>
              {showKelas && u.kelas && <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{u.kelas}</span>}
              {multiDevice && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-600 text-white font-semibold">Multi Device</span>}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">{u.online ? 'Online sekarang' : `Offline · ${lastSeen}`}</div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold ${u.online ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {u.online ? 'ONLINE' : 'OFFLINE'}
            </span>
            <span className="text-xs text-slate-500">Aktivitas: <strong>{u.activity_count || 0}</strong></span>
          </div>
        </div>
      )
    }

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 animate-fade-in">
        <div className="bg-white w-full max-w-2xl rounded-2xl shadow-[var(--shadow-popup)] border border-slate-100 overflow-hidden animate-scale-in">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <span className="p-1.5 bg-brand-100 rounded-lg text-brand-600"><Icon name="monitor" className="w-4 h-4" /></span>
                Monitoring User
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Online: <strong>{onlineCount}</strong> · Update: {monitorData?.generated_at ? formatDateTime(monitorData.generated_at) : '—'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={loadMonitoring} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors font-medium">Refresh</button>
              <button onClick={() => setMonitorOpen(false)} className="text-xs px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors font-medium">Tutup</button>
            </div>
          </div>
          <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto bg-slate-50/50">
            {monitorLoading && <p className="text-sm text-slate-500 text-center py-4">Memuat data monitoring...</p>}
            {monitorError && <p className="text-sm text-red-500">{monitorError}</p>}
            <div>
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Siswa ({students.length})</h4>
              <div className="space-y-2">{students.length ? students.map(u => renderRow(u, true)) : <p className="text-xs text-slate-400">Tidak ada data siswa.</p>}</div>
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Guru ({teachers.length})</h4>
              <div className="space-y-2">{teachers.length ? teachers.map(u => renderRow(u, false)) : <p className="text-xs text-slate-400">Tidak ada data guru.</p>}</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  /* ===== Desktop Sidebar ===== */
  const DesktopSidebar = () => (
    <>
      <div className={`hidden md:block flex-shrink-0 transition-all duration-300 ease-in-out ${isCollapsed ? 'w-[64px]' : 'w-52'}`} />

      <aside className={`hidden md:flex fixed inset-y-0 left-0 flex-col min-h-0 z-40 bg-white border-r border-slate-100 shadow-sidebar transition-all duration-300 ease-in-out ${isCollapsed ? 'w-[64px]' : 'w-52'}`}>
        {/* Header */}
        <div className="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-slate-100">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-brand-sm flex-shrink-0">
            <span className="font-extrabold text-white text-[15px]">{schoolName.charAt(0).toUpperCase()}</span>
          </div>
          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-brand-600 uppercase tracking-[0.16em] leading-none mb-1">{rb.label} Panel</p>
              <p className="text-[16px] font-extrabold text-slate-900 truncate leading-tight">{schoolName}</p>
            </div>
          )}
          <button onClick={toggleSidebar}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all duration-200 ml-auto flex-shrink-0"
            title={isCollapsed ? 'Perlebar sidebar' : 'Perkecil sidebar'}>
            {isCollapsed ? <Icon name="chevronRight" className="w-3.5 h-3.5" /> : <Icon name="chevronLeft" className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Monitor button (admin) */}
        {effectiveRole === 'admin' && (
          <div className={`px-3 pt-3 ${isCollapsed ? 'flex justify-center' : ''}`}>
            <button onClick={() => setMonitorOpen(true)} title="Monitoring User"
              className={`flex items-center gap-2 text-[10px] font-semibold rounded-xl transition-all duration-200
              ${isCollapsed ? 'p-2 bg-brand-50 text-brand-600 hover:bg-brand-100' : 'w-full px-2.5 py-2 bg-brand-50 text-brand-700 hover:bg-brand-100'}`}>
              <Icon name="signal" className="w-3 h-3 flex-shrink-0" />
              {!isCollapsed && (
                <>
                  <span>Monitoring</span>
                  <span className="ml-auto min-w-[20px] text-center px-1.5 py-0.5 rounded-full bg-brand-600 text-white text-[10px] font-bold">{onlineCount}</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Nav links */}
        <nav className="flex-1 min-h-0 px-3 py-3 space-y-1 overflow-y-auto overflow-x-hidden">
          {navLinks.map(link => <NavItem key={link.to} link={link} collapsed={isCollapsed} />)}
        </nav>

        {/* User info / Logout */}
        <div className={`border-t border-slate-100 ${isCollapsed ? 'p-3' : 'p-3'}`}>
          {isCollapsed ? (
            <div className="flex flex-col items-center gap-2">
              <AvatarImg size={32} />
              <button onClick={handleLogout} title="Keluar"
                className="p-2 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all duration-200">
                <Icon name="logout" className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <AvatarImg size={32} className="flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-slate-800 truncate leading-tight">{userName}</p>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${rb.bg} ${rb.text}`}>{rb.label}</span>
              </div>
              <button onClick={handleLogout} title="Keluar"
                className="p-2 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all duration-200 flex-shrink-0">
                <Icon name="logout" className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  )

  /* ===== Mobile Top Bar + Bottom Nav ===== */
  const MobileNav = () => (
    <>
      {/* Top Bar */}
      <div className="md:hidden sticky top-0 z-30 glass border-b border-slate-100 shadow-navbar">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0">
              <span className="font-extrabold text-white text-xs">{schoolName.charAt(0).toUpperCase()}</span>
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900 leading-tight">{schoolName}</p>
              <p className="text-[10px] text-brand-600 font-semibold uppercase tracking-wide">{rb.label}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {effectiveRole === 'admin' && (
              <button onClick={() => setMonitorOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-brand-50 text-brand-700 text-xs font-bold">
                <Icon name="signal" className="w-3.5 h-3.5" />
                <span>{onlineCount}</span>
              </button>
            )}
            <AvatarImg size={32} />
          </div>
        </div>
      </div>

      {/* Bottom Tab Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 glass border-t border-slate-100 shadow-navbar">
        <div className="flex items-center justify-around px-1 py-1.5 safe-area-inset-bottom">
          {navLinks.slice(0, 5).map(link => {
            const isActive = location.pathname === link.to || location.pathname.startsWith(link.to + '/')
            const handlePrefetch = () => {
              void prefetchRoute(link.to)
            }
            return (
              <Link key={link.to} to={link.to}
                onMouseEnter={handlePrefetch}
                onFocus={handlePrefetch}
                onTouchStart={handlePrefetch}
                className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all duration-200 min-w-0 flex-1
                  ${isActive ? 'text-brand-600' : 'text-slate-500 hover:text-slate-700'}`}>
                <span className={`transition-all duration-200 ${isActive ? 'scale-110' : ''}`}>
                  <NavigationIcon name={link.icon} className="w-[18px] h-[18px]" />
                </span>
                <span className="text-[10px] font-semibold truncate">{link.label}</span>
                {isActive && <span className="w-1 h-1 rounded-full bg-brand-600 mt-0.5" />}
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )

  if (isLoading) {
    return (
      <div className="hidden md:flex flex-col h-screen sticky top-0 w-56 bg-white border-r border-slate-100">
        <div className="animate-pulse p-4">
          <div className="h-8 bg-slate-100 rounded-xl mb-4" />
          <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-8 bg-slate-100 rounded-xl" />)}</div>
        </div>
      </div>
    )
  }

  return (
    <>
      <DesktopSidebar />
      <MobileNav />
      <MonitoringModal />
    </>
  )
}

export default Navbar
