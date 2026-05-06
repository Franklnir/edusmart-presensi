// src/pages/guru/JadwalGuru.jsx
import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import {
  getCertificateDisplayUrl,
  hydrateCertificateFileUrls,
  resolveCertificateFileUrl
} from '../../utils/certificateFiles'
import { loadExcelJsBrowser } from '../../utils/excelBrowser'

// --- HELPER FUNCTIONS ---

const getKelasDisplayName = (kelasObj) => {
  if (!kelasObj) return ''
  return kelasObj.nama || kelasObj.id || ''
}

const getNamaKelasFromList = (kelasId, kelasList) => {
  const kelas = kelasList.find((k) => k.id === kelasId)
  return getKelasDisplayName(kelas) || kelasId || '—'
}

const HARI_JS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

const formatDateIndo = (dateStr) => {
  const date = new Date(dateStr)
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

// --- KOMPONEN OVERLAY SERTIFIKAT ---
const SertifikatDetailOverlay = ({ sertifikat, onClose, onDownload }) => {
  const getFileType = (url) => {
    const safeUrl = String(url || '').toLowerCase()
    if (!safeUrl) return 'unknown'
    if (safeUrl.includes('.pdf')) return 'pdf'
    if (safeUrl.includes('.jpg') || safeUrl.includes('.jpeg')) return 'image'
    if (safeUrl.includes('.png')) return 'image'
    return 'unknown'
  }

  const displayFileUrl = getCertificateDisplayUrl(sertifikat)
  const fileType = getFileType(sertifikat.file_url || displayFileUrl)

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-600 to-orange-700 p-6 text-white">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-2xl font-bold">Detail Sertifikat</h2>
              <p className="text-amber-100 mt-1">
                {sertifikat.event}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:text-gray-200 text-2xl p-2 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Preview Sertifikat */}
            <div className="lg:col-span-2">
              <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl p-4">
                <h3 className="font-semibold text-gray-900 mb-4">Preview Sertifikat</h3>

                {fileType === 'pdf' ? (
                  <div className="aspect-[4/3] bg-white rounded-lg border border-gray-200 flex items-center justify-center">
                    <div className="text-center">
                      <div className="text-6xl mb-2">📄</div>
                      <p className="text-gray-600 font-medium">File PDF</p>
                      <p className="text-sm text-gray-500 mt-1">Klik download untuk melihat</p>
                    </div>
                  </div>
                ) : fileType === 'image' ? (
                  <div className="aspect-[4/3] bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <img
                      src={displayFileUrl}
                      alt={`Sertifikat ${sertifikat.event}`}
                      className="w-full h-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="aspect-[4/3] bg-white rounded-lg border border-gray-200 flex items-center justify-center">
                    <div className="text-center">
                      <div className="text-6xl mb-2">📎</div>
                      <p className="text-gray-600 font-medium">File Sertifikat</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Informasi Sertifikat */}
            <div className="space-y-6">
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <h4 className="font-semibold text-blue-900 mb-3 flex items-center gap-2">
                  <span>🏆</span> Informasi Sertifikat
                </h4>
                <div className="space-y-3 text-sm">
                  <div>
                    <span className="text-blue-700 font-medium">Nama Penerima:</span>
                    <p className="text-blue-900 font-semibold">{sertifikat.nama_penerima}</p>
                  </div>
                  <div>
                    <span className="text-blue-700 font-medium">Acara/Event:</span>
                    <p className="text-blue-900">{sertifikat.event}</p>
                  </div>
                  <div>
                    <span className="text-blue-700 font-medium">Tanggal Diterbitkan:</span>
                    <p className="text-blue-900">
                      {new Date(sertifikat.issued_at).toLocaleDateString('id-ID', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric'
                      })}
                    </p>
                  </div>
                  <div>
                    <span className="text-blue-700 font-medium">Tanggal Event:</span>
                    <p className="text-blue-900">
                      {new Date(sertifikat.event_date).toLocaleDateString('id-ID', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric'
                      })}
                    </p>
                  </div>
                  {sertifikat.kelas && (
                    <div>
                      <span className="text-blue-700 font-medium">Kelas:</span>
                      <p className="text-blue-900">{sertifikat.kelas}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Status Pengiriman */}
              <div className={`border rounded-xl p-4 ${
                sertifikat.sent
                  ? 'bg-green-50 border-green-200'
                  : 'bg-yellow-50 border-yellow-200'
              }`}>
                <h4 className="font-semibold mb-2 flex items-center gap-2">
                  <span>📮</span> Status Pengiriman
                </h4>
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${
                    sertifikat.sent ? 'bg-green-500' : 'bg-yellow-500'
                  }`}></div>
                  <span className={`text-sm font-medium ${
                    sertifikat.sent ? 'text-green-700' : 'text-yellow-700'
                  }`}>
                    {sertifikat.sent ? 'Terkirim ke Sistem' : 'Menunggu Konfirmasi'}
                  </span>
                </div>
                {sertifikat.sent_at && (
                  <p className="text-xs text-gray-500 mt-1">
                    Pada {new Date(sertifikat.sent_at).toLocaleDateString('id-ID')}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="space-y-3">
                <button
                  onClick={() => onDownload(sertifikat)}
                  className="w-full py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg font-semibold hover:from-green-700 hover:to-emerald-700 transition-all shadow-lg shadow-green-200 flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download Sertifikat
                </button>

                <button
                  onClick={onClose}
                  className="w-full py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-semibold transition-colors"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// --- KOMPONEN OVERLAY RIWAYAT SERTIFIKAT ---
const RiwayatSertifikatOverlay = ({ sertifikatList, onClose, onViewDetail, onDownload }) => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-600 to-orange-700 p-6 text-white">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-2xl font-bold">Riwayat Sertifikat</h2>
              <p className="text-amber-100 mt-1">
                Total {sertifikatList.length} sertifikat
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:text-gray-200 text-2xl p-2 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {sertifikatList.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sertifikatList.map((sertifikat) => (
                <div
                  key={sertifikat.id}
                  className="border border-gray-200 rounded-xl p-4 hover:border-amber-300 hover:shadow-md transition-all cursor-pointer group"
                  onClick={() => onViewDetail(sertifikat)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="font-bold text-gray-900 line-clamp-2 group-hover:text-amber-600 transition-colors">
                        {sertifikat.event}
                      </h3>
                      <p className="text-sm text-gray-600 mt-1">
                        {sertifikat.nama_penerima}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      sertifikat.sent
                        ? 'bg-green-100 text-green-700 border border-green-200'
                        : 'bg-yellow-100 text-yellow-700 border border-yellow-200'
                    }`}>
                      {sertifikat.sent ? 'Terkirim' : 'Pending'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>
                      {new Date(sertifikat.issued_at).toLocaleDateString('id-ID', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric'
                      })}
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onDownload(sertifikat)
                        }}
                        className="text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300">
              <div className="text-gray-300 text-6xl mb-4">🏆</div>
              <p className="text-gray-500 text-lg font-medium">Belum ada sertifikat</p>
              <p className="text-gray-400 mt-2">Sertifikat akan muncul di sini setelah diterbitkan oleh admin</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 border-t flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-semibold transition-colors"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  )
}

// Komponen Overlay Absensi Eskul
const AbsensiEskulOverlay = ({ eskul, onClose, siswaMap }) => {
  const { pushToast, setLoading } = useUIStore()
  const [anggotaEskul, setAnggotaEskul] = useState([])
  const [absensiData, setAbsensiData] = useState({})
  const [selectedMonths, setSelectedMonths] = useState([new Date().getMonth()])
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [viewMode, setViewMode] = useState('detail') // 'detail' atau 'rekap'

  // Generate tanggal-tanggal dalam bulan-bulan yang dipilih yang sesuai dengan hari eskul
  const getEskulDatesInMonths = () => {
    const dates = []
    const hariEskulList = eskul.hari ? eskul.hari.split(',') : []

    selectedMonths.forEach(month => {
      const daysInMonth = new Date(selectedYear, month + 1, 0).getDate()

      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(selectedYear, month, day)
        const dayName = HARI_JS[date.getDay()]
        if (hariEskulList.includes(dayName)) {
          dates.push({
            date: new Date(selectedYear, month, day),
            dateStr: date.toISOString().split('T')[0],
            dayName,
            month: month
          })
        }
      }
    })

    return dates.sort((a, b) => a.date - b.date)
  }

  const eskulDates = getEskulDatesInMonths()
  const totalPertemuan = eskulDates.length

  // Load anggota eskul
  useEffect(() => {
    const loadAnggotaEskul = async () => {
      try {
        setLoading(true)
        const { data, error } = await supabase
          .from('ekskul_anggota')
          .select('*')
          .eq('ekskul_id', eskul.id)

        if (error) throw error

        const userIds = Array.from(
          new Set((data || []).map((anggota) => String(anggota.user_id || '').trim()).filter(Boolean))
        )

        let profileById = {}
        if (userIds.length > 0) {
          const { data: profileRows, error: profileError } = await supabase
            .from('profiles')
            .select('id, nama, email, kelas, role')
            .in('id', userIds)

          if (profileError) throw profileError

          profileById = (profileRows || []).reduce((acc, row) => {
            acc[String(row.id)] = row
            return acc
          }, {})
        }

        const anggotaWithDetails = (data || []).map(anggota => {
          const uid = String(anggota.user_id || '')
          const siswa = profileById[uid] || siswaMap[uid] || {}
          const fallbackName = uid ? `ID: ${uid.slice(0, 8)}...` : 'Tanpa User ID'
          return {
            id: anggota.id,
            user_id: anggota.user_id,
            nama: siswa.nama || siswa.email || fallbackName,
            kelas: siswa.kelas || '—',
            role: siswa.role || null,
            created_at: anggota.created_at
          }
        }).sort((a, b) => a.kelas.localeCompare(b.kelas) || a.nama.localeCompare(b.nama))

        setAnggotaEskul(anggotaWithDetails)
      } catch (error) {
        console.error('Error loading anggota eskul:', error)
        pushToast('error', 'Gagal memuat data anggota eskul')
      } finally {
        setLoading(false)
      }
    }

    if (eskul) {
      loadAnggotaEskul()
    }
  }, [eskul, siswaMap, setLoading, pushToast])

  // Load data absensi
  useEffect(() => {
    const loadAbsensiData = async () => {
      try {
        if (anggotaEskul.length === 0) return

        const dateStrs = eskulDates.map(d => d.dateStr)
        const { data, error } = await supabase
          .from('absensi_eskul')
          .select('*')
          .in('ekskul_id', [eskul.id])
          .in('tanggal', dateStrs)

        if (error) throw error

        // Format data absensi
        const absensiMap = {}
        data?.forEach(record => {
          const key = `${record.user_id}_${record.tanggal}`
          absensiMap[key] = record.status
        })

        setAbsensiData(absensiMap)
      } catch (error) {
        console.error('Error loading absensi data:', error)
      }
    }

    loadAbsensiData()
  }, [anggotaEskul, eskulDates, eskul.id])

  // === Hitung statistik kehadiran (TANPA menganggap kosong sebagai Alpha) ===
  const calculateStats = (userId) => {
    let hadir = 0
    let izin = 0
    let alpha = 0

    eskulDates.forEach((date) => {
      const key = `${userId}_${date.dateStr}`
      const status = absensiData[key]

      if (status === 'Hadir') {
        hadir++
      } else if (status === 'Izin') {
        izin++
      } else if (status === 'Alpha') {
        alpha++
      }
      // Jika belum ada status (undefined / null / '-'), tidak dihitung sebagai Alpha
    })

    return { hadir, izin, alpha }
  }

  // Update status absensi
  const updateAbsensi = async (userId, tanggal, status) => {
    try {
      setLoading(true)
      const key = `${userId}_${tanggal}`

      // Cek apakah sudah ada data
      const { data: existing } = await supabase
        .from('absensi_eskul')
        .select('id')
        .eq('ekskul_id', eskul.id)
        .eq('user_id', userId)
        .eq('tanggal', tanggal)
        .single()

      if (existing) {
        // Update existing
        const { error } = await supabase
          .from('absensi_eskul')
          .update({
            status,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id)

        if (error) throw error
      } else {
        // Insert new
        const { error } = await supabase
          .from('absensi_eskul')
          .insert({
            ekskul_id: eskul.id,
            user_id: userId,
            tanggal,
            status,
            created_at: new Date().toISOString()
          })

        if (error) throw error
      }

      // Update local state
      setAbsensiData(prev => ({
        ...prev,
        [key]: status
      }))

      pushToast('success', `Status absensi diperbarui: ${status}`)
    } catch (error) {
      console.error('Error updating absensi:', error)
      pushToast('error', 'Gagal memperbarui absensi')
    } finally {
      setLoading(false)
    }
  }

  // Fungsi untuk export ke Excel dengan format & warna
  const exportToExcel = async () => {
    try {
      const periodLabel = `${selectedMonths
        .map((month) => new Date(selectedYear, month).toLocaleDateString('id-ID', { month: 'long' }))
        .join(', ')} ${selectedYear}`

      const excelDataRekap = [
        ['REKAP ABSENSI EKSKUL', '', '', '', '', '', ''],
        [`Ekskul: ${eskul.nama}`, '', '', '', '', '', ''],
        [`Periode: ${periodLabel}`, '', '', '', '', '', ''],
        [`Total Pertemuan: ${totalPertemuan}`, '', '', '', '', '', ''],
        ['', '', '', '', '', '', ''],
        ['No', 'Name', 'Kelas', 'Total', '', '', 'Masuk'],
        ['', '', '', '', 'H', 'A', 'I'],
        ...anggotaEskul.map((anggota, index) => {
          const stats = calculateStats(anggota.user_id)
          return [index + 1, anggota.nama, anggota.kelas, totalPertemuan, stats.hadir, stats.alpha, stats.izin]
        })
      ]

      const excelDataDetail = [
        ['DETAIL ABSENSI PER SISWA', '', '', '', '', '', ''],
        [`Ekskul: ${eskul.nama}`, '', '', '', '', '', ''],
        [`Periode: ${periodLabel}`, '', '', '', '', '', ''],
        ['', '', '', '', '', '', ''],
        ['No', 'Name', 'Kelas', 'Total', '', '', 'Masuk'],
        ['', '', '', '', 'H', 'A', 'I'],
        ...anggotaEskul.map((anggota, index) => {
          const stats = calculateStats(anggota.user_id)
          return [index + 1, anggota.nama, anggota.kelas, totalPertemuan, stats.hadir, stats.alpha, stats.izin]
        })
      ]

      const ExcelJS = await loadExcelJsBrowser()
      const workbook = new ExcelJS.Workbook()
      workbook.creator = 'EduSmart Guru'
      workbook.created = new Date()

      const titleStyle = {
        font: { bold: true, size: 14, color: { argb: 'FFFFFFFF' } },
        alignment: { horizontal: 'center', vertical: 'middle' },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }
      }

      const headerStyle = {
        font: { bold: true, color: { argb: 'FF111827' } },
        alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } }
      }

      const subHeaderStyle = {
        font: { bold: true, color: { argb: 'FF111827' } },
        alignment: { horizontal: 'center', vertical: 'middle' },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
      }

      const thinBorder = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
      }

      const applyStyleRow = (worksheet, rowNumber, style, withBorder = false) => {
        const row = worksheet.getRow(rowNumber)
        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.font = style.font
          cell.alignment = style.alignment
          cell.fill = style.fill
          if (withBorder) {
            cell.border = thinBorder
          }
        })
      }

      const setupSheet = ({ name, data, merges, titleRows, headerRows, subHeaderRows }) => {
        const worksheet = workbook.addWorksheet(name)
        worksheet.columns = [
          { width: 5 },
          { width: 25 },
          { width: 12 },
          { width: 8 },
          { width: 8 },
          { width: 8 },
          { width: 8 }
        ]

        data.forEach((row) => worksheet.addRow(row))
        merges.forEach((range) => worksheet.mergeCells(range))
        titleRows.forEach((rowNumber) => applyStyleRow(worksheet, rowNumber, titleStyle))
        headerRows.forEach((rowNumber) => applyStyleRow(worksheet, rowNumber, headerStyle, true))
        subHeaderRows.forEach((rowNumber) => applyStyleRow(worksheet, rowNumber, subHeaderStyle, true))
        return worksheet
      }

      setupSheet({
        name: 'Rekap Siswa',
        data: excelDataRekap,
        merges: ['A1:G1', 'A2:G2', 'A3:G3', 'A4:G4', 'D6:G6', 'A6:A7', 'B6:B7', 'C6:C7', 'D6:D7'],
        titleRows: [1, 2, 3, 4],
        headerRows: [6],
        subHeaderRows: [7]
      })

      setupSheet({
        name: 'Detail Siswa',
        data: excelDataDetail,
        merges: ['A1:G1', 'A2:G2', 'A3:G3', 'D5:G5', 'A5:A6', 'B5:B6', 'C5:C6', 'D5:D6'],
        titleRows: [1, 2, 3],
        headerRows: [5],
        subHeaderRows: [6]
      })

      const buffer = await workbook.xlsx.writeBuffer()
      const fileName = `Rekap_Absensi_${eskul.nama.replace(/\s+/g, '_')}_${selectedMonths
        .map((month) => month + 1)
        .join('-')}_${selectedYear}.xlsx`

      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)

      pushToast('success', 'Rekap berhasil diexport ke Excel (2 sheet) dengan format rapi')
    } catch (error) {
      console.error('Error exporting to Excel:', error)
      pushToast('error', 'Gagal mengekspor rekap')
    }
  }

  // Render Tabel Rekap (Format Baru)
  const renderRekapTable = () => {
    return (
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border border-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th rowSpan="2" className="px-4 py-3 text-center font-semibold text-gray-700 border-b border-r">
                No
              </th>
              <th rowSpan="2" className="px-4 py-3 text-left font-semibold text-gray-700 border-b border-r">
                Name
              </th>
              <th rowSpan="2" className="px-4 py-3 text-left font-semibold text-gray-700 border-b border-r">
                Kelas
              </th>
              <th rowSpan="2" className="px-4 py-3 text-center font-semibold text-gray-700 border-b border-r">
                Total
              </th>
              <th colSpan="3" className="px-4 py-3 text-center font-semibold text-gray-700 border-b">
                Masuk
              </th>
            </tr>
            <tr>
              <th className="px-4 py-2 text-center font-semibold text-gray-700 border-b border-r">H</th>
              <th className="px-4 py-2 text-center font-semibold text-gray-700 border-b border-r">A</th>
              <th className="px-4 py-2 text-center font-semibold text-gray-700 border-b">I</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {anggotaEskul.map((anggota, index) => {
              const stats = calculateStats(anggota.user_id)
              return (
                <tr key={anggota.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-center font-medium text-gray-900 border-r">
                    {index + 1}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900 border-r">
                    {anggota.nama}
                  </td>
                  <td className="px-4 py-3 text-gray-600 border-r">
                    {anggota.kelas}
                  </td>
                  <td className="px-4 py-3 text-center font-semibold text-gray-900 border-r">
                    {totalPertemuan}
                  </td>
                  <td className="px-4 py-3 text-center font-semibold text-green-600 border-r">
                    {stats.hadir}
                  </td>
                  <td className="px-4 py-3 text-center font-semibold text-red-600 border-r">
                    {stats.alpha}
                  </td>
                  <td className="px-4 py-3 text-center font-semibold text-yellow-600">
                    {stats.izin}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  // Render Tabel Detail (per tanggal)
  const renderDetailTable = () => {
    return (
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left font-semibold text-gray-700 border-b">
                No
              </th>
              <th className="sticky left-12 z-10 bg-gray-50 px-4 py-3 text-left font-semibold text-gray-700 border-b min-w-[200px]">
                Nama
              </th>
              <th className="sticky left-64 z-10 bg-gray-50 px-4 py-3 text-left font-semibold text-gray-700 border-b min-w-[100px]">
                Kelas
              </th>

              {eskulDates.map((date) => (
                <th key={date.dateStr} className="px-3 py-3 text-center font-semibold text-gray-700 border-b whitespace-nowrap">
                  <div className="flex flex-col items-center">
                    <span className="text-xs">{date.dayName}</span>
                    <span className="text-xs font-normal">
                      {date.date.getDate()}/{date.date.getMonth() + 1}
                    </span>
                  </div>
                </th>
              ))}

              <th className="px-4 py-3 text-center font-semibold text-gray-700 border-b">
                H
              </th>
              <th className="px-4 py-3 text-center font-semibold text-gray-700 border-b">
                I
              </th>
              <th className="px-4 py-3 text-center font-semibold text-gray-700 border-b">
                A
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {anggotaEskul.map((anggota, index) => {
              const stats = calculateStats(anggota.user_id)
              return (
                <tr key={anggota.id} className="hover:bg-gray-50">
                  <td className="sticky left-0 bg-white px-4 py-3 font-medium text-gray-900">
                    {index + 1}
                  </td>
                  <td className="sticky left-12 bg-white px-4 py-3 font-medium text-gray-900 min-w-[200px]">
                    {anggota.nama}
                  </td>
                  <td className="sticky left-64 bg-white px-4 py-3 text-gray-600 min-w-[100px]">
                    {anggota.kelas}
                  </td>

                  {eskulDates.map((date) => {
                    const key = `${anggota.user_id}_${date.dateStr}`
                    const status = absensiData[key] || '-'
                    return (
                      <td key={date.dateStr} className="px-3 py-3 text-center">
                        <div className="flex gap-1 justify-center">
                          <button
                            onClick={() => updateAbsensi(anggota.user_id, date.dateStr, 'Hadir')}
                            className={`w-6 h-6 rounded text-xs font-bold transition-colors ${
                              status === 'Hadir'
                                ? 'bg-green-500 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-green-100'
                            }`}
                            title="Hadir"
                          >
                            H
                          </button>
                          <button
                            onClick={() => updateAbsensi(anggota.user_id, date.dateStr, 'Izin')}
                            className={`w-6 h-6 rounded text-xs font-bold transition-colors ${
                              status === 'Izin'
                                ? 'bg-yellow-500 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-yellow-100'
                            }`}
                            title="Izin"
                          >
                            I
                          </button>
                          <button
                            onClick={() => updateAbsensi(anggota.user_id, date.dateStr, 'Alpha')}
                            className={`w-6 h-6 rounded text-xs font-bold transition-colors ${
                              status === 'Alpha'
                                ? 'bg-red-500 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-red-100'
                            }`}
                            title="Alpha"
                          >
                            A
                          </button>
                        </div>
                      </td>
                    )
                  })}

                  <td className="px-4 py-3 text-center font-semibold text-green-600">
                    {stats.hadir}
                  </td>
                  <td className="px-4 py-3 text-center font-semibold text-yellow-600">
                    {stats.izin}
                  </td>
                  <td className="px-4 py-3 text-center font-semibold text-red-600">
                    {stats.alpha}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  // Toggle bulan yang dipilih
  const toggleMonth = (month) => {
    setSelectedMonths(prev =>
      prev.includes(month)
        ? prev.filter(m => m !== month)
        : [...prev, month]
    )
  }

  const selectAllMonths = () => {
    setSelectedMonths([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  }

  const clearAllMonths = () => {
    setSelectedMonths([])
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-7xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-indigo-700 p-6 text-white">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-2xl font-bold">
                {viewMode === 'detail' ? `Absensi ${eskul.nama}` : `Rekap Absensi ${eskul.nama}`}
              </h2>
              <p className="text-purple-100 mt-1">
                {eskul.hari} • {eskul.jam_mulai} - {eskul.jam_selesai}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:text-gray-200 text-2xl p-2 transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Month Selector dan View Toggle */}
          <div className="flex items-center gap-4 mt-4 flex-wrap">
            {/* Tahun */}
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              className="bg-white/10 text-white border border-white/30 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-white/50"
            >
              {Array.from({ length: 5 }, (_, i) => {
                const year = new Date().getFullYear() - 2 + i
                return <option key={year} value={year} className="text-gray-900">{year}</option>
              })}
            </select>

            {/* Pilihan Bulan Multiple */}
            <div className="flex items-center gap-2">
              <span className="text-purple-100 text-sm font-medium">Bulan:</span>
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: 12 }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => toggleMonth(i)}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                      selectedMonths.includes(i)
                        ? 'bg-white text-purple-700 shadow-md'
                        : 'bg-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    {new Date(selectedYear, i).toLocaleDateString('id-ID', { month: 'short' })}
                  </button>
                ))}
              </div>
              <div className="flex gap-1 ml-2">
                <button
                  onClick={selectAllMonths}
                  className="px-2 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600"
                >
                  Pilih Semua
                </button>
                <button
                  onClick={clearAllMonths}
                  className="px-2 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600"
                >
                  Hapus Semua
                </button>
              </div>
            </div>

            {/* View Mode Toggle */}
            <div className="flex gap-2 ml-4">
              <button
                onClick={() => setViewMode('detail')}
                className={`px-4 py-2 rounded-lg font-semibold text-sm transition-colors ${
                  viewMode === 'detail'
                    ? 'bg-white text-purple-700 shadow-md'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                Tampilan Detail
              </button>
              <button
                onClick={() => setViewMode('rekap')}
                className={`px-4 py-2 rounded-lg font-semibold text-sm transition-colors ${
                  viewMode === 'rekap'
                    ? 'bg-white text-purple-700 shadow-md'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                Tampilan Rekap
              </button>
            </div>

            <div className="text-sm text-purple-100 ml-auto">
              {eskulDates.length} pertemuan • {anggotaEskul.length} anggota
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {anggotaEskul.length > 0 ? (
            viewMode === 'detail' ? renderDetailTable() : renderRekapTable()
          ) : (
            <div className="text-center py-12">
              <div className="text-gray-300 text-6xl mb-4">👥</div>
              <p className="text-gray-500 text-lg font-medium">Belum ada anggota</p>
              <p className="text-gray-400 mt-2">Tambahkan siswa ke ekskul ini terlebih dahulu</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 border-t flex justify-between items-center">
          <div className="flex gap-4 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded"></div>
              <span>H = Hadir</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-yellow-500 rounded"></div>
              <span>I = Izin</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-red-500 rounded"></div>
              <span>A = Alpha</span>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={exportToExcel}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold transition-colors flex items-center gap-2"
              title="Export ke Excel dengan 2 sheets: Rekap & Detail"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export Excel
            </button>

            <button
              onClick={onClose}
              className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-semibold transition-colors"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Komponen Overlay Detail Organisasi
const OrganisasiDetailOverlay = ({ organisasi, onClose, siswaMap = {} }) => {
  const { pushToast, setLoading } = useUIStore()
  const [anggotaOrganisasi, setAnggotaOrganisasi] = useState([])

  useEffect(() => {
    const loadAnggotaOrganisasi = async () => {
      try {
        setLoading(true)
        const { data, error } = await supabase
          .from('organisasi_anggota')
          .select('*')
          .eq('organisasi_id', organisasi.id)
          .order('jabatan', { ascending: false })
          .order('nama')

        if (error) throw error

        const normalized = (data || []).map((anggota) => {
          const siswaId = String(anggota.siswa_id || '').trim()
          const siswa = siswaMap[siswaId] || null
          return {
            ...anggota,
            nama: anggota.nama || siswa?.nama || siswa?.email || 'Tidak diketahui',
            kelas: anggota.kelas || siswa?.kelas || '—'
          }
        })

        setAnggotaOrganisasi(normalized)
      } catch (error) {
        console.error('Error loading anggota organisasi:', error)
        pushToast('error', 'Gagal memuat data anggota organisasi')
      } finally {
        setLoading(false)
      }
    }

    if (organisasi) {
      loadAnggotaOrganisasi()
    }
  }, [organisasi, pushToast, setLoading, siswaMap])

  const getJabatanColor = (jabatan) => {
    const jabatanLower = jabatan?.toLowerCase() || ''
    if (jabatanLower.includes('ketua')) return 'bg-red-100 text-red-800 border-red-200'
    if (jabatanLower.includes('wakil') || jabatanLower.includes('sekretaris')) return 'bg-blue-100 text-blue-800 border-blue-200'
    if (jabatanLower.includes('bendahara')) return 'bg-green-100 text-green-800 border-green-200'
    if (jabatanLower.includes('koordinator') || jabatanLower.includes('kordinator')) return 'bg-purple-100 text-purple-800 border-purple-200'
    return 'bg-gray-100 text-gray-800 border-gray-200'
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-green-700 p-6 text-white">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-2xl font-bold">{organisasi.nama}</h2>
              <p className="text-emerald-100 mt-1">
                {organisasi.visi ? `Visi: ${organisasi.visi}` : 'Organisasi Sekolah'}
              </p>
              {organisasi.misi && (
                <p className="text-emerald-100 text-sm mt-1">
                  Misi: {organisasi.misi}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-white hover:text-gray-200 text-2xl p-2 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">👥</span>
              Daftar Anggota ({anggotaOrganisasi.length})
            </h3>

            {anggotaOrganisasi.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {anggotaOrganisasi.map((anggota, index) => (
                  <div
                    key={anggota.id}
                    className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h4 className="font-semibold text-gray-900 text-lg">{anggota.nama}</h4>
                        <p className="text-gray-600 text-sm mt-1">Kelas: {anggota.kelas || '—'}</p>
                      </div>
                      <span className={`px-3 py-1 text-xs font-semibold rounded-full border ${getJabatanColor(anggota.jabatan)}`}>
                        {anggota.jabatan || 'Anggota'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>Anggota #{index + 1}</span>
                      <span>
                        Bergabung: {new Date(anggota.created_at).toLocaleDateString('id-ID')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300">
                <div className="text-gray-300 text-6xl mb-4">👥</div>
                <p className="text-gray-500 text-lg font-medium">Belum ada anggota</p>
                <p className="text-gray-400 mt-2">Tambahkan anggota ke organisasi ini</p>
              </div>
            )}
          </div>

          {/* Informasi Organisasi */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <h4 className="font-semibold text-blue-900 mb-3 flex items-center gap-2">
              <span>ℹ️</span> Informasi Organisasi
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-blue-700 font-medium">Nama Organisasi:</span>
                <p className="text-blue-900">{organisasi.nama}</p>
              </div>
              <div>
                <span className="text-blue-700 font-medium">Pembina:</span>
                <p className="text-blue-900">{organisasi.pembina_guru_nama || '—'}</p>
              </div>
              {organisasi.visi && (
                <div className="md:col-span-2">
                  <span className="text-blue-700 font-medium">Visi:</span>
                  <p className="text-blue-900">{organisasi.visi}</p>
                </div>
              )}
              {organisasi.misi && (
                <div className="md:col-span-2">
                  <span className="text-blue-700 font-medium">Misi:</span>
                  <p className="text-blue-900">{organisasi.misi}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 border-t flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-semibold transition-colors"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  )
}

// Komponen Utama JadwalGuru
export default function JadwalGuru() {
  const { profile, user } = useAuthStore()
  const { pushToast, setLoading } = useUIStore()

  // --- STATE MANAGEMENT ---
  const [jadwal, setJadwal] = useState([])
  const [jamKosongHariIni, setJamKosongHariIni] = useState([])
  const [eskulDiampu, setEskulDiampu] = useState([])
  const [organisasiDiampu, setOrganisasiDiampu] = useState([])
  const [strukturJabatan, setStrukturJabatan] = useState([])
  const [kelasList, setKelasList] = useState([])
  const [waliKelasSaya, setWaliKelasSaya] = useState([])
  const [pengumumanList, setPengumumanList] = useState([])
  const [siswaList, setSiswaList] = useState([])
  const [strukturSekolah, setStrukturSekolah] = useState([])

  // State overlay
  const [selectedEskul, setSelectedEskul] = useState(null)
  const [selectedOrganisasi, setSelectedOrganisasi] = useState(null)
  const [showAbsensiOverlay, setShowAbsensiOverlay] = useState(false)
  const [showOrganisasiOverlay, setShowOrganisasiOverlay] = useState(false)

  // Sertifikat
  const [sertifikatList, setSertifikatList] = useState([])
  const [showSertifikatOverlay, setShowSertifikatOverlay] = useState(false)
  const [showRiwayatSertifikatOverlay, setShowRiwayatSertifikatOverlay] = useState(false)
  const [selectedSertifikat, setSelectedSertifikat] = useState(null)

  const [activeHari, setActiveHari] = useState('Hari Ini')
  const [currentTime, setCurrentTime] = useState(new Date())

  const { todayStr, todayName } = React.useMemo(() => {
    const now = new Date()
    const todayName = HARI_JS[now.getDay()]
    const todayStr = now.toLocaleDateString('en-CA')
    return { todayStr, todayName }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Map siswa
  const siswaMap = React.useMemo(() => {
    const map = {}
    siswaList.forEach(siswa => {
      map[siswa.uid] = siswa
    })
    return map
  }, [siswaList])

  // === LOAD DATA (kelas, siswa, pengumuman, sertifikat, struktur, dll) ===
  useEffect(() => {
    const loadAllKelas = async () => {
      try {
        const { data, error } = await supabase
          .from('kelas')
          .select('*')
          .order('grade')
          .order('suffix')
        if (error) throw error
        setKelasList(data || [])
      } catch (error) {
        console.error('Error loading kelas:', error)
      }
    }
    loadAllKelas()
  }, [])

  useEffect(() => {
    const loadSiswaList = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, nama, email, kelas')
          .eq('role', 'siswa')
          .order('kelas')
          .order('nama')

        if (error) throw error
        setSiswaList(data?.map(s => ({
          uid: s.id,
          nama: s.nama || s.email,
          kelas: s.kelas || '',
          email: s.email
        })) || [])
      } catch (error) {
        console.error('Error loading siswa list:', error)
      }
    }
    loadSiswaList()
  }, [])

  useEffect(() => {
    const loadPengumuman = async () => {
      try {
        const { data, error } = await supabase
          .from('pengumuman')
          .select('*')
          .in('target', ['guru', 'semua'])
          .order('created_at', { ascending: false })
          .limit(3)

        if (error) throw error
        setPengumumanList(data || [])
      } catch (error) {
        console.error('Error loading pengumuman:', error)
      }
    }
    loadPengumuman()
  }, [])

  useEffect(() => {
    const loadSertifikat = async () => {
      if (!user?.id) return

      try {
        setLoading(true)
        const { data, error } = await supabase
          .from('certificates')
          .select('*')
          .eq('user_id', user.id)
          .order('issued_at', { ascending: false })

        if (error) throw error
        const hydrated = await hydrateCertificateFileUrls(data || [])
        setSertifikatList(hydrated)
      } catch (error) {
        console.error('Error loading sertifikat:', error)
        pushToast('error', 'Gagal memuat data sertifikat')
      } finally {
        setLoading(false)
      }
    }

    loadSertifikat()
  }, [user?.id, setLoading, pushToast])

  useEffect(() => {
    const loadStrukturSekolah = async () => {
      try {
        const { data, error } = await supabase
          .from('struktur_sekolah')
          .select('*')
          .order('jabatan')

        if (error) throw error
        setStrukturSekolah(data || [])
      } catch (error) {
        console.error('Error loading struktur sekolah:', error)
      }
    }
    loadStrukturSekolah()
  }, [])

  useEffect(() => {
    if (!user?.id) return

    const fetchData = async () => {
      try {
        // Wali Kelas
        const { data: waliData } = await supabase
          .from('kelas_struktur')
          .select('kelas_id, wali_guru_id, wali_guru_nama')
          .eq('wali_guru_id', user.id)
        setWaliKelasSaya(waliData || [])

        // Jadwal
        const { data: jadwalData } = await supabase
          .from('jadwal')
          .select('*')
          .eq('guru_id', user.id)
          .order('jam_mulai', { ascending: true })
        setJadwal(jadwalData || [])

        // Ekskul
        const { data: ekskulData } = await supabase
          .from('ekskul')
          .select('*')
          .eq('pembina_guru_id', user.id)

        if (ekskulData) {
          const ekskulWithCount = await Promise.all(ekskulData.map(async (e) => {
            const { count } = await supabase
              .from('ekskul_anggota')
              .select('*', { count: 'exact', head: true })
              .eq('ekskul_id', e.id)
            return { ...e, jumlah_anggota: count || 0 }
          }))
          setEskulDiampu(ekskulWithCount)
        }

        // Struktur jabatan saya
        const { data: jabatanData } = await supabase
          .from('struktur_sekolah')
          .select('*')
          .eq('guru_id', user.id)
        setStrukturJabatan(jabatanData || [])

        // Organisasi
        const { data: orgData } = await supabase
          .from('organisasi')
          .select('*')
          .eq('pembina_guru_id', user.id)

        if (orgData) {
          const orgWithCount = await Promise.all(orgData.map(async (org) => {
            const { count } = await supabase
              .from('organisasi_anggota')
              .select('*', { count: 'exact', head: true })
              .eq('organisasi_id', org.id)
            return { ...org, jumlah_anggota: count || 0 }
          }))
          setOrganisasiDiampu(orgWithCount)
        }
      } catch (error) {
        console.error('Error fetching user related data:', error)
      }
    }
    fetchData()
  }, [user?.id])

  const loadSemuaJamKosongHariIni = React.useCallback(async () => {
    if (!todayStr) return
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('jam_kosong')
        .select(`*, profiles!jam_kosong_created_by_fkey ( nama )`)
        .eq('tanggal', todayStr)
        .order('jam_mulai', { ascending: true })

      if (error) throw error

      const formattedData = data?.map((item) => ({
        id: item.id,
        kelas: item.kelas || '-',
        mapel: item.mapel || '-',
        jam_mulai: item.jam_mulai,
        jam_selesai: item.jam_selesai,
        alasan: item.alasan,
        guru_pengganti: item.guru_pengganti,
        guru_pengaju: item.profiles?.nama || 'Guru',
        created_by: item.created_by
      })) || []

      setJamKosongHariIni(formattedData)
    } catch (error) {
      console.error('Error loading jam kosong:', error)
      pushToast('error', 'Gagal memuat data jam kosong')
    } finally {
      setLoading(false)
    }
  }, [todayStr, setLoading, pushToast])

  useEffect(() => {
    loadSemuaJamKosongHariIni()
  }, [loadSemuaJamKosongHariIni])

  // --- LOGIC HANDLERS ---
  const filteredJadwal = React.useMemo(() => {
    if (activeHari === 'Hari Ini') {
      return jadwal.filter((j) => j.hari === todayName)
    }
    return jadwal.filter((j) => j.hari === activeHari)
  }, [jadwal, activeHari, todayName])

  const hariList = React.useMemo(() => {
    const hariSet = new Set(jadwal.map((j) => j.hari).filter(Boolean))
    const sorter = { 'Senin': 1, 'Selasa': 2, 'Rabu': 3, 'Kamis': 4, 'Jumat': 5, 'Sabtu': 6, 'Minggu': 7 }
    const sortedHari = Array.from(hariSet).sort((a, b) => (sorter[a] || 99) - (sorter[b] || 99))
    return ['Hari Ini', ...sortedHari]
  }, [jadwal])

  const handleToggleJamKosong = async (jamKosongId, currentPengganti) => {
    try {
      setLoading(true)
      const namaUser = profile?.nama || user?.email || 'Guru Pengganti'

      const isCanceling = currentPengganti === namaUser
      const newValue = isCanceling ? null : namaUser

      const { error } = await supabase
        .from('jam_kosong')
        .update({
          guru_pengganti: newValue,
          updated_at: new Date().toISOString()
        })
        .eq('id', jamKosongId)

      if (error) throw error

      setJamKosongHariIni((prev) =>
        prev.map((jam) =>
          jam.id === jamKosongId
            ? { ...jam, guru_pengganti: newValue }
            : jam
        )
      )

      if (isCanceling) {
        pushToast('info', 'Anda membatalkan pengambilan jam ini.')
      } else {
        pushToast('success', 'Berhasil mengambil jam kosong!')
      }
    } catch (error) {
      console.error('Error updating jam kosong:', error)
      pushToast('error', 'Gagal memperbarui status jam kosong')
    } finally {
      setLoading(false)
    }
  }

  const formatWaktu = (waktu) => (waktu ? String(waktu).slice(0, 5) : '-')

  const handleViewSertifikat = (sertifikat) => {
    setSelectedSertifikat(sertifikat)
    setShowSertifikatOverlay(true)
  }

  const handleDownloadSertifikat = async (sertifikat) => {
    try {
      setLoading(true)
      const resolvedUrl =
        getCertificateDisplayUrl(sertifikat) ||
        (await resolveCertificateFileUrl(sertifikat?.file_url))
      if (!resolvedUrl) throw new Error('File sertifikat tidak ditemukan')

      const response = await fetch(resolvedUrl, { credentials: 'include' })
      if (!response.ok) throw new Error('File sertifikat tidak dapat diakses')
      const blob = await response.blob()

      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.style.display = 'none'
      a.href = url

      const fileExtensionSource = String(sertifikat.file_url || resolvedUrl).split('?')[0]
      const fileExtension = fileExtensionSource.split('.').pop() || 'pdf'
      const fileName = `Sertifikat_${sertifikat.event}_${sertifikat.nama_penerima}.${fileExtension}`

      a.download = fileName
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)

      pushToast('success', 'Sertifikat berhasil diunduh')
    } catch (error) {
      console.error('Error downloading sertifikat:', error)
      pushToast('error', 'Gagal mengunduh sertifikat')
    } finally {
      setLoading(false)
    }
  }

  const handleEskulClick = (eskul) => {
    setSelectedEskul(eskul)
    setShowAbsensiOverlay(true)
  }

  const handleOrganisasiClick = (organisasi) => {
    setSelectedOrganisasi(organisasi)
    setShowOrganisasiOverlay(true)
  }

  const handleRiwayatSertifikat = () => {
    setShowRiwayatSertifikatOverlay(true)
  }

  const closeAbsensiOverlay = () => {
    setShowAbsensiOverlay(false)
    setSelectedEskul(null)
  }

  const closeOrganisasiOverlay = () => {
    setShowOrganisasiOverlay(false)
    setSelectedOrganisasi(null)
  }

  const closeSertifikatOverlay = () => {
    setShowSertifikatOverlay(false)
    setSelectedSertifikat(null)
  }

  const closeRiwayatSertifikatOverlay = () => {
    setShowRiwayatSertifikatOverlay(false)
  }

  const displayedSertifikat = sertifikatList.slice(0, 5)

  const tanggungJawabCard = (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
      <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
        <span>🏆</span> Tanggung Jawab Lain
      </h3>

      <div className="space-y-4">
        {/* Ekskul */}
        <div>
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
            Ekstrakurikuler ({eskulDiampu.length})
          </h4>
          {eskulDiampu.length > 0 ? (
            <div className="space-y-2">
              {eskulDiampu.map(e => (
                <div
                  key={e.id}
                  onClick={() => handleEskulClick(e)}
                  className="p-3 rounded-lg bg-purple-50 border border-purple-100 hover:border-purple-300 hover:shadow-md transition-all cursor-pointer group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-purple-900 group-hover:text-purple-700">
                      {e.nama}
                    </span>
                    <span className="text-xs text-purple-700 bg-white px-2 py-0.5 rounded border border-purple-100 font-medium">
                      {e.hari || '-'}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-purple-600">
                    <div className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>{formatWaktu(e.jam_mulai)} - {formatWaktu(e.jam_selesai)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2a4.978 4.978 0 00-.869-2.773M7 20v-2a4.978 4.978 0 01.869-2.773M12 11a3 3 0 100-6 3 3 0 000 6zm5 0a3 3 0 10-6 0 3 3 0 006 0z" />
                      </svg>
                      <span>{e.jumlah_anggota} Anggota</span>
                    </div>
                  </div>

                  <div className="mt-2 pt-2 border-t border-purple-100">
                    <button className="text-xs text-purple-600 hover:text-purple-800 font-medium flex items-center gap-1">
                      <span>📝 Klik untuk Absensi</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400 italic">Tidak ada ekskul</p>}
        </div>

        <hr className="border-gray-100" />

        {/* Organisasi */}
        <div>
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
            Organisasi ({organisasiDiampu.length})
          </h4>
          {organisasiDiampu.length > 0 ? (
            <div className="space-y-2">
              {organisasiDiampu.map(o => (
                <div
                  key={o.id}
                  onClick={() => handleOrganisasiClick(o)}
                  className="flex items-center justify-between p-3 rounded-lg bg-emerald-50 border border-emerald-100 hover:border-emerald-300 hover:shadow-md transition-all cursor-pointer group"
                >
                  <div>
                    <span className="text-sm font-semibold text-emerald-900 group-hover:text-emerald-700">
                      {o.nama}
                    </span>
                    <div className="mt-1">
                      <button className="text-xs text-emerald-600 hover:text-emerald-800 font-medium flex items-center gap-1">
                        <span>👥 Klik untuk lihat detail</span>
                      </button>
                    </div>
                  </div>
                  <span className="text-xs text-emerald-700 font-medium bg-white px-2 py-1 rounded border border-emerald-100">
                    {o.jumlah_anggota} Anggota
                  </span>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400 italic">Tidak ada organisasi</p>}
        </div>
      </div>
    </div>
  )

  const monitoringJamKosongCard = (
    <div className="bg-white rounded-2xl shadow-md border border-gray-200 flex flex-col max-h-[500px]">
      <div className="p-6 border-b border-gray-100">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
              </span>
              Monitoring Jam Kosong
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Data real-time pengajuan jam kosong hari ini ({todayName}).
            </p>
          </div>

          <div className="flex gap-3">
            <div className="bg-red-50 border border-red-100 px-4 py-2 rounded-xl text-center">
              <div className="text-xs text-red-600 font-bold uppercase">Perlu Guru</div>
              <div className="text-lg font-bold text-red-700 leading-none">
                {jamKosongHariIni.filter(j => !j.guru_pengganti).length}
              </div>
            </div>
            <div className="bg-green-50 border border-green-100 px-4 py-2 rounded-xl text-center">
              <div className="text-xs text-green-600 font-bold uppercase">Teratasi</div>
              <div className="text-lg font-bold text-green-700 leading-none">
                {jamKosongHariIni.filter(j => j.guru_pengganti).length}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 bg-gray-50/30 flex-1 overflow-auto">
        {jamKosongHariIni.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {jamKosongHariIni.map((item) => {
              const isHandled = !!item.guru_pengganti
              const isMe = item.guru_pengganti === (profile?.nama || user?.email)

              return (
                <div
                  key={item.id}
                  className={`relative p-5 rounded-xl border-2 transition-all duration-200 flex flex-col justify-between group ${
                    isHandled
                      ? 'bg-white border-green-200'
                      : 'bg-white border-red-200 shadow-lg shadow-red-100 hover:-translate-y-1'
                  }`}
                >
                  <div className={`absolute top-0 right-0 px-3 py-1 rounded-bl-xl rounded-tr-lg text-[10px] font-bold tracking-wide uppercase ${
                    isHandled ? 'bg-green-100 text-green-700' : 'bg-red-500 text-white'
                  }`}>
                    {isHandled ? 'Sudah Ada Guru' : 'Butuh Pengganti'}
                  </div>

                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="bg-gray-100 text-gray-700 text-xs font-bold px-2 py-0.5 rounded">
                        {formatWaktu(item.jam_mulai)} - {formatWaktu(item.jam_selesai)}
                      </span>
                      <span className="text-gray-400 text-xs">•</span>
                      <span className="font-bold text-blue-600 text-sm">
                        Kelas {getNamaKelasFromList(item.kelas, kelasList)}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-gray-800 leading-tight mb-2">
                      {item.mapel}
                    </h3>

                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 text-sm space-y-1">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Pengajar:</span>
                        <span className="font-medium text-gray-800">{item.guru_pengaju}</span>
                      </div>
                      <div className="flex justify-between items-start">
                        <span className="text-gray-500 shrink-0">Alasan:</span>
                        <span className="font-medium text-gray-800 text-right line-clamp-2">{item.alasan}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 pt-3 border-t border-gray-100">
                    {isHandled ? (
                      isMe ? (
                        <button
                          onClick={() => handleToggleJamKosong(item.id, item.guru_pengganti)}
                          className="w-full py-2.5 px-4 bg-orange-100 hover:bg-orange-200 text-orange-700 border border-orange-300 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          Batalkan (Saya Penggantinya)
                        </button>
                      ) : (
                        <div className="flex items-center gap-2 text-green-700 bg-green-50 p-2 rounded-lg justify-center">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="text-sm font-semibold">
                            Digantikan oleh: {item.guru_pengganti}
                          </span>
                        </div>
                      )
                    ) : (
                      <button
                        onClick={() => handleToggleJamKosong(item.id, null)}
                        className="w-full py-2.5 px-4 bg-red-500 hover:bg-red-600 active:bg-red-700 text-white rounded-lg font-semibold text-sm transition-colors shadow-md shadow-red-200 flex items-center justify-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                        </svg>
                        Ambil Jam Ini
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center p-10 bg-white rounded-xl border border-dashed border-gray-300">
            <div className="w-24 h-24 bg-green-50 rounded-full flex items-center justify-center mb-5 animate-pulse">
              <svg className="w-12 h-12 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-800">Semua Aman!</h3>
            <p className="text-gray-500 mt-2 max-w-sm">
              Belum ada laporan jam kosong untuk hari {todayName} ini. Semua kelas berjalan kondusif.
            </p>
          </div>
        )}
      </div>
    </div>
  )

  // --- RENDER ---
  return (
    <div className="min-h-screen bg-gray-50/50 p-4 md:p-6 pb-20">
      <div className="w-full space-y-6">

        {/* HEADER */}
        <div className="page-title-card relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-blue-50 rounded-full blur-3xl -mr-16 -mt-16 opacity-50 pointer-events-none"></div>

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
            <div className="flex items-start gap-5">
              <div className="p-3.5 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-2xl shadow-lg shadow-blue-500/20 text-white shrink-0">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h1 className="page-title-heading">Dashboard Mengajar</h1>
                <p className="page-title-description font-medium">
                  Selamat Datang, <span className="text-blue-600">{profile?.nama || 'Guru'}</span>
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {profile?.jabatan && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-100">
                      🏅 {profile.jabatan}
                    </span>
                  )}
                  {strukturJabatan.map(s => (
                    <span key={s.id} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
                      🏛️ {s.jabatan}
                    </span>
                  ))}
                  {waliKelasSaya.map(w => (
                    <span key={w.kelas_id} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-orange-50 text-orange-700 border border-orange-100">
                      👨‍🏫 Wali Kelas {getNamaKelasFromList(w.kelas_id, kelasList) || w.kelas_id}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
              <div className="bg-gray-900 text-white px-5 py-3 rounded-xl shadow-lg flex flex-col items-center justify-center min-w-[140px]">
                <div className="text-2xl font-mono font-bold leading-none">
                  {currentTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="text-[10px] text-gray-400 font-medium tracking-wider mt-1 uppercase">
                  {todayName}, {formatDateIndo(todayStr)}
                </div>
              </div>

              <button
                onClick={() => {
                  loadSemuaJamKosongHariIni()
                  pushToast('info', 'Data diperbarui')
                }}
                className="group flex items-center justify-center gap-2 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 px-5 py-3 rounded-xl font-semibold transition-all shadow-sm hover:shadow-md active:scale-95"
              >
                <svg className="w-5 h-5 text-gray-500 group-hover:text-blue-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Refresh Data</span>
              </button>
            </div>
          </div>
        </div>

        {/* GRID UTAMA */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">

          {/* KOLOM KIRI */}
          <div className="xl:col-span-4 space-y-6">
            {/* Jadwal Mengajar */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-[600px]">
              <div className="p-5 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                  <span>📚</span> Jadwal Mengajar
                </h3>
                <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-1 rounded-md">
                  {filteredJadwal.length} Mapel
                </span>
              </div>

              <div className="p-4 flex-1 overflow-hidden flex flex-col">
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide mb-2">
                  {hariList.map(hari => (
                    <button
                      key={hari}
                      onClick={() => setActiveHari(hari)}
                      className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                        activeHari === hari
                          ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-500/20'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {hari}
                    </button>
                  ))}
                </div>

                <div className="overflow-y-auto space-y-3 pr-1 pb-2 flex-1 scrollbar-thin scrollbar-thumb-gray-200">
                  {filteredJadwal.length > 0 ? (
                    filteredJadwal.map((j) => (
                      <div key={j.id} className={`group p-4 rounded-xl border transition-all ${
                        j.hari === todayName
                          ? 'bg-blue-50/50 border-blue-100 hover:border-blue-300'
                          : 'bg-white border-gray-100 hover:border-gray-300'
                      }`}>
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="font-bold text-gray-800 line-clamp-1">{j.mapel}</h4>
                          <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded border border-gray-200 font-medium">
                            {formatWaktu(j.jam_mulai)} - {formatWaktu(j.jam_selesai)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span className="font-semibold text-gray-700">
                            Kls {getNamaKelasFromList(j.kelas_id, kelasList)}
                          </span>
                          <span>•</span>
                          <span>{j.hari}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center p-6 text-gray-400">
                      <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-3">☕</div>
                      <p className="text-sm">Tidak ada jadwal pada hari ini.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {monitoringJamKosongCard}

            {/* Struktur Sekolah */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
              <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                <span>🏛️</span> Struktur Sekolah
              </h3>

              <div className="space-y-3">
                {strukturSekolah.length > 0 ? (
                  strukturSekolah.map((struktur, index) => (
                    <div
                      key={struktur.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 hover:border-blue-300 transition-all group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-sm">
                          {index + 1}
                        </div>
                        <div>
                          <h4 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                            {struktur.jabatan}
                          </h4>
                          <p className="text-sm text-gray-600">
                            {struktur.guru_nama || '—'}
                          </p>
                        </div>
                      </div>
                      <div className="text-xs text-blue-600 bg-white px-2 py-1 rounded border border-blue-100 font-medium">
                        Jabatan
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-6 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                    <div className="text-gray-300 text-4xl mb-2">🏛️</div>
                    <p className="text-gray-500 text-sm">Data struktur sekolah belum tersedia</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* KOLOM KANAN */}
          <div className="xl:col-span-8 space-y-6">
            {/* Pengumuman */}
            {pengumumanList.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-4 flex items-center justify-between">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <span>📢</span> Pengumuman Terbaru
                  </h2>
                </div>

                <div className="p-5">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {pengumumanList.map((p) => (
                      <div key={p.id} className="group flex flex-col justify-between bg-white border border-gray-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-md transition-all duration-200">
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase border ${
                              p.target === 'guru'
                                ? 'bg-purple-50 text-purple-700 border-purple-100'
                                : 'bg-blue-50 text-blue-700 border-blue-100'
                            }`}>
                              {p.target === 'semua' ? 'Semua' : 'Guru'}
                            </span>
                            <span className="text-xs text-gray-400">
                              {new Date(p.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                            </span>
                          </div>
                          <h3 className="font-bold text-gray-900 mb-2 break-words group-hover:text-blue-600 transition-colors">
                            {p.judul}
                          </h3>
                          <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line break-words max-h-60 overflow-y-auto pr-1">
                            {p.keterangan}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tanggungJawabCard}

            {/* Sertifikat Saya */}
            <div className="bg-white rounded-2xl shadow-md border border-gray-200">
              <div className="p-6 border-b border-gray-100">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                      <span>🏆</span> Sertifikat Saya
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                      {sertifikatList.length > 5
                        ? `Menampilkan 5 dari ${sertifikatList.length} sertifikat`
                        : `${sertifikatList.length} sertifikat`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="bg-amber-100 text-amber-700 text-xs font-bold px-3 py-1 rounded-full">
                      {sertifikatList.length} Total
                    </span>
                    {sertifikatList.length > 5 && (
                      <button
                        onClick={handleRiwayatSertifikat}
                        className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 px-3 py-1 bg-blue-50 rounded-lg border border-blue-100 hover:bg-blue-100 transition-colors"
                      >
                        <span>Lihat Riwayat</span>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-6">
                {displayedSertifikat.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {displayedSertifikat.map((sertifikat) => (
                      <div
                        key={sertifikat.id}
                        className="border border-gray-200 rounded-xl p-4 hover:border-amber-300 hover:shadow-md transition-all cursor-pointer group"
                        onClick={() => handleViewSertifikat(sertifikat)}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <h3 className="font-bold text-gray-900 line-clamp-2 group-hover:text-amber-600 transition-colors">
                              {sertifikat.event}
                            </h3>
                            <p className="text-sm text-gray-600 mt-1">
                              {sertifikat.nama_penerima}
                            </p>
                          </div>
                          <span className={`text-xs px-2 py-1 rounded-full ${
                            sertifikat.sent
                              ? 'bg-green-100 text-green-700 border border-green-200'
                              : 'bg-yellow-100 text-yellow-700 border border-yellow-200'
                          }`}>
                            {sertifikat.sent ? 'Terkirim' : 'Pending'}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span>
                            {new Date(sertifikat.issued_at).toLocaleDateString('id-ID', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric'
                            })}
                          </span>
                          <div className="flex gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDownloadSertifikat(sertifikat)
                              }}
                              className="text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              Download
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300">
                    <div className="text-gray-300 text-6xl mb-4">🏆</div>
                    <p className="text-gray-500 text-lg font-medium">Belum ada sertifikat</p>
                    <p className="text-gray-400 mt-2">Sertifikat akan muncul di sini setelah diterbitkan oleh admin</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Overlay Absensi Eskul */}
      {showAbsensiOverlay && selectedEskul && (
        <AbsensiEskulOverlay
          eskul={selectedEskul}
          onClose={closeAbsensiOverlay}
          siswaMap={siswaMap}
        />
      )}

      {/* Overlay Detail Organisasi */}
      {showOrganisasiOverlay && selectedOrganisasi && (
        <OrganisasiDetailOverlay
          organisasi={selectedOrganisasi}
          onClose={closeOrganisasiOverlay}
          siswaMap={siswaMap}
        />
      )}

      {/* Overlay Detail Sertifikat */}
      {showSertifikatOverlay && selectedSertifikat && (
        <SertifikatDetailOverlay
          sertifikat={selectedSertifikat}
          onClose={closeSertifikatOverlay}
          onDownload={handleDownloadSertifikat}
        />
      )}

      {/* Overlay Riwayat Sertifikat */}
      {showRiwayatSertifikatOverlay && (
        <RiwayatSertifikatOverlay
          sertifikatList={sertifikatList}
          onClose={closeRiwayatSertifikatOverlay}
          onViewDetail={handleViewSertifikat}
          onDownload={handleDownloadSertifikat}
        />
      )}
    </div>
  )
}
