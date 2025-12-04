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
      <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4">
        <h3 className="text-lg font-bold text-gray-900 mb-2">{title}</h3>
        <p className="text-gray-600 text-sm mb-4">
          Untuk melanjutkan, masukkan password Anda:
        </p>
        
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

/* ===== Password Verification Utility ===== */
const verifyPassword = async (password) => {
  try {
    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      throw new Error('User tidak ditemukan')
    }

    // Try to sign in with the provided password
    const { error } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: password
    })

    if (error) {
      throw new Error('Password salah')
    }

    return true
  } catch (error) {
    throw error
  }
}

/* ===== Helpers ===== */
function initials(name = '?') {
  const parts = (name || '').trim().split(/\s+/).slice(0, 2)
  return parts.map(p => p[0]?.toUpperCase() || '').join('')
}

function normToArray(x) {
  if (!x) return []
  if (Array.isArray(x)) return x.map(v => String(v).trim()).filter(Boolean)
  if (typeof x === 'string') return x.split(/[,;|/]+/).map(s => s.trim()).filter(Boolean)
  if (typeof x === 'object') return Object.keys(x).map(s => String(s).trim()).filter(Boolean)
  return []
}

function listPreview(arr, max = 3) {
  const a = Array.isArray(arr) ? arr : normToArray(arr)
  if (!a.length) return { text: '—', title: '' }
  const text = a.slice(0, max).join(', ') + (a.length > max ? `, +${a.length - max}` : '')
  const title = a.join(', ')
  return { text, title }
}

// Fungsi format kelas dari slug ke display
const formatKelasDisplay = (kelasSlug) => {
  if (!kelasSlug) return '';
  const parts = kelasSlug.split('-');
  if (parts.length >= 2) {
    const grade = parts[0].toUpperCase();
    const suffix = parts[1].toUpperCase();
    return `${grade} ${suffix}`;
  }
  return parts.map(word => 
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join(' ');
};

// Komponen Stat Card
const GuruStatCard = ({ label, value, icon, color = 'blue', description }) => {
  const colorClasses = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    purple: 'bg-purple-500',
    orange: 'bg-orange-500',
    indigo: 'bg-indigo-500',
    teal: 'bg-teal-500'
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600 mb-1">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {description && (
            <p className="text-xs text-gray-500 mt-1">{description}</p>
          )}
        </div>
        {icon && (
          <div className={`text-xl text-white p-3 rounded-lg ${colorClasses[color]}`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  )
}

// Loading Skeleton
const LoadingSkeleton = () => (
  <div className="animate-pulse">
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-gray-200 rounded-lg h-24"></div>
      ))}
    </div>
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center space-x-4">
            <div className="rounded-full bg-gray-200 h-5 w-5 ml-2"></div>
            <div className="rounded-full bg-gray-200 h-12 w-12"></div>
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              <div className="h-3 bg-gray-200 rounded w-1/2"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
)

/* ===== Komponen UI ===== */
function Card({ children, className = '' }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden ${className}`}>
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
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${variants[variant]} ${className}`}>
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
  const baseClasses = 'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'

  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
    secondary: 'bg-gray-100 text-gray-700 hover:bg-gray-200 focus:ring-gray-500 border border-gray-300',
    success: 'bg-green-600 text-white hover:bg-green-700 focus:ring-green-500',
    danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
    warning: 'bg-yellow-600 text-white hover:bg-yellow-700 focus:ring-yellow-500'
  }

  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-6 py-3 text-base'
  }

  return (
    <button
      className={`${baseClasses} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
      )}
      {children}
    </button>
  )
}

function Input({ label, error, className = '', ...props }) {
  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <input
        className={`block w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white ${className}`}
        {...props}
      />
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  )
}

function Select({ label, error, options = [], className = '', ...props }) {
  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <select
        className={`block w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white ${className}`}
        {...props}
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  )
}

export default function AGuru() {
  const { pushToast } = useUIStore()
  const [loadingInit, setLoadingInit] = useState(true)

  /* ===== Password Modal State ===== */
  const [passwordModal, setPasswordModal] = useState({
    isOpen: false,
    title: '',
    action: null,
    loading: false
  })

  const [guruRaw, setGuruRaw] = useState([])
  const [guru, setGuru] = useState([])
  const [jadwalAll, setJadwalAll] = useState({})
  const [strukturKelasAll, setStrukturKelasAll] = useState({})
  const [strukturSekolah, setStrukturSekolah] = useState({})

  // Pencarian
  const [qNama, setQNama] = useState('')
  const [qMapel, setQMapel] = useState('')
  const [qJabatan, setQJabatan] = useState('')
  const [isSearching, setIsSearching] = useState(false)

  // Modal nonaktif
  const [disableUID, setDisableUID] = useState(null)
  const [alasanNonaktif, setAlasanNonaktif] = useState('')
  
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [selectedGuru, setSelectedGuru] = useState(null)

  // Form tambah guru
  const [form, setForm] = useState({
    email: '',
    nama: '',
    telp: '',
    password: '',
    confirmPassword: ''
  })
  const [showAddForm, setShowAddForm] = useState(false)

  // Hapus guru
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [guruToDelete, setGuruToDelete] = useState(null)
  const [deletingGuru, setDeletingGuru] = useState(false)

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
      await passwordModal.action()
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

  // Load data
  useEffect(() => {
    loadAllData()
  }, [])

  const loadAllData = async () => {
    try {
      setLoadingInit(true)
      await Promise.all([
        loadGuruRaw(),
        loadJadwalAll(),
        loadStrukturKelasAll(),
        loadStrukturSekolah()
      ])
    } catch (error) {
      console.error('Error loading data:', error)
      pushToast('error', 'Gagal memuat data')
    } finally {
      setLoadingInit(false)
    }
  }

  const loadGuruRaw = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'guru')
      .order('nama')

    if (error) throw error
    setGuruRaw(data || [])
  }

  const loadJadwalAll = async () => {
    const { data, error } = await supabase
      .from('jadwal')
      .select('*')

    if (error) throw error
    
    const jadwalByKelas = {}
    data?.forEach(j => {
      if (!jadwalByKelas[j.kelas_id]) jadwalByKelas[j.kelas_id] = {}
      jadwalByKelas[j.kelas_id][j.id] = j
    })
    setJadwalAll(jadwalByKelas)
  }

  const loadStrukturKelasAll = async () => {
    const { data, error } = await supabase
      .from('kelas_struktur')
      .select('*')

    if (error) throw error
    
    const strukturByKelas = {}
    data?.forEach(s => {
      strukturByKelas[s.kelas_id] = s
    })
    setStrukturKelasAll(strukturByKelas)
  }

  const loadStrukturSekolah = async () => {
    const { data, error } = await supabase
      .from('struktur_sekolah')
      .select('*')

    if (error) throw error
    
    const strukturById = {}
    data?.forEach(s => {
      strukturById[s.id] = s
    })
    setStrukturSekolah(strukturById)
  }

  // Process guru data
  const guruProcessed = useMemo(() => {
    return guruRaw.map(g => {
      const mapelSet = new Set()
      const kelasSet = new Set()
      const jabatanSet = new Set()

      // Tambahkan jabatan dari profil jika ada
      if (g.jabatan) {
        jabatanSet.add(String(g.jabatan).trim())
      }

      // Cari mapel dan kelas dari jadwal
      Object.entries(jadwalAll).forEach(([kelasId, jadwalEntries]) => {
        Object.values(jadwalEntries || {}).forEach(j => {
          if (j.guru_id === g.id) {
            if (j.mapel) mapelSet.add(j.mapel)
            kelasSet.add(formatKelasDisplay(kelasId))
          }
        })
      })

      // Cari jabatan wali kelas
      Object.entries(strukturKelasAll).forEach(([kelasId, struktur]) => {
        if (struktur?.wali_guru_id === g.id) {
          jabatanSet.add(`Wali Kelas ${formatKelasDisplay(kelasId)}`)
        }
      })

      // Cari jabatan struktur sekolah
      Object.values(strukturSekolah || {}).forEach(posisi => {
        if (posisi?.guru_id === g.id) {
          if (posisi.jabatan) jabatanSet.add(posisi.jabatan)
        }
      })
      
      const jabatanList = Array.from(jabatanSet).sort()
      
      return {
        ...g,
        uid: g.id,
        mapelList: Array.from(mapelSet).sort(),
        kelasList: Array.from(kelasSet).sort(),
        jabatanList: jabatanList,
        jabatanUtama: jabatanList.length > 0 ? jabatanList[0] : '—',
        status: g.status || 'active',
        alasanNonaktif: g.alasan_nonaktif || '',
        kelasDisplay: formatKelasDisplay(g.kelas)
      }
    })
  }, [guruRaw, jadwalAll, strukturKelasAll, strukturSekolah])

  // Jabatan list untuk filter
  const jabatanList = useMemo(() => {
    const jabatanSet = new Set()
    
    Object.values(strukturSekolah || {}).forEach(posisi => {
      if (posisi?.jabatan) {
        jabatanSet.add(posisi.jabatan)
      }
    })
    
    Object.keys(strukturKelasAll || {}).forEach(kelasId => {
      jabatanSet.add(`Wali Kelas ${formatKelasDisplay(kelasId)}`)
    })

    guruRaw.forEach(g => {
      if (g.jabatan) {
        jabatanSet.add(String(g.jabatan).trim())
      }
    })
    
    return Array.from(jabatanSet).sort()
  }, [strukturSekolah, strukturKelasAll, guruRaw])
  
  // Mapel list untuk filter
  const allMapelList = useMemo(() => {
    const mapelSet = new Set()
    guruProcessed.forEach(g => {
      g.mapelList.forEach(mapel => mapelSet.add(mapel))
    })
    return Array.from(mapelSet).sort()
  }, [guruProcessed])

  // Kelas list untuk filter
  const allKelasList = useMemo(() => {
    const kelasSet = new Set()
    guruProcessed.forEach(g => {
      g.kelasList.forEach(kelas => kelasSet.add(kelas))
    })
    return Array.from(kelasSet).sort()
  }, [guruProcessed])

  // Statistik untuk dashboard
  const stats = useMemo(() => {
    const totalGuru = guruProcessed.length
    const aktifGuru = guruProcessed.filter(g => g.status === 'active').length
    const nonaktifGuru = guruProcessed.filter(g => g.status === 'nonaktif').length
    const totalJabatan = jabatanList.length

    return {
      totalGuru,
      aktifGuru,
      nonaktifGuru,
      totalJabatan
    }
  }, [guruProcessed, jabatanList])

  // Update state guru ketika data diproses
  useEffect(() => {
    setGuru(guruProcessed)
  }, [guruProcessed])

  /* ===== Filter ===== */
  function applyFilter() {
    setIsSearching(true)
    setTimeout(() => {
      const nama = qNama.trim().toLowerCase()
      const mapel = qMapel.trim()
      const jab = qJabatan.trim()

      const res = guruProcessed.filter(g => {
        const namaOk = nama
          ? (String(g.nama || '').toLowerCase().includes(nama) || String(g.email || '').toLowerCase().includes(nama))
          : true
        const mapelOk = mapel
          ? g.mapelList.some(m => m === mapel)
          : true
        const jabatanOk = jab
          ? g.jabatanList.some(j => j === jab)
          : true
        return namaOk && mapelOk && jabatanOk
      })

      setGuru(res)
      setIsSearching(false)
    }, 200)
  }

  function resetFilter() {
    setQNama('')
    setQMapel('')
    setQJabatan('')
    setGuru(guruProcessed)
  }

  /* ===== Form Handler ===== */
  const handleChange = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
  }

  /* ===== Tambah Guru ===== */
  const handleAdd = async () => {
    if (!form.email || !form.nama) {
      return pushToast('error', 'Email dan nama harus diisi')
    }

    if (!form.password) {
      return pushToast('error', 'Password harus diisi')
    }

    if (form.password !== form.confirmPassword) {
      return pushToast('error', 'Password dan konfirmasi password tidak sama')
    }

    if (form.password.length < 6) {
      return pushToast('error', 'Password minimal 6 karakter')
    }

    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          data: {
            nama: form.nama,
            role: 'guru'
          }
        }
      })

      if (authError) throw authError

      const { error } = await supabase.from('profiles').insert({
        id: authData.user.id,
        email: form.email,
        nama: form.nama,
        telp: form.telp,
        role: 'guru',
        status: 'active',
        created_at: new Date().toISOString()
      })

      if (error) throw error

      pushToast('success', 'Guru berhasil didaftarkan')
      setForm({ 
        email: '', 
        nama: '', 
        telp: '', 
        password: '', 
        confirmPassword: '' 
      })
      setShowAddForm(false)
      loadGuruRaw()
    } catch (error) {
      console.error(error)
      pushToast('error', 'Gagal mendaftarkan guru: ' + (error.message || 'Unknown error'))
    }
  }

  /* ===== Status Guru ===== */
  function openNonaktif(u) {
    openPasswordModal(
      'Konfirmasi Nonaktifkan Guru',
      () => {
        setDisableUID(u.id)
        setAlasanNonaktif('')
      }
    )
  }

  const simpanNonaktif = () => {
    if (!disableUID) return

    if (!alasanNonaktif.trim()) {
      pushToast('error', 'Harap masukkan alasan penonaktifan')
      return
    }

    openPasswordModal(
      'Konfirmasi Akhir Nonaktifkan Guru',
      async () => {
        try {
          await supabase
            .from('profiles')
            .update({
              status: 'nonaktif',
              alasan_nonaktif: alasanNonaktif || '-',
              disabled_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', disableUID)

          pushToast('success', 'Guru berhasil dinonaktifkan')
          setDisableUID(null)
          setAlasanNonaktif('')
          loadGuruRaw()
        } catch (error) {
          console.error('Error disabling guru:', error)
          pushToast('error', 'Gagal menonaktifkan guru')
        }
      }
    )
  }

  function batalNonaktif() {
    setDisableUID(null)
    setAlasanNonaktif('')
  }

  const aktif = (u) => {
    openPasswordModal(
      'Konfirmasi Aktifkan Guru',
      async () => {
        try {
          await supabase
            .from('profiles')
            .update({
              status: 'active',
              alasan_nonaktif: null,
              disabled_at: null,
              updated_at: new Date().toISOString()
            })
            .eq('id', u.id)

          pushToast('success', 'Guru berhasil diaktifkan')
          loadGuruRaw()
        } catch (error) {
          console.error('Error activating guru:', error)
          pushToast('error', 'Gagal mengaktifkan guru')
        }
      }
    )
  }

  /* ===== Hapus Akun Guru ===== */
  function openDeleteConfirm(guru) {
    openPasswordModal(
      'Konfirmasi Hapus Akun Guru',
      () => {
        setGuruToDelete(guru)
        setDeleteConfirmOpen(true)
      }
    )
  }

  function closeDeleteConfirm() {
    setDeleteConfirmOpen(false)
    setGuruToDelete(null)
  }

  const hapusAkunGuru = () => {
    if (!guruToDelete) return

    openPasswordModal(
      'Konfirmasi Akhir Hapus Akun Guru',
      async () => {
        try {
          setDeletingGuru(true)

          // Hapus data terkait terlebih dahulu
          await supabase
            .from('jadwal')
            .delete()
            .eq('guru_id', guruToDelete.id)

          await supabase
            .from('kelas_struktur')
            .update({ wali_guru_id: null, wali_guru_nama: null })
            .eq('wali_guru_id', guruToDelete.id)

          await supabase
            .from('struktur_sekolah')
            .delete()
            .eq('guru_id', guruToDelete.id)

          // Hapus dari tabel profiles
          const { error: profileError } = await supabase
            .from('profiles')
            .delete()
            .eq('id', guruToDelete.id)

          if (profileError) throw profileError

          // Hapus user dari authentication (membutuhkan admin privileges)
          try {
            const { error: authError } = await supabase.auth.admin.deleteUser(
              guruToDelete.id
            )

            if (authError) {
              console.warn('Tidak bisa menghapus dari auth, mungkin tidak ada akses admin:', authError)
              pushToast('warning', 'Akun guru dihapus tetapi mungkin masih ada di sistem authentication')
            } else {
              pushToast('success', 'Akun guru berhasil dihapus dari sistem')
            }
          } catch (authError) {
            console.warn('Error menghapus dari auth:', authError)
            pushToast('warning', 'Akun guru dihapus tetapi mungkin masih ada di sistem authentication')
          }

          pushToast('success', 'Akun guru berhasil dihapus')
          closeDeleteConfirm()
          if (detailModalOpen) closeDetailModal()
          loadAllData()
        } catch (error) {
          console.error('Error deleting guru:', error)
          pushToast('error', 'Gagal menghapus akun guru: ' + (error.message || 'Unknown error'))
        } finally {
          setDeletingGuru(false)
        }
      }
    )
  }

  /* ===== Modal Detail Guru ===== */
  function openDetailModal(guru) {
    setSelectedGuru(guru)
    setDetailModalOpen(true)
  }

  function closeDetailModal() {
    setSelectedGuru(null)
    setDetailModalOpen(false)
  }

  // Komponen untuk menampilkan badge jabatan
  const JabatanBadge = ({ jabatanList }) => {
    if (!jabatanList || jabatanList.length === 0) {
      return <span className="text-gray-500 text-sm">—</span>
    }

    return (
      <div className="flex flex-wrap gap-1.5">
        {jabatanList.map((jabatan, index) => (
          <span
            key={index}
            className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800 border border-blue-200"
            title={jabatan}
          >
            {jabatan}
          </span>
        ))}
      </div>
    )
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
                <span className="text-3xl text-blue-600">👨‍🏫</span>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Manajemen Guru</h1>
                <p className="text-gray-600 text-lg">Kelola data guru, mata pelajaran, dan penugasan</p>
              </div>
            </div>
            <button
              className="mt-5 lg:mt-0 bg-blue-600 text-white px-5 py-3 rounded-xl hover:bg-blue-700 focus:ring-3 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 font-medium text-base shadow-sm hover:shadow-md"
              onClick={() => setShowAddForm(!showAddForm)}
            >
              {showAddForm ? '✕ Tutup Form' : '➕ Tambah Guru Baru'}
            </button>
          </div>
        </div>

        {/* Dashboard Statistics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
          <GuruStatCard 
            label="Total Guru" 
            value={stats.totalGuru} 
            icon="👨‍🏫" 
            color="blue"
            description="Semua guru terdaftar"
          />
          <GuruStatCard 
            label="Guru Aktif" 
            value={stats.aktifGuru} 
            icon="✅" 
            color="green"
            description="Sedang aktif mengajar"
          />
          <GuruStatCard 
            label="Guru Nonaktif" 
            value={stats.nonaktifGuru} 
            icon="⏸️" 
            color="orange"
            description="Tidak aktif sementara"
          />
          <GuruStatCard 
            label="Jabatan" 
            value={stats.totalJabatan} 
            icon="💼" 
            color="teal"
            description="Posisi/jabatan"
          />
        </div>

        {/* Form Tambah Guru */}
        {showAddForm && (
          <Card className="mb-6">
            <div className="bg-blue-50 border-b border-blue-200 p-5">
              <h3 className="text-xl font-semibold text-blue-900 flex items-center gap-3">
                <span className="text-2xl">➕</span>
                Tambah Guru Baru
              </h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Input
                  label="Email *"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="Email guru"
                  type="email"
                  required
                />
                <Input
                  label="Nama Lengkap *"
                  name="nama"
                  value={form.nama}
                  onChange={handleChange}
                  placeholder="Nama lengkap"
                  required
                />
                <Input
                  label="Telepon"
                  name="telp"
                  value={form.telp}
                  onChange={handleChange}
                  placeholder="Nomor telepon"
                />
                <Input
                  label="Password *"
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  placeholder="Password minimal 6 karakter"
                  type="password"
                  required
                />
                <div className="md:col-span-2">
                  <Input
                    label="Konfirmasi Password *"
                    name="confirmPassword"
                    value={form.confirmPassword}
                    onChange={handleChange}
                    placeholder="Ulangi password"
                    type="password"
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-4 mt-6 pt-6 border-t border-gray-200">
                <Button
                  variant="secondary"
                  onClick={() => setShowAddForm(false)}
                  size="lg"
                >
                  ✕ Batal
                </Button>
                <Button
                  onClick={handleAdd}
                  size="lg"
                  disabled={
                    !form.email ||
                    !form.nama ||
                    !form.password ||
                    form.password !== form.confirmPassword
                  }
                >
                  👨‍🏫 Daftarkan Guru
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
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <Input
                label="Nama / Email"
                placeholder="Cari nama atau email guru"
                value={qNama}
                onChange={e => setQNama(e.target.value)}
              />
              <Select
                label="Mata Pelajaran"
                value={qMapel}
                onChange={e => setQMapel(e.target.value)}
                options={[
                  { value: '', label: 'Semua Mata Pelajaran' },
                  ...allMapelList.map(mapel => ({ value: mapel, label: mapel }))
                ]}
              />
              <Select
                label="Jabatan"
                value={qJabatan}
                onChange={e => setQJabatan(e.target.value)}
                options={[
                  { value: '', label: 'Semua Jabatan' },
                  ...jabatanList.map(jab => ({ value: jab, label: jab }))
                ]}
              />
            </div>
            <div className="flex justify-end space-x-4 mt-6">
              <Button
                onClick={applyFilter}
                loading={isSearching}
                size="lg"
              >
                🔍 Cari Guru
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

        {/* Tabel Guru */}
        <Card>
          <div className="bg-gray-50 border-b border-gray-200 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-3">
                <span className="text-2xl">📊</span>
                Daftar Guru
              </h3>
              <span className="text-base text-gray-600 font-medium">
                {guru.length} dari {guruProcessed.length} guru
              </span>
            </div>
          </div>

          {loadingInit ? (
            <div className="p-6">
              <LoadingSkeleton />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider border-b w-14">
                      No
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider border-b min-w-[250px]">
                      Guru
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider border-b min-w-[200px]">
                      Mapel
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider border-b min-w-[150px]">
                      Kelas
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider border-b min-w-[250px]">
                      Jabatan
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider border-b min-w-[120px]">
                      Status
                    </th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700 uppercase tracking-wider border-b min-w-[220px]">
                      Aksi
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {guru.map((g, index) => {
                    const foto = g.photo_url || g.foto_url || g.foto || ''
                    const mapelPreview = listPreview(g.mapelList)
                    const kelasPreview = listPreview(g.kelasList)
                    
                    return (
                      <tr key={g.id} className="hover:bg-gray-50 transition-colors duration-150">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center font-medium">
                          {index + 1}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-12 w-12">
                              {foto ? (
                                <img
                                  src={foto}
                                  alt={g.nama || 'foto'}
                                  className="h-12 w-12 rounded-full object-cover border-2 border-gray-200"
                                />
                              ) : (
                                <div className="h-12 w-12 rounded-full bg-blue-100 border-2 border-blue-200 flex items-center justify-center text-base font-semibold text-blue-600">
                                  {initials(g.nama)}
                                </div>
                              )}
                            </div>
                            <div className="ml-4">
                              <div className="text-base font-semibold text-gray-900">
                                {g.nama || '—'}
                              </div>
                              <div className="text-sm text-gray-600">
                                {g.email || '—'}
                              </div>
                              {g.telp && <div className="text-sm text-gray-500 flex items-center gap-2 mt-1">
                                <span className="text-gray-400">📞</span>
                                <span>{g.telp}</span>
                              </div>}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-900 font-medium" title={mapelPreview.title}>
                            {mapelPreview.text}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-900 font-medium" title={kelasPreview.title}>
                            {kelasPreview.text}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <JabatanBadge jabatanList={g.jabatanList} />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {g.status === 'nonaktif' ? (
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
                            onClick={() => openDetailModal(g)}
                            className="shadow-sm"
                          >
                            📋 Detail
                          </Button>
                          {g.status === 'nonaktif' ? (
                            <Button
                              variant="success"
                              size="md"
                              onClick={() => aktif(g)}
                              className="shadow-sm"
                            >
                              ✅ Aktifkan
                            </Button>
                          ) : (
                            <Button
                              variant="warning"
                              size="md"
                              onClick={() => openNonaktif(g)}
                              className="shadow-sm"
                            >
                              ⏸️ Nonaktif
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {!guru.length && (
                    <tr>
                      <td colSpan="7" className="px-6 py-12 text-center">
                        <div className="flex flex-col items-center justify-center">
                          <div className="text-gray-300 text-5xl mb-4">👨‍🏫</div>
                          <p className="text-gray-500 font-semibold text-lg mb-2">Tidak ada data guru</p>
                          <p className="text-gray-400 text-base">Coba ubah filter pencarian atau tambahkan guru baru</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Modal Nonaktifkan Guru */}
        {disableUID && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl p-7 w-full max-w-lg">
              <div className="flex items-center gap-4 mb-5">
                <div className="p-3 bg-orange-100 text-orange-600 rounded-xl">
                  <span className="text-2xl">⏸️</span>
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900">Nonaktifkan Guru</h3>
                  <p className="text-gray-600 text-base">Guru akan diblokir di aplikasi</p>
                </div>
              </div>
              
              <div className="mb-5">
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Alasan Penonaktifan *
                </label>
                <textarea
                  className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-3 focus:ring-orange-500 focus:border-orange-500 min-h-[120px] text-base"
                  placeholder="Contoh: Cuti panjang, sakit berkepanjangan, mengundurkan diri..."
                  value={alasanNonaktif}
                  onChange={e => setAlasanNonaktif(e.target.value)}
                  required
                />
              </div>
              
              <div className="flex justify-end space-x-4">
                <Button
                  variant="secondary"
                  onClick={batalNonaktif}
                  size="lg"
                >
                  ✕ Batal
                </Button>
                <Button
                  onClick={simpanNonaktif}
                  disabled={!alasanNonaktif.trim()}
                  size="lg"
                  className="bg-orange-600 hover:bg-orange-700"
                >
                  ⏸️ Nonaktifkan Guru
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Konfirmasi Hapus Akun */}
        {deleteConfirmOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl p-7 w-full max-w-lg">
              <div className="flex items-center gap-4 mb-5">
                <div className="p-3 bg-red-100 text-red-600 rounded-xl">
                  <span className="text-2xl">🗑️</span>
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900">Hapus Akun Guru</h3>
                  <p className="text-gray-600 text-base">Tindakan ini tidak dapat dibatalkan</p>
                </div>
              </div>
              
              <div className="bg-red-50 border border-red-200 rounded-xl p-5 mb-5">
                <p className="text-red-800 text-base font-semibold mb-3">
                  Apakah Anda yakin ingin menghapus akun guru ini?
                </p>
                <p className="text-red-700 text-base mb-3">
                  <strong>{guruToDelete?.nama}</strong> ({guruToDelete?.email})
                </p>
                <div className="text-red-600 text-sm space-y-2">
                  <div className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Akun akan dihapus dari database dan authentication</span>
                  </div>
                  <div className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Semua data terkait (jadwal, struktur) akan dihapus</span>
                  </div>
                  <div className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Tindakan ini PERMANEN dan tidak dapat dikembalikan</span>
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
                  onClick={hapusAkunGuru}
                  loading={deletingGuru}
                  size="lg"
                >
                  🗑️ Ya, Hapus Akun
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Detail Guru */}
        {detailModalOpen && selectedGuru && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
              {/* Header */}
              <div className="px-7 py-5 border-b bg-gray-50 flex items-start justify-between">
                <div className="flex items-center space-x-5">
                  {selectedGuru.photo_url ? (
                    <img
                      src={selectedGuru.photo_url}
                      alt={selectedGuru.nama}
                      className="h-14 w-14 rounded-full object-cover border-2 border-gray-200"
                    />
                  ) : (
                    <div className="h-14 w-14 rounded-full bg-blue-100 border-2 border-blue-200 flex items-center justify-center text-lg font-semibold text-blue-600">
                      {initials(selectedGuru.nama)}
                    </div>
                  )}
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900">{selectedGuru.nama}</h3>
                    <p className="text-gray-600 text-base">{selectedGuru.email}</p>
                    {selectedGuru.telp && <p className="text-gray-500 text-sm flex items-center gap-2 mt-1">
                      <span>📞</span>
                      <span>{selectedGuru.telp}</span>
                    </p>}
                    <div className="flex items-center space-x-3 mt-2">
                      <span className={`inline-flex items-center px-4 py-1.5 rounded-full text-sm font-medium ${
                        selectedGuru.status === 'active' 
                          ? 'bg-green-100 text-green-800 border border-green-200' 
                          : 'bg-red-100 text-red-800 border border-red-200'
                      }`}>
                        {selectedGuru.status === 'active' ? '✅ Aktif' : '⏸️ Nonaktif'}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  className="p-2.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                  onClick={closeDetailModal}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Content */}
              <div className="p-7 space-y-6 overflow-y-auto flex-1">
                {/* Informasi Profil */}
                <div className="bg-white border border-gray-200 rounded-xl p-5">
                  <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-3">
                    <span className="text-xl">👤</span>
                    Informasi Profil
                  </h4>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <p className="text-sm font-medium text-gray-700 mb-1">Email</p>
                      <p className="text-base text-gray-900">{selectedGuru.email}</p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <p className="text-sm font-medium text-gray-700 mb-1">Telepon</p>
                      <p className="text-base text-gray-900">{selectedGuru.telp || '—'}</p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <p className="text-sm font-medium text-gray-700 mb-1">NIK</p>
                      <p className="text-base text-gray-900">{selectedGuru.nik || '—'}</p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <p className="text-sm font-medium text-gray-700 mb-1">Jenis Kelamin</p>
                      <p className="text-base text-gray-900">{selectedGuru.jk || '—'}</p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <p className="text-sm font-medium text-gray-700 mb-1">Agama</p>
                      <p className="text-base text-gray-900">{selectedGuru.agama || '—'}</p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <p className="text-sm font-medium text-gray-700 mb-1">Jabatan Profil</p>
                      <p className="text-base text-gray-900">{selectedGuru.jabatan || '—'}</p>
                    </div>
                  </div>
                </div>

                {/* Container Grid untuk Mapel, Kelas, dan Jabatan */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Mata Pelajaran Diampu */}
                  <div className="bg-white border border-gray-200 rounded-xl p-5 h-full">
                    <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-3">
                      <span className="text-xl">📚</span>
                      Mata Pelajaran ({selectedGuru.mapelList.length})
                    </h4>
                    <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                      {selectedGuru.mapelList.length > 0 ? (
                        selectedGuru.mapelList.map((mapel, index) => (
                          <div key={index} className="flex items-center p-3 bg-gray-50 rounded-lg border border-gray-100">
                            <span className="text-base text-gray-900 font-medium">{mapel}</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-gray-500 text-base text-center py-4">Tidak ada mata pelajaran</p>
                      )}
                    </div>
                  </div>

                  {/* Kelas Diampu */}
                  <div className="bg-white border border-gray-200 rounded-xl p-5 h-full">
                    <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-3">
                      <span className="text-xl">🏫</span>
                      Kelas Diampu ({selectedGuru.kelasList.length})
                    </h4>
                    <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                      {selectedGuru.kelasList.length > 0 ? (
                        selectedGuru.kelasList.map((kelas, index) => (
                          <div key={index} className="flex items-center p-3 bg-gray-50 rounded-lg border border-gray-100">
                            <span className="text-base text-gray-900 font-medium">{kelas}</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-gray-500 text-base text-center py-4">Tidak ada kelas</p>
                      )}
                    </div>
                  </div>

                  {/* Semua Jabatan */}
                  <div className="bg-white border border-gray-200 rounded-xl p-5 h-full">
                    <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-3">
                      <span className="text-xl">💼</span>
                      Semua Jabatan ({selectedGuru.jabatanList.length})
                    </h4>
                    <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                      {selectedGuru.jabatanList.length > 0 ? (
                        selectedGuru.jabatanList.map((jabatan, index) => (
                          <div key={index} className="flex items-center p-3 bg-gray-50 rounded-lg border border-gray-100">
                            <span className="text-base text-gray-900 font-medium">{jabatan}</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-gray-500 text-base text-center py-4">Tidak ada jabatan</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="px-7 py-5 border-t bg-gray-50 flex justify-end space-x-4">
                <Button
                  variant="secondary"
                  onClick={closeDetailModal}
                  size="lg"
                >
                  ✕ Tutup
                </Button>
                <Button
                  onClick={() => openDeleteConfirm(selectedGuru)}
                  variant="danger"
                  size="lg"
                >
                  🗑️ Hapus Akun Guru
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}