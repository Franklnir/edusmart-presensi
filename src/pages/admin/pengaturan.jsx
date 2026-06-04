import React, { useEffect, useState, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Cloud,
  Database,
  ExternalLink,
  FileText,
  FolderOpen,
  HardDrive,
  Link2,
  RefreshCw,
  Search,
  Server,
  Share2,
  ShieldCheck,
  School,
  Unplug,
  UserCog,
  Users,
  XCircle
} from 'lucide-react'
import { CURRENT_TENANT_SLUG, supabase, PROFILE_BUCKET, getSignedUrlForValue } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import FileDropzone from '../../components/FileDropzone'
import GoogleCredentialButton from '../../components/GoogleCredentialButton'
import { sanitizeText, sanitizeUrl } from '../../utils/sanitize'
import { completeGoogleLinkOAuthFlow } from '../../utils/googleLinking'
import {
  getCurrentAcademicPeriod,
  generateAcademicYearOptions,
  normalizeAcademicYear,
  normalizeSemester,
  resolveAcademicPeriod,
  SEMESTER_GENAP,
  SEMESTER_GANJIL,
  toMonthInputValue
} from '../../utils/academicPeriod'
import { SCHEDULE_SCOPE_YEAR } from '../../utils/schedulePeriodScope'

const SUPABASE_BUCKET = 'profile-photos'
const LOGO_FILE_PATH = 'logo_sekolah.png'
const TENANT_LOGO_FILE_PATH = CURRENT_TENANT_SLUG
  ? `logos/${CURRENT_TENANT_SLUG}/logo_sekolah.jpg`
  : LOGO_FILE_PATH
const SETTINGS_SELECT_COLUMNS = [
  'id',
  'nama_sekolah',
  'email',
  'telepon',
  'alamat',
  'logo_url',
  'visi',
  'misi',
  'link_instagram',
  'link_facebook',
  'link_youtube',
  'link_tiktok',
  'registrasi_siswa_aktif',
  'registrasi_guru_aktif',
  'registrasi_admin_aktif',
  'max_ekskul_per_siswa',
  'tahun_ajaran',
  'semester_aktif',
  'periode_mulai',
  'periode_selesai',
  'periode_ganjil_mulai',
  'periode_ganjil_selesai',
  'periode_genap_mulai',
  'periode_genap_selesai',
  'jadwal_periode_berlaku'
].join(',')
const SETTINGS_QUERY_KEY = ['admin', 'settings', 'system']
const SETTINGS_STALE_TIME = 5 * 60 * 1000
const SETTINGS_SESSION_CACHE_KEY = 'edusmart_settings_cache:system'
const normalizeEskulLimit = (value) => Math.max(1, Math.min(99, Number.parseInt(value, 10) || 3))

function getSettingsStorage() {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage || null
  } catch {
    return null
  }
}

function readCachedSettingsRow() {
  const storage = getSettingsStorage()
  if (!storage) return null

  try {
    const parsed = JSON.parse(storage.getItem(SETTINGS_SESSION_CACHE_KEY) || 'null')
    if (!parsed?.data || Number(parsed.expiresAt || 0) <= Date.now()) {
      storage.removeItem(SETTINGS_SESSION_CACHE_KEY)
      return null
    }
    return parsed.data
  } catch {
    storage.removeItem(SETTINGS_SESSION_CACHE_KEY)
    return null
  }
}

function writeCachedSettingsRow(data) {
  const storage = getSettingsStorage()
  if (!storage || !data) return

  try {
    storage.setItem(SETTINGS_SESSION_CACHE_KEY, JSON.stringify({
      data,
      expiresAt: Date.now() + SETTINGS_STALE_TIME
    }))
  } catch {
    // ignore storage quota/private mode failures
  }
}

function clearCachedSettingsRow() {
  const storage = getSettingsStorage()
  if (!storage) return

  try {
    storage.removeItem(SETTINGS_SESSION_CACHE_KEY)
  } catch {
    // ignore
  }
}

const SIGNED_URL_EXPIRES_IN = 60 * 60 * 24 * 7

const formatBytesLabel = (bytes) => {
  const value = Number(bytes || 0)
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let idx = 0
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024
    idx += 1
  }
  const precision = idx === 0 ? 0 : 2
  return `${Number(size.toFixed(precision)).toLocaleString('id-ID')} ${units[idx]}`
}

const formatDateTimeLabel = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

const DRIVE_FILE_BUCKET_OPTIONS = [
  { value: 'all', label: 'Semua modul' },
  { value: 'assignments', label: 'Tugas' },
  { value: 'quiz-media', label: 'Quiz' }
]

const SETTINGS_MENU_IDS = new Set([
  'identity',
  'academic',
  'drive',
  'admin',
  'registration'
])

const resolveSettingsMenuFromSearch = (search = '') => {
  const params = new URLSearchParams(search || '')
  const menu = String(params.get('menu') || '').trim()
  return SETTINGS_MENU_IDS.has(menu) ? menu : 'identity'
}

const DRIVE_STATUS_DEFAULT = {
  provider_configured: false,
  configured: false,
  ready: false,
  status: 'disconnected',
  status_label: 'Belum tersambung',
  quota: { used_label: '0 B', limit_label: 'Tidak terbatas', percent: null },
  today: { uploaded_label: '0 B', files: 0 },
  app_storage: { uploaded_label: '0 B', files: 0 }
}

const resolvePeriodForm = (row = {}) => {
  const resolved = resolveAcademicPeriod(row)
  const ganjilDefault = resolveAcademicPeriod({
    tahun_ajaran: resolved.tahunAjaran,
    semester_aktif: SEMESTER_GANJIL
  })
  const genapDefault = resolveAcademicPeriod({
    tahun_ajaran: resolved.tahunAjaran,
    semester_aktif: SEMESTER_GENAP
  })

  const activeStart = resolved.periodeMulai || resolved.startsAt
  const activeEnd = resolved.periodeSelesai || resolved.endsAt
  const periodeGanjilMulai =
    resolved.periodeGanjilMulai ||
    (resolved.semester === SEMESTER_GANJIL ? activeStart : ganjilDefault.startsAt)
  const periodeGanjilSelesai =
    resolved.periodeGanjilSelesai ||
    (resolved.semester === SEMESTER_GANJIL ? activeEnd : ganjilDefault.endsAt)
  const periodeGenapMulai =
    resolved.periodeGenapMulai ||
    (resolved.semester === SEMESTER_GENAP ? activeStart : genapDefault.startsAt)
  const periodeGenapSelesai =
    resolved.periodeGenapSelesai ||
    (resolved.semester === SEMESTER_GENAP ? activeEnd : genapDefault.endsAt)

  return {
    tahunAjaran: resolved.tahunAjaran,
    semester: resolved.semester,
    periodeMulai: resolved.semester === SEMESTER_GANJIL ? periodeGanjilMulai : periodeGenapMulai,
    periodeSelesai: resolved.semester === SEMESTER_GANJIL ? periodeGanjilSelesai : periodeGenapSelesai,
    periodeGanjilMulai,
    periodeGanjilSelesai,
    periodeGenapMulai,
    periodeGenapSelesai,
    jadwalPeriodeBerlaku: SCHEDULE_SCOPE_YEAR
  }
}

const getActiveRangeFromPeriodForm = (form = {}) => {
  const semester = normalizeSemester(form.semester) || SEMESTER_GANJIL
  if (semester === SEMESTER_GENAP) {
    return {
      startsAt: form.periodeGenapMulai || '',
      endsAt: form.periodeGenapSelesai || ''
    }
  }

  return {
    startsAt: form.periodeGanjilMulai || '',
    endsAt: form.periodeGanjilSelesai || ''
  }
}

const getAcademicYearRangeFromPeriodForm = (form = {}) => ({
  startsAt: form.periodeGanjilMulai || '',
  endsAt: form.periodeGenapSelesai || ''
})

const resolveOperationalSemesterFromForm = (form = {}) => {
  const tahunAjaran = normalizeAcademicYear(form.tahunAjaran)
  const current = getCurrentAcademicPeriod()
  if (tahunAjaran && tahunAjaran === current.tahunAjaran) return current.semester
  return normalizeSemester(form.semester) || SEMESTER_GANJIL
}

const buildPeriodPayloadFromForm = (form = {}) => {
  const tahunAjaran = normalizeAcademicYear(form.tahunAjaran)
  const semester = resolveOperationalSemesterFromForm(form)
  const academicYearRange = getAcademicYearRangeFromPeriodForm(form)

  return {
    tahun_ajaran: tahunAjaran,
    semester_aktif: semester,
    periode_mulai: academicYearRange.startsAt,
    periode_selesai: academicYearRange.endsAt,
    periode_ganjil_mulai: form.periodeGanjilMulai || '',
    periode_ganjil_selesai: form.periodeGanjilSelesai || '',
    periode_genap_mulai: form.periodeGenapMulai || '',
    periode_genap_selesai: form.periodeGenapSelesai || '',
    jadwal_periode_berlaku: SCHEDULE_SCOPE_YEAR
  }
}

const periodPayloadChanged = (nextPayload, previousPayload) => [
  'tahun_ajaran',
  'semester_aktif',
  'periode_mulai',
  'periode_selesai',
  'periode_ganjil_mulai',
  'periode_ganjil_selesai',
  'periode_genap_mulai',
  'periode_genap_selesai',
  'jadwal_periode_berlaku'
].some((key) => String(nextPayload?.[key] || '') !== String(previousPayload?.[key] || ''))


function extractObjectKeyFromMaybeUrl(value, bucket) {
  if (!value || typeof value !== 'string') return ''

  // Kalau sudah path biasa
  if (!value.startsWith('http://') && !value.startsWith('https://')) {
    // kadang orang simpen "bucket/path", kita normalize jadi hanya "path"
    const prefix1 = `${bucket}/`
    if (value.startsWith(prefix1)) return value.slice(prefix1.length)
    return value
  }

  try {
    const u = new URL(value)
    const pathname = decodeURIComponent(u.pathname || '')

    // Bentuk umum Supabase Storage:
    // /storage/v1/object/public/<bucket>/<path>
    // /storage/v1/object/sign/<bucket>/<path>
    const publicNeedle = `/storage/v1/object/public/${bucket}/`
    const signNeedle = `/storage/v1/object/sign/${bucket}/`

    const idxPublic = pathname.indexOf(publicNeedle)
    if (idxPublic >= 0) {
      return pathname.slice(idxPublic + publicNeedle.length)
    }

    const idxSign = pathname.indexOf(signNeedle)
    if (idxSign >= 0) {
      return pathname.slice(idxSign + signNeedle.length)
    }

    // Fallback: coba cari "/<bucket>/" terakhir
    const bucketNeedle = `/${bucket}/`
    const idxBucket = pathname.lastIndexOf(bucketNeedle)
    if (idxBucket >= 0) {
      return pathname.slice(idxBucket + bucketNeedle.length)
    }

    // Kalau gagal parse, balikin string as-is (lebih aman daripada ngerusak data)
    return value
  } catch {
    return value
  }
}

function makeRandomId() {
  // Browser modern: crypto.randomUUID()
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function createSignedUrlSafe(bucket, objectKey, expiresIn = SIGNED_URL_EXPIRES_IN) {
  if (!bucket || !objectKey) return ''
  const signedUrl = await getSignedUrlForValue(bucket, objectKey, expiresIn)
  if (!signedUrl) return ''
  const joiner = signedUrl.includes('?') ? '&' : '?'
  return `${signedUrl}${joiner}t=${Date.now()}`
}

function PasswordModal({ isOpen, onClose, onConfirm, title = 'Konfirmasi Password', loading = false }) {
  const [password, setPassword] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (password.trim()) onConfirm(password)
  }

  const handleClose = () => {
    setPassword('')
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4">
        <h3 className="text-lg font-bold text-gray-900 mb-2">{title}</h3>
        <p className="text-gray-600 text-sm mb-4">Untuk melanjutkan, masukkan password akun Anda:</p>

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-4"
            placeholder="Masukkan password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
          />

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors duration-200"
              onClick={handleClose}
              disabled={loading}
            >
              Batal
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading || !password.trim()}
            >
              {loading ? 'Memverifikasi...' : 'Konfirmasi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const verifyPassword = async (password) => {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('User tidak ditemukan')

  const { error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password
  })

  if (error) throw new Error('Password salah')
  return true
}

async function fetchSettingsRow() {
  let { data, error } = await supabase
    .from('settings')
    .select(SETTINGS_SELECT_COLUMNS)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (data) {
    writeCachedSettingsRow(data)
    return data
  }

  const { data: inserted, error: insertError } = await supabase
    .from('settings')
    .insert({})
    .select(SETTINGS_SELECT_COLUMNS)
    .single()

  if (insertError) throw insertError
  writeCachedSettingsRow(inserted)
  return inserted
}

const compressImage = (file, maxSizeKB = 300) => {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = (event) => {
        const img = new Image()
        img.src = event.target.result
        img.onload = () => {
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d')

          const MAX_WIDTH = 1200
          const MAX_HEIGHT = 1200
          let { width, height } = img

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width
              width = MAX_WIDTH
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height
              height = MAX_HEIGHT
            }
          }

          canvas.width = width
          canvas.height = height
          ctx.drawImage(img, 0, 0, width, height)

          let quality = 0.8
          let compressedDataUrl

          const attemptCompression = () => {
            compressedDataUrl = canvas.toDataURL('image/jpeg', quality)
            const base64 = compressedDataUrl.split(',')[1]
            const binaryString = atob(base64)
            const sizeInBytes = binaryString.length
            const sizeInKB = sizeInBytes / 1024

            if (sizeInKB > maxSizeKB && quality > 0.3) {
              quality -= 0.1
              attemptCompression()
            } else {
              const byteString = atob(compressedDataUrl.split(',')[1])
              const mimeString = compressedDataUrl.split(',')[0].split(':')[1].split(';')[0]
              const ab = new ArrayBuffer(byteString.length)
              const ia = new Uint8Array(ab)

              for (let i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i)
              }

              const blob = new Blob([ab], { type: mimeString })
              const compressedFile = new File([blob], file.name, {
                type: 'image/jpeg',
                lastModified: Date.now()
              })

              resolve(compressedFile)
            }
          }

          attemptCompression()
        }
      }
      reader.onerror = (err) => reject(err)
    } catch (err) {
      reject(err)
    }
  })
}

export default function APengaturan() {
  const location = useLocation()
  const navigate = useNavigate()
  const { pushToast, requestConfirmation } = useUIStore()
  const { user, profile, logout, refreshProfile, linkGoogleCredential, refreshAuthSession, markGoogleLinked } = useAuthStore()

  const [isAuthorized, setIsAuthorized] = useState(true)
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [passwordLoading, setPasswordLoading] = useState(false)

  const [form, setForm] = useState({
    nama_sekolah: '',
    email: '',
    telepon: '',
    alamat: '',
    logo_url: '',
    visi: '',
    misi: '',
    link_instagram: '',
    link_facebook: '',
    link_youtube: '',
    link_tiktok: '',
    registrasi_siswa_aktif: true,
    registrasi_guru_aktif: false,
    registrasi_admin_aktif: false,
    max_ekskul_per_siswa: 3
  })

  const [avatarPath, setAvatarPath] = useState('')
  const [avatarSignedUrl, setAvatarSignedUrl] = useState('')
  const [logoSignedUrl, setLogoSignedUrl] = useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [linkingGoogle, setLinkingGoogle] = useState(false)
  const [unlinkingGoogle, setUnlinkingGoogle] = useState(false)
  const [driveStatus, setDriveStatus] = useState(DRIVE_STATUS_DEFAULT)
  const [driveLoading, setDriveLoading] = useState(false)
  const [driveConnecting, setDriveConnecting] = useState(false)
  const [driveSyncing, setDriveSyncing] = useState(false)
  const [driveDisconnecting, setDriveDisconnecting] = useState(false)
  const [drivePeriodFilter, setDrivePeriodFilter] = useState(() => {
    const current = resolveAcademicPeriod()
    return {
      tahunAjaran: current.tahunAjaran,
      semester: ''
    }
  })
  const [driveFiles, setDriveFiles] = useState([])
  const [driveFilesMeta, setDriveFilesMeta] = useState({ total: 0, limit: 50 })
  const [driveFilesLoading, setDriveFilesLoading] = useState(false)
  const [driveFileBucket, setDriveFileBucket] = useState('all')
  const [driveFileSearch, setDriveFileSearch] = useState('')
  const [activeSettingsMenu, setActiveSettingsMenu] = useState(() => (
    typeof window !== 'undefined'
      ? resolveSettingsMenuFromSearch(window.location.search)
      : 'identity'
  ))
  const [selectedLogoFile, setSelectedLogoFile] = useState(null)
  const [settingsId, setSettingsId] = useState(null)
  const [periodForm, setPeriodForm] = useState(() => resolvePeriodForm())
  const [persistedPeriodForm, setPersistedPeriodForm] = useState(() => resolvePeriodForm())
  const [savingPeriod, setSavingPeriod] = useState(false)
  const [carryEskulMembers, setCarryEskulMembers] = useState(false)

  const autoSaveTimerRef = useRef(null)
  const initialLoadDoneRef = useRef(false)
  const lastSaveTimestampRef = useRef('')

  const handlePasswordConfirm = async (password) => {
    setPasswordLoading(true)
    try {
      await verifyPassword(password)
      setIsAuthorized(true)
      setPasswordModalOpen(false)
      pushToast('success', 'Akses diizinkan. Selamat datang di Pengaturan Sistem.')
    } catch (error) {
      pushToast('error', error.message || 'Password salah')
    } finally {
      setPasswordLoading(false)
    }
  }

  const handlePasswordClose = () => {
    setPasswordModalOpen(false)
  }

  useEffect(() => {
    const nextMenu = resolveSettingsMenuFromSearch(location.search)
    if (nextMenu === 'drive') {
      const params = new URLSearchParams(location.search)
      params.set('tab', 'drive')
      params.delete('menu')
      navigate(`/admin/storage?${params.toString()}`, { replace: true })
      return
    }
    setActiveSettingsMenu((current) => (current === nextMenu ? current : nextMenu))
  }, [location.search, navigate])

  const handleSettingsMenuChange = (menuId) => {
    if (!SETTINGS_MENU_IDS.has(menuId)) return
    if (menuId === 'drive') {
      navigate('/admin/storage?tab=drive')
      return
    }

    setActiveSettingsMenu(menuId)

    const params = new URLSearchParams(location.search)
    params.set('menu', menuId)

    const nextSearch = params.toString()
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : ''
      },
      { replace: true }
    )
  }

  useEffect(() => {
    if (typeof window === 'undefined') return

    const url = new URL(window.location.href)
    const googleError = String(url.searchParams.get('google_error') || '').trim()
    const driveState = String(url.searchParams.get('drive') || '').trim()
    const driveError = String(url.searchParams.get('drive_error') || '').trim()
    if (!googleError && !driveState && !driveError) return

    if (googleError) pushToast('error', googleError)
    if (driveState === 'connected') pushToast('success', 'Google Drive sekolah berhasil tersambung.')
    if (driveState === 'failed') pushToast('error', driveError || 'Gagal menyambungkan Google Drive sekolah.')
    url.searchParams.delete('google')
    url.searchParams.delete('google_error')
    url.searchParams.delete('drive')
    url.searchParams.delete('drive_error')
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`)
  }, [pushToast])

  useEffect(() => {
    if (!profile || !isAuthorized) return

    const raw = profile.photo_path || profile.photo_url || profile.avatar || profile.foto || ''
    const extracted = extractObjectKeyFromMaybeUrl(raw, SUPABASE_BUCKET)
    setAvatarPath(extracted)

    if (typeof window !== 'undefined' && user?.id) {
      const newKey = `user_avatar_path_${user.id}`
      if (!localStorage.getItem(newKey)) {
        const oldVal = localStorage.getItem(`user_avatar_${user.id}`)
        if (oldVal) {
          const extracted = extractObjectKeyFromMaybeUrl(oldVal, SUPABASE_BUCKET)
          if (extracted) localStorage.setItem(newKey, extracted)
        }
      }
    }
  }, [profile, isAuthorized, user?.id])


  useEffect(() => {
    if (!isAuthorized || activeSettingsMenu !== 'admin') return
    let cancelled = false

    async function refresh() {
      try {
        if (!avatarPath) {
          if (!cancelled) setAvatarSignedUrl('')
          return
        }
        const signed = await createSignedUrlSafe(SUPABASE_BUCKET, avatarPath)
        if (!cancelled) setAvatarSignedUrl(signed)
      } catch {
        if (!cancelled) setAvatarSignedUrl('')
      }
    }

    refresh()
    return () => { cancelled = true }
  }, [activeSettingsMenu, avatarPath, isAuthorized])


  useEffect(() => {
    if (!isAuthorized || activeSettingsMenu !== 'identity') return
    let cancelled = false

    async function refresh() {
      try {
        const logoPath = form.logo_url
        if (!logoPath) {
          if (!cancelled) setLogoSignedUrl('')
          return
        }
        const signed = await createSignedUrlSafe(SUPABASE_BUCKET, logoPath)
        if (!cancelled) setLogoSignedUrl(signed)
      } catch {
        if (!cancelled) setLogoSignedUrl('')
      }
    }

    refresh()
    return () => { cancelled = true }
  }, [activeSettingsMenu, form.logo_url, isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return

    let isCancelled = false

    const applySettingsRow = (data) => {
      if (!data) return

      setSettingsId(data.id)

      const logoPath = extractObjectKeyFromMaybeUrl(data.logo_url || '', SUPABASE_BUCKET)

      setForm((prev) => ({
        ...prev,
        nama_sekolah: data.nama_sekolah || '',
        email: data.email || '',
        telepon: data.telepon || '',
        alamat: data.alamat || '',
        logo_url: logoPath || '',
        visi: data.visi || '',
        misi: data.misi || '',
        link_instagram: data.link_instagram || '',
        link_facebook: data.link_facebook || '',
        link_youtube: data.link_youtube || '',
        link_tiktok: data.link_tiktok || '',
        registrasi_siswa_aktif: data.registrasi_siswa_aktif ?? true,
        registrasi_guru_aktif: data.registrasi_guru_aktif ?? false,
        registrasi_admin_aktif: data.registrasi_admin_aktif ?? false,
        max_ekskul_per_siswa: normalizeEskulLimit(data.max_ekskul_per_siswa)
      }))

      const nextPeriodForm = resolvePeriodForm(data)
      setPeriodForm(nextPeriodForm)
      setPersistedPeriodForm(nextPeriodForm)
      setDrivePeriodFilter({
        tahunAjaran: nextPeriodForm.tahunAjaran,
        semester: ''
      })
    }

    async function loadSettings() {
      const cachedSettings = queryClient.getQueryData(SETTINGS_QUERY_KEY) || readCachedSettingsRow()
      if (cachedSettings && !isCancelled) {
        queryClient.setQueryData(SETTINGS_QUERY_KEY, cachedSettings)
        applySettingsRow(cachedSettings)
      }

      setLoading(!cachedSettings)
      try {
        const data = await queryClient.fetchQuery({
          queryKey: SETTINGS_QUERY_KEY,
          queryFn: fetchSettingsRow,
          staleTime: SETTINGS_STALE_TIME,
        })

        if (!isCancelled && data) {
          setSettingsId(data.id)

          const logoPath = extractObjectKeyFromMaybeUrl(data.logo_url || '', SUPABASE_BUCKET)

          setForm((prev) => ({
            ...prev,
            nama_sekolah: data.nama_sekolah || '',
            email: data.email || '',
            telepon: data.telepon || '',
            alamat: data.alamat || '',
            logo_url: logoPath || '',
            visi: data.visi || '',
            misi: data.misi || '',
            link_instagram: data.link_instagram || '',
            link_facebook: data.link_facebook || '',
            link_youtube: data.link_youtube || '',
            link_tiktok: data.link_tiktok || '',
            registrasi_siswa_aktif: data.registrasi_siswa_aktif ?? true,
            registrasi_guru_aktif: data.registrasi_guru_aktif ?? false,
            registrasi_admin_aktif: data.registrasi_admin_aktif ?? false,
            max_ekskul_per_siswa: normalizeEskulLimit(data.max_ekskul_per_siswa)
          }))
          const nextPeriodForm = resolvePeriodForm(data)
          setPeriodForm(nextPeriodForm)
          setPersistedPeriodForm(nextPeriodForm)
          setDrivePeriodFilter({
            tahunAjaran: nextPeriodForm.tahunAjaran,
            semester: ''
          })
        }
      } catch (err) {
        if (!isCancelled) pushToast('error', 'Gagal memuat pengaturan: ' + err.message)
      } finally {
        if (!isCancelled) {
          setLoading(false)
          setTimeout(() => { initialLoadDoneRef.current = true }, 1000)
        }
      }
    }

    loadSettings()

    return () => {
      isCancelled = true
    }
  }, [activeSettingsMenu, pushToast, isAuthorized])

  useEffect(() => {
    if (!isAuthorized || activeSettingsMenu !== 'drive') return

    let isCancelled = false

    async function loadDriveStatus() {
      setDriveLoading(true)
      try {
        const { data, error } = await supabase.admin.googleDrive({
          tahun_ajaran: drivePeriodFilter.tahunAjaran
        })
        if (error) throw error
        if (!isCancelled) {
          setDriveStatus(data || DRIVE_STATUS_DEFAULT)
        }
      } catch (error) {
        if (!isCancelled) {
          setDriveStatus(DRIVE_STATUS_DEFAULT)
          pushToast('error', error?.message || 'Gagal memuat status Google Drive sekolah')
        }
      } finally {
        if (!isCancelled) setDriveLoading(false)
      }
    }

    loadDriveStatus()

    return () => {
      isCancelled = true
    }
  }, [activeSettingsMenu, drivePeriodFilter.tahunAjaran, isAuthorized, pushToast])

  useEffect(() => {
    if (!isAuthorized || activeSettingsMenu !== 'drive') return

    let isCancelled = false

    async function loadDriveFiles() {
      setDriveFilesLoading(true)
      try {
        const params = {
          tahun_ajaran: drivePeriodFilter.tahunAjaran,
          limit: 50
        }
        if (driveFileBucket !== 'all') {
          params.bucket = driveFileBucket
        }

        const { data, error } = await supabase.admin.googleDriveFiles(params)
        if (error) throw error

        if (!isCancelled) {
          setDriveFiles(Array.isArray(data?.rows) ? data.rows : [])
          setDriveFilesMeta({
            total: Number(data?.total || 0),
            limit: Number(data?.limit || 50)
          })
        }
      } catch (error) {
        if (!isCancelled) {
          setDriveFiles([])
          setDriveFilesMeta({ total: 0, limit: 50 })
          pushToast('error', error?.message || 'Gagal memuat inventaris file Google Drive')
        }
      } finally {
        if (!isCancelled) setDriveFilesLoading(false)
      }
    }

    loadDriveFiles()

    return () => {
      isCancelled = true
    }
  }, [activeSettingsMenu, driveFileBucket, drivePeriodFilter.tahunAjaran, isAuthorized, pushToast])

  useEffect(() => {
    if (!settingsId || !isAuthorized) return

    const channel = supabase
      .channel('pengaturan_realtime')
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

          if (autoSaveTimerRef.current) return
          const rowUpdatedAt = String(row.updated_at || '')
          if (lastSaveTimestampRef.current && rowUpdatedAt === lastSaveTimestampRef.current) return

          const logoPath = extractObjectKeyFromMaybeUrl(row.logo_url || '', SUPABASE_BUCKET)

          setForm((prev) => ({
            ...prev,
            nama_sekolah: row.nama_sekolah || '',
            email: row.email || '',
            telepon: row.telepon || '',
            alamat: row.alamat || '',
            logo_url: logoPath || '',
            visi: row.visi || '',
            misi: row.misi || '',
            link_instagram: row.link_instagram || '',
            link_facebook: row.link_facebook || '',
            link_youtube: row.link_youtube || '',
            link_tiktok: row.link_tiktok || '',
            registrasi_siswa_aktif: row.registrasi_siswa_aktif ?? true,
            registrasi_guru_aktif: row.registrasi_guru_aktif ?? false,
            registrasi_admin_aktif: row.registrasi_admin_aktif ?? false,
            max_ekskul_per_siswa: normalizeEskulLimit(row.max_ekskul_per_siswa)
          }))
          const nextPeriodForm = resolvePeriodForm(row)
          setPeriodForm(nextPeriodForm)
          setPersistedPeriodForm(nextPeriodForm)
          setDrivePeriodFilter({
            tahunAjaran: nextPeriodForm.tahunAjaran,
            semester: ''
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [settingsId, isAuthorized])

  function handleChange(e) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  function handlePeriodChange(e) {
    const { name, value } = e.target

    if (name === 'tahunAjaran') {
      const nextYear = normalizeAcademicYear(value) || value
      if (nextYear === persistedPeriodForm.tahunAjaran) {
        setCarryEskulMembers(false)
      }
    }

    setPeriodForm((prev) => {
      if (name === 'tahunAjaran') {
        const nextYear = normalizeAcademicYear(value) || value
        const calendarPeriod = getCurrentAcademicPeriod()
        const nextSemester = nextYear === calendarPeriod.tahunAjaran
          ? calendarPeriod.semester
          : SEMESTER_GANJIL
        const ganjil = resolveAcademicPeriod({
          tahun_ajaran: nextYear,
          semester_aktif: SEMESTER_GANJIL
        })
        const genap = resolveAcademicPeriod({
          tahun_ajaran: nextYear,
          semester_aktif: SEMESTER_GENAP
        })
        const activeRange = nextSemester === SEMESTER_GENAP ? genap : ganjil

        return {
          ...prev,
          tahunAjaran: nextYear,
          semester: nextSemester,
          periodeGanjilMulai: ganjil.startsAt,
          periodeGanjilSelesai: ganjil.endsAt,
          periodeGenapMulai: genap.startsAt,
          periodeGenapSelesai: genap.endsAt,
          periodeMulai: activeRange.startsAt,
          periodeSelesai: activeRange.endsAt
        }
      }

      if (name === 'semester') {
        const nextSemester = normalizeSemester(value) || value
        const next = { ...prev, semester: nextSemester }
        const activeRange = getActiveRangeFromPeriodForm(next)
        return {
          ...next,
          periodeMulai: activeRange.startsAt,
          periodeSelesai: activeRange.endsAt
        }
      }

      if (
        name === 'periodeGanjilMulai' ||
        name === 'periodeGanjilSelesai' ||
        name === 'periodeGenapMulai' ||
        name === 'periodeGenapSelesai'
      ) {
        const next = { ...prev, [name]: value ? `${value}-01` : '' }
        const activeRange = getActiveRangeFromPeriodForm(next)
        return {
          ...next,
          periodeMulai: activeRange.startsAt,
          periodeSelesai: activeRange.endsAt
        }
      }

      return { ...prev, [name]: value }
    })
  }

  function handleUseCurrentPeriod() {
    const current = getCurrentAcademicPeriod()
    setCarryEskulMembers(false)
    setPeriodForm(resolvePeriodForm({
      tahun_ajaran: current.tahunAjaran,
      semester_aktif: current.semester
    }))
  }

  async function saveAcademicPeriod() {
    if (!isAuthorized) return

    const nextPayload = buildPeriodPayloadFromForm(periodForm)
    const previousPayload = buildPeriodPayloadFromForm(persistedPeriodForm)
    const tahunAjaran = nextPayload.tahun_ajaran
    const semester = nextPayload.semester_aktif
    const semesterPreview = resolveAcademicPeriod(nextPayload)
    const ganjilPreview = resolveAcademicPeriod({
      ...nextPayload,
      semester_aktif: SEMESTER_GANJIL
    })
    const genapPreview = resolveAcademicPeriod({
      ...nextPayload,
      semester_aktif: SEMESTER_GENAP
    })
    const academicYearRange = {
      startsAt: ganjilPreview.startsAt,
      endsAt: genapPreview.endsAt
    }

    if (!tahunAjaran || !semester) {
      pushToast('error', 'Tahun ajaran atau semester belum valid.')
      return
    }
    if (!ganjilPreview.startsAt || !ganjilPreview.endsAt || !ganjilPreview.customRange) {
      pushToast('error', 'Rentang bulan semester Ganjil belum valid.')
      return
    }
    if (!genapPreview.startsAt || !genapPreview.endsAt || !genapPreview.customRange) {
      pushToast('error', 'Rentang bulan semester Genap belum valid.')
      return
    }
    if (!semesterPreview.startsAt || !semesterPreview.endsAt || !semesterPreview.customRange) {
      pushToast('error', 'Rentang bulan periode belum valid.')
      return
    }
    if (!academicYearRange.startsAt || !academicYearRange.endsAt) {
      pushToast('error', 'Rentang tahun ajaran penuh belum valid.')
      return
    }

    if (!periodPayloadChanged(nextPayload, previousPayload)) {
      pushToast('info', 'Belum ada perubahan periode akademik yang perlu disimpan.')
      return
    }

    const previousStartYear = Number(String(previousPayload.tahun_ajaran || '').slice(0, 4))
    const targetStartYear = Number(String(nextPayload.tahun_ajaran || '').slice(0, 4))
    const yearChanged = nextPayload.tahun_ajaran !== previousPayload.tahun_ajaran
    const yearMovesForwardOneStep = yearChanged && targetStartYear === previousStartYear + 1
    const yearMovesBackward = yearChanged && targetStartYear < previousStartYear

    if (yearChanged) {
      const confirmedYear = yearMovesForwardOneStep
        ? await requestConfirmation({
            title: 'Ubah tahun ajaran aktif?',
            message: `Periode tahun ajaran akan berubah dari ${previousPayload.tahun_ajaran || '-'} ke ${nextPayload.tahun_ajaran}.`,
            confirmText: 'Ya, rollover otomatis',
            cancelText: 'Batal',
            tone: 'warning',
            details: [
              'Sistem akan menaikkan siswa aktif satu tingkat: X ke XI, XI ke XII, dan XII menjadi alumni.',
              'Metadata kelas aktif, filter tugas, absensi, jadwal, laporan, rekap, dan storage akan mengikuti periode baru.',
              carryEskulMembers
                ? 'Anggota eskul aktif akan disalin sebagai keanggotaan baru pada periode target.'
                : 'Anggota eskul tidak disalin otomatis; keanggotaan periode baru bisa diatur manual.'
            ]
          })
        : await requestConfirmation({
            title: yearMovesBackward ? 'Koreksi periode aktif?' : 'Tahun ajaran tidak berurutan',
            message: yearMovesBackward
              ? `Periode aktif akan dikoreksi dari ${previousPayload.tahun_ajaran || '-'} ke ${nextPayload.tahun_ajaran}.`
              : `Periode aktif akan berubah dari ${previousPayload.tahun_ajaran || '-'} ke ${nextPayload.tahun_ajaran}.`,
            confirmText: yearMovesBackward ? 'Ya, koreksi periode' : 'Cek ke server',
            cancelText: 'Batal',
            tone: 'warning',
            details: [
              'Koreksi kalender aktif tidak membalik otomatis riwayat kelas siswa.',
              'Backend tetap mengecek kalender server Asia/Jakarta sebelum perubahan disimpan.',
              'Data periode lama sebaiknya dibuka lewat Mode Arsip, bukan dengan menurunkan periode aktif.'
            ]
          })
      if (!confirmedYear) return

      if (yearMovesForwardOneStep) {
        const hasRetainedStudents = await requestConfirmation({
          title: 'Ada siswa yang tidak naik kelas?',
          message: 'Jika ada siswa yang tetap di kelas asal, simpan siswa tersebut sebagai pengecualian sebelum tahun ajaran baru diaktifkan.',
          confirmText: 'Ada, pilih pengecualian',
          cancelText: 'Tidak ada',
          tone: 'info'
        })
        if (hasRetainedStudents) {
          const openPromotion = await requestConfirmation({
            title: 'Buka Pengecualian Rollover?',
            message: 'Anda akan diarahkan ke Kelas & Jadwal untuk memilih siswa yang tidak ikut rollover otomatis.',
            confirmText: 'Buka Pengecualian',
            cancelText: 'Tetap di sini',
            tone: 'info'
          })
          if (openPromotion) {
            window.location.assign('/admin/kelas?openPromotion=1')
          }
          pushToast('warning', 'Simpan daftar siswa pengecualian dulu sebelum mengaktifkan tahun ajaran baru.', {
            title: 'Pengecualian rollover diperlukan',
            duration: 8000
          })
          return
        }
      }
    } else {
      const confirmedPeriod = await requestConfirmation({
        title: 'Simpan perubahan kalender?',
        message: 'Data aktif akan memakai satu tahun ajaran penuh, mencakup Ganjil dan Genap.',
        confirmText: 'Ya, simpan periode',
        cancelText: 'Batal',
        tone: 'warning',
        details: [
          'Perubahan rentang bulan tidak memindahkan kelas, tidak memfilter data global, dan tidak membuat riwayat kelas baru.',
          'Jadwal berlaku untuk 1 tahun ajaran penuh.',
          'Halaman tugas, quiz, laporan, absensi, dan storage tetap berada dalam satu tahun ajaran kecuali fiturnya memakai filter sendiri.',
          `Cakupan aktif setelah disimpan: ${tahunAjaran} penuh.`
        ]
      })
      if (!confirmedPeriod) return
    }

    setSavingPeriod(true)
    try {
      const payload = {
        ...nextPayload,
        periode_mulai: academicYearRange.startsAt,
        periode_selesai: academicYearRange.endsAt,
        periode_ganjil_mulai: ganjilPreview.startsAt,
        periode_ganjil_selesai: ganjilPreview.endsAt,
        periode_genap_mulai: genapPreview.startsAt,
        periode_genap_selesai: genapPreview.endsAt,
        jadwal_periode_berlaku: nextPayload.jadwal_periode_berlaku,
        auto_rollover: yearMovesForwardOneStep,
        carry_eskul_members: yearMovesForwardOneStep && carryEskulMembers
      }

      let { data, error, raw } = await supabase.admin.applyAcademicPeriod(payload)
      if (error?.code === 'academic_period_calendar_confirmation_required') {
        const serverCalendar = raw?.data?.server_calendar || {}
        const targetPeriod = raw?.data?.target_period || {}
        const confirmedCalendar = await requestConfirmation({
          title: 'Validasi kalender server',
          message: error.message || 'Periode yang dipilih perlu dikonfirmasi ulang.',
          confirmText: 'Ya, tetap simpan',
          cancelText: 'Batal',
          tone: 'warning',
          details: [
            `Tanggal server: ${serverCalendar.today || '-'} (${serverCalendar.timezone || 'Asia/Jakarta'})`,
            `Kalender server: ${serverCalendar.tahun_ajaran || '-'}`,
            `Target simpan: ${targetPeriod.tahun_ajaran || tahunAjaran}`
          ]
        })
        if (!confirmedCalendar) return

        const retry = await supabase.admin.applyAcademicPeriod({
          ...payload,
          calendar_confirmed: true
        })
        data = retry.data
        error = retry.error
      }
      if (error) throw error

      const savedRow = data?.settings || (Array.isArray(data) ? data[0] : data)
      if (savedRow?.id && !settingsId) setSettingsId(savedRow.id)
      const savedPeriodForm = resolvePeriodForm(payload)
      setPeriodForm(savedPeriodForm)
      setPersistedPeriodForm(savedPeriodForm)
      setDrivePeriodFilter({ tahunAjaran, semester: '' })
      clearCachedSettingsRow()
      queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ['admin', 'academic-summary'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'student-options'] })
      const rollover = data?.rollover
      const rolloverText = rollover
        ? ` Siswa naik: ${rollover.promoted_students || 0}, tidak naik: ${rollover.retained_students || 0}, alumni: ${rollover.alumni_students || 0}.`
        : ''
      const eskulText = rollover && payload.carry_eskul_members
        ? ` Eskul disalin: ${rollover.eskul_members_copied || 0}.`
        : ''
      setCarryEskulMembers(false)
      pushToast('success', `Tahun ajaran ${tahunAjaran} aktif penuh.${rolloverText}${eskulText}`, {
        title: 'Kalender akademik diperbarui'
      })
    } catch (error) {
      pushToast('error', error?.message || 'Gagal menyimpan kalender akademik')
    } finally {
      setSavingPeriod(false)
    }
  }

  useEffect(() => {
    if (!settingsId || !isAuthorized || !initialLoadDoneRef.current) return

    const {
      nama_sekolah,
      email,
      telepon,
      alamat,
      logo_url,
      visi,
      misi,
      link_instagram,
      link_facebook,
      link_youtube,
      link_tiktok,
      max_ekskul_per_siswa
    } = form

    const hasContent =
      nama_sekolah ||
      email ||
      telepon ||
      alamat ||
      logo_url ||
      visi ||
      misi ||
      link_instagram ||
      link_facebook ||
      link_youtube ||
      link_tiktok ||
      max_ekskul_per_siswa

    if (!hasContent) return

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)

    autoSaveTimerRef.current = setTimeout(() => {
      saveSettings(false)
    }, 800)

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settingsId,
    isAuthorized,
    form.nama_sekolah,
    form.email,
    form.telepon,
    form.alamat,
    form.logo_url,
    form.visi,
    form.misi,
    form.link_instagram,
    form.link_facebook,
    form.link_youtube,
    form.link_tiktok,
    form.max_ekskul_per_siswa
  ])

  async function handleCheckboxChange(e) {
    if (!isAuthorized) return

    const { name, checked } = e.target
    setForm((prev) => ({ ...prev, [name]: checked }))

    try {
      if (!settingsId) {
        pushToast('error', 'ID pengaturan belum siap, coba beberapa detik lagi.')
        return
      }

      const updateData = { [name]: checked, updated_at: new Date().toISOString() }

      const { error } = await supabase
        .from('settings')
        .update(updateData)
        .eq('id', settingsId)

      if (error) throw error
      clearCachedSettingsRow()
      queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY })
      pushToast('success', 'Pengaturan registrasi berhasil diperbarui.')
    } catch (err) {
      pushToast('error', 'Gagal menyimpan pengaturan: ' + err.message)
    }
  }

  async function saveSettings(showToast = false) {
    if (!isAuthorized) return
    setSaving(true)
    try {
      if (!settingsId) {
        if (showToast) pushToast('warning', 'Data pengaturan belum siap. Tunggu sebentar lalu coba lagi.')
        return
      }

      const dataToSave = {
        nama_sekolah: sanitizeText(form.nama_sekolah),
        email: sanitizeText(form.email),
        telepon: sanitizeText(form.telepon),
        alamat: sanitizeText(form.alamat),
        logo_url: form.logo_url || null,
        visi: sanitizeText(form.visi),
        misi: sanitizeText(form.misi),
        link_instagram: sanitizeUrl(form.link_instagram),
        link_facebook: sanitizeUrl(form.link_facebook),
        link_youtube: sanitizeUrl(form.link_youtube),
        link_tiktok: sanitizeUrl(form.link_tiktok),
        registrasi_siswa_aktif: form.registrasi_siswa_aktif,
        registrasi_guru_aktif: form.registrasi_guru_aktif,
        registrasi_admin_aktif: form.registrasi_admin_aktif,
        max_ekskul_per_siswa: normalizeEskulLimit(form.max_ekskul_per_siswa),
        updated_at: new Date().toISOString()
      }

      lastSaveTimestampRef.current = dataToSave.updated_at

      const { error } = await supabase
        .from('settings')
        .update(dataToSave)
        .eq('id', settingsId)

      if (error) throw error
      clearCachedSettingsRow()
      queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY })
      if (showToast) pushToast('success', 'Pengaturan berhasil disimpan.')
    } catch (err) {
      if (showToast) pushToast('error', 'Gagal menyimpan: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleLogoUpload() {
    if (!isAuthorized || !selectedLogoFile) return
    setUploadingLogo(true)

    try {
      const compressedFile = await compressImage(selectedLogoFile, 300)


      await supabase.storage.from(SUPABASE_BUCKET).remove([TENANT_LOGO_FILE_PATH])

      const { error: uploadError } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(TENANT_LOGO_FILE_PATH, compressedFile, {
          upsert: true,
          cacheControl: '3600',
          contentType: 'image/jpeg'
        })

      if (uploadError) throw uploadError

      const newLogoPath = TENANT_LOGO_FILE_PATH
      setForm((prev) => ({ ...prev, logo_url: newLogoPath }))

      if (settingsId) {
        const { error } = await supabase
          .from('settings')
          .update({
            logo_url: newLogoPath,
            updated_at: new Date().toISOString()
          })
          .eq('id', settingsId)

        if (error) throw error
        clearCachedSettingsRow()
        queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY })
      }

      const signed = await createSignedUrlSafe(SUPABASE_BUCKET, newLogoPath)
      setLogoSignedUrl(signed)

      pushToast('success', 'Logo berhasil diupload dan diperbarui!')
      setSelectedLogoFile(null)
    } catch (err) {
      pushToast('error', 'Gagal upload logo: ' + err.message)
    } finally {
      setUploadingLogo(false)
    }
  }

  async function handleAdminPhotoChange(file) {
    if (!isAuthorized || !file || !user?.id) return
    setUploadingAvatar(true)

    try {
      const compressedFile = await compressImage(file, 300)

      const randomId = makeRandomId()
      const path = `profiles/${user.id}/${randomId}.jpg`

      const { error: uploadError } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(path, compressedFile, { upsert: false, contentType: 'image/jpeg' })

      if (uploadError) throw uploadError

      setAvatarPath(path)

      let { error: updateError } = await supabase
        .from('profiles')
        .update({
          photo_path: path,
          photo_url: path,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id)

      if (updateError && /photo_path/i.test(updateError.message || '')) {
        ; ({ error: updateError } = await supabase
          .from('profiles')
          .update({
            photo_url: path,
            updated_at: new Date().toISOString()
          })
          .eq('id', user.id))
      }

      if (typeof window !== 'undefined') {
        localStorage.setItem(`user_avatar_path_${user.id}`, path)
      }

      if (updateError) throw updateError

      const signed = await createSignedUrlSafe(SUPABASE_BUCKET, path)
      setAvatarSignedUrl(signed)
      await refreshProfile?.()

      pushToast('success', 'Foto profil admin berhasil diperbarui.')
    } catch (err) {
      pushToast('error', 'Gagal upload foto profil: ' + err.message)
    } finally {
      setUploadingAvatar(false)
    }
  }

  async function onSave() {
    if (!isAuthorized) return
    setSaving(true)
    await saveSettings(true)
    setSaving(false)
  }

  async function handleLinkGoogleAccount(credential) {
    const providerState = supabase.auth.getProviderState?.(user || {}) || { googleLinked: false }
    const googleLinked = Boolean(user?.google_linked || providerState.googleLinked)

    if (googleLinked) {
      pushToast('info', 'Akun Google sudah tertaut.')
      return
    }

    setLinkingGoogle(true)
    try {
      const result = await linkGoogleCredential(credential)
      return result
    } finally {
      setLinkingGoogle(false)
    }
  }

  async function handleLinkGoogleOAuthSuccess(popupResult = {}) {
    const providerState = supabase.auth.getProviderState?.(user || {}) || { googleLinked: false }
    const googleLinked = Boolean(user?.google_linked || providerState.googleLinked)

    if (googleLinked) {
      pushToast('info', 'Akun Google sudah tertaut.')
      return
    }

    setLinkingGoogle(true)
    try {
      const result = await completeGoogleLinkOAuthFlow({
        popupResult,
        googleLinked,
        markGoogleLinked,
        refreshAuthSession,
        refreshProfile,
        expectedEmail: user?.email || profile?.email || ''
      })
      pushToast('success', 'Akun Google berhasil ditautkan', {
        title: 'Google Tertaut',
        duration: 5200
      })
      return result
    } finally {
      setLinkingGoogle(false)
    }
  }

  async function handleUnlinkGoogleAccount() {
    const providerState = supabase.auth.getProviderState?.(user || {}) || { googleLinked: false }
    const googleLinked = Boolean(user?.google_linked || providerState.googleLinked)
    if (!googleLinked) {
      pushToast('info', 'Akun Google belum tertaut.')
      return
    }

    const confirmed = window.confirm(
      'Yakin ingin melepas tautan Google? Setelah ini login Google dinonaktifkan untuk akun ini.'
    )
    if (!confirmed) return

    setUnlinkingGoogle(true)
    try {
      const { data, error } = await supabase.auth.unlinkGoogleAccount()
      if (error) throw error
      if (data?.user) {
        useAuthStore.setState((state) => ({ ...state, user: data.user }))
      }
      pushToast('success', 'Tautan Google berhasil dilepas.', {
        title: 'Google Dilepas',
        duration: 5200
      })
    } catch (error) {
      pushToast('error', error?.message || 'Gagal melepas tautan Google')
    } finally {
      setUnlinkingGoogle(false)
    }
  }

  async function handleConnectGoogleDrive() {
    setDriveConnecting(true)
    try {
      const returnUrl = (() => {
        if (typeof window === 'undefined') return '/admin/pengaturan?menu=drive'
        const url = new URL(window.location.href)
        url.searchParams.set('menu', 'drive')
        url.hash = ''
        return `${url.origin}${url.pathname}${url.search}`
      })()
      const { data, error } = await supabase.admin.googleDriveConnectUrl({ return_url: returnUrl })
      if (error) throw error
      if (!data?.authorization_url) throw new Error('URL otorisasi Google Drive tidak tersedia')
      if (typeof window !== 'undefined') {
        window.location.assign(data.authorization_url)
      }
    } catch (error) {
      pushToast('error', error?.message || 'Gagal menyiapkan sambungan Google Drive')
      setDriveConnecting(false)
    }
  }

  async function handleSyncGoogleDrive() {
    setDriveSyncing(true)
    try {
      const { data, error } = await supabase.admin.syncGoogleDrive({
        tahun_ajaran: drivePeriodFilter.tahunAjaran
      })
      if (error) throw error
      setDriveStatus(data || DRIVE_STATUS_DEFAULT)
      pushToast('success', 'Status Google Drive sekolah berhasil dicek.')
    } catch (error) {
      pushToast('error', error?.message || 'Gagal mengecek Google Drive sekolah')
    } finally {
      setDriveSyncing(false)
    }
  }

  async function handleDisconnectGoogleDrive() {
    const confirmed = window.confirm(
      'Putuskan Google Drive sekolah? File lama tidak dihapus dari Google Drive, tetapi upload dokumen berikutnya akan kembali ke storage lokal sampai disambungkan lagi.'
    )
    if (!confirmed) return

    setDriveDisconnecting(true)
    try {
      const { data, error } = await supabase.admin.disconnectGoogleDrive()
      if (error) throw error
      setDriveStatus(data || DRIVE_STATUS_DEFAULT)
      pushToast('success', 'Google Drive sekolah berhasil diputuskan.')
    } catch (error) {
      pushToast('error', error?.message || 'Gagal memutuskan Google Drive sekolah')
    } finally {
      setDriveDisconnecting(false)
    }
  }

  const localStorageAvatarPath =
    typeof window !== 'undefined' && user?.id
      ? localStorage.getItem(`user_avatar_path_${user.id}`) ||
        extractObjectKeyFromMaybeUrl(localStorage.getItem(`user_avatar_${user.id}`) || '', SUPABASE_BUCKET)
      : null

  const fallbackAvatarPath = avatarPath || localStorageAvatarPath || extractObjectKeyFromMaybeUrl(profile?.photo_path || profile?.photo_url || '', SUPABASE_BUCKET) || ''

  useEffect(() => {
    if (!isAuthorized || activeSettingsMenu !== 'admin') return
    if (avatarSignedUrl) return
    if (!fallbackAvatarPath) return

    let cancelled = false
      ; (async () => {
        try {
          const signed = await createSignedUrlSafe(SUPABASE_BUCKET, fallbackAvatarPath)
          if (!cancelled) setAvatarSignedUrl(signed)
        } catch {
          // ignore
        }
      })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSettingsMenu, isAuthorized, fallbackAvatarPath, avatarSignedUrl])

  const finalAvatarUrl = avatarSignedUrl || ''
  const displayName = profile?.nama || user?.email || 'Admin'
  const roleLabel = (profile?.role || 'admin').toUpperCase()
  const providerState = supabase.auth.getProviderState?.(user || {}) || {
    googleLinked: false,
    emailVerified: false
  }
  const googleLinked = Boolean(user?.google_linked || providerState.googleLinked)
  const emailVerified = Boolean(user?.email_confirmed_at || user?.emailVerified || providerState.emailVerified)
  const googleExpectedEmail = user?.email || profile?.email || ''
  const periodYearWillChange = periodForm.tahunAjaran !== persistedPeriodForm.tahunAjaran
  const activeAcademicPeriod = resolveAcademicPeriod({
    tahun_ajaran: periodForm.tahunAjaran,
    semester_aktif: periodForm.semester,
    periode_mulai: periodForm.periodeMulai,
    periode_selesai: periodForm.periodeSelesai,
    periode_ganjil_mulai: periodForm.periodeGanjilMulai,
    periode_ganjil_selesai: periodForm.periodeGanjilSelesai,
    periode_genap_mulai: periodForm.periodeGenapMulai,
    periode_genap_selesai: periodForm.periodeGenapSelesai
  })
  const browserNow = new Date()
  const currentMonthValue = `${browserNow.getFullYear()}-${String(browserNow.getMonth() + 1).padStart(2, '0')}`
  const currentAcademicPeriod = getCurrentAcademicPeriod(browserNow)
  const activePeriodMatchesCalendar =
    activeAcademicPeriod.tahunAjaran === currentAcademicPeriod.tahunAjaran
  const academicMonths = activeAcademicPeriod.months?.length
    ? activeAcademicPeriod.months
    : activeAcademicPeriod.academicYearMonths || []
  const academicYearMonths = activeAcademicPeriod.academicYearMonths?.length
    ? activeAcademicPeriod.academicYearMonths
    : academicMonths
  const periodYearOptions = generateAcademicYearOptions({ back: 5, forward: 2 })
  const semesterPeriodCards = [
    {
      key: SEMESTER_GANJIL,
      title: 'Semester Ganjil',
      startName: 'periodeGanjilMulai',
      endName: 'periodeGanjilSelesai',
      min: `${activeAcademicPeriod.startYear}-07`,
      max: `${activeAcademicPeriod.startYear}-12`,
      tone: 'emerald'
    },
    {
      key: SEMESTER_GENAP,
      title: 'Semester Genap',
      startName: 'periodeGenapMulai',
      endName: 'periodeGenapSelesai',
      min: `${activeAcademicPeriod.startYear + 1}-01`,
      max: `${activeAcademicPeriod.startYear + 1}-06`,
      tone: 'sky'
    }
  ]
  const driveReady = Boolean(driveStatus?.ready)
  const driveProviderConfigured = driveStatus?.provider_configured !== false
  const driveQuotaPercent = Number(driveStatus?.quota?.percent)
  const driveQuotaPercentLabel = Number.isFinite(driveQuotaPercent)
    ? `${driveQuotaPercent.toLocaleString('id-ID')}%`
    : '-'
  const driveStatusBadgeClass = driveReady
    ? 'bg-emerald-100 text-emerald-700'
    : driveStatus?.status === 'needs_attention'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-slate-200 text-slate-700'
  const driveYearOptions = generateAcademicYearOptions({ back: 5, forward: 2 })
  const driveClassUsageRows = Array.isArray(driveStatus?.usage_by_class) ? driveStatus.usage_by_class : []
  const driveSemesterUsageRows = Array.isArray(driveStatus?.usage_by_semester) ? driveStatus.usage_by_semester : []
  const driveFilteredStorage = driveStatus?.app_storage || DRIVE_STATUS_DEFAULT.app_storage
  const driveAllStorage = driveStatus?.app_storage_all || driveStatus?.app_storage || DRIVE_STATUS_DEFAULT.app_storage
  const driveQuotaUsedLabel = driveStatus?.quota?.used_label || formatBytesLabel(driveStatus?.quota?.used_bytes)
  const driveQuotaLimitLabel = driveStatus?.quota?.limit_label || 'Tidak terbatas'
  const driveQuotaBarWidth = Number.isFinite(driveQuotaPercent) ? Math.max(0, Math.min(100, driveQuotaPercent)) : 0
  const driveQuotaBarClass = driveQuotaBarWidth >= 90
    ? 'bg-red-500'
    : driveQuotaBarWidth >= 75
      ? 'bg-amber-500'
      : 'bg-emerald-500'
  const driveQuotaToneClass = driveQuotaBarWidth >= 90
    ? 'border-red-200 bg-red-50 text-red-700'
    : driveQuotaBarWidth >= 75
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700'
  const driveLastCheckedLabel = formatDateTimeLabel(driveStatus?.last_checked_at)
  const driveFileQuery = driveFileSearch.trim().toLowerCase()
  const driveVisibleFiles = driveFileQuery
    ? driveFiles.filter((file) => [
      file.drive_file_name,
      file.module_label,
      file.bucket,
      file.kelas,
      file.angkatan,
      file.tahun_ajaran,
      file.semester,
      file.extension,
      file.source_path
    ].some((value) => String(value || '').toLowerCase().includes(driveFileQuery)))
    : driveFiles
  const driveFileTotal = Number(driveFilesMeta?.total || driveFiles.length || 0)
  const driveScopeList = Array.isArray(driveStatus?.required_scopes) ? driveStatus.required_scopes : []
  const driveChecklist = [
    {
      label: 'Provider server',
      detail: driveProviderConfigured ? 'Credential Google Drive tersedia' : 'Credential belum lengkap',
      ok: driveProviderConfigured
    },
    {
      label: 'Akun sekolah',
      detail: driveStatus?.account_email || 'Belum tersambung',
      ok: Boolean(driveStatus?.configured)
    },
    {
      label: 'Folder root',
      detail: driveStatus?.folder_name || 'Folder belum dibuat',
      ok: driveReady
    },
    {
      label: 'Link berbagi',
      detail: driveStatus?.share_uploaded_files ? 'File otomatis bisa dibuka via link' : 'Berbagi link dimatikan',
      ok: Boolean(driveStatus?.share_uploaded_files)
    }
  ]
  const settingsMenuItems = [
    {
      id: 'identity',
      label: 'Identitas',
      description: 'Profil sekolah, logo, visi misi, dan media sosial',
      icon: School
    },
    {
      id: 'academic',
      label: 'Akademik',
      description: 'Tahun ajaran penuh dan rentang bulan Ganjil/Genap',
      icon: CalendarDays
    },
    {
      id: 'drive',
      label: 'Google Drive',
      description: 'Koneksi, quota, storage kelas, dan inventaris file',
      icon: Cloud
    },
    {
      id: 'admin',
      label: 'Akun Admin',
      description: 'Profil, tautan Google, verifikasi email, dan logout',
      icon: UserCog
    },
    {
      id: 'registration',
      label: 'Registrasi',
      description: 'Buka atau tutup registrasi publik per role',
      icon: Users
    }
  ]
  const settingsVisibleMenuItems = settingsMenuItems.filter((item) => item.id !== 'academic' && item.id !== 'drive')
  const activeSettings = settingsMenuItems.find((item) => item.id === activeSettingsMenu) || settingsMenuItems[0]
  const showSettingsMainColumn = ['identity', 'drive'].includes(activeSettingsMenu)
  const showSettingsSidebarColumn = ['identity', 'admin', 'registration'].includes(activeSettingsMenu)
  const settingsContentClass = activeSettingsMenu === 'identity'
    ? 'grid grid-cols-1 lg:grid-cols-3 gap-6'
    : 'space-y-6'
  const settingsMainColumnClass = activeSettingsMenu === 'identity'
    ? 'lg:col-span-2 space-y-6'
    : 'space-y-6'
  const ActiveSettingsIcon = activeSettings.icon
  const isAcademicStandalone = activeSettingsMenu === 'academic'
  const isStandaloneSettingsMenu = isAcademicStandalone
  const pageTitle = isAcademicStandalone
    ? 'Pengaturan Akademik'
    : 'Pengaturan Sistem'
  const pageDescription = isAcademicStandalone
    ? 'Kelola tahun ajaran penuh dan rentang bulan Ganjil/Genap.'
    : 'Kelola identitas sekolah, Google Drive, akun admin, dan registrasi publik.'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="w-full space-y-8 px-4 sm:px-6 lg:px-8 pt-2 pb-8">
        <div className="page-title-card">
          <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-blue-100 rounded-2xl">
                {isAcademicStandalone ? (
                  <CalendarDays className="w-8 h-8 text-blue-600" />
                ) : (
                  <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </div>
              <div>
                <h1 className="page-title-heading">{pageTitle}</h1>
                <p className="page-title-description">
                  {pageDescription}
                </p>
              </div>
            </div>
          </div>
        </div>

        {!isStandaloneSettingsMenu && (
        <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          <div className="flex gap-1.5 overflow-x-auto">
            {settingsVisibleMenuItems.map((item) => {
              const Icon = item.icon
              const isActive = activeSettingsMenu === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSettingsMenuChange(item.id)}
                  aria-pressed={isActive}
                  className={`flex shrink-0 items-center gap-2.5 rounded-xl border px-4 py-2.5 text-left transition-all ${
                    isActive
                      ? 'border-blue-200 bg-blue-50 text-blue-700 shadow-sm'
                      : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                    isActive ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{item.label}</span>
                    <span className="block text-[11px] leading-4 text-slate-500">{item.description}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
        )}

        {!isStandaloneSettingsMenu && (
        <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-gradient-to-r from-blue-50/60 to-white px-5 py-3 shadow-sm">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
            <ActiveSettingsIcon className="h-4 w-4" />
          </span>
          <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">{activeSettings.label}</h2>
              <p className="text-xs text-slate-500">{activeSettings.description}</p>
            </div>
            <span className="hidden rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold text-blue-600 sm:inline-block">
              Aktif
            </span>
          </div>
        </div>
        )}

        <div className="space-y-6">
          {loading && (
            <div className="rounded-2xl border border-blue-100 bg-white px-5 py-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                  <div>
                    <p className="text-sm font-semibold text-slate-700">Memuat pengaturan terbaru...</p>
                    <p className="text-xs text-slate-500">Form tetap ditampilkan dengan data cache/default.</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:w-56">
                  <div className="h-2 rounded-full bg-slate-100" />
                  <div className="h-2 rounded-full bg-slate-100" />
                  <div className="h-2 rounded-full bg-slate-100" />
                </div>
              </div>
            </div>
          )}

          {activeSettingsMenu === 'drive' && (
          <div id="google-drive-sekolah" className="rounded-2xl border border-blue-200 bg-white p-6 shadow-lg">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Storage Sekolah</p>
                <h2 className="mt-1 text-xl font-bold text-gray-900">Google Drive Sekolah</h2>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                  <span>Storage: <strong className="text-slate-900">{driveStatus?.quota?.used_label || formatBytesLabel(driveStatus?.quota?.used_bytes)}</strong></span>
                  <span>Upload hari ini: <strong className="text-slate-900">{driveStatus?.today?.uploaded_label || '0 B'}</strong></span>
                  <span>File hari ini: <strong className="text-slate-900">{Number(driveStatus?.today?.files || 0).toLocaleString('id-ID')}</strong></span>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${driveStatusBadgeClass}`}>
                  {driveLoading ? 'Memuat...' : driveStatus?.status_label || 'Belum tersambung'}
                </span>
                <button
                  type="button"
                  onClick={handleConnectGoogleDrive}
                  disabled={!driveProviderConfigured || driveConnecting || driveSyncing}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {driveConnecting ? 'Menyambungkan...' : driveReady ? 'Sambungkan Ulang' : 'Sambungkan Google Drive'}
                </button>
                <button
                  type="button"
                  onClick={handleSyncGoogleDrive}
                  disabled={!driveProviderConfigured || driveSyncing || driveConnecting}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {driveSyncing ? 'Mengecek...' : 'Cek Kesiapan'}
                </button>
              </div>
            </div>

            {!driveProviderConfigured && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                Google Drive belum aktif di server. Lengkapi GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, dan GOOGLE_DRIVE_REDIRECT_URI.
              </div>
            )}

            <div className="mt-5 grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Filter Periode Storage</p>
                <div className="mt-3 grid gap-2">
                  <select
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    value={drivePeriodFilter.tahunAjaran}
                    onChange={(event) => setDrivePeriodFilter((prev) => ({ ...prev, tahunAjaran: event.target.value, semester: '' }))}
                  >
                    {driveYearOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="mt-4 rounded-lg bg-white p-3 text-sm">
                  <p className="text-xs font-semibold text-slate-500">Terpakai periode ini</p>
                  <p className="mt-1 text-lg font-bold text-slate-900">{driveFilteredStorage.uploaded_label || '0 B'}</p>
                  <p className="text-xs text-slate-500">{Number(driveFilteredStorage.files || 0).toLocaleString('id-ID')} file</p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="border-b border-slate-200 px-4 py-3">
                  <p className="text-sm font-bold text-slate-900">Detail Storage per Kelas</p>
                  <p className="text-xs text-slate-500">
                    {drivePeriodFilter.tahunAjaran} - 1 Tahun Ajaran
                  </p>
                </div>
                <div className="max-h-72 overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2 text-left">Kelas</th>
                        <th className="px-4 py-2 text-left">Angkatan</th>
                        <th className="px-4 py-2 text-right">File</th>
                        <th className="px-4 py-2 text-right">Terpakai</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {driveClassUsageRows.map((row, index) => (
                        <tr key={`${row.kelas || 'kelas'}-${row.semester || ''}-${index}`}>
                          <td className="px-4 py-2 font-semibold text-slate-800">{row.kelas || 'Tanpa kelas'}</td>
                          <td className="px-4 py-2 text-slate-600">{row.angkatan || '-'}</td>
                          <td className="px-4 py-2 text-right text-slate-600">{Number(row.files || 0).toLocaleString('id-ID')}</td>
                          <td className="px-4 py-2 text-right font-semibold text-slate-900">{row.uploaded_label || '0 B'}</td>
                        </tr>
                      ))}
                      {driveClassUsageRows.length === 0 && (
                        <tr>
                          <td className="px-4 py-6 text-center text-slate-500" colSpan={4}>Belum ada upload Google Drive pada periode ini.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
          )}

          {activeSettingsMenu === 'academic' && (
          <div className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-lg">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Kalender Akademik</p>
                <h2 className="mt-1 text-xl font-bold text-gray-900">Tahun Ajaran Aktif</h2>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-semibold text-emerald-700">
                    Tahun ajaran {activeAcademicPeriod.tahunAjaran}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-semibold text-slate-700">
                    {activeAcademicPeriod.academicYearRangeLabel || activeAcademicPeriod.rangeLabel || '-'}
                  </span>
                  <span
                    className={`rounded-full border px-3 py-1 font-semibold ${
                      activePeriodMatchesCalendar
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-amber-200 bg-amber-50 text-amber-800'
                    }`}
                  >
                    Kalender hari ini: {currentAcademicPeriod.tahunAjaran}
                  </span>
                </div>
              </div>

              <div className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:w-auto">
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                  <p className="text-xs font-semibold text-emerald-700">Tahun Ajaran</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{activeAcademicPeriod.tahunAjaran}</p>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                  <p className="text-xs font-semibold text-emerald-700">Rentang Periode</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{activeAcademicPeriod.academicYearRangeLabel || '-'}</p>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                  <p className="text-xs font-semibold text-emerald-700">Jadwal</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">1 Tahun Ajaran</p>
                </div>
              </div>
            </div>

            <form onSubmit={(event) => { event.preventDefault(); saveAcademicPeriod() }} className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Tahun Ajaran</label>
                  <select
                    name="tahunAjaran"
                    value={periodForm.tahunAjaran}
                    onChange={handlePeriodChange}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                  >
                    {periodYearOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}{option.isCurrent ? ' (berjalan)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {semesterPeriodCards.map((item) => {
                    return (
                      <div key={item.key} className="rounded-xl border border-slate-200 bg-white p-3 text-slate-700">
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <p className="text-sm font-bold">{item.title}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Mulai</label>
                            <input
                              type="month"
                              name={item.startName}
                              value={toMonthInputValue(periodForm[item.startName])}
                              min={item.min}
                              max={item.max}
                              onChange={handlePeriodChange}
                              className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm font-semibold text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Selesai</label>
                            <input
                              type="month"
                              name={item.endName}
                              value={toMonthInputValue(periodForm[item.endName])}
                              min={item.min}
                              max={item.max}
                              onChange={handlePeriodChange}
                              className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm font-semibold text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {periodYearWillChange && (
                <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={carryEskulMembers}
                    onChange={(event) => setCarryEskulMembers(event.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-amber-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-amber-900">
                      Salin anggota eskul aktif ke periode baru
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-amber-800">
                      Membuat keanggotaan baru untuk siswa yang naik kelas; riwayat periode lama tetap utuh.
                    </span>
                  </span>
                </label>
              )}

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleUseCurrentPeriod}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Gunakan Periode Berjalan
                  </button>
                  <button
                    type="submit"
                    disabled={savingPeriod}
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingPeriod ? 'Menyimpan...' : 'Simpan Periode'}
                  </button>
                </div>
              </div>
            </form>

            <div className="mt-5">
              <div>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-semibold text-gray-700">Bulan dalam Tahun Ajaran</p>
                  <span className="text-xs font-semibold text-amber-700">Kuning = bulan berjalan</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {academicYearMonths.map((month) => {
                    const isCurrentMonth = month.value === currentMonthValue

                    return (
                      <span
                        key={month.value || month.label}
                        className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                          isCurrentMonth
                            ? 'border-amber-300 bg-amber-100 text-amber-900 shadow-sm'
                            : 'border-emerald-100 bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {month.label}
                      </span>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
          )}

          {(showSettingsMainColumn || showSettingsSidebarColumn) && (
          <div className={settingsContentClass}>
            {showSettingsMainColumn && (
            <div className={settingsMainColumnClass}>
              {activeSettingsMenu === 'identity' && (
              <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center space-x-2">
                  <span>🏫</span>
                  <span>Identitas Sekolah</span>
                </h2>

                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Nama Sekolah</label>
                    <input
                      type="text"
                      name="nama_sekolah"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                      value={form.nama_sekolah}
                      onChange={handleChange}
                      placeholder="Masukkan nama sekolah"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Email Sekolah</label>
                      <input
                        type="email"
                        name="email"
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                        value={form.email}
                        onChange={handleChange}
                        placeholder="email@sekolah.example"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Nomor Telepon</label>
                      <input
                        type="tel"
                        name="telepon"
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                        value={form.telepon}
                        onChange={handleChange}
                        placeholder="+62 ..."
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Alamat Sekolah</label>
                    <textarea
                      name="alamat"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none transition-all duration-200"
                      rows="3"
                      value={form.alamat}
                      onChange={handleChange}
                      placeholder="Alamat lengkap sekolah"
                    ></textarea>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Visi Sekolah</label>
                      <textarea
                        name="visi"
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none transition-all duration-200"
                        rows="4"
                        value={form.visi}
                        onChange={handleChange}
                        placeholder="Visi sekolah yang ingin dicapai"
                      ></textarea>
                      <p className="text-xs text-gray-500 mt-1">Tuliskan visi sekolah yang inspiratif dan jelas</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Misi Sekolah</label>
                      <textarea
                        name="misi"
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none transition-all duration-200"
                        rows="4"
                        value={form.misi}
                        onChange={handleChange}
                        placeholder="Misi sekolah untuk mencapai visi"
                      ></textarea>
                      <p className="text-xs text-gray-500 mt-1">Tuliskan misi sekolah secara detail dan terukur</p>
                    </div>
                  </div>

                  <div className="border-t pt-6">
                    <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-gray-900">
                      <span>📱</span>
                      <span>Media Sosial Sekolah</span>
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          <div className="flex items-center">
                            <svg className="w-5 h-5 text-pink-500 mr-2" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.174-.105-.949-.199-2.403.042-3.441.219-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.402.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.357-.629-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24.009 12.017 24.009c6.624 0 11.99-5.367 11.99-11.988C24.007 5.367 18.641.001.012.017z" />
                            </svg>
                            Instagram
                          </div>
                        </label>
                        <input
                          type="url"
                          name="link_instagram"
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                          value={form.link_instagram}
                          onChange={handleChange}
                          placeholder="https://instagram.com/username"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          <div className="flex items-center">
                            <svg className="w-5 h-5 text-blue-600 mr-2" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                            </svg>
                            Facebook
                          </div>
                        </label>
                        <input
                          type="url"
                          name="link_facebook"
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                          value={form.link_facebook}
                          onChange={handleChange}
                          placeholder="https://facebook.com/username"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          <div className="flex items-center">
                            <svg className="w-5 h-5 text-red-600 mr-2" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                            </svg>
                            YouTube
                          </div>
                        </label>
                        <input
                          type="url"
                          name="link_youtube"
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                          value={form.link_youtube}
                          onChange={handleChange}
                          placeholder="https://youtube.com/c/username"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          <div className="flex items-center">
                            <svg className="w-5 h-5 text-black mr-2" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
                            </svg>
                            TikTok
                          </div>
                        </label>
                        <input
                          type="url"
                          name="link_tiktok"
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                          value={form.link_tiktok}
                          onChange={handleChange}
                          placeholder="https://tiktok.com/@username"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      Link media sosial akan ditampilkan di halaman publik sekolah
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 rounded-2xl border border-blue-100 bg-blue-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-bold text-slate-900">Simpan Identitas Sekolah</p>
                      <p className="text-xs text-slate-600">
                        Gunakan tombol ini jika perubahan belum tersimpan otomatis.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => saveSettings(true)}
                      disabled={saving || loading || !settingsId}
                      className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {saving ? 'Menyimpan...' : 'Simpan Identitas'}
                    </button>
                  </div>
                </div>
              </div>
              )}

              {activeSettingsMenu === 'drive' && (
              <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
                <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-xl font-bold text-gray-900 flex items-center space-x-2">
                    <Cloud className="h-6 w-6 text-blue-600" />
                    <span>Google Drive Sekolah</span>
                  </h2>
                  <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${driveStatusBadgeClass}`}>
                    {driveLoading ? 'Memuat...' : driveStatus?.status_label || 'Belum tersambung'}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold text-slate-500">Storage Periode Dipilih</p>
                    <p className="mt-1 text-xl font-bold text-slate-900">
                      {driveFilteredStorage.uploaded_label || '0 B'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {drivePeriodFilter.tahunAjaran} - 1 Tahun Ajaran
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold text-slate-500">Upload Hari Ini</p>
                    <p className="mt-1 text-xl font-bold text-slate-900">
                      {driveStatus?.today?.uploaded_label || '0 B'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {Number(driveStatus?.today?.files || 0).toLocaleString('id-ID')} file
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold text-slate-500">Pemakaian Quota</p>
                    <p className="mt-1 text-xl font-bold text-slate-900">{driveQuotaPercentLabel}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Total EduSmart: {driveStatus?.app_storage_all?.uploaded_label || driveStatus?.app_storage?.uploaded_label || '0 B'}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <div className={`rounded-xl border p-4 ${driveQuotaToneClass}`}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide">Kesehatan Quota Drive</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">
                          {driveQuotaUsedLabel} terpakai dari {driveQuotaLimitLabel}
                        </p>
                      </div>
                      <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-bold">
                        <HardDrive className="h-3.5 w-3.5" />
                        {driveQuotaPercentLabel}
                      </div>
                    </div>
                    <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/80">
                      <div
                        className={`h-full rounded-full ${driveQuotaBarClass}`}
                        style={{ width: `${driveQuotaBarWidth}%` }}
                      />
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                      <span>Total file EduSmart: <strong className="text-slate-900">{Number(driveAllStorage.files || 0).toLocaleString('id-ID')}</strong></span>
                      <span>Total EduSmart: <strong className="text-slate-900">{driveAllStorage.uploaded_label || '0 B'}</strong></span>
                      <span>Terakhir dicek: <strong className="text-slate-900">{driveLastCheckedLabel}</strong></span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Checklist Kesiapan</p>
                    <div className="mt-3 space-y-2">
                      {driveChecklist.map((item) => (
                        <div key={item.label} className="flex items-start gap-2 rounded-lg bg-white p-2">
                          {item.ok ? (
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                          ) : (
                            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                          )}
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-800">{item.label}</p>
                            <p className="truncate text-xs text-slate-500">{item.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {driveSemesterUsageRows.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {driveSemesterUsageRows.map((row, index) => (
                      <span
                        key={`${row.tahun_ajaran || 'tahun'}-${row.semester || 'semester'}-${index}`}
                        className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700"
                      >
                        {row.tahun_ajaran || '-'} {row.semester || '-'}: {row.uploaded_label || '0 B'}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="text-sm font-bold text-slate-900">Kelola Storage Drive</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Pantau pemakaian per kelas, filter periode akademik, dan buka file terbaru yang sudah dipindahkan ke Google Drive.
                      </p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <select
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                        value={drivePeriodFilter.tahunAjaran}
                        onChange={(event) => setDrivePeriodFilter((prev) => ({ ...prev, tahunAjaran: event.target.value, semester: '' }))}
                      >
                        {driveYearOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      <select
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                        value={driveFileBucket}
                        onChange={(event) => setDriveFileBucket(event.target.value)}
                      >
                        {DRIVE_FILE_BUCKET_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      <label className="relative">
                        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                        <input
                          type="search"
                          value={driveFileSearch}
                          onChange={(event) => setDriveFileSearch(event.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm"
                          placeholder="Cari file/kelas"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                    <div className="overflow-hidden rounded-xl border border-slate-200">
                      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-sm font-bold text-slate-900">Pemakaian per Kelas</p>
                        <p className="text-xs text-slate-500">{drivePeriodFilter.tahunAjaran} - 1 Tahun Ajaran</p>
                      </div>
                      <div className="max-h-72 overflow-auto">
                        <table className="min-w-full text-sm">
                          <thead className="bg-white text-xs uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="px-4 py-2 text-left">Kelas</th>
                              <th className="px-4 py-2 text-right">File</th>
                              <th className="px-4 py-2 text-right">Terpakai</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {driveClassUsageRows.map((row, index) => (
                              <tr key={`${row.kelas || 'kelas'}-${row.semester || ''}-${index}`}>
                                <td className="px-4 py-2">
                                  <p className="font-semibold text-slate-800">{row.kelas || 'Tanpa kelas'}</p>
                                  <p className="text-xs text-slate-500">Angkatan {row.angkatan || '-'}</p>
                                </td>
                                <td className="px-4 py-2 text-right text-slate-600">{Number(row.files || 0).toLocaleString('id-ID')}</td>
                                <td className="px-4 py-2 text-right font-semibold text-slate-900">{row.uploaded_label || '0 B'}</td>
                              </tr>
                            ))}
                            {driveClassUsageRows.length === 0 && (
                              <tr>
                                <td className="px-4 py-6 text-center text-slate-500" colSpan={3}>
                                  Belum ada upload Google Drive pada periode ini.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-slate-200">
                      <div className="flex flex-col gap-1 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-bold text-slate-900">Inventaris File Terbaru</p>
                          <p className="text-xs text-slate-500">
                            {driveFilesLoading
                              ? 'Memuat file...'
                              : `${driveVisibleFiles.length.toLocaleString('id-ID')} tampil dari ${driveFileTotal.toLocaleString('id-ID')} file`}
                          </p>
                        </div>
                        <span className="inline-flex w-fit items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                          <FileText className="h-3.5 w-3.5" />
                          Limit {Number(driveFilesMeta?.limit || 50).toLocaleString('id-ID')}
                        </span>
                      </div>
                      <div className="max-h-72 overflow-auto">
                        <table className="min-w-full text-sm">
                          <thead className="bg-white text-xs uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="px-4 py-2 text-left">File</th>
                              <th className="px-4 py-2 text-left">Konteks</th>
                              <th className="px-4 py-2 text-right">Ukuran</th>
                              <th className="px-4 py-2 text-right">Aksi</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {driveVisibleFiles.map((file) => (
                              <tr key={file.id}>
                                <td className="px-4 py-2">
                                  <p className="max-w-[240px] truncate font-semibold text-slate-800" title={file.drive_file_name}>
                                    {file.drive_file_name || 'Tanpa nama'}
                                  </p>
                                  <p className="text-xs text-slate-500">
                                    {file.module_label || 'File'} {file.extension ? `.${file.extension}` : ''}
                                  </p>
                                </td>
                                <td className="px-4 py-2 text-xs text-slate-600">
                                  <p>{file.tahun_ajaran || '-'} / {file.semester || '-'}</p>
                                  <p>{file.kelas || 'Tanpa kelas'} - Angkatan {file.angkatan || '-'}</p>
                                  <p>{formatDateTimeLabel(file.uploaded_at)}</p>
                                </td>
                                <td className="px-4 py-2 text-right font-semibold text-slate-900">{file.size_label || '0 B'}</td>
                                <td className="px-4 py-2 text-right">
                                  {file.drive_web_view_link ? (
                                    <a
                                      href={file.drive_web_view_link}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                                    >
                                      <ExternalLink className="h-3.5 w-3.5" />
                                      Buka
                                    </a>
                                  ) : (
                                    <span className="text-xs text-slate-400">-</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                            {!driveFilesLoading && driveVisibleFiles.length === 0 && (
                              <tr>
                                <td className="px-4 py-6 text-center text-slate-500" colSpan={4}>
                                  Belum ada file yang cocok dengan filter ini.
                                </td>
                              </tr>
                            )}
                            {driveFilesLoading && (
                              <tr>
                                <td className="px-4 py-6 text-center text-slate-500" colSpan={4}>
                                  Memuat inventaris file...
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <p className="text-xs font-semibold text-slate-500">Akun Drive</p>
                      <p className="mt-1 break-all font-semibold text-slate-900">
                        {driveStatus?.account_email || '-'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500">Folder Sekolah</p>
                      {driveStatus?.folder_url ? (
                        <a
                          href={driveStatus.folder_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex font-semibold text-blue-700 hover:text-blue-800"
                        >
                          {driveStatus?.folder_name || 'Buka folder'}
                        </a>
                      ) : (
                        <p className="mt-1 font-semibold text-slate-900">-</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500">Terakhir Dicek</p>
                      <p className="mt-1 font-semibold text-slate-900">{driveLastCheckedLabel}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500">Mode Upload</p>
                      <p className="mt-1 font-semibold text-slate-900">
                        {driveReady ? 'Google Drive aktif' : 'Fallback VPS aktif'}
                      </p>
                    </div>
                  </div>

                  {driveStatus?.last_error && (
                    <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{driveStatus.last_error}</span>
                    </div>
                  )}

                  {!driveProviderConfigured && (
                    <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      Google Drive belum aktif di server. Lengkapi GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, dan GOOGLE_DRIVE_REDIRECT_URI.
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={handleConnectGoogleDrive}
                      disabled={!driveProviderConfigured || driveConnecting || driveSyncing}
                      className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Link2 className="h-4 w-4" />
                      {driveConnecting ? 'Menyambungkan...' : driveReady ? 'Sambungkan Ulang' : 'Sambungkan Google Drive'}
                    </button>
                    <button
                      type="button"
                      onClick={handleSyncGoogleDrive}
                      disabled={!driveProviderConfigured || driveSyncing || driveConnecting}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <RefreshCw className={`h-4 w-4 ${driveSyncing ? 'animate-spin' : ''}`} />
                      {driveSyncing ? 'Mengecek...' : 'Cek Kesiapan'}
                    </button>
                    {driveStatus?.folder_url && (
                      <a
                        href={driveStatus.folder_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                      >
                        <FolderOpen className="h-4 w-4" />
                        Buka Folder
                      </a>
                    )}
                    {driveStatus?.configured && (
                      <button
                        type="button"
                        onClick={handleDisconnectGoogleDrive}
                        disabled={driveDisconnecting || driveConnecting}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Unplug className="h-4 w-4" />
                        {driveDisconnecting ? 'Memutuskan...' : 'Putuskan'}
                      </button>
                    )}
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        <Database className="h-4 w-4 text-blue-600" />
                        Routing Upload
                      </div>
                      <div className="mt-3 space-y-2 text-xs text-slate-600">
                        <div className="flex items-start gap-2">
                          <Cloud className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" />
                          <span>Dokumen tugas dan media quiz dikirim ke Google Drive saat status siap.</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <Server className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                          <span>Jika Drive penuh, putus, atau error, upload kembali ke VPS sesuai batas file lokal.</span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        <FolderOpen className="h-4 w-4 text-emerald-600" />
                        Struktur Folder
                      </div>
                      <div className="mt-3 space-y-1 text-xs text-slate-600">
                        <p>Root: <strong className="text-slate-900">{driveStatus?.folder_name || 'EduSmart Presensi'}</strong></p>
                        <p>Tugas / Tahun Ajaran / Semester / Angkatan / Kelas / Jawaban Siswa</p>
                        <p>Quiz / Tahun Ajaran / Semester / Angkatan / Kelas / Mapel</p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        <ShieldCheck className="h-4 w-4 text-emerald-600" />
                        Akses & Audit
                      </div>
                      <div className="mt-3 space-y-2 text-xs text-slate-600">
                        <div className="flex items-start gap-2">
                          <Share2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                          <span>{driveStatus?.share_uploaded_files ? 'Link file dibuat otomatis agar bisa dibaca dari aplikasi.' : 'Berbagi link file sedang dimatikan di server.'}</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                          <span>Metadata file menyimpan modul, periode, kelas, angkatan, ukuran, dan waktu upload.</span>
                        </div>
                        {driveScopeList.length > 0 && (
                          <p>OAuth scope aktif: <strong className="text-slate-900">{driveScopeList.length.toLocaleString('id-ID')}</strong> izin minimum.</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <p className="mt-3 text-xs text-slate-500">
                    Dokumen tugas masuk Google Drive saat status siap. Jika Drive tidak terhubung atau penuh, file disimpan ke VPS dan PDF/PPT dibatasi maksimal 2MB. Link manual hanya disimpan di database/VPS.
                  </p>
                </div>
              </div>
              )}

            </div>
            )}

            {showSettingsSidebarColumn && (
            <div className="space-y-6">
              {activeSettingsMenu === 'admin' && (
              <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center space-x-2">
                  <span>👨‍💼</span>
                  <span>Profil Admin</span>
                </h2>

                <div className="flex items-center space-x-4 mb-4">
                  {finalAvatarUrl ? (
                    <div className="relative">
                      <img
                        src={finalAvatarUrl}
                        alt="Foto Profil"
                        className="w-16 h-16 rounded-full object-cover border-2 border-gray-200 transition-all duration-200 hover:border-blue-500"
                      />
                      {uploadingAvatar && (
                        <div className="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-lg font-bold text-white">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <h3 className="font-semibold text-gray-900">{displayName}</h3>
                    <div className="text-sm text-blue-600 font-medium bg-blue-50 px-2 py-1 rounded-full inline-block">
                      {roleLabel}
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <FileDropzone
                    label={uploadingAvatar ? 'Mengupload...' : 'Ubah Foto Profil'}
                    onFileSelected={handleAdminPhotoChange}
                    accept={{ 'image/*': ['.png', '.jpg', '.jpeg'] }}
                    disabled={uploadingAvatar}
                    className="text-sm"
                  />

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700">Login Google</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${googleLinked
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-200 text-slate-700'
                          }`}
                      >
                        {googleLinked ? 'Tertaut' : 'Belum'}
                      </span>
                    </div>
                    {!googleLinked && (
                      <GoogleCredentialButton
                        mode="link"
                        onCredential={handleLinkGoogleAccount}
                        onOAuthSuccess={handleLinkGoogleOAuthSuccess}
                        busy={linkingGoogle}
                        width={260}
                        className="w-full"
                        buttonClassName="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
                        noteClassName="mt-2 text-[11px] text-slate-500"
                        iconClassName="inline-flex h-4 w-4 items-center justify-center"
                        label="Tautkan Google"
                        busyLabel="Memproses tautan Google..."
                        unavailableLabel="Mode standby. Aktifkan `VITE_GOOGLE_AUTH_ENABLED=true`."
                        expectedEmail={googleExpectedEmail}
                      />
                    )}
                    {googleLinked && (
                      <button
                        type="button"
                        onClick={handleUnlinkGoogleAccount}
                        disabled={unlinkingGoogle || linkingGoogle}
                        className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {unlinkingGoogle ? 'Melepas...' : 'Lepas Tautan Google'}
                      </button>
                    )}
                    <p className="mt-2 text-[11px] text-slate-500">
                      Syarat tautkan: email akun harus sama persis dengan email Google.
                    </p>
                    <p className="mt-2 text-[11px] text-slate-500">
                      Email terverifikasi dari Google akan ikut disinkronkan ke status akun.
                    </p>
                  </div>

                  {/* Email Verification Section */}
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700">Verifikasi Email</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${emailVerified
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-amber-100 text-amber-700'
                          }`}
                      >
                        {emailVerified ? 'Terverifikasi' : 'Belum'}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={logout}
                    className="w-full bg-gray-100 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-200 transition-all duration-200 font-medium text-sm flex items-center justify-center space-x-2"
                  >
                    <span>🚪</span>
                    <span>Logout</span>
                  </button>
                </div>
              </div>
              )}

              {activeSettingsMenu === 'identity' && (
              <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-lg">
                <div className="mb-4 flex items-center gap-2">
                  <School className="h-5 w-5 text-blue-600" />
                  <h2 className="text-base font-bold text-slate-900">Logo / Foto Sekolah</h2>
                </div>

                <div className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                  {logoSignedUrl ? (
                    <div className="relative aspect-video">
                      <img
                        src={logoSignedUrl}
                        alt="Logo Sekolah"
                        className="h-full w-full object-contain p-4 transition-all duration-200"
                      />
                      {uploadingLogo && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex aspect-video flex-col items-center justify-center gap-2 text-slate-400">
                      <School className="h-10 w-10 opacity-30" />
                      <p className="text-xs font-medium">Belum ada logo</p>
                    </div>
                  )}
                </div>

                {selectedLogoFile && (
                  <div className="mb-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-blue-800">
                      {selectedLogoFile.name}
                    </span>
                    <span className="shrink-0 text-[11px] text-blue-600">
                      {(selectedLogoFile.size / 1024).toFixed(0)} KB
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedLogoFile(null)}
                      className="shrink-0 text-lg leading-none text-blue-400 hover:text-blue-700"
                    >
                      x
                    </button>
                  </div>
                )}

                <FileDropzone
                  label="Pilih atau seret gambar logo"
                  onFileSelected={setSelectedLogoFile}
                  accept={{ 'image/*': ['.png', '.jpg', '.jpeg'] }}
                  className="text-sm"
                />

                <button
                  onClick={handleLogoUpload}
                  disabled={!selectedLogoFile || uploadingLogo}
                  className="mt-3 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {uploadingLogo ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Mengupload...
                    </span>
                  ) : 'Upload Logo'}
                </button>
                <p className="mt-2 text-center text-[11px] text-slate-500">PNG / JPG dikompres maks 300 KB</p>
              </div>
              )}


              {activeSettingsMenu === 'identity' && (
              <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center space-x-2">
                  <span>📋</span>
                  <span>Preview Visi &amp; Misi</span>
                </h2>

                <div className="space-y-4">
                  <div>
                    <h3 className="font-semibold text-gray-700 mb-2">Visi:</h3>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 min-h-[80px] transition-all duration-200 hover:shadow-sm">
                      {form.visi ? (
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{form.visi}</p>
                      ) : (
                        <p className="text-sm text-gray-400 italic">Belum ada visi yang ditambahkan</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <h3 className="font-semibold text-gray-700 mb-2">Misi:</h3>
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 min-h-[80px] transition-all duration-200 hover:shadow-sm">
                      {form.misi ? (
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{form.misi}</p>
                      ) : (
                        <p className="text-sm text-gray-400 italic">Belum ada misi yang ditambahkan</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              )}

              {activeSettingsMenu === 'identity' && (
              <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4 transition-all duration-200">
                  <p className="text-sm text-green-700 text-center">Semua pengaturan tersimpan otomatis &amp; bisa disinkron realtime</p>
                </div>

                <button
                  onClick={onSave}
                  disabled={saving}
                  className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-3 px-4 rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed font-semibold flex items-center justify-center space-x-2"
                >
                  {saving ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      <span>Menyimpan...</span>
                    </>
                  ) : (
                    <>
                      <span>💾</span>
                      <span>Simpan Manual (Backup)</span>
                    </>
                  )}
                </button>

                <p className="text-xs text-gray-500 text-center mt-2">Tombol backup untuk memastikan data tersimpan.</p>
              </div>
              )}

              {activeSettingsMenu === 'registration' && (
              <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center space-x-2">
                  <span>👥</span>
                  <span>Pengaturan Registrasi Publik</span>
                </h2>

                <div className="space-y-4">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                    <div className="text-sm text-blue-700">
                      <strong>Info:</strong> Pengaturan ini akan langsung tersimpan otomatis ketika diubah. Role yang tidak aktif akan disembunyikan di halaman registrasi publik.
                    </div>
                  </div>

                  <label className="flex items-center space-x-3 p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors duration-200">
                    <input
                      type="checkbox"
                      name="registrasi_siswa_aktif"
                      checked={form.registrasi_siswa_aktif}
                      onChange={handleCheckboxChange}
                      className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 transition-all duration-200"
                    />
                    <div className="flex-1">
                      <span className="text-gray-900 font-medium">Aktifkan Registrasi Siswa</span>
                      <p className="text-sm text-gray-500 mt-1">Siswa dapat membuat akun sendiri melalui halaman registrasi publik</p>
                    </div>
                    <div
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 ${form.registrasi_siswa_aktif ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}
                    >
                      {form.registrasi_siswa_aktif ? 'AKTIF' : 'NON-AKTIF'}
                    </div>
                  </label>

                  <label className="flex items-center space-x-3 p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors duration-200">
                    <input
                      type="checkbox"
                      name="registrasi_guru_aktif"
                      checked={form.registrasi_guru_aktif}
                      onChange={handleCheckboxChange}
                      className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 transition-all duration-200"
                    />
                    <div className="flex-1">
                      <span className="text-gray-900 font-medium">Aktifkan Registrasi Guru</span>
                      <p className="text-sm text-gray-500 mt-1">Guru dapat membuat akun sendiri melalui halaman registrasi publik</p>
                    </div>
                    <div
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 ${form.registrasi_guru_aktif ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}
                    >
                      {form.registrasi_guru_aktif ? 'AKTIF' : 'NON-AKTIF'}
                    </div>
                  </label>

                  <label className="flex items-center space-x-3 p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors duration-200">
                    <input
                      type="checkbox"
                      name="registrasi_admin_aktif"
                      checked={form.registrasi_admin_aktif}
                      onChange={handleCheckboxChange}
                      className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 transition-all duration-200"
                    />
                    <div className="flex-1">
                      <span className="text-gray-900 font-medium">Aktifkan Registrasi Admin</span>
                      <p className="text-sm text-gray-500 mt-1">Admin dapat membuat akun sendiri melalui halaman registrasi publik</p>
                    </div>
                    <div
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 ${form.registrasi_admin_aktif ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}
                    >
                      {form.registrasi_admin_aktif ? 'AKTIF' : 'NON-AKTIF'}
                    </div>
                  </label>

                  {form.registrasi_admin_aktif && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 transition-all duration-200">
                      <p className="text-sm text-yellow-700 font-medium">
                        ⚠️ PERINGATAN: Membuka pendaftaran admin untuk publik sangat berisiko. Hanya aktifkan jika benar-benar diperlukan dan dalam lingkungan pengembangan.
                      </p>
                    </div>
                  )}

                </div>
              </div>
              )}
            </div>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  )
}
