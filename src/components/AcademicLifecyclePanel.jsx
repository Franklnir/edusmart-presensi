import React, { useEffect, useMemo, useState } from 'react'
import { Archive, Clock3, LockKeyhole, X } from 'lucide-react'
import { academicPeriodService } from '../services/academicPeriodService'
import { useAcademicContext } from '../context/AcademicContext'
import { useUIStore } from '../store/useUIStore'

const SCOPE_LABELS = {
  jadwal: 'Jadwal',
  kelas_struktur: 'Wali dan ketua kelas',
  struktur_sekolah: 'Struktur sekolah',
  organisasi: 'Organisasi',
  organisasi_anggota: 'Anggota organisasi',
  guru_mapel_bobot: 'Bobot nilai guru',
  tugas: 'Tugas',
  quizzes: 'Quiz',
  absensi: 'Absensi',
  absensi_ajuan: 'Pengajuan absensi',
  absensi_settings: 'Pengaturan absensi',
  absensi_eskul: 'Absensi ekskul',
  jam_kosong: 'Jam kosong',
  ekskul: 'Ekstrakurikuler',
  ekskul_anggota: 'Anggota ekstrakurikuler',
  anggota_ekskul: 'Anggota ekskul lama'
}

export default function AcademicLifecyclePanel() {
  const { correctionSession, setCorrectionSession, clearCorrectionSession } = useAcademicContext()
  const pushToast = useUIStore((state) => state.pushToast)
  const [catalog, setCatalog] = useState(null)
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedTerm, setSelectedTerm] = useState(null)
  const [reason, setReason] = useState('')
  const [selectedScopes, setSelectedScopes] = useState([])
  const [durationMinutes, setDurationMinutes] = useState(30)
  const [saving, setSaving] = useState(false)

  const loadCatalog = async () => {
    setLoading(true)
    const data = await academicPeriodService.list()
    setCatalog(data || null)
    const serverSession = data?.active_correction_sessions?.[0] || null
    if (!correctionSession && serverSession) setCorrectionSession(serverSession)
    setLoading(false)
  }

  useEffect(() => { void loadCatalog() }, [])

  const closedTerms = useMemo(() => (
    (catalog?.years || []).flatMap((year) => (
      (year.terms || [])
        .filter((term) => term.status === 'closed')
        .map((term) => ({ ...term, tahunAjaran: year.label }))
    ))
  ), [catalog])

  const availableScopes = useMemo(() => {
    const groups = catalog?.correction_scopes || {}
    return [...new Set([...(groups.academic_year || []), ...(groups.academic_term || [])])]
  }, [catalog])

  const openCorrection = (term) => {
    setSelectedTerm(term)
    setReason('')
    setSelectedScopes([])
    setDurationMinutes(30)
    setModalOpen(true)
  }

  const createSession = async () => {
    if (!selectedTerm?.id || reason.trim().length < 10 || selectedScopes.length === 0) return
    setSaving(true)
    try {
      const data = await academicPeriodService.createCorrectionSession({
        academic_term_id: selectedTerm.id,
        reason: reason.trim(),
        allowed_scopes: selectedScopes,
        duration_minutes: durationMinutes
      })
      setSaving(false)

      setCorrectionSession(data)
      setModalOpen(false)
      await loadCatalog()
      pushToast('success', `Sesi koreksi ${data.tahun_ajaran} ${data.semester} aktif sampai batas waktu yang ditentukan.`)
    } catch (error) {
      setSaving(false)
      pushToast('error', error.message || 'Sesi koreksi gagal dibuat.')
    }
  }

  const closeSession = async () => {
    if (!correctionSession?.id) return
    setSaving(true)
    try {
      await academicPeriodService.closeCorrectionSession(correctionSession.id)
      setSaving(false)
      clearCorrectionSession()
      await loadCatalog()
      pushToast('success', 'Sesi koreksi ditutup.')
    } catch (error) {
      setSaving(false)
      pushToast('error', error.message || 'Sesi koreksi gagal ditutup.')
    }
  }

  return (
    <div className="mt-6 border-t border-slate-200 pt-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Archive className="h-4 w-4 text-amber-600" />
            Arsip dan Koreksi Terbatas
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
            Periode tertutup hanya dapat dibaca. Koreksi membuka tabel yang dipilih untuk akun ini selama maksimal 60 menit dan seluruh perubahan dicatat.
          </p>
        </div>
        {correctionSession && (
          <button
            type="button"
            onClick={closeSession}
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            <LockKeyhole className="h-4 w-4" />
            Tutup Sesi Koreksi
          </button>
        )}
      </div>

      {correctionSession && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <span className="font-bold">Mode Koreksi</span>
          <span>{correctionSession.tahun_ajaran} {correctionSession.semester}</span>
          <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />Berakhir {new Date(correctionSession.expires_at).toLocaleString('id-ID')}</span>
        </div>
      )}

      <div className="mt-4 max-h-64 overflow-y-auto border-y border-slate-200">
        {loading && <div className="px-3 py-4 text-sm text-slate-500">Memuat arsip...</div>}
        {!loading && closedTerms.length === 0 && <div className="px-3 py-4 text-sm text-slate-500">Belum ada periode tertutup.</div>}
        {closedTerms.map((term) => (
          <div key={term.id} className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-3 last:border-b-0">
            <div>
              <div className="text-sm font-bold text-slate-800">{term.tahunAjaran} - {term.semester}</div>
              <div className="mt-0.5 text-xs text-slate-500">{term.starts_at} sampai {term.ends_at}</div>
            </div>
            <button
              type="button"
              onClick={() => openCorrection(term)}
              disabled={Boolean(correctionSession)}
              className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Buka Koreksi
            </button>
          </div>
        ))}
      </div>

      {modalOpen && selectedTerm && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <button type="button" className="absolute inset-0" onClick={() => setModalOpen(false)} aria-label="Tutup dialog koreksi" />
          <div className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold uppercase text-amber-700">Sesi Koreksi Arsip</div>
                <h3 className="mt-1 text-lg font-bold text-slate-900">{selectedTerm.tahunAjaran} - {selectedTerm.semester}</h3>
              </div>
              <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Tutup">
                <X className="h-5 w-5" />
              </button>
            </div>

            <label className="mt-5 block text-xs font-bold text-slate-600">Alasan koreksi</label>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={500}
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
              placeholder="Tuliskan dasar koreksi atau nomor berita acara..."
            />

            <div className="mt-4 text-xs font-bold text-slate-600">Data yang boleh dikoreksi</div>
            <div className="mt-2 grid max-h-56 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
              {availableScopes.map((scope) => (
                <label key={scope} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={selectedScopes.includes(scope)}
                    onChange={(event) => setSelectedScopes((current) => (
                      event.target.checked ? [...current, scope] : current.filter((item) => item !== scope)
                    ))}
                  />
                  {SCOPE_LABELS[scope] || scope}
                </label>
              ))}
            </div>

            <label className="mt-4 block text-xs font-bold text-slate-600">Durasi</label>
            <select value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value={15}>15 menit</option>
              <option value={30}>30 menit</option>
              <option value={60}>60 menit</option>
            </select>

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700">Batal</button>
              <button
                type="button"
                onClick={createSession}
                disabled={saving || reason.trim().length < 10 || selectedScopes.length === 0}
                className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Membuka...' : 'Aktifkan Sesi Koreksi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
