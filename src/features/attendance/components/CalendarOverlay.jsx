import React, { useEffect, useState } from 'react'
import { supabase } from '../../../services/storageService'
import { getDayName, resolveAcademicPeriod, SEMESTER_GENAP } from '../utils/attendanceDate'

export default function CalendarOverlay({
  mapel,
  jadwalMingguIni,
  onClose,
  profile,
  userId,
  periodFilter,
  academicPeriod
}) {
  const periodMonths = academicPeriod?.months?.length ? academicPeriod.months : resolveAcademicPeriod(periodFilter).months
  const currentMonthValue = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  const initialMonth = periodMonths.find((month) => month.value === currentMonthValue) || periodMonths[0]
  const [selectedMonthValue, setSelectedMonthValue] = useState(initialMonth?.value || currentMonthValue)
  const [absensiData, setAbsensiData] = useState({})
  const [isLoading, setIsLoading] = useState(false)

  const academicStartYear = Number(String(periodFilter?.tahunAjaran || '').slice(0, 4)) || new Date().getFullYear()
  const selectedMonthMeta = periodMonths.find((month) => month.value === selectedMonthValue) || initialMonth
  const selectedYear = Number(selectedMonthMeta?.year) || (periodFilter?.semester === SEMESTER_GENAP ? academicStartYear + 1 : academicStartYear)
  const selectedMonth = Number(selectedMonthMeta?.month) || Number(selectedMonthValue.slice(5, 7)) || (new Date().getMonth() + 1)
  const hariList = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

  const getJadwalHari = () => {
    const hariMapel = []
    Object.keys(jadwalMingguIni || {}).forEach((hari) => {
      if ((jadwalMingguIni[hari] || []).some((j) => j.mapel === mapel)) {
        hariMapel.push(hari)
      }
    })
    return hariMapel
  }

  const loadAbsensiBulanan = async () => {
    if (!mapel || !profile?.kelas || !userId) return

    setIsLoading(true)
    try {
      const startDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`
      const endDate = new Date(selectedYear, selectedMonth, 0)
        .toISOString()
        .split('T')[0]

      let query = supabase
        .from('absensi')
        .select('*')
        .eq('kelas', profile.kelas)
        .eq('mapel', mapel)
        .eq('uid', userId)
        .gte('tanggal', startDate)
        .lte('tanggal', endDate)

      if (periodFilter?.tahunAjaran) query = query.eq('tahun_ajaran', periodFilter.tahunAjaran)
      if (periodFilter?.semester) query = query.eq('semester', periodFilter.semester)

      const { data, error } = await query

      if (error) throw error

      const absensiMap = {}
      ; (data || []).forEach((item) => {
        absensiMap[item.tanggal] = item.status
      })

      setAbsensiData(absensiMap)
    } catch (error) {
      console.error('Error loading absensi bulanan:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadAbsensiBulanan()
  }, [selectedMonth, selectedYear, mapel, periodFilter?.semester, periodFilter?.tahunAjaran])

  const generateCalendar = () => {
    const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate()
    const firstDay = new Date(selectedYear, selectedMonth - 1, 1).getDay()
    const calendar = []
    const hariMapel = getJadwalHari()

    for (let i = 0; i < firstDay; i++) calendar.push(null)

    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(
        day
      ).padStart(2, '0')}`
      const dayName = getDayName(date)
      const hasJadwal = hariMapel.includes(dayName)
      const status = absensiData[date]

      let bgColor = 'bg-white'
      let textColor = 'text-slate-900'
      let borderColor = 'border-slate-200'

      if (hasJadwal) {
        if (status === 'Hadir') {
          bgColor = 'bg-green-100'
          borderColor = 'border-green-300'
          textColor = 'text-green-900'
        } else if (status === 'Alpha') {
          bgColor = 'bg-red-100'
          borderColor = 'border-red-300'
          textColor = 'text-red-900'
        } else if (status === 'Izin') {
          bgColor = 'bg-yellow-100'
          borderColor = 'border-yellow-300'
          textColor = 'text-yellow-900'
        } else if (status === 'Sakit') {
          bgColor = 'bg-blue-100'
          borderColor = 'border-blue-300'
          textColor = 'text-blue-900'
        } else {
          bgColor = 'bg-yellow-100'
          borderColor = 'border-yellow-300'
          textColor = 'text-yellow-900'
        }
      } else {
        bgColor = 'bg-slate-50'
        textColor = 'text-slate-500'
        borderColor = 'border-slate-100'
      }

      calendar.push({
        date,
        day,
        dayName,
        hasJadwal,
        status,
        bgColor,
        textColor,
        borderColor
      })
    }

    return calendar
  }

  const calendar = generateCalendar()

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-slate-900">
            Kalender Absensi - {mapel}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 text-2xl"
          >
            x
          </button>
        </div>

        <div className="mb-6">
          <div className="w-64">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Bulan
            </label>
            <select
              value={selectedMonthValue}
              onChange={(e) => setSelectedMonthValue(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {periodMonths.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-green-100 border border-green-300 rounded" />
            <span className="text-xs text-slate-600">Hadir</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-yellow-100 border border-yellow-300 rounded" />
            <span className="text-xs text-slate-600">Izin</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-blue-100 border border-blue-300 rounded" />
            <span className="text-xs text-slate-600">Sakit</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-red-100 border border-red-300 rounded" />
            <span className="text-xs text-slate-600">Alpha</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-yellow-100 border border-yellow-300 rounded" />
            <span className="text-xs text-slate-600">Belum Absen</span>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-8">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-slate-600 text-sm">Memuat data absensi...</p>
          </div>
        ) : (
          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200">
              {hariList.map((hari) => (
                <div
                  key={hari}
                  className="p-3 text-center text-sm font-medium text-slate-700 border-r border-slate-200 last:border-r-0"
                >
                  {hari}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {calendar.map((day, index) => (
                <div
                  key={index}
                  className={`min-h-[80px] p-2 border-b border-r border-slate-200 last:border-r-0 ${day ? day.bgColor : 'bg-slate-50'
                    } ${day?.borderColor || ''}`}
                >
                  {day && (
                    <div className="flex flex-col h-full">
                      <div className={`text-sm font-medium mb-1 ${day.textColor}`}>
                        {day.day}
                      </div>
                      {day.hasJadwal && (
                        <div className="mt-auto space-y-1">
                          {day.status && (
                            <div
                              className={`text-xs px-1 py-0.5 rounded ${day.status === 'Hadir'
                                ? 'bg-green-200 text-green-800'
                                : day.status === 'Alpha'
                                  ? 'bg-red-200 text-red-800'
                                  : day.status === 'Izin'
                                    ? 'bg-yellow-200 text-yellow-800'
                                    : day.status === 'Sakit'
                                      ? 'bg-blue-200 text-blue-800'
                                      : 'bg-yellow-200 text-yellow-800'
                                }`}
                            >
                              {day.status || 'Belum Absen'}
                            </div>
                          )}
                          {!day.status && (
                            <div className="text-xs text-yellow-700 bg-yellow-200 px-1 py-0.5 rounded">
                              Belum Absen
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded-2xl font-medium transition-colors"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  )
}
