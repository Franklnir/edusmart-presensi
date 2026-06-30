// src/pages/siswa/SAbsensi.jsx
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef
} from 'react'
import { useSearchParams } from 'react-router-dom'
import { QrCode } from 'lucide-react'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import AcademicPeriodArchiveFilter from '../../components/AcademicPeriodArchiveFilter'
import useStudentPeriodClass from '../../hooks/useStudentPeriodClass'
import Badge from '../../features/attendance/components/AttendanceBadge'
import CalendarOverlay from '../../features/attendance/components/CalendarOverlay'
import JadwalCard from '../../features/attendance/components/JadwalCard'
import MapelOptions from '../../features/attendance/components/MapelOptions'
import { QrScannerPanel, QrSuccessOverlay } from '../../features/attendance/components/QrAttendanceScanner'
import RealTimeClock from '../../features/attendance/components/RealTimeClock'
import RingkasanKelasTable from '../../features/attendance/components/RingkasanKelasTable'
import { useAttendanceAcademicPeriod } from '../../features/attendance/hooks/useAttendanceAcademicPeriod'
import { useAttendanceRfidSettings } from '../../features/attendance/hooks/useAttendanceRfidSettings'
import { useStudentAttendanceActions } from '../../features/attendance/hooks/useStudentAttendanceActions'
import { useStudentAttendanceData } from '../../features/attendance/hooks/useStudentAttendanceData'
import { useStudentAttendanceRealtime } from '../../features/attendance/hooks/useStudentAttendanceRealtime'
import { useStudentRfidAttendanceListener } from '../../features/attendance/hooks/useStudentRfidAttendanceListener'
import {
  SEMESTER_OPTIONS,
  getAcademicYearOptions,
  getCurrentDateTime,
  getDayName,
  getToday,
  normalizePeriodFilter
} from '../../features/attendance/utils/attendanceDate'

/* ======================= MAIN COMPONENT ======================= */
export default function SAbsensi() {
  const { profile, user } = useAuthStore()
  const { pushToast } = useUIStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const userId = profile?.id || user?.id

  // State utama
  const [currentTime, setCurrentTime] = useState(new Date())
  const [currentDateTime, setCurrentDateTime] = useState(getCurrentDateTime())
  const {
    academicPeriodPayload,
    activeAcademicPeriod,
    academicYearOptions,
    periodFilter,
    resetToActivePeriod,
    semesterOptions,
    setAcademicYear,
    setSemester,
  } = useAttendanceAcademicPeriod()

  const [tab, setTab] = useState('manual')
  const [mapel, setMapel] = useState('')
  const [tgl, setTgl] = useState(getToday())
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Calendar overlay
  const [showCalendarOverlay, setShowCalendarOverlay] = useState(false)
  const [selectedMapelForCalendar, setSelectedMapelForCalendar] = useState('')

  // RFID
  const [rfidListening, setRfidListening] = useState(false)
  const { isInRfidTimeRange } = useAttendanceRfidSettings(currentDateTime.minutes)

  const loadErrorToastRef = useRef({})

  const pushLoadErrorToast = useCallback((key, message) => {
    const now = Date.now()
    const lastShownAt = loadErrorToastRef.current[key] || 0
    if (now - lastShownAt < 8000) return
    loadErrorToastRef.current[key] = now
    pushToast('error', message)
  }, [pushToast])

  const activeProfileClass = profile?.kelas || profile?.kelas_id || ''
  const periodClass = useStudentPeriodClass({
    userId,
    profile,
    tahunAjaran: periodFilter.tahunAjaran
  })

  const attendanceProfile = useMemo(() => (
    profile
      ? { ...profile, kelas: periodClass || activeProfileClass }
      : profile
  ), [activeProfileClass, periodClass, profile])

  const {
    currentJadwal,
    currentJadwalIndex,
    hariOrder,
    isAbsenOpen,
    isLoadingJadwalMinggu,
    izinAvailability,
    jadwalHariIni,
    jadwalMingguIni,
    jadwalRef,
    loadJadwalHariIni,
    loadRingkasDanStatus,
    loadStatistikKehadiran,
    refreshFnsRef,
    setCurrentJadwal,
    setCurrentJadwalIndex,
    setStatus,
    status,
    statusRef,
  } = useStudentAttendanceData({
    currentMinutes: currentDateTime.minutes,
    mapel,
    periodFilter,
    profile: attendanceProfile,
    pushLoadErrorToast,
    setIsSubmitting,
    setMapel,
    tab,
    tgl,
    userId,
  })

  useStudentAttendanceRealtime({
    loadJadwalHariIni,
    loadRingkasDanStatus,
    loadStatistikKehadiran,
    mapel,
    profile: attendanceProfile,
    tgl,
    userId,
  })

  useStudentRfidAttendanceListener({
    academicPeriodPayload,
    isInRfidTimeRange,
    jadwalRef,
    profile: attendanceProfile,
    pushToast,
    refreshFnsRef,
    setCurrentJadwal,
    setCurrentJadwalIndex,
    setMapel,
    setRfidListening,
    setStatus,
    setTgl,
    userId,
  })

  const {
    ajukanIzin,
    handleQrScanToken,
    isIzinModalOpen,
    isManualAbsenAllowed,
    isQrSubmitting,
    izinReason,
    qrScanError,
    qrSuccessData,
    setIsIzinModalOpen,
    setIzinReason,
    setQrSuccessData,
    submit,
  } = useStudentAttendanceActions({
    academicPeriodPayload,
    currentJadwal,
    currentMinutes: currentDateTime.minutes,
    isAbsenOpen,
    isSubmitting,
    izinAvailability,
    jadwalRef,
    loadJadwalHariIni,
    loadRingkasDanStatus,
    loadStatistikKehadiran,
    mapel,
    profile: attendanceProfile,
    pushToast,
    refreshFnsRef,
    setCurrentJadwal,
    setCurrentJadwalIndex,
    setIsSubmitting,
    setMapel,
    setStatus,
    setTgl,
    statusRef,
    tgl,
    userId,
  })

  /* ========== Real-time Clock Global ========== */
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date()
      setCurrentTime(now)
      setCurrentDateTime(getCurrentDateTime())
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!profile || !userId) return

    const tokenFromUrl =
      searchParams.get('qr') ||
      searchParams.get('token') ||
      searchParams.get('attendance_qr')

    if (!tokenFromUrl) return

    setTab('qr')
    void handleQrScanToken(tokenFromUrl)

    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('qr')
    nextParams.delete('token')
    nextParams.delete('attendance_qr')
    setSearchParams(nextParams, { replace: true })
  }, [profile, userId, searchParams, setSearchParams, handleQrScanToken])

  /* ========== Aksi dari Card Jadwal ========== */
  const handleAbsenFromCard = (jadwal) => {
    setMapel(jadwal.mapel)
    setTab('manual')
    setTimeout(() => submit('Hadir'), 100)
  }

  const handleCalendarClick = (jadwal) => {
    setSelectedMapelForCalendar(jadwal.mapel)
    setShowCalendarOverlay(true)
  }

  const isHadirActionDisabled =
    !mapel ||
    !!status ||
    isSubmitting ||
    !isAbsenOpen ||
    !currentJadwal?.allow_self_absen ||
    !isManualAbsenAllowed()

  const isIzinActionDisabled = isSubmitting || !izinAvailability.allowed

  /* ========== Loading Profile ========== */
  if (!profile) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-purple-50/30 p-4 flex items-center justify-center">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center max-w-md w-full shadow-sm">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-600 font-medium">Memuat data...</p>
        </div>
      </div>
    )
  }

  /* ======================= RENDER ======================= */
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-purple-50/30 p-4 sm:p-6">
      <QrSuccessOverlay data={qrSuccessData} onClose={() => setQrSuccessData(null)} />
      <div className="max-w-full mx-auto space-y-6">
        {/* Header */}
        <div className="page-title-card">
          <div className="page-title-layout">
            <div className="page-title-main">
              <div className="page-title-icon bg-blue-100 text-blue-700">✓</div>
              <div>
                <h1 className="page-title-heading">Absensi Siswa</h1>
                <p className="page-title-description">
                  {attendanceProfile?.kelas || '-'} • {profile.nama}
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Status kelas ditampilkan sesuai mapel dan tanggal yang dipilih.
                </p>
              </div>
            </div>

            <div className="page-title-actions">
              {/* Jam Realtime + info RFID */}
              <div className="flex flex-col gap-1">
                <RealTimeClock />
                {profile?.rfid_uid && (
                  <div className="text-xs text-slate-600 bg-white rounded-2xl px-3 py-2 border border-slate-200 flex items-center gap-2 shadow-sm">
                    <span className="text-green-600">💳</span>
                    <div className="flex-1">
                      <div className="font-medium">
                        RFID: {(profile.rfid_uid || '').toUpperCase()}
                      </div>
                      <div
                        className={`text-[10px] ${rfidListening ? 'text-green-600' : 'text-red-500'
                          }`}
                      >
                        {rfidListening ? 'Siap scan' : 'Tidak terhubung'}
                      </div>
                      <div className="text-[10px] text-blue-600 font-medium">
                        RFID selalu aktif
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm transition-all duration-300 hover:shadow-md">
          <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-gray-50 to-white">
            <div className="flex items-center gap-3">
              <div className="w-2 h-8 bg-indigo-600 rounded-full"></div>
              <h2 className="text-xl font-bold text-slate-900">Menu Absensi</h2>
            </div>
          </div>
          <div className="border-b border-slate-200">
            <div className="flex gap-2 px-3 pt-2">
              <button
                className={`px-3 py-2 font-medium border-b-2 rounded-t-2xl transition-all duration-200 flex items-center space-x-1 text-sm ${tab === 'manual'
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                  }`}
                onClick={() => setTab('manual')}
              >
                <span>📝</span>
                <span>Absen Manual</span>
              </button>
              <button
                className={`px-3 py-2 font-medium border-b-2 rounded-t-2xl transition-all duration-200 flex items-center gap-1.5 text-sm ${tab === 'qr'
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                  }`}
                onClick={() => setTab('qr')}
              >
                <QrCode className="h-4 w-4" />
                <span>Scan QR</span>
              </button>
              <button
                className={`px-3 py-2 font-medium border-b-2 rounded-t-2xl transition-all duration-200 flex items-center space-x-1 text-sm ${tab === 'jadwal'
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                  }`}
                onClick={() => setTab('jadwal')}
              >
                <span>📅</span>
                <span>Jadwal</span>
              </button>
            </div>
          </div>

          <div className="p-3">
            {/* === TAB MANUAL === */}
            {tab === 'manual' && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
                  {/* Filter */}
                  <div className="xl:col-span-3 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition-all duration-300 hover:shadow-md">
                    <div className="px-4 py-3 border-b border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-7 bg-blue-600 rounded-full"></div>
                        <h3 className="font-semibold text-base text-slate-900">
                          Pilih Mapel & Tanggal
                        </h3>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-1 ml-5">
                        Pilih mata pelajaran yang diajar hari itu, lalu lakukan absensi.
                      </p>
                    </div>
                    <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-end">
                      <AcademicPeriodArchiveFilter
                        activeAcademicPeriod={activeAcademicPeriod}
                        periodFilter={periodFilter}
                        academicYearOptions={academicYearOptions}
                        semesterOptions={semesterOptions}
                        setAcademicYear={setAcademicYear}
                        setSemester={setSemester}
                        resetToActivePeriod={resetToActivePeriod}
                        title="Periode Absensi"
                        className="min-w-0 md:col-span-2 xl:col-span-1"
                        compact
                      />
                      <div className="min-w-0">
                        <label className="block text-[11px] font-semibold tracking-wide text-slate-600 uppercase mb-1.5">
                          Tanggal Absen
                        </label>
                        <div className="flex min-w-0 gap-2">
                          <input
                            type="date"
                            className="sismu-toolbar-control min-w-0 flex-1 border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white text-sm"
                            value={tgl}
                            onChange={(e) => setTgl(e.target.value)}
                            max={getToday()}
                          />
                          <button
                            type="button"
                            onClick={() => setTgl(getToday())}
                            className="sismu-toolbar-button shrink-0 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shadow-sm"
                          >
                            Hari Ini
                          </button>
                        </div>
                      </div>
                      <div className="min-w-0">
                        <label className="block text-[11px] font-semibold tracking-wide text-slate-600 uppercase mb-1.5">
                          Mata Pelajaran
                        </label>
                        <select
                          className="sismu-toolbar-control w-full min-w-0 border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white text-sm"
                          value={mapel}
                          onChange={(e) => setMapel(e.target.value)}
                        >
                          <option value="">— Pilih Mapel —</option>
                          {attendanceProfile?.kelas && (
                            <MapelOptions
                              kelas={attendanceProfile.kelas}
                              tanggal={tgl}
                              periodFilter={periodFilter}
                            />
                          )}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Status sesi hari ini */}
                  <div
                    className={`xl:col-span-2 rounded-2xl border p-4 shadow-sm transition-all duration-200 ${currentJadwal && tgl === getToday()
                      ? isAbsenOpen && currentJadwal.allow_self_absen
                        ? 'bg-green-50 border-green-200 text-green-900'
                        : currentJadwalIndex !== -1
                          ? 'bg-blue-50 border-blue-200 text-blue-900'
                          : 'bg-slate-50 border-slate-200 text-slate-800'
                      : 'bg-slate-50 border-slate-200 text-slate-800'
                      }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-sm flex items-center gap-2">
                          <span>🛰️</span>
                          <span>Status Sesi Hari Ini</span>
                        </h3>
                        <p className="text-[11px] mt-1 opacity-80">
                          {tgl === getToday()
                            ? 'Update real-time berdasarkan jadwal aktif.'
                            : 'Status sesi detail tampil untuk tanggal hari ini.'}
                        </p>
                      </div>
                      {tgl === getToday() && currentJadwal ? (
                        isAbsenOpen && currentJadwal.allow_self_absen ? (
                          <Badge variant="live" className="text-[10px] shrink-0">
                            MANDIRI DIBUKA
                          </Badge>
                        ) : currentJadwalIndex !== -1 ? (
                          <Badge variant="info" className="text-[10px] shrink-0">
                            JADWAL AKTIF
                          </Badge>
                        ) : (
                          <Badge variant="warning" className="text-[10px] shrink-0">
                            MANDIRI DITUTUP
                          </Badge>
                        )
                      ) : null}
                    </div>

                    {currentJadwal && tgl === getToday() ? (
                      <div className="mt-3 space-y-2 text-xs">
                        <div className="font-semibold text-sm">{currentJadwal.mapel}</div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-xl bg-white/70 border border-white px-2.5 py-2">
                            <div className="text-[10px] uppercase tracking-wide opacity-70">Jam</div>
                            <div className="font-medium mt-0.5">
                              {currentJadwal.jam_mulai} - {currentJadwal.jam_selesai}
                            </div>
                          </div>
                          <div className="rounded-xl bg-white/70 border border-white px-2.5 py-2">
                            <div className="text-[10px] uppercase tracking-wide opacity-70">Absen Mandiri</div>
                            <div className="font-medium mt-0.5">
                              {currentJadwal.allow_self_absen ? 'Dibuka Guru' : 'Ditutup Guru'}
                            </div>
                          </div>
                        </div>
                        {currentJadwal.guru_nama && (
                          <div className="text-[11px] opacity-90">
                            Guru: <span className="font-semibold">{currentJadwal.guru_nama}</span>
                          </div>
                        )}
                        {profile?.rfid_uid && (
                          <div className="text-[11px] opacity-90">
                            RFID: <span className="font-semibold">SELALU AKTIF</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-3 text-xs text-slate-600">
                        Belum ada sesi aktif yang bisa ditampilkan untuk pilihan saat ini.
                      </div>
                    )}
                  </div>
                </div>

                {/* Ringkasan kelas */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition-all duration-300 hover:shadow-md">
                  <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-gray-50 to-white flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-7 bg-emerald-600 rounded-full"></div>
                      <h3 className="font-semibold text-base text-slate-900">
                        Status Kehadiran Kelas
                      </h3>
                    </div>
                    <Badge variant="live" className="text-[10px]">Live</Badge>
                  </div>

                  <div className="p-4">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      {status ? (
                        <Badge
                          variant={
                            status === 'Hadir'
                              ? 'hadir'
                              : status === 'Izin'
                                ? 'izin'
                                : status === 'Sakit'
                                  ? 'sakit'
                                  : 'alpha'
                          }
                        >
                          Status Anda: {status}
                        </Badge>
                      ) : (
                        <Badge variant="warning">
                          Status Anda: Belum Absen
                        </Badge>
                      )}
                      {profile?.rfid_uid && (
                        <span className="text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-1">
                          RFID SELALU AKTIF
                        </span>
                      )}
                    </div>

                    <RingkasanKelasTable
                      kelas={attendanceProfile?.kelas}
                      mapel={mapel}
                      tanggal={tgl}
                      selfUserId={userId}
                      canClickHadir={!isHadirActionDisabled}
                      canClickIzin={!isIzinActionDisabled}
                      izinDisabledReason={izinAvailability.reason}
                      onHadir={() => submit('Hadir')}
                      onIzin={() => setIsIzinModalOpen(true)}
                      periodFilter={periodFilter}
                      academicPeriod={activeAcademicPeriod}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* === TAB QR === */}
            {tab === 'qr' && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 grid place-items-center">
                        <QrCode className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900">Absensi QR</h3>
                        <p className="text-xs text-slate-500">
                          Scan QR dari guru saat jam pelajaran sedang berlangsung.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={status === 'Hadir' ? 'hadir' : 'warning'}>
                        Status Anda: {status || 'Belum Absen'}
                      </Badge>
                      {mapel && <Badge variant="info">{mapel}</Badge>}
                    </div>
                  </div>
                </div>

                <QrScannerPanel
                  onSubmitToken={handleQrScanToken}
                  isSubmitting={isQrSubmitting}
                  lastError={qrScanError}
                />
              </div>
            )}

            {/* === TAB JADWAL === */}
            {tab === 'jadwal' && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="w-2 h-7 bg-indigo-600 rounded-full"></div>
                    <h3 className="font-semibold text-base text-slate-800">
                      Jadwal Pelajaran Minggu Ini
                    </h3>
                  </div>
                  <p className="text-slate-600 text-xs font-medium">
                    {getDayName(getToday())},{' '}
                    {new Date().toLocaleDateString('id-ID', {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric'
                    })}
                  </p>
                </div>

                {isLoadingJadwalMinggu ? (
                  <div className="text-center py-8">
                    <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-slate-600 text-sm">Memuat jadwal...</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {hariOrder.map((hari) => {
                      const jadwalHari = jadwalMingguIni[hari] || []
                      const isHariIni = hari === getDayName(getToday())

                      return (
                        <div
                          key={hari}
                          className="border border-slate-200 rounded-2xl overflow-hidden"
                        >
                          <div
                            className={`px-4 py-3 border-b ${isHariIni
                              ? 'bg-blue-50 border-blue-200'
                              : 'bg-slate-50 border-slate-200'
                              }`}
                          >
                            <div className="flex items-center justify-between">
                              <h3
                                className={`font-semibold ${isHariIni
                                  ? 'text-blue-800'
                                  : 'text-slate-700'
                                  }`}
                              >
                                {hari}
                              </h3>
                              {isHariIni && (
                                <Badge variant="live" className="text-xs">
                                  HARI INI
                                </Badge>
                              )}
                            </div>
                          </div>

                          <div className="p-4">
                            {jadwalHari.length > 0 ? (
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                {jadwalHari.map((jadwal) => {
                                  const hydratedJadwal = isHariIni
                                    ? jadwalHariIni.find((j) => j.id === jadwal.id) || jadwal
                                    : jadwal
                                  const isCurrent =
                                    isHariIni &&
                                    jadwalHariIni.find((j) => j.id === jadwal.id) ===
                                    currentJadwal
                                  return (
                                    <JadwalCard
                                      key={jadwal.id}
                                      jadwal={hydratedJadwal}
                                      currentTime={currentTime}
                                      isCurrent={isCurrent}
                                      onAbsenClick={handleAbsenFromCard}
                                      onCalendarClick={handleCalendarClick}
                                    />
                                  )
                                })}
                              </div>
                            ) : (
                              <div className="text-center py-6 text-slate-500">
                                <div className="w-12 h-12 mx-auto mb-2 bg-slate-100 rounded-full flex items-center justify-center">
                                  <svg
                                    className="w-6 h-6 text-slate-400"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={1}
                                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                                    />
                                  </svg>
                                </div>
                                <div className="font-medium text-slate-600">
                                  Tidak ada jadwal untuk hari {hari}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal Izin */}
      {isIzinModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-5 w-full max-w-md shadow-2xl border border-slate-200">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 bg-yellow-100 rounded-2xl flex items-center justify-center text-yellow-600 text-sm">
                📝
              </div>
              <div>
                <div className="font-semibold text-slate-900 text-sm">
                  Ajukan Izin
                </div>
                <div className="text-slate-500 text-xs">
                  Masukkan alasan izin Anda
                </div>
              </div>
            </div>

            <div className="mb-3 space-y-2">
              <div className="text-xs text-slate-700 bg-slate-50 p-2 rounded-2xl border border-slate-200">
                <span className="font-medium">Mapel:</span> {mapel}
              </div>
              <div className="text-xs text-slate-700 bg-slate-50 p-2 rounded-2xl border border-slate-200">
                <span className="font-medium">Tanggal:</span> {tgl}
              </div>
              <textarea
                className="w-full px-3 py-2 border border-slate-300 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 resize-none bg-white text-xs"
                placeholder="Contoh: Sakit, acara keluarga, izin sakit, dll."
                value={izinReason}
                onChange={(e) => setIzinReason(e.target.value)}
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-2 border border-slate-300 text-slate-700 rounded-2xl hover:bg-slate-50 transition-all duration-200 font-medium text-xs"
                onClick={() => setIsIzinModalOpen(false)}
              >
                Batal
              </button>
              <button
                className={`px-3 py-2 rounded-2xl font-medium transition-all duration-200 text-xs ${isSubmitting
                  ? 'bg-slate-400 cursor-not-allowed text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                onClick={ajukanIzin}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <div className="flex items-center space-x-1">
                    <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Mengirim...</span>
                  </div>
                ) : (
                  'Ajukan Izin'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Calendar Overlay */}
      {showCalendarOverlay && (
        <CalendarOverlay
          mapel={selectedMapelForCalendar}
          jadwalMingguIni={jadwalMingguIni}
          onClose={() => setShowCalendarOverlay(false)}
          profile={attendanceProfile}
          userId={userId}
          periodFilter={periodFilter}
          academicPeriod={activeAcademicPeriod}
        />
      )}
    </div>
  )
}
