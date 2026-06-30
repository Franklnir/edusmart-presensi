import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Loader2,
  LogOut,
  MessageCircle,
  QrCode,
  RefreshCcw,
  Save,
  Send,
  ShieldCheck,
  Smartphone,
  Users
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDateTime } from '../../lib/time'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'

const STATUS_META = {
  connected: {
    label: 'Terhubung',
    badge: 'bg-emerald-100 text-emerald-700 border border-emerald-200'
  },
  awaiting_qr: {
    label: 'Menunggu Scan QR',
    badge: 'bg-amber-100 text-amber-700 border border-amber-200'
  },
  disconnected: {
    label: 'Terputus',
    badge: 'bg-slate-100 text-slate-700 border border-slate-200'
  }
}

const CATEGORY_OPTIONS = [
  {
    key: 'send_attendance',
    title: 'Rekap Alpha Harian',
    description: 'Kirim satu pesan Alpha per siswa per hari ke wali murid.'
  }
]

const RECIPIENT_OPTIONS = [
  { value: 'wali', label: 'Wali murid' },
  { value: 'siswa', label: 'Siswa' },
  { value: 'wali_and_student', label: 'Wali + siswa' }
]

const statusMeta = (status) => STATUS_META[status] || STATUS_META.disconnected

const categoryLabel = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'attendance_alpha_daily') return 'Rekap Alpha Harian'
  if (normalized === 'attendance_problem') return 'Peringatan Presensi'
  if (normalized === 'attendance') return 'Absensi'
  if (normalized === 'profile_update') return 'Perubahan Data'
  if (normalized === 'assignment_missing') return 'Tugas Belum Dikerjakan'
  if (normalized === 'assignment') return 'Tugas'
  if (normalized === 'grade') return 'Nilai'
  if (normalized === 'extracurricular') return 'Ekstrakurikuler'
  if (normalized === 'test') return 'Tes'
  return value || 'Log'
}

const logStatusClass = (status = '') => {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'sent') return 'bg-emerald-100 text-emerald-700'
  if (normalized === 'queued') return 'bg-sky-100 text-sky-700'
  if (normalized === 'skipped') return 'bg-amber-100 text-amber-700'
  return 'bg-rose-100 text-rose-700'
}

const getEvolutionManagerHost = () => {
  const browserRootDomain = getRootDomainFromCurrentHost()
  if (browserRootDomain && browserRootDomain !== 'localhost' && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(browserRootDomain)) {
    return `wa.${browserRootDomain}`
  }

  const rootDomain = String(import.meta.env.VITE_ROOT_DOMAIN || '').trim().toLowerCase()
  if (rootDomain) return `wa.${rootDomain}`

  return ''
}

const getRootDomainFromCurrentHost = () => {
  if (typeof window === 'undefined') return ''

  const host = String(window.location.hostname || '').trim().toLowerCase()
  if (!host || host === 'localhost' || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return host
  }

  const parts = host.split('.').filter(Boolean)
  if (parts.length <= 2) return host

  const lastTwo = parts.slice(-2).join('.')
  const publicSuffixes = new Set([
    'ac.id',
    'biz.id',
    'co.id',
    'go.id',
    'my.id',
    'or.id',
    'sch.id',
    'web.id'
  ])

  return publicSuffixes.has(lastTwo)
    ? parts.slice(-3).join('.')
    : parts.slice(-2).join('.')
}

let qrCodePromise = null
const loadQrCodeLibrary = async () => {
  if (!qrCodePromise) {
    qrCodePromise = import('qrcode').then((mod) => mod.default || mod)
  }

  return qrCodePromise
}

export default function WhatsApp() {
  const { isSuperAdmin } = useAuthStore()

  if (isSuperAdmin) {
    return <SuperWhatsAppCenter />
  }

  return <TenantWhatsAppNotice />
}

function SuperWhatsAppCenter() {
  const { pushToast } = useUIStore()
  const [payload, setPayload] = useState({
    provider: { configured: false, name: 'Gateway WhatsApp', type: 'unknown', central: true },
    stats: {},
    tenants: [],
    logs: [],
    settings: {}
  })
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [sendingTest, setSendingTest] = useState(false)
  const [testForm, setTestForm] = useState({ number: '', message: '' })
  const [qrPreview, setQrPreview] = useState('')
  const lastConnectionStatusRef = useRef('')

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    const { data, error } = await supabase.super.whatsapp({ date })
    if (error) {
      pushToast('error', error.message || 'Gagal memuat WhatsApp pusat')
    } else {
      setPayload(data || {})
    }
    if (!silent) setLoading(false)
  }, [date, pushToast])

  useEffect(() => {
    loadData()
  }, [loadData])

  const applyCentralPayload = useCallback((data) => {
    if (!data) return
    setPayload((prev) => ({
      ...prev,
      central: data,
      provider: {
        ...(prev.provider || {}),
        ...(data.provider || {})
      }
    }))
  }, [])

  const runDailyAlpha = async () => {
    setRunning(true)
    const { data, error } = await supabase.super.runDailyAlphaWhatsApp({ date })
    setRunning(false)
    if (error) {
      pushToast('error', error.message || 'Gagal membuat antrean Alpha harian')
      return
    }
    const summary = data?.summary || {}
    if (summary.ready === false || summary.reason) {
      pushToast(summary.ready === false ? 'warning' : 'success', summary.reason || 'Cek Alpha selesai.')
      loadData({ silent: true })
      return
    }
    pushToast('success', `${summary.queued || 0} pesan Alpha baru masuk antrean, ${summary.skipped || 0} dilewati/dedupe.`)
    loadData({ silent: true })
  }

  const retryFailed = async () => {
    setRetrying(true)
    const { data, error } = await supabase.super.retryFailedWhatsApp()
    setRetrying(false)
    if (error) {
      pushToast('error', error.message || 'Gagal retry pesan gagal')
      return
    }
    const summary = data?.summary || {}
    pushToast(summary.reason ? 'warning' : 'success', summary.reason || `${summary.retried || 0} pesan gagal dimasukkan lagi ke antrean.`)
    loadData({ silent: true })
  }

  const provider = payload.provider || {}
  const central = payload.central || {}
  const integration = central.integration || null
  const stats = payload.stats || {}
  const settings = payload.settings || {}
  const readiness = payload.readiness || {}
  const deliveryPlan = payload.delivery_plan || {}
  const currentStatus = String(integration?.status || 'disconnected').toLowerCase()
  const currentMeta = statusMeta(currentStatus)
  const providerConfigured = Boolean(provider.configured)
  const canGenerateQr = providerConfigured && provider.type !== 'fonnte' && !connecting && currentStatus !== 'connected'
  const connectButtonLabel = currentStatus === 'connected'
    ? 'Sudah Terhubung'
    : (integration?.qr_code || integration?.pairing_code || currentStatus === 'awaiting_qr')
      ? 'Refresh QR'
      : 'Generate QR'
  const configuredEvolutionUrl = String(central.provider?.public_url || provider.public_url || '').trim().replace(/\/+$/, '')
  const evolutionManagerHost = getEvolutionManagerHost()
  const evolutionPublicUrl = integration?.instance_name
    ? `${configuredEvolutionUrl || `https://${evolutionManagerHost}`}/manager/instance/${integration.instance_name}`
    : (configuredEvolutionUrl || `https://${evolutionManagerHost}`)
  const totalRequired = (payload.tenants || []).reduce((sum, tenant) => sum + Number(tenant.required || 0), 0)
  const totalPending = (payload.tenants || []).reduce((sum, tenant) => sum + Number(tenant.pending || 0), 0)

  useEffect(() => {
    const previousStatus = lastConnectionStatusRef.current
    if (previousStatus && previousStatus !== currentStatus) {
      if (previousStatus === 'connected' && currentStatus !== 'connected') {
        pushToast('warning', 'WA pusat terputus. Jika logout dilakukan dari aplikasi WhatsApp, status di sini sudah ikut diperbarui.')
      } else if (currentStatus === 'connected') {
        pushToast('success', 'WA pusat terhubung dan siap mengirim notifikasi.')
      }
    }
    lastConnectionStatusRef.current = currentStatus
  }, [currentStatus, pushToast])

  useEffect(() => {
    if (!integration?.qr_code) {
      setQrPreview('')
      return
    }

    let cancelled = false
    const qrValue = String(integration.qr_code || '').trim()
    if (!qrValue) {
      setQrPreview('')
      return
    }

    if (qrValue.startsWith('data:image/')) {
      setQrPreview(qrValue)
      return
    }

    loadQrCodeLibrary()
      .then((QRCode) =>
        QRCode.toDataURL(qrValue, {
          margin: 1,
          width: 320,
          color: {
            dark: '#0f172a',
            light: '#ffffff'
          }
        })
      )
      .then((url) => {
        if (!cancelled) setQrPreview(url)
      })
      .catch(() => {
        if (!cancelled) setQrPreview('')
      })

    return () => {
      cancelled = true
    }
  }, [integration?.qr_code])

  useEffect(() => {
    const shouldPoll = providerConfigured && provider.type !== 'fonnte' && (currentStatus === 'awaiting_qr' || currentStatus === 'connected')
    if (!shouldPoll) return undefined

    let cancelled = false
    const poll = async () => {
      if (document.hidden) return
      const { data, error } = await supabase.super.syncWhatsApp()
      if (cancelled || error) return
      applyCentralPayload(data)
    }

    const warmupTimer = currentStatus === 'awaiting_qr'
      ? setTimeout(() => {
          poll()
        }, 5000)
      : null
    const timer = setInterval(() => {
      poll()
    }, currentStatus === 'awaiting_qr' ? 5000 : 8000)

    return () => {
      cancelled = true
      if (warmupTimer) clearTimeout(warmupTimer)
      clearInterval(timer)
    }
  }, [applyCentralPayload, currentStatus, provider.type, providerConfigured])

  useEffect(() => {
    const hasLiveDelivery = Number(stats.queued || 0) > 0 || totalPending > 0 || running || retrying
    if (!hasLiveDelivery) return undefined

    const timer = setInterval(() => {
      if (!document.hidden) {
        loadData({ silent: true })
      }
    }, 15000)

    return () => clearInterval(timer)
  }, [loadData, retrying, running, stats.queued, totalPending])

  const connectCentral = async () => {
    setConnecting(true)
    const { data, error } = await supabase.super.connectWhatsApp()
    setConnecting(false)

    if (error) {
      pushToast('error', error.message || 'Gagal menyiapkan QR WhatsApp pusat')
      return
    }

    applyCentralPayload(data)
    const nextIntegration = data?.integration
    if (nextIntegration?.qr_code || nextIntegration?.pairing_code) {
      pushToast('success', 'QR WA pusat siap dipindai')
      return
    }
    if (nextIntegration?.last_error) {
      pushToast('warning', nextIntegration.last_error)
      return
    }
    pushToast('info', 'Gateway sedang menyiapkan QR. Klik Sinkronkan jika QR belum muncul.')
  }

  const syncCentral = async () => {
    setSyncing(true)
    const { data, error } = await supabase.super.syncWhatsApp()
    setSyncing(false)

    if (error) {
      pushToast('error', error.message || 'Gagal sinkron status WA pusat')
      return
    }

    applyCentralPayload(data)
    if (data?.integration?.last_error) {
      pushToast('warning', data.integration.last_error)
      return
    }
    pushToast('success', 'Status WA pusat berhasil disinkronkan')
  }

  const logoutCentral = async () => {
    const confirmed = window.confirm('Logout WhatsApp pusat sekarang? QR dan sesi aktif akan dibersihkan.')
    if (!confirmed) return

    setLoggingOut(true)
    const { data, error } = await supabase.super.logoutWhatsApp()
    setLoggingOut(false)

    if (error) {
      pushToast('error', error.message || 'Gagal logout WA pusat')
      return
    }

    applyCentralPayload(data)
    pushToast('success', 'WA pusat berhasil logout')
  }

  const sendCentralTest = async (event) => {
    event.preventDefault()
    if (!testForm.number.trim()) {
      pushToast('error', 'Nomor tujuan tes wajib diisi')
      return
    }

    if (!providerConfigured || (provider.type !== 'fonnte' && currentStatus !== 'connected')) {
      pushToast('warning', 'Hubungkan WA pusat sampai Terhubung sebelum kirim tes.')
      return
    }

    setSendingTest(true)
    const { data, error } = await supabase.super.sendWhatsAppTest(testForm)
    setSendingTest(false)

    if (error) {
      pushToast('error', error.message || 'Gagal mengirim tes WA')
      return
    }

    setPayload((prev) => ({
      ...prev,
      central: {
        ...(prev.central || {}),
        logs: data?.log ? [data.log, ...((prev.central || {}).logs || [])].slice(0, 30) : ((prev.central || {}).logs || [])
      }
    }))
    setTestForm((prev) => ({ ...prev, message: '' }))
    pushToast('success', 'Pesan tes masuk ke antrean pengiriman')
  }

  const handleToggleTenant = async (tenantId, currentEnabled) => {
    const nextEnabled = !currentEnabled
    setPayload((prev) => {
      if (!prev.tenants) return prev
      return {
        ...prev,
        tenants: prev.tenants.map(t => 
          t.tenant_id === tenantId ? { ...t, is_enabled: nextEnabled, _toggling: true } : t
        )
      }
    })

    const { error } = await supabase.super.updateWhatsAppTenantStatus({
      tenant_id: tenantId,
      is_enabled: nextEnabled
    })

    if (error) {
      pushToast('error', error.message || 'Gagal mengubah status WA sekolah')
      setPayload((prev) => {
        if (!prev.tenants) return prev
        return {
          ...prev,
          tenants: prev.tenants.map(t => 
            t.tenant_id === tenantId ? { ...t, is_enabled: currentEnabled, _toggling: false } : t
          )
        }
      })
      return
    }

    pushToast('success', nextEnabled ? 'Notifikasi sekolah diaktifkan' : 'Notifikasi sekolah dinonaktifkan')
    setPayload((prev) => {
      if (!prev.tenants) return prev
      return {
        ...prev,
        tenants: prev.tenants.map(t => 
          t.tenant_id === tenantId ? { ...t, _toggling: false } : t
        )
      }
    })
  }

  return (
    <div className="page-wrapper space-y-6">
      <section className="page-title-card flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">
            <ShieldCheck className="h-4 w-4" />
            WhatsApp Pusat
          </div>
          <h1 className="page-title-heading mt-3">WA Gateway Alpha Multi Sekolah</h1>
          <p className="page-title-description max-w-3xl">
            Satu nomor Baileys/Evolution milik Super Admin mengirim rekap Alpha harian ke wali murid. Satu siswa hanya menerima satu pesan per hari berisi daftar mapel yang Alpha.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
          />
          <button
            type="button"
            onClick={() => loadData()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            Refresh
          </button>
        </div>
      </section>

      {!provider.configured && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
          Gateway WhatsApp belum aktif. Untuk saat ini gunakan `WHATSAPP_PROVIDER=evolution`, isi `EVOLUTION_API_BASE_URL` dan `EVOLUTION_API_KEY`, lalu clear config/restart backend.
        </div>
      )}

      {central.error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
          {central.error}
        </div>
      )}

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-slate-900">Koneksi Nomor Pusat</h2>
                <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${currentMeta.badge}`}>
                  {currentMeta.label}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                Scan QR ini memakai instance pusat Super Admin. Nomor ini dipakai untuk semua notifikasi Alpha multi sekolah.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={connectCentral}
                disabled={!canGenerateQr}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                {connectButtonLabel}
              </button>
              <button
                type="button"
                onClick={syncCentral}
                disabled={syncing || !providerConfigured || provider.type === 'fonnte'}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                Sinkronkan
              </button>
              <button
                type="button"
                onClick={logoutCentral}
                disabled={loggingOut || !integration || provider.type === 'fonnte'}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                Logout
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <InfoCard
              icon={MessageCircle}
              label="Instance"
              value={integration?.instance_name || '-'}
              helper={central.school?.slug ? `${central.school.slug}.anchor` : 'Nomor pusat'}
            />
            <InfoCard
              icon={Smartphone}
              label="Nomor Terhubung"
              value={integration?.connected_phone || '-'}
              helper={integration?.connected_name || 'Belum ada perangkat aktif'}
            />
            <InfoCard
              icon={CheckCircle2}
              label="Sync Terakhir"
              value={formatDateTime(integration?.last_synced_at)}
              helper={`Webhook: ${integration?.last_webhook_event || '-'}`}
            />
          </div>

          {provider.type !== 'fonnte' && (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Host manager Evolution: <span className="font-semibold text-slate-900">{evolutionPublicUrl || '-'}</span>
            </div>
          )}

          {integration?.last_error && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {integration.last_error}
            </div>
          )}

          <div className="mt-5 grid gap-5 lg:grid-cols-[340px_1fr]">
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <QrCode className="h-4 w-4" />
                QR Scan WA Pusat
              </div>
              {qrPreview ? (
                <div className="rounded-2xl bg-white p-4 shadow-sm">
                  <img src={qrPreview} alt="QR WhatsApp pusat" className="mx-auto h-auto w-full max-w-[320px]" />
                </div>
              ) : (
                <div className="grid min-h-[320px] place-items-center rounded-2xl bg-white px-6 text-center text-sm text-slate-500 shadow-sm">
                  Klik Generate QR untuk membuat sesi scan. Jika QR belum tampil, tunggu beberapa detik lalu klik Sinkronkan.
                </div>
              )}
              {integration?.pairing_code && (
                <div className="mt-3 rounded-2xl bg-white px-4 py-3 text-xs text-slate-500 shadow-sm">
                  Pairing code: <span className="font-semibold text-slate-800">{integration.pairing_code}</span>
                </div>
              )}
            </div>

            <form onSubmit={sendCentralTest} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <h3 className="text-base font-semibold text-slate-900">Tes Kirim Pesan</h3>
              <p className="mt-1 text-sm text-slate-600">
                Pakai ini untuk memastikan nomor pusat dan queue bisa mengirim pesan sebelum notifikasi Alpha dijalankan.
              </p>
              <label className="mt-4 block space-y-2">
                <span className="text-sm font-semibold text-slate-700">Nomor Tujuan</span>
                <input
                  type="text"
                  value={testForm.number}
                  onChange={(event) => setTestForm((prev) => ({ ...prev, number: event.target.value }))}
                  placeholder="contoh: 081234567890"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                />
              </label>
              <label className="mt-4 block space-y-2">
                <span className="text-sm font-semibold text-slate-700">Pesan Opsional</span>
                <textarea
                  rows={4}
                  value={testForm.message}
                  onChange={(event) => setTestForm((prev) => ({ ...prev, message: event.target.value }))}
                  placeholder="Kosongkan untuk memakai template tes bawaan."
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                />
              </label>
              <button
                type="submit"
                disabled={sendingTest || !providerConfigured || (provider.type !== 'fonnte' && currentStatus !== 'connected')}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sendingTest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Kirim Tes
              </button>
              {provider.type !== 'fonnte' && currentStatus !== 'connected' && (
                <p className="mt-2 text-xs text-slate-500">Tes aktif setelah QR berhasil dipindai dan status menjadi Terhubung.</p>
              )}
            </form>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Log Nomor Pusat</h2>
          <div className="mt-4 space-y-3">
            {(central.logs || []).length ? central.logs.slice(0, 6).map((item) => (
              <article key={item.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                        {categoryLabel(item.category)}
                      </span>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${logStatusClass(item.status)}`}>
                        {item.status || 'unknown'}
                      </span>
                    </div>
                    <div className="mt-2 text-sm font-bold text-slate-900">{item.target_name || 'Tujuan tidak dikenal'}</div>
                    <div className="mt-1 text-xs text-slate-500">{item.target_phone || item.normalized_phone || '-'} • {formatDateTime(item.created_at)}</div>
                  </div>
                  <div className="text-xs text-slate-500">Attempts: {item.attempt_count || 0}</div>
                </div>
                {item.last_error && (
                  <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{item.last_error}</div>
                )}
              </article>
            )) : (
              <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
                Belum ada log nomor pusat.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <CenterStat icon={MessageCircle} label="Provider" value={provider.name || '-'} helper={provider.central ? 'Nomor pusat aktif' : 'Per tenant'} />
        <CenterStat icon={Users} label="Harus Dikirim" value={totalRequired} helper="Siswa Alpha unik" tone="sky" />
        <CenterStat icon={CheckCircle2} label="Terkirim" value={stats.sent || 0} helper="Ke wali murid" tone="emerald" />
        <CenterStat icon={Clock3} label="Belum Diproses" value={totalPending} helper={readiness.ready ? 'Siap diproses' : 'Menunggu jam selesai'} tone="amber" />
        <CenterStat icon={AlertTriangle} label="Gagal" value={stats.failed || 0} helper="Bisa retry manual" tone="rose" />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Aturan Kirim Alpha</h2>
            <p className="mt-1 text-sm text-slate-600">
              Mulai bekerja tepat pada pukul 17.55 WIB. Jika pesan sedikit, dikirim tiap {settings.fast_interval_seconds || 15} detik sampai jam {settings.fast_max_send_hour || 23}.00. Jika banyak, disebar sampai jam {settings.batch_max_send_hour || 21}.00.
              Gateway juga punya jeda global minimal {settings.send_min_interval_seconds || 6} detik per nomor pusat supaya antrean aman dan tidak menumpuk di Baileys.
            </p>
            <div className={`mt-3 rounded-2xl px-4 py-3 text-sm ${readiness.ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
              <b>{readiness.ready ? 'Siap diproses.' : 'Belum waktunya kirim.'}</b> {readiness.reason || '-'}
              {readiness.next_run_at && <span> Coba otomatis sekitar {formatDateTime(readiness.next_run_at)}.</span>}
              {deliveryPlan.send_until && <span> Mode {deliveryPlan.mode || '-'}, batas kirim {formatDateTime(deliveryPlan.send_until)}.</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={runDailyAlpha}
              disabled={running}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
              Proses Alpha
            </button>
            <button
              type="button"
              onClick={retryFailed}
              disabled={retrying}
              className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-60"
            >
              {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              Retry Gagal
            </button>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="grid min-h-[36vh] place-items-center rounded-3xl border border-slate-200 bg-white">
          <div className="inline-flex items-center gap-3 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            Memuat data WhatsApp pusat...
          </div>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Status per Sekolah</h2>
            <div className="mt-4 grid gap-3">
              {(payload.tenants || []).length ? payload.tenants.map((tenant) => (
                <article key={tenant.tenant_id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-bold text-slate-900">{tenant.tenant_name || tenant.tenant_slug || 'Sekolah'}</div>
                      <div className="flex items-center gap-2">
                        <div className="text-xs text-slate-500">{tenant.tenant_slug || tenant.tenant_id}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{tenant.required || 0} siswa Alpha</span>
                      <button
                        type="button"
                        onClick={() => handleToggleTenant(tenant.tenant_id, tenant.is_enabled)}
                        disabled={tenant._toggling}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${tenant.is_enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
                        aria-pressed={tenant.is_enabled}
                        title={tenant.is_enabled ? "Nonaktifkan WhatsApp Sekolah" : "Aktifkan WhatsApp Sekolah"}
                      >
                        <span className="sr-only">Toggle status WhatsApp sekolah</span>
                        <span
                          aria-hidden="true"
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${tenant.is_enabled ? 'translate-x-5' : 'translate-x-0'}`}
                        >
                          {tenant._toggling && (
                            <Loader2 className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 animate-spin text-slate-400" />
                          )}
                        </span>
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs font-bold sm:grid-cols-5">
                    <MiniPill label="Harus Kirim" value={tenant.required} tone="sky" />
                    <MiniPill label="Belum" value={tenant.pending} tone="amber" />
                    <MiniPill label="Terkirim" value={tenant.sent} tone="emerald" />
                    <MiniPill label="Antrean" value={tenant.queued} tone="sky" />
                    <MiniPill label="Gagal" value={tenant.failed} tone="rose" />
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                    <div>Terakhir terkirim: <b>{tenant.latest_sent_at ? formatDateTime(tenant.latest_sent_at) : '-'}</b></div>
                    <div>Terakhir gagal: <b>{tenant.latest_failed_at ? formatDateTime(tenant.latest_failed_at) : '-'}</b></div>
                  </div>
                  {(tenant.failures || []).length > 0 && (
                    <div className="mt-3 space-y-2">
                      {(tenant.failures || []).map((failure) => (
                        <div key={failure.id} className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
                          <b>{failure.target_name || 'Tujuan tidak dikenal'}</b> - {failure.last_error || 'Gagal dikirim.'}
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              )) : (
                <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
                  Belum ada log WA untuk tanggal ini.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Log Pengiriman Terbaru</h2>
            <div className="mt-4 space-y-3">
              {(payload.logs || []).length ? payload.logs.map((item) => (
                <article key={item.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                          {item.tenant_name || item.tenant_slug || 'Sekolah'}
                        </span>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${logStatusClass(item.status)}`}>
                          {item.status || 'unknown'}
                        </span>
                      </div>
                      <div className="mt-2 text-sm font-bold text-slate-900">{item.target_name || 'Tujuan tidak dikenal'}</div>
                      <div className="mt-1 text-xs text-slate-500">{item.target_phone || item.normalized_phone || '-'} • {formatDateTime(item.created_at)}</div>
                    </div>
                    <div className="text-xs text-slate-500 md:text-right">Attempts: {item.attempt_count || 0}</div>
                  </div>
                  {item.last_error && (
                    <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{item.last_error}</div>
                  )}
                  {item.message_text && (
                    <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-700">{item.message_text}</pre>
                  )}
                </article>
              )) : (
                <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
                  Belum ada log pengiriman.
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function TenantWhatsAppNotice() {
  return (
    <div className="page-wrapper">
      <section className="page-title-card">
        <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-slate-600">
          <ShieldCheck className="h-4 w-4" />
          Dikelola Pusat
        </div>
        <h1 className="page-title-heading mt-3">WhatsApp dikelola Super Admin</h1>
        <p className="page-title-description max-w-3xl">
          Notifikasi WhatsApp memakai satu nomor pusat agar lebih stabil dan tidak membebani setiap sekolah. Admin sekolah cukup memastikan nomor wali murid di data siswa sudah benar.
        </p>
      </section>
    </div>
  )
}

function LegacyTenantWhatsApp() {
  const { pushToast } = useUIStore()
  const [payload, setPayload] = useState({
    integration: null,
    settings: null,
    logs: [],
    provider: { configured: false, name: 'Evolution API' },
    school: {}
  })
  const [settingsForm, setSettingsForm] = useState({
    is_enabled: true,
    send_attendance: true,
    send_profile_updates: false,
    send_assignment_updates: false,
    send_extracurricular_updates: false,
    send_grade_updates: false,
    recipient_mode: 'wali'
  })
  const [testForm, setTestForm] = useState({ number: '', message: '' })
  const [qrPreview, setQrPreview] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [sendingTest, setSendingTest] = useState(false)

  const integration = payload.integration
  const providerConfigured = Boolean(payload.provider?.configured)
  const currentStatus = String(integration?.status || 'disconnected').toLowerCase()
  const currentMeta = statusMeta(currentStatus)
  const canGenerateQr = providerConfigured && !connecting && currentStatus !== 'connected'
  const connectButtonLabel = currentStatus === 'connected'
    ? 'Sudah Terhubung'
    : (integration?.qr_code || integration?.pairing_code || currentStatus === 'awaiting_qr')
      ? 'Refresh QR'
      : 'Generate QR'
  const configuredEvolutionUrl = String(payload.provider?.public_url || '').trim().replace(/\/+$/, '')
  const evolutionManagerHost = getEvolutionManagerHost()
  const evolutionPublicUrl = integration?.instance_name
    ? `${configuredEvolutionUrl || `https://${evolutionManagerHost}`}/manager/instance/${integration.instance_name}`
    : (configuredEvolutionUrl || `https://${evolutionManagerHost}`)

  const applyPayload = useCallback((nextData) => {
    const nextPayload = nextData || {
      integration: null,
      settings: null,
      logs: [],
      provider: { configured: false, name: 'Evolution API' },
      school: {}
    }
    setPayload(nextPayload)

    const nextSettings = nextPayload?.settings
    if (nextSettings) {
      setSettingsForm({
        is_enabled: Boolean(nextSettings.is_enabled),
        send_attendance: Boolean(nextSettings.send_attendance),
        send_profile_updates: Boolean(nextSettings.send_profile_updates),
        send_assignment_updates: Boolean(nextSettings.send_assignment_updates),
        send_extracurricular_updates: Boolean(nextSettings.send_extracurricular_updates),
        send_grade_updates: Boolean(nextSettings.send_grade_updates),
        recipient_mode: nextSettings.recipient_mode || 'wali'
      })
    }
  }, [])

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    const { data, error } = await supabase.admin.whatsapp()
    if (error) {
      pushToast('error', error.message || 'Gagal memuat status WhatsApp')
    } else {
      applyPayload(data)
    }
    if (!silent) setLoading(false)
  }, [applyPayload, pushToast])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    if (!integration?.qr_code) {
      setQrPreview('')
      return
    }

    let cancelled = false
    const qrValue = String(integration.qr_code || '').trim()
    if (!qrValue) {
      setQrPreview('')
      return
    }

    if (qrValue.startsWith('data:image/')) {
      setQrPreview(qrValue)
      return
    }

    loadQrCodeLibrary()
      .then((QRCode) =>
        QRCode.toDataURL(qrValue, {
          margin: 1,
          width: 320,
          color: {
            dark: '#0f172a',
            light: '#ffffff'
          }
        })
      )
      .then((url) => {
        if (!cancelled) setQrPreview(url)
      })
      .catch(() => {
        if (!cancelled) setQrPreview('')
      })

    return () => {
      cancelled = true
    }
  }, [integration?.qr_code])

  useEffect(() => {
    const shouldPoll = providerConfigured && (currentStatus === 'awaiting_qr' || currentStatus === 'connected')
    if (!shouldPoll) return undefined

    let cancelled = false
    const poll = async () => {
      if (document.hidden) return
      const { data, error } = await supabase.admin.syncWhatsApp()
      if (cancelled || error) return
      applyPayload(data)
    }

    const warmupTimer = currentStatus === 'awaiting_qr'
      ? setTimeout(() => {
          poll()
        }, 5000)
      : null
    const intervalMs = currentStatus === 'awaiting_qr' ? 10000 : 30000
    const timer = setInterval(() => {
      poll()
    }, intervalMs)

    return () => {
      cancelled = true
      if (warmupTimer) clearTimeout(warmupTimer)
      clearInterval(timer)
    }
  }, [applyPayload, currentStatus, providerConfigured])

  const stats = useMemo(() => {
    const logs = Array.isArray(payload.logs) ? payload.logs : []
    return {
      sent: logs.filter((item) => item.status === 'sent').length,
      queued: logs.filter((item) => item.status === 'queued').length,
      failed: logs.filter((item) => item.status === 'failed').length
    }
  }, [payload.logs])

  const updateSettings = (key) => (event) => {
    const nextValue = event?.target?.type === 'checkbox'
      ? event.target.checked
      : event?.target?.value
    setSettingsForm((prev) => ({ ...prev, [key]: nextValue }))
  }

  const handleConnect = async () => {
    setConnecting(true)
    const { data, error } = await supabase.admin.connectWhatsApp()
    setConnecting(false)

    if (error) {
      pushToast('error', error.message || 'Gagal menyiapkan QR WhatsApp')
      return
    }

    applyPayload(data)
    const nextIntegration = data?.integration

    if (nextIntegration?.qr_code || nextIntegration?.pairing_code) {
      pushToast('success', 'QR WhatsApp siap dipindai oleh admin sekolah')
      if (nextIntegration?.last_error) {
        window.setTimeout(() => {
          pushToast('warning', nextIntegration.last_error)
        }, 350)
      }
      return
    }

    if (nextIntegration?.last_error) {
      pushToast('warning', nextIntegration.last_error)
      return
    }

    if (nextIntegration?.status === 'awaiting_qr') {
      pushToast('info', 'Gateway sedang menyiapkan QR. Sinkronkan lagi jika belum muncul dalam beberapa detik.')
      return
    }

    pushToast('success', 'Status koneksi WhatsApp berhasil diperbarui')
  }

  const handleSync = async () => {
    setSyncing(true)
    const { data, error } = await supabase.admin.syncWhatsApp()
    setSyncing(false)

    if (error) {
      pushToast('error', error.message || 'Gagal sinkron status WhatsApp')
      return
    }

    applyPayload(data)
    if (data?.integration?.last_error) {
      pushToast('warning', data.integration.last_error)
      return
    }

    pushToast('success', 'Status WhatsApp berhasil disinkronkan')
  }

  const handleLogout = async () => {
    const confirmed = window.confirm('Logout WhatsApp tenant ini sekarang? QR lama akan dibersihkan.')
    if (!confirmed) return

    setLoggingOut(true)
    const { data, error } = await supabase.admin.logoutWhatsApp()
    setLoggingOut(false)

    if (error) {
      pushToast('error', error.message || 'Gagal logout WhatsApp')
      return
    }

    applyPayload(data)
    pushToast('success', 'WhatsApp berhasil logout dan state lokal dibersihkan')
  }

  const handleSaveSettings = async () => {
    setSaving(true)
    const { data, error } = await supabase.admin.updateWhatsAppSettings(settingsForm)
    setSaving(false)

    if (error) {
      pushToast('error', error.message || 'Gagal menyimpan pengaturan notifikasi')
      return
    }

    setPayload((prev) => ({ ...prev, settings: data?.settings || prev.settings }))
    pushToast('success', 'Pengaturan notifikasi WhatsApp tersimpan')
  }

  const handleSendTest = async (event) => {
    event.preventDefault()
    if (!testForm.number.trim()) {
      pushToast('error', 'Nomor tujuan tes wajib diisi')
      return
    }

    if (!providerConfigured || currentStatus !== 'connected') {
      pushToast('warning', 'Hubungkan WhatsApp sampai status Terhubung sebelum kirim pesan tes.')
      return
    }

    setSendingTest(true)
    const { data, error } = await supabase.admin.sendWhatsAppTest(testForm)
    setSendingTest(false)

    if (error) {
      pushToast('error', error.message || 'Gagal mengirim tes WhatsApp')
      return
    }

    if (data?.log) {
      setPayload((prev) => ({
        ...prev,
        logs: [data.log, ...(prev.logs || [])].slice(0, 30)
      }))
    }
    setTestForm((prev) => ({ ...prev, message: '' }))
    pushToast('success', 'Pesan tes masuk ke antrean pengiriman')
  }

  return (
    <div className="p-6 space-y-6">
        <div className="page-title-card whatsapp-page-header flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="whatsapp-page-eyebrow inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
              <ShieldCheck className="h-4 w-4" />
              Notifikasi Tenant
            </div>
            <h1 className="whatsapp-page-title page-title-heading mt-3">WhatsApp Sekolah</h1>
            <p className="whatsapp-page-description page-title-description max-w-3xl">
              Hubungkan WhatsApp per sekolah via QR, atur jenis notifikasi yang dikirim,
              dan pantau log pengiriman agar operasional admin tetap stabil.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${currentMeta.badge}`}>
              {currentMeta.label}
            </span>
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing || loading}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              Sinkronkan
            </button>
          </div>
        </div>

        {!providerConfigured && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
            `EVOLUTION_API_BASE_URL` dan `EVOLUTION_API_KEY` belum terpasang di backend, jadi koneksi QR belum bisa dijalankan.
          </div>
        )}

        {loading ? (
          <div className="grid min-h-[40vh] place-items-center rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="inline-flex items-center gap-3 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              Memuat modul WhatsApp...
            </div>
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[1.25fr_0.95fr]">
            <div className="space-y-6">
              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">Koneksi WhatsApp</h2>
                    <p className="mt-2 text-sm text-slate-600">
                      Instance akan dipisahkan per tenant/sekolah, jadi satu VPS tetap aman selama state koneksinya per sekolah.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleConnect}
                      disabled={!canGenerateQr}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                      {connectButtonLabel}
                    </button>

                    <button
                      type="button"
                      onClick={handleLogout}
                      disabled={loggingOut || !integration}
                      className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {loggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                      Logout
                    </button>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  <InfoCard
                    icon={MessageCircle}
                    label="Instance"
                    value={integration?.instance_name || '-'}
                    helper={payload.school?.slug ? `${payload.school.slug}.tenant` : 'Belum dibuat'}
                  />
                  <InfoCard
                    icon={Smartphone}
                    label="Nomor Terhubung"
                    value={integration?.connected_phone || '-'}
                    helper={integration?.connected_name || 'Belum ada perangkat aktif'}
                  />
                  <InfoCard
                    icon={CheckCircle2}
                    label="Sync Terakhir"
                    value={formatDateTime(integration?.last_synced_at)}
                    helper={`Webhook: ${integration?.last_webhook_event || '-'}`}
                  />
                </div>

                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  Host manager Evolution:
                  {' '}
                  <span className="font-semibold text-slate-900">{evolutionPublicUrl}</span>
                </div>

                {integration?.last_error && (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    {integration.last_error}
                  </div>
                )}

                <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
                  <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <QrCode className="h-4 w-4" />
                      QR Scan Tenant
                    </div>

                    {qrPreview ? (
                      <div className="rounded-2xl bg-white p-4 shadow-sm">
                        <img src={qrPreview} alt="QR WhatsApp" className="mx-auto h-auto w-full max-w-[320px]" />
                      </div>
                    ) : (
                      <div className="grid min-h-[320px] place-items-center rounded-2xl bg-white px-6 text-center text-sm text-slate-500 shadow-sm">
                        QR akan tampil di sini setelah admin menekan tombol generate. Jika belum muncul dalam 10-20 detik, klik Sinkronkan atau Generate QR ulang untuk membuat sesi scan baru.
                      </div>
                    )}

                    {integration?.pairing_code && (
                      <div className="mt-3 rounded-2xl bg-white px-4 py-3 text-xs text-slate-500 shadow-sm">
                        Pairing code: <span className="font-semibold text-slate-800">{integration.pairing_code}</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-4 rounded-3xl bg-slate-900 p-6 text-white">
                    <div>
                      <div className="text-sm uppercase tracking-[0.2em] text-slate-400">Stabilitas</div>
                      <h3 className="mt-2 text-2xl font-bold">State QR dan logout dibuat konsisten</h3>
                    </div>

                    <ul className="space-y-3 text-sm text-slate-200">
                      <li className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                        QR lama dibersihkan saat koneksi sudah `connected` atau saat admin menekan logout.
                      </li>
                      <li className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                        Status koneksi disinkronkan dari webhook dan scheduler supaya tidak nyangkut di UI.
                      </li>
                      <li className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                        Pengiriman masuk antrean queue dan presensi normal tidak dikirim WA, jadi scan serentak tetap ringan.
                      </li>
                    </ul>
                  </div>
                </div>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">Jenis Notifikasi</h2>
                    <p className="mt-2 text-sm text-slate-600">
                      Pilih notifikasi penting yang boleh dikirim ke wali murid atau siswa.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveSettings}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Simpan
                  </button>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  {CATEGORY_OPTIONS.map((item) => (
                    <label
                      key={item.key}
                      className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 p-4 transition hover:border-emerald-200 hover:bg-emerald-50/40"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(settingsForm[item.key])}
                        onChange={updateSettings(item.key)}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <div>
                        <div className="font-semibold text-slate-900">{item.title}</div>
                        <div className="mt-1 text-sm text-slate-600">{item.description}</div>
                      </div>
                    </label>
                  ))}
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-slate-700">Tujuan Pengiriman</span>
                    <select
                      value={settingsForm.recipient_mode}
                      onChange={updateSettings('recipient_mode')}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                    >
                      {RECIPIENT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={Boolean(settingsForm.is_enabled)}
                      onChange={updateSettings('is_enabled')}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <div>
                      <div className="font-semibold text-slate-900">Master switch aktif</div>
                      <div className="text-sm text-slate-600">
                        Matikan ini bila sekolah ingin menghentikan semua notif sementara.
                      </div>
                    </div>
                  </label>
                </div>

              </section>
            </div>

            <div className="space-y-6">
              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="grid gap-4 sm:grid-cols-3">
                  <MiniStat label="Terkirim" value={stats.sent} tone="emerald" />
                  <MiniStat label="Antrean" value={stats.queued} tone="sky" />
                  <MiniStat label="Gagal" value={stats.failed} tone="rose" />
                </div>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Tes Pengiriman</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Pakai ini untuk memastikan tenant dan queue benar-benar bisa mengirim ke nomor tujuan.
                  </p>
                </div>

                <form onSubmit={handleSendTest} className="mt-5 space-y-4">
                  <label className="block space-y-2">
                    <span className="text-sm font-semibold text-slate-700">Nomor Tujuan</span>
                    <input
                      type="text"
                      value={testForm.number}
                      onChange={(event) => setTestForm((prev) => ({ ...prev, number: event.target.value }))}
                      placeholder="contoh: 081234567890"
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                    />
                  </label>

                  <label className="block space-y-2">
                    <span className="text-sm font-semibold text-slate-700">Pesan Opsional</span>
                    <textarea
                      rows={4}
                      value={testForm.message}
                      onChange={(event) => setTestForm((prev) => ({ ...prev, message: event.target.value }))}
                      placeholder="Kosongkan untuk memakai template tes bawaan."
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                    />
                  </label>

                  <button
                    type="submit"
                    disabled={sendingTest || !providerConfigured || currentStatus !== 'connected'}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {sendingTest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Kirim Tes
                  </button>

                  {currentStatus !== 'connected' && (
                    <p className="text-xs text-slate-500">
                      Pesan tes aktif setelah QR berhasil dipindai dan status berubah menjadi Terhubung.
                    </p>
                  )}
                </form>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">Log Pengiriman</h2>
                    <p className="mt-2 text-sm text-slate-600">
                      Riwayat ini membantu admin tahu apakah pesan sudah terkirim, antre, gagal, atau dilewati.
                    </p>
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  {payload.logs?.length ? payload.logs.map((item) => (
                    <article key={item.id} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                              {categoryLabel(item.category)}
                            </span>
                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${logStatusClass(item.status)}`}>
                              {item.status || 'unknown'}
                            </span>
                          </div>
                          <div className="mt-2 text-sm font-semibold text-slate-900">
                            {item.target_name || 'Tujuan tidak dikenal'}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {item.target_phone || 'Nomor kosong'} • {formatDateTime(item.created_at)}
                          </div>
                        </div>

                        <div className="text-xs text-slate-500 md:text-right">
                          <div>Source: {item.source_table || '-'}</div>
                          <div>Attempts: {item.attempt_count || 0}</div>
                        </div>
                      </div>

                      {item.last_error && (
                        <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
                          {item.last_error}
                        </div>
                      )}

                      {item.message_text && (
                        <div className="mt-3 rounded-xl bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-700">
                          {item.message_text}
                        </div>
                      )}
                    </article>
                  )) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
                      Belum ada log pengiriman WhatsApp untuk tenant ini.
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}
    </div>
  )
}

function InfoCard({ icon: Icon, label, value, helper }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-600">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="mt-3 text-lg font-bold text-slate-900">{value || '-'}</div>
      <div className="mt-1 text-xs text-slate-500">{helper || '-'}</div>
    </div>
  )
}

function MiniStat({ label, value, tone = 'slate' }) {
  const toneMap = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    sky: 'bg-sky-50 text-sky-700 border-sky-100',
    rose: 'bg-rose-50 text-rose-700 border-rose-100',
    slate: 'bg-slate-50 text-slate-700 border-slate-100'
  }

  return (
    <div className={`rounded-2xl border px-4 py-4 ${toneMap[tone] || toneMap.slate}`}>
      <div className="text-sm font-semibold">{label}</div>
      <div className="mt-2 text-3xl font-bold">{value ?? 0}</div>
    </div>
  )
}

function CenterStat({ icon: Icon, label, value, helper, tone = 'slate' }) {
  const toneMap = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    sky: 'bg-sky-50 text-sky-700 border-sky-100',
    rose: 'bg-rose-50 text-rose-700 border-rose-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    slate: 'bg-white text-slate-700 border-slate-200'
  }

  return (
    <div className={`rounded-3xl border p-5 shadow-sm ${toneMap[tone] || toneMap.slate}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-bold uppercase tracking-[0.14em] opacity-80">{label}</div>
        <Icon className="h-5 w-5 opacity-80" />
      </div>
      <div className="mt-3 text-2xl font-black text-slate-950">{value ?? 0}</div>
      <div className="mt-1 text-xs font-semibold opacity-75">{helper || '-'}</div>
    </div>
  )
}

function MiniPill({ label, value, tone = 'slate' }) {
  const toneMap = {
    emerald: 'bg-emerald-50 text-emerald-700',
    sky: 'bg-sky-50 text-sky-700',
    rose: 'bg-rose-50 text-rose-700',
    amber: 'bg-amber-50 text-amber-700',
    slate: 'bg-slate-50 text-slate-700'
  }

  return (
    <div className={`rounded-xl px-2 py-2 ${toneMap[tone] || toneMap.slate}`}>
      <div>{value || 0}</div>
      <div className="font-semibold opacity-75">{label}</div>
    </div>
  )
}
