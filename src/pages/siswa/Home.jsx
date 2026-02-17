import React, { useState, useEffect } from 'react'
import { useAuthStore } from '../../store/useAuthStore'
import { supabase } from '../../lib/supabase'
import Badge from '../../components/Badge'
import { useUIStore } from '../../store/useUIStore'
import {
  getCertificateDisplayUrl,
  hydrateCertificateFileUrls,
  resolveCertificateFileUrl
} from '../../utils/certificateFiles'

// Helper: render link / gambar lampiran
const renderLink = (url, text) => {
  if (!url) return null
  try {
    if (/\.(jpeg|jpg|gif|png|webp)$/i.test(url)) {
      return (
        <img
          src={url}
          alt="lampiran"
          className="max-w-xs max-h-32 rounded-lg mt-1 border border-gray-200 transition-transform duration-200 hover:scale-105"
        />
      )
    }
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-lg border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 transition-all duration-200 mt-1"
      >
        {text}
      </a>
    )
  } catch {
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

const isEskulRegistrationClosed = (deadlineAt) => {
  if (!deadlineAt) return false
  const deadline = new Date(deadlineAt)
  if (Number.isNaN(deadline.getTime())) return false
  return Date.now() > deadline.getTime()
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
                    className={`p-4 rounded-xl border-2 transition-all duration-200 hover:shadow-md ${
                      anggota.jabatan === 'Ketua' 
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
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                        anggota.jabatan === 'Ketua' 
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
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="animate-pulse">
          <div className="h-7 bg-gray-200 rounded-lg w-1/3 mb-2"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
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
  const userId = profile?.id || user?.id

  /* ============================
   *          STATE
   * ============================ */
  const [ringkas, setRingkas] = useState({ H: 0, I: 0, A: 0 })
  const [statusUser, setStatusUser] = useState('-')
  const [tugas, setTugas] = useState([])
  const [pengumuman, setPengumuman] = useState([])
  const [ekskul, setEkskul] = useState([])
  const [myEskul, setMyEkskul] = useState(new Set())
  const [organisasi, setOrganisasi] = useState([])
  const [selectedOrganisasi, setSelectedOrganisasi] = useState(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  
  // State untuk sertifikat
  const [sertifikatList, setSertifikatList] = useState([])
  const [selectedSertifikat, setSelectedSertifikat] = useState(null)
  const [isSertifikatModalOpen, setIsSertifikatModalOpen] = useState(false)
  const [isRiwayatSertifikatModalOpen, setIsRiwayatSertifikatModalOpen] = useState(false)
  
  // State untuk struktur sekolah
  const [strukturSekolah, setStrukturSekolah] = useState([])
  
  const [isLoading, setIsLoading] = useState(true)

  const getToday = () => {
    const d = new Date()
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }

  /* ============================
   *        LOAD DATA
   * ============================ */
  useEffect(() => {
    if (!userId) return

    const loadAllData = async () => {
      setIsLoading(true)
      try {
        await Promise.all([
          loadPengumuman(),
          loadEskul(),
          loadOrganisasi(),
          loadSertifikat(),
          loadStrukturSekolah(),
          ...(profile?.kelas ? [loadAbsensi(), loadTugas()] : [])
        ])
      } catch (error) {
        console.error('Error loading data:', error)
        pushToast('error', 'Gagal memuat data dashboard')
      } finally {
        setIsLoading(false)
      }
    }

    loadAllData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, profile?.kelas])

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
      const resolvedUrl =
        getCertificateDisplayUrl(sertifikat) ||
        (await resolveCertificateFileUrl(sertifikat?.file_url))
      if (!resolvedUrl) throw new Error('File sertifikat tidak ditemukan')

      const response = await fetch(resolvedUrl, { credentials: 'include' })
      if (!response.ok) throw new Error('File sertifikat tidak dapat diakses')
      const blob = await response.blob()
      
      // Create download link
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.style.display = 'none'
      a.href = url
      
      // Extract file extension from URL
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
    if (!profile?.kelas || !userId) return
    const today = getToday()

    try {
      const { data, error } = await supabase
        .from('absensi')
        .select('uid, status')
        .eq('kelas', profile.kelas)
        .eq('tanggal', today)

      if (error) throw error

      const agg = { H: 0, I: 0, A: 0 }
      let myStatus = '-'

      ;(data || []).forEach((row) => {
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
    if (!profile?.kelas) return
    const nowIso = new Date().toISOString()

    try {
      const { data, error } = await supabase
        .from('tugas')
        .select('*')
        .eq('kelas', profile.kelas)
        .gte('deadline', nowIso)
        .order('deadline', { ascending: true })
        .limit(6)

      if (error) throw error
      setTugas(data || [])
    } catch (err) {
      console.error('Error loading tugas:', err)
      pushToast('error', 'Gagal memuat tugas')
    }
  }

  const loadEskul = async () => {
    if (!userId) return
    try {
      const [
        { data: eskulData, error: eskulError },
        { data: anggotaData, error: anggotaError },
      ] = await Promise.all([
        supabase
          .from('ekskul')
          .select('id, nama, keterangan, hari, jam_mulai, jam_selesai, pembina_guru_id, registration_deadline_at')
          .order('nama'),
        supabase
          .from('ekskul_anggota')
          .select('id, ekskul_id, user_id'),
      ])

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

      ;(anggotaData || []).forEach((row) => {
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
    const registrationClosed = isEskulRegistrationClosed(item.registration_deadline_at)

    if (registrationClosed) {
      pushToast(
        'warning',
        'Pendaftaran ekskul sudah ditutup. Anda tidak bisa daftar atau membatalkan lagi.'
      )
      return
    }

    if (!joined && myEskul.size >= 3) {
      pushToast('error', 'Maksimal 3 ekstrakurikuler yang bisa diikuti')
      return
    }

    try {
      if (joined) {
        const { error } = await supabase
          .from('ekskul_anggota')
          .delete()
          .eq('ekskul_id', item.id)
          .eq('user_id', userId)

        if (error) throw error
        pushToast('success', 'Berhasil membatalkan ekskul')
      } else {
        const { error } = await supabase
          .from('ekskul_anggota')
          .insert({
            ekskul_id: item.id,
            user_id: userId,
            created_at: new Date().toISOString(),
          })

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

  if (isLoading) {
    return <SkeletonLoader />
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-6">
      <div className="w-full px-4 sm:px-6 lg:px-8 space-y-6">
        
        {/* --- HEADER WELCOME --- */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 transition-all duration-300 hover:shadow-md">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <div className="w-3 h-12 bg-gradient-to-b from-blue-500 to-purple-600 rounded-full"></div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-1">
                  Selamat Datang, {profile?.nama || 'Siswa'}! 👋
                </h1>
                <p className="text-gray-600 text-base">Pantau aktivitas dan perkembangan akademik Anda</p>
              </div>
            </div>
            {profile?.kelas && (
              <div className="mt-4 md:mt-0">
                <span className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl text-sm font-semibold shadow-sm">
                  🏫 Kelas {profile.kelas}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
          {/* MAIN CONTENT - 3/4 width */}
          <div className="xl:col-span-3 space-y-6">
            
            {/* --- PENGUMUMAN --- */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden transition-all duration-300 hover:shadow-md">
              <div className="flex items-center gap-3 p-6 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                <div className="w-2 h-8 bg-blue-600 rounded-full"></div>
                <div className="flex items-center justify-between flex-1">
                  <h2 className="text-xl font-bold text-gray-900">📢 Pengumuman Terbaru</h2>
                  <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                    {pengumuman.length} Items
                  </span>
                </div>
              </div>
              
              <div className="max-h-80 overflow-y-auto">
                <div className="p-6 space-y-4">
                  {pengumuman.map((p, index) => (
                    <div
                      key={p.id}
                      className={`p-4 rounded-xl border-2 transition-all duration-300 hover:shadow-md cursor-pointer ${
                        index === 0 
                          ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-300 shadow-sm' 
                          : 'border-gray-200 hover:border-blue-300 bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-3">
                            <h3 className="font-bold text-gray-900 text-lg leading-tight">{p.judul}</h3>
                            {index === 0 && (
                              <span className="px-2 py-1 text-xs font-semibold bg-blue-500 text-white rounded-full">
                                🆕 Terbaru
                              </span>
                            )}
                          </div>
                          <p className="text-gray-700 text-sm leading-relaxed line-clamp-2 mb-3">
                            {p.keterangan}
                          </p>
                          <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                            <span className="flex items-center gap-2 bg-gray-100 px-3 py-1 rounded-full">
                              <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                              <span className="capitalize font-medium">{p.target || 'semua'}</span>
                            </span>
                            <span className="flex items-center gap-2 bg-gray-100 px-3 py-1 rounded-full">
                              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                              <span className="font-medium">
                                {p.created_at ? new Date(p.created_at).toLocaleDateString('id-ID', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric'
                                }) : ''}
                              </span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {!pengumuman.length && (
                    <div className="text-center py-8 bg-gray-50 rounded-xl">
                      <div className="text-gray-300 text-5xl mb-3">📢</div>
                      <p className="text-gray-500 text-base font-medium">Tidak ada pengumuman baru</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Tugas and Organisasi Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* --- TUGAS --- */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden transition-all duration-300 hover:shadow-md">
                <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-8 bg-purple-600 rounded-full"></div>
                    <h2 className="text-xl font-bold text-gray-900">📚 Tugas Mendatang</h2>
                  </div>
                  <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-semibold">
                    {tugas.length} Tugas
                  </span>
                </div>

                <div className="max-h-72 overflow-y-auto">
                  <div className="p-6">
                    <div className="space-y-4">
                      {tugas.map((t) => (
                        <div
                          key={t.id}
                          className="border-2 border-gray-200 rounded-xl p-4 transition-all duration-300 hover:border-purple-300 hover:shadow-sm cursor-pointer bg-white group"
                        >
                          <div className="flex items-start justify-between mb-3">
                            <h3 className="font-bold text-gray-900 text-base leading-tight flex-1 pr-3 group-hover:text-purple-700 transition-colors">
                              {t.judul}
                            </h3>
                            <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-lg text-xs font-semibold whitespace-nowrap">
                              {t.mapel}
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-2 text-xs text-gray-600 mb-3">
                            <span className="flex items-center gap-2 bg-purple-50 px-3 py-1 rounded-lg border border-purple-200">
                              <span className="text-sm">⏰</span>
                              <span className="font-semibold">
                                {t.deadline ? new Date(t.deadline).toLocaleString('id-ID', {
                                  day: 'numeric',
                                  month: 'short',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                }) : 'Tidak ada deadline'}
                              </span>
                            </span>
                          </div>

                          <p className="text-gray-700 text-sm leading-relaxed line-clamp-2 mb-3">
                            {t.keterangan || 'Tidak ada keterangan tambahan'}
                          </p>

                          <div className="flex flex-wrap gap-2">
                            {renderLink(t.file_url, '📎 File')}
                            {renderLink(t.link, '🔗 Link')}
                          </div>
                        </div>
                      ))}
                      
                      {!tugas.length && (
                        <div className="text-center py-6 bg-gray-50 rounded-xl">
                          <div className="text-gray-300 text-4xl mb-2">📚</div>
                          <p className="text-gray-500 text-base font-medium">Tidak ada tugas baru</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* --- ORGANISASI --- */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden transition-all duration-300 hover:shadow-md">
                <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-8 bg-indigo-600 rounded-full"></div>
                    <div>
                      <h2 className="text-xl font-bold text-gray-900">🏛️ Organisasi</h2>
                    </div>
                  </div>
                  <div className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-xs font-semibold">
                    {organisasi.length} Organisasi
                  </div>
                </div>

                <div className="max-h-72 overflow-y-auto">
                  <div className="p-6">
                    <div className="grid grid-cols-1 gap-4">
                      {organisasi.map((org) => (
                        <div
                          key={org.id}
                          className="border-2 border-gray-200 rounded-xl p-4 transition-all duration-300 hover:border-indigo-300 hover:shadow-md cursor-pointer bg-white group"
                          onClick={() => handleOrganisasiClick(org)}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                              <h3 className="font-bold text-gray-900 text-base leading-tight mb-2 group-hover:text-indigo-700 transition-colors">
                                {org.nama}
                              </h3>
                              
                              <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600 mb-3">
                                <span className="flex items-center gap-2 bg-indigo-50 px-3 py-1 rounded-lg border border-indigo-200">
                                  <span className="text-indigo-600 text-sm">👨‍🏫</span>
                                  <span className="font-medium truncate">{org.pembina_guru_nama || 'Belum ada pembina'}</span>
                                </span>
                                <span className="flex items-center gap-2 bg-indigo-50 px-3 py-1 rounded-lg border border-indigo-200">
                                  <span className="text-indigo-600 text-sm">👥</span>
                                  <span className="font-medium">{org.anggota?.length || 0}</span>
                                </span>
                              </div>

                              {/* Preview Jabatan */}
                              <div className="flex flex-wrap gap-2">
                                {org.anggota
                                  ?.filter(anggota => 
                                    ['Ketua', 'Wakil Ketua', 'Sekretaris', 'Bendahara'].includes(anggota.jabatan)
                                  )
                                  .slice(0, 2)
                                  .map((anggota, idx) => (
                                    <span
                                      key={idx}
                                      className={`px-2 py-1 rounded-lg text-xs font-semibold border ${
                                        anggota.jabatan === 'Ketua' 
                                          ? 'bg-amber-100 text-amber-800 border-amber-300' 
                                          : anggota.jabatan === 'Wakil Ketua'
                                          ? 'bg-blue-100 text-blue-800 border-blue-300'
                                          : 'bg-green-100 text-green-800 border-green-300'
                                      }`}
                                    >
                                      {anggota.jabatan}
                                    </span>
                                  ))}
                                {org.anggota?.length > 2 && (
                                  <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded-lg text-xs font-semibold border border-gray-300">
                                    +{org.anggota.length - 2} lainnya
                                  </span>
                                )}
                              </div>
                            </div>
                            
                            <div className="text-indigo-600 opacity-0 group-hover:opacity-100 transition-all duration-300 text-lg transform group-hover:translate-x-1">
                              →
                            </div>
                          </div>
                        </div>
                      ))}
                      
                      {!organisasi.length && (
                        <div className="text-center py-6 bg-gray-50 rounded-xl">
                          <div className="text-gray-300 text-4xl mb-2">🏛️</div>
                          <p className="text-gray-500 text-base font-medium">Belum ada organisasi</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* --- EKSKUL --- */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden transition-all duration-300 hover:shadow-md">
              <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-8 bg-orange-600 rounded-full"></div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">⚽ Ekstrakurikuler</h2>
                    <p className="text-gray-600 text-sm mt-1">
                      Maksimal <span className="font-semibold text-orange-600">3 ekskul</span> yang bisa diikuti
                    </p>
                  </div>
                </div>
                <div className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-semibold">
                  {myEskul.size}/3 Terdaftar
                </div>
              </div>

              <div className="max-h-80 overflow-y-auto">
                <div className="p-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {ekskul.map((x) => {
                      const isJoined = myEskul.has(x.id)
                      const registrationClosed = isEskulRegistrationClosed(
                        x.registration_deadline_at
                      )
                      const registrationDeadlineLabel = formatDateTimeLabel(
                        x.registration_deadline_at
                      )
                      return (
                        <div
                          key={x.id}
                          className={`border-2 rounded-xl p-4 transition-all duration-300 group ${
                            registrationClosed
                              ? 'border-rose-300 bg-gradient-to-br from-rose-50 to-orange-50 shadow-sm'
                              : isJoined
                              ? 'border-orange-400 bg-gradient-to-br from-orange-50 to-amber-50 shadow-sm'
                              : 'border-gray-200 hover:border-orange-300 bg-white hover:shadow-md'
                          }`}
                        >
                          <div className="mb-4">
                            <div className="flex items-start justify-between mb-3">
                              <h3 className="font-bold text-gray-900 text-base leading-tight flex-1 pr-3 group-hover:text-orange-700 transition-colors">
                                {x.nama}
                              </h3>
                              <div className="flex flex-col items-end gap-1">
                                {isJoined && (
                                  <span className="px-2 py-1 bg-orange-500 text-white rounded-lg text-xs font-semibold shadow-sm">
                                    ✅ Terdaftar
                                  </span>
                                )}
                                <span
                                  className={`px-2 py-1 rounded-lg text-[11px] font-semibold ${
                                    registrationClosed
                                      ? 'bg-rose-100 text-rose-700 border border-rose-200'
                                      : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                                  }`}
                                >
                                  {registrationClosed
                                    ? 'Pendaftaran ditutup'
                                    : 'Pendaftaran dibuka'}
                                </span>
                              </div>
                            </div>

                            <div className="space-y-2 text-sm text-gray-600 mb-3">
                              <div className="flex items-center gap-2">
                                <span className="text-gray-500 text-base">👨‍🏫</span>
                                <span className="font-medium truncate">{x.pembina_nama || 'Belum ada pembina'}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-gray-500 text-base">📅</span>
                                <span className="font-medium text-xs">
                                  {x.hari || 'TBA'} 
                                  {x.jam_mulai && ` • ${x.jam_mulai} - ${x.jam_selesai}`}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-gray-500 text-base">⏳</span>
                                <span
                                  className={`font-medium text-xs ${
                                    registrationClosed ? 'text-rose-700' : 'text-emerald-700'
                                  }`}
                                >
                                  {x.registration_deadline_at
                                    ? `Batas daftar: ${registrationDeadlineLabel}`
                                    : 'Batas daftar: belum diatur admin'}
                                </span>
                              </div>
                            </div>

                            {x.keterangan && (
                              <p className="text-gray-700 text-sm leading-relaxed line-clamp-2 bg-gray-50 p-2 rounded-lg border border-gray-200">
                                {x.keterangan}
                              </p>
                            )}
                          </div>

                          <button
                            onClick={() => toggleEskul(x)}
                            disabled={registrationClosed}
                            className={`w-full py-2.5 px-4 rounded-xl font-semibold transition-all duration-300 text-sm shadow-sm ${
                              registrationClosed
                                ? 'bg-gray-200 text-gray-500 cursor-not-allowed border border-gray-300'
                                : isJoined
                                ? 'bg-white text-orange-600 border-2 border-orange-300 hover:bg-orange-500 hover:text-white hover:border-orange-500'
                                : 'bg-gradient-to-r from-orange-500 to-amber-500 text-white hover:from-orange-600 hover:to-amber-600'
                            }`}
                          >
                            {registrationClosed
                              ? 'Pendaftaran Tutup'
                              : isJoined
                                ? 'Batalkan'
                                : 'Daftar Sekarang'}
                          </button>
                        </div>
                      )
                    })}
                    
                    {!ekskul.length && (
                      <div className="col-span-full text-center py-8 bg-gray-50 rounded-xl">
                        <div className="text-gray-300 text-5xl mb-3">⚽</div>
                        <p className="text-gray-500 text-base font-medium">Belum ada ekskul tersedia</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* SIDEBAR - 1/4 width */}
          <div className="space-y-6">
            
            {/* --- ABSENSI --- */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 transition-all duration-300 hover:shadow-md">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-8 bg-emerald-600 rounded-full"></div>
                  <h2 className="text-xl font-bold text-gray-900">📊 Absensi</h2>
                </div>
                <Badge variant="live">Live</Badge>
              </div>
              
              {/* Status Saya */}
              <div className="mb-6 p-4 bg-gradient-to-br from-blue-50 to-indigo-100 rounded-xl border-2 border-blue-300 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                  <span className="text-blue-600">👤</span>
                  Status Anda Hari Ini
                </h3>
                <div className={`text-2xl font-bold mb-1 transition-all duration-300 ${
                  statusUser === 'Hadir' ? 'text-emerald-600' :
                  statusUser === 'Izin' || statusUser === 'Sakit' ? 'text-amber-600' :
                  statusUser === 'Alpha' ? 'text-rose-600' : 'text-blue-600'
                }`}>
                  {statusUser}
                </div>
                <p className="text-xs text-blue-600 font-medium">
                  Status kehadiran hari ini di kelas {profile?.kelas}
                </p>
              </div>

              {/* Ringkasan Kelas */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <span className="text-emerald-600">📈</span>
                  Ringkasan Kelas
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { 
                      label: 'Hadir', 
                      value: ringkas.H, 
                      icon: '✅',
                      bgColor: 'bg-emerald-50',
                      borderColor: 'border-emerald-300',
                      textColor: 'text-emerald-700'
                    },
                    { 
                      label: 'Izin', 
                      value: ringkas.I, 
                      icon: '⚠️',
                      bgColor: 'bg-amber-50',
                      borderColor: 'border-amber-300',
                      textColor: 'text-amber-700'
                    },
                    { 
                      label: 'Alpha', 
                      value: ringkas.A, 
                      icon: '❌',
                      bgColor: 'bg-rose-50',
                      borderColor: 'border-rose-300',
                      textColor: 'text-rose-700'
                    }
                  ].map((item, index) => (
                    <div
                      key={index}
                      className={`${item.bgColor} ${item.borderColor} rounded-xl p-3 text-center border-2 transition-all duration-300 hover:shadow-sm`}
                    >
                      <div className="text-xl mb-2">{item.icon}</div>
                      <div className="text-xs font-semibold text-gray-600 mb-1">{item.label}</div>
                      <div className={`text-xl font-bold ${item.textColor}`}>
                        {item.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* --- STRUKTUR SEKOLAH --- */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 transition-all duration-300 hover:shadow-md">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-8 bg-red-600 rounded-full"></div>
                  <h2 className="text-xl font-bold text-gray-900">🏫 Struktur Sekolah</h2>
                </div>
                <div className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-semibold">
                  {strukturSekolah.length} Posisi
                </div>
              </div>

              <div className="space-y-4 max-h-72 overflow-y-auto">
                {strukturSekolah.map((jabatan, index) => (
                  <div 
                    key={jabatan.id}
                    className="border-2 border-gray-200 rounded-xl p-4 transition-all duration-300 hover:border-red-300 hover:shadow-sm bg-white group"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <h3 className="font-bold text-gray-900 text-base leading-tight group-hover:text-red-600 transition-colors">
                          {jabatan.jabatan}
                        </h3>
                        <p className="text-sm text-gray-600 mt-1">
                          {jabatan.guru_nama || 'Belum ditentukan'}
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        jabatan.guru_nama 
                          ? 'bg-green-100 text-green-700 border border-green-200' 
                          : 'bg-yellow-100 text-yellow-700 border border-yellow-200'
                      }`}>
                        {jabatan.guru_nama ? 'Terisi' : 'Kosong'}
                      </span>
                    </div>
                    
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        Staff Sekolah
                      </span>
                    </div>
                  </div>
                ))}
                
                {!strukturSekolah.length && (
                  <div className="text-center py-6 bg-gray-50 rounded-xl">
                    <div className="text-gray-300 text-4xl mb-2">🏫</div>
                    <p className="text-gray-500 text-base font-medium">Belum ada data struktur</p>
                    <p className="text-gray-400 text-sm mt-1">Struktur sekolah akan muncul di sini</p>
                  </div>
                )}
              </div>
            </div>

            {/* --- SERTIFIKAT SAYA --- */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 transition-all duration-300 hover:shadow-md">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-8 bg-amber-600 rounded-full"></div>
                  <h2 className="text-xl font-bold text-gray-900">🏆 Sertifikat Saya</h2>
                </div>
                <div className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold">
                  {sertifikatList.length} Sertifikat
                </div>
              </div>

              <div className="space-y-4 max-h-72 overflow-y-auto">
                {sertifikatList.slice(0, 5).map((sertifikat) => (
                  <div 
                    key={sertifikat.id}
                    className="border-2 border-gray-200 rounded-xl p-4 transition-all duration-300 hover:border-amber-300 hover:shadow-sm cursor-pointer bg-white group"
                    onClick={() => handleSertifikatClick(sertifikat)}
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
                
                {/* Tombol Lihat Riwayat */}
                {sertifikatList.length > 5 && (
                  <button
                    onClick={handleRiwayatSertifikat}
                    className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-semibold hover:from-amber-600 hover:to-orange-600 transition-all duration-300 shadow-sm hover:shadow-md flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    Lihat Riwayat Sertifikat ({sertifikatList.length - 5} lainnya)
                  </button>
                )}
                
                {!sertifikatList.length && (
                  <div className="text-center py-6 bg-gray-50 rounded-xl">
                    <div className="text-gray-300 text-4xl mb-2">🏆</div>
                    <p className="text-gray-500 text-base font-medium">Belum ada sertifikat</p>
                    <p className="text-gray-400 text-sm mt-1">Sertifikat akan muncul di sini setelah diterbitkan</p>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Stats */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 transition-all duration-300 hover:shadow-md">
              <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                <span className="text-purple-600">📋</span>
                Ringkasan Cepat
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <span className="text-sm font-medium text-gray-700">Total Pengumuman</span>
                  <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-lg text-xs font-bold">
                    {pengumuman.length}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <span className="text-sm font-medium text-gray-700">Tugas Aktif</span>
                  <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded-lg text-xs font-bold">
                    {tugas.length}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <span className="text-sm font-medium text-gray-700">Ekskul Diikuti</span>
                  <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded-lg text-xs font-bold">
                    {myEskul.size}/3
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <span className="text-sm font-medium text-gray-700">Sertifikat</span>
                  <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-lg text-xs font-bold">
                    {sertifikatList.length}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal Organisasi */}
      <OrganisasiModal 
        organisasi={selectedOrganisasi}
        isOpen={isModalOpen}
        onClose={closeModal}
      />

      {/* Modal Sertifikat */}
      <SertifikatModal 
        sertifikat={selectedSertifikat}
        isOpen={isSertifikatModalOpen}
        onClose={closeSertifikatModal}
        onDownload={handleDownloadSertifikat}
      />

      {/* Modal Riwayat Sertifikat */}
      <RiwayatSertifikatModal 
        sertifikatList={sertifikatList}
        isOpen={isRiwayatSertifikatModalOpen}
        onClose={() => setIsRiwayatSertifikatModalOpen(false)}
        onSertifikatClick={handleSertifikatClickFromRiwayat}
      />
    </div>
  )
}
