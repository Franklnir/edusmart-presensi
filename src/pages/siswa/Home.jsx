import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'
import { supabase } from '../../lib/supabase'
import { useLocalCache } from '../../hooks/useLocalCache'

import { useUIStore } from '../../store/useUIStore'
import { fetchStudentPeriodClass } from '../../hooks/useStudentPeriodClass'
import {
  downloadCertificateFile,
  getCertificateDisplayUrl,
  hydrateCertificateFileUrls
} from '../../utils/certificateFiles'
import {
  normalizeAcademicYear,
  normalizeSemester,
  resolveAcademicPeriod
} from '../../utils/academicPeriod'

const DASHBOARD_TASK_LIMIT = 6
const DASHBOARD_TASK_QUERY_LIMIT = 80
const DASHBOARD_TASK_COLUMNS = 'id, kelas, judul, mapel, deadline, keterangan, file_url, link'
const ACADEMIC_PERIOD_STORAGE_KEY = 'edusmart.siswa.home.periodFilter'
const DEFAULT_EKSKUL_LIMIT = 3

const isValidDate = (date) => date instanceof Date && !Number.isNaN(date.getTime())
const normalizeEskulLimit = (value) => Math.max(1, Math.min(99, Number.parseInt(value, 10) || DEFAULT_EKSKUL_LIMIT))

const getTaskDeadlineTime = (task) => {
  const deadline = task?.deadline ? new Date(task.deadline) : null
  return deadline && isValidDate(deadline) ? deadline.getTime() : Number.POSITIVE_INFINITY
}

const readStoredAcademicPeriodFilter = (activePeriod) => {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(ACADEMIC_PERIOD_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const tahunAjaran = normalizeAcademicYear(parsed?.tahunAjaran || parsed?.tahun_ajaran)
    const semester = normalizeSemester(parsed?.semester)
    if (!tahunAjaran || !semester) return null
    if (tahunAjaran === activePeriod.tahunAjaran && semester === activePeriod.semester) return null
    return { tahunAjaran, semester }
  } catch (error) {
    return null
  }
}

const formatDateTimeLabel = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const getPeriodEndTime = (period) => {
  const raw = period?.endsAt || period?.periodeSelesai || ''
  if (!raw) return Number.POSITIVE_INFINITY
  const date = new Date(`${raw}T23:59:59`)
  return Number.isNaN(date.getTime()) ? Number.POSITIVE_INFINITY : date.getTime()
}

const getEffectiveRegistrationDeadlineTime = (deadlineAt, period) => {
  const deadline = deadlineAt ? new Date(deadlineAt) : null
  const deadlineTime = deadline && !Number.isNaN(deadline.getTime())
    ? deadline.getTime()
    : Number.POSITIVE_INFINITY
  return Math.min(deadlineTime, getPeriodEndTime(period))
}

const getEffectiveRegistrationDeadlineIso = (deadlineAt, period) => {
  const time = getEffectiveRegistrationDeadlineTime(deadlineAt, period)
  if (!Number.isFinite(time)) return ''
  return new Date(time).toISOString()
}

const isEskulRegistrationClosed = (deadlineAt, period) => (
  Date.now() > getEffectiveRegistrationDeadlineTime(deadlineAt, period)
)

const applySemesterPeriodFilters = (query, period) => {
  let next = query
  if (period?.tahunAjaran) next = next.eq('tahun_ajaran', period.tahunAjaran)
  if (period?.semester) next = next.eq('semester', period.semester)
  return next
}

const isLegacyAcademicColumnError = (error) => {
  const message = String(error?.message || error?.error || '')
  return /tahun_ajaran|semester|angkatan|kolom filter|filter tidak diizinkan|kolom.*tidak diizinkan/i.test(message)
}

// Komponen Modal untuk Detail Organisasi
const OrganisasiModal = ({ organisasi, isOpen, onClose }) => {
  if (!isOpen || !organisasi) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden transform transition-all duration-300 scale-100">
        {/* Header Modal */}
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-6 text-white">
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <h2 className="text-2xl font-bold mb-2">{organisasi.nama}</h2>
              <div className="flex flex-wrap items-center gap-4 text-purple-100 text-sm">
                <span className="flex items-center gap-2 bg-purple-500/30 px-3 py-1 rounded-full">
                  <span className="text-sm">👨‍🏫</span>
                  <span>Pembina: {organisasi.pembina_guru_nama || 'Belum ada'}</span>
                </span>
                <span className="flex items-center gap-2 bg-purple-500/30 px-3 py-1 rounded-full">
                  <span className="text-sm">👥</span>
                  <span>{organisasi.anggota?.length || 0} Anggota</span>
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:text-purple-200 transition-all duration-200 text-xl bg-purple-500/30 hover:bg-purple-500/50 w-8 h-8 rounded-full flex items-center justify-center ml-4"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content Modal */}
        <div className="p-6 max-h-[calc(90vh-180px)] overflow-y-auto">
          {/* Visi & Misi */}
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-5 border border-blue-200 shadow-sm">
              <h3 className="font-bold text-blue-900 mb-3 flex items-center gap-2 text-base">
                <span className="text-blue-600 text-lg">🎯</span>
                Visi Organisasi
              </h3>
              <p className="text-blue-800 text-sm leading-relaxed">
                {organisasi.visi || 'Belum ada visi yang ditentukan'}
              </p>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-5 border border-green-200 shadow-sm">
              <h3 className="font-bold text-green-900 mb-3 flex items-center gap-2 text-base">
                <span className="text-green-600 text-lg">📋</span>
                Misi Organisasi
              </h3>
              <p className="text-green-800 text-sm leading-relaxed">
                {organisasi.misi || 'Belum ada misi yang ditentukan'}
              </p>
            </div>
          </div>

          {/* Struktur Kepengurusan */}
          <div className="mb-4">
            <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2 text-base">
              <span className="text-purple-600 text-lg">🏛️</span>
              Struktur Kepengurusan
            </h3>
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
                {organisasi.anggota?.map((anggota, index) => (
                  <div
                    key={anggota.id}
                    className={`p-4 rounded-xl border-2 transition-all duration-200 hover:shadow-md ${anggota.jabatan === 'Ketua'
                      ? 'bg-gradient-to-br from-yellow-50 to-amber-50 border-amber-300'
                      : anggota.jabatan === 'Wakil Ketua'
                        ? 'bg-gradient-to-br from-blue-50 to-cyan-50 border-blue-300'
                        : anggota.jabatan?.includes('Sekretaris') || anggota.jabatan?.includes('Bendahara')
                          ? 'bg-gradient-to-br from-green-50 to-emerald-50 border-green-300'
                          : 'bg-gray-50 border-gray-300'
                      }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-900 text-sm leading-tight mb-1">
                          {anggota.nama}
                        </h4>
                        <p className="text-xs text-gray-600">{anggota.kelas}</p>
                      </div>
                    </div>
                    <div className="flex justify-between items-center mt-3">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${anggota.jabatan === 'Ketua'
                        ? 'bg-amber-100 text-amber-800 border border-amber-200'
                        : anggota.jabatan === 'Wakil Ketua'
                          ? 'bg-blue-100 text-blue-800 border border-blue-200'
                          : anggota.jabatan?.includes('Sekretaris') || anggota.jabatan?.includes('Bendahara')
                            ? 'bg-green-100 text-green-800 border border-green-200'
                            : 'bg-gray-100 text-gray-800 border border-gray-200'
                        }`}>
                        {anggota.jabatan || 'Anggota'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {!organisasi.anggota?.length && (
                <div className="text-center py-8 text-gray-500 bg-gray-50">
                  <div className="text-4xl mb-2 opacity-60">👥</div>
                  <p className="text-sm font-medium">Belum ada anggota terdaftar</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Modal */}
        <div className="border-t border-gray-200 px-6 py-4 bg-gray-50">
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-6 py-2.5 bg-gray-600 text-white rounded-xl hover:bg-gray-700 transition-all duration-200 font-medium text-sm shadow-sm hover:shadow-md"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Komponen Modal untuk Detail Sertifikat
const SertifikatModal = ({ sertifikat, isOpen, onClose, onDownload }) => {
  if (!isOpen || !sertifikat) return null

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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden transform transition-all duration-300 scale-100">
        {/* Header Modal */}
        <div className="bg-gradient-to-r from-amber-600 to-orange-600 p-6 text-white">
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <h2 className="text-2xl font-bold mb-2">Detail Sertifikat</h2>
              <p className="text-amber-100 text-sm">
                {sertifikat.event}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:text-amber-200 transition-all duration-200 text-xl bg-amber-500/30 hover:bg-amber-500/50 w-8 h-8 rounded-full flex items-center justify-center ml-4"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content Modal */}
        <div className="p-6 max-h-[calc(90vh-180px)] overflow-y-auto">
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
                  {sertifikat.certificate_number && (
                    <div>
                      <span className="text-blue-700 font-medium">Nomor Sertifikat:</span>
                      <p className="font-mono text-blue-900 font-semibold">{sertifikat.certificate_number}</p>
                    </div>
                  )}
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
              <div className={`border rounded-xl p-4 ${sertifikat.sent
                ? 'bg-green-50 border-green-200'
                : 'bg-yellow-50 border-yellow-200'
                }`}>
                <h4 className="font-semibold mb-2 flex items-center gap-2">
                  <span>📮</span> Status Pengiriman
                </h4>
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${sertifikat.sent ? 'bg-green-500' : 'bg-yellow-500'
                    }`}></div>
                  <span className={`text-sm font-medium ${sertifikat.sent ? 'text-green-700' : 'text-yellow-700'
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

// Komponen Modal untuk Riwayat Sertifikat
const RiwayatSertifikatModal = ({ sertifikatList, isOpen, onClose, onSertifikatClick }) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden transform transition-all duration-300 scale-100">
        {/* Header Modal */}
        <div className="bg-gradient-to-r from-amber-600 to-orange-600 p-6 text-white">
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <h2 className="text-2xl font-bold mb-2">Riwayat Sertifikat</h2>
              <p className="text-amber-100 text-sm">
                Total {sertifikatList.length} sertifikat
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:text-amber-200 transition-all duration-200 text-xl bg-amber-500/30 hover:bg-amber-500/50 w-8 h-8 rounded-full flex items-center justify-center ml-4"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content Modal */}
        <div className="p-6 max-h-[calc(90vh-180px)] overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sertifikatList.map((sertifikat) => (
              <div
                key={sertifikat.id}
                className="border-2 border-gray-200 rounded-xl p-4 transition-all duration-300 hover:border-amber-300 hover:shadow-sm cursor-pointer bg-white group"
                onClick={() => onSertifikatClick(sertifikat)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="font-bold text-gray-900 text-base leading-tight group-hover:text-amber-600 transition-colors line-clamp-2">
                      {sertifikat.event}
                    </h3>
                    <p className="text-sm text-gray-600 mt-1">
                      {sertifikat.nama_penerima}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${sertifikat.sent
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
                  <span className="text-amber-600 font-medium flex items-center gap-1">
                    Klik untuk detail →
                  </span>
                </div>
              </div>
            ))}

            {!sertifikatList.length && (
              <div className="col-span-full text-center py-8 bg-gray-50 rounded-xl">
                <div className="text-gray-300 text-4xl mb-2">🏆</div>
                <p className="text-gray-500 text-base font-medium">Belum ada sertifikat</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer Modal */}
        <div className="border-t border-gray-200 px-6 py-4 bg-gray-50">
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-6 py-2.5 bg-gray-600 text-white rounded-xl hover:bg-gray-700 transition-all duration-200 font-medium text-sm shadow-sm hover:shadow-md"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Skeleton Loading Component
const SkeletonLoader = () => (
  <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-4">
    <div className="w-full px-3 sm:px-4 lg:px-5 space-y-4">
      {/* Header Skeleton */}
      <div className="page-title-card">
        <div className="page-title-layout animate-pulse">
          <div className="page-title-main">
            <div className="page-title-icon bg-gray-100" />
            <div className="min-w-0 flex-1">
              <div className="h-3 w-24 rounded bg-gray-200 mb-3"></div>
              <div className="h-7 bg-gray-200 rounded-lg w-1/3 mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* Main Content Skeleton */}
        <div className="xl:col-span-3 space-y-6">
          {/* Pengumuman Skeleton */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <div className="h-6 bg-gray-200 rounded w-1/4"></div>
            </div>
            <div className="p-4 space-y-4">
              {[1, 2, 3].map((item) => (
                <div key={item} className="animate-pulse">
                  <div className="h-5 bg-gray-200 rounded mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-gray-200 rounded w-1/4"></div>
                </div>
              ))}
            </div>
          </div>

          {/* Tugas & Organisasi Skeleton */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {[1, 2].map((item) => (
              <div key={item} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-4 border-b border-gray-100">
                  <div className="h-6 bg-gray-200 rounded w-1/3"></div>
                </div>
                <div className="p-4 space-y-4">
                  {[1, 2].map((subItem) => (
                    <div key={subItem} className="animate-pulse">
                      <div className="h-4 bg-gray-200 rounded mb-2"></div>
                      <div className="h-3 bg-gray-200 rounded w-2/3"></div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar Skeleton */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="animate-pulse">
              <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
              <div className="h-16 bg-gray-200 rounded-lg mb-4"></div>
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="h-16 bg-gray-200 rounded-lg"></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
)

export default function SHome() {
  const { profile, user } = useAuthStore()
  const { pushToast } = useUIStore()
  const navigate = useNavigate()
  const userId = profile?.id || user?.id
  const profileClass = profile?.kelas || profile?.kelas_id || ''

  /* ============================
   *          STATE
   * ============================ */
  const [ringkas, setRingkas, hasRingkas] = useLocalCache('siswa_dashboard_ringkas', { H: 0, I: 0, A: 0 })
  const [statusUser, setStatusUser] = useState('-')
  const [dashboardClass, setDashboardClass] = useState(profileClass)
  const [tugas, setTugas] = useLocalCache('siswa_dashboard_tugas', [])
  const [tugasMeta, setTugasMeta] = useLocalCache('siswa_dashboard_tugasMeta', { pending: 0, overdue: 0 })
  const [isTugasLoading, setIsTugasLoading] = useState(false)
  const [pengumuman, setPengumuman] = useLocalCache('siswa_dashboard_pengumuman', [])
  const [ekskul, setEkskul] = useLocalCache('siswa_dashboard_ekskul', [])
  const [myEskul, setMyEskul] = useState(new Set())
  const [maxEskulPerStudent, setMaxEskulPerStudent] = useState(DEFAULT_EKSKUL_LIMIT)
  const [organisasi, setOrganisasi] = useLocalCache('siswa_dashboard_organisasi', [])
  const [selectedOrganisasi, setSelectedOrganisasi] = useState(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // -- States Sertifikat --
  const [sertifikatList, setSertifikatList] = useLocalCache('siswa_dashboard_sertifikatList', [])
  const [selectedSertifikat, setSelectedSertifikat] = useState(null)
  const [isSertifikatModalOpen, setIsSertifikatModalOpen] = useState(false)
  const [isRiwayatSertifikatModalOpen, setIsRiwayatSertifikatModalOpen] = useState(false)

  // -- States Struktur & Period --
  const [strukturSekolah, setStrukturSekolah] = useLocalCache('siswa_dashboard_strukturSekolah', [])

  const [isLoading, setIsLoading] = useState(!hasRingkas)
  const tugasLoadSeqRef = useRef(0)
  const activeAcademicPeriodRef = useRef(null)

  const getToday = () => {
    const d = new Date()
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }

  const buildTugasPath = (tugasId = '') => {
    const params = new URLSearchParams({ status: 'belum', range: 'all' })
    if (tugasId) params.set('tugas', String(tugasId))
    return `/siswa/tugas?${params.toString()}`
  }

  const goToTugas = (tugasId = '') => {
    navigate(buildTugasPath(tugasId))
  }

  const handleTugasKeyDown = (event, tugasId = '') => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    goToTugas(tugasId)
  }

  const loadActiveAcademicPeriod = async ({ force = false } = {}) => {
    if (!force && activeAcademicPeriodRef.current) {
      return activeAcademicPeriodRef.current
    }

    const { data } = await supabase
      .from('settings')
      .select('tahun_ajaran, semester_aktif, periode_mulai, periode_selesai, periode_ganjil_mulai, periode_ganjil_selesai, periode_genap_mulai, periode_genap_selesai, max_ekskul_per_siswa')
      .order('id')
      .limit(1)
      .maybeSingle()

    const activePeriod = resolveAcademicPeriod(data || {})
    const maxEskul = normalizeEskulLimit(data?.max_ekskul_per_siswa)
    setMaxEskulPerStudent(maxEskul)
    const storedPeriod = readStoredAcademicPeriodFilter(activePeriod)
    const period = storedPeriod
      ? resolveAcademicPeriod({
        tahun_ajaran: storedPeriod.tahunAjaran,
        semester_aktif: storedPeriod.semester,
        periode_ganjil_mulai: activePeriod.periodeGanjilMulai,
        periode_ganjil_selesai: activePeriod.periodeGanjilSelesai,
        periode_genap_mulai: activePeriod.periodeGenapMulai,
        periode_genap_selesai: activePeriod.periodeGenapSelesai
      })
      : activePeriod
    period.maxEskulPerStudent = maxEskul
    activeAcademicPeriodRef.current = period
    return period
  }

  /* ============================
   *        LOAD DATA
   * ============================ */
  useEffect(() => {
    if (!userId) return

    const loadAllData = async () => {
      setIsLoading(true)
      try {
        await Promise.allSettled([loadPengumuman()])

        setIsLoading(false)

        void Promise.allSettled([
          ...(userId ? [loadAbsensi(), loadTugas()] : []),
          loadEskul(),
          loadOrganisasi(),
          loadSertifikat(),
          loadStrukturSekolah()
        ])
      } catch (error) {
        console.error('Error loading data:', error)
        pushToast('error', 'Gagal memuat data dashboard')
        setIsLoading(false)
      }
    }

    loadAllData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, profileClass])

  useEffect(() => {
    if (!userId) return

    const refreshAcademicScopedData = () => {
      activeAcademicPeriodRef.current = null
      void loadAbsensi()
      void loadTugas()
    }

    const channel = supabase
      .channel(`siswa_home_period_${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, refreshAcademicScopedData)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, profileClass])

  // Load Data Sertifikat
  const loadSertifikat = async () => {
    if (!userId) return

    try {
      const { data, error } = await supabase
        .from('certificates')
        .select('*')
        .eq('user_id', userId)
        .order('issued_at', { ascending: false })

      if (error) throw error
      const hydrated = await hydrateCertificateFileUrls(data || [])
      setSertifikatList(hydrated)
    } catch (error) {
      console.error('Error loading sertifikat:', error)
      pushToast('error', 'Gagal memuat data sertifikat')
    }
  }

  // Load Data Struktur Sekolah
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
      pushToast('error', 'Gagal memuat data struktur sekolah')
    }
  }

  // Handler untuk download sertifikat
  const handleDownloadSertifikat = async (sertifikat) => {
    try {
      await downloadCertificateFile(sertifikat)
      pushToast('success', 'Sertifikat berhasil diunduh')
    } catch (error) {
      console.error('Error downloading sertifikat:', error)
      pushToast('error', error?.message || 'Gagal mengunduh sertifikat')
    }
  }

  // Handler untuk membuka modal riwayat
  const handleRiwayatSertifikat = () => {
    setIsRiwayatSertifikatModalOpen(true)
  }

  // Handler untuk klik sertifikat di modal riwayat
  const handleSertifikatClickFromRiwayat = (sertifikat) => {
    setIsRiwayatSertifikatModalOpen(false)
    setSelectedSertifikat(sertifikat)
    setIsSertifikatModalOpen(true)
  }

  const loadPengumuman = async () => {
    try {
      const { data, error } = await supabase
        .from('pengumuman')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5)

      if (error) throw error

      const filtered = (data || []).filter((p) => {
        if (!p.target) return true
        const t = p.target.toLowerCase()
        return t === 'semua' || t === 'siswa'
      })

      setPengumuman(filtered)
    } catch (err) {
      console.error('Error loading pengumuman:', err)
      pushToast('error', 'Gagal memuat pengumuman')
    }
  }

  const loadAbsensi = async () => {
    if (!userId) return
    const today = getToday()

    try {
      const period = await loadActiveAcademicPeriod()
      const kelas = await fetchStudentPeriodClass({ userId, profile, tahunAjaran: period.tahunAjaran })
      if (!kelas) return
      setDashboardClass(kelas)
      const { data, error } = await supabase
        .from('absensi')
        .select('uid, status')
        .eq('kelas', kelas)
        .eq('tanggal', today)
        .eq('tahun_ajaran', period.tahunAjaran)
        .eq('semester', period.semester)

      if (error) throw error

      const agg = { H: 0, I: 0, A: 0 }
      let myStatus = '-'

        ; (data || []).forEach((row) => {
          if (row.status === 'Hadir') agg.H++
          else if (row.status === 'Izin' || row.status === 'Sakit') agg.I++
          else if (row.status === 'Alpha') agg.A++

          if (row.uid === userId) {
            myStatus = row.status || '-'
          }
        })

      setRingkas(agg)
      setStatusUser(myStatus)
    } catch (err) {
      console.error('Error loading absensi:', err)
      pushToast('error', 'Gagal memuat data absensi')
    }
  }

  const loadTugas = async () => {
    if (!userId) return
    const nowIso = new Date().toISOString()
    const requestId = ++tugasLoadSeqRef.current

    try {
      setIsTugasLoading(true)
      const period = await loadActiveAcademicPeriod()
      const kelas = await fetchStudentPeriodClass({ userId, profile, tahunAjaran: period.tahunAjaran })
      if (!kelas) {
        setTugas([])
        setTugasMeta({ pending: 0, overdue: 0 })
        return
      }
      setDashboardClass(kelas)
      const [
        { data: overdueData, error: overdueError },
        { data: upcomingData, error: upcomingError },
      ] = await Promise.all([
        supabase
          .from('tugas')
          .select(DASHBOARD_TASK_COLUMNS)
          .eq('kelas', kelas)
          .eq('tahun_ajaran', period.tahunAjaran)
          .lt('deadline', nowIso)
          .order('deadline', { ascending: false })
          .limit(DASHBOARD_TASK_QUERY_LIMIT),
        supabase
          .from('tugas')
          .select(DASHBOARD_TASK_COLUMNS)
          .eq('kelas', kelas)
          .eq('tahun_ajaran', period.tahunAjaran)
          .gte('deadline', nowIso)
          .order('deadline', { ascending: true })
          .limit(DASHBOARD_TASK_QUERY_LIMIT),
      ])

      if (overdueError) throw overdueError
      if (upcomingError) throw upcomingError
      if (requestId !== tugasLoadSeqRef.current) return

      const byId = new Map()
      ;[...(overdueData || []), ...(upcomingData || [])].forEach((row) => {
        if (row?.id) byId.set(row.id, row)
      })

      const taskRows = Array.from(byId.values())
      if (!taskRows.length) {
        setTugas([])
        setTugasMeta({ pending: 0, overdue: 0 })
        return
      }

      const tugasIds = taskRows.map((row) => row.id)
      const { data: jawabanData, error: jawabanError } = await supabase
        .from('tugas_jawaban')
        .select('tugas_id')
        .eq('user_id', userId)
        .in('tugas_id', tugasIds)

      if (jawabanError) throw jawabanError
      if (requestId !== tugasLoadSeqRef.current) return

      const answeredIds = new Set((jawabanData || []).map((row) => row.tugas_id))
      const nowTime = Date.now()
      const pendingTasks = taskRows
        .filter((row) => !answeredIds.has(row.id))
        .map((row) => ({
          ...row,
          isOverdue: getTaskDeadlineTime(row) < nowTime
        }))
        .sort((a, b) => {
          if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1
          const aTime = getTaskDeadlineTime(a)
          const bTime = getTaskDeadlineTime(b)
          return a.isOverdue ? bTime - aTime : aTime - bTime
        })

      setTugas(pendingTasks.slice(0, DASHBOARD_TASK_LIMIT))
      setTugasMeta({
        pending: pendingTasks.length,
        overdue: pendingTasks.filter((row) => row.isOverdue).length
      })
    } catch (err) {
      if (requestId !== tugasLoadSeqRef.current) return
      console.error('Error loading tugas:', err)
      pushToast('error', 'Gagal memuat tugas')
    } finally {
      if (requestId === tugasLoadSeqRef.current) setIsTugasLoading(false)
    }
  }

  useEffect(() => {
    if (!userId) return

    const refreshTugas = () => {
      if (document.visibilityState === 'hidden') return
      void loadTugas()
    }

    const channel = supabase
      .channel(`siswa_home_tugas_${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tugas' }, () => {
        refreshTugas()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tugas_jawaban' }, (payload) => {
        const uid = (payload.new && payload.new.user_id) || (payload.old && payload.old.user_id)
        if (uid !== userId) return
        refreshTugas()
      })
      .subscribe()

    window.addEventListener('focus', refreshTugas)
    document.addEventListener('visibilitychange', refreshTugas)

    return () => {
      supabase.removeChannel(channel)
      window.removeEventListener('focus', refreshTugas)
      document.removeEventListener('visibilitychange', refreshTugas)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const loadEskul = async () => {
    if (!userId) return
    try {
      const period = await loadActiveAcademicPeriod()
      let eskulQuery = supabase
        .from('ekskul')
        .select('id, nama, keterangan, hari, jam_mulai, jam_selesai, pembina_guru_id, registration_deadline_at')
        .order('nama')

      let { data: eskulData, error: eskulError } = await eskulQuery
      if (eskulError && isLegacyAcademicColumnError(eskulError)) {
        ; ({ data: eskulData, error: eskulError } = await supabase
          .from('ekskul')
          .select('id, nama, keterangan, hari, jam_mulai, jam_selesai, pembina_guru_id, registration_deadline_at')
          .order('nama'))
      }

      let anggotaQuery = supabase
        .from('ekskul_anggota')
        .select('id, ekskul_id, user_id')
      anggotaQuery = applySemesterPeriodFilters(anggotaQuery, period)

      let { data: anggotaData, error: anggotaError } = await anggotaQuery
      if (anggotaError && isLegacyAcademicColumnError(anggotaError)) {
        ; ({ data: anggotaData, error: anggotaError } = await supabase
          .from('ekskul_anggota')
          .select('id, ekskul_id, user_id'))
      }

      if (eskulError) throw eskulError
      if (anggotaError) throw anggotaError

      const pembinaIds = Array.from(
        new Set((eskulData || []).map((e) => e.pembina_guru_id).filter(Boolean)),
      )

      let pembinaMap = {}
      if (pembinaIds.length) {
        const { data: pembinaData, error: pembinaError } = await supabase
          .from('profiles')
          .select('id, nama')
          .in('id', pembinaIds)

        if (pembinaError) throw pembinaError
        pembinaMap = Object.fromEntries(
          (pembinaData || []).map((p) => [p.id, p.nama || '']),
        )
      }

      const anggotaByEkskul = {}
      const myEskulSet = new Set()

        ; (anggotaData || []).forEach((row) => {
          if (!row.ekskul_id) return
          anggotaByEkskul[row.ekskul_id] =
            (anggotaByEkskul[row.ekskul_id] || 0) + 1
          if (row.user_id === userId) {
            myEskulSet.add(row.ekskul_id)
          }
        })

      const formattedEskul = (eskulData || []).map((e) => ({
        id: e.id,
        nama: e.nama,
        keterangan: e.keterangan || '',
        hari: e.hari || '',
        jam_mulai: e.jam_mulai || '',
        jam_selesai: e.jam_selesai || '',
        registration_deadline_at: e.registration_deadline_at || null,
        academic_period: {
          tahunAjaran: period.tahunAjaran,
          semester: period.semester,
          endsAt: period.endsAt || period.periodeSelesai || ''
        },
        pembina_nama: pembinaMap[e.pembina_guru_id] || '',
        jumlah_anggota: anggotaByEkskul[e.id] || 0,
      }))

      setEkskul(formattedEskul)
      setMyEkskul(myEskulSet)
    } catch (err) {
      console.error('Error loading ekskul:', err)
      pushToast('error', 'Gagal memuat data ekstrakurikuler')
    }
  }

  const loadOrganisasi = async () => {
    if (!userId) return

    try {
      const { data: organisasiData, error: organisasiError } = await supabase
        .from('organisasi')
        .select('*')
        .order('nama')

      if (organisasiError) throw organisasiError

      const { data: anggotaData, error: anggotaError } = await supabase
        .from('organisasi_anggota')
        .select('*')
        .order('jabatan', { ascending: false })

      if (anggotaError) throw anggotaError

      const anggotaByOrganisasi = {}
      anggotaData?.forEach(anggota => {
        if (!anggotaByOrganisasi[anggota.organisasi_id]) {
          anggotaByOrganisasi[anggota.organisasi_id] = []
        }
        anggotaByOrganisasi[anggota.organisasi_id].push(anggota)
      })

      const organisasiWithAnggota = organisasiData?.map(org => ({
        ...org,
        anggota: anggotaByOrganisasi[org.id] || []
      })) || []

      setOrganisasi(organisasiWithAnggota)
    } catch (err) {
      console.error('Error loading organisasi:', err)
      pushToast('error', 'Gagal memuat data organisasi')
    }
  }

  const toggleEskul = async (item) => {
    if (!userId) return
    const joined = myEskul.has(item.id)
    const period = await loadActiveAcademicPeriod()
    const registrationClosed = isEskulRegistrationClosed(item.registration_deadline_at, period)

    if (registrationClosed) {
      pushToast(
        'warning',
        'Pendaftaran ekskul sudah ditutup atau periode aktif sudah berakhir. Anda tidak bisa daftar atau membatalkan lagi.'
      )
      return
    }

    const maxAllowed = normalizeEskulLimit(period?.maxEskulPerStudent || maxEskulPerStudent)
    if (!joined && myEskul.size >= maxAllowed) {
      pushToast('error', `Maksimal ${maxAllowed} ekstrakurikuler yang bisa diikuti`)
      return
    }

    try {
      if (joined) {
        let deleteQuery = supabase
          .from('ekskul_anggota')
          .delete()
          .eq('ekskul_id', item.id)
          .eq('user_id', userId)
        deleteQuery = applySemesterPeriodFilters(deleteQuery, period)

        let { error } = await deleteQuery
        if (error && isLegacyAcademicColumnError(error)) {
          ; ({ error } = await supabase
            .from('ekskul_anggota')
            .delete()
            .eq('ekskul_id', item.id)
            .eq('user_id', userId))
        }

        if (error) throw error
        pushToast('success', 'Berhasil membatalkan ekskul')
      } else {
        const insertPayload = {
          ekskul_id: item.id,
          user_id: userId,
          tahun_ajaran: period.tahunAjaran,
          semester: period.semester,
          angkatan: profile?.angkatan || null,
          created_at: new Date().toISOString(),
        }
        let { error } = await supabase
          .from('ekskul_anggota')
          .insert(insertPayload)
        if (error && isLegacyAcademicColumnError(error)) {
          const { tahun_ajaran, semester, angkatan, ...legacyPayload } = insertPayload
          ; ({ error } = await supabase.from('ekskul_anggota').insert(legacyPayload))
        }

        if (error) throw error
        pushToast('success', 'Berhasil bergabung ekskul!')
      }

      loadEskul()
    } catch (err) {
      console.error('Error toggle ekskul:', err)
      pushToast('error', 'Gagal mengubah keikutsertaan ekskul')
    }
  }

  const handleOrganisasiClick = (org) => {
    setSelectedOrganisasi(org)
    setIsModalOpen(true)
  }

  const handleSertifikatClick = (sertifikat) => {
    setSelectedSertifikat(sertifikat)
    setIsSertifikatModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setSelectedOrganisasi(null)
  }

  const closeSertifikatModal = () => {
    setIsSertifikatModalOpen(false)
    setSelectedSertifikat(null)
  }

  /* ============================
   *          RENDER
   * ============================ */
  const greetingHour = new Date().getHours()
  const greeting = greetingHour < 12 ? 'Selamat Pagi' : greetingHour < 15 ? 'Selamat Siang' : greetingHour < 18 ? 'Selamat Sore' : 'Selamat Malam'

  if (isLoading) return <SkeletonLoader />

  return (
    <div className="page-wrapper animate-fade-in">
      <div className="w-full space-y-6">

        {/* ── Greeting Header ── */}
        <div className="page-title-card">
          <div className="page-title-layout">
            <div className="page-title-main">
              <div className="page-title-icon bg-brand-100 text-brand-700">👋</div>
              <div>
                <p className="page-title-kicker">{greeting}</p>
                <h1 className="page-title-heading">{profile?.nama || 'Siswa'}</h1>
                <p className="page-title-description">
                  Kelas <span className="font-semibold text-slate-800">{dashboardClass || profileClass || '—'}</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Main grid ── */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">

          {/* ── LEFT: Main Content (3/4) ── */}
          <div className="xl:col-span-3 space-y-6">

            {/* --- PENGUMUMAN --- */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-card overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-8 bg-brand-600 rounded-full" />
                  <h2 className="text-lg font-bold text-slate-900">Pengumuman</h2>
                </div>
                <span className="px-3 py-1 bg-brand-50 text-brand-700 rounded-full text-xs font-semibold">
                  {pengumuman.length} Baru
                </span>
              </div>
              <div className="divide-y divide-slate-50">
                {pengumuman.map((p) => (
                  <div key={p.id} className="px-6 py-4 hover:bg-slate-50/60 transition-colors">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <h3 className="font-semibold text-slate-800 text-sm">{p.judul}</h3>
                      {p.target && p.target !== 'semua' && (
                        <span className="flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-brand-100 text-brand-700 font-semibold">{p.target}</span>
                      )}
                    </div>
                    <p className="text-slate-600 text-sm leading-relaxed whitespace-pre-line break-words max-h-60 overflow-y-auto pr-1">
                      {p.keterangan}
                    </p>
                    <p className="text-slate-400 text-xs mt-1.5">
                      {new Date(p.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                ))}
                {!pengumuman.length && (
                  <div className="text-center py-10">
                    <div className="text-4xl mb-2 opacity-30">📢</div>
                    <p className="text-slate-500 text-sm font-medium">Tidak ada pengumuman baru</p>
                  </div>
                )}
              </div>
            </div>

            {/* --- TUGAS & ORGANISASI grid --- */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

	              {/* --- TUGAS --- */}
	              <div className="bg-white rounded-2xl border border-slate-100 shadow-card overflow-hidden">
	                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
	                  <button
	                    type="button"
	                    onClick={() => goToTugas()}
	                    className="flex items-center gap-3 text-left group"
	                  >
	                    <div className="w-2 h-7 bg-violet-600 rounded-full" />
	                    <h2 className="text-base font-bold text-slate-900 group-hover:text-violet-700 transition-colors">Tugas Mendatang</h2>
	                  </button>
	                  <div className="flex items-center gap-2">
	                    {tugasMeta.overdue > 0 && (
	                      <span className="px-2.5 py-1 bg-red-600 text-white rounded-full text-xs font-semibold shadow-sm">
	                        -{tugasMeta.overdue}
	                      </span>
	                    )}
	                    <span className="px-2.5 py-1 bg-violet-50 text-violet-700 rounded-full text-xs font-semibold">{tugasMeta.pending}</span>
	                  </div>
	                </div>
	                <div className="max-h-72 overflow-y-auto divide-y divide-slate-50">
	                  {tugas.map((t) => (
	                    <div
	                      key={t.id}
	                      role="button"
	                      tabIndex={0}
	                      onClick={() => goToTugas(t.id)}
	                      onKeyDown={(event) => handleTugasKeyDown(event, t.id)}
	                      className={`px-5 py-4 transition-colors cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-inset ${t.isOverdue ? 'bg-red-50/70 hover:bg-red-50' : 'hover:bg-slate-50/60'}`}
	                    >
	                      <div className="flex items-start justify-between gap-2 mb-1">
	                        <h3 className={`font-semibold text-sm transition-colors ${t.isOverdue ? 'text-red-800 group-hover:text-red-900' : 'text-slate-800 group-hover:text-violet-700'}`}>{t.judul}</h3>
	                        <div className="flex flex-shrink-0 items-center gap-1.5">
	                          {t.isOverdue && (
	                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-600 text-white border border-red-600 font-semibold">
	                              -1
	                            </span>
	                          )}
	                          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${t.isOverdue ? 'bg-red-100 text-red-700 border-red-200' : 'bg-violet-50 text-violet-700 border-violet-100'}`}>{t.mapel}</span>
	                        </div>
	                      </div>
	                      <p className="text-slate-500 text-xs line-clamp-2 mb-2">{t.keterangan || 'Tidak ada keterangan'}</p>
	                      <div className={`flex items-center gap-1.5 text-xs font-medium ${t.isOverdue ? 'text-red-700' : 'text-violet-600'}`}>
	                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
	                        {t.isOverdue ? 'Lewat deadline: ' : 'Deadline: '}
	                        {t.deadline ? new Date(t.deadline).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Tidak ada deadline'}
	                      </div>
		                      <div className="flex items-center justify-between gap-3 mt-2">
		                        <div className="flex flex-wrap gap-2">
		                          {t.file_url && (
		                            <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-lg border border-blue-200 text-blue-700 bg-blue-50">
		                              📎 File
		                            </span>
		                          )}
		                          {t.link && (
		                            <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-lg border border-indigo-200 text-indigo-700 bg-indigo-50">
		                              🔗 Link
		                            </span>
		                          )}
		                        </div>
		                        <span className={`text-[11px] font-bold ${t.isOverdue ? 'text-red-700' : 'text-violet-700'}`}>Buka</span>
		                      </div>
	                    </div>
	                  ))}
	                  {isTugasLoading && !tugas.length && (
	                    <div className="w-full text-center py-8">
	                      <div className="mx-auto mb-3 h-8 w-8 rounded-full border-4 border-violet-500 border-t-transparent animate-spin" />
	                      <p className="text-slate-500 text-sm">Memuat tugas...</p>
	                    </div>
	                  )}
	                  {!isTugasLoading && !tugas.length && (
	                    <button
	                      type="button"
	                      onClick={() => goToTugas()}
	                      className="w-full text-center py-8 hover:bg-slate-50/70 transition-colors"
	                    >
	                      <div className="text-4xl mb-2 opacity-30">📚</div>
		                      <p className="text-slate-500 text-sm">Semua tugas sudah dikerjakan</p>
	                    </button>
	                  )}
	                </div>
	              </div>

              {/* --- ORGANISASI --- */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-card overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-7 bg-indigo-600 rounded-full" />
                    <h2 className="text-base font-bold text-slate-900">Organisasi</h2>
                  </div>
                  <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-semibold">{organisasi.length}</span>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-slate-50">
                  {organisasi.map((org) => (
                    <div key={org.id} className="px-5 py-4 hover:bg-slate-50/60 transition-colors cursor-pointer group" onClick={() => handleOrganisasiClick(org)}>
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-slate-800 text-sm group-hover:text-indigo-700 transition-colors truncate">{org.nama}</h3>
                          <p className="text-slate-500 text-xs mt-0.5 truncate">{org.pembina_guru_nama || 'Belum ada pembina'}</p>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {org.anggota?.filter(a => ['Ketua', 'Wakil Ketua', 'Sekretaris'].includes(a.jabatan)).slice(0, 2).map((a, i) => (
                              <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${a.jabatan === 'Ketua' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>{a.jabatan}</span>
                            ))}
                          </div>
                        </div>
                        <svg className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 transition-colors flex-shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                      </div>
                    </div>
                  ))}
                  {!organisasi.length && (
                    <div className="text-center py-8">
                      <div className="text-4xl mb-2 opacity-30">🏛️</div>
                      <p className="text-slate-500 text-sm">Belum ada organisasi</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* --- EKSTRAKURIKULER --- */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-card overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-8 bg-orange-500 rounded-full" />
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Ekstrakurikuler</h2>
                    <p className="text-slate-500 text-xs">Maks. <span className="font-semibold text-orange-600">{maxEskulPerStudent} ekskul</span></p>
                  </div>
                </div>
                <span className="px-3 py-1 bg-orange-50 text-orange-700 rounded-full text-xs font-semibold">{myEskul.size}/{maxEskulPerStudent} Terdaftar</span>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {ekskul.map((x) => {
                    const isJoined = myEskul.has(x.id)
                    const registrationClosed = isEskulRegistrationClosed(x.registration_deadline_at, x.academic_period)
                    const effectiveDeadlineIso = getEffectiveRegistrationDeadlineIso(x.registration_deadline_at, x.academic_period)
                    const registrationDeadlineLabel = formatDateTimeLabel(effectiveDeadlineIso || x.registration_deadline_at)
                    return (
                      <div key={x.id} className={`rounded-xl border-2 p-4 transition-all duration-200 group ${registrationClosed ? 'border-rose-200 bg-rose-50/50' : isJoined ? 'border-orange-300 bg-orange-50/50' : 'border-slate-200 hover:border-orange-300 bg-white hover:shadow-card'}`}>
                        <div className="flex items-start justify-between mb-3">
                          <h3 className="font-bold text-slate-800 text-sm leading-tight flex-1 pr-2 group-hover:text-orange-700 transition-colors">{x.nama}</h3>
                          <div className="flex flex-col items-end gap-1">
                            {isJoined && <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500 text-white font-semibold">✓ Terdaftar</span>}
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${registrationClosed ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                              {registrationClosed ? 'Tutup' : 'Buka'}
                            </span>
                          </div>
                        </div>
                        <div className="space-y-1.5 text-xs text-slate-600 mb-3">
                          <div className="flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                            <span className="truncate font-medium">{x.pembina_nama || 'Belum ada pembina'}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                            <span>{x.hari || 'TBA'}{x.jam_mulai ? ` · ${x.jam_mulai}–${x.jam_selesai}` : ''}</span>
                          </div>
                          <div className={`flex items-center gap-1.5 ${registrationClosed ? 'text-rose-600' : 'text-emerald-600'} font-medium`}>
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            <span>{x.registration_deadline_at ? `Batas: ${registrationDeadlineLabel}` : 'Belum diatur'}</span>
                          </div>
                        </div>
                        {x.keterangan && <p className="text-slate-600 text-xs line-clamp-2 mb-3 bg-slate-50 rounded-lg px-2 py-1.5">{x.keterangan}</p>}
                        <button onClick={() => toggleEskul(x)} disabled={registrationClosed} className={`w-full py-2 rounded-xl font-semibold transition-all duration-200 text-xs ${registrationClosed ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : isJoined ? 'bg-white text-orange-600 border-2 border-orange-300 hover:bg-orange-500 hover:text-white hover:border-orange-500' : 'bg-gradient-to-r from-orange-500 to-amber-500 text-white hover:from-orange-600 hover:to-amber-600 shadow-sm'}`}>
                          {registrationClosed ? 'Pendaftaran Tutup' : isJoined ? 'Batalkan' : 'Daftar Sekarang'}
                        </button>
                      </div>
                    )
                  })}
                  {!ekskul.length && (
                    <div className="col-span-full text-center py-10">
                      <div className="text-4xl mb-2 opacity-30">⚽</div>
                      <p className="text-slate-500 text-sm">Belum ada ekskul tersedia</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT: Sidebar (1/4) ── */}
          <div className="space-y-5">

            {/* --- ABSENSI --- */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-2 h-7 bg-emerald-500 rounded-full" />
                  <h2 className="text-base font-bold text-slate-900">Absensi</h2>
                </div>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700 border border-green-200 animate-pulse">● Live</span>
              </div>
              {/* Status Saya */}
              <div className="mb-4 p-3.5 rounded-xl border-2 border-brand-100 bg-gradient-to-br from-brand-50 to-indigo-50">
                <p className="text-xs font-semibold text-slate-600 mb-1">Status Anda Hari Ini</p>
                <p className={`text-2xl font-semibold ${statusUser === 'Hadir' ? 'text-emerald-600' : statusUser === 'Izin' || statusUser === 'Sakit' ? 'text-amber-600' : statusUser === 'Alpha' ? 'text-rose-600' : 'text-brand-600'}`}>{statusUser}</p>
                <p className="text-xs text-slate-500 mt-0.5">Kelas {dashboardClass || profileClass || '—'}</p>
              </div>
              {/* Ringkasan Kelas */}
              <p className="text-xs font-semibold text-slate-500 mb-2.5 uppercase tracking-wider">Ringkasan Kelas</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl p-2.5 text-center bg-emerald-50 border border-emerald-100">
                  <div className="text-xl font-semibold text-emerald-600">{ringkas.H}</div>
                  <div className="text-[10px] font-semibold text-emerald-700 mt-0.5">Hadir</div>
                </div>
                <div className="rounded-xl p-2.5 text-center bg-amber-50 border border-amber-100">
                  <div className="text-xl font-semibold text-amber-600">{ringkas.I}</div>
                  <div className="text-[10px] font-semibold text-amber-700 mt-0.5">Izin</div>
                </div>
                <div className="rounded-xl p-2.5 text-center bg-rose-50 border border-rose-100">
                  <div className="text-xl font-semibold text-rose-600">{ringkas.A}</div>
                  <div className="text-[10px] font-semibold text-rose-700 mt-0.5">Alpha</div>
                </div>
              </div>
            </div>

            {/* --- RINGKASAN CEPAT --- */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-card p-5">
              <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">Ringkasan</h3>
              <div className="space-y-2">
                <div className="flex justify-between items-center p-2.5 bg-slate-50 rounded-lg">
                  <span className="text-sm text-slate-600 font-medium">Pengumuman</span>
                  <span className="px-2 py-0.5 bg-brand-100 text-brand-700 rounded-lg text-xs font-bold">{pengumuman.length}</span>
                </div>
	                <button
	                  type="button"
	                  onClick={() => goToTugas()}
	                  className="w-full flex justify-between items-center p-2.5 bg-slate-50 hover:bg-violet-50 rounded-lg transition-colors text-left"
	                >
	                  <span className="text-sm text-slate-600 font-medium">Perlu Dikerjakan</span>
	                  <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${tugasMeta.overdue > 0 ? 'bg-red-600 text-white' : 'bg-violet-100 text-violet-700'}`}>
	                    {tugasMeta.overdue > 0 ? `-${tugasMeta.overdue}` : tugasMeta.pending}
	                  </span>
	                </button>
                <div className="flex justify-between items-center p-2.5 bg-slate-50 rounded-lg">
                  <span className="text-sm text-slate-600 font-medium">Ekskul Diikuti</span>
                  <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-lg text-xs font-bold">{myEskul.size}/{maxEskulPerStudent}</span>
                </div>
                <div className="flex justify-between items-center p-2.5 bg-slate-50 rounded-lg">
                  <span className="text-sm text-slate-600 font-medium">Sertifikat</span>
                  <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-lg text-xs font-bold">{sertifikatList.length}</span>
                </div>
              </div>
            </div>

            {/* --- SERTIFIKAT SAYA --- */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-card overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                <div className="flex items-center gap-2.5">
                  <div className="w-2 h-7 bg-amber-500 rounded-full" />
                  <h2 className="text-base font-bold text-slate-900">Sertifikat</h2>
                </div>
                <span className="px-2.5 py-1 bg-amber-50 text-amber-700 rounded-full text-xs font-semibold">{sertifikatList.length}</span>
              </div>
              <div className="divide-y divide-slate-50 max-h-64 overflow-y-auto">
                {sertifikatList.slice(0, 5).map((sertifikat) => (
                  <div key={sertifikat.id} className="px-5 py-3.5 hover:bg-slate-50/60 transition-colors cursor-pointer group" onClick={() => handleSertifikatClick(sertifikat)}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3 className="font-semibold text-slate-800 text-xs line-clamp-2 group-hover:text-amber-600 transition-colors flex-1">{sertifikat.event}</h3>
                      <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border font-semibold ${sertifikat.sent ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>{sertifikat.sent ? 'Terkirim' : 'Pending'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-[10px]">{new Date(sertifikat.issued_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      <button onClick={(e) => { e.stopPropagation(); handleDownloadSertifikat(sertifikat) }} className="text-amber-600 hover:text-amber-700 text-[10px] font-semibold flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        Download
                      </button>
                    </div>
                    {sertifikat.certificate_number && (
                      <p className="mt-1 font-mono text-[10px] font-semibold text-slate-500">{sertifikat.certificate_number}</p>
                    )}
                  </div>
                ))}
                {sertifikatList.length > 5 && (
                  <div className="p-4">
                    <button onClick={handleRiwayatSertifikat} className="w-full py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-semibold text-xs hover:from-amber-600 hover:to-orange-600 transition-all shadow-sm">
                      Lihat Riwayat ({sertifikatList.length - 5} lainnya)
                    </button>
                  </div>
                )}
                {!sertifikatList.length && (
                  <div className="text-center py-8">
                    <div className="text-3xl mb-2 opacity-30">🏆</div>
                    <p className="text-slate-500 text-sm">Belum ada sertifikat</p>
                  </div>
                )}
              </div>
            </div>

            {/* --- STRUKTUR SEKOLAH --- */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-card overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                <div className="flex items-center gap-2.5">
                  <div className="w-2 h-7 bg-rose-500 rounded-full" />
                  <h2 className="text-base font-bold text-slate-900">Struktur Sekolah</h2>
                </div>
                <span className="px-2.5 py-1 bg-rose-50 text-rose-700 rounded-full text-xs font-semibold">{strukturSekolah.length} Posisi</span>
              </div>
              <div className="divide-y divide-slate-50 max-h-64 overflow-y-auto">
                {strukturSekolah.map((jabatan) => (
                  <div key={jabatan.id} className="px-5 py-3.5 hover:bg-slate-50/60 transition-colors group">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-slate-800 text-xs group-hover:text-rose-600 transition-colors truncate">{jabatan.jabatan}</h3>
                        <p className="text-slate-500 text-xs mt-0.5 truncate">{jabatan.guru_nama || 'Belum ditentukan'}</p>
                      </div>
                      <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border font-semibold ml-2 ${jabatan.guru_nama ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                        {jabatan.guru_nama ? 'Terisi' : 'Kosong'}
                      </span>
                    </div>
                  </div>
                ))}
                {!strukturSekolah.length && (
                  <div className="text-center py-8">
                    <div className="text-3xl mb-2 opacity-30">🏫</div>
                    <p className="text-slate-500 text-sm">Belum ada data struktur</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      <OrganisasiModal organisasi={selectedOrganisasi} isOpen={isModalOpen} onClose={closeModal} />
      <SertifikatModal sertifikat={selectedSertifikat} isOpen={isSertifikatModalOpen} onClose={closeSertifikatModal} onDownload={handleDownloadSertifikat} />
      <RiwayatSertifikatModal sertifikatList={sertifikatList} isOpen={isRiwayatSertifikatModalOpen} onClose={() => setIsRiwayatSertifikatModalOpen(false)} onSertifikatClick={handleSertifikatClickFromRiwayat} />
    </div>
  )
}
