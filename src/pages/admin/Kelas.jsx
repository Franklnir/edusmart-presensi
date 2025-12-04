import React, { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useUIStore } from '../../store/useUIStore'

/* ===== Password Modal Component (Akses Halaman) ===== */
function PasswordModal({ isOpen, onClose, onConfirm, title = "Konfirmasi Password", loading = false }) {
  const [password, setPassword] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (password.trim()) {
      onConfirm(password)
      // jangan langsung clear di sini, biar kalau error user bisa edit
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
          Untuk melanjutkan, masukkan password akun Anda:
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
const HARI_OPTS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']
const GRADE_OPTS = ['VII', 'VIII', 'IX', 'X', 'XI', 'XII']
const GRADE_ORDER = Object.fromEntries(GRADE_OPTS.map((g, i) => [g, i]))
const FORBIDDEN = /[.#$[\]]/
const slug = (s = '') => s.toString().trim().toLowerCase()
  .replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80)

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
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [passwordModalOpen, setPasswordModalOpen] = useState(true)
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
      pushToast('error', error.message || 'Password salah')
    } finally {
      setPasswordLoading(false)
    }
  }

  const handlePasswordClose = () => {
    // Boleh ditutup, tapi halaman tetap terkunci
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

  /* ====== EFFECTS: sekarang digate oleh isAuthorized ====== */

  // Load guru & siswa setelah password benar
  useEffect(() => {
    if (!isAuthorized) return
    loadGuruList()
    loadSiswaList()
  }, [isAuthorized])

  // Load kelas setelah password benar
  useEffect(() => {
    if (!isAuthorized) return
    loadKelas()
  }, [isAuthorized])

  // Load mapel setelah password benar
  useEffect(() => {
    if (!isAuthorized) return
    loadMapelList()
  }, [isAuthorized])

  // Load jadwal & struktur kelas ketika kelasSelected berubah (dan sudah authorized)
  useEffect(() => {
    if (!isAuthorized) return

    if (kelasSelected) {
      loadJadwal()
      loadStrukturKelas()
    } else {
      setJadwal([])
      setWaliGuruId('')
      setKetuaUid('')
    }
  }, [isAuthorized, kelasSelected])

  /* ================== LOADERS ================== */
  const loadGuruList = async () => {
    try {
      setLoading(true)
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
    } finally {
      setLoading(false)
    }
  }

  const loadSiswaList = async () => {
    try {
      setLoading(true)
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
    } finally {
      setLoading(false)
    }
  }

  const loadKelas = async () => {
    try {
      setLoading(true)
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
      if (!error.message?.includes('406')) {
        pushToast('error', 'Gagal memuat data kelas')
      }
    } finally {
      setLoading(false)
    }
  }

  const loadJadwal = async () => {
    if (!kelasSelected) return

    try {
      setLoading(true)
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
    } finally {
      setLoading(false)
    }
  }

  const loadStrukturKelas = async () => {
    if (!kelasSelected) return

    try {
      setLoading(true)
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
      if (!error.message?.includes('406')) {
        pushToast('error', 'Gagal memuat struktur kelas')
      }
    } finally {
      setLoading(false)
    }
  }

  const loadMapelList = async () => {
    try {
      setLoading(true)
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
    } finally {
      setLoading(false)
    }
  }

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
      if (toMinutes(jamMulai) >= toMinutes(jamSelesai)) {
        return 'Jam mulai harus lebih awal dari jam selesai'
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
    const suffix = (newSuffix || '').trim()
    if (!GRADE_OPTS.includes(grade)) return pushToast('error', 'Pilih grade: VII–XII.')
    if (FORBIDDEN.test(suffix)) return pushToast('error', 'Sufiks tidak boleh mengandung . # $ [ ] /')

    const nama = makeClassName(grade, suffix).toUpperCase()
    const id = slug(nama)

    try {
      setLoading(true)
      const { data: existing } = await supabase
        .from('kelas')
        .select('id')
        .eq('id', id)
        .single()

      if (existing) return pushToast('error', 'Kelas sudah ada.')

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

      pushToast('success', 'Kelas berhasil ditambahkan')
      setNewGrade('')
      setNewSuffix('')
      setKelasSelected(id)
      loadKelas()
    } catch (error) {
      console.error('Error adding kelas:', error)
      pushToast('error', 'Gagal menambah kelas')
    } finally {
      setLoading(false)
    }
  }

  async function hapusKelas(id) {
    if (!confirmDelete(`Yakin mau hapus kelas? Semua data terkait (jadwal, struktur) juga akan dihapus.`)) return

    try {
      setLoading(true)

      // Cek siswa
      const { data: siswaCount, error: countError } = await supabase
        .from('profiles')
        .select('id', { count: 'exact' })
        .eq('kelas', id)

      if (countError) throw countError

      if (siswaCount && siswaCount.length > 0) {
        return pushToast('error', 'Tidak bisa hapus: kelas masih digunakan oleh siswa. Pindahkan siswa terlebih dahulu.')
      }

      // Hapus terkait
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
      loadKelas()
    } catch (error) {
      console.error('Error deleting kelas:', error)

      if (error.code === '23503') {
        pushToast('error', 'Tidak dapat menghapus kelas karena masih terkait dengan data lain. Hapus data jadwal dan absensi terlebih dahulu.')
      } else {
        pushToast('error', 'Gagal menghapus kelas: ' + (error.message || 'Unknown error'))
      }
    } finally {
      setLoading(false)
    }
  }

  /* ------- STRUKTUR KELAS ------- */
  async function simpanStrukturKelas() {
    if (!kelasSelected) return pushToast('error', 'Pilih kelas terlebih dahulu.')

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
    if (!nama) return pushToast('error', 'Nama mata pelajaran harus diisi')
    if (FORBIDDEN.test(nama)) return pushToast('error', 'Nama mapel tidak boleh mengandung . # $ [ ] /')

    const id = slug(nama)

    try {
      setLoading(true)
      const { data: existing } = await supabase
        .from('mata_pelajaran')
        .select('id')
        .eq('id', id)
        .single()

      if (existing) return pushToast('error', 'Mata pelajaran sudah ada.')

      const { error } = await supabase
        .from('mata_pelajaran')
        .insert({
          id,
          nama,
          created_at: new Date().toISOString()
        })

      if (error) throw error

      pushToast('success', 'Mata pelajaran berhasil ditambahkan')
      setNewMapel('')
      loadMapelList()
    } catch (error) {
      console.error('Error adding mapel:', error)
      pushToast('error', 'Gagal menambah mata pelajaran')
    } finally {
      setLoading(false)
    }
  }

  async function hapusMapel(mapel) {
    if (!confirmDelete(`Hapus mata pelajaran "${mapel.nama}"?`)) return

    try {
      setLoading(true)
      const { data: usedJadwal, error: checkError } = await supabase
        .from('jadwal')
        .select('kelas_id')
        .eq('mapel', mapel.nama)
        .limit(1)

      if (checkError) throw checkError

      if (usedJadwal.length > 0) {
        return pushToast('error', `Tidak bisa hapus: Mata pelajaran "${mapel.nama}" masih dipakai di jadwal kelas ${usedJadwal[0].kelas_id}.`)
      }

      const { error } = await supabase
        .from('mata_pelajaran')
        .delete()
        .eq('id', mapel.id)

      if (error) throw error

      pushToast('success', 'Mata pelajaran berhasil dihapus')
      loadMapelList()
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
    if (!kelasSelected) return pushToast('error', 'Pilih kelas terlebih dahulu.')

    const { hari, mapel, guruId, jamMulai, jamSelesai } = form

    if (!hari || !mapel || !jamMulai || !jamSelesai) {
      return pushToast('error', 'Lengkapi semua field yang wajib (Hari, Mapel, Jam Mulai, Jam Selesai).')
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

      if (conflictMsg) return pushToast('error', conflictMsg)

      const id = buildJadwalKey({ hari, mapel, jamMulai, jamSelesai })

      const { data: existing } = await supabase
        .from('jadwal')
        .select('id')
        .eq('id', id)
        .single()

      if (existing) {
        return pushToast('error', 'Jadwal dengan kombinasi ini sudah ada.')
      }

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
      loadJadwal()
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
    if (!confirmDelete()) return

    try {
      setLoading(true)
      const { error } = await supabase
        .from('jadwal')
        .delete()
        .eq('id', id)
        .eq('kelas_id', kelasSelected)

      if (error) throw error

      pushToast('success', 'Jadwal berhasil dihapus')
      if (editId === id) {
        setEditId(null)
        setEditData(null)
      }
      loadJadwal()
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
      return pushToast('error', 'Lengkapi semua field yang wajib.')
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

      if (conflictMsg) return pushToast('error', conflictMsg)

      const newId = buildJadwalKey({ hari, mapel, jamMulai, jamSelesai })
      const guruNama = guruId ? guruNameById(guruId) : ''

      if (newId !== editId) {
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
      loadJadwal()
    } catch (error) {
      console.error('Error saving jadwal:', error)
      pushToast('error', 'Gagal menyimpan jadwal')
    } finally {
      setLoading(false)
    }
  }

  /* ============================ RENDER ============================ */
  return (
    <div className="min-h-screen bg-gray-50 p-0">
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
          <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6 w-full max-w-md">
            <div className="flex items-center mb-4">
              <div className="p-3 bg-blue-100 rounded-xl mr-3">
                <span className="text-2xl">🔒</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Halaman Terkunci</h1>
                <p className="text-gray-600 text-sm">
                  Untuk membuka Manajemen Kelas & Jadwal, silakan konfirmasi password akun admin Anda.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setPasswordModalOpen(true)}
              className="w-full bg-blue-600 text-white py-2.5 px-4 rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 text-sm font-medium transition-all duration-200"
            >
              Masukkan Password
            </button>
          </div>
        </div>
      ) : (
        /* ================== KONTEN ASLI HALAMAN (SETELAH PASSWORD BENAR) ================== */
        <div className="w-full mx-auto">
          {/* Header */}
          <div className="bg-white shadow-lg p-6 border-b border-gray-400">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center space-x-4">
                <div className="p-3 bg-blue-600 rounded-xl">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Manajemen Kelas & Jadwal</h1>
                  <p className="text-gray-600 mt-1">
                    Kelola data kelas, jadwal pelajaran, dan struktur organisasi
                  </p>
                </div>
              </div>
              <div className="mt-4 sm:mt-0">
                <div className="flex items-center space-x-1 bg-gray-100 rounded-xl p-1 border border-gray-400">
                  {[
                    { key: 'kelas', label: 'Kelas & Jadwal', icon: '📚' },
                    { key: 'struktur', label: 'Struktur Sekolah', icon: '🏢' },
                    { key: 'org', label: 'Organisasi', icon: '👥' }
                  ].map(({ key, label, icon }) => {
                    const active = tab === key
                    return (
                      <button
                        key={key}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center space-x-2 ${
                          active
                            ? 'bg-white text-blue-600 shadow-sm border border-blue-200'
                            : 'text-gray-600 hover:text-gray-900'
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
          </div>

          {/* Main Content */}
          <div className="p-4 md:p-6">
            {/* Loading Overlay */}
            {loading && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
                <div className="bg-white rounded-2xl p-6 flex items-center space-x-3 shadow-2xl">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  <span className="text-gray-700 font-medium">Memproses data...</span>
                </div>
              </div>
            )}

            {/* ===================== TAB: KELAS & JADWAL ===================== */}
            {tab === 'kelas' && (
              <div className="space-y-6">
                {/* Kelas List Card */}
                <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
                  <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
                    <div>
                      <h2 className="text-xl font-bold text-gray-900 flex items-center space-x-2">
                        <span>📋</span>
                        <span>Daftar Kelas</span>
                      </h2>
                      <p className="text-gray-600 text-sm mt-1">
                        Semua kelas dari semua grade ditampilkan
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <div className="flex items-center space-x-2">
                        <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
                          Filter Grade:
                        </label>
                        <select
                          className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
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
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    {kelasByGrade.map(k => (
                      <div key={k.id} className="flex items-center group relative">
                        <button
                          className={`px-4 py-3 rounded-xl border-2 transition-all duration-200 font-semibold min-w-[100px] ${
                            kelasSelected === k.id
                              ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white border-blue-600 shadow-lg transform scale-105'
                              : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:text-blue-600 hover:shadow-md'
                          }`}
                          onClick={() => setKelasSelected(k.id)}
                          title={k.nama || k.id}
                        >
                          <span className="block">{(k.nama || k.id).toUpperCase()}</span>
                        </button>
                        <button
                          className="ml-2 p-2 text-red-500 opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-red-50 rounded-lg"
                          onClick={() => hapusKelas(k.id)}
                          title="Hapus kelas"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                    {!kelasByGrade.length && (
                      <div className="text-center py-12 text-gray-500 w-full">
                        <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                      <span>✨</span>
                      <span>Buat Kelas Baru</span>
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Grade</label>
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
                          Nama / Sufiks Kelas
                        </label>
                        <input
                          className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm text-gray-900"
                          placeholder="Contoh: A, IPA 1, atau A IPS"
                          value={newSuffix}
                          onChange={e => setNewSuffix(e.target.value)}
                        />
                      </div>
                      <button
                        className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-3 px-4 rounded-lg hover:from-blue-700 hover:to-blue-800 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 font-medium shadow-md flex items-center justify-center space-x-2"
                        onClick={tambahKelas}
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
                      <span>📖</span>
                      <span>Kelola Mata Pelajaran</span>
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Nama Mata Pelajaran Baru
                        </label>
                        <div className="flex space-x-3">
                          <input
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm text-gray-900"
                            placeholder="Contoh: Matematika Wajib"
                            value={newMapel}
                            onChange={e => setNewMapel(e.target.value)}
                          />
                          <button
                            className="bg-gradient-to-r from-green-600 to-green-700 text-white px-4 py-2 rounded-lg hover:from-green-700 hover:to-green-800 focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-200 font-medium shadow-md flex items-center space-x-2"
                            onClick={tambahMapel}
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
                              className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors duration-150"
                            >
                              <span className="font-medium text-gray-800">{m.nama}</span>
                              <button
                                className="text-red-600 hover:text-red-800 p-2 rounded-lg transition-all duration-200 hover:bg-red-50"
                                onClick={() => hapusMapel(m)}
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
                      <span>👨‍🏫</span>
                      <span>Struktur Kelas • {(selObj?.nama || kelasSelected).toUpperCase()}</span>
                    </h3>
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
                              {s.nama} ({s.kelas || '—'})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex space-x-3 pt-2">
                        <button
                          className="flex-1 bg-gradient-to-r from-blue-600 to-blue-700 text-white py-3 px-4 rounded-lg hover:from-blue-700 hover:to-blue-800 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 font-medium shadow-md flex items-center justify-center space-x-2"
                          onClick={simpanStrukturKelas}
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>Simpan Struktur</span>
                        </button>
                        <button
                          className="px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-all duration-200 font-medium flex items-center space-x-2"
                          onClick={kosongkanStrukturKelas}
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          <span>Kosongkan</span>
                        </button>
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
                          <span>📅</span>
                          <span>Jadwal Pelajaran • {(selObj?.nama || kelasSelected).toUpperCase()}</span>
                        </h3>
                        <p className="text-gray-600 text-sm mt-1">
                          Kelola jadwal pelajaran untuk kelas ini
                        </p>
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
                    <div className="bg-blue-50 rounded-xl p-5 mb-6 border border-blue-200">
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
                          <label className="block text-xs font-medium text-blue-800 mb-1">Hari</label>
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
                          <label className="block text-xs font-medium text-blue-800 mb-1">Mata Pelajaran</label>
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
                          <label className="block text-xs font-medium text-blue-800 mb-1">Jam Mulai</label>
                          <input
                            type="time"
                            className="block w-full px-3 py-2 text-sm border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                            value={form.jamMulai}
                            onChange={e => setForm(f => ({ ...f, jamMulai: e.target.value }))}
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-blue-800 mb-1">Jam Selesai</label>
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
                            className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-2.5 px-4 rounded-lg hover:from-blue-700 hover:to-blue-800 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 text-sm font-medium shadow-md flex items-center justify-center space-x-2"
                            disabled={loading}
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
                                <span>Tambah Jadwal</span>
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
                                      className="text-green-600 hover:text-green-800 font-medium text-sm px-3 py-1 rounded hover:bg-green-50 transition-colors duration-200 flex items-center space-x-1"
                                      onClick={saveEdit}
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                      </svg>
                                      <span>Simpan</span>
                                    </button>
                                    <button
                                      className="text-gray-600 hover:text-gray-800 font-medium text-sm px-3 py-1 rounded hover:bg-gray-50 transition-colors duration-200 flex items-center space-x-1"
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
                                    <span className="font-medium text-gray-900 bg-blue-100 px-2 py-1 rounded-full text-xs">
                                      {j.hari}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <span className="text-gray-900 font-mono">
                                      {j.jamMulai} - {j.jamSelesai}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <span className="font-semibold text-gray-900">{j.mapel}</span>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <span className="text-gray-600">
                                      {j.guruNama || (j.guruId ? j.guruId : '—')}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-right space-x-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                    <button
                                      className="text-blue-600 hover:text-blue-800 font-medium text-sm px-3 py-1 rounded hover:bg-blue-50 transition-colors duration-200 flex items-center space-x-1"
                                      onClick={() => startEdit(j)}
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                      </svg>
                                      <span>Edit</span>
                                    </button>
                                    <button
                                      className="text-red-600 hover:text-red-800 font-medium text-sm px-3 py-1 rounded hover:bg-red-50 transition-colors duration-200 flex items-center space-x-1"
                                      onClick={() => hapusJadwal(j.id)}
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                      <span>Hapus</span>
                                    </button>
                                  </td>
                                </>
                              )}
                            </tr>
                          ))}
                          {!jadwalToShow.length && (
                            <tr>
                              <td colSpan="5" className="px-6 py-12 text-center text-gray-500">
                                <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

/* === STRUKTUR SEKOLAH (SAMA SEPERTI VERSI SEBELUMNYA) === */
function StrukturSekolah({ guruList, pushToast }) {
  const DEFAULT_POS = ['Kepala Sekolah', 'Wakil Kepala Sekolah', 'Kurikulum', 'Kesiswaan', 'Sarpras', 'Humas', 'Bendahara', 'Tata Usaha']
  const [struktur, setStruktur] = useState([])
  const [waliKelas, setWaliKelas] = useState([])
  const [posBaru, setPosBaru] = useState('')
  const [posGuru, setPosGuru] = useState('')
  const [loading, setLoading] = useState(false)
  const [editMode, setEditMode] = useState(null)

  const GRADE_OPTS = ['VII', 'VIII', 'IX', 'X', 'XI', 'XII']
  const GRADE_ORDER = Object.fromEntries(GRADE_OPTS.map((g, i) => [g, i]))
  const FORBIDDEN = /[.#$[\]]/
  const slug = (s = '') => s.toString().trim().toLowerCase()
    .replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80)

  const parseGrade = (name = '') => {
    const m = String(name || '').toUpperCase().match(/^\s*(VII|VIII|IX|X|XI|XII)\b/i)
    return m ? m[1] : ''
  }

  const stripGradePrefix = (name = '') => {
    const g = parseGrade(name)
    if (!g) return name.trim()
    return name.toUpperCase().startsWith(g) ? name.slice(g.length).trim() : name.trim()
  }

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
      if (!error.message?.includes('406')) {
        pushToast('error', 'Gagal memuat struktur sekolah')
      }
    } finally {
      setLoading(false)
    }
  }

  const loadWaliKelas = async () => {
    try {
      setLoading(true)
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

      const sortedKelasData = [...kelasData].sort((a, b) => {
        const aGrade = a.grade || parseGrade(a.id)
        const bGrade = b.grade || parseGrade(b.id)
        const ag = GRADE_ORDER[aGrade] ?? 999
        const bg = GRADE_ORDER[bGrade] ?? 999
        if (ag !== bg) return ag - bg

        const aSuffix = a.suffix || stripGradePrefix(a.nama || a.id)
        const bSuffix = b.suffix || stripGradePrefix(b.nama || b.id)
        return (aSuffix || '').localeCompare(bSuffix || '', 'id')
      })

      const waliKelasData = sortedKelasData.map(kelas => {
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

      setWaliKelas(waliKelasData)
    } catch (error) {
      console.error('Error loading wali kelas:', error)
      if (!error.message?.includes('406')) {
        pushToast('error', 'Gagal memuat data wali kelas')
      }
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
    if (!jab) return pushToast('error', 'Nama jabatan harus diisi')
    if (FORBIDDEN.test(jab)) return pushToast('error', 'Nama posisi tidak boleh mengandung . # $ [ ] /')

    const id = slug(jab)

    try {
      setLoading(true)

      const { data: existing, error: checkError } = await supabase
        .from('struktur_sekolah')
        .select('id')
        .eq('id', id)
        .single()

      if (checkError && checkError.code !== 'PGRST116') throw checkError
      if (existing) return pushToast('error', 'Posisi sudah ada.')

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

      pushToast('success', 'Posisi berhasil ditambahkan')
      setPosBaru('')
      setPosGuru('')
      loadStruktur()
    } catch (error) {
      console.error('Error adding posisi:', error)
      if (error.code === '23505') {
        pushToast('error', 'Posisi dengan nama ini sudah ada.')
      } else {
        pushToast('error', `Gagal menambah posisi: ${error.message}`)
      }
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
      loadStruktur()
    } catch (error) {
      console.error('Error updating posisi:', error)
      pushToast('error', `Gagal mengupdate posisi: ${error.message}`)
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
      loadWaliKelas()
    } catch (error) {
      console.error('Error updating wali kelas:', error)
      pushToast('error', `Gagal mengupdate wali kelas: ${error.message}`)
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
      loadStruktur()
    } catch (error) {
      console.error('Error deleting posisi:', error)

      if (error.code === '23503') {
        pushToast('error', 'Tidak dapat menghapus posisi karena masih terkait dengan data lain.')
      } else {
        pushToast('error', 'Gagal menghapus posisi: ' + (error.message || 'Unknown error'))
      }
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
              <span>🏢</span>
              <span>Struktur Sekolah</span>
            </h2>
            <p className="text-gray-600 text-sm mt-1">
              Kelola jabatan dan penanggung jawab di sekolah
            </p>
          </div>
        </div>
      </div>

      {/* Form Tambah Posisi */}
      <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
          <span>➕</span>
          <span>Tambah Posisi Baru</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">Jabatan</label>
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
              className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-2.5 px-4 rounded-lg hover:from-blue-700 hover:to-blue-800 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 text-sm font-medium shadow-md flex items-center justify-center space-x-2"
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
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
          <span>📊</span>
          <span>Struktur Sekolah</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {struktur.map((p, index) => (
            <div
              key={p.id}
              className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all duration-300 p-4"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-2">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <span className="text-xs font-bold text-blue-600">{index + 1}</span>
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
                    </div>
                  ) : (
                    <div
                      className="cursor-pointer group"
                      onClick={() => setEditMode(p.id)}
                    >
                      <p className="text-gray-700 text-sm">
                        {p.guru_nama || 'Belum ada penanggung jawab'}
                      </p>
                      <p className="text-gray-500 text-xs mt-1 group-hover:text-gray-700">
                        Klik untuk mengubah
                      </p>
                    </div>
                  )}
                </div>
                <button
                  className="text-red-600 hover:text-red-800 p-2 rounded-lg transition-all duration-200 hover:bg-red-50 ml-2"
                  onClick={() => hapusPosisi(p)}
                  disabled={loading}
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
              <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
          <span>👨‍🏫</span>
          <span>Wali Kelas</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {waliKelas.map((wk, index) => (
            <div
              key={wk.id}
              className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all duration-300 p-4"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-2">
                    <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                      <span className="text-xs font-bold text-purple-600">{index + 1}</span>
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
                    </div>
                  ) : (
                    <div
                      className="cursor-pointer group"
                      onClick={() => setEditMode(`wali_${wk.id}`)}
                    >
                      <p className="text-gray-700 text-sm">
                        {wk.wali_guru_nama || 'Belum ada wali kelas'}
                      </p>
                      <p className="text-gray-500 text-xs mt-1 group-hover:text-gray-700">
                        Klik untuk mengubah wali kelas
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          {!waliKelas.length && (
            <div className="col-span-full text-center py-12 text-gray-500">
              <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
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
      if (!error.message?.includes('406')) {
        pushToast('error', 'Gagal memuat data organisasi')
      }
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
        .order('nama')

      if (error) throw error

      setOrgAnggota(data || [])
    } catch (error) {
      console.error('Error loading anggota:', error)
      if (!error.message?.includes('406')) {
        pushToast('error', 'Gagal memuat anggota organisasi')
      }
    } finally {
      setLoading(false)
    }
  }

  async function tambahOrganisasi() {
    const nama = (orgForm.nama || '').trim()
    if (!nama) return pushToast('error', 'Nama organisasi harus diisi')
    if (FORBIDDEN.test(nama)) return pushToast('error', 'Nama organisasi tidak boleh mengandung . # $ [ ] /')

    const id = slug(nama)

    try {
      setLoading(true)

      const { data: existing, error: checkError } = await supabase
        .from('organisasi')
        .select('id')
        .eq('id', id)
        .single()

      if (checkError && checkError.code !== 'PGRST116') throw checkError
      if (existing) return pushToast('error', 'Nama organisasi sudah ada.')

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

      pushToast('success', 'Organisasi berhasil ditambahkan')
      setOrgSel(id)
      loadOrgList()
    } catch (error) {
      console.error('Error adding organisasi:', error)
      if (error.code === '23505') {
        pushToast('error', 'Organisasi dengan nama ini sudah ada.')
      } else {
        pushToast('error', `Gagal menambah organisasi: ${error.message}`)
      }
    } finally {
      setLoading(false)
    }
  }

  async function simpanOrganisasi() {
    if (!orgSel) return pushToast('error', 'Pilih organisasi terlebih dahulu')

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
      loadOrgList()
    } catch (error) {
      console.error('Error saving organisasi:', error)
      pushToast('error', `Gagal menyimpan organisasi: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  async function hapusOrganisasi() {
    if (!orgSel) return
    if (!confirmDelete('Yakin mau hapus organisasi ini? Semua data anggota juga akan dihapus.')) return

    try {
      setLoading(true)

      const { error: deleteAnggotaError } = await supabase
        .from('organisasi_anggota')
        .delete()
        .eq('organisasi_id', orgSel)

      if (deleteAnggotaError) throw deleteAnggotaError

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
      loadOrgList()
    } catch (error) {
      console.error('Error deleting organisasi:', error)
      pushToast('error', `Gagal menghapus organisasi: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  async function tambahAnggota() {
    if (!orgSel) return pushToast('error', 'Pilih organisasi terlebih dahulu')
    if (!addMemberUid) return pushToast('error', 'Pilih siswa yang akan ditambahkan')

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
          jabatan,
          created_at: new Date().toISOString()
        })

      if (error) throw error

      pushToast('success', 'Anggota berhasil ditambahkan')
      setAddMemberUid('')
      setAddMemberJabatan('')
      loadOrgAnggota()
    } catch (error) {
      console.error('Error adding anggota:', error)
      pushToast('error', `Gagal menambah anggota: ${error.message}`)
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
      loadOrgAnggota()
    } catch (error) {
      console.error('Error deleting anggota:', error)
      pushToast('error', `Gagal menghapus anggota: ${error.message}`)
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
    if (!jabatan) return pushToast('error', 'Jabatan tidak boleh kosong')

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
      loadOrgAnggota()
    } catch (error) {
      console.error('Error updating anggota:', error)
      pushToast('error', `Gagal mengupdate anggota: ${error.message}`)
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
              <span>👥</span>
              <span>Organisasi Sekolah</span>
            </h2>
            <p className="text-gray-600 text-sm mt-1">
              Kelola organisasi, pembina, serta anggota siswa
            </p>
          </div>
        </div>
      </div>

      {/* Organisasi + Detail */}
      <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* List Organisasi */}
          <div>
            <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center space-x-2">
              <span>📂</span>
              <span>Daftar Organisasi</span>
            </h3>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {orgList.map(o => (
                <button
                  key={o.id}
                  className={`w-full text-left px-3 py-2 rounded-lg border text-sm font-medium transition-all duration-200 ${
                    orgSel === o.id
                      ? 'bg-blue-50 border-blue-500 text-blue-700'
                      : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                  onClick={() => setOrgSel(o.id)}
                >
                  {o.nama}
                  {o.pembina_guru_nama && (
                    <div className="text-xs text-gray-500 mt-0.5">
                      Pembina: {o.pembina_guru_nama}
                    </div>
                  )}
                </button>
              ))}
              {!orgList.length && (
                <p className="text-sm text-gray-500">Belum ada organisasi</p>
              )}
            </div>

            <button
              className="mt-4 text-xs text-blue-600 hover:text-blue-800 font-medium"
              type="button"
              onClick={() => {
                setOrgSel('')
                setOrgForm({ nama: '', visi: '', misi: '', pembinaGuruId: '' })
                setOrgAnggota([])
              }}
            >
              ➕ Buat organisasi baru
            </button>
          </div>

          {/* Detail Organisasi */}
          <div className="lg:col-span-2">
            <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center space-x-2">
              <span>📝</span>
              <span>{isEditingOrg ? 'Detail Organisasi' : 'Organisasi Baru'}</span>
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nama Organisasi
                </label>
                <input
                  className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                  value={orgForm.nama}
                  onChange={e => setOrgForm(f => ({ ...f, nama: e.target.value }))}
                  placeholder="cth: OSIS, Pramuka, PMR"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Visi
                </label>
                <textarea
                  className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900 min-h-[60px]"
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
                  className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900 min-h-[80px]"
                  value={orgForm.misi}
                  onChange={e => setOrgForm(f => ({ ...f, misi: e.target.value }))}
                  placeholder="Tuliskan misi organisasi..."
                />
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
                      className="px-4 py-2 text-sm border border-red-300 text-red-700 rounded-lg hover:bg-red-50 font-medium flex items-center space-x-1"
                      onClick={hapusOrganisasi}
                    >
                      <span>🗑️</span>
                      <span>Hapus</span>
                    </button>
                    <button
                      type="button"
                      className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium flex items-center space-x-1"
                      onClick={simpanOrganisasi}
                    >
                      <span>💾</span>
                      <span>Simpan Perubahan</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium flex items-center space-x-1"
                    onClick={tambahOrganisasi}
                  >
                    <span>➕</span>
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
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
            <span>👨‍🎓</span>
            <span>Anggota Organisasi</span>
          </h3>

          {/* Form tambah anggota */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
            <h4 className="text-sm font-semibold text-blue-900 mb-3 flex items-center space-x-2">
              <span>➕</span>
              <span>Tambah Anggota</span>
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-blue-800 mb-1">
                  Siswa
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
                <label className="block text-xs font-medium text-blue-800 mb-1">
                  Jabatan
                </label>
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
                  className="w-full bg-blue-600 text-white py-2.5 px-4 rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 text-sm font-medium flex items-center justify-center space-x-2"
                  onClick={tambahAnggota}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      <span>Menambah...</span>
                    </>
                  ) : (
                    <>
                      <span>➕</span>
                      <span>Tambah</span>
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
                    Nama
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
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {a.nama}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {editAnggotaId === a.id ? (
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
                      ) : (
                        a.jabatan || 'Anggota'
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-right space-x-2">
                      {editAnggotaId === a.id ? (
                        <>
                          <button
                            className="text-green-600 hover:text-green-800 px-2 py-1 rounded hover:bg-green-50 text-xs font-medium"
                            onClick={saveEditAnggota}
                          >
                            Simpan
                          </button>
                          <button
                            className="text-gray-600 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-50 text-xs font-medium"
                            onClick={batalEditAnggota}
                          >
                            Batal
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50 text-xs font-medium"
                            onClick={() => startEditAnggota(a)}
                          >
                            Edit
                          </button>
                          <button
                            className="text-red-600 hover:text-red-800 px-2 py-1 rounded hover:bg-red-50 text-xs font-medium"
                            onClick={() => hapusAnggota(a)}
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
                    <td colSpan={3} className="px-4 py-8 text-center text-gray-500 text-sm">
                      Belum ada anggota. Tambahkan siswa sebagai anggota organisasi ini.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {loading && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
              <div className="bg-white rounded-2xl p-6 flex items-center space-x-3 shadow-2xl">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <span className="text-gray-700 font-medium">Memproses...</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
