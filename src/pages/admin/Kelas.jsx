import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useUIStore } from '../../store/useUIStore'
import PasswordInput from '../../components/PasswordInput'

/* ===== Password Modal Component (Akses Halaman) ===== */
function PasswordModal({ isOpen, onClose, onConfirm, title = "Konfirmasi Password", loading = false }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!password.trim()) {
      setError('Password tidak boleh kosong')
      return
    }
    
    setError('')
    onConfirm(password)
  }

  const handleClose = () => {
    setPassword('')
    setError('')
    onClose()
  }

  // Close on ESC key
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose()
      }
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-center mb-4">
          <div className="p-3 bg-blue-100 rounded-xl mr-3">
            <span className="text-2xl">🔒</span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
            <p className="text-gray-600 text-sm">
              Hanya admin yang dapat mengakses halaman ini
            </p>
          </div>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password Admin
            </label>
            <PasswordInput
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                error ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="Masukkan password akun admin"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (error) setError('')
              }}
              required
              autoFocus
              disabled={loading}
            />
            {error && (
              <p className="mt-1 text-sm text-red-600 flex items-center">
                <span className="mr-1">⚠️</span>
                {error}
              </p>
            )}
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors duration-200 disabled:opacity-50"
              onClick={handleClose}
              disabled={loading}
            >
              Batal
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed min-w-[100px]"
              disabled={loading || !password.trim()}
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                  </svg>
                  Verifikasi...
                </span>
              ) : 'Konfirmasi'}
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
    // Get current session first
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    
    if (sessionError || !session) {
      throw new Error('Silakan login terlebih dahulu')
    }

    // Re-authenticate with current user's email
    const { error } = await supabase.auth.signInWithPassword({
      email: session.user.email,
      password
    })

    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        throw new Error('Password salah')
      }
      throw error
    }

    return true
  } catch (error) {
    console.error('Password verification error:', error)
    throw error
  }
}

/* ===== Utils ===== */
const HARI_OPTS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']
const GRADE_OPTS = ['VII', 'VIII', 'IX', 'X', 'XI', 'XII']
const GRADE_ORDER = Object.fromEntries(GRADE_OPTS.map((g, i) => [g, i]))
const FORBIDDEN = /[.#$[\]]/

const slug = (s = '') => s.toString().trim().toLowerCase()
  .replace(/[^\w\s-]/g, '')
  .replace(/\s+/g, '-')
  .replace(/-+/g, '-')
  .slice(0, 80)

const toMinutes = (hhmm) => {
  if (!hhmm) return NaN
  const [h, m] = hhmm.split(':').map(Number)
  return (h * 60) + (m || 0)
}

const timesOverlap = (aStart, aEnd, bStart, bEnd) => {
  const as = toMinutes(aStart), ae = toMinutes(aEnd)
  const bs = toMinutes(bStart), be = toMinutes(bEnd)
  if ([as, ae, bs, be].some(Number.isNaN)) return false
  return as < be && bs < ae
}

const GRADE_REGEX = /^\s*(VII|VIII|IX|X|XI|XII)\b/i
const parseGrade = (name = '') => {
  const m = String(name || '').toUpperCase().match(GRADE_REGEX)
  return m ? m[1] : ''
}

const stripGradePrefix = (name = '') => {
  const g = parseGrade(name)
  if (!g) return name.trim()
  return name.toUpperCase().startsWith(g) ? name.slice(g.length).trim() : name.trim()
}

const makeClassName = (grade, suffix) => (grade + (suffix ? ' ' + suffix.trim() : '')).trim()

/* quick helpers */
const confirmDelete = (msg = 'Yakin mau dihapus?') => window.confirm(msg)

/* ===== Component Utama: AKelas (Terkunci Password) ===== */
export default function AKelas() {
  const { pushToast } = useUIStore()

  /* ---------- LOCK SCREEN STATE ---------- */
  const [isAuthorized, setIsAuthorized] = useState(true)
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [passwordLoading, setPasswordLoading] = useState(false)

  const handlePasswordConfirm = async (password) => {
    setPasswordLoading(true)
    try {
      await verifyPassword(password)
      setIsAuthorized(true)
      setPasswordModalOpen(false)
      pushToast('success', 'Akses diizinkan. Selamat datang di Manajemen Kelas & Jadwal.')
    } catch (error) {
      console.error('Password verification failed:', error)
      pushToast('error', error.message || 'Gagal verifikasi password')
    } finally {
      setPasswordLoading(false)
    }
  }

  const handlePasswordClose = () => {
    setPasswordModalOpen(false)
  }

  /* ---------- State Lama ---------- */
  const [tab, setTab] = useState('kelas')
  const [loading, setLoading] = useState(false)

  /* Data umum: guru & siswa */
  const [guruList, setGuruList] = useState([])
  const [siswaList, setSiswaList] = useState([])

  /* =========================================================
     TAB 1 — KELAS & JADWAL + STRUKTUR KELAS
  ========================================================= */
  const [kelas, setKelas] = useState([])
  const [filterGrade, setFilterGrade] = useState('')
  const [kelasSelected, setKelasSelected] = useState('')
  const [jadwal, setJadwal] = useState([])
  const [filterHari, setFilterHari] = useState('')

  // Form buat kelas
  const [newGrade, setNewGrade] = useState('')
  const [newSuffix, setNewSuffix] = useState('')
  const selObj = React.useMemo(() => kelas.find(k => k.id === kelasSelected) || null, [kelas, kelasSelected])

  // Struktur kelas
  const [waliGuruId, setWaliGuruId] = useState('')
  const [ketuaUid, setKetuaUid] = useState('')

  // Mata Pelajaran
  const [mapelList, setMapelList] = useState([])
  const [newMapel, setNewMapel] = useState('')

  // Form Jadwal
  const [form, setForm] = useState({ hari: '', mapel: '', guruId: '', jamMulai: '', jamSelesai: '' })
  const [editId, setEditId] = useState(null)
  const [editData, setEditData] = useState(null)

  /* ====== EFFECTS ====== */

  // Load guru & siswa setelah password benar
  useEffect(() => {
    if (!isAuthorized) return
    
    const loadData = async () => {
      setLoading(true)
      try {
        await Promise.all([
          loadGuruList(),
          loadSiswaList(),
          loadKelas(),
          loadMapelList()
        ])
      } catch (error) {
        console.error('Error loading initial data:', error)
      } finally {
        setLoading(false)
      }
    }
    
    loadData()
  }, [isAuthorized])

  // Load jadwal & struktur kelas ketika kelasSelected berubah
  useEffect(() => {
    if (!isAuthorized || !kelasSelected) return

    const loadKelasData = async () => {
      setLoading(true)
      try {
        await Promise.all([
          loadJadwal(),
          loadStrukturKelas()
        ])
      } catch (error) {
        console.error('Error loading kelas data:', error)
      } finally {
        setLoading(false)
      }
    }

    loadKelasData()
  }, [isAuthorized, kelasSelected])

  /* ================== LOADERS ================== */
  const loadGuruList = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, nama, email, role')
        .in('role', ['guru', 'teacher'])
        .order('nama')

      if (error) throw error

      const guru = data.map(u => ({
        id: u.id,
        name: (u.nama || u.email || u.id) + (u.email ? ` (${u.email})` : '')
      }))
      setGuruList(guru)
    } catch (error) {
      console.error('Error loading guru:', error)
      pushToast('error', 'Gagal memuat data guru')
      throw error
    }
  }, [pushToast])

  const loadSiswaList = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, nama, email, kelas, role')
        .eq('role', 'siswa')
        .order('kelas')
        .order('nama')

      if (error) throw error

      const siswa = data.map(u => ({
        uid: u.id,
        nama: u.nama || u.email || u.id,
        kelas: u.kelas || ''
      }))
      setSiswaList(siswa)
    } catch (error) {
      console.error('Error loading siswa:', error)
      pushToast('error', 'Gagal memuat data siswa')
      throw error
    }
  }, [pushToast])

  const loadKelas = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('kelas')
        .select('*')
        .order('grade')
        .order('suffix')

      if (error) throw error

      const rows = data.map(k => ({
        id: k.id,
        nama: k.nama || k.id,
        grade: k.grade || parseGrade(k.id),
        suffix: k.suffix || stripGradePrefix(k.nama || k.id),
        ...k
      }))

      rows.sort((a, b) => {
        const ag = GRADE_ORDER[a.grade] ?? 999
        const bg = GRADE_ORDER[b.grade] ?? 999
        if (ag !== bg) return ag - bg
        return (a.suffix || '').localeCompare(b.suffix || '', 'id')
      })

      setKelas(rows)
      if (!kelasSelected && rows.length) {
        setKelasSelected(rows[0].id)
      }
    } catch (error) {
      console.error('Error loading kelas:', error)
      pushToast('error', 'Gagal memuat data kelas')
      throw error
    }
  }, [kelasSelected, pushToast])

  const loadJadwal = useCallback(async () => {
    if (!kelasSelected) return

    try {
      const { data, error } = await supabase
        .from('jadwal')
        .select('*')
        .eq('kelas_id', kelasSelected)
        .order('hari')
        .order('jam_mulai')

      if (error) throw error

      const rows = data.map(j => ({
        id: j.id,
        hari: j.hari,
        mapel: j.mapel,
        guruId: j.guru_id,
        guruNama: j.guru_nama || '',
        jamMulai: j.jam_mulai,
        jamSelesai: j.jam_selesai
      }))

      rows.sort((a, b) => {
        const ai = HARI_OPTS.indexOf(a.hari)
        const bi = HARI_OPTS.indexOf(b.hari)
        if (ai !== bi) return ai - bi
        return toMinutes(a.jamMulai) - toMinutes(b.jamMulai)
      })

      setJadwal(rows)
    } catch (error) {
      console.error('Error loading jadwal:', error)
      pushToast('error', 'Gagal memuat jadwal')
      throw error
    }
  }, [kelasSelected, pushToast])

  const loadStrukturKelas = useCallback(async () => {
    if (!kelasSelected) return

    try {
      const { data, error } = await supabase
        .from('kelas_struktur')
        .select('*')
        .eq('kelas_id', kelasSelected)
        .maybeSingle()

      if (error && error.code !== 'PGRST116') throw error

      setWaliGuruId(data?.wali_guru_id || '')
      setKetuaUid(data?.ketua_siswa_id || '')
    } catch (error) {
      console.error('Error loading struktur kelas:', error)
      pushToast('error', 'Gagal memuat struktur kelas')
      throw error
    }
  }, [kelasSelected, pushToast])

  const loadMapelList = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('mata_pelajaran')
        .select('*')
        .order('nama')

      if (error) throw error

      const rows = data.map(m => ({
        id: m.id,
        nama: m.nama || m.id,
        ...m
      }))

      setMapelList(rows)
    } catch (error) {
      console.error('Error loading mata pelajaran:', error)
      pushToast('error', 'Gagal memuat mata pelajaran')
      throw error
    }
  }, [pushToast])

  /* ================== DERIVED DATA ================== */
  const kelasByGrade = React.useMemo(() => {
    return filterGrade ? kelas.filter(k => k.grade === filterGrade) : kelas
  }, [kelas, filterGrade])

  const siswaDiKelasTerpilih = React.useMemo(() => {
    return siswaList.filter(s => s.kelas === kelasSelected)
  }, [siswaList, kelasSelected])

  const jadwalToShow = React.useMemo(() => {
    if (!filterHari) return jadwal
    return jadwal.filter(j => j.hari === filterHari)
  }, [jadwal, filterHari])

  function guruNameById(id) {
    return guruList.find(g => g.id === id)?.name || ''
  }

  function siswaNameByUid(uid) {
    return siswaList.find(s => s.uid === uid)?.nama || ''
  }

  function buildJadwalKey({ hari, mapel, jamMulai, jamSelesai }) {
    const cleanMapel = (mapel || '').replace(/\s+/g, '_').replace(/[^\w-]/g, '')
    const cleanHari = (hari || '').replace(/\s+/g, '_')
    const cleanJamMulai = (jamMulai || '').replace(/:/g, '')
    const cleanJamSelesai = (jamSelesai || '').replace(/:/g, '')

    return `${kelasSelected}-${cleanHari}-${cleanMapel}-${cleanJamMulai}-${cleanJamSelesai}`
  }

  async function hasConflict({ hari, jamMulai, jamSelesai, guruId, mapel, kelasId }, ignoreId = null) {
    if (!kelasId) return 'Kelas belum dipilih'

    try {
      // Validasi waktu
      if (toMinutes(jamMulai) >= toMinutes(jamSelesai)) {
        return 'Jam mulai harus lebih awal dari jam selesai'
      }

      // Validasi durasi minimal (30 menit)
      const durasi = toMinutes(jamSelesai) - toMinutes(jamMulai)
      if (durasi < 30) {
        return 'Durasi pelajaran minimal 30 menit'
      }

      // Bentrok di kelas yang sama
      let classQuery = supabase
        .from('jadwal')
        .select('*')
        .eq('kelas_id', kelasId)
        .eq('hari', hari)

      if (ignoreId) {
        classQuery = classQuery.neq('id', ignoreId)
      }

      const { data: sameClassSchedule, error: classError } = await classQuery
      if (classError) throw classError

      for (const j of sameClassSchedule) {
        if (timesOverlap(jamMulai, jamSelesai, j.jam_mulai, j.jam_selesai)) {
          return `Konflik dengan ${j.mapel} di kelas ini (${j.jam_mulai}-${j.jam_selesai})`
        }
      }

      // Bentrok guru
      if (guruId) {
        let teacherQuery = supabase
          .from('jadwal')
          .select('*')
          .eq('guru_id', guruId)
          .eq('hari', hari)

        if (ignoreId) {
          teacherQuery = teacherQuery.neq('id', ignoreId)
        }

        const { data: teacherSchedule, error: teacherError } = await teacherQuery
        if (teacherError) throw teacherError

        for (const j of teacherSchedule) {
          if (timesOverlap(jamMulai, jamSelesai, j.jam_mulai, j.jam_selesai)) {
            return `Guru bentrok di kelas ${j.kelas_id} (${j.mapel} ${j.jam_mulai}-${j.jam_selesai})`
          }
        }
      }

      // Bentrok mapel (opsional)
      let mapelQuery = supabase
        .from('jadwal')
        .select('*')
        .eq('mapel', mapel)
        .eq('hari', hari)

      if (ignoreId) {
        mapelQuery = mapelQuery.neq('id', ignoreId)
      }

      const { data: sameMapelSchedule, error: mapelError } = await mapelQuery
      if (mapelError) throw mapelError

      for (const j of sameMapelSchedule) {
        if (timesOverlap(jamMulai, jamSelesai, j.jam_mulai, j.jam_selesai)) {
          return `Mata pelajaran ${mapel} bentrok di kelas ${j.kelas_id} (${j.jam_mulai}-${j.jam_selesai})`
        }
      }

      return null
    } catch (error) {
      console.error('Error checking conflict:', error)
      return 'Error memeriksa konflik jadwal'
    }
  }

  /* ------- KELAS ------- */
  async function tambahKelas() {
    const grade = (newGrade || '').toUpperCase().trim()
    const suffix = (newSuffix || '').toUpperCase().trim()
    
    if (!GRADE_OPTS.includes(grade)) {
      pushToast('error', 'Pilih grade: VII–XII.')
      return
    }
    
    if (!suffix) {
      pushToast('error', 'Nama/sufiks kelas harus diisi.')
      return
    }
    
    if (FORBIDDEN.test(suffix)) {
      pushToast('error', 'Sufiks tidak boleh mengandung . # $ [ ]')
      return
    }

    const nama = makeClassName(grade, suffix).toUpperCase()
    const id = slug(nama)

    try {
      setLoading(true)
      
      // Cek apakah sudah ada
      const { data: existing } = await supabase
        .from('kelas')
        .select('id')
        .eq('id', id)
        .single()

      if (existing) {
        pushToast('error', 'Kelas sudah ada.')
        return
      }

      const { error } = await supabase
        .from('kelas')
        .insert({
          id,
          nama,
          grade,
          suffix,
          created_at: new Date().toISOString()
        })

      if (error) throw error

      pushToast('success', `Kelas ${nama} berhasil ditambahkan`)
      setNewGrade('')
      setNewSuffix('')
      setKelasSelected(id)
      await loadKelas()
    } catch (error) {
      console.error('Error adding kelas:', error)
      pushToast('error', error.message || 'Gagal menambah kelas')
    } finally {
      setLoading(false)
    }
  }

  async function hapusKelas(id) {
    if (!confirmDelete(`Yakin mau hapus kelas? Semua data terkait (jadwal, struktur) juga akan dihapus.`)) return

    try {
      setLoading(true)

      // Cek siswa
      const { data: siswaData, error: siswaError } = await supabase
        .from('profiles')
        .select('id, nama, kelas')
        .eq('kelas', id)

      if (siswaError) throw siswaError

      if (siswaData && siswaData.length > 0) {
        const siswaNames = siswaData.slice(0, 3).map(s => s.nama).join(', ')
        const sisa = siswaData.length > 3 ? ` dan ${siswaData.length - 3} lainnya` : ''
        
        pushToast('error', 
          `Tidak bisa hapus: kelas masih digunakan oleh ${siswaData.length} siswa. 
          ${siswaNames}${sisa}. Pindahkan siswa terlebih dahulu.`)
        return
      }

      // Hapus terkait dalam urutan yang benar
      await supabase.from('jam_kosong').delete().eq('kelas', id)
      await supabase.from('absensi_settings').delete().eq('kelas', id)
      await supabase.from('absensi').delete().eq('kelas', id)
      await supabase.from('tugas').delete().eq('kelas', id)
      await supabase.from('jadwal').delete().eq('kelas_id', id)
      await supabase.from('kelas_struktur').delete().eq('kelas_id', id)

      const { error } = await supabase
        .from('kelas')
        .delete()
        .eq('id', id)

      if (error) throw error

      pushToast('success', 'Kelas dan semua data terkait berhasil dihapus')
      if (kelasSelected === id) setKelasSelected('')
      await loadKelas()
    } catch (error) {
      console.error('Error deleting kelas:', error)
      
      if (error.code === '23503') {
        pushToast('error', 'Tidak dapat menghapus kelas karena masih terkait dengan data lain.')
      } else {
        pushToast('error', 'Gagal menghapus kelas: ' + (error.message || 'Unknown error'))
      }
    } finally {
      setLoading(false)
    }
  }

  /* ------- STRUKTUR KELAS ------- */
  async function simpanStrukturKelas() {
    if (!kelasSelected) {
      pushToast('error', 'Pilih kelas terlebih dahulu.')
      return
    }

    try {
      setLoading(true)
      const payload = {
        kelas_id: kelasSelected,
        wali_guru_id: waliGuruId || null,
        wali_guru_nama: waliGuruId ? guruNameById(waliGuruId) : '',
        ketua_siswa_id: ketuaUid || null,
        ketua_siswa_nama: ketuaUid ? siswaNameByUid(ketuaUid) : '',
        updated_at: new Date().toISOString()
      }

      const { error } = await supabase
        .from('kelas_struktur')
        .upsert(payload, { onConflict: 'kelas_id' })

      if (error) throw error

      pushToast('success', 'Struktur kelas berhasil disimpan')
    } catch (error) {
      console.error('Error saving struktur:', error)
      pushToast('error', 'Gagal menyimpan struktur kelas')
    } finally {
      setLoading(false)
    }
  }

  async function kosongkanStrukturKelas() {
    if (!kelasSelected) return
    if (!confirmDelete('Yakin mau mengosongkan struktur kelas?')) return

    try {
      setLoading(true)
      const { error } = await supabase
        .from('kelas_struktur')
        .delete()
        .eq('kelas_id', kelasSelected)

      if (error) throw error

      setWaliGuruId('')
      setKetuaUid('')
      pushToast('success', 'Struktur kelas berhasil dikosongkan')
    } catch (error) {
      console.error('Error clearing struktur:', error)
      pushToast('error', 'Gagal mengosongkan struktur')
    } finally {
      setLoading(false)
    }
  }

  /* ------- MATA PELAJARAN ------- */
  async function tambahMapel() {
    const nama = (newMapel || '').trim()
    if (!nama) {
      pushToast('error', 'Nama mata pelajaran harus diisi')
      return
    }
    
    if (nama.length < 2) {
      pushToast('error', 'Nama mata pelajaran minimal 2 karakter')
      return
    }
    
    if (FORBIDDEN.test(nama)) {
      pushToast('error', 'Nama mapel tidak boleh mengandung . # $ [ ]')
      return
    }

    const id = slug(nama)

    try {
      setLoading(true)
      
      // Cek apakah sudah ada
      const { data: existing } = await supabase
        .from('mata_pelajaran')
        .select('id')
        .eq('id', id)
        .single()

      if (existing) {
        pushToast('error', 'Mata pelajaran sudah ada.')
        return
      }

      const { error } = await supabase
        .from('mata_pelajaran')
        .insert({
          id,
          nama,
          created_at: new Date().toISOString()
        })

      if (error) throw error

      pushToast('success', `Mata pelajaran "${nama}" berhasil ditambahkan`)
      setNewMapel('')
      await loadMapelList()
      
      // Update form jadwal jika mapel ini dipilih
      if (form.mapel === '') {
        setForm(f => ({ ...f, mapel: nama }))
      }
    } catch (error) {
      console.error('Error adding mapel:', error)
      pushToast('error', error.message || 'Gagal menambah mata pelajaran')
    } finally {
      setLoading(false)
    }
  }

  async function hapusMapel(mapel) {
    if (!confirmDelete(`Hapus mata pelajaran "${mapel.nama}"?`)) return

    try {
      setLoading(true)
      
      // Cek apakah masih digunakan di jadwal
      const { data: usedJadwal, error: checkError } = await supabase
        .from('jadwal')
        .select('kelas_id')
        .eq('mapel', mapel.nama)
        .limit(1)

      if (checkError) throw checkError

      if (usedJadwal.length > 0) {
        pushToast('error', 
          `Tidak bisa hapus: Mata pelajaran "${mapel.nama}" masih dipakai di jadwal. 
          Hapus semua jadwal dengan mapel ini terlebih dahulu.`)
        return
      }

      const { error } = await supabase
        .from('mata_pelajaran')
        .delete()
        .eq('id', mapel.id)

      if (error) throw error

      pushToast('success', 'Mata pelajaran berhasil dihapus')
      await loadMapelList()
    } catch (error) {
      console.error('Error deleting mapel:', error)
      pushToast('error', 'Gagal menghapus mata pelajaran')
    } finally {
      setLoading(false)
    }
  }

  /* ------- JADWAL ------- */
  async function tambahJadwal(e) {
    e?.preventDefault?.()
    if (!kelasSelected) {
      pushToast('error', 'Pilih kelas terlebih dahulu.')
      return
    }

    const { hari, mapel, guruId, jamMulai, jamSelesai } = form

    // Validasi
    if (!hari || !mapel || !jamMulai || !jamSelesai) {
      pushToast('error', 'Lengkapi semua field yang wajib (Hari, Mapel, Jam Mulai, Jam Selesai).')
      return
    }

    try {
      setLoading(true)

      const conflictMsg = await hasConflict({
        hari,
        jamMulai,
        jamSelesai,
        guruId,
        mapel,
        kelasId: kelasSelected
      })

      if (conflictMsg) {
        pushToast('error', conflictMsg)
        return
      }

      const id = buildJadwalKey({ hari, mapel, jamMulai, jamSelesai })
      const guruNama = guruId ? guruNameById(guruId) : ''

      const { error } = await supabase
        .from('jadwal')
        .insert({
          id,
          kelas_id: kelasSelected,
          hari,
          mapel,
          guru_id: guruId || null,
          guru_nama: guruNama,
          jam_mulai: jamMulai,
          jam_selesai: jamSelesai,
          created_at: new Date().toISOString()
        })

      if (error) throw error

      pushToast('success', 'Jadwal berhasil ditambahkan')
      setForm({ hari: '', mapel: '', guruId: '', jamMulai: '', jamSelesai: '' })
      await loadJadwal()
    } catch (error) {
      console.error('Error adding jadwal:', error)
      
      if (error.code === '23505') {
        pushToast('error', 'Jadwal dengan kombinasi ini sudah ada.')
      } else {
        pushToast('error', `Gagal menambah jadwal: ${error.message}`)
      }
    } finally {
      setLoading(false)
    }
  }

  async function hapusJadwal(id) {
    if (!confirmDelete('Yakin mau menghapus jadwal ini?')) return

    try {
      setLoading(true)
      const { error } = await supabase
        .from('jadwal')
        .delete()
        .eq('id', id)

      if (error) throw error

      pushToast('success', 'Jadwal berhasil dihapus')
      if (editId === id) {
        setEditId(null)
        setEditData(null)
      }
      await loadJadwal()
    } catch (error) {
      console.error('Error deleting jadwal:', error)
      pushToast('error', 'Gagal menghapus jadwal')
    } finally {
      setLoading(false)
    }
  }

  function startEdit(row) {
    setEditId(row.id)
    setEditData({ ...row })
  }

  function cancelEdit() {
    setEditId(null)
    setEditData(null)
  }

  async function saveEdit() {
    if (!editData) return

    const { hari, mapel, guruId, jamMulai, jamSelesai } = editData

    if (!hari || !mapel || !jamMulai || !jamSelesai) {
      pushToast('error', 'Lengkapi semua field yang wajib.')
      return
    }

    try {
      setLoading(true)

      const conflictMsg = await hasConflict({
        hari,
        jamMulai,
        jamSelesai,
        guruId,
        mapel,
        kelasId: kelasSelected
      }, editId)

      if (conflictMsg) {
        pushToast('error', conflictMsg)
        return
      }

      const newId = buildJadwalKey({ hari, mapel, jamMulai, jamSelesai })
      const guruNama = guruId ? guruNameById(guruId) : ''

      if (newId !== editId) {
        // Hapus yang lama dan buat yang baru
        await supabase
          .from('jadwal')
          .delete()
          .eq('id', editId)

        const { error } = await supabase
          .from('jadwal')
          .insert({
            id: newId,
            kelas_id: kelasSelected,
            hari,
            mapel,
            guru_id: guruId || null,
            guru_nama: guruNama,
            jam_mulai: jamMulai,
            jam_selesai: jamSelesai,
            updated_at: new Date().toISOString()
          })

        if (error) throw error
      } else {
        // Update yang sudah ada
        const { error } = await supabase
          .from('jadwal')
          .update({
            hari,
            mapel,
            guru_id: guruId || null,
            guru_nama: guruNama,
            jam_mulai: jamMulai,
            jam_selesai: jamSelesai,
            updated_at: new Date().toISOString()
          })
          .eq('id', editId)

        if (error) throw error
      }

      pushToast('success', 'Jadwal berhasil diupdate')
      setEditId(null)
      setEditData(null)
      await loadJadwal()
    } catch (error) {
      console.error('Error saving jadwal:', error)
      pushToast('error', 'Gagal menyimpan jadwal')
    } finally {
      setLoading(false)
    }
  }

  // Fungsi untuk mengekspor jadwal ke PDF/Excel (placeholder)
  const exportJadwal = () => {
    pushToast('info', 'Fitur ekspor jadwal akan segera tersedia')
  }

  // Fungsi untuk mencetak jadwal
  const printJadwal = () => {
    window.print()
  }

  /* ============================ RENDER ============================ */
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-6">
      {/* Modal Password Akses Halaman */}
      <PasswordModal
        isOpen={passwordModalOpen && !isAuthorized}
        onClose={handlePasswordClose}
        onConfirm={handlePasswordConfirm}
        title="Akses Manajemen Kelas & Jadwal"
        loading={passwordLoading}
      />

      {/* Jika belum authorized: tampilkan layar kunci saja */}
      {!isAuthorized ? (
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 w-full max-w-md">
            <div className="text-center mb-6">
              <div className="w-16 h-16 mx-auto mb-4 bg-blue-100 rounded-full flex items-center justify-center">
                <span className="text-3xl">🔒</span>
              </div>
              <h1 className="text-2xl font-bold text-gray-900">Halaman Terkunci</h1>
              <p className="text-gray-600 mt-2">
                Halaman ini memerlukan autentikasi admin. 
                Silakan konfirmasi password untuk melanjutkan.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setPasswordModalOpen(true)}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-3 px-4 rounded-lg hover:from-blue-700 hover:to-blue-800 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 text-sm font-medium transition-all duration-200 shadow-md flex items-center justify-center space-x-2"
            >
              <span>🔑</span>
              <span>Masukkan Password Admin</span>
            </button>
            
            <div className="mt-4 text-center">
              <p className="text-xs text-gray-500">
                Hanya user dengan role admin yang dapat mengakses
              </p>
            </div>
          </div>
        </div>
      ) : (
        /* ================== KONTEN ASLI HALAMAN ================== */
        <div className="w-full space-y-8 px-4 sm:px-6 lg:px-8 pt-2">
          {/* Header */}
          <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
            <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
              <div className="flex items-center space-x-4">
                <div className="p-3 bg-blue-100 rounded-2xl">
                  <span className="text-2xl text-blue-600">🏫</span>
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Manajemen Kelas & Jadwal</h1>
                  <p className="text-gray-600 mt-1">
                    Kelola data kelas, jadwal pelajaran, dan struktur organisasi sekolah
                  </p>
                </div>
              </div>
              
              {/* Tab Navigation */}
              <div className="flex flex-wrap gap-2">
                {[
                  {
                    key: 'kelas',
                    label: 'Kelas & Jadwal',
                    icon: '📚',
                    activeClass: 'bg-blue-600 text-white border border-blue-600 shadow-sm',
                    idleClass: 'bg-gray-50 text-gray-700 border border-gray-200 hover:bg-blue-50 hover:text-blue-700'
                  },
                  {
                    key: 'struktur',
                    label: 'Struktur Sekolah',
                    icon: '🏢',
                    activeClass: 'bg-purple-600 text-white border border-purple-600 shadow-sm',
                    idleClass: 'bg-gray-50 text-gray-700 border border-gray-200 hover:bg-purple-50 hover:text-purple-700'
                  },
                  {
                    key: 'org',
                    label: 'Organisasi',
                    icon: '👥',
                    activeClass: 'bg-green-600 text-white border border-green-600 shadow-sm',
                    idleClass: 'bg-gray-50 text-gray-700 border border-gray-200 hover:bg-green-50 hover:text-green-700'
                  }
                ].map(({ key, label, icon, activeClass, idleClass }) => {
                  const active = tab === key
                  return (
                    <button
                      key={key}
                      className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 flex items-center space-x-2 ${
                        active ? activeClass : idleClass
                      }`}
                      onClick={() => setTab(key)}
                    >
                      <span>{icon}</span>
                      <span>{label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="space-y-6">
            {/* Loading Overlay */}
            {(loading || passwordLoading) && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
                <div className="bg-white rounded-2xl p-6 flex flex-col items-center space-y-4 shadow-2xl">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                  <div className="text-center">
                    <span className="text-gray-700 font-medium">Memproses data...</span>
                    <p className="text-sm text-gray-500 mt-1">Mohon tunggu sebentar</p>
                  </div>
                </div>
              </div>
            )}

            {/* ===================== TAB: KELAS & JADWAL ===================== */}
            {tab === 'kelas' && (
              <div className="space-y-6">
                {/* Statistik Ringkas */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-white rounded-xl p-4 shadow border border-gray-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">Total Kelas</p>
                        <p className="text-2xl font-bold text-gray-900">{kelas.length}</p>
                      </div>
                      <div className="p-3 bg-blue-100 rounded-lg">
                        <span className="text-xl">🏫</span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl p-4 shadow border border-gray-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">Total Guru</p>
                        <p className="text-2xl font-bold text-gray-900">{guruList.length}</p>
                      </div>
                      <div className="p-3 bg-green-100 rounded-lg">
                        <span className="text-xl">👨‍🏫</span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl p-4 shadow border border-gray-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">Total Mapel</p>
                        <p className="text-2xl font-bold text-gray-900">{mapelList.length}</p>
                      </div>
                      <div className="p-3 bg-purple-100 rounded-lg">
                        <span className="text-xl">📚</span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl p-4 shadow border border-gray-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">Total Jadwal</p>
                        <p className="text-2xl font-bold text-gray-900">{jadwal.length}</p>
                      </div>
                      <div className="p-3 bg-orange-100 rounded-lg">
                        <span className="text-xl">📅</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Kelas List Card */}
                <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
                    <div>
                      <h2 className="text-xl font-bold text-gray-900 flex items-center space-x-2">
                        <span className="p-2 bg-blue-100 rounded-lg">📋</span>
                        <span>Daftar Kelas</span>
                      </h2>
                      <p className="text-gray-600 text-sm mt-1">
                        Pilih kelas untuk melihat dan mengelola jadwal
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <div className="flex items-center space-x-2">
                        <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
                          Filter Grade:
                        </label>
                        <select
                          className="block w-full sm:w-48 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                          value={filterGrade}
                          onChange={e => {
                            setFilterGrade(e.target.value)
                            const first = kelas.find(k => k.grade === e.target.value)
                            if (first) setKelasSelected(first.id)
                          }}
                        >
                          <option value="">Semua Grade</option>
                          {GRADE_OPTS.map(g => (
                            <option key={g} value={g}>{g}</option>
                          ))}
                        </select>
                      </div>
                      
                      <button
                        onClick={exportJadwal}
                        className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center space-x-2"
                      >
                        <span>📥</span>
                        <span>Ekspor</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    {kelasByGrade.map(k => (
                      <div key={k.id} className="relative group">
                        <button
                          className={`px-5 py-3 rounded-xl border-2 transition-all duration-200 font-semibold min-w-[120px] flex flex-col items-center justify-center ${
                            kelasSelected === k.id
                              ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white border-blue-600 shadow-lg transform scale-105'
                              : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:text-blue-600 hover:shadow-md'
                          }`}
                          onClick={() => setKelasSelected(k.id)}
                          title={k.nama || k.id}
                        >
                          <span className="block text-lg font-bold">{(k.nama || k.id).toUpperCase()}</span>
                          <span className="text-xs opacity-75 mt-1">Grade {k.grade}</span>
                        </button>
                        
                        {/* Delete button (only visible on hover) */}
                        <button
                          className="absolute -top-2 -right-2 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-red-600 shadow-lg z-10"
                          onClick={(e) => {
                            e.stopPropagation()
                            hapusKelas(k.id)
                          }}
                          title="Hapus kelas"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                    
                    {/* Empty State */}
                    {!kelasByGrade.length && (
                      <div className="text-center py-12 text-gray-500 w-full">
                        <div className="w-20 h-20 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                          <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0H4" />
                          </svg>
                        </div>
                        <p className="text-lg font-medium">Belum ada kelas</p>
                        <p className="text-sm mt-1">Tambahkan kelas baru untuk memulai</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Grid untuk Form Kelas dan Mata Pelajaran */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Form Buat Kelas */}
                  <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
                      <span className="p-2 bg-blue-100 rounded-lg">✨</span>
                      <span>Buat Kelas Baru</span>
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Grade <span className="text-red-500">*</span>
                        </label>
                        <select
                          className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                          value={newGrade}
                          onChange={e => setNewGrade(e.target.value)}
                        >
                          <option value="">Pilih grade</option>
                          {GRADE_OPTS.map(g => (
                            <option key={g} value={g}>{g}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Nama / Sufiks Kelas <span className="text-red-500">*</span>
                        </label>
                        <input
                          className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm text-gray-900"
                          placeholder="Contoh: A, IPA 1, atau A IPS"
                          value={newSuffix}
                          onChange={e => setNewSuffix(String(e.target.value || '').toUpperCase())}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Contoh hasil: VII A, X IPA 1, dll.
                        </p>
                      </div>
                      <button
                        className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-3 px-4 rounded-lg hover:from-blue-700 hover:to-blue-800 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 font-medium shadow-md flex items-center justify-center space-x-2 disabled:opacity-50"
                        onClick={tambahKelas}
                        disabled={!newGrade || !newSuffix.trim()}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                        <span>Tambah Kelas Baru</span>
                      </button>
                    </div>
                  </div>

                  {/* Mata Pelajaran */}
                  <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
                      <span className="p-2 bg-purple-100 rounded-lg">📖</span>
                      <span>Kelola Mata Pelajaran</span>
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Nama Mata Pelajaran Baru <span className="text-red-500">*</span>
                        </label>
                        <div className="flex space-x-3">
                          <input
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm text-gray-900"
                            placeholder="Contoh: Matematika Wajib"
                            value={newMapel}
                            onChange={e => setNewMapel(e.target.value)}
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                tambahMapel()
                              }
                            }}
                          />
                          <button
                            className="bg-gradient-to-r from-purple-600 to-purple-700 text-white px-5 py-2 rounded-lg hover:from-purple-700 hover:to-purple-800 focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition-all duration-200 font-medium shadow-md flex items-center space-x-2"
                            onClick={tambahMapel}
                            disabled={!newMapel.trim()}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                            </svg>
                            <span>Tambah</span>
                          </button>
                        </div>
                      </div>

                      <div className="border-t pt-4">
                        <h4 className="text-sm font-medium text-gray-700 mb-3">Daftar Mata Pelajaran</h4>
                        <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                          {mapelList.map(m => (
                            <div
                              key={m.id}
                              className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors duration-150 group"
                            >
                              <div className="flex items-center space-x-3">
                                <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                                  <span className="text-purple-600">📚</span>
                                </div>
                                <span className="font-medium text-gray-800">{m.nama}</span>
                              </div>
                              <button
                                className="text-red-500 hover:text-red-700 p-2 rounded-lg transition-all duration-200 hover:bg-red-50 opacity-0 group-hover:opacity-100"
                                onClick={() => hapusMapel(m)}
                                title="Hapus mata pelajaran"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          ))}
                          {!mapelList.length && (
                            <div className="text-center py-8 text-gray-500">
                              <div className="w-12 h-12 mx-auto mb-3 bg-gray-100 rounded-full flex items-center justify-center">
                                <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                                </svg>
                              </div>
                              <p>Belum ada mata pelajaran</p>
                              <p className="text-xs mt-1">Tambahkan mata pelajaran untuk digunakan di jadwal</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Struktur Kelas */}
                {selObj && kelasSelected && (
                  <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
                      <span className="p-2 bg-green-100 rounded-lg">👨‍🏫</span>
                      <span>Struktur Kelas • <span className="font-bold">{(selObj?.nama || kelasSelected).toUpperCase()}</span></span>
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Wali Kelas</label>
                          <select
                            className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                            value={waliGuruId}
                            onChange={e => setWaliGuruId(e.target.value)}
                          >
                            <option value="">Pilih wali kelas</option>
                            {guruList.map(g => (
                              <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                          </select>
                          {waliGuruId && (
                            <p className="text-xs text-green-600 mt-1">
                              {guruNameById(waliGuruId)}
                            </p>
                          )}
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Ketua Kelas</label>
                          <select
                            className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                            value={ketuaUid}
                            onChange={e => setKetuaUid(e.target.value)}
                          >
                            <option value="">Pilih ketua kelas</option>
                            {siswaDiKelasTerpilih.map(s => (
                              <option key={s.uid} value={s.uid}>
                                {s.nama} {s.kelas ? `(${s.kelas})` : ''}
                              </option>
                            ))}
                          </select>
                          {ketuaUid && (
                            <p className="text-xs text-green-600 mt-1">
                              {siswaNameByUid(ketuaUid)}
                            </p>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex flex-col justify-end space-y-3">
                        <div className="text-sm text-gray-600 bg-gray-50 p-4 rounded-lg">
                          <p className="font-medium mb-2">Info:</p>
                          <ul className="space-y-1 text-xs">
                            <li>• Wali kelas bertanggung jawab penuh terhadap kelas</li>
                            <li>• Ketua kelas mewakili siswa dalam kelas</li>
                            <li>• Data akan tersimpan secara otomatis</li>
                          </ul>
                        </div>
                        
                        <div className="flex space-x-3 pt-2">
                          <button
                            className="flex-1 bg-gradient-to-r from-green-600 to-green-700 text-white py-3 px-4 rounded-lg hover:from-green-700 hover:to-green-800 focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-200 font-medium shadow-md flex items-center justify-center space-x-2"
                            onClick={simpanStrukturKelas}
                            disabled={loading}
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span>Simpan Struktur</span>
                          </button>
                          <button
                            className="px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-all duration-200 font-medium flex items-center space-x-2"
                            onClick={kosongkanStrukturKelas}
                            disabled={loading}
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            <span>Reset</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Jadwal Section */}
                {kelasSelected && (
                  <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between mb-6">
                      <div>
                        <h3 className="text-xl font-bold text-gray-900 flex items-center space-x-2">
                          <span className="p-2 bg-orange-100 rounded-lg">📅</span>
                          <span>Jadwal Pelajaran • <span className="font-bold">{(selObj?.nama || kelasSelected).toUpperCase()}</span></span>
                        </h3>
                        <p className="text-gray-600 text-sm mt-1">
                          Kelola jadwal pelajaran untuk kelas ini
                        </p>
                      </div>
                      
                      <div className="flex items-center space-x-3 mt-4 lg:mt-0">
                        <button
                          onClick={printJadwal}
                          className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center space-x-2"
                        >
                          <span>🖨️</span>
                          <span>Cetak</span>
                        </button>
                        <button
                          onClick={exportJadwal}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2"
                        >
                          <span>📥</span>
                          <span>Ekspor</span>
                        </button>
                      </div>
                    </div>

                    {/* Filter Hari */}
                    <div className="mb-6 flex flex-col sm:flex-row sm:items-end space-y-4 sm:space-y-0 sm:space-x-4 bg-blue-50 p-4 rounded-xl border border-blue-200">
                      <div className="flex-1">
                        <label className="block text-sm font-medium text-blue-800 mb-1">Filter Hari</label>
                        <select
                          className="block w-full sm:w-48 px-3 py-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                          value={filterHari}
                          onChange={e => setFilterHari(e.target.value)}
                        >
                          <option value="">Semua Hari</option>
                          {HARI_OPTS.map(h => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                      {filterHari && (
                        <div className="flex items-end">
                          <button
                            className="px-4 py-2 text-sm text-blue-700 hover:text-blue-900 border border-blue-300 rounded-lg hover:bg-blue-100 transition-colors duration-200 font-medium flex items-center space-x-2"
                            onClick={() => setFilterHari('')}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            <span>Reset Filter</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Form Tambah Jadwal */}
                    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-5 mb-6 border border-blue-200">
                      <h4 className="font-semibold text-blue-900 mb-4 flex items-center space-x-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                        <span>Tambah Jadwal Baru</span>
                      </h4>
                      <form
                        onSubmit={tambahJadwal}
                        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4"
                      >
                        <div>
                          <label className="block text-xs font-medium text-blue-800 mb-1">
                            Hari <span className="text-red-500">*</span>
                          </label>
                          <select
                            className="block w-full px-3 py-2 text-sm border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                            value={form.hari}
                            onChange={e => setForm(f => ({ ...f, hari: e.target.value }))}
                            required
                          >
                            <option value="">Pilih hari</option>
                            {HARI_OPTS.map(h => (
                              <option key={h} value={h}>{h}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-blue-800 mb-1">
                            Mapel <span className="text-red-500">*</span>
                          </label>
                          <select
                            className="block w-full px-3 py-2 text-sm border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                            value={form.mapel}
                            onChange={e => setForm(f => ({ ...f, mapel: e.target.value }))}
                            required
                          >
                            <option value="">Pilih mapel</option>
                            {mapelList.map(m => (
                              <option key={m.id} value={m.nama}>{m.nama}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-blue-800 mb-1">Guru Pengajar</label>
                          <select
                            className="block w-full px-3 py-2 text-sm border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                            value={form.guruId}
                            onChange={e => setForm(f => ({ ...f, guruId: e.target.value }))}
                          >
                            <option value="">Pilih guru (opsional)</option>
                            {guruList.map(g => (
                              <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-blue-800 mb-1">
                            Jam Mulai <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="time"
                            className="block w-full px-3 py-2 text-sm border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                            value={form.jamMulai}
                            onChange={e => setForm(f => ({ ...f, jamMulai: e.target.value }))}
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-blue-800 mb-1">
                            Jam Selesai <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="time"
                            className="block w-full px-3 py-2 text-sm border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                            value={form.jamSelesai}
                            onChange={e => setForm(f => ({ ...f, jamSelesai: e.target.value }))}
                            required
                          />
                        </div>
                        <div className="flex items-end">
                          <button
                            type="submit"
                            className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-2.5 px-4 rounded-lg hover:from-blue-700 hover:to-blue-800 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 text-sm font-medium shadow-md flex items-center justify-center space-x-2 disabled:opacity-50"
                            disabled={loading || !form.hari || !form.mapel || !form.jamMulai || !form.jamSelesai}
                          >
                            {loading ? (
                              <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                <span>Menambah...</span>
                              </>
                            ) : (
                              <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                </svg>
                                <span>Tambah</span>
                              </>
                            )}
                          </button>
                        </div>
                      </form>
                    </div>

                    {/* Daftar Jadwal */}
                    <div className="overflow-hidden rounded-xl border border-gray-200 shadow-sm">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                              Hari
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                              Jam
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                              Mapel
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                              Guru
                            </th>
                            <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                              Aksi
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {jadwalToShow.map(j => (
                            <tr key={j.id} className="hover:bg-blue-50 transition-colors duration-150 group">
                              {editId === j.id ? (
                                <>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <select
                                      className="block w-full px-3 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                                      value={editData.hari}
                                      onChange={e => setEditData(d => ({ ...d, hari: e.target.value }))}
                                    >
                                      {HARI_OPTS.map(h => (
                                        <option key={h} value={h}>{h}</option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center space-x-2">
                                      <input
                                        type="time"
                                        className="block w-full px-3 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                                        value={editData.jamMulai}
                                        onChange={e => setEditData(d => ({ ...d, jamMulai: e.target.value }))}
                                      />
                                      <span className="text-gray-400">-</span>
                                      <input
                                        type="time"
                                        className="block w-full px-3 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                                        value={editData.jamSelesai}
                                        onChange={e => setEditData(d => ({ ...d, jamSelesai: e.target.value }))}
                                      />
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <select
                                      className="block w-full px-3 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                                      value={editData.mapel}
                                      onChange={e => setEditData(d => ({ ...d, mapel: e.target.value }))}
                                    >
                                      <option value="">Pilih mapel</option>
                                      {mapelList.map(m => (
                                        <option key={m.id} value={m.nama}>{m.nama}</option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <select
                                      className="block w-full px-3 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                                      value={editData.guruId || ''}
                                      onChange={e => setEditData(d => ({ ...d, guruId: e.target.value || null }))}
                                    >
                                      <option value="">Pilih guru</option>
                                      {guruList.map(g => (
                                        <option key={g.id} value={g.id}>{g.name}</option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-right space-x-2">
                                    <button
                                      className="text-green-600 hover:text-green-800 font-medium text-sm px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors duration-200 flex items-center space-x-1"
                                      onClick={saveEdit}
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                      </svg>
                                      <span>Simpan</span>
                                    </button>
                                    <button
                                      className="text-gray-600 hover:text-gray-800 font-medium text-sm px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors duration-200 flex items-center space-x-1"
                                      onClick={cancelEdit}
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                      <span>Batal</span>
                                    </button>
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <span className="font-medium text-gray-900 bg-blue-100 px-3 py-1.5 rounded-full text-xs inline-flex items-center">
                                      <span className="w-2 h-2 bg-blue-500 rounded-full mr-2"></span>
                                      {j.hari}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex flex-col">
                                      <span className="text-gray-900 font-mono font-bold">
                                        {j.jamMulai} - {j.jamSelesai}
                                      </span>
                                      <span className="text-xs text-gray-500">
                                        {toMinutes(j.jamSelesai) - toMinutes(j.jamMulai)} menit
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center space-x-2">
                                      <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                                        <span className="text-purple-600 text-xs">📚</span>
                                      </div>
                                      <span className="font-semibold text-gray-900">{j.mapel}</span>
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    {j.guruNama ? (
                                      <div className="flex items-center space-x-2">
                                        <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                                          <span className="text-green-600 text-xs">👨‍🏫</span>
                                        </div>
                                        <span className="text-gray-700">{j.guruNama}</span>
                                      </div>
                                    ) : (
                                      <span className="text-gray-400 italic">Belum ada guru</span>
                                    )}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-right space-x-2">
                                    <div className="flex justify-end space-x-2">
                                      <button
                                        className="text-blue-600 hover:text-blue-800 font-medium text-sm px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors duration-200 flex items-center space-x-1 opacity-0 group-hover:opacity-100"
                                        onClick={() => startEdit(j)}
                                        title="Edit jadwal"
                                      >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                        </svg>
                                        <span>Edit</span>
                                      </button>
                                      <button
                                        className="text-red-600 hover:text-red-800 font-medium text-sm px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors duration-200 flex items-center space-x-1 opacity-0 group-hover:opacity-100"
                                        onClick={() => hapusJadwal(j.id)}
                                        title="Hapus jadwal"
                                      >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                        <span>Hapus</span>
                                      </button>
                                    </div>
                                  </td>
                                </>
                              )}
                            </tr>
                          ))}
                          {!jadwalToShow.length && (
                            <tr>
                              <td colSpan="5" className="px-6 py-12 text-center text-gray-500">
                                <div className="w-20 h-20 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                                  <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                </div>
                                <p className="text-lg font-medium text-gray-600">
                                  {filterHari
                                    ? `Tidak ada jadwal untuk hari ${filterHari}`
                                    : 'Belum ada jadwal untuk kelas ini.'}
                                </p>
                                <p className="text-sm mt-1">Tambahkan jadwal baru untuk memulai</p>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    
                    {/* Summary */}
                    {jadwalToShow.length > 0 && (
                      <div className="mt-4 text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
                        <p>
                          <span className="font-medium">Total:</span> {jadwalToShow.length} jadwal 
                          {filterHari && ` untuk hari ${filterHari}`}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ===================== TAB: STRUKTUR SEKOLAH ===================== */}
            {tab === 'struktur' && (
              <StrukturSekolah guruList={guruList} pushToast={pushToast} />
            )}

            {/* ===================== TAB: ORGANISASI ===================== */}
            {tab === 'org' && (
              <Organisasi guruList={guruList} siswaList={siswaList} pushToast={pushToast} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* === STRUKTUR SEKOLAH === */
function StrukturSekolah({ guruList, pushToast }) {
  const DEFAULT_POS = ['Kepala Sekolah', 'Wakil Kepala Sekolah', 'Kurikulum', 'Kesiswaan', 'Sarpras', 'Humas', 'Bendahara', 'Tata Usaha']
  const [struktur, setStruktur] = useState([])
  const [waliKelas, setWaliKelas] = useState([])
  const [posBaru, setPosBaru] = useState('')
  const [posGuru, setPosGuru] = useState('')
  const [loading, setLoading] = useState(false)
  const [editMode, setEditMode] = useState(null)

  const FORBIDDEN = /[.#$[\]]/
  const slug = (s = '') => s.toString().trim().toLowerCase()
    .replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80)

  useEffect(() => {
    loadStruktur()
    loadWaliKelas()
  }, [])

  const loadStruktur = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('struktur_sekolah')
        .select('*')
        .order('jabatan')

      if (error) throw error
      setStruktur(data || [])
    } catch (error) {
      console.error('Error loading struktur:', error)
      pushToast('error', 'Gagal memuat struktur sekolah')
    } finally {
      setLoading(false)
    }
  }

  const loadWaliKelas = async () => {
    try {
      setLoading(true)
      
      // Ambil data kelas dengan struktur
      const { data: kelasData, error: kelasError } = await supabase
        .from('kelas')
        .select('*')
        .order('grade')
        .order('suffix')

      if (kelasError) throw kelasError

      const { data: strukturData, error: strukturError } = await supabase
        .from('kelas_struktur')
        .select('*')

      if (strukturError) throw strukturError

      // Gabungkan data
      const waliKelasData = kelasData.map(kelas => {
        const struktur = strukturData?.find(s => s.kelas_id === kelas.id)
        return {
          id: kelas.id,
          nama_kelas: kelas.nama || kelas.id,
          grade: kelas.grade || parseGrade(kelas.id),
          suffix: kelas.suffix || stripGradePrefix(kelas.nama || kelas.id),
          wali_guru_id: struktur?.wali_guru_id || '',
          wali_guru_nama: struktur?.wali_guru_nama || ''
        }
      })

      // Urutkan berdasarkan grade
      waliKelasData.sort((a, b) => {
        const ag = GRADE_ORDER[a.grade] ?? 999
        const bg = GRADE_ORDER[b.grade] ?? 999
        if (ag !== bg) return ag - bg
        return (a.suffix || '').localeCompare(b.suffix || '', 'id')
      })

      setWaliKelas(waliKelasData)
    } catch (error) {
      console.error('Error loading wali kelas:', error)
      pushToast('error', 'Gagal memuat data wali kelas')
    } finally {
      setLoading(false)
    }
  }

  function formatNamaKelas(kelas) {
    if (kelas.nama_kelas) return kelas.nama_kelas
    return `${kelas.grade || parseGrade(kelas.id)} ${kelas.suffix || ''}`.trim()
  }

  async function addPosisi() {
    const jab = (posBaru || '').trim()
    if (!jab) {
      pushToast('error', 'Nama jabatan harus diisi')
      return
    }
    
    if (FORBIDDEN.test(jab)) {
      pushToast('error', 'Nama posisi tidak boleh mengandung . # $ [ ]')
      return
    }

    const id = slug(jab)

    try {
      setLoading(true)

      // Cek apakah sudah ada
      const { data: existing } = await supabase
        .from('struktur_sekolah')
        .select('id')
        .eq('id', id)
        .single()

      if (existing) {
        pushToast('error', 'Posisi sudah ada.')
        return
      }

      const guruId = posGuru || ''
      const guruNama = guruId ? (guruList.find(g => g.id === guruId)?.name || '') : ''

      const { error } = await supabase
        .from('struktur_sekolah')
        .insert({
          id,
          jabatan: jab,
          guru_id: guruId || null,
          guru_nama: guruNama,
          created_at: new Date().toISOString()
        })

      if (error) throw error

      pushToast('success', `Posisi "${jab}" berhasil ditambahkan`)
      setPosBaru('')
      setPosGuru('')
      await loadStruktur()
    } catch (error) {
      console.error('Error adding posisi:', error)
      pushToast('error', error.message || 'Gagal menambah posisi')
    } finally {
      setLoading(false)
    }
  }

  async function updatePosisi(posisiId, newGuruId) {
    try {
      setLoading(true)
      const guruNama = newGuruId ? (guruList.find(g => g.id === newGuruId)?.name || '') : ''

      const { error } = await supabase
        .from('struktur_sekolah')
        .update({
          guru_id: newGuruId || null,
          guru_nama: guruNama,
          updated_at: new Date().toISOString()
        })
        .eq('id', posisiId)

      if (error) throw error

      pushToast('success', 'Posisi berhasil diupdate')
      await loadStruktur()
    } catch (error) {
      console.error('Error updating posisi:', error)
      pushToast('error', error.message || 'Gagal mengupdate posisi')
    } finally {
      setLoading(false)
    }
  }

  async function updateWaliKelas(kelasId, newGuruId) {
    try {
      setLoading(true)
      const guruNama = newGuruId ? (guruList.find(g => g.id === newGuruId)?.name || '') : ''

      const { error } = await supabase
        .from('kelas_struktur')
        .upsert({
          kelas_id: kelasId,
          wali_guru_id: newGuruId || null,
          wali_guru_nama: guruNama,
          updated_at: new Date().toISOString()
        }, { onConflict: 'kelas_id' })

      if (error) throw error

      pushToast('success', 'Wali kelas berhasil diupdate')
      await loadWaliKelas()
    } catch (error) {
      console.error('Error updating wali kelas:', error)
      pushToast('error', error.message || 'Gagal mengupdate wali kelas')
    } finally {
      setLoading(false)
    }
  }

  async function hapusPosisi(p) {
    if (!confirmDelete(`Hapus posisi "${p.jabatan}"?`)) return

    try {
      setLoading(true)
      const { error } = await supabase
        .from('struktur_sekolah')
        .delete()
        .eq('id', p.id)

      if (error) throw error

      pushToast('success', 'Posisi berhasil dihapus')
      await loadStruktur()
    } catch (error) {
      console.error('Error deleting posisi:', error)
      pushToast('error', error.message || 'Gagal menghapus posisi')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center space-x-2">
              <span className="p-2 bg-purple-100 rounded-lg">🏢</span>
              <span>Struktur Sekolah</span>
            </h2>
            <p className="text-gray-600 text-sm mt-1">
              Kelola jabatan dan penanggung jawab di sekolah
            </p>
          </div>
        </div>
      </div>

      {/* Statistik */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-4 shadow border border-purple-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Posisi</p>
              <p className="text-2xl font-bold text-gray-900">{struktur.length}</p>
            </div>
            <div className="p-3 bg-purple-100 rounded-lg">
              <span className="text-xl">👔</span>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow border border-green-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Wali Kelas</p>
              <p className="text-2xl font-bold text-gray-900">{waliKelas.filter(wk => wk.wali_guru_id).length}</p>
            </div>
            <div className="p-3 bg-green-100 rounded-lg">
              <span className="text-xl">👨‍🏫</span>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow border border-blue-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Kelas</p>
              <p className="text-2xl font-bold text-gray-900">{waliKelas.length}</p>
            </div>
            <div className="p-3 bg-blue-100 rounded-lg">
              <span className="text-xl">🏫</span>
            </div>
          </div>
        </div>
      </div>

      {/* Form Tambah Posisi */}
      <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
          <span className="p-2 bg-blue-100 rounded-lg">➕</span>
          <span>Tambah Posisi Baru</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Jabatan <span className="text-red-500">*</span>
            </label>
            <input
              className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
              list="list-posisi"
              placeholder="cth: Kepala Sekolah"
              value={posBaru}
              onChange={e => setPosBaru(e.target.value)}
            />
            <datalist id="list-posisi">
              {DEFAULT_POS.map(p => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Penanggung Jawab</label>
            <select
              className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
              value={posGuru}
              onChange={e => setPosGuru(e.target.value)}
            >
              <option value="">Pilih guru</option>
              {guruList.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-2.5 px-4 rounded-lg hover:from-blue-700 hover:to-blue-800 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 text-sm font-medium shadow-md flex items-center justify-center space-x-2 disabled:opacity-50"
              onClick={addPosisi}
              disabled={loading || !posBaru.trim()}
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Menambah...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  <span>Tambah Posisi</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Struktur Sekolah */}
      <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
            <span className="p-2 bg-purple-100 rounded-lg">📊</span>
            <span>Struktur Sekolah</span>
          </h3>
          <span className="text-sm text-gray-500">
            {struktur.length} posisi
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {struktur.map((p, index) => (
            <div
              key={p.id}
              className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all duration-300 p-4 hover:border-purple-300"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-2">
                    <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-purple-600 rounded-full flex items-center justify-center">
                      <span className="text-xs font-bold text-white">{index + 1}</span>
                    </div>
                    <h4 className="font-bold text-gray-900 text-lg">{p.jabatan}</h4>
                  </div>

                  {editMode === p.id ? (
                    <div className="space-y-2">
                      <select
                        className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                        value={p.guru_id || ''}
                        onChange={e => updatePosisi(p.id, e.target.value)}
                        onBlur={() => setEditMode(null)}
                        autoFocus
                      >
                        <option value="">Pilih penanggung jawab</option>
                        {guruList.map(g => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-500">
                        Klik di luar untuk menyimpan
                      </p>
                    </div>
                  ) : (
                    <div
                      className="cursor-pointer group"
                      onClick={() => setEditMode(p.id)}
                    >
                      <p className="text-gray-700 text-sm">
                        {p.guru_nama || 'Belum ada penanggung jawab'}
                      </p>
                      <p className="text-gray-500 text-xs mt-1 group-hover:text-gray-700 transition-colors">
                        <span className="inline-flex items-center">
                          <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          Klik untuk mengubah
                        </span>
                      </p>
                    </div>
                  )}
                </div>
                <button
                  className="text-red-500 hover:text-red-700 p-2 rounded-lg transition-all duration-200 hover:bg-red-50 ml-2"
                  onClick={() => hapusPosisi(p)}
                  disabled={loading}
                  title="Hapus posisi"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
          {!struktur.length && (
            <div className="col-span-full text-center py-12 text-gray-500">
              <div className="w-20 h-20 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <p className="text-lg font-medium">Belum ada data struktur</p>
              <p className="text-sm mt-1">Tambahkan posisi baru untuk memulai</p>
            </div>
          )}
        </div>
      </div>

      {/* Wali Kelas */}
      <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
            <span className="p-2 bg-green-100 rounded-lg">👨‍🏫</span>
            <span>Wali Kelas</span>
          </h3>
          <span className="text-sm text-gray-500">
            {waliKelas.filter(wk => wk.wali_guru_id).length} dari {waliKelas.length} kelas
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {waliKelas.map((wk, index) => (
            <div
              key={wk.id}
              className={`bg-white rounded-xl border shadow-sm hover:shadow-md transition-all duration-300 p-4 ${
                wk.wali_guru_id 
                  ? 'border-green-200 hover:border-green-300' 
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-2">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      wk.wali_guru_id ? 'bg-green-100' : 'bg-gray-100'
                    }`}>
                      <span className={`text-xs font-bold ${
                        wk.wali_guru_id ? 'text-green-600' : 'text-gray-400'
                      }`}>
                        {wk.grade?.charAt(0) || '?'}
                      </span>
                    </div>
                    <div>
                      <h4 className="font-bold text-gray-900 text-lg">{formatNamaKelas(wk)}</h4>
                      <p className="text-xs text-gray-500">
                        {wk.grade} • {wk.suffix || '-'}
                      </p>
                    </div>
                  </div>

                  {editMode === `wali_${wk.id}` ? (
                    <div className="space-y-2">
                      <select
                        className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                        value={wk.wali_guru_id || ''}
                        onChange={e => updateWaliKelas(wk.id, e.target.value)}
                        onBlur={() => setEditMode(null)}
                        autoFocus
                      >
                        <option value="">Pilih wali kelas</option>
                        {guruList.map(g => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-500">
                        Klik di luar untuk menyimpan
                      </p>
                    </div>
                  ) : (
                    <div
                      className="cursor-pointer group"
                      onClick={() => setEditMode(`wali_${wk.id}`)}
                    >
                      <p className={`text-sm ${
                        wk.wali_guru_nama ? 'text-gray-700' : 'text-gray-500 italic'
                      }`}>
                        {wk.wali_guru_nama || 'Belum ada wali kelas'}
                      </p>
                      <p className="text-gray-500 text-xs mt-1 group-hover:text-gray-700 transition-colors">
                        <span className="inline-flex items-center">
                          <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          Klik untuk mengubah
                        </span>
                      </p>
                    </div>
                  )}
                </div>
                
                {wk.wali_guru_id && (
                  <div className="ml-2">
                    <span className="text-xs px-2 py-1 bg-green-100 text-green-800 rounded-full">
                      ✅
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
          {!waliKelas.length && (
            <div className="col-span-full text-center py-12 text-gray-500">
              <div className="w-20 h-20 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <p className="text-lg font-medium">Belum ada data wali kelas</p>
              <p className="text-sm mt-1">Atur wali kelas di tab Kelas & Jadwal</p>
            </div>
          )}
        </div>
      </div>

      {loading && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 flex items-center space-x-3 shadow-2xl">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span className="text-gray-700 font-medium">Memproses...</span>
          </div>
        </div>
      )}
    </div>
  )
}

/* === ORGANISASI === */
function Organisasi({ guruList, siswaList, pushToast }) {
  const [orgList, setOrgList] = useState([])
  const [orgSel, setOrgSel] = useState('')
  const [orgForm, setOrgForm] = useState({ nama: '', visi: '', misi: '', pembinaGuruId: '' })
  const [orgAnggota, setOrgAnggota] = useState([])
  const [addMemberUid, setAddMemberUid] = useState('')
  const [addMemberJabatan, setAddMemberJabatan] = useState('')
  const [editAnggotaId, setEditAnggotaId] = useState(null)
  const [editAnggotaData, setEditAnggotaData] = useState({})
  const [loading, setLoading] = useState(false)

  const JABATAN_OPTS = ['Ketua', 'Wakil Ketua', 'Sekretaris', 'Bendahara', 'Koordinator', 'Anggota']
  const FORBIDDEN = /[.#$[\]]/
  const slug = (s = '') => s.toString().trim().toLowerCase()
    .replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80)

  useEffect(() => {
    loadOrgList()
  }, [])

  useEffect(() => {
    if (orgSel) {
      loadOrgDetail()
      loadOrgAnggota()
    } else {
      setOrgForm({ nama: '', visi: '', misi: '', pembinaGuruId: '' })
      setOrgAnggota([])
    }
  }, [orgSel])

  const loadOrgList = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('organisasi')
        .select('*')
        .order('nama')

      if (error) throw error
      setOrgList(data || [])
    } catch (error) {
      console.error('Error loading organisasi:', error)
      pushToast('error', 'Gagal memuat data organisasi')
    } finally {
      setLoading(false)
    }
  }

  const loadOrgDetail = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('organisasi')
        .select('*')
        .eq('id', orgSel)
        .single()

      if (error) throw error

      setOrgForm({
        nama: data.nama || '',
        visi: data.visi || '',
        misi: data.misi || '',
        pembinaGuruId: data.pembina_guru_id || ''
      })
    } catch (error) {
      console.error('Error loading org detail:', error)
      pushToast('error', 'Gagal memuat detail organisasi')
    } finally {
      setLoading(false)
    }
  }

  const loadOrgAnggota = async () => {
    try {
      setLoading(true)

      const { data, error } = await supabase
        .from('organisasi_anggota')
        .select('*')
        .eq('organisasi_id', orgSel)
        .order('jabatan', { ascending: false })
        .order('nama')

      if (error) throw error

      setOrgAnggota(data || [])
    } catch (error) {
      console.error('Error loading anggota:', error)
      pushToast('error', 'Gagal memuat anggota organisasi')
    } finally {
      setLoading(false)
    }
  }

  async function tambahOrganisasi() {
    const nama = (orgForm.nama || '').trim()
    if (!nama) {
      pushToast('error', 'Nama organisasi harus diisi')
      return
    }
    
    if (nama.length < 3) {
      pushToast('error', 'Nama organisasi minimal 3 karakter')
      return
    }
    
    if (FORBIDDEN.test(nama)) {
      pushToast('error', 'Nama organisasi tidak boleh mengandung . # $ [ ]')
      return
    }

    const id = slug(nama)

    try {
      setLoading(true)

      // Cek apakah sudah ada
      const { data: existing } = await supabase
        .from('organisasi')
        .select('id')
        .eq('id', id)
        .single()

      if (existing) {
        pushToast('error', 'Nama organisasi sudah ada.')
        return
      }

      const pembinaId = orgForm.pembinaGuruId || ''
      const pembinaNama = pembinaId ? (guruList.find(g => g.id === pembinaId)?.name || '') : ''

      const { error } = await supabase
        .from('organisasi')
        .insert({
          id,
          nama,
          visi: orgForm.visi || '',
          misi: orgForm.misi || '',
          pembina_guru_id: pembinaId || null,
          pembina_guru_nama: pembinaNama,
          created_at: new Date().toISOString()
        })

      if (error) throw error

      pushToast('success', `Organisasi "${nama}" berhasil ditambahkan`)
      setOrgSel(id)
      await loadOrgList()
    } catch (error) {
      console.error('Error adding organisasi:', error)
      pushToast('error', error.message || 'Gagal menambah organisasi')
    } finally {
      setLoading(false)
    }
  }

  async function simpanOrganisasi() {
    if (!orgSel) {
      pushToast('error', 'Pilih organisasi terlebih dahulu')
      return
    }

    try {
      setLoading(true)
      const pembinaId = orgForm.pembinaGuruId || ''
      const pembinaNama = pembinaId ? (guruList.find(g => g.id === pembinaId)?.name || '') : ''

      const { error } = await supabase
        .from('organisasi')
        .update({
          nama: orgForm.nama || '',
          visi: orgForm.visi || '',
          misi: orgForm.misi || '',
          pembina_guru_id: pembinaId || null,
          pembina_guru_nama: pembinaNama,
          updated_at: new Date().toISOString()
        })
        .eq('id', orgSel)

      if (error) throw error

      pushToast('success', 'Organisasi berhasil disimpan')
      await loadOrgList()
    } catch (error) {
      console.error('Error saving organisasi:', error)
      pushToast('error', error.message || 'Gagal menyimpan organisasi')
    } finally {
      setLoading(false)
    }
  }

  async function hapusOrganisasi() {
    if (!orgSel) return
    if (!confirmDelete('Yakin mau hapus organisasi ini? Semua data anggota juga akan dihapus.')) return

    try {
      setLoading(true)

      // Hapus anggota terlebih dahulu
      const { error: deleteAnggotaError } = await supabase
        .from('organisasi_anggota')
        .delete()
        .eq('organisasi_id', orgSel)

      if (deleteAnggotaError) throw deleteAnggotaError

      // Hapus organisasi
      const { error } = await supabase
        .from('organisasi')
        .delete()
        .eq('id', orgSel)

      if (error) throw error

      pushToast('success', 'Organisasi berhasil dihapus')
      setOrgSel('')
      setOrgForm({ nama: '', visi: '', misi: '', pembinaGuruId: '' })
      setOrgAnggota([])
      setAddMemberUid('')
      setAddMemberJabatan('')
      setEditAnggotaId(null)
      setEditAnggotaData({})
      await loadOrgList()
    } catch (error) {
      console.error('Error deleting organisasi:', error)
      pushToast('error', error.message || 'Gagal menghapus organisasi')
    } finally {
      setLoading(false)
    }
  }

  async function tambahAnggota() {
    if (!orgSel) {
      pushToast('error', 'Pilih organisasi terlebih dahulu')
      return
    }
    
    if (!addMemberUid) {
      pushToast('error', 'Pilih siswa yang akan ditambahkan')
      return
    }

    const jabatan = (addMemberJabatan || 'Anggota').trim()

    try {
      setLoading(true)
      const siswa = siswaList.find(s => s.uid === addMemberUid)
      const namaSiswa = siswa?.nama || ''

      const { error } = await supabase
        .from('organisasi_anggota')
        .insert({
          organisasi_id: orgSel,
          siswa_id: addMemberUid,
          nama: namaSiswa,
          kelas: siswa?.kelas || '',
          jabatan,
          created_at: new Date().toISOString()
        })

      if (error) throw error

      pushToast('success', 'Anggota berhasil ditambahkan')
      setAddMemberUid('')
      setAddMemberJabatan('')
      await loadOrgAnggota()
    } catch (error) {
      console.error('Error adding anggota:', error)
      pushToast('error', error.message || 'Gagal menambah anggota')
    } finally {
      setLoading(false)
    }
  }

  async function hapusAnggota(anggota) {
    if (!confirmDelete(`Hapus ${anggota.nama} dari organisasi?`)) return

    try {
      setLoading(true)
      const { error } = await supabase
        .from('organisasi_anggota')
        .delete()
        .eq('id', anggota.id)

      if (error) throw error

      pushToast('success', 'Anggota berhasil dihapus')
      await loadOrgAnggota()
    } catch (error) {
      console.error('Error deleting anggota:', error)
      pushToast('error', error.message || 'Gagal menghapus anggota')
    } finally {
      setLoading(false)
    }
  }

  function startEditAnggota(anggota) {
    setEditAnggotaId(anggota.id)
    setEditAnggotaData({ ...anggota })
  }

  function batalEditAnggota() {
    setEditAnggotaId(null)
    setEditAnggotaData({})
  }

  async function saveEditAnggota() {
    if (!editAnggotaId) return

    const jabatan = (editAnggotaData.jabatan || '').trim()
    if (!jabatan) {
      pushToast('error', 'Jabatan tidak boleh kosong')
      return
    }

    try {
      setLoading(true)
      const { error } = await supabase
        .from('organisasi_anggota')
        .update({
          jabatan,
          updated_at: new Date().toISOString()
        })
        .eq('id', editAnggotaId)

      if (error) throw error

      pushToast('success', 'Data anggota berhasil diupdate')
      setEditAnggotaId(null)
      setEditAnggotaData({})
      await loadOrgAnggota()
    } catch (error) {
      console.error('Error updating anggota:', error)
      pushToast('error', error.message || 'Gagal mengupdate anggota')
    } finally {
      setLoading(false)
    }
  }

  const isEditingOrg = Boolean(orgSel)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center space-x-2">
              <span className="p-2 bg-green-100 rounded-lg">👥</span>
              <span>Organisasi Sekolah</span>
            </h2>
            <p className="text-gray-600 text-sm mt-1">
              Kelola organisasi, pembina, serta anggota siswa
            </p>
          </div>
        </div>
      </div>

      {/* Statistik */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 shadow border border-green-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Organisasi</p>
              <p className="text-2xl font-bold text-gray-900">{orgList.length}</p>
            </div>
            <div className="p-3 bg-green-100 rounded-lg">
              <span className="text-xl">👥</span>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow border border-blue-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Anggota</p>
              <p className="text-2xl font-bold text-gray-900">{orgAnggota.length}</p>
            </div>
            <div className="p-3 bg-blue-100 rounded-lg">
              <span className="text-xl">👨‍🎓</span>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow border border-purple-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Pembina</p>
              <p className="text-2xl font-bold text-gray-900">
                {orgList.filter(o => o.pembina_guru_id).length}
              </p>
            </div>
            <div className="p-3 bg-purple-100 rounded-lg">
              <span className="text-xl">👨‍🏫</span>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow border border-yellow-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Siswa Tersedia</p>
              <p className="text-2xl font-bold text-gray-900">{siswaList.length}</p>
            </div>
            <div className="p-3 bg-yellow-100 rounded-lg">
              <span className="text-xl">📋</span>
            </div>
          </div>
        </div>
      </div>

      {/* Organisasi + Detail */}
      <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* List Organisasi */}
          <div className="lg:border-r lg:pr-6">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-base font-semibold text-gray-900 flex items-center space-x-2">
                <span className="p-1.5 bg-blue-100 rounded-lg">📂</span>
                <span>Daftar Organisasi</span>
              </h3>
              <span className="text-xs text-gray-500">{orgList.length}</span>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {orgList.map(o => (
                <button
                  key={o.id}
                  className={`w-full text-left p-3 rounded-xl border text-sm transition-all duration-200 flex justify-between items-start ${
                    orgSel === o.id
                      ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-500 text-blue-700'
                      : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                  onClick={() => setOrgSel(o.id)}
                >
                  <div className="flex-1">
                    <div className="font-medium">{o.nama}</div>
                    {o.pembina_guru_nama && (
                      <div className="text-xs text-gray-500 mt-0.5 truncate">
                        Pembina: {o.pembina_guru_nama}
                      </div>
                    )}
                  </div>
                  {orgSel === o.id && (
                    <span className="text-blue-500 ml-2">→</span>
                  )}
                </button>
              ))}
              {!orgList.length && (
                <div className="text-center py-8 text-gray-500">
                  <div className="w-12 h-12 mx-auto mb-3 bg-gray-100 rounded-full flex items-center justify-center">
                    <span>📂</span>
                  </div>
                  <p className="text-sm">Belum ada organisasi</p>
                </div>
              )}
            </div>

            <button
              className="mt-4 w-full py-2.5 text-sm bg-gradient-to-r from-green-50 to-emerald-50 text-green-700 border border-green-200 rounded-lg hover:from-green-100 hover:to-emerald-100 hover:border-green-300 transition-all duration-200 font-medium flex items-center justify-center space-x-2"
              type="button"
              onClick={() => {
                setOrgSel('')
                setOrgForm({ nama: '', visi: '', misi: '', pembinaGuruId: '' })
                setOrgAnggota([])
              }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              <span>Buat Organisasi Baru</span>
            </button>
          </div>

          {/* Detail Organisasi */}
          <div className="lg:col-span-2">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-base font-semibold text-gray-900 flex items-center space-x-2">
                <span className="p-1.5 bg-green-100 rounded-lg">📝</span>
                <span>{isEditingOrg ? 'Detail Organisasi' : 'Organisasi Baru'}</span>
              </h3>
              {isEditingOrg && (
                <span className="text-xs px-2 py-1 bg-green-100 text-green-800 rounded-full">
                  Sedang diedit
                </span>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nama Organisasi <span className="text-red-500">*</span>
                </label>
                <input
                  className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                  value={orgForm.nama}
                  onChange={e => setOrgForm(f => ({ ...f, nama: e.target.value }))}
                  placeholder="cth: OSIS, Pramuka, PMR"
                />
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Visi
                  </label>
                  <textarea
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900 min-h-[100px]"
                    value={orgForm.visi}
                    onChange={e => setOrgForm(f => ({ ...f, visi: e.target.value }))}
                    placeholder="Tuliskan visi organisasi..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Misi
                  </label>
                  <textarea
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900 min-h-[100px]"
                    value={orgForm.misi}
                    onChange={e => setOrgForm(f => ({ ...f, misi: e.target.value }))}
                    placeholder="Tuliskan misi organisasi..."
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Pembina Guru
                </label>
                <select
                  className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                  value={orgForm.pembinaGuruId}
                  onChange={e => setOrgForm(f => ({ ...f, pembinaGuruId: e.target.value }))}
                >
                  <option value="">Pilih guru pembina</option>
                  {guruList.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                {isEditingOrg ? (
                  <>
                    <button
                      type="button"
                      className="px-4 py-2.5 text-sm border border-red-300 text-red-700 rounded-lg hover:bg-red-50 font-medium flex items-center space-x-2 transition-all duration-200"
                      onClick={hapusOrganisasi}
                      disabled={loading}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      <span>Hapus</span>
                    </button>
                    <button
                      type="button"
                      className="px-4 py-2.5 text-sm bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 font-medium flex items-center space-x-2 transition-all duration-200 shadow-md"
                      onClick={simpanOrganisasi}
                      disabled={loading}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>Simpan Perubahan</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="w-full md:w-auto px-4 py-2.5 text-sm bg-gradient-to-r from-green-600 to-green-700 text-white rounded-lg hover:from-green-700 hover:to-green-800 font-medium flex items-center justify-center space-x-2 transition-all duration-200 shadow-md"
                    onClick={tambahOrganisasi}
                    disabled={loading || !orgForm.nama.trim()}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    <span>Tambah Organisasi</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Anggota Organisasi */}
      {orgSel && (
        <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
              <span className="p-2 bg-blue-100 rounded-lg">👨‍🎓</span>
              <span>Anggota Organisasi</span>
            </h3>
            <span className="text-sm text-gray-500">
              {orgAnggota.length} anggota
            </span>
          </div>

          {/* Form tambah anggota */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 mb-6">
            <h4 className="text-sm font-semibold text-blue-900 mb-3 flex items-center space-x-2">
              <span className="p-1.5 bg-blue-200 rounded-lg">➕</span>
              <span>Tambah Anggota Baru</span>
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-blue-800 mb-1">
                  Siswa <span className="text-red-500">*</span>
                </label>
                <select
                  className="block w-full px-3 py-2 text-sm border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                  value={addMemberUid}
                  onChange={e => setAddMemberUid(e.target.value)}
                >
                  <option value="">Pilih siswa</option>
                  {siswaList.map(s => (
                    <option key={s.uid} value={s.uid}>
                      {s.nama} {s.kelas ? `(${s.kelas})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-blue-800 mb-1">Jabatan</label>
                <select
                  className="block w-full px-3 py-2 text-sm border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                  value={addMemberJabatan}
                  onChange={e => setAddMemberJabatan(e.target.value)}
                >
                  <option value="">Anggota</option>
                  {JABATAN_OPTS.map(j => (
                    <option key={j} value={j}>{j}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-2.5 px-4 rounded-lg hover:from-blue-700 hover:to-blue-800 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 text-sm font-medium flex items-center justify-center space-x-2 disabled:opacity-50"
                  onClick={tambahAnggota}
                  disabled={loading || !addMemberUid}
                >
                  {loading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      <span>Menambah...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      <span>Tambah Anggota</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* List anggota */}
          <div className="overflow-hidden rounded-xl border border-gray-200 shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Nama Siswa
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Jabatan
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {orgAnggota.map(a => (
                  <tr key={a.id} className="hover:bg-gray-50 transition-colors duration-150">
                    <td className="px-4 py-3">
                      <div className="flex items-center">
                        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
                          <span className="text-blue-600 text-xs">👤</span>
                        </div>
                        <div>
                          <span className="text-sm font-medium text-gray-900">{a.nama}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {editAnggotaId === a.id ? (
                        <div className="flex items-center space-x-2">
                          <select
                            className="px-2 py-1 border border-gray-300 rounded-lg text-sm bg-white"
                            value={editAnggotaData.jabatan || ''}
                            onChange={e => setEditAnggotaData(d => ({ ...d, jabatan: e.target.value }))}
                          >
                            <option value="">Pilih jabatan</option>
                            {JABATAN_OPTS.map(j => (
                              <option key={j} value={j}>{j}</option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <span className={`text-sm px-2 py-1 rounded-full ${
                          a.jabatan === 'Ketua' 
                            ? 'bg-yellow-100 text-yellow-800'
                            : a.jabatan === 'Wakil Ketua' || a.jabatan === 'Sekretaris' || a.jabatan === 'Bendahara'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}>
                          {a.jabatan || 'Anggota'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      {editAnggotaId === a.id ? (
                        <>
                          <button
                            className="text-green-600 hover:text-green-800 px-3 py-1.5 rounded-lg hover:bg-green-50 text-sm font-medium transition-colors duration-200"
                            onClick={saveEditAnggota}
                          >
                            Simpan
                          </button>
                          <button
                            className="text-gray-600 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-50 text-sm font-medium transition-colors duration-200"
                            onClick={batalEditAnggota}
                          >
                            Batal
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="text-blue-600 hover:text-blue-800 px-3 py-1.5 rounded-lg hover:bg-blue-50 text-sm font-medium transition-colors duration-200"
                            onClick={() => startEditAnggota(a)}
                            title="Edit jabatan"
                          >
                            Edit
                          </button>
                          <button
                            className="text-red-600 hover:text-red-800 px-3 py-1.5 rounded-lg hover:bg-red-50 text-sm font-medium transition-colors duration-200"
                            onClick={() => hapusAnggota(a)}
                            title="Hapus anggota"
                          >
                            Hapus
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {!orgAnggota.length && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-gray-500">
                      <div className="w-16 h-16 mx-auto mb-3 bg-gray-100 rounded-full flex items-center justify-center">
                        <span>👥</span>
                      </div>
                      <p className="text-sm">Belum ada anggota</p>
                      <p className="text-xs mt-1">Tambahkan siswa sebagai anggota organisasi ini</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Summary */}
          {orgAnggota.length > 0 && (
            <div className="mt-4 text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
              <div className="flex flex-wrap gap-4">
                <div>
                  <span className="font-medium">Total:</span> {orgAnggota.length} anggota
                </div>
                {JABATAN_OPTS.map(jabatan => {
                  const count = orgAnggota.filter(a => a.jabatan === jabatan).length
                  if (count > 0) {
                    return (
                      <div key={jabatan}>
                        <span className="font-medium">{jabatan}:</span> {count}
                      </div>
                    )
                  }
                  return null
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 flex items-center space-x-3 shadow-2xl">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span className="text-gray-700 font-medium">Memproses...</span>
          </div>
        </div>
      )}
    </div>
  )
}
