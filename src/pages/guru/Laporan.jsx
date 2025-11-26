// src/pages/guru/LaporanRekap.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'

// === Dynamic imports (Hanya ExcelJS) ===
let ExcelJS
const loadExcelLibrary = async () => {
  try {
    const excelModule = await import('exceljs')
    ExcelJS = excelModule.default
    return true
  } catch (e) {
    console.error('Error loading ExcelJS:', e)
    return false
  }
}

// ==============================
// ===== HELPERS & UTILS ========
// ==============================

const getKelasDisplayName = (kelasObj) => kelasObj?.nama || kelasObj?.id || ''

const getNamaKelasFromList = (kelasId, kelasList) => {
  const kelas = kelasList.find((k) => k.id === kelasId)
  return getKelasDisplayName(kelas) || kelasId || '—'
}

// Helper untuk mengambil tanggal dari ARRAY bulan yang dipilih
const getDatesInPeriod = (year, selectedMonths) => {
  if (!selectedMonths || selectedMonths.length === 0) return []
  
  let allDates = []
  // Sort bulan agar urut (01, 02, dst)
  const sortedMonths = [...selectedMonths].sort()

  sortedMonths.forEach(monthStr => {
    const m = parseInt(monthStr) - 1
    const date = new Date(year, m, 1)
    while (date.getMonth() === m) {
      const y = date.getFullYear()
      const mo = String(date.getMonth() + 1).padStart(2, '0')
      const d = String(date.getDate()).padStart(2, '0')
      allDates.push(`${y}-${mo}-${d}`)
      date.setDate(date.getDate() + 1)
    }
  })
  return allDates
}

const isSunday = (dateString) => {
  const d = new Date(dateString)
  return d.getDay() === 0
}

const getGrade = (v) => {
  if (v === '-' || v === null || v === undefined) return '-'
  const n = Number(v)
  if (Number.isNaN(n)) return '-'
  if (n >= 90) return 'A'
  if (n >= 80) return 'B'
  if (n >= 70) return 'C'
  if (n >= 60) return 'D'
  return 'E'
}

// HELPER WARNA: Hijau (A), Kuning (C), Merah (D/E)
const getColorClass = (val) => {
  if (val === '-' || val === null || val === undefined || val === '') return ''
  
  // 1. Cek jika input adalah Huruf (Grade A, B, C, D, E)
  if (typeof val === 'string' && isNaN(Number(val))) {
      if (val === 'A') return 'bg-green-100 text-green-700 font-bold border border-green-200'
      if (val === 'C') return 'bg-yellow-100 text-yellow-800 font-bold border border-yellow-200'
      if (val === 'D' || val === 'E') return 'bg-red-100 text-red-700 font-bold border border-red-200'
      return 'text-gray-700' // B atau lainnya standar
  }

  // 2. Cek jika input adalah Angka (Nilai 0-100)
  const n = Number(val)
  if (n >= 90) return 'bg-green-100 text-green-700 font-bold' // A
  if (n >= 80) return 'text-gray-700' // B (Normal)
  if (n >= 70) return 'bg-yellow-100 text-yellow-800 font-bold' // C
  if (n < 70) return 'bg-red-100 text-red-700 font-bold' // D & E
  
  return ''
}

const bulanList = [
  { value: '01', label: 'Januari' }, { value: '02', label: 'Februari' },
  { value: '03', label: 'Maret' }, { value: '04', label: 'April' },
  { value: '05', label: 'Mei' }, { value: '06', label: 'Juni' },
  { value: '07', label: 'Juli' }, { value: '08', label: 'Agustus' },
  { value: '09', label: 'September' }, { value: '10', label: 'Oktober' },
  { value: '11', label: 'November' }, { value: '12', label: 'Desember' }
]

// ==============================
// ===== MAIN COMPONENT =========
// ==============================
export default function LaporanRekap() {
  const { user } = useAuthStore()
  const { pushToast, setLoading } = useUIStore()

  // -- UI State --
  const [activeTab, setActiveTab] = useState('absensi')
  const [showBulanDropdown, setShowBulanDropdown] = useState(false)
  const dropdownRef = useRef(null)
  
  // -- Data Filter State --
  const [kelasList, setKelasList] = useState([])
  const [jadwalGuru, setJadwalGuru] = useState([])
  const [mapelList, setMapelList] = useState([])
  
  // -- Selection State (Default Kosong) --
  const [selectedKelas, setSelectedKelas] = useState('')
  const [selectedMapel, setSelectedMapel] = useState('')
  const [selectedBulan, setSelectedBulan] = useState([]) // Array bulan
  const [tahun, setTahun] = useState(new Date().getFullYear())

  // -- Data Result State --
  const [absensiData, setAbsensiData] = useState(null)
  const [tugasData, setTugasData] = useState(null)
  const [editingNilai, setEditingNilai] = useState(null)
  const [excelReady, setExcelReady] = useState(false)

  // 1. Initial Load (Lib & Click Outside)
  useEffect(() => {
    loadExcelLibrary().then((ok) => setExcelReady(ok))
    
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowBulanDropdown(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  // 2. Load Master Data (Jadwal Guru -> Kelas -> Mapel)
  useEffect(() => {
    const load = async () => {
      if (!user?.id) return
      try {
        const { data } = await supabase.from('jadwal').select('*').eq('guru_id', user.id)
        setJadwalGuru(data || [])
      } catch (e) { console.error(e) }
    }
    load()
  }, [user?.id])

  useEffect(() => {
    const load = async () => {
      if (!jadwalGuru.length) { setKelasList([]); setSelectedKelas(''); return }
      try {
        const kelasIds = [...new Set(jadwalGuru.map((j) => j.kelas_id).filter(Boolean))]
        if (!kelasIds.length) { setKelasList([]); return }
        const { data } = await supabase.from('kelas').select('*').in('id', kelasIds).order('grade').order('suffix')
        const sorted = (data || []).sort((a, b) => getKelasDisplayName(a).localeCompare(getKelasDisplayName(b)))
        setKelasList(sorted)
        if (sorted.length && !selectedKelas) setSelectedKelas(sorted[0].id)
      } catch (e) { console.error(e) }
    }
    load()
  }, [jadwalGuru])

  useEffect(() => {
    if (!selectedKelas || !jadwalGuru.length) { setMapelList([]); setSelectedMapel(''); return }
    const mapels = jadwalGuru
      .filter((j) => j.kelas_id === selectedKelas && j.mapel)
      .map((j) => j.mapel)
      .filter((v, i, s) => s.indexOf(v) === i)
      .sort()
    setMapelList(mapels)
    if (mapels.length && !selectedMapel) setSelectedMapel(mapels[0])
    else if (!mapels.length) setSelectedMapel('')
  }, [selectedKelas, jadwalGuru])

  // Toggle Checkbox Bulan
  const handleToggleBulan = (val) => {
    setSelectedBulan(prev => {
      if (prev.includes(val)) return prev.filter(b => b !== val)
      return [...prev, val].sort()
    })
  }

  // Hitung Rata-rata & Grade
  const hitungRataRataDanGrade = (nilaiTugas) => {
    const values = Object.values(nilaiTugas)
      .map((it) => it.nilai)
      .filter((v) => v !== '-' && v !== null && v !== undefined && !Number.isNaN(v))
      .map((v) => Number(v))
    if (!values.length) return { rataRata: '-', grade: '-' }
    const total = values.reduce((s, n) => s + n, 0)
    const rr = Math.round((total / values.length) * 100) / 100
    return { rataRata: rr, grade: getGrade(rr) }
  }

  // ==============================
  // ===== DATA LOADERS ===========
  // ==============================

  const loadRekapAbsensi = useCallback(async () => {
    // Syarat: Kelas, Mapel, dan MINIMAL 1 Bulan dipilih
    if (!selectedKelas || !selectedMapel || selectedBulan.length === 0) {
      setAbsensiData(null)
      return
    }

    try {
      setLoading(true)
      const dateStrings = getDatesInPeriod(tahun, selectedBulan)
      if (dateStrings.length === 0) {
          setAbsensiData(null)
          return
      }

      const { data: siswaData } = await supabase.from('profiles').select('id, nama, nik').eq('kelas', selectedKelas).eq('role', 'siswa').order('nama')
      if (!siswaData) throw new Error("Data siswa tidak ditemukan")

      const { data: absData } = await supabase.from('absensi')
        .select('*')
        .eq('kelas', selectedKelas)
        .eq('mapel', selectedMapel)
        .gte('tanggal', dateStrings[0])
        .lte('tanggal', dateStrings[dateStrings.length - 1])

      const formatted = siswaData.map((s) => {
        const absS = absData?.filter((a) => a.uid === s.id) || []
        const total = { Hadir: 0, Izin: 0, Alpha: 0 } 
        const absensiPerTanggal = {}

        dateStrings.forEach((dateStr) => {
          const found = absS.find((a) => a.tanggal === dateStr)
          if (found) {
            absensiPerTanggal[dateStr] = found.status
            if (['Hadir', 'Izin', 'Alpha'].includes(found.status)) total[found.status]++
          } else {
            absensiPerTanggal[dateStr] = null
          }
        })
        return { id: s.id, nama: s.nama, nik: s.nik, total, absensiPerTanggal }
      })

      const namaBulanTerpilih = selectedBulan.map(b => bulanList.find(bl => bl.value === b)?.label).join(', ')
      setAbsensiData({
        siswa: formatted,
        dateStrings,
        periode: `${namaBulanTerpilih} ${tahun}`
      })
    } catch (e) {
      console.error(e)
      pushToast('error', 'Gagal memuat absensi')
    } finally {
      setLoading(false)
    }
  }, [selectedKelas, selectedMapel, selectedBulan, tahun, setLoading, pushToast])

  const loadRekapTugas = useCallback(async () => {
    // Syarat: Kelas, Mapel, dan MINIMAL 1 Bulan dipilih
    if (!selectedKelas || !selectedMapel || selectedBulan.length === 0) {
      setTugasData(null)
      return
    }

    try {
      setLoading(true)
      const dateStrings = getDatesInPeriod(tahun, selectedBulan)
      
      const { data: siswaData } = await supabase.from('profiles').select('id, nama, nik').eq('kelas', selectedKelas).eq('role', 'siswa').order('nama')
      
      const startDate = `${dateStrings[0]}T00:00:00`
      const endDate = `${dateStrings[dateStrings.length - 1]}T23:59:59`

      const { data: tugasList } = await supabase.from('tugas')
        .select('*')
        .eq('kelas', selectedKelas)
        .eq('mapel', selectedMapel)
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .order('created_at')

      if (!tugasList) {
          setTugasData(null)
          setLoading(false)
          return
      }

      const tugasIds = tugasList.map(t => t.id)
      const { data: jawabanList } = await supabase.from('tugas_jawaban').select('*').in('tugas_id', tugasIds.length ? tugasIds : [-1])

      const formatted = siswaData.map((s) => {
        const nilaiTugas = {}
        tugasList.forEach((t) => {
          const j = jawabanList?.find((x) => x.user_id === s.id && x.tugas_id === t.id)
          const nilai = j?.nilai ?? '-'
          nilaiTugas[t.id] = { nilai, judul: t.judul, tugas_id: t.id }
        })
        const { rataRata, grade } = hitungRataRataDanGrade(nilaiTugas)
        return { id: s.id, nama: s.nama, nik: s.nik, nilaiTugas, rataRata, grade }
      })

      const namaBulanTerpilih = selectedBulan.map(b => bulanList.find(bl => bl.value === b)?.label).join(', ')
      setTugasData({
        siswa: formatted,
        tugas: tugasList,
        periode: `${namaBulanTerpilih} ${tahun}`
      })
    } catch (e) {
      console.error(e)
      pushToast('error', 'Gagal memuat tugas')
    } finally {
      setLoading(false)
    }
  }, [selectedKelas, selectedMapel, selectedBulan, tahun, setLoading, pushToast])

  // REALTIME TRIGGER
  useEffect(() => {
    if (selectedKelas && selectedMapel) {
        if (activeTab === 'absensi') loadRekapAbsensi()
        else loadRekapTugas()
    } else {
        setAbsensiData(null)
        setTugasData(null)
    }
  }, [selectedKelas, selectedMapel, selectedBulan, tahun, activeTab, loadRekapAbsensi, loadRekapTugas])

  // ==============================
  // ===== CRUD & ACTIONS =========
  // ==============================

  const updateNilaiTugas = async (siswaId, tugasId, nilaiBaru) => {
    if (!tugasData) return
    try {
      setLoading(true)
      let nilaiFinal = null
      if (nilaiBaru !== '' && nilaiBaru !== null) {
        const n = Number(nilaiBaru)
        if (Number.isNaN(n) || n < 0 || n > 100) {
          pushToast('error', 'Nilai harus 0–100')
          setLoading(false)
          return
        }
        nilaiFinal = Math.round(n)
      }

      const { data: existing, error: fetchErr } = await supabase.from('tugas_jawaban').select('id').eq('user_id', siswaId).eq('tugas_id', tugasId).maybeSingle()
      if (fetchErr) throw fetchErr

      if (existing) {
        const { error } = await supabase.from('tugas_jawaban').update({ nilai: nilaiFinal, status: 'dinilai' }).eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('tugas_jawaban').insert({ user_id: siswaId, tugas_id: tugasId, nilai: nilaiFinal, status: 'dinilai' })
        if (error) throw error
      }

      // Optimistic Update
      setTugasData((prev) => {
        const siswaBaru = prev.siswa.map((s) => {
          if (s.id !== siswaId) return s
          const nilaiTugas = { ...s.nilaiTugas, [tugasId]: { ...s.nilaiTugas[tugasId], nilai: nilaiFinal } }
          const { rataRata, grade } = hitungRataRataDanGrade(nilaiTugas)
          return { ...s, nilaiTugas, rataRata, grade }
        })
        return { ...prev, siswa: siswaBaru }
      })
      pushToast('success', 'Nilai tersimpan')
      setEditingNilai(null)
    } catch (e) {
      console.error("Error:", e)
      pushToast('error', `Gagal menyimpan: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  // ==============================
  // ===== EXPORT HANDLERS ========
  // ==============================
  const saveBlob = (buffer, filename) => {
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
  }

  const exportAbsensiToExcel = async () => {
    if (!absensiData || !excelReady) return
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Rekap Absensi')

    const fillHeader = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1D5DB' } }
    const fillSunday = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCACA' } }
    const borderAll = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} }

    ws.mergeCells(1, 1, 1, 3 + absensiData.dateStrings.length + 3)
    const t = ws.getCell(1,1)
    t.value = `REKAP ABSENSI ${selectedMapel} - ${getNamaKelasFromList(selectedKelas, kelasList)}`
    t.font = {bold:true, size:12}; t.alignment={horizontal:'center'}
    
    ws.mergeCells(2, 1, 2, 3 + absensiData.dateStrings.length + 3)
    const sub = ws.getCell(2,1)
    sub.value = absensiData.periode
    sub.font = {bold:true, size:10}; sub.alignment={horizontal:'center'}

    const headers = ['No', 'Nama Siswa', 'NIK']
    absensiData.dateStrings.forEach(ds => headers.push(parseInt(ds.split('-')[2])))
    headers.push('I', 'A', 'Hadir')

    const r = ws.getRow(3)
    r.values = headers
    r.font = {bold: true}
    r.eachCell((cell, col) => {
        cell.fill = fillHeader; cell.border = borderAll; cell.alignment = {horizontal:'center'}
        if (col > 3 && col <= 3 + absensiData.dateStrings.length) {
            if (isSunday(absensiData.dateStrings[col-4])) {
                cell.fill = fillSunday; cell.font = { color: { argb: 'FFFF0000' }, bold: true }
            }
        }
    })

    absensiData.siswa.forEach((s, i) => {
        const rowVals = [i+1, s.nama, s.nik]
        absensiData.dateStrings.forEach(ds => {
            const st = s.absensiPerTanggal[ds]
            rowVals.push(isSunday(ds) ? '' : (st ? st.charAt(0) : ''))
        })
        rowVals.push(s.total.Izin, s.total.Alpha, s.total.Hadir)
        
        const row = ws.addRow(rowVals)
        row.eachCell((cell, col) => {
            cell.border = borderAll; cell.alignment = {horizontal:'center'}
            if(col===2) cell.alignment={horizontal:'left'}
            if (col > 3 && col <= 3 + absensiData.dateStrings.length) {
                if (isSunday(absensiData.dateStrings[col-4])) cell.fill = fillSunday
            }
        })
    })

    ws.getColumn(1).width = 5
    ws.getColumn(2).width = 30
    ws.getColumn(3).width = 15
    for(let c=4; c < 4 + absensiData.dateStrings.length; c++) ws.getColumn(c).width = 3 

    const buf = await wb.xlsx.writeBuffer()
    saveBlob(buf, `Absensi_${selectedMapel}.xlsx`)
  }

  const exportToGoogleSheets = (type) => {
    let csv = ''
    const sep = ';' 

    if (type === 'absensi' && absensiData) {
        const dateHeaders = absensiData.dateStrings.map(ds => parseInt(ds.split('-')[2])).join(sep)
        csv += `No${sep}Nama${sep}NIK${sep}${dateHeaders}${sep}I${sep}A${sep}Hadir\n`
        
        absensiData.siswa.forEach((s, i) => {
            const daily = absensiData.dateStrings.map(ds => {
                const st = s.absensiPerTanggal[ds]
                return isSunday(ds) ? '' : (st ? st.charAt(0) : '')
            }).join(sep)
            csv += `${i+1}${sep}"${s.nama}"${sep}'${s.nik}'${sep}${daily}${sep}${s.total.Izin}${sep}${s.total.Alpha}${sep}${s.total.Hadir}\n`
        })
    } else if (type === 'tugas' && tugasData) {
        const tHeads = tugasData.tugas.map((_, i) => `T${i+1}`).join(sep)
        csv += `No${sep}Nama${sep}NIK${sep}${tHeads}${sep}Rata-rata${sep}Grade\n`
        
        tugasData.siswa.forEach((s, i) => {
            const vals = tugasData.tugas.map(t => s.nilaiTugas[t.id]?.nilai ?? '').join(sep)
            csv += `${i+1}${sep}"${s.nama}"${sep}'${s.nik}'${sep}${vals}${sep}${s.rataRata}${sep}"${s.grade}"\n`
        })
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `Rekap_${type}.csv`; a.click()
  }

  const exportTugasToExcel = async () => {
    if (!tugasData || !excelReady) return
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Nilai Tugas')
    
    const headers = ['No', 'Nama', 'NIK']; 
    tugasData.tugas.forEach((_, i) => headers.push(`T${i+1}`)); 
    headers.push('Rata-rata', 'Grade')
    
    const r = ws.addRow(headers); r.font = {bold: true}
    r.eachCell((cell, col) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1D5DB' } }
        cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} }
        cell.alignment = {horizontal:'center'}
        if (col >= 4 && col <= headers.length - 2) ws.getColumn(col).width = 5 
    })

    tugasData.siswa.forEach((s, i) => {
        const rowVals = [i+1, s.nama, s.nik]
        tugasData.tugas.forEach(t => {
            const v = s.nilaiTugas[t.id]?.nilai
            rowVals.push((v!==null && v!=='-') ? Number(v) : '')
        })
        rowVals.push(s.rataRata, s.grade)
        const row = ws.addRow(rowVals)
        row.eachCell(cell => cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} })
    })

    ws.getColumn(1).width = 5; 
    ws.getColumn(2).width = 30; 
    ws.getColumn(3).width = 15;
    
    const buf = await wb.xlsx.writeBuffer(); saveBlob(buf, `Nilai_${selectedMapel}.xlsx`)
  }

  // ==============================
  // ===== RENDER UI ==============
  // ==============================
  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* === CONTROLS === */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 grid grid-cols-1 md:grid-cols-4 gap-4">
           {/* Kelas */}
           <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Kelas</label>
              <select className="w-full border rounded-lg p-2.5" value={selectedKelas} onChange={e => setSelectedKelas(e.target.value)}>
                  {kelasList.map(k => <option key={k.id} value={k.id}>{getKelasDisplayName(k)}</option>)}
              </select>
           </div>
           
           {/* Mapel */}
           <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mapel</label>
              <select className="w-full border rounded-lg p-2.5" value={selectedMapel} onChange={e => setSelectedMapel(e.target.value)}>
                  {mapelList.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
           </div>
           
           {/* Multi-Select Bulan */}
           <div className="relative" ref={dropdownRef}>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bulan (Checklist)</label>
              <button 
                type="button"
                className="w-full border rounded-lg p-2.5 text-left bg-white flex justify-between items-center"
                onClick={() => setShowBulanDropdown(!showBulanDropdown)}
              >
                 <span className={`block truncate ${selectedBulan.length === 0 ? 'text-gray-400' : 'text-gray-900'}`}>
                    {selectedBulan.length === 0 
                        ? 'Pilih Bulan...' 
                        : `${selectedBulan.length} Bulan Terpilih`}
                 </span>
                 <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
              </button>

              {showBulanDropdown && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    <div className="p-2 space-y-1">
                        {bulanList.map((b) => (
                            <label key={b.value} className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded cursor-pointer select-none">
                                <input 
                                    type="checkbox" 
                                    value={b.value}
                                    checked={selectedBulan.includes(b.value)}
                                    onChange={() => handleToggleBulan(b.value)}
                                    className="rounded text-blue-600 focus:ring-blue-500"
                                />
                                <span className="text-sm text-gray-700">{b.label}</span>
                            </label>
                        ))}
                    </div>
                </div>
              )}
           </div>

           {/* Tombol Refresh */}
           <div className="flex items-end">
              <button className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition flex items-center justify-center gap-2" 
                onClick={() => {
                    if (activeTab === 'absensi') loadRekapAbsensi()
                    else loadRekapTugas()
                }}
              >
                <span>🔄</span> Muat Ulang
              </button>
           </div>
        </div>

        {/* === TABS === */}
        <div className="flex space-x-1 bg-gray-200 p-1 rounded-lg w-fit">
            <button className={`px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === 'absensi' ? 'bg-white shadow text-blue-700' : 'text-gray-600 hover:bg-gray-300'}`} onClick={() => setActiveTab('absensi')}>Absensi</button>
            <button className={`px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === 'tugas' ? 'bg-white shadow text-blue-700' : 'text-gray-600 hover:bg-gray-300'}`} onClick={() => setActiveTab('tugas')}>Nilai Tugas</button>
        </div>

        {/* === EMPTY STATES === */}
        {(!absensiData && activeTab === 'absensi') && (
            <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-300">
                <p className="text-gray-500">Silakan pilih Kelas, Mapel, dan checklist Bulan untuk melihat data absensi.</p>
            </div>
        )}
        {(!tugasData && activeTab === 'tugas') && (
            <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-300">
                <p className="text-gray-500">Silakan pilih Kelas, Mapel, dan checklist Bulan untuk melihat data nilai.</p>
            </div>
        )}

        {/* === TABLE ABSENSI === */}
        {activeTab === 'absensi' && absensiData && (
             <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                    <h3 className="font-bold text-gray-700">Rekap Absensi ({absensiData.periode})</h3>
                    <div className="flex space-x-2">
                        <button onClick={exportAbsensiToExcel} className="text-xs bg-green-600 text-white px-3 py-2 rounded hover:bg-green-700">Download Excel</button>
                        <button onClick={() => exportToGoogleSheets('absensi')} className="text-xs bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700">Google Sheets</button>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gray-100 text-gray-700 uppercase font-bold text-xs">
                            <tr>
                                <th className="px-3 py-3 w-10">No</th>
                                <th className="px-3 py-3 min-w-[200px]">Nama</th>
                                {absensiData.dateStrings.map(ds => {
                                    const dateNum = parseInt(ds.split('-')[2])
                                    const isSun = isSunday(ds)
                                    return (
                                        <th key={ds} className={`px-1 py-3 text-center w-8 border-l border-gray-200 ${isSun ? 'bg-red-100 text-red-600' : ''}`}>
                                            {dateNum}
                                        </th>
                                    )
                                })}
                                <th className="px-2 py-3 text-center border-l bg-blue-50">I</th>
                                <th className="px-2 py-3 text-center bg-red-50">A</th>
                                <th className="px-2 py-3 text-center bg-green-50 font-bold">H</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {absensiData.siswa.map((s, idx) => (
                                <tr key={s.id} className="hover:bg-gray-50">
                                    <td className="px-3 py-2 text-center">{idx + 1}</td>
                                    <td className="px-3 py-2 font-medium text-gray-900">{s.nama}</td>
                                    {absensiData.dateStrings.map(ds => {
                                        const st = s.absensiPerTanggal[ds]
                                        const isSun = isSunday(ds)
                                        return (
                                            <td key={ds} className={`px-1 py-2 text-center border-l border-gray-100 ${isSun ? 'bg-red-50' : ''}`}>
                                                {!isSun && st ? (
                                                    <span className={`font-bold ${st==='Hadir'?'text-green-600':st==='Izin'?'text-blue-600':'text-red-600'}`}>
                                                        {st.charAt(0)}
                                                    </span>
                                                ) : null}
                                            </td>
                                        )
                                    })}
                                    <td className="px-2 py-2 text-center bg-blue-50/50 font-bold">{s.total.Izin}</td>
                                    <td className="px-2 py-2 text-center bg-red-50/50 font-bold">{s.total.Alpha}</td>
                                    <td className="px-2 py-2 text-center bg-green-50/50 text-green-700 font-bold">{s.total.Hadir}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
             </div>
        )}

        {/* === TABLE TUGAS === */}
        {activeTab === 'tugas' && tugasData && (
             <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                    <h3 className="font-bold text-gray-700">Tabel Nilai Tugas ({tugasData.periode})</h3>
                    <div className="flex space-x-2">
                        <button onClick={exportTugasToExcel} className="text-xs bg-green-600 text-white px-3 py-2 rounded hover:bg-green-700">Download Excel</button>
                        <button onClick={() => exportToGoogleSheets('tugas')} className="text-xs bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700">Google Sheets</button>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gray-100 text-gray-700 uppercase font-bold text-xs">
                            <tr>
                                <th className="px-4 py-3 w-10">No</th>
                                <th className="px-4 py-3 min-w-[200px]">Nama</th>
                                {tugasData.tugas.map((t, i) => (
                                    <th key={t.id} className="px-2 py-3 text-center min-w-[60px]" title={t.judul}>T{i+1}</th>
                                ))}
                                <th className="px-4 py-3 text-center bg-blue-50">Rata</th>
                                <th className="px-4 py-3 text-center bg-purple-50">Grade</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {tugasData.siswa.map((s, idx) => (
                                <tr key={s.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-2 text-center">{idx + 1}</td>
                                    <td className="px-4 py-2 font-medium">{s.nama}</td>
                                    {tugasData.tugas.map((t) => {
                                        const nilaiSiswa = s.nilaiTugas[t.id]?.nilai
                                        return (
                                            <td key={t.id} className="px-1 py-1 text-center">
                                                {editingNilai?.siswaId === s.id && editingNilai?.tugasId === t.id ? (
                                                    <input 
                                                        autoFocus
                                                        className={`w-12 text-center border-2 rounded px-1 outline-none ${Number(nilaiSiswa) < 70 && nilaiSiswa !== '-' ? 'border-red-500 text-red-700' : 'border-blue-500'}`}
                                                        defaultValue={nilaiSiswa ?? ''}
                                                        onBlur={(e) => updateNilaiTugas(s.id, t.id, e.target.value)}
                                                        onKeyDown={(e) => { if(e.key === 'Enter') e.target.blur() }}
                                                    />
                                                ) : (
                                                    <div 
                                                        className={`cursor-pointer rounded px-2 py-1 mx-auto w-fit transition ${getColorClass(nilaiSiswa)} hover:brightness-95`}
                                                        onClick={() => setEditingNilai({siswaId: s.id, tugasId: t.id})}
                                                    >
                                                        {nilaiSiswa ?? '-'}
                                                    </div>
                                                )}
                                            </td>
                                        )
                                    })}
                                    <td className="px-4 py-2 text-center font-bold bg-blue-50/50">{s.rataRata}</td>
                                    
                                    {/* Grade dengan Warna */}
                                    <td className="p-2 text-center">
                                        <span className={`px-3 py-1 rounded-full text-xs shadow-sm border ${getColorClass(s.grade)}`}>
                                            {s.grade}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
             </div>
        )}
      </div>
    </div>
  )
}