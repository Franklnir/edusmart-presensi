import React, { useEffect, useRef, useState } from 'react'
import {
  Activity,
  Cpu,
  Gauge,
  Globe2,
  HardDrive,
  MemoryStick,
  Network,
  RefreshCw,
  Server
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { formatDateTime } from '../../lib/time'

const numberFormatter = new Intl.NumberFormat('id-ID')
const formatNumber = (value) => numberFormatter.format(Number(value || 0))
const formatBytesPerSecond = (value) => {
  const bytes = Math.max(0, Number(value || 0))
  if (bytes < 1024) return `${Math.round(bytes)} B/s`
  if (bytes < 1024 * 1024) return `${Math.round((bytes / 1024) * 10) / 10} KB/s`
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB/s`
}

function PageGate({ superAdminChecked, isSuperAdmin, children }) {
  if (!superAdminChecked) return <div className="p-6 text-sm text-slate-500">Memuat akses super admin...</div>
  if (!isSuperAdmin) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Halaman ini hanya untuk super admin.
        </div>
      </div>
    )
  }
  return children
}

function MetricCard({ label, value, hint, icon: Icon, percent, tone = 'indigo' }) {
  const safePercent = percent === null || percent === undefined ? null : Math.max(0, Math.min(100, Number(percent || 0)))
  const colorClass = {
    indigo: 'bg-indigo-50 text-indigo-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-700',
    sky: 'bg-sky-50 text-sky-700'
  }[tone] || 'bg-indigo-50 text-indigo-700'

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-2 break-words text-2xl font-semibold text-slate-950">{value}</p>
        </div>
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${colorClass}`}>
          <Icon size={19} />
        </span>
      </div>
      {safePercent !== null ? (
        <div className="mt-4 h-2 rounded-full bg-slate-100">
          <div className="h-2 rounded-full bg-indigo-600" style={{ width: `${safePercent}%` }} />
        </div>
      ) : null}
      {hint ? <p className="mt-3 text-sm text-slate-500">{hint}</p> : null}
    </div>
  )
}

function HealthGauge({ score = 0, statusLabel = '-' }) {
  const safeScore = Math.max(0, Math.min(100, Number(score || 0)))
  return (
    <section className="rounded-2xl border border-slate-100 bg-slate-950 p-6 text-white shadow-card">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-200">Health Score</p>
          <h2 className="mt-2 text-4xl font-black">{safeScore}/100</h2>
          <p className="mt-2 text-sm text-slate-300">Status: <span className="font-bold text-white">{statusLabel}</span></p>
        </div>
        <div
          className="grid h-36 w-36 place-items-center rounded-full"
          style={{ background: `conic-gradient(#34d399 ${safeScore * 3.6}deg, rgba(148,163,184,.22) 0deg)` }}
        >
          <div className="grid h-24 w-24 place-items-center rounded-full bg-slate-950">
            <Gauge size={36} className="text-emerald-300" />
          </div>
        </div>
      </div>
    </section>
  )
}

function CapacityChart({ basis = {} }) {
  const rows = [
    ['RAM', basis.memory_capacity || 0],
    ['CPU', basis.cpu_capacity || 0],
    ['Latency', basis.latency_capacity || 0],
    ['Disk', basis.disk_capacity || 0]
  ]
  const max = Math.max(1, ...rows.map(([, value]) => Number(value || 0)))

  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
      <h2 className="mb-4 text-base font-semibold text-slate-950">Basis Estimasi Kapasitas</h2>
      <div className="space-y-3">
        {rows.map(([label, value]) => (
          <div key={label} className="space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="font-semibold text-slate-700">{label}</span>
              <span className="font-bold text-slate-950">{formatNumber(value)} user</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-indigo-600" style={{ width: `${Math.max(5, (Number(value || 0) / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function SuperServerMonitoring() {
  const { isSuperAdmin, superAdminChecked } = useAuthStore()
  const { pushToast } = useUIStore()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [networkSpeed, setNetworkSpeed] = useState({ rx: 0, tx: 0 })
  const previousNetworkRef = useRef(null)

  const memory = data?.memory || {}
  const disk = data?.disk || {}
  const load = data?.load || {}
  const runtime = data?.runtime || {}
  const prediction = data?.prediction || {}

  const updateNetworkSpeed = (nextData) => {
    const now = Date.now()
    const current = {
      at: now,
      rx: Number(nextData?.network?.rx_bytes || 0),
      tx: Number(nextData?.network?.tx_bytes || 0)
    }
    const previous = previousNetworkRef.current
    previousNetworkRef.current = current
    if (!previous) return

    const seconds = Math.max(1, (current.at - previous.at) / 1000)
    setNetworkSpeed({
      rx: Math.max(0, (current.rx - previous.rx) / seconds),
      tx: Math.max(0, (current.tx - previous.tx) / seconds)
    })
  }

  const loadData = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    try {
      const { data: nextData, error } = await supabase.super.serverMonitoring()
      if (error) throw error
      setData(nextData || null)
      updateNetworkSpeed(nextData || null)
    } catch (error) {
      pushToast('error', error?.message || 'Gagal memuat monitoring server')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    if (!superAdminChecked || !isSuperAdmin) return undefined
    loadData()
    const timer = window.setInterval(() => loadData({ silent: true }), 5000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [superAdminChecked, isSuperAdmin])

  return (
    <PageGate superAdminChecked={superAdminChecked} isSuperAdmin={isSuperAdmin}>
      <div className="space-y-6 p-4 sm:p-6">
        <div className="page-title-card">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-900 text-white">
                <Server size={24} />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">Monitoring Server</p>
                <h1 className="page-title-heading">Monitoring Server & Performa</h1>
                <p className="page-title-description">
                  Pantau IP, RAM, storage, jaringan, kecepatan respon, dan estimasi kapasitas akses.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => loadData()}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
          <HealthGauge score={prediction.health_score} statusLabel={prediction.status_label || runtime.status_label} />
          <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
            <h2 className="text-base font-semibold text-slate-950">Identitas Runtime</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase text-slate-500">Public IP</p>
                <p className="mt-1 font-semibold text-slate-950">{data?.server?.public_ip || '-'}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase text-slate-500">Hostname</p>
                <p className="mt-1 truncate font-semibold text-slate-950">{data?.server?.hostname || '-'}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase text-slate-500">Website</p>
                <p className="mt-1 truncate font-semibold text-slate-950">{data?.server?.app_url || '-'}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase text-slate-500">Update</p>
                <p className="mt-1 font-semibold text-slate-950">{data?.generated_at ? formatDateTime(data.generated_at) : '-'}</p>
              </div>
            </div>
          </section>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="RAM Terpakai" value={memory.used_label || '-'} hint={`Sisa ${memory.available_label || '-'}`} icon={MemoryStick} percent={memory.percent} tone="indigo" />
          <MetricCard label="Storage Terpakai" value={disk.used_label || '-'} hint={`Sisa ${disk.free_label || '-'}`} icon={HardDrive} percent={disk.percent} tone="amber" />
          <MetricCard label="CPU Load" value={`${load.one_minute || 0}`} hint={`${load.cores || 1} core · ${load.one_minute_percent || 0}%`} icon={Cpu} percent={load.one_minute_percent} tone="sky" />
          <MetricCard label="Kecepatan Website" value={`${runtime.response_ms || 0} ms`} hint="Waktu respon endpoint monitoring" icon={Activity} tone="emerald" />
        </div>

        <div className="grid gap-4 xl:grid-cols-[.9fr_1.1fr]">
          <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-950">Jaringan</h2>
              <Network size={18} className="text-indigo-500" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-indigo-50 p-4">
                <p className="text-xs font-bold uppercase text-indigo-600">Download</p>
                <p className="mt-1 text-2xl font-black text-slate-950">{formatBytesPerSecond(networkSpeed.rx)}</p>
                <p className="mt-1 text-xs text-slate-500">Total RX {data?.network?.rx_label || '-'}</p>
              </div>
              <div className="rounded-xl bg-emerald-50 p-4">
                <p className="text-xs font-bold uppercase text-emerald-600">Upload</p>
                <p className="mt-1 text-2xl font-black text-slate-950">{formatBytesPerSecond(networkSpeed.tx)}</p>
                <p className="mt-1 text-xs text-slate-500">Total TX {data?.network?.tx_label || '-'}</p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {(data?.network?.interfaces || []).slice(0, 4).map((item) => (
                <div key={item.name} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-sm">
                  <span className="font-bold text-slate-700">{item.name}</span>
                  <span className="text-slate-500">RX {item.rx_label} · TX {item.tx_label}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-950">Prediksi Kapasitas</h2>
              <Globe2 size={18} className="text-indigo-500" />
            </div>
            <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-slate-950 p-5 text-white">
              <p className="text-sm font-semibold text-indigo-100">Estimasi akses bersamaan yang masih aman</p>
              <p className="mt-2 text-4xl font-black">{prediction.estimated_concurrent_users_label || '-'}</p>
              <p className="mt-3 text-sm text-indigo-100">
                Ini indikator operasional dari RAM, CPU, disk, dan respon endpoint. Untuk angka final tetap perlu load test khusus.
              </p>
            </div>
          </section>
        </div>

        <CapacityChart basis={prediction.basis || {}} />
      </div>
    </PageGate>
  )
}
