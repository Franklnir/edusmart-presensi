import React, { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  BarChart3,
  Building2,
  RefreshCw,
  Signal,
  UsersRound
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { formatDateTime } from '../../lib/time'

const numberFormatter = new Intl.NumberFormat('id-ID')
const formatNumber = (value) => numberFormatter.format(Number(value || 0))

const roleLabel = {
  siswa: 'Siswa',
  guru: 'Guru',
  admin: 'Admin'
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
          <p className="mt-2 text-3xl font-extrabold text-slate-950">{value}</p>
        </div>
        <span className={`grid h-11 w-11 place-items-center rounded-2xl ${toneClass}`}>
          <Icon size={19} />
        </span>
      </div>
      {hint ? <p className="mt-3 text-sm text-slate-500">{hint}</p> : null}
    </div>
  )
}

function MiniBarChart({ title, rows = [], valueKey = 'online_now', labelKey = 'name', empty = 'Belum ada aktivitas.' }) {
  const max = Math.max(1, ...rows.map((row) => Number(row?.[valueKey] || 0)))
  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-extrabold text-slate-950">{title}</h2>
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
        <h2 className="text-base font-extrabold text-slate-950">Grafik Aktivitas 24 Jam</h2>
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
        <h2 className="text-base font-extrabold text-slate-950">Pengguna Sedang Aktif</h2>
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
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-indigo-100 text-indigo-700">
                <Activity size={24} />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">Monitoring</p>
                <h1 className="page-title-heading">Monitoring Multi Sekolah</h1>
                <p className="page-title-description">
                  Pantau siswa, guru, admin sekolah, dan aktivitas realtime seluruh tenant dari satu halaman.
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
            <h2 className="mb-4 text-base font-extrabold text-slate-950">Distribusi Role</h2>
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
