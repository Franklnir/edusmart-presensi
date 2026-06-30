import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle2,
  Clock3,
  Database,
  ExternalLink,
  Gauge,
  ListChecks,
  RefreshCw,
  ServerCog,
  Signal,
  TimerReset,
  UsersRound
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { formatDateTime } from '../../lib/time'

const numberFormatter = new Intl.NumberFormat('id-ID')
const formatNumber = (value) => numberFormatter.format(Number(value || 0))
const JOB_LIST_VISIBLE_COUNT = 5

const roleLabel = {
  siswa: 'Siswa',
  guru: 'Guru',
  admin: 'Admin'
}

const statusMeta = {
  healthy: {
    label: 'Sehat',
    icon: CheckCircle2,
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    iconBox: 'bg-emerald-100 text-emerald-700'
  },
  running: {
    label: 'Running',
    icon: CheckCircle2,
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    iconBox: 'bg-emerald-100 text-emerald-700'
  },
  completed: {
    label: 'Selesai',
    icon: CheckCircle2,
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    iconBox: 'bg-emerald-100 text-emerald-700'
  },
  pending: {
    label: 'Pending',
    icon: Clock3,
    badge: 'border-sky-200 bg-sky-50 text-sky-700',
    iconBox: 'bg-sky-100 text-sky-700'
  },
  reserved: {
    label: 'Diproses',
    icon: Clock3,
    badge: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    iconBox: 'bg-indigo-100 text-indigo-700'
  },
  warning: {
    label: 'Pantau',
    icon: AlertTriangle,
    badge: 'border-amber-200 bg-amber-50 text-amber-700',
    iconBox: 'bg-amber-100 text-amber-700'
  },
  paused: {
    label: 'Paused',
    icon: AlertTriangle,
    badge: 'border-amber-200 bg-amber-50 text-amber-700',
    iconBox: 'bg-amber-100 text-amber-700'
  },
  inactive: {
    label: 'Inactive',
    icon: AlertTriangle,
    badge: 'border-slate-200 bg-slate-50 text-slate-700',
    iconBox: 'bg-slate-100 text-slate-700'
  },
  unknown: {
    label: 'Unknown',
    icon: AlertTriangle,
    badge: 'border-slate-200 bg-slate-50 text-slate-700',
    iconBox: 'bg-slate-100 text-slate-700'
  },
  critical: {
    label: 'Tindakan',
    icon: AlertTriangle,
    badge: 'border-rose-200 bg-rose-50 text-rose-700',
    iconBox: 'bg-rose-100 text-rose-700'
  },
  failed: {
    label: 'Gagal',
    icon: AlertTriangle,
    badge: 'border-rose-200 bg-rose-50 text-rose-700',
    iconBox: 'bg-rose-100 text-rose-700'
  },
  unavailable: {
    label: 'Error',
    icon: AlertTriangle,
    badge: 'border-rose-200 bg-rose-50 text-rose-700',
    iconBox: 'bg-rose-100 text-rose-700'
  }
}

const getStatusMeta = (status) => statusMeta[status] || statusMeta.unknown

const formatDuration = (seconds) => {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value < 0) return '-'
  if (value < 60) return `${Math.round(value)} dtk`
  if (value < 3600) return `${Math.round(value / 60)} mnt`
  return `${Math.round(value / 3600)} jam`
}

function StatusPill({ status, label }) {
  const meta = getStatusMeta(status)
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${meta.badge}`}>
      <Icon size={13} />
      {label || meta.label}
    </span>
  )
}

export function PageGate({ superAdminChecked, isSuperAdmin, children }) {
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

function StatCard({ label, value, hint, icon: Icon, tone = 'indigo' }) {
  const toneClass = {
    indigo: 'bg-indigo-50 text-indigo-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    sky: 'bg-sky-50 text-sky-700'
  }[tone] || 'bg-indigo-50 text-indigo-700'

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{value}</p>
        </div>
        <span className={`grid h-11 w-11 place-items-center rounded-2xl ${toneClass}`}>
          <Icon size={19} />
        </span>
      </div>
      {hint ? <p className="mt-3 text-sm text-slate-500">{hint}</p> : null}
    </div>
  )
}

function QueueMetricCard({ label, value, hint, icon: Icon, status = 'healthy' }) {
  const meta = getStatusMeta(status)
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-2 truncate text-2xl font-semibold text-slate-950">{value}</p>
        </div>
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${meta.iconBox}`}>
          <Icon size={19} />
        </span>
      </div>
      {hint ? <p className="mt-3 text-sm text-slate-500">{hint}</p> : null}
    </div>
  )
}

export function QueueStatusPanel({ jobs }) {
  const status = jobs?.status || {}
  const horizon = jobs?.horizon || {}
  const redis = jobs?.redis || {}
  const counts = horizon?.counts || {}
  const failed = jobs?.database_failed_jobs || {}
  const queueBacklog = (jobs?.queues || []).reduce((sum, row) => sum + Number(row.total_backlog || 0), 0)
  const heartbeat = jobs?.heartbeats || {}
  const schedulerStatus = heartbeat?.scheduler?.status || 'unknown'
  const quizWorkerStatus = heartbeat?.quiz_worker?.status || 'unknown'

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">Queue & Background Jobs</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">Worker Queue Operasional</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={status.level} label={status.label} />
          {horizon.dashboard_url ? (
            <a
              href={horizon.dashboard_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <ExternalLink size={14} />
              Horizon
            </a>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <QueueMetricCard
          label="Horizon"
          value={horizon.status || '-'}
          hint={horizon.version ? `Versi ${horizon.version}` : 'Dashboard queue'}
          icon={ServerCog}
          status={horizon.status === 'running' ? 'healthy' : horizon.status}
        />
        <QueueMetricCard
          label="Redis"
          value={redis.ok ? `${redis.latency_ms ?? 0} ms` : 'Error'}
          hint="Koneksi queue"
          icon={Database}
          status={redis.status}
        />
        <QueueMetricCard
          label="Backlog"
          value={formatNumber(queueBacklog)}
          hint="Ready + delayed + reserved"
          icon={ListChecks}
          status={queueBacklog > 0 ? 'warning' : 'healthy'}
        />
        <QueueMetricCard
          label="Worker"
          value={formatNumber(counts.processes)}
          hint="Proses aktif"
          icon={Gauge}
          status={Number(counts.processes || 0) > 0 ? 'healthy' : 'warning'}
        />
        <QueueMetricCard
          label="Failed 1 Jam"
          value={formatNumber(failed.last_hour)}
          hint={`${formatNumber(failed.last_24h)} dalam 24 jam`}
          icon={AlertTriangle}
          status={Number(failed.last_hour || 0) > 0 ? 'critical' : (Number(failed.last_24h || 0) > 0 ? 'warning' : 'healthy')}
        />
        <QueueMetricCard
          label="Scheduler"
          value={schedulerStatus}
          hint={`Worker quiz ${quizWorkerStatus}`}
          icon={TimerReset}
          status={schedulerStatus}
        />
      </div>

      {Array.isArray(status.issues) && status.issues.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-700" />
            <div className="min-w-0 space-y-1">
              {status.issues.slice(0, 4).map((issue) => (
                <p key={issue} className="text-sm font-semibold text-amber-900">{issue}</p>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export function QueueTable({ queues = [] }) {
  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-950">Queue Backlog</h2>
        <ListChecks size={18} className="text-indigo-500" />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 font-bold">Queue</th>
              <th className="px-3 py-2 text-right font-bold">Ready</th>
              <th className="px-3 py-2 text-right font-bold">Delayed</th>
              <th className="px-3 py-2 text-right font-bold">Reserved</th>
              <th className="px-3 py-2 text-right font-bold">Wait</th>
              <th className="px-3 py-2 text-right font-bold">Worker</th>
              <th className="px-3 py-2 text-right font-bold">Status</th>
            </tr>
          </thead>
          <tbody>
            {queues.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-500">Belum ada queue yang terpantau.</td>
              </tr>
            ) : queues.map((queue) => (
              <tr key={queue.name} className="border-b border-slate-50 last:border-0">
                <td className="px-3 py-3">
                  <div className="font-bold text-slate-950">{queue.label || queue.name}</div>
                  <div className="text-xs text-slate-500">{queue.name}</div>
                </td>
                <td className="px-3 py-3 text-right font-semibold text-slate-700">{formatNumber(queue.ready)}</td>
                <td className="px-3 py-3 text-right font-semibold text-slate-700">{formatNumber(queue.delayed)}</td>
                <td className="px-3 py-3 text-right font-semibold text-slate-700">{formatNumber(queue.reserved)}</td>
                <td className="px-3 py-3 text-right font-semibold text-slate-700">{formatDuration(queue.wait_seconds)}</td>
                <td className="px-3 py-3 text-right font-semibold text-slate-700">{formatNumber(queue.processes)}</td>
                <td className="px-3 py-3 text-right"><StatusPill status={queue.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function WorkerPanel({ supervisors = [], heartbeats = {} }) {
  const scheduler = heartbeats.scheduler || {}
  const quizWorker = heartbeats.quiz_worker || {}
  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-950">Worker & Heartbeat</h2>
        <ServerCog size={18} className="text-indigo-500" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
        <div className="rounded-2xl border border-slate-100 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-bold text-slate-950">Scheduler</span>
            <StatusPill status={scheduler.status} />
          </div>
          <p className="text-xs text-slate-500">
            {scheduler.last_seen_at ? `${formatDateTime(scheduler.last_seen_at)} · ${formatDuration(scheduler.age_seconds)}` : 'Belum ada heartbeat'}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-100 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-bold text-slate-950">Quiz Worker</span>
            <StatusPill status={quizWorker.status} />
          </div>
          <p className="text-xs text-slate-500">
            {quizWorker.last_seen_at ? `${formatDateTime(quizWorker.last_seen_at)} · ${formatDuration(quizWorker.age_seconds)}` : 'Belum ada heartbeat'}
          </p>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {supervisors.length === 0 ? (
          <div className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">Horizon supervisor belum aktif.</div>
        ) : supervisors.map((supervisor) => (
          <div key={supervisor.name} className="rounded-2xl border border-slate-100 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-950">{supervisor.name}</p>
                <p className="text-xs text-slate-500">PID {supervisor.pid || '-'} · {formatNumber(supervisor.total_processes)} proses</p>
              </div>
              <StatusPill status={supervisor.status} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(supervisor.queues || []).map((item) => (
                <span key={`${supervisor.name}-${item.queue}`} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                  {item.queue.replace('redis:', '')}: {formatNumber(item.processes)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export function JobTable({ title, rows = [], empty, failed = false }) {
  const listRef = useRef(null)
  const [maxListHeight, setMaxListHeight] = useState(null)
  const shouldScroll = rows.length > JOB_LIST_VISIBLE_COUNT

  useLayoutEffect(() => {
    if (!shouldScroll) {
      setMaxListHeight(null)
      return undefined
    }

    const measureList = () => {
      const list = listRef.current
      if (!list) return

      const visibleItems = Array.from(list.children).slice(0, JOB_LIST_VISIBLE_COUNT)
      const first = visibleItems[0]
      const last = visibleItems[visibleItems.length - 1]
      if (!first || !last) return

      const nextHeight = Math.ceil(last.offsetTop + last.offsetHeight - first.offsetTop)
      setMaxListHeight((current) => (current === nextHeight ? current : nextHeight))
    }

    measureList()
    const frame = window.requestAnimationFrame(measureList)
    window.addEventListener('resize', measureList)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', measureList)
    }
  }, [failed, rows, shouldScroll, title])

  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          {shouldScroll ? (
            <p className="mt-1 text-xs font-medium text-slate-500">
              Tampil {JOB_LIST_VISIBLE_COUNT} dari {formatNumber(rows.length)} job, scroll untuk lainnya.
            </p>
          ) : null}
        </div>
        {failed ? <AlertTriangle size={18} className="text-rose-500" /> : <Clock3 size={18} className="text-indigo-500" />}
      </div>
      <div
        ref={listRef}
        className={`space-y-2 ${shouldScroll ? 'overflow-y-auto overscroll-contain pr-1' : ''}`}
        style={shouldScroll && maxListHeight ? { maxHeight: `${maxListHeight}px` } : undefined}
      >
        {rows.length === 0 ? (
          <div className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">{empty}</div>
        ) : rows.map((job) => (
          <div key={`${title}-${job.id || job.uuid || job.index}`} className="rounded-xl border border-slate-100 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-950">{job.name || 'Job'}</p>
                <p className="text-xs text-slate-500">{job.queue || '-'} · {job.status || 'failed'}</p>
              </div>
              <StatusPill status={failed ? 'critical' : (job.status === 'completed' ? 'healthy' : job.status)} />
            </div>
            {job.failed_at || job.completed_at || job.reserved_at ? (
              <p className="mt-2 text-xs text-slate-500">
                {formatDateTime(job.failed_at || job.completed_at || job.reserved_at)}
              </p>
            ) : null}
            {job.exception ? (
              <p className="mt-2 line-clamp-2 text-xs font-medium text-rose-700">{job.exception}</p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}

function MiniBarChart({ title, rows = [], valueKey = 'online_now', labelKey = 'name', empty = 'Belum ada aktivitas.' }) {
  const max = Math.max(1, ...rows.map((row) => Number(row?.[valueKey] || 0)))
  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <BarChart3 size={18} className="text-indigo-500" />
      </div>
      {rows.length === 0 ? (
        <div className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">{empty}</div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const value = Number(row?.[valueKey] || 0)
            return (
              <div key={`${row.tenant_id || row.slug}-${valueKey}`} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-semibold text-slate-700">{row?.[labelKey] || '-'}</span>
                  <span className="font-bold text-slate-950">{formatNumber(value)}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-indigo-600"
                    style={{ width: `${Math.max(4, (value / max) * 100)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function LineChart({ rows = [] }) {
  const width = 720
  const height = 190
  const padding = 20
  const values = rows.map((row) => Number(row.total || 0))
  const max = Math.max(1, ...values)
  const points = rows.map((row, index) => {
    const x = padding + (index / Math.max(1, rows.length - 1)) * (width - padding * 2)
    const y = height - padding - (Number(row.total || 0) / max) * (height - padding * 2)
    return `${x},${y}`
  }).join(' ')

  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-slate-950">Grafik Aktivitas 24 Jam</h2>
        <p className="text-xs font-semibold text-slate-500">Berdasarkan presence ping pengguna</p>
      </div>
      <div className="overflow-hidden rounded-2xl bg-slate-950 p-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full">
          <defs>
            <linearGradient id="presenceLine" x1="0" x2="1">
              <stop offset="0%" stopColor="#60a5fa" />
              <stop offset="55%" stopColor="#34d399" />
              <stop offset="100%" stopColor="#f59e0b" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3].map((line) => (
            <line
              key={line}
              x1={padding}
              x2={width - padding}
              y1={padding + line * 45}
              y2={padding + line * 45}
              stroke="rgba(148,163,184,.16)"
            />
          ))}
          <polyline points={points} fill="none" stroke="url(#presenceLine)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          {rows.map((row, index) => {
            if (index % 4 !== 0) return null
            const x = padding + (index / Math.max(1, rows.length - 1)) * (width - padding * 2)
            return (
              <text key={row.label} x={x} y={height - 2} textAnchor="middle" fill="#94a3b8" fontSize="12">
                {row.label}
              </text>
            )
          })}
        </svg>
      </div>
    </section>
  )
}

function ActiveUserList({ users = [] }) {
  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-950">Pengguna Sedang Aktif</h2>
        <Signal size={18} className="text-emerald-500" />
      </div>
      <div className="space-y-2">
        {users.length === 0 ? (
          <div className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">Belum ada pengguna aktif dalam 5 menit terakhir.</div>
        ) : users.map((user) => (
          <div key={`${user.id}-${user.tenant_id}`} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-sm font-black text-emerald-700">
              {(user.name || '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-slate-950">{user.name}</p>
              <p className="truncate text-xs text-slate-500">{roleLabel[user.role] || user.role} · {user.tenant_name}</p>
            </div>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
              Online
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function SuperMonitoring() {
  const { isSuperAdmin, superAdminChecked } = useAuthStore()
  const { pushToast } = useUIStore()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  const totals = data?.totals || {}
  const charts = data?.charts || {}
  const top = data?.top_tenants || {}

  const loadData = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    try {
      const { data: nextData, error } = await supabase.super.monitoringOverview()
      if (error) throw error
      setData(nextData || null)
    } catch (error) {
      pushToast('error', error?.message || 'Gagal memuat monitoring')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    if (!superAdminChecked || !isSuperAdmin) return undefined
    loadData()
    const timer = window.setInterval(() => loadData({ silent: true }), 15000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [superAdminChecked, isSuperAdmin])

  const roleDistribution = useMemo(() => data?.role_distribution || [], [data])

  return (
    <PageGate superAdminChecked={superAdminChecked} isSuperAdmin={isSuperAdmin}>
      <div className="space-y-6 p-4 sm:p-6">
        <div className="page-title-card">
          <div className="page-title-layout">
            <div className="page-title-main">
              <div className="page-title-icon bg-indigo-100 text-indigo-700">
                <Activity size={24} />
              </div>
              <div>
                <p className="page-title-kicker">Monitoring</p>
                <h1 className="page-title-heading">Monitoring Multi Sekolah</h1>
                <p className="page-title-description">
                  Pantau siswa, guru, admin sekolah, dan aktivitas realtime seluruh tenant dari satu halaman.
                </p>
              </div>
            </div>
            <div className="page-title-actions">
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
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Total Sekolah" value={formatNumber(totals.tenants)} hint="Tenant terdaftar" icon={Building2} tone="indigo" />
          <StatCard label="Total Siswa" value={formatNumber(totals.students)} hint={`${formatNumber(data?.active_by_role?.siswa)} sedang aktif`} icon={UsersRound} tone="sky" />
          <StatCard label="Total Guru" value={formatNumber(totals.teachers)} hint={`${formatNumber(data?.active_by_role?.guru)} sedang aktif`} icon={UsersRound} tone="emerald" />
          <StatCard label="Admin Sekolah" value={formatNumber(totals.admins)} hint={`${formatNumber(data?.active_by_role?.admin)} sedang aktif`} icon={UsersRound} tone="amber" />
          <StatCard label="Online Sekarang" value={formatNumber(totals.online_now)} hint={`Window ${data?.active_window_minutes || 5} menit`} icon={Signal} tone="emerald" />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.45fr_.95fr]">
          <LineChart rows={charts.presence_24h || []} />
          <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
            <h2 className="mb-4 text-base font-semibold text-slate-950">Distribusi Role</h2>
            <div className="space-y-3">
              {roleDistribution.map((row) => {
                const total = Math.max(1, Number(totals.students || 0) + Number(totals.teachers || 0) + Number(totals.admins || 0))
                const percent = (Number(row.value || 0) / total) * 100
                return (
                  <div key={row.label} className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="font-semibold text-slate-700">{row.label}</span>
                      <span className="font-bold text-slate-950">{formatNumber(row.value)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100">
                      <div className="h-2 rounded-full" style={{ width: `${Math.max(4, percent)}%`, backgroundColor: row.color }} />
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="mt-5 text-xs text-slate-500">Terakhir sinkron: {data?.generated_at ? formatDateTime(data.generated_at) : '-'}</p>
          </section>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <MiniBarChart title="Sekolah Siswa Paling Aktif" rows={top.students || []} valueKey="active_students" />
          <MiniBarChart title="Sekolah Guru Paling Aktif" rows={top.teachers || []} valueKey="active_teachers" />
          <MiniBarChart title="Sekolah Admin Paling Aktif" rows={top.admins || []} valueKey="active_admins" />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_.85fr]">
          <MiniBarChart title="Aktivitas Online per Sekolah" rows={top.overall || []} valueKey="online_now" />
          <ActiveUserList users={data?.active_users || []} />
        </div>
      </div>
    </PageGate>
  )
}
