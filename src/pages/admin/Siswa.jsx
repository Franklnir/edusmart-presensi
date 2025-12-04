// src/pages/admin/ASiswa.jsx
import React, { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useUIStore } from '../../store/useUIStore'

/* ===== Password Modal Component ===== */
function PasswordModal({ isOpen, onClose, onConfirm, title = "Konfirmasi Password", loading = false }) {
  const [password, setPassword] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (password.trim()) {
      onConfirm(password)
      setPassword('')
    }
  }

  const handleClose = () => {
    setPassword('')
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl p-7 w-full max-w-lg mx-6">
        <h3 className="text-xl font-bold text-gray-900 mb-3">{title}</h3>
        <p className="text-gray-600 text-base mb-5">
          Untuk melanjutkan, masukkan password Anda:
        </p>

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-3 focus:ring-blue-500 focus:border-blue-500 mb-5 text-base"
            placeholder="Masukkan password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
          />

          <div className="flex justify-end space-x-4">
            <button
              type="button"
              className="px-5 py-2.5 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors duration-200 font-medium"
              onClick={handleClose}
              disabled={loading}
            >
              Batal
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:ring-3 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
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

/* ===== Password Verification Utility ===== */
const verifyPassword = async (password) => {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      throw new Error('User tidak ditemukan')
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: user.email,
      password
    })

    if (error) {
      throw new Error('Password salah')
    }

    return true
  } catch (error) {
    throw error
  }
}

/* ===== Utils ===== */
function initials(name = '?') {
  const parts = (name || '').trim().split(/\s+/).slice(0, 2)
  return parts.map(p => p[0]?.toUpperCase() || '').join('')
}

const JK_LABEL = (jk) => {
  if (!jk) return '—'
  const s = String(jk).toLowerCase()
  if (['l', 'laki', 'laki-laki', 'male'].includes(s)) return 'Laki-laki'
  if (['p', 'perempuan', 'female'].includes(s)) return 'Perempuan'
  return jk
}

const GRADE_REGEX = /^\s*(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I|\d+)/i
function getGradeRaw(kelasId = '') {
  const m = String(kelasId || '').toUpperCase().match(GRADE_REGEX)
  return m ? m[1] : ''
}

const NUM2ROMAN = {
  '1': 'I', '2': 'II', '3': 'III', '4': 'IV',
  '5': 'V', '6': 'VI', '7': 'VII', '8': 'VIII',
  '9': 'IX', '10': 'X', '11': 'XI', '12': 'XII'
}
function canonGrade(x) {
  if (!x) return ''
  const s = String(x).toUpperCase().trim()
  if (/^\d+$/.test(s)) return NUM2ROMAN[s] || s
  return s
}

function getGradeLabel(kelasId = '') {
  return canonGrade(getGradeRaw(kelasId))
}

function getKelasDisplayName(kelasObj) {
  if (!kelasObj) return ''
  return kelasObj.nama || kelasObj.id || ''
}

/* ===== Komponen Loading ===== */
function LoadingSpinner({ size = 'md', text = 'Memuat...' }) {
  const sizes = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-8 w-8' }
  return (
    <div className="flex items-center justify-center space-x-3">
      <div className={`animate-spin rounded-full border-3 border-blue-600 border-t-transparent ${sizes[size]}`} />
      {text && <span className="text-gray-600 text-base">{text}</span>}
    </div>
  )
}

/* ===== Komponen UI ===== */
function Card({ children, className = '' }) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden ${className}`}>
      {children}
    </div>
  )
}

function Badge({ children, variant = 'default', className = '' }) {
  const variants = {
    default: 'bg-gray-100 text-gray-800',
    primary: 'bg-blue-100 text-blue-800',
    success: 'bg-green-100 text-green-800',
    warning: 'bg-yellow-100 text-yellow-800',
    danger: 'bg-red-100 text-red-800',
    info: 'bg-indigo-100 text-indigo-800'
  }
  return (
    <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium ${variants[variant]} ${className}`}>
      {children}
    </span>
  )
}

function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  className = '',
  ...props
}) {
  const baseClasses = 'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-3 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'

  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
    secondary: 'bg-gray-100 text-gray-700 hover:bg-gray-200 focus:ring-gray-500 border border-gray-300',
    success: 'bg-green-600 text-white hover:bg-green-700 focus:ring-green-500',
    danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
    warning: 'bg-yellow-600 text-white hover:bg-yellow-700 focus:ring-yellow-500'
  }

  const sizes = {
    sm: 'px-4 py-2 text-sm',
    md: 'px-5 py-2.5 text-base',
    lg: 'px-6 py-3 text-lg'
  }

  return (
    <button
      className={`${baseClasses} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <div className="animate-spin rounded-full h-5 w-5 border-3 border-white border-t-transparent mr-3" />
      )}
      {children}
    </button>
  )
}

function Input({ label, error, className = '', ...props }) {
  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-semibold text-gray-700">
          {label}
        </label>
      )}
      <input
        className={`block w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-3 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white text-base ${className}`}
        {...props}
      />
      {error && <p className="text-red-600 text-sm mt-1">{error}</p>}
    </div>
  )
}

function Select({ label, error, options = [], className = '', ...props }) {
  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-semibold text-gray-700">
          {label}
        </label>
      )}
      <select
        className={`block w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-3 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white text-base ${className}`}
        {...props}
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <p className="text-red-600 text-sm mt-1">{error}</p>}
    </div>
  )
}

function StatCard({ label, value, icon, color = 'blue', description }) {
  const colorClasses = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    purple: 'bg-purple-500',
    orange: 'bg-orange-500',
    indigo: 'bg-indigo-500'
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600 mb-2">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {description && (
            <p className="text-sm text-gray-500 mt-2">{description}</p>
          )}
        </div>
        {icon && (
          <div className={`text-2xl text-white p-3 rounded-xl ${colorClasses[color]}`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  )
}

/* =======================================================================
   MAIN COMPONENT - SISWA
   ======================================================================= */
export default function ASiswa() {
  const { pushToast } = useUIStore()
  const [loadingInit, setLoadingInit] = useState(true)

  /* ===== Password Modal State ===== */
  const [passwordModal, setPasswordModal] = useState({
    isOpen: false,
    title: '',
    action: null,
    loading: false
  })

  // Data states
  const [siswaRaw, setSiswaRaw] = useState([])
  const [siswa, setSiswa] = useState([])
  const [kelasList, setKelasList] = useState([])
  const [strukturKelas, setStrukturKelas] = useState({})

  // Search fields
  const [qNama, setQNama] = useState('')
  const [qNIK, setQNIK] = useState('')
  const [qKelas, setQKelas] = useState('')
  const [qHasRfid, setQHasRfid] = useState('')
  const [qStatus, setQStatus] = useState('')
  const [isSearching, setIsSearching] = useState(false)

  // Detail modal state
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailUser, setDetailUser] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Organisasi & OSIS
  const [orgAll, setOrgAll] = useState([])
  const [orgMember, setOrgMember] = useState([])
  const [osisRow, setOsisRow] = useState(null)

  // Pindah kelas (di detail)
  const [moveKelas, setMoveKelas] = useState('')
  const [moveGrade, setMoveGrade] = useState('')

  // Form tambah siswa
  const [form, setForm] = useState({
    email: '',
    nama: '',
    kelas: '',
    nik: '',
    jk: '',
    usia: '',
    agama: '',
    alamat: '',
    telp: '',
    password: '',
    confirmPassword: ''
  })
  const [formErrors, setFormErrors] = useState({})
  const [showAddForm, setShowAddForm] = useState(false)
  const [addingSiswa, setAddingSiswa] = useState(false)

  // Hapus akun siswa
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [siswaToDelete, setSiswaToDelete] = useState(null)
  const [deletingSiswa, setDeletingSiswa] = useState(false)

  // RFID
  const [rfidInput, setRfidInput] = useState('')
  const [rfidEnrolling, setRfidEnrolling] = useState(false)
  const [rfidLastScan, setRfidLastScan] = useState(null)
  const [rfidChannel, setRfidChannel] = useState(null)

  // Nonaktifkan siswa
  const [nonaktifModalOpen, setNonaktifModalOpen] = useState(false)
  const [alasanNonaktif, setAlasanNonaktif] = useState('')
  const [siswaToNonaktif, setSiswaToNonaktif] = useState(null)

  // Aktifkan siswa
  const [aktifkanModalOpen, setAktifkanModalOpen] = useState(false)
  const [siswaToAktifkan, setSiswaToAktifkan] = useState(null)

  // Kenaikan kelas massal
  const [promotionModalOpen, setPromotionModalOpen] = useState(false)
  const [promotionMode, setPromotionMode] = useState('kelas') // 'kelas' | 'selected'
  const [promotionFromKelas, setPromotionFromKelas] = useState('')
  const [promotionToKelas, setPromotionToKelas] = useState('')
  const [promotionLoading, setPromotionLoading] = useState(false)
  const [promotionFilterGrade, setPromotionFilterGrade] = useState('')
  const [promotionFilterKelas, setPromotionFilterKelas] = useState('')
  const [promotionSelectedIds, setPromotionSelectedIds] = useState([])

  // Cleanup channel
  useEffect(() => {
    return () => {
      if (rfidChannel) {
        supabase.removeChannel(rfidChannel)
      }
    }
  }, [rfidChannel])

  /* ===== Password Modal Functions ===== */
  const openPasswordModal = (title, action) => {
    setPasswordModal({
      isOpen: true,
      title,
      action,
      loading: false
    })
  }

  const handlePasswordConfirm = async (password) => {
    setPasswordModal(prev => ({ ...prev, loading: true }))

    try {
      await verifyPassword(password)
      if (passwordModal.action) {
        await passwordModal.action()
      }
      setPasswordModal({ isOpen: false, title: '', action: null, loading: false })
    } catch (error) {
      console.error('Password verification failed:', error)
      pushToast('error', error.message || 'Password salah')
      setPasswordModal(prev => ({ ...prev, loading: false }))
    }
  }

  const closePasswordModal = () => {
    setPasswordModal({ isOpen: false, title: '', action: null, loading: false })
  }

  /* ===== Load initial data ===== */
  useEffect(() => {
    loadAllData()
  }, [])

  const loadAllData = async () => {
    try {
      setLoadingInit(true)
      await Promise.all([
        loadSiswaRaw(),
        loadKelasList(),
        loadStrukturKelas()
      ])
    } catch (error) {
      console.error('Error loading data:', error)
      pushToast('error', 'Gagal memuat data')
    } finally {
      setLoadingInit(false)
    }
  }

  const loadSiswaRaw = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'siswa')
      .order('kelas')
      .order('nama')

    if (error) throw error
    setSiswaRaw(data || [])
    setSiswa(data || [])
  }

  const loadKelasList = async () => {
    const { data, error } = await supabase
      .from('kelas')
      .select('*')
      .order('grade')
      .order('suffix')

    if (error) throw error
    setKelasList(data || [])
  }

  const loadStrukturKelas = async () => {
    const { data, error } = await supabase
      .from('kelas_struktur')
      .select('*')

    if (error) throw error

    const struktur = {}
    data?.forEach(item => {
      struktur[item.kelas_id] = item
    })
    setStrukturKelas(struktur)
  }

  // Opsi kelas untuk Select
  const kelasOptions = useMemo(() => {
    return kelasList.map(kelas => ({
      value: kelas.id,
      label: getKelasDisplayName(kelas),
      grade: kelas.grade
    }))
  }, [kelasList])

  const getNamaKelas = (kelasId) => {
    const kelas = kelasList.find(k => k.id === kelasId)
    return getKelasDisplayName(kelas) || kelasId || '—'
  }

  // Cek ketua kelas
  const isKetuaKelas = (siswaId) => {
    return Object.values(strukturKelas).some(
      struktur => struktur.ketua_siswa_id === siswaId
    )
  }

  const getKelasKetua = (siswaId) => {
    const struktur = Object.values(strukturKelas).find(
      s => s.ketua_siswa_id === siswaId
    )
    return struktur ? getNamaKelas(struktur.kelas_id) : null
  }

  /* ===== Statistik dashboard ===== */
  const stats = useMemo(() => {
    const totalSiswa = siswaRaw.length
    const aktifSiswa = siswaRaw.filter(s => s.status === 'active').length
    const nonaktifSiswa = siswaRaw.filter(s => s.status === 'nonaktif').length
    const ketuaKelas = siswaRaw.filter(s => isKetuaKelas(s.id)).length

    return {
      totalSiswa,
      aktifSiswa,
      nonaktifSiswa,
      ketuaKelas
    }
  }, [siswaRaw, strukturKelas])

  /* ===== Filter ===== */
  function applyFilter() {
    setIsSearching(true)
    setTimeout(() => {
      const namaNeedle = qNama.trim().toLowerCase()
      const nikNeedle = qNIK.trim().toLowerCase()
      const kelasNeedle = qKelas.trim().toLowerCase()
      const hasRfidNeedle = qHasRfid
      const statusNeedle = qStatus

      const res = siswaRaw.filter(s => {
        const okNama = namaNeedle
          ? (String(s.nama || '').toLowerCase().includes(namaNeedle) ||
            String(s.email || '').toLowerCase().includes(namaNeedle))
          : true

        const okNik = nikNeedle
          ? (String(s.nik || '').toLowerCase().includes(nikNeedle))
          : true

        const okKls = kelasNeedle
          ? (String(s.kelas || '').toLowerCase() === kelasNeedle)
          : true

        const hasRfid = !!s.rfid_uid
        const okRfid =
          hasRfidNeedle === ''
            ? true
            : hasRfidNeedle === 'yes'
              ? hasRfid
              : !hasRfid

        const okStatus = statusNeedle === ''
          ? true
          : s.status === statusNeedle

        return okNama && okNik && okKls && okRfid && okStatus
      })

      setSiswa(res)
      setIsSearching(false)
    }, 250)
  }

  function resetFilter() {
    setQNama('')
    setQNIK('')
    setQKelas('')
    setQHasRfid('')
    setQStatus('')
    setSiswa(siswaRaw)
  }

  // Auto apply filter ketika state berubah
  useEffect(() => {
    applyFilter()
  }, [qNama, qNIK, qKelas, qHasRfid, qStatus])

  /* ===== Grade helpers ===== */
  const DEFAULT_GRADES = ['VII', 'VIII', 'IX', 'X', 'XI', 'XII']
  const gradeLabels = useMemo(() => {
    const s = new Set(DEFAULT_GRADES)
    for (const k of kelasList) {
      const g = getGradeLabel(k.id)
      if (g) s.add(g)
    }
    const order = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
    return [...s].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  }, [kelasList])

  function kelasByGrade(g) {
    const G = canonGrade(g)
    if (!G) return []
    return kelasList.filter(k => getGradeLabel(k.id) === G)
  }

  /* ===== Kandidat & pilihan siswa di modal kenaikan kelas (manual) ===== */
  const promotionCandidateSiswa = useMemo(() => {
    let list = siswaRaw

    if (promotionFilterGrade) {
      list = list.filter(s => getGradeLabel(s.kelas || '') === promotionFilterGrade)
    }

    if (promotionFilterKelas) {
      list = list.filter(s => s.kelas === promotionFilterKelas)
    }

    return [...list].sort((a, b) => {
      const kelasA = getNamaKelas(a.kelas)
      const kelasB = getNamaKelas(b.kelas)
      if (kelasA !== kelasB) return kelasA.localeCompare(kelasB)
      return (a.nama || '').localeCompare(b.nama || '')
    })
  }, [siswaRaw, promotionFilterGrade, promotionFilterKelas, kelasList])

  const togglePromotionSelect = (id) => {
    setPromotionSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const togglePromotionSelectAllVisible = () => {
    const visibleIds = promotionCandidateSiswa.map(s => s.id)
    if (!visibleIds.length) return

    const allSelected = visibleIds.every(id => promotionSelectedIds.includes(id))
    if (allSelected) {
      setPromotionSelectedIds(prev => prev.filter(id => !visibleIds.includes(id)))
    } else {
      setPromotionSelectedIds(prev => [...new Set([...prev, ...visibleIds])])
    }
  }

  const openPromotionModal = () => {
    openPasswordModal(
      'Fitur Kenaikan Kelas',
      () => {
        setPromotionMode('kelas')
        setPromotionFromKelas('')
        setPromotionToKelas('')
        setPromotionFilterGrade('')
        setPromotionFilterKelas('')
        setPromotionSelectedIds([])
        setPromotionModalOpen(true)
      }
    )
  }

  const closePromotionModal = () => {
    setPromotionModalOpen(false)
    setPromotionLoading(false)
    setPromotionFromKelas('')
    setPromotionToKelas('')
    setPromotionFilterGrade('')
    setPromotionFilterKelas('')
    setPromotionSelectedIds([])
  }

  const handlePromotion = async () => {
    try {
      if (!promotionToKelas) {
        pushToast('error', 'Pilih kelas tujuan terlebih dahulu')
        return
      }

      let ids = []
      let infoText = ''

      if (promotionMode === 'kelas') {
        if (!promotionFromKelas) {
          pushToast('error', 'Pilih kelas asal terlebih dahulu')
          return
        }
        if (promotionFromKelas === promotionToKelas) {
          pushToast('error', 'Kelas asal dan tujuan tidak boleh sama')
          return
        }

        const siswaInKelas = siswaRaw.filter(s => s.kelas === promotionFromKelas)
        if (!siswaInKelas.length) {
          pushToast('error', 'Tidak ada siswa di kelas asal tersebut')
          return
        }

        ids = siswaInKelas.map(s => s.id)
        const fromGrade = getGradeLabel(promotionFromKelas)
        const toGrade = getGradeLabel(promotionToKelas)

        infoText =
          `Anda akan memindahkan ${ids.length} siswa\n` +
          `Dari : ${getNamaKelas(promotionFromKelas)} (${fromGrade || '-'})\n` +
          `Ke   : ${getNamaKelas(promotionToKelas)} (${toGrade || '-'})`

        if (fromGrade && toGrade && fromGrade !== toGrade) {
          infoText +=
            `\n\n⚠️ PERHATIAN:\n` +
            `Ini termasuk pindah tingkatan (grade) dari ${fromGrade} ke ${toGrade}.`
        }
      } else {
        if (!promotionSelectedIds.length) {
          pushToast('error', 'Belum ada siswa yang dipilih untuk dipindahkan')
          return
        }

        ids = [...promotionSelectedIds]

        const selectedSiswa = siswaRaw.filter(s => promotionSelectedIds.includes(s.id))
        const targetGrade = getGradeLabel(promotionToKelas)
        const gradesSet = new Set(selectedSiswa.map(s => getGradeLabel(s.kelas || '')))
        const gradeList = [...gradesSet].filter(Boolean)

        infoText =
          `Anda akan memindahkan ${ids.length} siswa terpilih\n` +
          `Ke   : ${getNamaKelas(promotionToKelas)} (${targetGrade || '-'})`

        if (gradeList.length === 1 && gradeList[0] && gradeList[0] !== targetGrade) {
          infoText +=
            `\n\n⚠️ PERHATIAN:\n` +
            `Semua siswa berasal dari grade ${gradeList[0]} dan akan dipindah ke grade ${targetGrade}.`
        } else if (gradeList.length > 1) {
          infoText +=
            `\n\n⚠️ PERHATIAN:\n` +
            `Siswa berasal dari beberapa grade: ${gradeList.join(', ')}.`
        }
      }

      const ok = window.confirm(
        infoText +
        `\n\nDampak:\n` +
        `• Data absensi SELANJUTNYA mengikuti kelas baru\n` +
        `• Data organisasi, tugas, dan nilai tetap sama\n` +
        `• Status ketua kelas akan direset jika ada`
      )
      if (!ok) return

      setPromotionLoading(true)

      const { error } = await supabase
        .from('profiles')
        .update({ kelas: promotionToKelas })
        .in('id', ids)

      if (error) throw error

      // Reset ketua kelas jika ada
      const { error: strukturError } = await supabase
        .from('kelas_struktur')
        .update({ ketua_siswa_id: null, ketua_siswa_nama: null })
        .in('ketua_siswa_id', ids)

      if (strukturError) {
        console.warn('Error reset ketua kelas:', strukturError)
      }

      pushToast('success', `Berhasil memindahkan ${ids.length} siswa`)
      closePromotionModal()
      loadSiswaRaw()
      loadStrukturKelas()
    } catch (err) {
      console.error('Error kenaikan kelas:', err)
      pushToast('error', 'Gagal memproses kenaikan kelas')
      setPromotionLoading(false)
    }
  }

  /* ===== Detail modal ===== */
  const openDetail = (u) => {
    openPasswordModal(
      'Konfirmasi Lihat Detail Siswa',
      async () => {
        setRfidInput((u.rfid_uid || '').toUpperCase())
        setRfidLastScan(null)
        setRfidEnrolling(false)
        if (rfidChannel) {
          supabase.removeChannel(rfidChannel)
          setRfidChannel(null)
        }

        setDetailUser(u)
        setMoveKelas(u.kelas || '')
        setMoveGrade(getGradeLabel(u.kelas || '') || '')
        setDetailLoading(true)
        setDetailOpen(true)

        try {
          const { data: orgData, error: orgError } = await supabase
            .from('organisasi')
            .select('*')

          if (orgError) throw orgError

          const all = orgData?.map(o => ({ id: o.id, nama: o.nama || o.id })) || []
          setOrgAll(all)

          const { data: orgAnggotaData, error: orgAnggotaError } = await supabase
            .from('organisasi_anggota')
            .select('*')
            .eq('siswa_id', u.id)

          if (orgAnggotaError) throw orgAnggotaError

          const mine = orgAnggotaData?.map(a => ({
            orgId: a.organisasi_id,
            orgNama: all.find(o => o.id === a.organisasi_id)?.nama || a.organisasi_id,
            status: a.status || 'aktif',
            bagian: a.bagian || '',
            jabatan: a.jabatan || 'Anggota'
          })) || []

          setOrgMember(mine)

          const { data: osisData, error: osisError } = await supabase
            .from('osis_anggota')
            .select('*')
            .eq('siswa_id', u.id)
            .single()

          if (osisError && osisError.code !== 'PGRST116') throw osisError

          const row = osisData ? {
            status: osisData.status || 'aktif',
            bagian: osisData.bagian || '',
            jabatan: osisData.jabatan || 'Anggota'
          } : null
          setOsisRow(row)

        } catch (error) {
          console.error('Error loading detail:', error)
          pushToast('error', 'Gagal memuat detail siswa')
        } finally {
          setDetailLoading(false)
        }
      }
    )
  }

  // Auto pilih kelas ketika grade dipilih (detail modal)
  useEffect(() => {
    if (!detailOpen) return
    const currentGrade = getGradeLabel(detailUser?.kelas || '')
    if (currentGrade) return
    if (!moveGrade) return
    const opts = kelasByGrade(moveGrade)
    if (!opts.length) return
    if (!moveKelas) setMoveKelas(opts[0].id)
  }, [detailOpen, moveGrade, kelasList, detailUser, moveKelas])

  function closeDetailModal() {
    setDetailOpen(false)
    setDetailUser(null)
    setRfidInput('')
    setRfidLastScan(null)
    setRfidEnrolling(false)
    if (rfidChannel) {
      supabase.removeChannel(rfidChannel)
      setRfidChannel(null)
    }
  }

  /* ===== Detail: actions (kelas & status) ===== */
  async function simpanPindahKelas() {
    const user = detailUser
    const target = moveKelas || ''
    if (!user || !target) return

    const originalGrade = getGradeLabel(user.kelas || '')
    const targetGrade = getGradeLabel(target || '')

    const isCrossGrade =
      originalGrade && targetGrade && originalGrade !== targetGrade

    const konfirmasi = window.confirm(
      `Yakin ingin mengubah kelas siswa?\n\n` +
      `Siswa : ${user.nama}\n` +
      `Dari   : ${getNamaKelas(user.kelas) || 'Tidak ada kelas'} (${originalGrade || '-'})\n` +
      `Ke     : ${getNamaKelas(target)} (${targetGrade || '-'})\n\n` +
      `Dampak perubahan:\n` +
      `• Data absensi SELANJUTNYA akan mengikuti kelas baru\n` +
      `• Data organisasi tetap sama\n` +
      `• Data tugas dan nilai tetap sama\n` +
      `• Status ketua kelas akan direset jika ada` +
      (isCrossGrade
        ? `\n\n⚠️ PERHATIAN:\n` +
          `Ini termasuk pindah tingkatan (grade) dari ${originalGrade} ke ${targetGrade}.\n` +
          `Pastikan ini memang kenaikan kelas / perbaikan salah kelas.`
        : '')
    )

    if (!konfirmasi) return

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ kelas: target })
        .eq('id', user.id)

      if (error) throw error

      if (isKetuaKelas(user.id)) {
        const strukturLama = Object.values(strukturKelas).find(
          s => s.ketua_siswa_id === user.id
        )
        if (strukturLama) {
          await supabase
            .from('kelas_struktur')
            .update({
              ketua_siswa_id: null,
              ketua_siswa_nama: null
            })
            .eq('kelas_id', strukturLama.kelas_id)
        }
      }

      pushToast('success', 'Kelas berhasil diupdate')
      setDetailUser(prev => prev ? ({ ...prev, kelas: target }) : prev)
      loadSiswaRaw()
      loadStrukturKelas()
    } catch (error) {
      console.error('Error updating kelas:', error)
      pushToast('error', 'Gagal mengupdate kelas')
    }
  }

  async function kosongkanKelas() {
    const user = detailUser
    if (!user) return
    if (!window.confirm(`Yakin mau dikosongkan kelas untuk ${user.nama || user.email || user.id}?`)) return

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ kelas: '' })
        .eq('id', user.id)

      if (error) throw error

      pushToast('success', 'Kelas berhasil dikosongkan')
      setMoveKelas('')
      setDetailUser(prev => prev ? ({ ...prev, kelas: '' }) : prev)
      loadSiswaRaw()
    } catch (error) {
      console.error('Error clearing kelas:', error)
      pushToast('error', 'Gagal mengosongkan kelas')
    }
  }

  /* ===== Nonaktifkan & Aktifkan Siswa ===== */
  const openNonaktifModal = (siswa) => {
    openPasswordModal(
      'Konfirmasi Nonaktifkan Siswa',
      () => {
        setSiswaToNonaktif(siswa)
        setAlasanNonaktif('')
        setNonaktifModalOpen(true)
      }
    )
  }

  const openAktifkanModal = (siswa) => {
    openPasswordModal(
      'Konfirmasi Aktifkan Siswa',
      () => {
        setSiswaToAktifkan(siswa)
        setAktifkanModalOpen(true)
      }
    )
  }

  const nonaktifkanSiswa = () => {
    if (!siswaToNonaktif) return

    if (!alasanNonaktif.trim()) {
      pushToast('error', 'Harap masukkan alasan penonaktifan')
      return
    }

    openPasswordModal(
      'Konfirmasi Akhir Nonaktifkan Siswa',
      async () => {
        try {
          const { error } = await supabase
            .from('profiles')
            .update({
              status: 'nonaktif',
              alasan_nonaktif: alasanNonaktif,
              disabled_at: new Date().toISOString()
            })
            .eq('id', siswaToNonaktif.id)

          if (error) throw error

          pushToast('success', 'Siswa berhasil dinonaktifkan')

          if (detailUser && detailUser.id === siswaToNonaktif.id) {
            setDetailUser(prev => prev ? ({
              ...prev,
              status: 'nonaktif',
              alasan_nonaktif: alasanNonaktif
            }) : prev)
          }

          setNonaktifModalOpen(false)
          setAlasanNonaktif('')
          setSiswaToNonaktif(null)
          loadSiswaRaw()
        } catch (error) {
          console.error('Error nonaktifkan siswa:', error)
          pushToast('error', 'Gagal menonaktifkan siswa')
        }
      }
    )
  }

  const aktifkanSiswa = () => {
    if (!siswaToAktifkan) return

    openPasswordModal(
      'Konfirmasi Akhir Aktifkan Siswa',
      async () => {
        try {
          const { error } = await supabase
            .from('profiles')
            .update({
              status: 'active',
              alasan_nonaktif: null,
              disabled_at: null
            })
            .eq('id', siswaToAktifkan.id)

          if (error) throw error

          pushToast('success', 'Siswa berhasil diaktifkan')

          if (detailUser && detailUser.id === siswaToAktifkan.id) {
            setDetailUser(prev => prev ? ({
              ...prev,
              status: 'active',
              alasan_nonaktif: null
            }) : prev)
          }

          setAktifkanModalOpen(false)
          setSiswaToAktifkan(null)
          loadSiswaRaw()
        } catch (error) {
          console.error('Error mengaktifkan siswa:', error)
          pushToast('error', 'Gagal mengaktifkan siswa')
        }
      }
    )
  }

  /* ===== RFID ===== */
  function toggleRfidListen() {
    if (rfidEnrolling) {
      if (rfidChannel) {
        supabase.removeChannel(rfidChannel)
        setRfidChannel(null)
      }
      setRfidEnrolling(false)
      pushToast('info', 'Mode scan RFID dimatikan')
      return
    }

    const channel = supabase
      .channel('rfid-scans-detail')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'rfid_scans' },
        (payload) => {
          const uid = (payload.new.card_uid || '').toUpperCase().replace(/\s+/g, '')
          setRfidInput(uid)
          setRfidLastScan(payload.new)
          pushToast('success', `UID RFID terdeteksi: ${uid}`)
        }
      )
      .subscribe()

    setRfidChannel(channel)
    setRfidEnrolling(true)
    pushToast('info', 'Mode scan aktif. Silakan tap kartu di reader.')
  }

  async function saveRfid() {
    if (!detailUser) return
    const raw = (rfidInput || '').trim()
    const cleaned = raw.toUpperCase().replace(/\s+/g, '')

    if (!cleaned) {
      pushToast('error', 'UID RFID tidak boleh kosong')
      return
    }

    if (!/^[0-9A-F]{8,14}$/.test(cleaned)) {
      pushToast('error', 'Format UID RFID tidak valid. Harus 8-14 karakter hexadecimal (0-9, A-F)')
      return
    }

    try {
      const { data: existingRows, error: exError } = await supabase
        .from('profiles')
        .select('id, nama, email')
        .eq('rfid_uid', cleaned)
        .neq('id', detailUser.id)

      if (exError) throw exError
      if (existingRows && existingRows.length > 0) {
        const other = existingRows[0]
        pushToast('error',
          `UID ${cleaned} sudah terdaftar untuk siswa:\n` +
          `${other.nama || 'Tanpa nama'} (${other.email || 'Tanpa email'})`
        )
        return
      }

      const { error } = await supabase
        .from('profiles')
        .update({ rfid_uid: cleaned })
        .eq('id', detailUser.id)

      if (error) throw error

      pushToast('success', 'UID RFID berhasil disimpan')
      setDetailUser(prev => prev ? { ...prev, rfid_uid: cleaned } : prev)
      setSiswaRaw(prev => prev.map(s => s.id === detailUser.id ? { ...s, rfid_uid: cleaned } : s))
      setSiswa(prev => prev.map(s => s.id === detailUser.id ? { ...s, rfid_uid: cleaned } : s))
    } catch (err) {
      console.error('Error saving RFID:', err)
      pushToast('error', 'Gagal menyimpan UID RFID')
    }
  }

  async function clearRfid() {
    if (!detailUser) return
    if (!detailUser.rfid_uid && !rfidInput) return

    if (!window.confirm('Yakin ingin mengosongkan UID RFID untuk siswa ini?')) return

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ rfid_uid: null })
        .eq('id', detailUser.id)

      if (error) throw error

      pushToast('success', 'UID RFID dikosongkan')
      setRfidInput('')
      setDetailUser(prev => prev ? { ...prev, rfid_uid: null } : prev)
      setSiswaRaw(prev => prev.map(s => s.id === detailUser.id ? { ...s, rfid_uid: null } : s))
      setSiswa(prev => prev.map(s => s.id === detailUser.id ? { ...s, rfid_uid: null } : s))
    } catch (err) {
      console.error('Error clearing RFID:', err)
      pushToast('error', 'Gagal mengosongkan UID RFID')
    }
  }

  /* ===== Organisasi / OSIS ===== */
  async function hapusOrg(orgId) {
    const u = detailUser
    if (!u) return
    if (!window.confirm('Yakin mau dihapus dari organisasi ini?')) return

    try {
      const { error } = await supabase
        .from('organisasi_anggota')
        .delete()
        .eq('organisasi_id', orgId)
        .eq('siswa_id', u.id)

      if (error) throw error

      pushToast('success', 'Berhasil dihapus dari organisasi')
      setOrgMember(prev => prev.filter(x => x.orgId !== orgId))
    } catch (error) {
      console.error('Error deleting org:', error)
      pushToast('error', 'Gagal menghapus dari organisasi')
    }
  }

  async function hapusOsis() {
    const u = detailUser
    if (!u) return
    if (!window.confirm('Yakin mau dihapus dari OSIS?')) return

    try {
      const { error } = await supabase
        .from('osis_anggota')
        .delete()
        .eq('siswa_id', u.id)

      if (error) throw error

      pushToast('success', 'Berhasil dihapus dari OSIS')
      setOsisRow(null)
    } catch (error) {
      console.error('Error deleting OSIS:', error)
      pushToast('error', 'Gagal menghapus dari OSIS')
    }
  }

  /* ===== Hapus Akun Siswa ===== */
  function openDeleteConfirm(siswa) {
    openPasswordModal(
      'Konfirmasi Hapus Akun Siswa',
      () => {
        setSiswaToDelete(siswa)
        setDeleteConfirmOpen(true)
      }
    )
  }

  function closeDeleteConfirm() {
    setDeleteConfirmOpen(false)
    setSiswaToDelete(null)
  }

  const hapusAkunSiswa = () => {
    if (!siswaToDelete) return

    openPasswordModal(
      'Konfirmasi Akhir Hapus Akun Siswa',
      async () => {
        try {
          setDeletingSiswa(true)

          await supabase.from('organisasi_anggota').delete().eq('siswa_id', siswaToDelete.id)
          await supabase.from('osis_anggota').delete().eq('siswa_id', siswaToDelete.id)
          await supabase.from('ekskul_anggota').delete().eq('user_id', siswaToDelete.id)
          await supabase.from('anggota_ekskul').delete().eq('user_id', siswaToDelete.id)
          await supabase.from('tugas_jawaban').delete().eq('user_id', siswaToDelete.id)
          await supabase.from('absensi').delete().eq('uid', siswaToDelete.id)
          await supabase.from('absensi_ajuan').delete().eq('uid', siswaToDelete.id)

          await supabase
            .from('kelas_struktur')
            .update({ ketua_siswa_id: null, ketua_siswa_nama: null })
            .eq('ketua_siswa_id', siswaToDelete.id)

          const { error: profileError } = await supabase
            .from('profiles')
            .delete()
            .eq('id', siswaToDelete.id)

          if (profileError) throw profileError

          try {
            const { error: authError } = await supabase.auth.admin.deleteUser(
              siswaToDelete.id
            )

            if (authError) {
              console.warn('Gagal menghapus dari authentication, tetapi lanjutkan:', authError)
              pushToast('warning', 'Akun siswa dihapus, tetapi ada masalah dengan authentication. Silakan coba lagi nanti.')
            } else {
              pushToast('success', 'Akun siswa berhasil dihapus sepenuhnya')
            }
          } catch (authErr) {
            console.warn('Error saat menghapus dari auth:', authErr)
            pushToast('warning', 'Akun siswa dihapus dari database, tetapi ada masalah dengan authentication.')
          }

          closeDeleteConfirm()
          if (detailOpen) closeDetailModal()
          loadAllData()
        } catch (error) {
          console.error('Error deleting siswa:', error)
          pushToast('error', 'Gagal menghapus akun siswa: ' + (error.message || 'Unknown error'))
        } finally {
          setDeletingSiswa(false)
        }
      }
    )
  }

  /* ===== Tambah Siswa ===== */
  const validateForm = () => {
    const errors = {}

    if (!form.email.trim()) errors.email = 'Email harus diisi'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.email = 'Format email tidak valid'

    if (!form.nama.trim()) errors.nama = 'Nama lengkap harus diisi'
    if (!form.password) errors.password = 'Password harus diisi'
    else if (form.password.length < 6) errors.password = 'Password minimal 6 karakter'

    if (form.password !== form.confirmPassword) errors.confirmPassword = 'Password dan konfirmasi tidak sama'
    if (form.nik && !/^\d+$/.test(form.nik)) errors.nik = 'NIK harus berupa angka'
    if (form.usia && (form.usia < 5 || form.usia > 25)) errors.usia = 'Usia harus antara 5-25 tahun'
    if (form.telp && !/^[\d\s\+-]+$/.test(form.telp)) errors.telp = 'Format telepon tidak valid'

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))

    if (formErrors[name]) {
      setFormErrors(prev => ({ ...prev, [name]: '' }))
    }
  }

  const resetForm = () => {
    setForm({
      email: '',
      nama: '',
      kelas: '',
      nik: '',
      jk: '',
      usia: '',
      agama: '',
      alamat: '',
      telp: '',
      password: '',
      confirmPassword: ''
    })
    setFormErrors({})
  }

  const handleAdd = async () => {
    if (!validateForm()) return

    try {
      setAddingSiswa(true)

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: form.email.trim().toLowerCase(),
        password: form.password,
        options: {
          data: {
            nama: form.nama.trim(),
            role: 'siswa'
          }
        }
      })

      if (authError) {
        if (authError.message.includes('User already registered')) {
          throw new Error('Email sudah terdaftar')
        }
        throw authError
      }

      const { error } = await supabase.from('profiles').insert({
        id: authData.user.id,
        email: form.email.trim().toLowerCase(),
        nama: form.nama.trim(),
        kelas: form.kelas || '',
        nik: form.nik || '',
        jk: form.jk || '',
        usia: form.usia ? parseInt(form.usia) : null,
        agama: form.agama || '',
        alamat: form.alamat || '',
        telp: form.telp || '',
        role: 'siswa',
        status: 'active',
        created_at: new Date().toISOString()
      })

      if (error) throw error

      pushToast('success', 'Siswa berhasil didaftarkan')
      resetForm()
      setShowAddForm(false)
      loadSiswaRaw()
    } catch (error) {
      console.error(error)
      pushToast('error', 'Gagal mendaftarkan siswa: ' + (error.message || 'Unknown error'))
    } finally {
      setAddingSiswa(false)
    }
  }

  /* ===== Render ===== */
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="w-full px-6 py-6 space-y-6">
        {/* Password Modal */}
        <PasswordModal
          isOpen={passwordModal.isOpen}
          onClose={closePasswordModal}
          onConfirm={handlePasswordConfirm}
          title={passwordModal.title}
          loading={passwordModal.loading}
        />

        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-5">
              <div className="p-4 bg-blue-100 rounded-xl">
                <span className="text-3xl text-blue-600">👨‍🎓</span>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Manajemen Siswa</h1>
                <p className="text-gray-600 text-lg">
                  Kelola data siswa, kelas, organisasi, OSIS, dan kartu RFID
                </p>
              </div>
            </div>

            {/* Tombol aksi kanan */}
            <div className="mt-5 lg:mt-0 flex flex-col sm:flex-row gap-3">
              <button
                className="bg-indigo-50 text-indigo-700 px-5 py-3 rounded-xl border border-indigo-200 hover:bg-indigo-100 focus:ring-3 focus:ring-indigo-500 focus:ring-offset-2 transition-all duration-200 font-medium shadow-sm hover:shadow-md"
                onClick={openPromotionModal}
              >
                ⬆️ Kenaikan Kelas
              </button>
              <button
                className="bg-blue-600 text-white px-5 py-3 rounded-xl hover:bg-blue-700 focus:ring-3 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 font-medium shadow-sm hover:shadow-md"
                onClick={() => setShowAddForm(!showAddForm)}
              >
                {showAddForm ? '✕ Tutup Form' : '➕ Tambah Siswa'}
              </button>
            </div>
          </div>
        </div>

        {/* Dashboard Statistics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
          <StatCard
            label="Total Siswa"
            value={stats.totalSiswa}
            icon="👨‍🎓"
            color="blue"
            description="Semua siswa terdaftar"
          />
          <StatCard
            label="Siswa Aktif"
            value={stats.aktifSiswa}
            icon="✅"
            color="green"
            description="Sedang aktif belajar"
          />
          <StatCard
            label="Siswa Nonaktif"
            value={stats.nonaktifSiswa}
            icon="⏸️"
            color="orange"
            description="Tidak aktif sementara"
          />
          <StatCard
            label="Ketua Kelas"
            value={stats.ketuaKelas}
            icon="👑"
            color="indigo"
            description="Siswa yang menjadi ketua"
          />
        </div>

        {/* Form Tambah Siswa */}
        {showAddForm && (
          <Card className="mb-6">
            <div className="bg-blue-50 border-b border-blue-200 p-5">
              <h3 className="text-xl font-semibold text-blue-900 flex items-center gap-3">
                <span className="text-2xl">➕</span>
                Tambah Siswa Baru
              </h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <Input
                  label="Email *"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="email@sekolah.sch.id"
                  type="email"
                  error={formErrors.email}
                  required
                />
                <Input
                  label="Nama Lengkap *"
                  name="nama"
                  value={form.nama}
                  onChange={handleChange}
                  placeholder="Nama lengkap siswa"
                  error={formErrors.nama}
                  required
                />
                <Select
                  label="Kelas"
                  name="kelas"
                  value={form.kelas}
                  onChange={handleChange}
                  options={[
                    { value: '', label: 'Pilih kelas' },
                    ...kelasOptions.map(k => ({ value: k.value, label: k.label }))
                  ]}
                />
                <Input
                  label="NIK"
                  name="nik"
                  value={form.nik}
                  onChange={handleChange}
                  placeholder="Nomor Induk Siswa"
                  error={formErrors.nik}
                />
                <Select
                  label="Jenis Kelamin"
                  name="jk"
                  value={form.jk}
                  onChange={handleChange}
                  options={[
                    { value: '', label: 'Pilih jenis kelamin' },
                    { value: 'L', label: 'Laki-laki' },
                    { value: 'P', label: 'Perempuan' }
                  ]}
                />
                <Input
                  label="Usia"
                  name="usia"
                  value={form.usia}
                  onChange={handleChange}
                  placeholder="Usia dalam tahun"
                  type="number"
                  min="5"
                  max="25"
                  error={formErrors.usia}
                />
                <Input
                  label="Agama"
                  name="agama"
                  value={form.agama}
                  onChange={handleChange}
                  placeholder="Agama"
                />
                <Input
                  label="Telepon"
                  name="telp"
                  value={form.telp}
                  onChange={handleChange}
                  placeholder="Nomor telepon"
                  error={formErrors.telp}
                />
                <div className="lg:col-span-3">
                  <Input
                    label="Alamat"
                    name="alamat"
                    value={form.alamat}
                    onChange={handleChange}
                    placeholder="Alamat lengkap"
                  />
                </div>
                <Input
                  label="Password *"
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  placeholder="Password minimal 6 karakter"
                  type="password"
                  error={formErrors.password}
                  required
                />
                <Input
                  label="Konfirmasi Password *"
                  name="confirmPassword"
                  value={form.confirmPassword}
                  onChange={handleChange}
                  placeholder="Ulangi password"
                  type="password"
                  error={formErrors.confirmPassword}
                  required
                />
              </div>

              <div className="flex justify-end space-x-4 mt-6 pt-6 border-t border-gray-200">
                <Button
                  variant="secondary"
                  onClick={resetForm}
                  size="lg"
                >
                  🔄 Reset
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setShowAddForm(false)}
                  size="lg"
                >
                  ✕ Batal
                </Button>
                <Button
                  onClick={handleAdd}
                  loading={addingSiswa}
                  size="lg"
                  disabled={
                    !form.email ||
                    !form.nama ||
                    !form.password ||
                    form.password !== form.confirmPassword
                  }
                >
                  👨‍🎓 Daftarkan
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Filter Section */}
        <Card>
          <div className="bg-gray-50 border-b border-gray-200 p-5">
            <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-3">
              <span className="text-2xl">🔍</span>
              Filter Pencarian
            </h3>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
              <Input
                label="Nama / Email"
                placeholder="Cari nama atau email"
                value={qNama}
                onChange={e => setQNama(e.target.value)}
              />
              <Input
                label="NIK"
                placeholder="Cari NIK"
                value={qNIK}
                onChange={e => setQNIK(e.target.value)}
              />
              <Select
                label="Kelas"
                value={qKelas}
                onChange={e => setQKelas(e.target.value)}
                options={[
                  { value: '', label: 'Semua Kelas' },
                  ...kelasOptions.map(k => ({ value: k.value, label: k.label }))
                ]}
              />
              <Select
                label="Status RFID"
                value={qHasRfid}
                onChange={e => setQHasRfid(e.target.value)}
                options={[
                  { value: '', label: 'Semua' },
                  { value: 'yes', label: 'Sudah punya RFID' },
                  { value: 'no', label: 'Belum punya RFID' }
                ]}
              />
              <Select
                label="Status Akun"
                value={qStatus}
                onChange={e => setQStatus(e.target.value)}
                options={[
                  { value: '', label: 'Semua Status' },
                  { value: 'active', label: 'Aktif' },
                  { value: 'nonaktif', label: 'Nonaktif' }
                ]}
              />
            </div>
            <div className="flex justify-end space-x-4 mt-6">
              <Button
                onClick={applyFilter}
                loading={isSearching}
                size="lg"
              >
                🔍 Cari Siswa
              </Button>
              <Button
                variant="secondary"
                onClick={resetFilter}
                size="lg"
              >
                🔄 Reset Filter
              </Button>
            </div>
          </div>
        </Card>

        {/* Tabel Siswa */}
        <Card>
          <div className="bg-gray-50 border-b border-gray-200 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-3">
                <span className="text-2xl">📊</span>
                Daftar Siswa
              </h3>
              <span className="text-base text-gray-600 font-medium">
                {siswa.length} dari {siswaRaw.length} siswa
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            {loadingInit ? (
              <div className="p-8 space-y-5">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="animate-pulse flex space-x-5 items-center">
                    <div className="rounded-full bg-gray-200 h-12 w-12" />
                    <div className="flex-1 space-y-3">
                      <div className="h-5 bg-gray-200 rounded w-3/4" />
                      <div className="h-4 bg-gray-200 rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <table className="w-full min-w-max">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-4 text-center text-sm font-semibold text-gray-700 uppercase tracking-wider border-b w-16">
                      No
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider border-b min-w-[250px]">
                      Siswa
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider border-b min-w-[180px]">
                      Kelas
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider border-b min-w-[150px]">
                      NIK
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider border-b min-w-[120px]">
                      JK
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider border-b min-w-[180px]">
                      RFID
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider border-b min-w-[130px]">
                      Status
                    </th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700 uppercase tracking-wider border-b min-w-[240px]">
                      Aksi
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {siswa.map((s, index) => {
                    const foto = s.photo_url || s.foto_url || s.foto || ''
                    const isKetua = isKetuaKelas(s.id)

                    return (
                      <tr key={s.id} className="hover:bg-gray-50 transition-colors duration-150">
                        {/* Kolom Nomor Urut */}
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center font-medium">
                          {index + 1}
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-12 w-12">
                              {foto ? (
                                <img
                                  src={foto}
                                  alt={s.nama || 'foto'}
                                  className="h-12 w-12 rounded-full object-cover border-2 border-gray-200"
                                />
                              ) : (
                                <div className="h-12 w-12 rounded-full bg-blue-100 border-2 border-blue-200 flex items-center justify-center text-base font-semibold text-blue-600">
                                  {initials(s.nama)}
                                </div>
                              )}
                            </div>
                            <div className="ml-4">
                              <div className="text-base font-semibold text-gray-900 flex items-center flex-wrap gap-2">
                                {s.nama || '—'}
                                {isKetua && (
                                  <Badge variant="warning" className="text-sm">
                                    👑 Ketua
                                  </Badge>
                                )}
                              </div>
                              <div className="text-sm text-gray-600 mt-1">
                                {s.email || '—'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-base text-gray-900 font-medium">
                          {getNamaKelas(s.kelas)}
                        </td>
                        <td className="px-6 py-4 text-base text-gray-900">
                          {s.nik || '—'}
                        </td>
                        <td className="px-6 py-4 text-base text-gray-900">
                          {JK_LABEL(s.jk)}
                        </td>
                        <td className="px-6 py-4 text-base">
                          {s.rfid_uid ? (
                            <Badge variant="info" className="text-sm px-3 py-1.5">
                              {(s.rfid_uid || '').toUpperCase()}
                            </Badge>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {s.status === 'nonaktif' ? (
                            <Badge variant="danger" className="text-sm px-4 py-1.5">
                              ⏸️ Nonaktif
                            </Badge>
                          ) : (
                            <Badge variant="success" className="text-sm px-4 py-1.5">
                              ✅ Aktif
                            </Badge>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                          <Button
                            variant="primary"
                            size="md"
                            onClick={() => openDetail(s)}
                            className="shadow-sm"
                          >
                            📋 Detail
                          </Button>
                          {s.status === 'active' ? (
                            <Button
                              variant="warning"
                              size="md"
                              onClick={() => openNonaktifModal(s)}
                              className="shadow-sm"
                            >
                              ⏸️ Nonaktif
                            </Button>
                          ) : (
                            <Button
                              variant="success"
                              size="md"
                              onClick={() => openAktifkanModal(s)}
                              className="shadow-sm"
                            >
                              ✅ Aktifkan
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {!siswa.length && (
                    <tr>
                      <td colSpan="8" className="px-6 py-12 text-center">
                        <div className="flex flex-col items-center justify-center">
                          <div className="text-gray-300 text-5xl mb-4">👨‍🎓</div>
                          <p className="text-gray-500 font-semibold text-lg mb-2">Tidak ada data siswa</p>
                          <p className="text-gray-400 text-base">Coba ubah filter pencarian atau tambahkan siswa baru</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        {/* Modal Konfirmasi Hapus Akun */}
        {deleteConfirmOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl p-7 w-full max-w-lg">
              <div className="flex items-center gap-4 mb-5">
                <div className="p-3 bg-red-100 text-red-600 rounded-xl">
                  <span className="text-2xl">🗑️</span>
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900">Hapus Akun Siswa</h3>
                  <p className="text-gray-600 text-base">Tindakan ini tidak dapat dibatalkan</p>
                </div>
              </div>

              <div className="bg-red-50 border border-red-200 rounded-xl p-5 mb-5">
                <p className="text-red-800 text-base font-semibold mb-3">
                  Apakah Anda yakin ingin menghapus akun siswa ini?
                </p>
                <p className="text-red-700 text-base mb-4">
                  <strong>{siswaToDelete?.nama}</strong> ({siswaToDelete?.email})
                </p>
                <div className="text-red-700 text-sm space-y-2">
                  <div className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Data akan dihapus dari database profiles dan tabel terkait</span>
                  </div>
                  <div className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Authentication system</span>
                  </div>
                  <div className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Data absensi, organisasi, dan tugas</span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-4">
                <Button
                  variant="secondary"
                  onClick={closeDeleteConfirm}
                  size="lg"
                >
                  ✕ Batal
                </Button>
                <Button
                  variant="danger"
                  onClick={hapusAkunSiswa}
                  loading={deletingSiswa}
                  size="lg"
                >
                  🗑️ Ya, Hapus
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Nonaktifkan Siswa */}
        {nonaktifModalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl p-7 w-full max-w-lg">
              <div className="flex items-center gap-4 mb-5">
                <div className="p-3 bg-orange-100 text-orange-600 rounded-xl">
                  <span className="text-2xl">⏸️</span>
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900">Nonaktifkan Siswa</h3>
                  <p className="text-gray-600 text-base">Siswa tidak akan bisa login</p>
                </div>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-3">
                    Alasan Penonaktifan *
                  </label>
                  <textarea
                    value={alasanNonaktif}
                    onChange={(e) => setAlasanNonaktif(e.target.value)}
                    placeholder="Masukkan alasan menonaktifkan siswa..."
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-3 focus:ring-orange-500 focus:border-orange-500 bg-white resize-none text-base"
                    rows={4}
                  />
                </div>

                <div className="flex justify-end space-x-4">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setNonaktifModalOpen(false)
                      setAlasanNonaktif('')
                      setSiswaToNonaktif(null)
                    }}
                    size="lg"
                  >
                    ✕ Batal
                  </Button>
                  <Button
                    variant="warning"
                    onClick={nonaktifkanSiswa}
                    disabled={!alasanNonaktif.trim()}
                    size="lg"
                  >
                    ⏸️ Nonaktifkan
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal Aktifkan Siswa */}
        {aktifkanModalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl p-7 w-full max-w-lg">
              <div className="flex items-center gap-4 mb-5">
                <div className="p-3 bg-green-100 text-green-600 rounded-xl">
                  <span className="text-2xl">✅</span>
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900">Aktifkan Siswa</h3>
                  <p className="text-gray-600 text-base">Siswa akan bisa login kembali</p>
                </div>
              </div>

              <div className="bg-green-50 border border-green-200 rounded-xl p-5 mb-5">
                <p className="text-green-800 text-base font-semibold mb-3">
                  Apakah Anda yakin ingin mengaktifkan siswa ini?
                </p>
                <p className="text-green-700 text-base">
                  <strong>{siswaToAktifkan?.nama}</strong> ({siswaToAktifkan?.email})
                </p>
              </div>

              <div className="flex justify-end space-x-4">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setAktifkanModalOpen(false)
                    setSiswaToAktifkan(null)
                  }}
                  size="lg"
                >
                  ✕ Batal
                </Button>
                <Button
                  variant="success"
                  onClick={aktifkanSiswa}
                  size="lg"
                >
                  ✅ Ya, Aktifkan
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Kenaikan Kelas */}
        {promotionModalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl p-7 w-full max-w-3xl">
              <div className="flex items-center gap-4 mb-5">
                <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl">
                  <span className="text-2xl">⬆️</span>
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900">Kenaikan Kelas</h3>
                  <p className="text-gray-600 text-base">
                    Pindahkan kelas siswa secara massal (berdasarkan kelas) atau pilih siswa manual dari sini.
                  </p>
                </div>
              </div>

              <div className="space-y-5">
                {/* Mode pilihan */}
                <div className="flex gap-3 text-base">
                  <button
                    type="button"
                    className={`flex-1 px-4 py-3 rounded-xl border ${
                      promotionMode === 'kelas'
                        ? 'bg-indigo-50 border-indigo-400 text-indigo-700 font-medium'
                        : 'bg-gray-50 border-gray-300 text-gray-700'
                    }`}
                    onClick={() => setPromotionMode('kelas')}
                  >
                    Berdasarkan Kelas
                  </button>
                  <button
                    type="button"
                    className={`flex-1 px-4 py-3 rounded-xl border ${
                      promotionMode === 'selected'
                        ? 'bg-indigo-50 border-indigo-400 text-indigo-700 font-medium'
                        : 'bg-gray-50 border-gray-300 text-gray-700'
                    }`}
                    onClick={() => setPromotionMode('selected')}
                  >
                    Pilih Siswa Manual ({promotionSelectedIds.length})
                  </button>
                </div>

                {promotionMode === 'kelas' ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    <Select
                      label="Kelas Asal"
                      value={promotionFromKelas}
                      onChange={e => setPromotionFromKelas(e.target.value)}
                      options={[
                        { value: '', label: 'Pilih kelas asal' },
                        ...kelasOptions.map(k => ({ value: k.value, label: k.label }))
                      ]}
                    />
                    <Select
                      label="Kelas Tujuan"
                      value={promotionToKelas}
                      onChange={e => setPromotionToKelas(e.target.value)}
                      options={[
                        { value: '', label: 'Pilih kelas tujuan' },
                        ...kelasOptions.map(k => ({ value: k.value, label: k.label }))
                      ]}
                    />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-700">
                      Pilih siswa yang akan dipindahkan ke kelas tujuan. Bisa filter berdasarkan tingkatan dan kelas asal.
                    </p>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <Select
                        label="Filter Tingkatan"
                        value={promotionFilterGrade}
                        onChange={e => {
                          setPromotionFilterGrade(e.target.value)
                          setPromotionFilterKelas('')
                        }}
                        options={[
                          { value: '', label: 'Semua tingkatan' },
                          ...gradeLabels.map(g => ({ value: g, label: g }))
                        ]}
                      />
                      <Select
                        label="Filter Kelas Asal"
                        value={promotionFilterKelas}
                        onChange={e => setPromotionFilterKelas(e.target.value)}
                        options={[
                          { value: '', label: 'Semua kelas' },
                          ...kelasOptions
                            .filter(k => !promotionFilterGrade || getGradeLabel(k.value) === promotionFilterGrade)
                            .map(k => ({ value: k.value, label: k.label }))
                        ]}
                      />
                    </div>

                    <div className="border rounded-xl max-h-60 overflow-y-auto">
                      <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
                        <p className="text-sm text-gray-700">
                          Siswa terlihat:{' '}
                          <span className="font-semibold">{promotionCandidateSiswa.length}</span>{' '}
                          • Dipilih:{' '}
                          <span className="font-semibold">{promotionSelectedIds.length}</span>
                        </p>
                        <button
                          type="button"
                          className="text-sm text-blue-600 hover:underline disabled:text-gray-400"
                          onClick={togglePromotionSelectAllVisible}
                          disabled={!promotionCandidateSiswa.length}
                        >
                          {promotionCandidateSiswa.length > 0 &&
                          promotionCandidateSiswa.every(s => promotionSelectedIds.includes(s.id))
                            ? 'Hapus pilih semua'
                            : 'Pilih semua yang terlihat'}
                        </button>
                      </div>
                      {promotionCandidateSiswa.length ? (
                        <ul className="divide-y divide-gray-100">
                          {promotionCandidateSiswa.map(s => (
                            <li key={s.id} className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50">
                              <input
                                type="checkbox"
                                className="h-5 w-5 text-indigo-600 border-gray-300 rounded"
                                checked={promotionSelectedIds.includes(s.id)}
                                onChange={() => togglePromotionSelect(s.id)}
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-900 font-medium truncate">
                                  {s.nama || s.email || 'Tanpa nama'}
                                </p>
                                <p className="text-xs text-gray-500 mt-1">
                                  {getNamaKelas(s.kelas)} • {s.email}
                                </p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="px-4 py-6 text-center text-sm text-gray-500">
                          Tidak ada siswa yang cocok dengan filter.
                        </div>
                      )}
                    </div>

                    <Select
                      label="Kelas Tujuan"
                      value={promotionToKelas}
                      onChange={e => setPromotionToKelas(e.target.value)}
                      options={[
                        { value: '', label: 'Pilih kelas tujuan' },
                        ...kelasOptions.map(k => ({ value: k.value, label: k.label }))
                      ]}
                    />

                    {!promotionSelectedIds.length && (
                      <p className="text-sm text-red-500">
                        Pilih minimal satu siswa untuk dipindahkan.
                      </p>
                    )}
                  </div>
                )}

                <p className="text-sm text-gray-500">
                  Catatan: Kenaikan kelas boleh lintas tingkatan (misal X → XI), sistem akan memberi peringatan di konfirmasi.
                </p>

                <div className="flex justify-end space-x-4 pt-3">
                  <Button
                    variant="secondary"
                    onClick={closePromotionModal}
                    disabled={promotionLoading}
                    size="lg"
                  >
                    ✕ Batal
                  </Button>
                  <Button
                    onClick={handlePromotion}
                    loading={promotionLoading}
                    disabled={
                      promotionLoading ||
                      !promotionToKelas ||
                      (promotionMode === 'kelas' && !promotionFromKelas)
                    }
                    size="lg"
                  >
                    ⬆️ Jalankan Kenaikan
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal Detail Siswa */}
        {detailOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
              {/* Header */}
              <div className="px-7 py-5 border-b bg-gray-50 flex items-start justify-between">
                <div className="flex items-center space-x-5">
                  <div className="flex-shrink-0 h-14 w-14">
                    {detailUser?.photo_url ? (
                      <img
                        src={detailUser.photo_url}
                        alt={detailUser.nama || 'foto'}
                        className="h-14 w-14 rounded-full object-cover border-2 border-gray-200"
                      />
                    ) : (
                      <div className="h-14 w-14 rounded-full bg-blue-100 border-2 border-blue-200 flex items-center justify-center text-lg font-semibold text-blue-600">
                        {initials(detailUser?.nama)}
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className="text-xl font-semibold text-gray-900">
                        {detailUser?.nama || detailUser?.email}
                      </h3>
                      {isKetuaKelas(detailUser?.id) && (
                        <Badge variant="warning" className="text-sm">
                          👑 Ketua {getKelasKetua(detailUser?.id)}
                        </Badge>
                      )}
                      {detailUser?.status === 'nonaktif' && (
                        <Badge variant="danger" className="text-sm">
                          ⏸️ Nonaktif
                        </Badge>
                      )}
                    </div>
                    <p className="text-gray-600 text-base mt-1">
                      {detailUser?.email || '—'} • NIK: {detailUser?.nik || '—'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  {detailUser?.status === 'active' ? (
                    <Button
                      variant="warning"
                      size="md"
                      onClick={() => openNonaktifModal(detailUser)}
                      className="shadow-sm"
                    >
                      ⏸️ Nonaktif
                    </Button>
                  ) : (
                    <Button
                      variant="success"
                      size="md"
                      onClick={() => openAktifkanModal(detailUser)}
                      className="shadow-sm"
                    >
                      ✅ Aktifkan
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    size="md"
                    onClick={() => openDeleteConfirm(detailUser)}
                    className="shadow-sm"
                  >
                    🗑️ Hapus
                  </Button>
                  <button
                    className="p-2.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                    onClick={closeDetailModal}
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="p-7 space-y-6 overflow-y-auto flex-1">
                {detailLoading ? (
                  <div className="space-y-5">
                    <div className="animate-pulse h-20 bg-gray-200 rounded-xl" />
                    <div className="animate-pulse h-28 bg-gray-200 rounded-xl" />
                    <div className="animate-pulse h-24 bg-gray-200 rounded-xl" />
                  </div>
                ) : (
                  <>
                    {/* Kelas & Status + RFID */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div className="bg-white border border-gray-200 rounded-xl p-5">
                        <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-3">
                          <span className="text-xl">🏫</span>
                          Kelas & Status
                        </h4>
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <Select
                              label="Tingkatan"
                              value={moveGrade}
                              onChange={e => { setMoveGrade(e.target.value); setMoveKelas('') }}
                              options={[
                                { value: '', label: 'Pilih tingkatan' },
                                ...gradeLabels.map(g => ({ value: g, label: g }))
                              ]}
                            />
                            <Select
                              label="Kelas"
                              value={moveKelas}
                              onChange={e => setMoveKelas(e.target.value)}
                              options={(() => {
                                const baseGrade = getGradeLabel(detailUser?.kelas || '') || moveGrade
                                const options = kelasByGrade(baseGrade)

                                if (!baseGrade) {
                                  return [{ value: '', label: 'Pilih tingkatan dulu' }]
                                }
                                if (options.length === 0) {
                                  return [{ value: '', label: 'Tidak ada kelas pada tingkatan ini' }]
                                }
                                return [
                                  { value: '', label: 'Pilih kelas' },
                                  ...options.map(k => ({ value: k.id, label: getKelasDisplayName(k) }))
                                ]
                              })()}
                            />
                          </div>

                          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pt-4 border-t">
                            <div className="text-base">
                              <span className="text-gray-600 font-medium">Status: </span>
                              <span className={detailUser?.status === 'nonaktif' ? 'text-red-600 font-semibold' : 'text-green-600 font-semibold'}>
                                {detailUser?.status === 'nonaktif' ? 'Nonaktif' : 'Aktif'}
                              </span>
                            </div>
                            <div className="flex gap-3">
                              <Button
                                onClick={simpanPindahKelas}
                                disabled={!moveKelas || moveKelas === detailUser?.kelas}
                                size="md"
                                className="shadow-sm"
                              >
                                💾 Simpan
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={kosongkanKelas}
                                size="md"
                                className="shadow-sm"
                              >
                                🗑️ Kosongkan
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Kartu RFID */}
                      <div className="bg-white border border-gray-200 rounded-xl p-5">
                        <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-3">
                          <span className="text-xl">💳</span>
                          Kartu RFID
                        </h4>

                        <div className="space-y-4">
                          <div>
                            <Input
                              label="UID RFID"
                              value={rfidInput}
                              onChange={e => setRfidInput(e.target.value.toUpperCase())}
                              placeholder="Tap kartu atau isi manual"
                            />
                            {detailUser?.rfid_uid && (
                              <p className="text-sm text-gray-500 mt-2">
                                UID tersimpan:{' '}
                                <span className="font-mono font-medium text-base">
                                  {(detailUser.rfid_uid || '').toUpperCase()}
                                </span>
                              </p>
                            )}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <Button
                              variant={rfidEnrolling ? 'warning' : 'primary'}
                              size="md"
                              onClick={toggleRfidListen}
                              className="shadow-sm"
                            >
                              {rfidEnrolling ? '⏹️ Stop' : '🎫 Scan'}
                            </Button>
                            <Button
                              variant="success"
                              size="md"
                              onClick={saveRfid}
                              disabled={!rfidInput}
                              className="shadow-sm"
                            >
                              💾 Simpan
                            </Button>
                            <Button
                              variant="secondary"
                              size="md"
                              onClick={clearRfid}
                              disabled={!detailUser?.rfid_uid && !rfidInput}
                              className="shadow-sm"
                            >
                              🗑️ Hapus
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Organisasi & OSIS */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Organisasi */}
                      <div className="bg-white border border-gray-200 rounded-xl p-5">
                        <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-3">
                          <span className="text-xl">👥</span>
                          Organisasi ({orgMember.length})
                        </h4>
                        <div className="space-y-3 max-h-52 overflow-y-auto pr-2">
                          {orgMember.map(row => (
                            <div key={row.orgId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                              <div>
                                <p className="text-base font-medium text-gray-900">{row.orgNama}</p>
                                <p className="text-sm text-gray-500 mt-1">{row.jabatan} • {row.bagian || '-'}</p>
                              </div>
                              <Button
                                variant="danger"
                                size="sm"
                                onClick={() => hapusOrg(row.orgId)}
                                className="shadow-sm"
                              >
                                🗑️
                              </Button>
                            </div>
                          ))}
                          {!orgMember.length && (
                            <p className="text-gray-500 text-base text-center py-6">Belum terdaftar di organisasi</p>
                          )}
                        </div>
                      </div>

                      {/* OSIS */}
                      <div className="bg-white border border-gray-200 rounded-xl p-5">
                        <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-3">
                          <span className="text-xl">🌟</span>
                          OSIS
                        </h4>
                        {osisRow ? (
                          <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <p className="text-sm font-medium text-gray-700">Status</p>
                                <Badge variant={osisRow.status === 'aktif' ? 'success' : 'danger'} className="text-sm mt-1">
                                  {osisRow.status}
                                </Badge>
                              </div>
                              <div>
                                <p className="text-sm font-medium text-gray-700">Jabatan</p>
                                <p className="text-base text-gray-900 font-medium mt-1">{osisRow.jabatan}</p>
                              </div>
                            </div>
                            {osisRow.bagian && (
                              <div>
                                <p className="text-sm font-medium text-gray-700">Bagian</p>
                                <p className="text-base text-gray-900 font-medium mt-1">{osisRow.bagian}</p>
                              </div>
                            )}
                            <div className="flex justify-end">
                              <Button
                                variant="danger"
                                size="md"
                                onClick={hapusOsis}
                                className="shadow-sm"
                              >
                                🗑️ Hapus dari OSIS
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-gray-500 text-base text-center py-6">Belum terdaftar di OSIS</p>
                        )}
                      </div>
                    </div>

                    {/* Informasi Tambahan */}
                    <div className="bg-white border border-gray-200 rounded-xl p-5">
                      <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-3">
                        <span className="text-xl">📋</span>
                        Informasi Tambahan
                      </h4>
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                        <div className="bg-gray-50 p-4 rounded-lg">
                          <p className="text-sm font-medium text-gray-700">Jenis Kelamin</p>
                          <p className="text-base text-gray-900 font-medium mt-1">{JK_LABEL(detailUser?.jk)}</p>
                        </div>
                        <div className="bg-gray-50 p-4 rounded-lg">
                          <p className="text-sm font-medium text-gray-700">Usia</p>
                          <p className="text-base text-gray-900 font-medium mt-1">{detailUser?.usia ? `${detailUser.usia} tahun` : '—'}</p>
                        </div>
                        <div className="bg-gray-50 p-4 rounded-lg">
                          <p className="text-sm font-medium text-gray-700">Agama</p>
                          <p className="text-base text-gray-900 font-medium mt-1">{detailUser?.agama || '—'}</p>
                        </div>
                        <div className="bg-gray-50 p-4 rounded-lg">
                          <p className="text-sm font-medium text-gray-700">Telepon</p>
                          <p className="text-base text-gray-900 font-medium mt-1">{detailUser?.telp || '—'}</p>
                        </div>
                        <div className="lg:col-span-2">
                          <div className="bg-gray-50 p-4 rounded-lg h-full">
                            <p className="text-sm font-medium text-gray-700">Alamat</p>
                            <p className="text-base text-gray-900 font-medium mt-1">{detailUser?.alamat || '—'}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}